import { translateTexts } from './api';
import { fixDates, getGlossary, isDateOnly, localizeFormats, protect, recall, restore, type GlossaryEntry } from './glossary';
import { covers } from './embedded';
import { cssFont, loadFonts, wrap } from './fonts';
import { getPage, getTextLines, groupBlocks, rasterize, sampleColors, type Raster, type TextBlock } from './pdf';
import { useStore } from './store';
import { uid, type FontFamily, type TextAnnotation } from './types';

export interface TranslateOptions {
  pageIds: string[];
  source: string;
  target: string;
  provider?: string;
  /** 'auto' = the original font when it has the glyphs, else its metric-compatible twin. */
  font: FontFamily | 'auto';
  onProgress?: (done: number, total: number) => void;
}

/** Free vertical space below a block, before the next text block that overlaps it horizontally. */
function roomBelow(b: TextBlock, all: TextBlock[], pageH: number): number {
  const bottom = b.top + b.height;
  let limit = pageH - 24;
  for (const o of all) {
    if (o === b || o.top < bottom - 0.5) continue;
    if (o.x < b.x + b.width && o.x + o.width > b.x) limit = Math.min(limit, o.top - o.size * 0.3);
  }
  return Math.max(0, limit - bottom);
}

/**
 * Finds the drawn box a block sits in (table cell, shaded header…) by scanning the rendered page
 * above and below the text for a horizontal rule or a change of background across the block's width.
 * Returns undefined edges when there is no such boundary nearby (free-flowing text).
 */
export function cellBounds(r: Raster, b: TextBlock, bg: string): { top?: number; bottom?: number } {
  const s = r.s;
  const n = parseInt(bg.slice(1), 16);
  const bgc = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const x0 = Math.max(0, Math.round((b.x - 1) * s));
  const x1 = Math.min(r.w - 1, Math.round((b.x + b.width + 1) * s));
  const differs = (py: number) => {
    if (py < 0 || py >= r.h) return true;
    let hit = 0;
    let total = 0;
    for (let px = x0; px <= x1; px += 2) {
      const i = (py * r.w + px) * 4;
      total++;
      if (Math.abs(r.data[i] - bgc[0]) + Math.abs(r.data[i + 1] - bgc[1]) + Math.abs(r.data[i + 2] - bgc[2]) > 45) hit++;
    }
    return hit / total > 0.85;
  };
  const reach = Math.round(b.size * 3 * s);
  const top0 = Math.round((b.top - 1) * s);
  const bot0 = Math.round((b.top + b.height + 1) * s);
  let top: number | undefined;
  let bottom: number | undefined;
  for (let d = 0; d < reach; d++)
    if (differs(top0 - d)) {
      top = (top0 - d + 1) / s;
      break;
    }
  for (let d = 0; d < reach; d++)
    if (differs(bot0 + d)) {
      bottom = (bot0 + d) / s;
      break;
    }
  return { top, bottom };
}

/** The page's text margin: the leftmost text, mirrored on the right. */
function pageMargin(all: TextBlock[]): number {
  return Math.max(18, Math.min(...all.map((o) => o.x)));
}

/** Free horizontal space right of a single-line block (until another block on the same band, or the margin). */
function roomRight(b: TextBlock, all: TextBlock[], pageW: number): number {
  let limit = pageW - pageMargin(all);
  for (const o of all) {
    if (o === b || o.x < b.x + b.width - 0.5) continue;
    if (o.top < b.top + b.height && o.top + o.height > b.top) limit = Math.min(limit, o.x - b.size);
  }
  return Math.max(0, limit - (b.x + b.width));
}

/** Free horizontal space left of a block (until another block on the same band, or the margin). */
function roomLeft(b: TextBlock, all: TextBlock[]): number {
  let limit = pageMargin(all);
  for (const o of all) {
    if (o === b || o.x + o.width > b.x + 0.5) continue;
    if (o.top < b.top + b.height && o.top + o.height > b.top) limit = Math.max(limit, o.x + o.width + b.size);
  }
  return Math.max(0, b.x - limit);
}

/**
 * Replaces the original text of the given pages with translated text, keeping the look:
 * same font (or its metric-compatible twin), same size, same line spacing and colour.
 * Longer translations first use free space beside/below the paragraph; the font only
 * shrinks when there is no room left.
 */
