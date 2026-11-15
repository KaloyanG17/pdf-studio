/**
 * True removal of covered text.
 *
 * Covering text with a patch only hides it: the original glyphs stay in the file and can still be
 * copied, searched or extracted. This module rewrites a page's content stream instead: it tracks
 * where every glyph is drawn and drops the glyphs whose centre lies inside a cover rectangle.
 * Each dropped run is replaced by a TJ position adjustment of exactly the same advance, so any
 * text that follows on the same line keeps its exact position.
 */
import { Encodings, Font, FontNames } from '@pdf-lib/standard-fonts';
import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';

/** Axis-aligned rectangle in PDF user space. */
export interface UserRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: M, x: number, y: number) => ({ x: x * m[0] + y * m[2] + m[4], y: x * m[1] + y * m[3] + m[5] });

// ------------------------------------------------------------------ lexer

type Tok =
  | { t: 'num'; v: number; s: number; e: number }
  | { t: 'name'; v: string; s: number; e: number }
  | { t: 'str'; v: Uint8Array; s: number; e: number }
  | { t: '[' | ']' | '<<' | '>>'; s: number; e: number }
  | { t: 'op'; v: string; s: number; e: number };

const isWs = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c: number) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;

function* lex(b: Uint8Array): Generator<Tok> {
  let i = 0;
  const n = b.length;
  while (i < n) {
    const c = b[i];
    if (isWs(c)) {
      i++;
      continue;
    }
    if (c === 37) {
      // % comment
      while (i < n && b[i] !== 10 && b[i] !== 13) i++;
      continue;
    }
    const s = i;
    if (c === 47) {
      // /Name
      i++;
      while (i < n && !isWs(b[i]) && !isDelim(b[i])) i++;
      yield { t: 'name', v: Buffer.from(b.subarray(s + 1, i)).toString('latin1'), s, e: i };
      continue;
    }
    if (c === 40) {
      // (literal string)
      const out: number[] = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const ch = b[i];
        if (ch === 92) {
          const nx = b[i + 1];
          i += 2;
          if (nx === 110) out.push(10);
          else if (nx === 114) out.push(13);
          else if (nx === 116) out.push(9);
          else if (nx === 98) out.push(8);
          else if (nx === 102) out.push(12);
          else if (nx === 13) {
            if (b[i] === 10) i++; // line continuation
          } else if (nx === 10) {
            /* line continuation */
          } else if (nx >= 48 && nx <= 55) {
            let v = nx - 48;
            for (let k = 0; k < 2 && b[i] >= 48 && b[i] <= 55; k++) v = v * 8 + (b[i++] - 48);
            out.push(v & 255);
          } else out.push(nx);
          continue;
        }
        if (ch === 40) depth++;
        else if (ch === 41 && --depth === 0) {
          i++;
          break;
        }
        out.push(ch);
        i++;
      }
      yield { t: 'str', v: Uint8Array.from(out), s, e: i };
      continue;
    }
    if (c === 60 && b[i + 1] === 60) {
      i += 2;
      yield { t: '<<', s, e: i };
      continue;
    }
    if (c === 62 && b[i + 1] === 62) {
      i += 2;
      yield { t: '>>', s, e: i };
      continue;
    }
    if (c === 60) {
      // <hex string>
      i++;
      let hex = '';
      while (i < n && b[i] !== 62) {
        if (!isWs(b[i])) hex += String.fromCharCode(b[i]);
        i++;
      }
      i++;
      if (hex.length % 2) hex += '0';
      yield { t: 'str', v: Uint8Array.from(Buffer.from(hex, 'hex')), s, e: i };
      continue;
    }
    if (c === 91 || c === 93) {
      i++;
      yield { t: c === 91 ? '[' : ']', s, e: i };
      continue;
    }
    if (c === 123 || c === 125 || c === 41 || c === 62) {
      i++; // stray delimiter; ignore
      continue;
    }
    while (i < n && !isWs(b[i]) && !isDelim(b[i])) i++;
    const word = Buffer.from(b.subarray(s, i)).toString('latin1');
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      yield { t: 'num', v: parseFloat(word), s, e: i };
      continue;
    }
    yield { t: 'op', v: word, s, e: i };
    if (word === 'ID') {
      // Inline image data: binary until whitespace + "EI" + whitespace/end.
      i++;
      while (i < n && !(isWs(b[i - 1]) && b[i] === 69 && b[i + 1] === 73 && (i + 2 >= n || isWs(b[i + 2]) || isDelim(b[i + 2])))) i++;
    }
  }
}

