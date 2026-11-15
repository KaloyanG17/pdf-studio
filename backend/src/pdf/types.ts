import type { FontFamily } from '../fonts/fonts.service';

/**
 * All coordinates are in PDF points, in the page's *display* space:
 * origin at the top-left of the page as shown (with its built-in /Rotate applied,
 * but WITHOUT the extra rotation the user adds in the editor), y grows downward.
 */
export interface Cover {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface TextAnnotation {
  type: 'text';
  id: string;
  /** Anchor x: left edge, centre or right edge depending on `align`. */
  x: number;
  /** Baseline of the first line. */
  y: number;
  /**
   * Id of a font taken from the original PDF (uploaded alongside the export).
   * Used only when it has a glyph for every character; otherwise `font` is used.
   */
  fontRef?: string;
  /** PDF standard font name (Times-Roman, Helvetica…) to use when the text fits WinAnsi. */
  stdFont?: string;
  /** Extra space per space character (pt). */
  wordSpacing?: number;
  /** Extra space after every character (pt). */
  charSpacing?: number;
  text: string;
  fontSize: number;
  color: string;
  font: FontFamily;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  opacity?: number;
  /** Area painted (e.g. white) underneath to hide the original text. */
  cover?: Cover;
}

export interface PathAnnotation {
  type: 'path';
  id: string;
  points: number[]; // x0,y0,x1,y1,...
  color: string;
  width: number;
  opacity?: number;
}

export interface ShapeAnnotation {
  type: 'rect' | 'ellipse';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string | null;
  fill: string | null;
  strokeWidth: number;
  opacity?: number;
  blend?: 'normal' | 'multiply';
}

export interface LineAnnotation {
  type: 'line';
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  arrow?: boolean;
  opacity?: number;
}

export interface ImageAnnotation {
  type: 'image';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  src: string; // data URL (png or jpeg)
  opacity?: number;
}

export type Annotation = TextAnnotation | PathAnnotation | ShapeAnnotation | LineAnnotation | ImageAnnotation;

export interface PageSpec {
  /** null = blank page */
  source: { file: number; index: number } | null;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  annotations: Annotation[];
  /** Text recognised on a scanned page; exported as an invisible, searchable layer. */
  ocr?: { str: string; x: number; width: number; baseline: number; size: number; top: number; height: number }[];
}

export interface ExportSpec {
  pages: PageSpec[];
  title?: string;
  /** Diagonal text stamped across every page (e.g. "COPY", "PAID"). */
  watermark?: { text: string; opacity: number };
}
