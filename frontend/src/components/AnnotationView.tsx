import { useEffect, useRef } from 'react';
import { boxLeft, cssFamily, lineWidths, metrics, textBox, usesOriginal } from '../lib/fonts';
import type { Annotation, TextAnnotation } from '../lib/types';

interface Props {
  a: Annotation;
  pageW: number;
  pageH: number;
  editing?: boolean;
  onTextChange?: (text: string) => void;
  onEditEnd?: () => void;
}

/** The patch that hides original text. Rendered beneath every annotation (same order as the export). */
export function CoverView({ a }: { a: Annotation }) {
  if (a.type !== 'text' || !a.cover) return null;
  return (
    <div
      data-ann={a.id}
      style={{ position: 'absolute', left: a.cover.x, top: a.cover.y, width: a.cover.w, height: a.cover.h, background: a.cover.color }}
    />
  );
}

export function AnnotationView({ a, pageW, pageH, editing, onTextChange, onEditEnd }: Props) {
  const opacity = a.opacity ?? 1;
  switch (a.type) {
    case 'text':
      return editing ? <TextEditor a={a} onChange={onTextChange!} onDone={onEditEnd!} /> : <SvgText a={a} pageW={pageW} pageH={pageH} />;
    case 'rect':
    case 'ellipse':
      return (
        <svg
          data-ann={a.id}
          className="ann-shape"
          width={Math.max(a.w, 0.1)}
          height={Math.max(a.h, 0.1)}
          style={{ left: a.x, top: a.y, mixBlendMode: a.blend === 'multiply' ? 'multiply' : undefined, opacity }}
        >
          {a.type === 'rect' ? (
            <rect
              x={0}
              y={0}
              width={a.w}
              height={a.h}
              fill={a.fill ?? 'none'}
              stroke={a.stroke ?? 'none'}
              strokeWidth={a.stroke ? a.strokeWidth : 0}
              pointerEvents="visible"
            />
          ) : (
            <ellipse
              cx={a.w / 2}
              cy={a.h / 2}
              rx={a.w / 2}
              ry={a.h / 2}
              fill={a.fill ?? 'none'}
              stroke={a.stroke ?? 'none'}
              strokeWidth={a.stroke ? a.strokeWidth : 0}
              pointerEvents="visible"
            />
          )}
        </svg>
      );
    case 'line': {
      const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      const len = Math.max(8, a.width * 4);
      const head = [Math.PI - 0.45, -(Math.PI - 0.45)].map((o) => [a.x2 + Math.cos(ang + o) * len, a.y2 + Math.sin(ang + o) * len]);
      const d = `M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}` + (a.arrow ? head.map(([x, y]) => ` M ${a.x2} ${a.y2} L ${x} ${y}`).join('') : '');
      return (
        <svg className="ann-full" width={pageW} height={pageH} style={{ opacity }}>
          <g data-ann={a.id}>
            <path d={d} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" fill="none" />
            <path d={d} stroke="transparent" strokeWidth={Math.max(10, a.width + 8)} fill="none" pointerEvents="stroke" />
          </g>
        </svg>
      );
    }
    case 'path': {
      const pts = a.points.length === 2 ? [...a.points, a.points[0] + 0.01, a.points[1]] : a.points;
      const str = pts.reduce((s, v, i) => s + (i % 2 ? `,${v}` : ` ${v}`), '');
      return (
        <svg className="ann-full" width={pageW} height={pageH} style={{ opacity }}>
          <g data-ann={a.id}>
            <polyline points={str} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <polyline points={str} stroke="transparent" strokeWidth={Math.max(10, a.width + 8)} fill="none" pointerEvents="stroke" />
          </g>
        </svg>
      );
    }
    case 'image':
      return (
        <img
          data-ann={a.id}
          src={a.src}
          draggable={false}
          style={{ position: 'absolute', left: a.x, top: a.y, width: a.w, height: a.h, opacity }}
        />
      );
  }
}

/** Renders text with explicit baselines — identical placement to the exported PDF. */
function SvgText({ a, pageW, pageH }: { a: TextAnnotation; pageW: number; pageH: number }) {
  const lines = (a.text || ' ').split('\n');
  const lh = a.fontSize * (a.lineHeight ?? 1.2);
  const widths = lineWidths(a);
  const box = textBox(a);
  const orig = usesOriginal(a);
  return (
    <svg className="ann-full" width={pageW} height={pageH} style={{ opacity: a.opacity ?? 1 }}>
      <g data-ann={a.id}>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="transparent" pointerEvents="all" />
        {lines.map((line, i) => {
          // x is the anchor: each line hangs from it by its own width.
          const dx = a.align === 'center' ? -widths[i] / 2 : a.align === 'right' ? -widths[i] : 0;
          const y = a.y + i * lh;
          return (
            <g key={i}>
              <text
                x={a.x + dx}
                y={y}
                fill={a.color}
                fontFamily={cssFamily(a)}
                fontSize={a.fontSize}
                fontWeight={a.bold ? 700 : 400}
                fontStyle={a.italic ? 'italic' : 'normal'}
                // The original font already has its weight/slant baked in: never synthesise it.
                style={{
                  whiteSpace: 'pre',
                  fontSynthesis: orig ? 'none' : undefined,
                  wordSpacing: a.wordSpacing ? `${a.wordSpacing}px` : undefined,
                  letterSpacing: a.charSpacing ? `${a.charSpacing}px` : undefined,
                }}
                pointerEvents="none"
              >
                {line}
              </text>
              {a.underline && line && (
                <line
                  x1={a.x + dx}
                  x2={a.x + dx + widths[i]}
                  y1={y + a.fontSize * 0.12}
                  y2={y + a.fontSize * 0.12}
                  stroke={a.color}
                  strokeWidth={Math.max(0.5, a.fontSize / 15)}
                />
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** CSS for the HTML editing box, positioned so its baselines land on the annotation's baselines. */
export function textStyle(a: TextAnnotation, boxWidth = Math.max(0, ...lineWidths(a))): React.CSSProperties {
  const lh = a.fontSize * (a.lineHeight ?? 1.2);
  const { ascent, descent } = metrics(a);
  const firstBaselineInBox = (lh - (ascent + descent) * a.fontSize) / 2 + ascent * a.fontSize;
  return {
    position: 'absolute',
    left: boxLeft(a, boxWidth),
    top: a.y - firstBaselineInBox,
    fontFamily: cssFamily(a),
    fontSize: a.fontSize,
    lineHeight: `${lh}px`,
    fontWeight: a.bold ? 700 : 400,
    fontStyle: a.italic ? 'italic' : 'normal',
    textDecoration: a.underline ? 'underline' : 'none',
    textAlign: a.align ?? 'left',
    color: a.color,
    opacity: a.opacity ?? 1,
    whiteSpace: 'pre',
    wordSpacing: a.wordSpacing ? `${a.wordSpacing}px` : undefined,
    letterSpacing: a.charSpacing ? `${a.charSpacing}px` : undefined,
  };
}

function TextEditor({ a, onChange, onDone }: { a: TextAnnotation; onChange: (t: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const w = Math.max(0, ...lineWidths(a));
  const n = a.text.split('\n').length;
  const lh = a.fontSize * (a.lineHeight ?? 1.2);
  return (
    <textarea
      ref={ref}
      className="ann-editor"
      value={a.text}
      placeholder="type…"
      spellCheck={false}
      wrap="off"
      style={{ ...textStyle(a, w), width: w, height: n * lh + 2 }}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') ref.current?.blur();
      }}
    />
  );
}
