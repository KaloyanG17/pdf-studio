import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Substitute fonts, chosen to be metric-compatible with the most common document fonts
 * so replaced text keeps the original width and line breaks:
 *   sans    = Liberation Sans  (Arial / Helvetica)
 *   serif   = Liberation Serif (Times New Roman)
 *   mono    = Liberation Mono  (Courier New)
 *   carlito = Carlito          (Calibri)
 *   dejavu  = DejaVu Sans      (Verdana-like, widest Unicode coverage)
 * All include Latin + Cyrillic.
 */
export type FontFamily = 'sans' | 'serif' | 'mono' | 'carlito' | 'dejavu';

const DOC = () => path.join(path.dirname(require.resolve('@docx-editor.dev/fonts/package.json')), 'assets');
const DEJAVU = () => path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');

const STYLES = { '': 'Regular', b: 'Bold', i: 'Italic', bi: 'BoldItalic' } as const;
const DEJAVU_STYLES = { '': '', b: '-Bold', i: '-Oblique', bi: '-BoldOblique' } as const;
const BASE: Record<Exclude<FontFamily, 'dejavu'>, string> = {
  sans: 'LiberationSans',
  serif: 'LiberationSerif',
  mono: 'LiberationMono',
  carlito: 'Carlito',
};

@Injectable()
export class FontsService {
  private cache = new Map<string, Buffer>();

  static key(family: FontFamily = 'sans', bold = false, italic = false): string {
    const suffix = `${bold ? 'b' : ''}${italic ? 'i' : ''}`;
    return suffix ? `${family}-${suffix}` : family;
  }

  private file(key: string): string | null {
    const [fam, style = ''] = key.split('-') as [string, keyof typeof STYLES];
    if (!(style in STYLES)) return null;
    if (fam === 'dejavu') return path.join(DEJAVU(), `DejaVuSans${DEJAVU_STYLES[style]}.ttf`);
    const base = BASE[fam as keyof typeof BASE];
    return base ? path.join(DOC(), `${base}-${STYLES[style]}.ttf`) : null;
  }

  get(key: string): Buffer {
    let buf = this.cache.get(key);
    if (buf) return buf;
    const file = this.file(key);
    if (!file || !fs.existsSync(file)) throw new NotFoundException(`Unknown font ${key}`);
    buf = fs.readFileSync(file);
    this.cache.set(key, buf);
    return buf;
  }
}