// ------------------------------------------------------------------ fonts

interface FontInfo {
  twoByte: boolean;
  /** Glyph advance in glyph-space thousandths for a character code. */
  width(code: number): number;
  /** False when widths are unknown: the font is left untouched in that case. */
  known: boolean;
}

const STD_ALIASES: [RegExp, FontNames][] = [
  [/^(times|timesnewroman)/i, FontNames.TimesRoman],
  [/^(helvetica|arial)/i, FontNames.Helvetica],
  [/^(courier)/i, FontNames.Courier],
  [/^symbol/i, FontNames.Symbol],
  [/^zapfdingbats/i, FontNames.ZapfDingbats],
];

function standardFont(base: string): FontNames | undefined {
  const name = base.replace(/^[A-Z]{6}\+/, '').replace(/[\s_]/g, '');
  const direct = Object.values(FontNames).find((f) => f === name);
  if (direct) return direct as FontNames;
  const hit = STD_ALIASES.find(([re]) => re.test(name));
  if (!hit) return undefined;
  const bold = /bold|black|heavy/i.test(name);
  const ital = /italic|oblique/i.test(name);
  switch (hit[1]) {
    case FontNames.TimesRoman:
      return bold && ital ? FontNames.TimesRomanBoldItalic : bold ? FontNames.TimesRomanBold : ital ? FontNames.TimesRomanItalic : FontNames.TimesRoman;
    case FontNames.Helvetica:
      return bold && ital ? FontNames.HelveticaBoldOblique : bold ? FontNames.HelveticaBold : ital ? FontNames.HelveticaOblique : FontNames.Helvetica;
    case FontNames.Courier:
      return bold && ital ? FontNames.CourierBoldOblique : bold ? FontNames.CourierBold : ital ? FontNames.CourierOblique : FontNames.Courier;
    default:
      return hit[1];
  }
}

const codeToName = (enc: (typeof Encodings)[keyof typeof Encodings]) => {
  const map = new Map<number, string>();
  for (const [code, name] of Object.values((enc as unknown as { unicodeMappings: Record<number, [number, string]> }).unicodeMappings))
    if (!map.has(code)) map.set(code, name);
  return map;
};
const WIN_ANSI = codeToName(Encodings.WinAnsi);

