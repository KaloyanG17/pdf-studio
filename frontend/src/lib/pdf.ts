import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fallbackFor, registerEmbedded, styleFromName } from './embedded';
import { FAMILIES, loadFonts } from './fonts';
import type { FontFamily } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js may transfer the buffer to its worker, so hand it a copy.
  return pdfjs.getDocument({ data: bytes.slice(), fontExtraProperties: true, standardFontDataUrl: '/vendor/standard_fonts/', useSystemFonts: false }).promise;
}

const pageCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<PDFPageProxy>>>();
export function getPage(doc: PDFDocumentProxy, index: number): Promise<PDFPageProxy> {
  let m = pageCache.get(doc);
  if (!m) pageCache.set(doc, (m = new Map()));
  let p = m.get(index);
  if (!p) m.set(index, (p = doc.getPage(index + 1)));
  return p;
}

// ------------------------------------------------------------------ text lines

export type Align = 'left' | 'center' | 'right';

/**
 * One visually continuous run of text on a baseline (a table cell, a label, a value…).
 * Runs separated by tab-sized gaps are separate lines, so columns never merge.
 */
export interface TextLine {
  str: string;
  x: number;
  top: number;
  width: number;
  height: number;
  size: number;
  baseline: number;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  /** Original font (see embedded.ts), when pdf.js could provide it. */
  fontRef?: string;
  /** PDF standard-14 font name when the original is a non-subset base font (Times-Roman, Helvetica…). */
  stdFont?: string;
  ascent: number;
  /** Extra pt per space / per character that the original used (0 when it used natural spacing). */
  wordSpacing: number;
  charSpacing: number;
  /** How the run is aligned against its neighbours; `anchor` is the x it is aligned to. */
  align: Align;
  anchor: number;
  /** CSS font string used to measure this run (original font first). */
  css: string;
}

interface Style {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  fontRef?: string;
  stdFont?: string;
  ascent: number;
  css: string; // CSS family list used to measure glyph widths
}

const FAMILY_CSS = Object.fromEntries(FAMILIES.map((f) => [f.id, f.css])) as Record<FontFamily, string>;

const lineCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<TextLine[]>>>();

export function getTextLines(doc: PDFDocumentProxy, index: number): Promise<TextLine[]> {
  let m = lineCache.get(doc);
  if (!m) lineCache.set(doc, (m = new Map()));
  let p = m.get(index);
  if (!p) m.set(index, (p = extractLines(doc, index)));
  return p;
}

/** Recognised (OCR) lines replace a scanned page's empty text layer for every tool. */
export function setOcrLines(doc: PDFDocumentProxy, index: number, lines: TextLine[]) {
  let m = lineCache.get(doc);
  if (!m) lineCache.set(doc, (m = new Map()));
  m.set(index, Promise.resolve(lines));
}

/** True when a page has no real text (a scan or a picture of text). */
export async function hasTextLayer(doc: PDFDocumentProxy, index: number) {
  const tc = await (await getPage(doc, index)).getTextContent();
  return tc.items.some((i) => 'str' in i && i.str.trim());
}

const STD_BASE: [RegExp, string][] = [
  [/^(times|timesnewroman|timesnewromanps|timesroman)/, 'Times'],
  [/^(helvetica|arial|arialmt|liberationsans|arimo)/, 'Helvetica'],
  [/^(courier|couriernew|couriernewps)/, 'Courier'],
];

/** Maps a base (non-subset) font name to the PDF standard font with the same metrics. */
export function standardFontFor(name: string): string | undefined {
  if (/^[A-Z]{6}\+/.test(name)) return undefined; // subset → really embedded
  const n = name.toLowerCase().replace(/[\s_]/g, '');
  const hit = STD_BASE.find(([re]) => re.test(n));
  if (!hit) return undefined;
  const { bold, italic } = styleFromName(name);
  const base = hit[1];
  if (base === 'Times') return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  const slant = base === 'Helvetica' || base === 'Courier' ? 'Oblique' : 'Italic';
  return bold && italic ? `${base}-Bold${slant}` : bold ? `${base}-Bold` : italic ? `${base}-${slant}` : base;
}

