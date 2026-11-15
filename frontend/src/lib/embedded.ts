import fontkit from '@pdf-lib/fontkit';
import type { FontFamily } from './types';

/**
 * Fonts taken from the opened PDFs (pdf.js converts every embedded font to OpenType).
 * They are registered with the browser so edited text renders in the *original* font,
 * and sent to the server on export so the file uses it too.
 */
export interface EmbeddedFont {
  ref: string;
  css: string; // CSS family name
  name: string; // PostScript name from the PDF, e.g. "ABCDEF+TimesNewRomanPS-BoldMT"
  data: Uint8Array;
  bold: boolean;
  italic: boolean;
  fallback: FontFamily;
  ascent: number; // em units
  descent: number; // em units, positive
  has(cp: number): boolean;
}

const registry = new Map<string, EmbeddedFont>();

export const getEmbedded = (ref: string | undefined) => (ref ? registry.get(ref) : undefined);
export const allEmbedded = () => registry;
export function clearEmbedded() {
  registry.clear();
}

/** Metric-compatible substitute for a PDF font name. */
export function fallbackFor(name: string, generic = ''): FontFamily {
  const n = name.toLowerCase().replace(/^[a-z]{6}\+/, '');
  if (/mono|courier|consol|menlo/.test(n) || generic.includes('mono')) return 'mono';
  if (/calibri|carlito|candara|corbel/.test(n)) return 'carlito';
  if (/verdana|tahoma|dejavu|bitstream/.test(n)) return 'dejavu';
  if (/sans|arial|helvetica|arimo|segoe|roboto|open|noto ?sans|liberationsans|frutiger|myriad|futura|gill/.test(n)) return 'sans';
  if (/serif|times|roman|georgia|garamond|cambria|book|minion|palatino|tinos|baskerville|caslon|caladea/.test(n)) return 'serif';
  if (generic.includes('sans')) return 'sans';
  if (generic.includes('serif')) return 'serif';
  return 'sans';
}

export function styleFromName(name: string) {
  const n = name.toLowerCase();
  return { bold: /bold|black|heavy|semibold|demi|w[6-9]\b/.test(n), italic: /italic|oblique|-it\b|ital/.test(n) };
}

/** Registers a pdf.js font object (needs getDocument({ fontExtraProperties: true })). */
export async function registerEmbedded(ref: string, fontObj: unknown, generic: string): Promise<EmbeddedFont | undefined> {
  const existing = registry.get(ref);
  if (existing) return existing;
  const o = fontObj as { name?: string; data?: Uint8Array; isType3Font?: boolean; missingFile?: boolean; bold?: boolean; black?: boolean; italic?: boolean };
  if (!o?.data || o.isType3Font || o.missingFile) return undefined;
  const name = o.name ?? ref;
  let parsed: { hasGlyphForCodePoint(cp: number): boolean; ascent: number; descent: number; unitsPerEm: number };
  try {
    parsed = fontkit.create(o.data as never) as never;
  } catch {
    return undefined;
  }
  const st = styleFromName(name);
  const bold = st.bold || !!o.bold || !!o.black;
  const italic = st.italic || !!o.italic;
  const css = `pdffont-${ref.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const face = new FontFace(css, o.data.slice().buffer, { weight: bold ? '700' : '400', style: italic ? 'italic' : 'normal' });
  try {
    await face.load(); // must be ready before we measure with it
  } catch {
    return undefined;
  }
  document.fonts.add(face);
  const f: EmbeddedFont = {
    ref,
    css,
    name,
    data: o.data,
    bold,
    italic,
    fallback: fallbackFor(name, generic),
    ascent: parsed.ascent / parsed.unitsPerEm || 0.9,
    descent: Math.abs(parsed.descent / parsed.unitsPerEm) || 0.22,
    has: (cp) => parsed.hasGlyphForCodePoint(cp),
  };
  registry.set(ref, f);
  return f;
}

/** True when the original font has a glyph for every visible character (same rule as the server). */
export function covers(ref: string | undefined, text: string): boolean {
  const f = getEmbedded(ref);
  if (!f) return false;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    if (!f.has(ch.codePointAt(0)!)) return false;
  }
  return true;
}
