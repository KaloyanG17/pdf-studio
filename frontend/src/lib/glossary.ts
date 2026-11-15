import type { Page } from './types';

/**
 * Glossary: terms that must always translate a fixed way (or stay unchanged).
 * Translation memory: translations you corrected, reused instead of asking the engine again.
 * Both live in localStorage, on this computer.
 */
export interface GlossaryEntry {
  term: string;
  /** Empty = keep the term exactly as written. */
  translation: string;
}

const GKEY = 'pdf-studio-glossary';
const MKEY = 'pdf-studio-memory';

export function getGlossary(): GlossaryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(GKEY) ?? '[]');
  } catch {
    return [];
  }
}
export function setGlossary(entries: GlossaryEntry[]) {
  localStorage.setItem(GKEY, JSON.stringify(entries.filter((e) => e.term.trim())));
}

type Memory = Record<string, string>;
const memKey = (source: string, target: string, text: string) => `${source}|${target}|${text.replace(/\s+/g, ' ').trim()}`;
function memory(): Memory {
  try {
    return JSON.parse(localStorage.getItem(MKEY) ?? '{}');
  } catch {
    return {};
  }
}
export function recall(source: string, target: string, text: string): string | undefined {
  return memory()[memKey(source, target, text)];
}
export function remember(source: string, target: string, text: string, translation: string) {
  const m = memory();
  m[memKey(source, target, text)] = translation;
  localStorage.setItem(MKEY, JSON.stringify(m));
}
export const memorySize = () => Object.keys(memory()).length;
export function clearMemory() {
  localStorage.removeItem(MKEY);
}

/** Learns from your corrections: translated blocks whose text you changed afterwards. */
export function learnFrom(pages: Page[]) {
  for (const p of pages)
    for (const a of p.annotations) {
      if (a.type !== 'text' || !a.translatedFrom) continue;
      const now = a.text.replace(/\s+/g, ' ').trim();
      const { text, source, target, machine } = a.translatedFrom;
      if (now && now !== machine.replace(/\s+/g, ' ').trim() && source !== 'auto') remember(source, target, text, now);
    }
}

// ------------------------------------------------------------------ term protection

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces glossary terms with placeholders the engine leaves alone. */
export function protect(text: string, entries: GlossaryEntry[]) {
  const used: GlossaryEntry[] = [];
  let out = text;
  // Longest terms first so "Sephora UK" wins over "Sephora".
  for (const e of [...entries].sort((a, b) => b.term.length - a.term.length)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(e.term)}(?![\\p{L}\\p{N}])`, 'giu');
    if (!re.test(out)) continue;
    const n = used.push(e) - 1;
    out = out.replace(re, `⟦${n}⟧`);
  }
  return { text: out, used };
}

export function restore(text: string, used: GlossaryEntry[]) {
  const seen = new Set<number>();
  let out = text.replace(/⟦\s*(\d+)\s*⟧/g, (_, n) => {
    const e = used[+n];
    seen.add(+n);
    return e ? e.translation || e.term : '';
  });
  used.forEach((e, n) => {
    const want = e.translation || e.term;
    // The engine kept the term itself instead of the placeholder: still apply the glossary.
    if (e.translation && out.includes(e.term)) out = out.split(e.term).join(e.translation);
    // The engine dropped the placeholder entirely: put the term back rather than lose it.
    else if (!seen.has(n) && !out.includes(want)) out = `${out.trim()} ${want}`;
  });
  return normalizePunctuation(out);
}

/** Some engines return full-width punctuation (：，；) in Latin/Cyrillic text. */
const normalizePunctuation = (s: string) => s.replace(/：/g, ':').replace(/，/g, ',').replace(/；/g, ';').replace(/\s+([:,;])/g, '$1');

const DATE_ANY = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})(\s*г\.)?/g;

/**
 * Engines rewrite or drop dates (18.11.2024 → 11/18/2024, or gone). Put the source's dates
 * back, in order, in the target language's format; re-append any the engine dropped.
 */
export function fixDates(source: string, translated: string, target: string): string {
  const src = [...source.matchAll(DATE_ANY)].map((m) => localizeFormats(m[0], target));
  if (!src.length) return translated;
  let i = 0;
  let out = translated.replace(DATE_ANY, (m) => (i < src.length ? src[i++] : m));
  while (i < src.length) out = `${out.trim()} ${src[i++]}`;
  return out;
}

// ------------------------------------------------------------------ formats

/** Converts dates to the target language's convention (18/11/2024 ⇄ 18.11.2024 г.). */
export function localizeFormats(text: string, target: string) {
  if (target === 'bg' || target === 'ru' || target === 'de' || target === 'uk' || target === 'pl' || target === 'cs') {
    const suffix = target === 'bg' ? ' г.' : '';
    return text.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b(?!\s*г\.)/g, (_, d, m, y) => `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}${suffix}`);
  }
  if (target === 'en' || target === 'fr' || target === 'es' || target === 'it' || target === 'pt') {
    return text.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})(\s*г\.)?/g, (_, d, m, y) => `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`);
  }
  return text;
}

/** True for text that is only a date (nothing to translate, but the format can change). */
export const isDateOnly = (s: string) => /^\s*\d{1,2}[./]\d{1,2}[./]\d{4}(\s*г\.)?\s*$/.test(s);