const measureCtx = document.createElement('canvas').getContext('2d')!;
// PDFs never kern implicitly; measure the same way.
(measureCtx as CanvasRenderingContext2D & { fontKerning?: string }).fontKerning = 'none';
function measureText(text: string, css: string, size: number, s: Style) {
  measureCtx.font = `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${size}px ${css}`;
  return measureCtx.measureText(text).width;
}

type Word = { str: string; x: number; right: number; baseline: number; size: number; style: Style };
export interface Raster {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  s: number;
}

export async function rasterize(page: PDFPageProxy): Promise<Raster> {
  const s = 3;
  const v = page.getViewport({ scale: s });
  const c = document.createElement('canvas');
  c.width = Math.ceil(v.width);
  c.height = Math.ceil(v.height);
  // 'print' intent renders without requestAnimationFrame, so it also completes in background tabs.
  await page.render({ canvas: c, viewport: v, intent: 'print' }).promise;
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  return { data: d.data, w: c.width, h: c.height, s };
}

/** How badly a candidate word layout disagrees with the rendered page (mismatched ink pixels). */
function fitScore(r: Raster, ws: Word[], css: string, baseline: number, size: number, x0: number, x1: number): number {
  const s = r.s;
  const px0 = Math.max(0, Math.round((x0 - 1) * s));
  const py0 = Math.max(0, Math.round((baseline - size) * s));
  const cw = Math.min(r.w - px0, Math.ceil((x1 - x0 + 2) * s));
  const ch = Math.min(r.h - py0, Math.ceil(size * 1.35 * s));
  if (cw <= 0 || ch <= 0) return 0;
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.setTransform(s, 0, 0, s, -px0, -py0);
  g.font = css;
  (g as CanvasRenderingContext2D & { fontKerning?: string }).fontKerning = 'none';
  g.fillStyle = '#000';
  for (const w of ws) g.fillText(w.str, w.x, baseline);
  const cand = g.getImageData(0, 0, cw, ch).data;
  // Background = most common colour in the crop.
  const hist = new Map<number, number>();
  for (let y = 0; y < ch; y += 2)
    for (let x = 0; x < cw; x += 2) {
      const i = ((py0 + y) * r.w + px0 + x) * 4;
      const k = ((r.data[i] >> 3) << 10) | ((r.data[i + 1] >> 3) << 5) | (r.data[i + 2] >> 3);
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
  const bgKey = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const bg = [((bgKey >> 10) & 31) << 3, ((bgKey >> 5) & 31) << 3, (bgKey & 31) << 3];
  let mismatch = 0;
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = ((py0 + y) * r.w + px0 + x) * 4;
      const pageInk = Math.abs(r.data[i] - bg[0]) + Math.abs(r.data[i + 1] - bg[1]) + Math.abs(r.data[i + 2] - bg[2]) > 150;
      const candInk = cand[(y * cw + x) * 4 + 3] > 110;
      if (pageInk !== candInk) mismatch++;
    }
  return mismatch;
}

/** pdf.js resolves font objects asynchronously; wait for one (with a timeout). */
function fontObject(page: PDFPageProxy, name: string): Promise<unknown> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: unknown) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      if (page.commonObjs.has(name)) return finish(page.commonObjs.get(name));
      page.commonObjs.get(name, finish as never);
    } catch {
      return finish(undefined);
    }
    setTimeout(() => finish(undefined), 2500);
  });
}

