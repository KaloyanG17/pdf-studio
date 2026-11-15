import { textBox } from './fonts';
import type { Annotation } from './types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function bbox(a: Annotation): Box {
  switch (a.type) {
    case 'text':
      return textBox(a);
    case 'rect':
    case 'ellipse':
    case 'image':
      return { x: a.x, y: a.y, w: a.w, h: a.h };
    case 'line': {
      const x = Math.min(a.x1, a.x2);
      const y = Math.min(a.y1, a.y2);
      return { x, y, w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
    }
    case 'path': {
      const xs = a.points.filter((_, i) => i % 2 === 0);
      const ys = a.points.filter((_, i) => i % 2 === 1);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
  }
}

export function moveBy(a: Annotation, dx: number, dy: number): Partial<Annotation> {
  switch (a.type) {
    case 'line':
      return { x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case 'path':
      return { points: a.points.map((v, i) => v + (i % 2 ? dy : dx)) };
    default:
      return { x: a.x + dx, y: a.y + dy };
  }
}

export function resizeBy(a: Annotation, dx: number, dy: number): Partial<Annotation> | null {
  switch (a.type) {
    case 'rect':
    case 'ellipse':
      return { w: Math.max(2, a.w + dx), h: Math.max(2, a.h + dy) };
    case 'image': {
      const w = Math.max(8, a.w + dx);
      return { w, h: (w * a.h) / a.w };
    }
    case 'line':
      return { x2: a.x2 + dx, y2: a.y2 + dy };
    case 'text': {
      const { w } = textBox(a);
      const f = Math.max(0.1, (w + dx) / w);
      return { fontSize: Math.max(3, Math.round(a.fontSize * f * 10) / 10) };
    }
    default:
      return null;
  }
}
