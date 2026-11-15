// Keep in sync with backend/src/pdf/types.ts
// Coordinates are PDF points in the page's display space (top-left origin, y down,
// built-in /Rotate applied, user rotation NOT applied).

export type FontFamily = 'sans' | 'serif' | 'mono' | 'carlito' | 'dejavu';

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
  /** Anchor x: left edge, centre or right edge depending on `align` (so edits keep the alignment). */
  x: number;
  /** Baseline of the first line (so text sits exactly where the original did). */
  y: number;
  /** Font taken from the original PDF; used whenever it has glyphs for the whole text. */
  fontRef?: string;
  /** PDF standard font of the original (e.g. Times-Roman); exported natively when the text fits its encoding. */
  stdFont?: string;
  /** Extra space added to every space character, in pt (copied from the original line). */
  wordSpacing?: number;
  /** Extra space added after every character, in pt (copied from the original line). */
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
  cover?: Cover;
  /** Set on blocks created by translation, so later corrections can be learned. */
  translatedFrom?: { text: string; source: string; target: string; machine: string };
}

export interface PathAnnotation {
  type: 'path';
  id: string;
  points: number[];
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
  src: string;
  opacity?: number;
}

export type Annotation = TextAnnotation | PathAnnotation | ShapeAnnotation | LineAnnotation | ImageAnnotation;

export type Rotation = 0 | 90 | 180 | 270;

export interface Page {
  id: string;
  source: { file: number; index: number } | null;
  width: number;
  height: number;
  rotation: Rotation;
  annotations: Annotation[];
  /** Text recognised on a scanned page (OCR), in display-space points. */
  ocr?: OcrLine[];
}

export interface OcrLine {
  str: string;
  x: number;
  top: number;
  width: number;
  height: number;
  size: number;
  baseline: number;
}

export type Tool =
  | 'select'
  | 'text'
  | 'edittext'
  | 'draw'
  | 'highlight'
  | 'whiteout'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'eraser';

export interface Style {
  color: string;
  fill: string | null;
  strokeWidth: number;
  fontSize: number;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
  opacity: number;
}

export const uid = () => crypto.randomUUID();
