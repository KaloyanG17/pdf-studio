import Anthropic from '@anthropic-ai/sdk';

export const LANGUAGES: Record<string, string> = {
  bg: 'Bulgarian',
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  cs: 'Czech',
  ro: 'Romanian',
  el: 'Greek',
  tr: 'Turkish',
  ru: 'Russian',
  uk: 'Ukrainian',
  sr: 'Serbian',
  mk: 'Macedonian',
  zh: 'Chinese',
  ja: 'Japanese',
};

export interface TranslationProvider {
  readonly name: string;
  /** source may be 'auto'. Must return exactly one output per input, same order. */
  translate(texts: string[], source: string, target: string): Promise<string[]>;
}

/** Split an array of texts into batches limited by count and total characters. */
function batches(texts: string[], maxItems: number, maxChars: number): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  let chars = 0;
  texts.forEach((t, i) => {
    if (cur.length && (cur.length >= maxItems || chars + t.length > maxChars)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(i);
    chars += t.length;
  });
  if (cur.length) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- DeepL
const DEEPL_TARGET: Record<string, string> = { en: 'EN-US', pt: 'PT-PT', zh: 'ZH-HANS' };
const DEEPL_UNSUPPORTED = new Set(['sr', 'mk']);

export class DeepLProvider implements TranslationProvider {
  readonly name = 'DeepL';
  constructor(private readonly key: string) {}

  async translate(texts: string[], source: string, target: string): Promise<string[]> {
    if (DEEPL_UNSUPPORTED.has(target)) throw new Error(`DeepL does not support ${LANGUAGES[target] ?? target}`);
    const host = this.key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const result: string[] = new Array(texts.length);
    for (const idx of batches(texts, 50, 100_000)) {
      const body: Record<string, unknown> = {
        text: idx.map((i) => texts[i]),
        target_lang: DEEPL_TARGET[target] ?? target.toUpperCase(),
        preserve_formatting: true,
      };
      if (source !== 'auto') body.source_lang = source.toUpperCase();
      const res = await fetch(`${host}/v2/translate`, {
        method: 'POST',
        headers: { Authorization: `DeepL-Auth-Key ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`DeepL error ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { translations: { text: string }[] };
      idx.forEach((i, k) => (result[i] = json.translations[k]?.text ?? texts[i]));
    }
    return result;
  }
}

// ---------------------------------------------------------------- Claude
export class ClaudeProvider implements TranslationProvider {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
    this.name = `Claude (${model})`;
  }

  async translate(texts: string[], source: string, target: string): Promise<string[]> {
    const result: string[] = new Array(texts.length);
    const from = source === 'auto' ? 'the source language (detect it)' : LANGUAGES[source] ?? source;
    const to = LANGUAGES[target] ?? target;

    for (const idx of batches(texts, 80, 12_000)) {
      const input = idx.map((i) => texts[i]);
      const params = {
        model: this.model,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: { translations: { type: 'array', items: { type: 'string' } } },
              required: ['translations'],
              additionalProperties: false,
            },
          },
        },
        system:
          `You are a professional document translator. Translate each string from ${from} into ${to}. ` +
          'The strings are text blocks extracted from a PDF, in reading order; use neighbouring blocks as context. ' +
          'Return exactly one translation per input string, in the same order. Keep numbers, codes, URLs, emails and proper names intact. ' +
          'If a string is already in the target language or has nothing to translate, return it unchanged. Do not add notes.',
        messages: [{ role: 'user', content: JSON.stringify({ strings: input }) }],
      };
      // `fallbacks` / string `effort` may be newer than the installed SDK typings.
      const stream = this.client.beta.messages.stream(params as never);
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') throw new Error('Claude declined to translate this content');
      if (msg.stop_reason === 'max_tokens') throw new Error('Claude response was cut off (batch too large)');
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      const parsed = JSON.parse(text) as { translations: string[] };
      idx.forEach((i, k) => (result[i] = parsed.translations[k] ?? texts[i]));
    }
    return result;
  }
}

// ---------------------------------------------------------------- MyMemory (free, no key)
export class MyMemoryProvider implements TranslationProvider {
  readonly name = 'MyMemory (free)';
  constructor(private readonly email?: string) {}

  /** MyMemory accepts at most 500 bytes per request, so split on sentence / word boundaries. */
  private chunk(text: string): string[] {
    const max = 450;
    if (Buffer.byteLength(text) <= max) return [text];
    const parts = text.match(/[^.!?;:\n]+[.!?;:\n]*\s*/g) ?? [text];
    const out: string[] = [];
    let cur = '';
    const push = (s: string) => {
      if (Buffer.byteLength(cur + s) > max && cur) {
        out.push(cur);
        cur = '';
      }
      cur += s;
    };
    for (const p of parts) {
      if (Buffer.byteLength(p) <= max) push(p);
      else for (const w of p.split(/(?<=\s)/)) push(w);
    }
    if (cur) out.push(cur);
    return out;
  }

  private async one(text: string, source: string, target: string): Promise<string> {
    if (!text.trim()) return text;
    const pieces = this.chunk(text);
    const out: string[] = [];
    for (const piece of pieces) {
      const url = new URL('https://api.mymemory.translated.net/get');
      url.searchParams.set('q', piece);
      url.searchParams.set('langpair', `${source === 'auto' ? 'Autodetect' : source}|${target}`);
      if (this.email) url.searchParams.set('de', this.email);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`MyMemory error ${res.status}`);
      const json = (await res.json()) as { responseStatus: number | string; responseData?: { translatedText?: string }; responseDetails?: string };
      // Auto-detected source equals the target: nothing to translate.
      if (/DISTINCT LANGUAGES/i.test(json.responseDetails ?? '')) {
        out.push(piece);
        continue;
      }
      if (Number(json.responseStatus) !== 200) throw new Error(`MyMemory: ${json.responseDetails ?? 'translation failed'}`);
      out.push(json.responseData?.translatedText ?? piece);
    }
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }

  async translate(texts: string[], source: string, target: string): Promise<string[]> {
    const result: string[] = new Array(texts.length);
    let next = 0;
    const worker = async () => {
      while (next < texts.length) {
        const i = next++;
        result[i] = await this.one(texts[i], source, target);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
    return result;
  }
}
