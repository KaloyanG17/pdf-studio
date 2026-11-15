import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import fontkit from '@pdf-lib/fontkit';
import {
  BlendMode,
  LineCapStyle,
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setCharacterSqueeze,
  setTextRenderingMode,
  TextRenderingMode,
} from 'pdf-lib';
import { FontsService } from '../fonts/fonts.service';
import { redactPage, type UserRect } from './redact';
import type { Annotation, ExportSpec, TextAnnotation } from './types';

type Pt = { x: number; y: number };

function hexToRgb(hex: string | null | undefined) {
  const h = (hex ?? '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Real advance width of text as the PDF draws it. pdf-lib's widthOfTextAtSize() adds kerning
 * for the standard fonts, but drawText() (like every PDF viewer) does not kern, so using it
 * would misplace centred / right-aligned text containing pairs such as "To" or "AT".
 */
function advance(font: PDFFont, text: string, size: number): number {
  const emb = (font as unknown as { embedder: { encodeTextAsGlyphs?: (t: string) => { name: string }[]; font: { getWidthOfGlyph?: (n: string) => number | undefined } } }).embedder;
  if (emb?.encodeTextAsGlyphs && emb.font?.getWidthOfGlyph) {
    let w = 0;
    for (const g of emb.encodeTextAsGlyphs(text)) w += emb.font.getWidthOfGlyph(g.name) ?? 0;
    return (w * size) / 1000;
  }
  return font.widthOfTextAtSize(text, size);
}

@Injectable()
export class PdfService {
  private readonly log = new Logger(PdfService.name);
  constructor(private readonly fonts: FontsService) {}

  /**
   * @param files     source PDFs
   * @param origFonts fonts extracted from the source PDFs, keyed by TextAnnotation.fontRef
   */
  async export(spec: ExportSpec, files: Buffer[], origFonts: Map<string, Buffer> = new Map()): Promise<Uint8Array> {
    if (!spec?.pages?.length) throw new BadRequestException('Document has no pages');

    const out = await PDFDocument.create();
    out.registerFontkit(fontkit);
    if (spec.title) out.setTitle(spec.title);
    out.setProducer('PDF Studio');

    const sources = await Promise.all(
      files.map((b) => PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false })),
    );
    const fontCache = new Map<string, Promise<PDFFont>>();
    const imageCache = new Map<string, Promise<PDFImage>>();
    const parsed = new Map<string, { hasGlyphForCodePoint(cp: number): boolean } | null>();

    /** Same rule as the editor: the original font is used only if it covers every character. */
    const originalCovers = (ref: string, text: string) => {
      if (!parsed.has(ref)) {
        const buf = origFonts.get(ref);
        try {
          parsed.set(ref, buf ? (fontkit.create(buf) as never) : null);
        } catch {
          parsed.set(ref, null);
        }
      }
      const f = parsed.get(ref);
      if (!f) return false;
      for (const ch of text) {
        if (/\s/.test(ch)) continue;
        if (!f.hasGlyphForCodePoint(ch.codePointAt(0)!)) return false;
      }
      return true;
    };

    const STD = new Set<string>(Object.values(StandardFonts));
    const getFont = async (a: TextAnnotation): Promise<PDFFont> => {
      // 1) The original is a PDF standard font (not embedded): use it natively, exactly as the original does.
      if (a.stdFont && STD.has(a.stdFont)) {
        const key = `std:${a.stdFont}`;
        if (!fontCache.has(key)) fontCache.set(key, out.embedFont(a.stdFont as StandardFonts));
        const f = await fontCache.get(key)!;
        try {
          f.encodeText(a.text.split('\n').join(''));
          return f;
        } catch {
          /* characters outside WinAnsi (e.g. Cyrillic) → next option */
        }
      }
      // 2) The font embedded in the original, when it has every glyph.
      if (a.fontRef && originalCovers(a.fontRef, a.text)) {
        const key = `orig:${a.fontRef}`;
        if (!fontCache.has(key)) fontCache.set(key, out.embedFont(origFonts.get(a.fontRef)!, { subset: false }));
        try {
          return await fontCache.get(key)!;
        } catch {
          parsed.set(a.fontRef, null); // unusable font program → fall back below
        }
      }
      const key = FontsService.key(a.font ?? 'sans', !!a.bold, !!a.italic);
      if (!fontCache.has(key)) fontCache.set(key, out.embedFont(this.fonts.get(key), { subset: true }));
      return fontCache.get(key)!;
    };
    const getImage = (src: string) => {
      if (!imageCache.has(src)) {
        const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(src);
        if (!m) throw new BadRequestException('Images must be PNG or JPEG data URLs');
        const bytes = Buffer.from(m[2], 'base64');
        imageCache.set(src, m[1].toLowerCase() === 'png' ? out.embedPng(bytes) : out.embedJpg(bytes));
      }
      return imageCache.get(src)!;
    };

    for (const ps of spec.pages) {
      let page: PDFPage;
      let r0 = 0;
      let box = { x: 0, y: 0, width: ps.width, height: ps.height };
      if (ps.source) {
        const src = sources[ps.source.file];
        if (!src) throw new BadRequestException(`Missing source file #${ps.source.file}`);
        const [copied] = await out.copyPages(src, [ps.source.index]);
        page = out.addPage(copied);
        r0 = ((page.getRotation().angle % 360) + 360) % 360;
        box = page.getCropBox();
      } else {
        page = out.addPage([ps.width, ps.height]);
      }

      // Display space (top-left origin, y down, page's own /Rotate applied) -> PDF user space.
      const W = box.width;
      const H = box.height;
      const toPdf = (xd: number, yd: number): Pt => {
        switch (r0) {
          case 90:
            return { x: box.x + yd, y: box.y + xd };
          case 180:
            return { x: box.x + W - xd, y: box.y + yd };
          case 270:
            return { x: box.x + W - yd, y: box.y + H - xd };
          default:
            return { x: box.x + xd, y: box.y + H - yd };
        }
      };

      // Remove (not just hide) the original text under text covers and opaque whiteout boxes,
      // so it can no longer be copied, searched or extracted. Must run before drawing on the page.
      if (ps.source) {
        const userRect = (x: number, y: number, w: number, h: number): UserRect => {
          const a = toPdf(x, y);
          const b = toPdf(x + w, y + h);
          return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
        };
        const zones: UserRect[] = [];
        for (const a of ps.annotations ?? []) {
          if (a.type === 'text' && a.cover && a.cover.w > 0 && a.cover.h > 0) zones.push(userRect(a.cover.x, a.cover.y, a.cover.w, a.cover.h));
          else if (a.type === 'rect' && a.fill && (a.opacity ?? 1) >= 1 && a.blend !== 'multiply') zones.push(userRect(a.x, a.y, a.w, a.h));
        }
        try {
          const n = redactPage(page, zones);
          if (n) this.log.log(`Removed ${n} covered glyphs from page`);
        } catch (e) {
          this.log.warn(`Could not remove covered text: ${(e as Error).message}`); // the cover still hides it
        }
      }

      // All covers first, then all content, so one edit's cover never erases a neighbour's new text.
      for (const a of ps.annotations ?? []) {
        if (a.type !== 'text' || !a.cover || a.cover.w <= 0 || a.cover.h <= 0) continue;
        const p = toPdf(a.cover.x, a.cover.y + a.cover.h);
        page.drawRectangle({ x: p.x, y: p.y, width: a.cover.w, height: a.cover.h, color: hexToRgb(a.cover.color), rotate: degrees(r0) });
      }
      for (const a of ps.annotations ?? []) {
        await this.drawAnnotation(page, a, toPdf, r0, getFont, getImage);
      }

      // Scanned page + OCR: invisible text over the image, so the exported file is searchable.
      if (ps.ocr?.length) {
        const key = 'ocr:sans';
        if (!fontCache.has(key)) fontCache.set(key, out.embedFont(this.fonts.get('sans'), { subset: true }));
        const font = await fontCache.get(key)!;
        const covered = (l: { x: number; top: number; width: number; height: number }) =>
          (ps.annotations ?? []).some(
            (a) =>
              a.type === 'text' &&
              a.cover &&
              a.cover.x <= l.x + 1.5 &&
              a.cover.y <= l.top + 1.5 &&
              a.cover.x + a.cover.w >= l.x + l.width - 1.5 &&
              a.cover.y + a.cover.h >= l.top + l.height - 1.5,
          );
        for (const l of ps.ocr) {
          if (!l.str.trim() || covered(l)) continue;
          let natural: number;
          try {
            natural = font.widthOfTextAtSize(l.str, l.size);
          } catch {
            continue; // characters the font cannot encode
          }
          if (natural <= 0) continue;
          const p = toPdf(l.x, l.baseline);
          page.pushOperators(
            pushGraphicsState(),
            setTextRenderingMode(TextRenderingMode.Invisible),
            setCharacterSqueeze(Math.max(10, Math.min(1000, (100 * l.width) / natural))),
          );
          page.drawText(l.str, { x: p.x, y: p.y, size: l.size, font, rotate: degrees(r0) });
          page.pushOperators(popGraphicsState());
        }
      }

      // Watermark: diagonal (bottom-left → top-right as the page is viewed), centred, sized to the page.
      const wm = spec.watermark;
      if (wm?.text?.trim()) {
        const key = 'wm:sans-b';
        if (!fontCache.has(key)) fontCache.set(key, out.embedFont(this.fonts.get('sans-b'), { subset: true }));
        const font = await fontCache.get(key)!;
        const dw = r0 % 180 ? H : W; // display width / height
        const dh = r0 % 180 ? W : H;
        const angle = Math.atan2(dh, dw);
        const size = Math.min(dh * 0.25, (Math.hypot(dw, dh) * 0.6) / Math.max(1, font.widthOfTextAtSize(wm.text, 1)));
        const w = font.widthOfTextAtSize(wm.text, size);
        const cap = font.heightAtSize(size, { descender: false }) * 0.72;
        const dir = { x: Math.cos(angle), y: -Math.sin(angle) }; // up-right in display space (y down)
        const nrm = { x: Math.sin(angle), y: Math.cos(angle) };
        const start = toPdf(dw / 2 - (dir.x * w) / 2 + (nrm.x * cap) / 2, dh / 2 - (dir.y * w) / 2 + (nrm.y * cap) / 2);
        page.drawText(wm.text, {
          x: start.x,
          y: start.y,
          size,
          font,
          color: rgb(0.45, 0.45, 0.45),
          opacity: Math.min(1, Math.max(0.03, wm.opacity ?? 0.15)),
          rotate: degrees(r0 + (angle * 180) / Math.PI),
        });
      }

      page.setRotation(degrees((r0 + (ps.rotation ?? 0)) % 360));
    }

    return out.save();
  }

  private async drawAnnotation(
    page: PDFPage,
    a: Annotation,
    toPdf: (x: number, y: number) => Pt,
    r0: number,
    getFont: (a: TextAnnotation) => Promise<PDFFont>,
    getImage: (src: string) => Promise<PDFImage>,
  ) {
    const rotate = degrees(r0);
    const opacity = a.opacity ?? 1;

    switch (a.type) {
      case 'text': {
        const font = await getFont(a);
        const size = a.fontSize;
        const lh = size * (a.lineHeight ?? 1.2);
        const lines = (a.text ?? '').split('\n');
        const ws = a.wordSpacing ?? 0;
        const cs = a.charSpacing ?? 0;
        // Same width formula as the editor: glyph advances + word spacing + letter spacing.
        const widthOf = (s: string) => advance(font, s, size) + (s.match(/ /g) ?? []).length * ws + [...s].length * cs;
        const widths = lines.map(widthOf);
        const color = hexToRgb(a.color);
        const draw = (s: string, xd: number, yd: number) => {
          const p = toPdf(xd, yd);
          if (cs) page.pushOperators(pushGraphicsState(), setCharacterSpacing(cs));
          page.drawText(s, { x: p.x, y: p.y, size, font, color, opacity, rotate });
          if (cs) page.pushOperators(popGraphicsState());
        };
        lines.forEach((line, i) => {
          if (!line) return;
          // x is the anchor: left edge, centre or right edge.
          let dx = 0;
          if (a.align === 'center') dx = -widths[i] / 2;
          else if (a.align === 'right') dx = -widths[i];
          const baseline = a.y + i * lh;
          if (!ws) draw(line, a.x + dx, baseline);
          else {
            // Word spacing: place each word exactly (works for every font encoding).
            const space = advance(font, ' ', size) + cs + ws;
            let cx = a.x + dx;
            line.split(' ').forEach((word) => {
              if (word) draw(word, cx, baseline);
              cx += widthOf(word) + space;
            });
          }
          if (a.underline) {
            const s = toPdf(a.x + dx, baseline + size * 0.12);
            const e = toPdf(a.x + dx + widths[i], baseline + size * 0.12);
            page.drawLine({ start: s, end: e, thickness: Math.max(0.5, size / 15), color: hexToRgb(a.color), opacity });
          }
        });
        break;
      }
      case 'rect': {
        const p = toPdf(a.x, a.y + a.h);
        page.drawRectangle({
          x: p.x,
          y: p.y,
          width: a.w,
          height: a.h,
          rotate,
          color: a.fill ? hexToRgb(a.fill) : undefined,
          borderColor: a.stroke ? hexToRgb(a.stroke) : undefined,
          borderWidth: a.stroke ? a.strokeWidth : 0,
          opacity,
          borderOpacity: opacity,
          blendMode: a.blend === 'multiply' ? BlendMode.Multiply : undefined,
        });
        break;
      }
      case 'ellipse': {
        const c = toPdf(a.x + a.w / 2, a.y + a.h / 2);
        page.drawEllipse({
          x: c.x,
          y: c.y,
          xScale: a.w / 2,
          yScale: a.h / 2,
          rotate,
          color: a.fill ? hexToRgb(a.fill) : undefined,
          borderColor: a.stroke ? hexToRgb(a.stroke) : undefined,
          borderWidth: a.stroke ? a.strokeWidth : 0,
          opacity,
          borderOpacity: opacity,
          blendMode: a.blend === 'multiply' ? BlendMode.Multiply : undefined,
        });
        break;
      }
      case 'line': {
        const color = hexToRgb(a.color);
        const s = toPdf(a.x1, a.y1);
        const e = toPdf(a.x2, a.y2);
        page.drawLine({ start: s, end: e, thickness: a.width, color, opacity, lineCap: LineCapStyle.Round });
        if (a.arrow) {
          const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
          const len = Math.max(8, a.width * 4);
          for (const off of [Math.PI - 0.45, -(Math.PI - 0.45)]) {
            const t = toPdf(a.x2 + Math.cos(ang + off) * len, a.y2 + Math.sin(ang + off) * len);
            page.drawLine({ start: e, end: t, thickness: a.width, color, opacity, lineCap: LineCapStyle.Round });
          }
        }
        break;
      }
      case 'path': {
        const pts = a.points;
        if (pts.length < 2) break;
        let d = `M ${pts[0]} ${pts[1]}`;
        if (pts.length === 2) d += ` L ${pts[0] + 0.01} ${pts[1]}`;
        for (let i = 2; i + 1 < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
        // drawSvgPath uses SVG (y-down) coordinates relative to x/y, which matches display space.
        const origin = toPdf(0, 0);
        page.drawSvgPath(d, {
          x: origin.x,
          y: origin.y,
          rotate,
          borderColor: hexToRgb(a.color),
          borderWidth: a.width,
          borderOpacity: opacity,
          borderLineCap: LineCapStyle.Round,
        });
        break;
      }
      case 'image': {
        const img = await getImage(a.src);
        const p = toPdf(a.x, a.y + a.h);
        page.drawImage(img, { x: p.x, y: p.y, width: a.w, height: a.h, rotate, opacity });
        break;
      }
    }
  }
}
