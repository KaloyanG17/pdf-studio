import { covers, getEmbedded } from './embedded';
import type { FontFamily, TextAnnotation } from './types';

/** Substitute fonts served by the backend (same files are embedded on export). */
export const FAMILIES: { id: FontFamily; label: string; css: string; ascent: number; descent: number }[] = [
  { id: 'sans', label: 'Arial / Helvetica', css: 'PS Sans', ascent: 0.905, descent: 0.212 },
  { id: 'serif', label: 'Times New Roman', css: 'PS Serif', ascent: 0.891, descent: 0.216 },
  { id: 'carlito', label: 'Calibri', css: 'PS Carlito', ascent: 0.952, descent: 0.269 },
  { id: 'mono', label: 'Courier', css: 'PS Mono', ascent: 0.833, descent: 0.3 },
  { id: 'dejavu', label: 'Verdana-like', css: 'PS DejaVu', ascent: 0.928, descent: 0.236 },
];
const FAM = Object.fromEntries(FAMILIES.map((f) => [f.id, f])) as Record<FontFamily, (typeof FAMILIES)[number]>;

/** Bump when the font files change, so browsers do not keep stale cached copies. */
const FONT_VERSION = 2;

let loading: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  if (loading) return loading;
  const jobs: Promise<void>[] = [];
  for (const f of FAMILIES)
    for (const [suffix, weight, style] of [
      ['', '400', 'normal'],
      ['-b', '700', 'normal'],
      ['-i', '400', 'italic'],
      ['-bi', '700', 'italic'],
    ] as const) {
      const face = new FontFace(f.css, `url(/api/fonts/${f.id}${suffix}?v=${FONT_VERSION})`, { weight, style });
      jobs.push(face.load().then((ff) => void document.fonts.add(ff)));
    }
  loading = Promise.all(jobs).then(
    () => undefined,
    (e) => {
      loading = null; // allow a retry (e.g. backend was still starting)
      throw e;
    },
  );
  return loading;
}

type FontSpec = Pick<TextAnnotation, 'font' | 'bold' | 'italic' | 'fontRef' | 'text'>;

/** Whether the annotation renders with the font taken from the original PDF. */
export const usesOriginal = (a: FontSpec) => !!a.fontRef && covers(a.fontRef, a.text ?? '');

/** CSS font-family value for an annotation (original font when it covers the text). */
export function cssFamily(a: FontSpec): string {
  const sub = `"${FAM[a.font ?? 'sans']?.css ?? 'PS Sans'}"`;
  return usesOriginal(a) ? `"${getEmbedded(a.fontRef)!.css}", ${sub}` : sub;
}

export function cssFont(a: FontSpec, size: number) {
  return `${a.italic ? 'italic ' : ''}${a.bold ? 'bold ' : ''}${size}px ${cssFamily(a)}`;
}

/** Ascent / descent (em) of the font the annotation actually renders with. */
export function metrics(a: FontSpec): { ascent: number; descent: number } {
  if (usesOriginal(a)) {
    const e = getEmbedded(a.fontRef)!;
    return { ascent: e.ascent, descent: e.descent };
  }
  const f = FAM[a.font ?? 'sans'] ?? FAM.sans;
  return { ascent: f.ascent, descent: f.descent };
}

const ctx = document.createElement('canvas').getContext('2d')!;

export function measure(text: string, font: string): number {
  ctx.font = font;
  // PDFs never kern implicitly, so neither do we (keeps widths identical to the export).
  (ctx as CanvasRenderingContext2D & { fontKerning?: string }).fontKerning = 'none';
  return ctx.measureText(text).width;
}

/** Advance width of one line including the original's word / letter spacing (matches the export). */
export function lineWidth(a: TextAnnotation, line: string): number {
  const spaces = (line.match(/ /g) ?? []).length;
  return measure(line, cssFont(a, a.fontSize)) + spaces * (a.wordSpacing ?? 0) + [...line].length * (a.charSpacing ?? 0);
}

export function lineWidths(a: TextAnnotation): number[] {
  return a.text.split('\n').map((l) => lineWidth(a, l));
}

/** Box of a text annotation in points (y = first baseline, so the box starts above it). */
export function textBox(a: TextAnnotation): { x: number; y: number; w: number; h: number } {
  const n = a.text.split('\n').length;
  const lh = a.fontSize * (a.lineHeight ?? 1.2);
  const { ascent, descent } = metrics(a);
  const w = Math.max(a.fontSize * 0.5, ...lineWidths(a));
  return { x: boxLeft(a, w), y: a.y - ascent * a.fontSize, w, h: (n - 1) * lh + (ascent + descent) * a.fontSize };
}

/** Left edge of a text box: x is its anchor (left edge, centre or right edge, by alignment). */
export function boxLeft(a: Pick<TextAnnotation, 'x' | 'align'>, width: number) {
  return a.align === 'center' ? a.x - width / 2 : a.align === 'right' ? a.x - width : a.x;
}

/** Greedy word wrap to a max width; returns lines. */
export function wrap(text: string, font: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && measure(next, font) > maxWidth) {
        out.push(cur);
        cur = w;
      } else cur = next;
    }
    out.push(cur);
  }
  return out;
}