async function extractLines(doc: PDFDocumentProxy, index: number): Promise<TextLine[]> {
  await loadFonts();
  const page = await getPage(doc, index);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  try {
    await page.getOperatorList(); // makes pdf.js load the page's fonts
  } catch {
    /* ignore */
  }

  // ---- resolve every font once
  const styles = new Map<string, Style>();
  for (const it of tc.items) {
    const fn = (it as TextItem).fontName;
    if (!fn || styles.has(fn)) continue;
    const generic = (tc.styles[fn]?.fontFamily ?? '').toLowerCase();
    const obj = (await fontObject(page, fn)) as { name?: string; bold?: boolean; italic?: boolean; black?: boolean; isSerifFont?: boolean; isMonospace?: boolean } | undefined;
    const name = obj?.name ?? '';
    // Stable id (file fingerprint + PDF font name) so saved documents find their fonts again.
    const ref = `${(doc.fingerprints[0] ?? 'doc').slice(0, 10)}~${name || fn}`;
    const emb = obj ? await registerEmbedded(ref, obj, generic) : undefined;
    const st = styleFromName(name);
    const family: FontFamily = obj?.isMonospace ? 'mono' : emb?.fallback ?? (obj?.isSerifFont ? 'serif' : fallbackFor(name, generic));
    const style: Style = {
      family,
      bold: st.bold || !!obj?.bold || !!obj?.black,
      italic: st.italic || !!obj?.italic,
      fontRef: emb?.ref,
      stdFont: standardFontFor(name),
      ascent: emb?.ascent ?? 0.9,
      css: emb ? `"${emb.css}", "${FAMILY_CSS[family]}"` : `"${FAMILY_CSS[family]}"`,
    };
    styles.set(fn, style);
  }

  // ---- split every text item into words with real positions
  const words: Word[] = [];
  let raster: Raster | null = null;
  const getRaster = async () => (raster ??= await rasterize(page));
  for (const it of tc.items) {
    const item = it as TextItem;
    if (typeof item.str !== 'string' || !item.str.trim()) continue;
    const t = pdfjs.Util.transform(vp.transform, item.transform) as number[];
    const size = Math.hypot(t[2], t[3]);
    if (size < 1) continue;
    // Skip rotated / vertical text — only horizontal text is editable for now.
    if (Math.abs(t[1]) > 0.05 * size || Math.abs(t[2]) > 0.05 * size) continue;
    const style = styles.get(item.fontName)!;
    const tokens = item.str.split(/(\s+)/).filter(Boolean);
    const nSp = item.str.length - item.str.replace(/\s/g, '').length;
    const glyphs = tokens.filter((k) => !/^\s/.test(k)).reduce((w, k) => w + measureText(k, style.css, size, style), 0);
    const spaceW = measureText(' ', style.css, size, style);
    // Items carry their real advance (incl. word spacing / scaling); recover per-space advance from it.
    let scale = 1;
    let spaceAdv = spaceW;
    if (nSp > 0) {
      spaceAdv = (item.width - glyphs) / nSp;
      if (spaceAdv < spaceW * 0.3) {
        scale = item.width / Math.max(1e-6, glyphs + nSp * spaceW);
        spaceAdv = spaceW * scale;
      }
    } else if (glyphs > 0) {
      scale = item.width / glyphs;
    }
    // Lay the item's words out; `extraAt` puts all surplus space into one gap instead of spreading it.
    const layout = (extraAt: number | null, extra: number) => {
      const out: Word[] = [];
      let x = t[4];
      tokens.forEach((k, ti) => {
        if (/^\s/.test(k)) {
          x += extraAt === null ? k.length * spaceAdv : k.length * spaceW + (ti === extraAt ? extra : 0);
          return;
        }
        const w = measureText(k, style.css, size, style) * scale;
        out.push({ str: k, x, right: x + w, baseline: t[5], size, style });
        x += w;
      });
      return out;
    };
    let placed = layout(null, 0);

    // pdf.js merges "Label:" + gap + "value" into one item, so the surplus may belong to a single
    // gap rather than to every space. When that is ambiguous, ask the page itself: render each
    // candidate and keep the one that matches the real pixels.
    const surplus = item.width - (glyphs + nSp * spaceW);
    const innerGaps = tokens.map((k, ti) => (/^\s/.test(k) && ti > 0 && ti < tokens.length - 1 ? ti : -1)).filter((ti) => ti >= 0);
    if (scale === 1 && surplus > 0.6 && innerGaps.length >= 2 && innerGaps.length <= 10) {
      const css = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${size}px ${style.css}`;
      const r = await getRaster();
      const score = (ws: Word[]) => fitScore(r, ws, css, t[5], size, t[4], t[4] + item.width);
      let best = score(placed);
      for (const gi of innerGaps) {
        const cand = layout(gi, surplus);
        const s = score(cand);
        if (s < best * 0.85) {
          best = s;
          placed = cand;
        }
      }
    }
    words.push(...placed);
  }

  // ---- rows of words on the same baseline, then runs split at tab-sized gaps
  const w0 = (ws: { size: number }[]) => ws[0].size;
  words.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const rows: Word[][] = [];
  for (const w of words) {
    const row = rows.find(
      (r) => Math.abs(r[0].baseline - w.baseline) < 0.3 * Math.min(r[0].size, w.size) && Math.abs(r[0].size - w.size) < 0.2 * Math.min(r[0].size, w.size),
    );
    if (row) row.push(w);
    else rows.push([w]);
  }

  type Run = { words: Word[] };
  const runs: Run[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let cur: Run | null = null;
    for (const w of row) {
      const prev = cur?.words[cur.words.length - 1];
      const gap = prev ? w.x - prev.right : 0;
      if (!cur || !prev || gap > 0.8 * Math.max(prev.size, w.size) || gap < -0.25 * w.size) {
        cur = { words: [w] };
        runs.push(cur);
      } else cur.words.push(w);
    }
  }
  // A gap clearly wider than the run's other gaps is a deliberate tab (e.g. "Label:   value"):
  // split there so each part keeps its exact position.
  for (let r = 0; r < runs.length; r++) {
    const ws = runs[r].words;
    if (ws.length < 3) continue;
    const gaps = ws.slice(1).map((w, i) => w.x - ws[i].right).filter((g) => g > 0.12 * w0(ws));
    if (gaps.length < 2) continue;
    const minGap = Math.min(...gaps);
    const cut = ws.findIndex((w, i) => i > 0 && w.x - ws[i - 1].right > minGap * 1.25 + 0.75);
    if (cut > 0) {
      runs.splice(r + 1, 0, { words: ws.slice(cut) });
      runs[r] = { words: ws.slice(0, cut) };
      r--; // re-check the first part
    }
  }

  const lines: TextLine[] = runs.map(({ words: ws }) => {
    let str = '';
    ws.forEach((w, i) => {
      if (i > 0) str += w.x - ws[i - 1].right > 0.12 * w.size ? ' ' : '';
      str += w.str;
    });
    // The style that draws most of the characters wins.
    const weight = new Map<Style, number>();
    for (const w of ws) weight.set(w.style, (weight.get(w.style) ?? 0) + w.str.length);
    const style = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const size = Math.max(...ws.map((w) => w.size));
    const baseline = ws[0].baseline;
    const x = ws[0].x;
    const right = Math.max(...ws.map((w) => w.right));
    const asc = Math.min(1.05, Math.max(0.7, style.ascent));
    // Recover the original's word / letter spacing so re-typeset text has the exact same width.
    const css = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${size}px ${style.css}`;
    measureCtx.font = css;
    const diff = right - x - measureCtx.measureText(str).width;
    const nSp = (str.match(/ /g) ?? []).length;
    let wordSpacing = 0;
    let charSpacing = 0;
    if (Math.abs(diff) > 0.2) {
      if (nSp > 0) wordSpacing = diff / nSp;
      else if (str.length > 1) charSpacing = diff / str.length;
    }
    return {
      str,
      x,
      wordSpacing: Math.round(wordSpacing * 1000) / 1000,
      charSpacing: Math.round(charSpacing * 1000) / 1000,
      width: right - x,
      top: baseline - size * asc,
      height: size * (asc + 0.26),
      size,
      baseline,
      family: style.family,
      bold: style.bold,
      italic: style.italic,
      fontRef: style.fontRef,
      stdFont: style.stdFont,
      ascent: style.ascent,
      align: 'left' as Align,
      anchor: x,
      css,
    };
  });

  assignAlignment(lines);
  return lines.sort((a, b) => a.top - b.top || a.x - b.x);
}

