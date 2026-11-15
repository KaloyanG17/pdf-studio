import { createWorker, type Worker } from 'tesseract.js';
import { assignAlignment, getPage, hasTextLayer, setOcrLines, type PDFDocumentProxy, type TextLine } from './pdf';
import { useStore } from './store';
import type { OcrLine } from './types';

/**
 * OCR for scanned pages, fully local: the engine and the Bulgarian + English models are
 * served by our own backend, nothing is sent anywhere. Recognised lines become the page's
 * text, so editing, find & replace and translation work on scans too.
 */
const SCALE = 3; // render at ~216 dpi: good accuracy for invoice-sized text

let workerP: Promise<Worker> | null = null;
let progress: ((p: number) => void) | undefined;
function worker() {
  return (workerP ??= createWorker(['bul', 'eng'], 1, {
    workerPath: '/vendor/ocr/worker/worker.min.js',
    corePath: '/vendor/ocr/core',
    langPath: '/vendor/ocr/lang',
    gzip: true,
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') progress?.(m.progress);
    },
  }).catch((e) => {
    workerP = null;
    throw e;
  }));
}

// Latin letters that look identical to Cyrillic ones. Bulgarian OCR often returns e.g. "Ha" for "на".
const LAT2CYR: Record<string, string> = {
  A: 'А', a: 'а', B: 'В', C: 'С', c: 'с', E: 'Е', e: 'е', H: 'Н', K: 'К', k: 'к', M: 'М',
  O: 'О', o: 'о', P: 'Р', p: 'р', T: 'Т', X: 'Х', x: 'х', y: 'у',
};
const isCyr = (ch: string) => /\p{Script=Cyrillic}/u.test(ch);

/** In a mostly-Cyrillic run, words written only with look-alike Latin letters are Cyrillic. */
export function fixScript(words: string[]): string[] {
  const letters = words.join('').replace(/[^\p{L}]/gu, '');
  const cyr = [...letters].filter(isCyr).length;
  if (cyr < letters.length * 0.5) return words;
  return words.map((w, i) => {
    const core = w.replace(/[^\p{L}]/gu, '');
    if (!core || [...core].some(isCyr) || ![...core].every((ch) => LAT2CYR[ch])) return w;
    let out = [...w].map((ch) => LAT2CYR[ch] ?? ch).join('');
    // Cyrillic "н", "т", "к"… are small capitals in shape, so OCR reports them upper-case:
    // mid-sentence, after a lower-case word, the word is lower-case.
    const prev = words[i - 1];
    if (prev && /\p{Ll}[,;:]?$/u.test(prev) && /^\p{Lu}\p{Ll}*$/u.test(out.replace(/[^\p{L}]/gu, ''))) out = out.toLowerCase();
    return out;
  });
}

/** Converts OCR'd lines (stored on the page) into the TextLine shape every tool understands. */
export function ocrToTextLines(lines: OcrLine[]): TextLine[] {
  const out: TextLine[] = lines.map((l) => ({
    ...l,
    family: 'sans',
    bold: false,
    italic: false,
    ascent: 0.905,
    wordSpacing: 0,
    charSpacing: 0,
    align: 'left',
    anchor: l.x,
    css: `${l.size}px "PS Sans"`,
  }));
  assignAlignment(out, 2.5);
  return out.sort((a, b) => a.top - b.top || a.x - b.x);
}

export function registerOcr(doc: PDFDocumentProxy, index: number, lines: OcrLine[]) {
  setOcrLines(doc, index, ocrToTextLines(lines));
}

// Letters that reach cap height (capitals, digits, ascenders). Text without any of them is
// measured from its x-height instead.
const TALL = /[A-ZА-Я0-9bdfhkltбдйфЁё]/u;

/**
 * Measures a text run from the page's ink (pixels): the baseline is the bottom of the dense
 * band of letters (only descenders hang below it); the size follows from cap or x-height.
 */
