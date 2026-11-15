import { getTextLines, type PDFDocumentProxy } from './pdf';
import { useStore } from './store';
import type { Page } from './types';

/**
 * Detects a document's language from its own text, offline and instantly, so the Translate
 * dialog can offer the right direction (a Bulgarian invoice → English, an English one →
 * Bulgarian). Script decides most cases; within Cyrillic and Latin, letters that only one
 * language uses and its most common short words decide the rest.
 */

// Short, very frequent words that are distinctive per language (lower case).
const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'of', 'to', 'for', 'is', 'with', 'on', 'this', 'that', 'by', 'are', 'from', 'your', 'you', 'date', 'total', 'invoice'],
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'mit', 'für', 'von', 'den', 'ein', 'eine', 'zu', 'auf', 'rechnung', 'datum'],
  fr: ['le', 'la', 'les', 'et', 'des', 'est', 'une', 'du', 'pour', 'dans', 'que', 'avec', 'sur', 'facture', 'nous'],
  es: ['el', 'los', 'las', 'y', 'del', 'que', 'por', 'una', 'con', 'para', 'es', 'factura', 'fecha'],
  it: ['il', 'di', 'che', 'e', 'della', 'per', 'una', 'con', 'sono', 'gli', 'fattura', 'del'],
  pt: ['o', 'os', 'as', 'e', 'do', 'da', 'que', 'em', 'para', 'com', 'uma', 'não', 'fatura'],
  nl: ['de', 'het', 'een', 'en', 'van', 'is', 'dat', 'op', 'te', 'voor', 'met', 'factuur'],
  pl: ['i', 'w', 'na', 'się', 'z', 'do', 'że', 'jest', 'nie', 'oraz', 'faktura', 'dla'],
  cs: ['a', 'v', 'se', 'na', 'je', 'že', 'pro', 'do', 'jsou', 'faktura', 'není'],
  ro: ['și', 'de', 'la', 'în', 'cu', 'pe', 'nu', 'este', 'factura', 'pentru', 'să'],
  tr: ['ve', 'bir', 'bu', 'için', 'ile', 'da', 'de', 'olarak', 'fatura', 'tarih'],
};

// Letters that occur in one Latin-script language and (almost) no other in our list.
const LATIN_MARKS: [RegExp, string][] = [
  [/[ßäöü]/g, 'de'],
  [/[ąęłńśźż]/g, 'pl'],
  [/[ěřůť]/g, 'cs'],
  [/[ășțâî]/g, 'ro'],
  [/[ğışİ]/g, 'tr'],
  [/[ãõ]/g, 'pt'],
  [/[ñ¿¡]/g, 'es'],
  [/[èàùœç]/g, 'fr'],
];

// Cyrillic letters that only one of these languages uses.
const CYRILLIC_MARKS: [RegExp, string][] = [
  [/[ыэё]/gi, 'ru'],
  [/[іїєґ]/gi, 'uk'],
  [/[ђћ]/gi, 'sr'],
  [/[ѓќѕ]/gi, 'mk'],
  [/[ѝ]/gi, 'bg'],
];

const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

/** Best-guess language code for a piece of text, or null when there's too little to tell. */
export function detectText(text: string): string | null {
  const cyr = count(text, /\p{Script=Cyrillic}/gu);
  const lat = count(text, /\p{Script=Latin}/gu);
  const grk = count(text, /\p{Script=Greek}/gu);
  const kana = count(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const han = count(text, /\p{Script=Han}/gu);
  const total = cyr + lat + grk + kana + han;
  if (total < 12) return null;

  if (kana > total * 0.05) return 'ja';
  if (han > total * 0.3) return 'zh';
  if (grk > total * 0.4) return 'el';

  if (cyr >= lat) {
    let best = 'bg';
    let bestN = 0;
    for (const [re, lang] of CYRILLIC_MARKS) {
      const n = count(text, re);
      if (n > bestN) [best, bestN] = [lang, n];
    }
    // "ъ" is very common in Bulgarian and rare elsewhere: a strong tie-breaker.
    if (best !== 'bg' && count(text, /ъ/gi) > bestN * 3) best = 'bg';
    return best;
  }

  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const scores: Record<string, number> = {};
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    scores[lang] = words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
  }
  const lower = text.toLowerCase();
  for (const [re, lang] of LATIN_MARKS) scores[lang] = (scores[lang] ?? 0) + count(lower, re) * 0.5;
  const [best, n] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  // Invoices are often mostly names and numbers: without clear evidence, Latin means English.
  return n >= 2 && best !== 'en' && n > (scores.en ?? 0) * 1.5 ? best : 'en';
}

/** The language a translation into `source` should usually go to: Bulgarian ⇄ English, others → English. */
export function oppositeOf(source: string) {
  return source === 'bg' ? 'en' : source === 'en' ? 'bg' : 'en';
}

/**
 * Text as it currently reads on these pages: edited/translated blocks plus original lines that
 * no edit covers. Looks at up to `maxPages` pages, which is plenty to tell the language.
 */
async function visibleText(pages: Page[], sources: { doc: PDFDocumentProxy }[], maxPages = 3) {
  const parts: string[] = [];
  for (const p of pages.slice(0, maxPages)) {
    const covers = p.annotations.flatMap((a) => (a.type === 'text' && a.cover ? [a.cover] : []));
    for (const a of p.annotations) if (a.type === 'text') parts.push(a.text);
    if (!p.source) continue;
    const lines = await getTextLines(sources[p.source.file].doc, p.source.index).catch(() => []);
    for (const l of lines) {
      const cx = l.x + l.width / 2;
      const cy = l.top + l.height / 2;
      if (!covers.some((c) => cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h)) parts.push(l.str);
    }
  }
  return parts.join(' ');
}

/** Detects the language of the open document (or of the given pages). */
export async function detectDocument(pageIds?: string[]): Promise<string | null> {
  const { pages, sources } = useStore.getState();
  const chosen = pageIds ? pages.filter((p) => pageIds.includes(p.id)) : pages;
  return detectText(await visibleText(chosen, sources));
}