/**
 * Alignment: compare each run with runs in other rows of the same column.
 * `tol` is how close edges must be (OCR boxes are less exact than real text, so it passes more).
 */
export function assignAlignment(lines: TextLine[], tol = 1) {
  for (const l of lines) {
    let left = 0, right = 0, center = 0;
    for (const o of lines) {
      if (o === l || Math.abs(o.baseline - l.baseline) < 0.5 * l.size) continue;
      if (Math.abs(o.baseline - l.baseline) > 14 * l.size) continue;
      if (o.x > l.x + l.width || o.x + o.width < l.x) continue;
      // Same-width neighbours match left, right and centre at once, so they prove nothing.
      if (Math.abs(o.width - l.width) < 1.5 * tol) continue;
      if (Math.abs(o.x - l.x) < tol) left++;
      if (Math.abs(o.x + o.width - (l.x + l.width)) < tol) right++;
      if (Math.abs(o.x + o.width / 2 - (l.x + l.width / 2)) < 1.2 * tol) center++;
    }
    l.align = right > left && right > center ? 'right' : center > left && center >= right ? 'center' : 'left';
    l.anchor = l.align === 'center' ? l.x + l.width / 2 : l.align === 'right' ? l.x + l.width : l.x;
  }
}

// ------------------------------------------------------------------ blocks (paragraphs)