function inkMetrics(ink: Uint8Array, W: number, ws: { bbox: { x0: number; y0: number; x1: number; y1: number } }[], text: string) {
  const x0 = Math.max(0, Math.min(...ws.map((w) => w.bbox.x0)));
  const x1 = Math.min(W - 1, Math.max(...ws.map((w) => w.bbox.x1)));
  const y0 = Math.max(0, Math.min(...ws.map((w) => w.bbox.y0)) - 2);
  const y1 = Math.max(...ws.map((w) => w.bbox.y1)) + 2;
  const rows: number[] = [];
  for (let y = y0; y <= y1; y++) {
    let n = 0;
    for (let x = x0; x <= x1; x++) n += ink[y * W + x] ?? 0;
    rows.push(n);
  }
  const max = Math.max(1, ...rows);
  // Dense band = x-height zone. Baseline = last row of the band; top = first row with any ink.
  let bandTop = rows.findIndex((n) => n >= max * 0.45);
  let bandBot = rows.length - 1 - [...rows].reverse().findIndex((n) => n >= max * 0.45);
  if (bandTop < 0) bandTop = 0;
  if (bandBot < bandTop) bandBot = bandTop;
  const inkTop = rows.findIndex((n) => n >= max * 0.04);
  const baseline = y0 + bandBot + 1;
  const tall = TALL.test(text);
  const height = tall ? baseline - (y0 + Math.max(0, inkTop)) : baseline - (y0 + bandTop);
  // Cap height is ≈ 0.66 em in Times-like fonts and ≈ 0.72 em in Arial-like ones; a scan can't
  // tell which, so use the middle (≤ 5 % off either way). x-height ≈ 0.48 em likewise.
  const size = Math.max(4 * SCALE, height / (tall ? 0.69 : 0.48));
  return { baseline, size };
}

async function recognizePage(doc: PDFDocumentProxy, index: number): Promise<OcrLine[]> {
  const page = await getPage(doc, index);
  const vp = page.getViewport({ scale: SCALE });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width);
  c.height = Math.ceil(vp.height);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, viewport: vp, intent: 'print' }).promise;
  const w = await worker();
  const { data } = await w.recognize(c, {}, { blocks: true });
  // Ink map of the page (1 = dark pixel), used to measure each line's baseline and size.
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const ink = new Uint8Array(c.width * c.height);
  for (let i = 0; i < ink.length; i++) ink[i] = px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] < 3 * 140 ? 1 : 0;

  const out: OcrLine[] = [];
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines) {
        const words = line.words.filter((wd) => wd.text.trim() && wd.confidence > 30);
        if (!words.length) continue;
        // OCR word boxes are padded and neighbouring columns can share one OCR row, so each
        // column piece is measured from the scan's own pixels.
        const metricsOf = (ws: typeof words) => inkMetrics(ink, c.width, ws, ws.map((wd) => wd.text).join(' '));
        const lineSize = metricsOf(words).size;
        // Split at tab-sized gaps, like real text, so table columns stay separate.
        let run = [words[0]];
        const flush = () => {
          const x0 = run[0].bbox.x0;
          const x1 = run[run.length - 1].bbox.x1;
          const m = metricsOf(run);
          const baseline = m.baseline / SCALE;
          const size = m.size / SCALE;
          out.push({
            str: fixScript(run.map((wd) => wd.text)).join(' '),
            x: x0 / SCALE,
            width: (x1 - x0) / SCALE,
            baseline,
            size,
            top: baseline - size * 0.905,
            height: size * 1.17,
          });
        };
        for (let k = 1; k < words.length; k++) {
          if (words[k].bbox.x0 - words[k - 1].bbox.x1 > lineSize * 1.2) {
            flush();
            run = [words[k]];
          } else run.push(words[k]);
        }
        flush();
      }
  return out;
}

/** Recognises every page without a text layer. Returns how many pages were recognised. */
export async function runOcr(onProgress?: (msg: string) => void): Promise<number> {
  const s = useStore.getState();
  const targets: { id: string; doc: PDFDocumentProxy; index: number; n: number }[] = [];
  for (const [n, p] of s.pages.entries()) {
    if (!p.source || p.ocr) continue;
    const doc = s.sources[p.source.file].doc;
    if (!(await hasTextLayer(doc, p.source.index))) targets.push({ id: p.id, doc, index: p.source.index, n: n + 1 });
  }
  const results = new Map<string, OcrLine[]>();
  for (const [k, t] of targets.entries()) {
    progress = (p) => onProgress?.(`Reading page ${t.n} (${k + 1} of ${targets.length}) · ${Math.round(p * 100)}%`);
    onProgress?.(`Reading page ${t.n} (${k + 1} of ${targets.length})`);
    const lines = await recognizePage(t.doc, t.index);
    registerOcr(t.doc, t.index, lines);
    results.set(t.id, lines);
  }
  progress = undefined;
  if (results.size) {
    s.commit((pages) => pages.map((p) => (results.has(p.id) ? { ...p, ocr: results.get(p.id) } : p)));
    s.addTag('OCR');
  }
  return results.size;
}