function num(ctx: PDFContext, o: PDFObject | undefined): number | undefined {
  const v = o instanceof PDFRef ? ctx.lookup(o) : o;
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

function loadFont(ctx: PDFContext, dict: PDFDict): FontInfo {
  const subtype = dict.lookup(PDFName.of('Subtype'), PDFName)?.decodeText();
  const base = dict.lookupMaybe(PDFName.of('BaseFont'), PDFName)?.decodeText() ?? '';

  if (subtype === 'Type0') {
    const desc = dict.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    const dw = num(ctx, desc.get(PDFName.of('DW'))) ?? 1000;
    const widths = new Map<number, number>();
    const w = desc.lookupMaybe(PDFName.of('W'), PDFArray);
    if (w) {
      for (let i = 0; i < w.size(); ) {
        const first = num(ctx, w.get(i))!;
        const next = w.lookup(i + 1);
        if (next instanceof PDFArray) {
          for (let k = 0; k < next.size(); k++) widths.set(first + k, num(ctx, next.get(k)) ?? dw);
          i += 2;
        } else {
          const last = num(ctx, next)!;
          const wv = num(ctx, w.get(i + 2)) ?? dw;
          for (let c = first; c <= last; c++) widths.set(c, wv);
          i += 3;
        }
      }
    }
    return { twoByte: true, known: true, width: (c) => widths.get(c) ?? dw };
  }

  const firstChar = num(ctx, dict.get(PDFName.of('FirstChar'))) ?? 0;
  const widthsArr = dict.lookupMaybe(PDFName.of('Widths'), PDFArray);
  const descriptor = dict.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  const missing = num(ctx, descriptor?.get(PDFName.of('MissingWidth'))) ?? 0;
  let scale = 1;
  if (subtype === 'Type3') {
    const fm = dict.lookupMaybe(PDFName.of('FontMatrix'), PDFArray);
    scale = (fm ? num(ctx, fm.get(0)) ?? 0.001 : 0.001) * 1000;
  }
  if (widthsArr) {
    const ws = Array.from({ length: widthsArr.size() }, (_, k) => num(ctx, widthsArr.get(k)) ?? missing);
    return { twoByte: false, known: true, width: (c) => (ws[c - firstChar] ?? missing) * scale };
  }

  // Standard-14 fonts may omit /Widths: use the built-in metrics.
  const std = standardFont(base);
  if (std) {
    const font = Font.load(std);
    const names = new Map<number, string>(
      std === FontNames.Symbol ? codeToName(Encodings.Symbol) : std === FontNames.ZapfDingbats ? codeToName(Encodings.ZapfDingbats) : WIN_ANSI,
    );
    // /Encoding may be a name (e.g. /WinAnsiEncoding) or a dict with /Differences.
    const enc = dict.lookup(PDFName.of('Encoding'));
    const diffs = enc instanceof PDFDict ? enc.lookupMaybe(PDFName.of('Differences'), PDFArray) : undefined;
    if (diffs) {
      let code = 0;
      for (let k = 0; k < diffs.size(); k++) {
        const v = diffs.get(k);
        if (v instanceof PDFNumber) code = v.asNumber();
        else if (v instanceof PDFName) names.set(code++, v.decodeText());
      }
    }
    return {
      twoByte: false,
      known: true,
      width: (c) => {
        const n = names.get(c);
        return (n ? (font.getWidthOfGlyph(n) as number | undefined) : undefined) ?? 0;
      },
    };
  }
  return { twoByte: false, known: false, width: () => 0 };
}

// ------------------------------------------------------------------ interpreter

interface GState {
  ctm: M;
  font?: FontInfo;
  fs: number;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  ts: number;
}

const hex = (bytes: number[]) => '<' + Buffer.from(bytes).toString('hex') + '>';
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

/**
 * Returns the rewritten content stream and how many glyphs were removed.
 * Text that cannot be measured (unknown fonts) is left untouched.
 */
export function removeCoveredText(content: Uint8Array, fonts: (name: string) => FontInfo | undefined, covers: UserRect[]) {
  let gs: GState = { ctm: [...ID], fs: 0, tc: 0, tw: 0, th: 1, tl: 0, ts: 0 };
  const stack: GState[] = [];
  let tm: M = [...ID];
  let tlm: M = [...ID];
  let removed = 0;

  const edits: { s: number; e: number; text: string }[] = [];
  type Val = number | string | Uint8Array | Val[] | null;
  const operands: Val[] = [];
  const nest: Val[][] = [];
  let opStart = -1;

  const inCover = (x: number, y: number) => covers.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);

  /** Walks a show-text operand, advancing tm. Returns TJ elements if anything was removed. */
  const show = (items: Val[]): string | null => {
    const font = gs.font;
    const fs = gs.fs;
    const out: string[] = [];
    let kept: number[] = [];
    let skip = 0; // TJ units to emit for removed glyphs
    let any = false;
    const flushKept = () => {
      if (kept.length) out.push(hex(kept));
      kept = [];
    };
    const flushSkip = () => {
      if (Math.abs(skip) > 1e-9) out.push(fmt(skip));
      skip = 0;
    };
    for (const it of items) {
      if (typeof it === 'number') {
        flushKept();
        skip += it;
        tm = mul([1, 0, 0, 1, (-it / 1000) * fs * gs.th, 0], tm);
        continue;
      }
      if (!(it instanceof Uint8Array)) continue;
      const bytes = it;
      const step = font?.twoByte ? 2 : 1;
      for (let i = 0; i + step - 1 < bytes.length; i += step) {
        const code = step === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
        const w0 = font ? font.width(code) : 0;
        const isSpace = step === 1 && code === 32;
        const adv = (w0 / 1000) * fs + gs.tc + (isSpace ? gs.tw : 0);
        // Glyph centre in user space: half its width along the baseline, ~0.3 em up.
        const trm = mul(mul([fs * gs.th, 0, 0, fs, 0, gs.ts], tm), gs.ctm);
        const c = apply(trm, w0 / 2000, 0.3);
        const drop = !!font?.known && fs !== 0 && inCover(c.x, c.y);
        if (drop) {
          flushKept();
          skip -= (1000 * adv) / fs;
          removed++;
          any = true;
        } else {
          flushSkip();
          for (let k = 0; k < step; k++) kept.push(bytes[i + k]);
        }
        tm = mul([1, 0, 0, 1, adv * gs.th, 0], tm);
      }
    }
    flushKept();
    flushSkip();
    return any ? `[${out.join(' ')}] TJ` : null;
  };

  for (const tok of lex(content)) {
    if (opStart < 0) opStart = tok.s;
    switch (tok.t) {
      case 'num':
      case 'name':
      case 'str':
        (nest.length ? nest[nest.length - 1] : operands).push(tok.v);
        continue;
      case '[':
      case '<<':
        nest.push([]);
        continue;
      case ']':
      case '>>': {
        const arr = nest.pop() ?? [];
        (nest.length ? nest[nest.length - 1] : operands).push(tok.t === ']' ? arr : null);
        continue;
      }
    }
    // operator
    const op = tok.v;
    const a = operands;
    const n = (i: number) => (typeof a[i] === 'number' ? (a[i] as number) : 0);
    switch (op) {
      case 'q':
        stack.push({ ...gs, ctm: [...gs.ctm] as M });
        break;
      case 'Q':
        gs = stack.pop() ?? gs;
        break;
      case 'cm':
        gs.ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], gs.ctm);
        break;
      case 'BT':
        tm = [...ID];
        tlm = [...ID];
        break;
      case 'Tf':
        gs.font = fonts(String(a[0]));
        gs.fs = n(1);
        break;
      case 'Tc':
        gs.tc = n(0);
        break;
      case 'Tw':
        gs.tw = n(0);
        break;
      case 'Tz':
        gs.th = n(0) / 100;
        break;
      case 'TL':
        gs.tl = n(0);
        break;
      case 'Ts':
        gs.ts = n(0);
        break;
      case 'Td':
        tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
        tm = [...tlm];
        break;
      case 'TD':
        gs.tl = -n(1);
        tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
        tm = [...tlm];
        break;
      case 'Tm':
        tlm = [n(0), n(1), n(2), n(3), n(4), n(5)];
        tm = [...tlm];
        break;
      case 'T*':
        tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
        tm = [...tlm];
        break;
      case 'Tj':
      case 'TJ':
      case "'":
      case '"': {
        let prefix = '';
        if (op === '"') {
          gs.tw = n(0);
          gs.tc = n(1);
          prefix = `${fmt(gs.tw)} Tw ${fmt(gs.tc)} Tc T* `;
        } else if (op === "'") prefix = 'T* ';
        if (op === "'" || op === '"') {
          tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
          tm = [...tlm];
        }
        const operand = a[a.length - 1];
        const items = op === 'TJ' && Array.isArray(operand) ? operand : [operand];
        const replacement = show(items);
        if (replacement) edits.push({ s: opStart, e: tok.e, text: prefix + replacement });
        break;
      }
    }
    operands.length = 0;
    opStart = -1;
  }

  if (!edits.length) return { content, removed: 0 };
  const parts: Buffer[] = [];
  let pos = 0;
  for (const ed of edits) {
    parts.push(Buffer.from(content.subarray(pos, ed.s)), Buffer.from(ed.text, 'latin1'));
    pos = ed.e;
  }
  parts.push(Buffer.from(content.subarray(pos)));
  return { content: new Uint8Array(Buffer.concat(parts)), removed };
}