export interface TextBlock {
  lines: TextLine[];
  text: string;
  x: number;
  top: number;
  width: number;
  height: number;
  size: number;
  lineGap: number;
  align: Align;
  anchor: number;
}

const eqLeft = (a: TextLine, b: TextLine) => Math.abs(a.x - b.x) < 1.5;
const eqRight = (a: TextLine, b: TextLine) => Math.abs(a.x + a.width - (b.x + b.width)) < 1.5;
// Centring is computed by the PDF generator with rounding, so allow a little more slack.
const eqCenter = (a: TextLine, b: TextLine) => Math.abs(a.x + a.width / 2 - (b.x + b.width / 2)) < 2.5;
const sameColumn = (a: TextLine, b: TextLine) => eqLeft(a, b) || eqRight(a, b) || eqCenter(a, b);

/** Alignment of a multi-line group comes from how its own lines line up. */
function groupAlign(g: TextLine[]): Align {
  if (g.length === 1) return g[0].align;
  const all = (f: (a: TextLine, b: TextLine) => boolean) => g.every((l) => f(l, g[0]));
  if (all(eqLeft)) return 'left';
  if (all(eqCenter)) return 'center';
  if (all(eqRight)) return 'right';
  return g[0].align;
}

/**
 * Groups lines into paragraphs only when they are genuinely wrapped text: same column and
 * style, regular spacing, and the previous line was too full to take the next line's first word.
 * Lists such as addresses or label/value stacks stay one block per line, so their layout is kept.
 */
export function groupBlocks(lines: TextLine[]): TextBlock[] {
  const used = new Set<TextLine>();
  const blocks: TextBlock[] = [];
  const firstWord = (l: TextLine) => l.str.split(' ')[0];

  for (const start of lines) {
    if (used.has(start)) continue;
    used.add(start);
    // Candidate stack: same column, same size, evenly spaced.
    const stack = [start];
    for (;;) {
      const last = stack[stack.length - 1];
      const next = lines.find(
        (l) =>
          !used.has(l) &&
          l.baseline > last.baseline &&
          Math.abs(l.size - start.size) < 0.1 * start.size &&
          l.bold === start.bold &&
          l.italic === start.italic &&
          l.baseline - last.baseline < start.size * 1.75 &&
          sameColumn(l, last),
      );
      if (!next) break;
      stack.push(next);
      used.add(next);
    }
    // Split the stack where a break was intentional rather than a wrap.
    const maxW = Math.max(...stack.map((l) => l.width));
    let group: TextLine[] = [stack[0]];
    const flush = () => {
      const x = Math.min(...group.map((g) => g.x));
      const right = Math.max(...group.map((g) => g.x + g.width));
      const top = group[0].top;
      const bottom = Math.max(...group.map((g) => g.top + g.height));
      let text = '';
      for (const g of group) {
        if (!text) text = g.str;
        else if (/[A-Za-zА-Яа-я]-$/.test(text) && /^[a-zа-я]/.test(g.str)) text = text.slice(0, -1) + g.str;
        else text += ' ' + g.str;
      }
      const gaps = group.slice(1).map((g, i) => g.baseline - group[i].baseline);
      const lineGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : start.size * 1.2;
      const align = groupAlign(group);
      const anchor = align === 'center' ? x + (right - x) / 2 : align === 'right' ? right : x;
      blocks.push({ lines: group, text, x, top, width: right - x, height: bottom - top, size: start.size, lineGap, align, anchor });
    };
    for (let i = 1; i < stack.length; i++) {
      const p = stack[i - 1];
      const l = stack[i];
      measureCtx.font = l.css;
      const wouldFit = p.width + measureCtx.measureText(' ' + firstWord(l)).width <= maxW - 1;
      const listBreak = /[,;:]$/.test(p.str) && /^[A-ZА-Я0-9]/.test(l.str);
      // "Label: value" lines (invoices, forms) are separate fields, never a wrapped sentence.
      const labelLine = /^\p{Lu}[^:]{0,30}:(\s|$)/u.test(l.str);
      const sentenceBreak = /[.!?]$/.test(p.str) && wouldFit;
      if (wouldFit || listBreak || sentenceBreak || labelLine) {
        flush();
        group = [l];
      } else group.push(l);
    }
    flush();
  }
  return blocks;
}