export async function translatePages(opts: TranslateOptions): Promise<{ blocks: number; provider: string }> {
  await loadFonts();
  const { sources } = useStore.getState();
  const results = new Map<string, TextAnnotation[]>();
  let count = 0;
  let providerName = '';

  for (const [n, pageId] of opts.pageIds.entries()) {
    opts.onProgress?.(n, opts.pageIds.length);
    const page = useStore.getState().pages.find((p) => p.id === pageId);
    if (!page?.source) continue;
    const doc = sources[page.source.file].doc;
    const all = groupBlocks(await getTextLines(doc, page.source.index));
    // Text with letters gets translated; a bare date only gets its format converted.
    // Lines you already edited (or translated before) are covered: leave your version alone.
    const covered = (b: TextBlock) =>
      page.annotations.some(
        (a) =>
          a.type === 'text' &&
          a.cover &&
          a.cover.x <= b.x + 1.5 &&
          a.cover.y <= b.top + 1.5 &&
          a.cover.x + a.cover.w >= b.x + b.width - 1.5 &&
          a.cover.y + a.cover.h >= b.top + b.height - 1.5,
      );
    const blocks = all.filter((b) => (/\p{L}/u.test(b.text) || isDateOnly(b.text)) && !covered(b));
    if (!blocks.length) continue;

    // 1) Your earlier corrections (translation memory) and date-only blocks need no engine.
    // 2) Everything else goes to the engine with glossary terms protected.
    const glossary = getGlossary();
    const translations: string[] = new Array(blocks.length);
    const ask: { i: number; text: string; used: GlossaryEntry[] }[] = [];
    blocks.forEach((b, i) => {
      const known = recall(opts.source, opts.target, b.text);
      if (known !== undefined) translations[i] = known;
      else if (isDateOnly(b.text)) translations[i] = b.text;
      else {
        const p = protect(b.text, glossary);
        ask.push({ i, text: p.text, used: p.used });
      }
    });
    if (ask.length) {
      const { translations: got, provider } = await translateTexts(
        ask.map((a) => a.text),
        opts.source,
        opts.target,
        opts.provider,
      );
      providerName = provider;
      ask.forEach((a, k) => (translations[a.i] = restore(got[k] ?? a.text, a.used)));
    } else providerName ||= 'translation memory';
    for (let i = 0; i < translations.length; i++)
      translations[i] = localizeFormats(fixDates(blocks[i].text, translations[i], opts.target), opts.target);
    const raster = await rasterize(await getPage(doc, page.source.index));
    const colors = await sampleColors(
      doc,
      page.source.index,
      blocks.map((b) => ({ x: b.x, y: b.top, w: b.width, h: b.height })),
    );

    const anns: TextAnnotation[] = blocks.flatMap((b, i): TextAnnotation[] => {
      let text = (translations[i] ?? b.text).trim();
      // Keep ALL-CAPS headings in capitals (translation engines often return sentence case).
      const letters = b.text.replace(/[^\p{L}]/gu, '');
      if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) text = text.toUpperCase();
      // Unchanged text (names, codes, prices…) keeps the original pixels: no cover, no redraw.
      if (!text || text.replace(/\s+/g, ' ') === b.text.replace(/\s+/g, ' ')) return [];
      const first = b.lines[0];
      const fontRef = opts.font === 'auto' && covers(first.fontRef, text) ? first.fontRef : undefined;
      const spec = {
        font: opts.font === 'auto' ? first.family : opts.font,
        bold: first.bold,
        italic: first.italic,
        fontRef,
        text,
      };
      const multi = b.lines.length > 1;
      const lhMult = multi ? Math.min(2, Math.max(0.95, b.lineGap / b.size)) : 1.2;
      // Wrapped paragraphs keep their width; single lines may grow into free space on the side(s)
      // their alignment grows toward (right for left-aligned, left for right-aligned, both for centred).
      const rr = roomRight(b, all, page.width);
      const rl = roomLeft(b, all);
      const grow = b.align === 'left' ? rr : b.align === 'right' ? rl : 2 * Math.min(rl, rr);
      const maxW = multi ? b.width : b.width + grow;
      const ascent = Math.min(1.05, Math.max(0.7, first.ascent));
      const blockH = (size: number, n: number) => (ascent + 0.25) * size + (n - 1) * size * lhMult;

      // Is the block inside a drawn box (table cell, shaded header)? Then it must stay inside it.
      const cell = cellBounds(raster, b, colors[i].bg);
      const inCell =
        cell.top !== undefined && cell.bottom !== undefined && cell.bottom - cell.top < b.height + 4 * b.size;
      const cellCenter = inCell ? (cell.top! + cell.bottom!) / 2 : 0;
      const vCentered = inCell && Math.abs(b.top + b.height / 2 - cellCenter) < 2.5;

      // Height available for all lines.
      const avail = inCell
        ? vCentered
          ? cell.bottom! - cell.top! - 2 // re-centred in the cell, so the whole cell is usable
          : cell.bottom! - b.top - 1
        : b.height + roomBelow(b, all, page.height);

      const fits = (size: number, lines: string[]) => blockH(size, lines.length) <= avail + 0.5;

      let size = b.size;
      let lines = wrap(text, cssFont(spec, size), maxW);
      // Shrink in small steps only if the text cannot fit at the original size.
      while (!fits(size, lines) && size > b.size * 0.6) {
        size *= 0.97;
        lines = wrap(text, cssFont(spec, size), maxW);
      }
      // Text that was vertically centred in its cell stays centred when its line count changes.
      const y = vCentered ? cellCenter - blockH(size, lines.length) / 2 + ascent * size : first.baseline;

      return [{
        type: 'text',
        id: uid(),
        x: b.anchor,
        align: b.align,
        stdFont: opts.font === 'auto' ? first.stdFont : undefined,
        y,
        text: lines.join('\n'),
        fontSize: Math.round(size * 100) / 100,
        lineHeight: lhMult,
        color: colors[i].fg,
        font: spec.font,
        bold: spec.bold,
        italic: spec.italic,
        fontRef,
        cover: { x: b.x - 1, y: b.top - 1, w: b.width + 2, h: b.height + 2, color: colors[i].bg },
        translatedFrom: { text: b.text, source: opts.source, target: opts.target, machine: lines.join(' ') },
      }];
    });
    results.set(pageId, anns);
    count += anns.length;
  }

  opts.onProgress?.(opts.pageIds.length, opts.pageIds.length);
  if (count) {
    const s = useStore.getState();
    // A version to come back to, then the translation itself (one undo reverts it).
    s.saveVersion('Before translation');
    s.commit((pages) => pages.map((p) => (results.has(p.id) ? { ...p, annotations: [...p.annotations, ...results.get(p.id)!] } : p)));
    s.addTag(`Translated ${opts.source === 'auto' ? '' : opts.source.toUpperCase() + ' → '}${opts.target.toUpperCase()}`);
  }
  return { blocks: count, provider: providerName };
}