// ------------------------------------------------------------------ page-level entry point

function streamBytes(obj: PDFObject | undefined, ctx: PDFContext): Uint8Array[] {
  const o = obj instanceof PDFRef ? ctx.lookup(obj) : obj;
  if (o instanceof PDFArray) return Array.from({ length: o.size() }, (_, i) => streamBytes(o.get(i), ctx)).flat();
  if (o instanceof PDFRawStream) return [decodePDFRawStream(o).decode()];
  if (o instanceof PDFStream) return [o.getContents()];
  return [];
}

/** Removes text under `covers` from the page's own content. Must run before anything is drawn on the page. */
export function redactPage(page: PDFPage, covers: UserRect[]): number {
  if (!covers.length) return 0;
  const ctx = page.doc.context;
  const chunks = streamBytes(page.node.get(PDFName.of('Contents')), ctx);
  if (!chunks.length) return 0;
  const content = new Uint8Array(Buffer.concat(chunks.map((c) => Buffer.concat([Buffer.from(c), Buffer.from('\n')]))));

  const fontDict = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const cache = new Map<string, FontInfo | undefined>();
  const fonts = (name: string) => {
    if (!cache.has(name)) {
      let info: FontInfo | undefined;
      try {
        const d = fontDict?.lookupMaybe(PDFName.of(name), PDFDict);
        info = d ? loadFont(ctx, d) : undefined;
      } catch {
        info = undefined;
      }
      cache.set(name, info);
    }
    return cache.get(name);
  };

  const { content: out, removed } = removeCoveredText(content, fonts, covers);
  if (removed) page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(out)));
  return removed;
}