// ------------------------------------------------------------------ colour sampling

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * Renders the page at 2x and, for each rect, returns the background colour (sampled
 * around the rect) and the most contrasting colour inside it (≈ text colour).
 */
export async function sampleColors(doc: PDFDocumentProxy, index: number, rects: Rect[]) {
  const scale = 2;
  const page = await getPage(doc, index);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  // 'print' intent renders without requestAnimationFrame, so it also completes in background tabs.
  await page.render({ canvas, viewport: vp, intent: 'print' }).promise;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const px = (x: number, y: number): [number, number, number] => {
    const cx = Math.min(canvas.width - 1, Math.max(0, Math.round(x * scale)));
    const cy = Math.min(canvas.height - 1, Math.max(0, Math.round(y * scale)));
    const i = (cy * canvas.width + cx) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  return rects.map((r) => {
    const samples: [number, number, number][] = [];
    const m = 1.5;
    for (let k = 0; k <= 6; k++) {
      const fx = r.x + (r.w * k) / 6;
      samples.push(px(fx, r.y - m), px(fx, r.y + r.h + m));
    }
    for (let k = 0; k <= 3; k++) {
      const fy = r.y + (r.h * k) / 3;
      samples.push(px(r.x - m, fy), px(r.x + r.w + m, fy));
    }
    // Most frequent (quantised) colour = background.
    const counts = new Map<string, { n: number; c: [number, number, number] }>();
    for (const c of samples) {
      const key = c.map((v) => v >> 4).join(',');
      const e = counts.get(key);
      if (e) e.n++;
      else counts.set(key, { n: 1, c });
    }
    const bg = [...counts.values()].sort((a, b) => b.n - a.n)[0].c;

    // Text colour = the most common colour among the strongest-contrast pixels. Glyph cores share
    // one exact colour; anti-aliased edges are weaker and varied, so they are left out. (Taking
    // only the single most extreme pixel picks up noise; taking the mode of all ink picks up
    // grey edges on thin glyphs.)
    const ink: { d: number; c: [number, number, number] }[] = [];
    let maxD = 0;
    for (let yy = r.y; yy < r.y + r.h; yy += 0.5) {
      for (let xx = r.x; xx < r.x + r.w; xx += 0.5) {
        const c = px(xx, yy);
        const d = (c[0] - bg[0]) ** 2 + (c[1] - bg[1]) ** 2 + (c[2] - bg[2]) ** 2;
        if (d < 2000) continue;
        ink.push({ d, c });
        if (d > maxD) maxD = d;
      }
    }
    const inks = new Map<number, { n: number; c: [number, number, number] }>();
    for (const { d, c } of ink) {
      if (d < maxD * 0.8) continue;
      const key = (c[0] << 16) | (c[1] << 8) | c[2];
      const e = inks.get(key);
      if (e) e.n++;
      else inks.set(key, { n: 1, c });
    }
    const top = [...inks.values()].sort((a, b) => b.n - a.n)[0];
    return { bg: toHex(...bg), fg: top ? toHex(...top.c) : '#000000' };
  });
}

if (import.meta.env.DEV) (window as unknown as { __pdf: unknown }).__pdf = { getPage, getTextLines };
