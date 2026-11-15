import { useEffect, useRef, useState } from 'react';
import { bbox, moveBy, resizeBy } from '../lib/geometry';
import { getPage, getTextLines, sampleColors, type TextLine } from '../lib/pdf';
import { useStore } from '../lib/store';
import { uid, type Annotation, type Page, type TextAnnotation } from '../lib/types';
import { AnnotationView, CoverView } from './AnnotationView';

type Pt = { x: number; y: number };
type Drag =
  | { kind: 'move'; annId: string; start: Pt; orig: Annotation; moved: boolean }
  | { kind: 'resize'; annId: string; start: Pt; orig: Annotation; moved: boolean }
  | { kind: 'create'; start: Pt };

const CURSORS: Record<string, string> = {
  select: 'default',
  text: 'text',
  edittext: 'text',
  eraser: 'not-allowed',
};

export function PageView({ page, index, readOnly = false }: { page: Page; index: number; readOnly?: boolean }) {
  // Re-render once the original fonts of a reopened document have loaded.
  useStore((s) => s.fontsVersion);
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  const style = useStore((s) => s.style);
  const selected = useStore((s) => s.selected);
  const editingId = useStore((s) => s.editingId);
  const source = useStore((s) => (page.source ? s.sources[page.source.file] : null));
  const showOriginal = useStore((s) => s.showOriginal);

  const outerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [visible, setVisible] = useState(false);
  const [lines, setLines] = useState<TextLine[] | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const W = page.width * zoom;
  const H = page.height * zoom;
  const sideways = page.rotation % 180 !== 0;
  const outerW = sideways ? H : W;
  const outerH = sideways ? W : H;

  // Lazy: only render pages near the viewport.
  useEffect(() => {
    const el = outerRef.current!;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !source || !page.source) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    (async () => {
      const p = await getPage(source.doc, page.source!.index);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = p.getViewport({ scale: zoom * dpr });
      const canvas = canvasRef.current!;
      const off = document.createElement('canvas');
      off.width = Math.ceil(vp.width);
      off.height = Math.ceil(vp.height);
      task = p.render({ canvas: off, viewport: vp });
      try {
        await task.promise;
        if (cancelled) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext('2d')!.drawImage(off, 0, 0);
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, source, page.source, zoom]);

  // Show editable lines when using the "Edit text" tool.
  useEffect(() => {
    if (tool !== 'edittext' || !source || !page.source || !visible) return setLines(null);
    let live = true;
    getTextLines(source.doc, page.source.index).then((l) => live && setLines(l));
    return () => {
      live = false;
    };
  }, [tool, source, page.source, visible]);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 2500);
    return () => clearTimeout(t);
  }, [hint]);

  const toLocal = (e: { clientX: number; clientY: number }): Pt => {
    const r = outerRef.current!.getBoundingClientRect();
    const vx = e.clientX - (r.left + r.width / 2);
    const vy = e.clientY - (r.top + r.height / 2);
    const t = (-page.rotation * Math.PI) / 180;
    const rx = vx * Math.cos(t) - vy * Math.sin(t);
    const ry = vx * Math.sin(t) + vy * Math.cos(t);
    return { x: (rx + W / 2) / zoom, y: (ry + H / 2) / zoom };
  };

  const st = useStore.getState;

  const startEditing = (id: string) => {
    st().checkpoint();
    st().select({ pageId: page.id, annId: id });
    st().setEditing(id);
  };

  const editExistingText = async (p: Pt) => {
    if (!source || !page.source) return setHint('This page has no original text. Use the Text tool to add text.');
    const all = await getTextLines(source.doc, page.source.index);
    const pad = 2;
    const line = all.find((l) => p.x >= l.x - pad && p.x <= l.x + l.width + pad && p.y >= l.top - pad && p.y <= l.top + l.height + pad);
    if (!line)
      return setHint(
        all.length
          ? 'No text found at that spot. Use Add text to write something new.'
          : 'This page is a scan with no text yet: use “Recognise text in scans (OCR)” in the download menu first.',
      );
    const [c] = await sampleColors(source.doc, page.source.index, [{ x: line.x, y: line.top, w: line.width, h: line.height }]);
    const size = Math.round(line.size * 1000) / 1000;
    const a: TextAnnotation = {
      type: 'text',
      id: uid(),
      x: line.anchor,
      align: line.align,
      y: line.baseline,
      fontRef: line.fontRef,
      stdFont: line.stdFont,
      wordSpacing: line.wordSpacing || undefined,
      charSpacing: line.charSpacing || undefined,
      text: line.str,
      fontSize: size,
      lineHeight: 1.2,
      color: c.fg,
      font: line.family,
      bold: line.bold,
      italic: line.italic,
      cover: { x: line.x - 1, y: line.top - 0.5, w: line.width + 2, h: line.height + 1, color: c.bg },
    };
    st().addAnnotation(page.id, a, true);
    st().setEditing(a.id);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || showOriginal) return;
    const p = toLocal(e);
    const target = e.target as Element;
    const annId = target.closest('[data-ann]')?.getAttribute('data-ann') ?? null;
    const onHandle = !!target.closest('[data-handle]');
    const ann = annId ? page.annotations.find((a) => a.id === annId) : undefined;
    st().setCurrentPage(page.id);

    const capture = () => (e.currentTarget as Element).setPointerCapture(e.pointerId);

    switch (tool) {
      case 'select': {
        if (onHandle && selected?.pageId === page.id) {
          const orig = page.annotations.find((a) => a.id === selected.annId);
          if (orig) {
            drag.current = { kind: 'resize', annId: orig.id, start: p, orig, moved: false };
            capture();
          }
        } else if (ann) {
          st().select({ pageId: page.id, annId: ann.id });
          drag.current = { kind: 'move', annId: ann.id, start: p, orig: ann, moved: false };
          capture();
        } else st().select(null);
        return;
      }
      case 'eraser':
        if (ann) st().removeAnnotation(page.id, ann.id);
        return;
      case 'text': {
        if (ann?.type === 'text') return startEditing(ann.id);
        const a: TextAnnotation = {
          type: 'text',
          id: uid(),
          x: p.x,
          y: p.y + style.fontSize * 0.35,
          text: '',
          fontSize: style.fontSize,
          color: style.color,
          font: style.font,
          bold: style.bold,
          italic: style.italic,
          opacity: style.opacity,
        };
        st().addAnnotation(page.id, a, true);
        st().setEditing(a.id);
        e.preventDefault();
        return;
      }
      case 'edittext':
        e.preventDefault();
        if (ann?.type === 'text') return startEditing(ann.id);
        void editExistingText(p);
        return;
      case 'draw':
        setDraft({ type: 'path', id: uid(), points: [p.x, p.y], color: style.color, width: style.strokeWidth, opacity: style.opacity });
        break;
      case 'line':
      case 'arrow':
        setDraft({
          type: 'line',
          id: uid(),
          x1: p.x,
          y1: p.y,
          x2: p.x,
          y2: p.y,
          color: style.color,
          width: style.strokeWidth,
          arrow: tool === 'arrow',
          opacity: style.opacity,
        });
        break;
      case 'rect':
      case 'ellipse':
        setDraft({
          type: tool,
          id: uid(),
          x: p.x,
          y: p.y,
          w: 0,
          h: 0,
          stroke: style.color,
          fill: style.fill,
          strokeWidth: style.strokeWidth,
          opacity: style.opacity,
        });
        break;
      case 'highlight':
        setDraft({ type: 'rect', id: uid(), x: p.x, y: p.y, w: 0, h: 0, stroke: null, fill: '#fde047', strokeWidth: 0, opacity: 0.5, blend: 'multiply' });
        break;
      case 'whiteout':
        setDraft({ type: 'rect', id: uid(), x: p.x, y: p.y, w: 0, h: 0, stroke: null, fill: '#ffffff', strokeWidth: 0, opacity: 1 });
        break;
    }
    drag.current = { kind: 'create', start: p };
    capture();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toLocal(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (d.kind === 'move' || d.kind === 'resize') {
      if (!d.moved) {
        if (Math.hypot(dx, dy) < 1.5 / zoom) return;
        st().checkpoint();
        d.moved = true;
      }
      const patch = d.kind === 'move' ? moveBy(d.orig, dx, dy) : resizeBy(d.orig, dx, dy);
      if (patch) st().updateAnnotation(page.id, d.annId, patch, false);
      return;
    }
    setDraft((cur) => {
      if (!cur) return cur;
      switch (cur.type) {
        case 'path': {
          const n = cur.points.length;
          if (Math.hypot(p.x - cur.points[n - 2], p.y - cur.points[n - 1]) < 0.8 / zoom) return cur;
          return { ...cur, points: [...cur.points, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100] };
        }
        case 'line':
          if (e.shiftKey) {
            const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(dx, dy);
            return { ...cur, x2: d.start.x + Math.cos(ang) * len, y2: d.start.y + Math.sin(ang) * len };
          }
          return { ...cur, x2: p.x, y2: p.y };
        case 'rect':
        case 'ellipse': {
          let w = Math.abs(dx);
          let h = Math.abs(dy);
          if (e.shiftKey) w = h = Math.max(w, h);
          return { ...cur, x: dx < 0 ? d.start.x - w : d.start.x, y: dy < 0 ? d.start.y - h : d.start.y, w, h };
        }
        default:
          return cur;
      }
    });
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind !== 'create' || !draft) return;
    const b = bbox(draft);
    const big = draft.type === 'path' ? true : Math.max(b.w, b.h) > 2;
    if (big) st().addAnnotation(page.id, draft);
    setDraft(null);
  };

  const sel = selected?.pageId === page.id ? page.annotations.find((a) => a.id === selected.annId) : undefined;
  const selBox = sel && sel.id !== editingId ? bbox(sel) : null;
  const handlePos = sel?.type === 'line' ? { x: sel.x2, y: sel.y2 } : selBox ? { x: selBox.x + selBox.w, y: selBox.y + selBox.h } : null;

  // The "Original" column of side-by-side review: the untouched page, not interactive.
  if (readOnly)
    return (
      <div className="page-wrap">
        <div ref={outerRef} className="page-outer" style={{ width: outerW, height: outerH }}>
          <div className="page-inner" style={{ width: W, height: H, left: (outerW - W) / 2, top: (outerH - H) / 2, transform: `rotate(${page.rotation}deg)` }}>
            {page.source && <canvas ref={canvasRef} className="page-canvas" />}
          </div>
        </div>
      </div>
    );

  return (
    <div className="page-wrap">
      <div className="page-label">{index + 1}</div>
      <div ref={outerRef} className="page-outer" data-page-id={page.id} style={{ width: outerW, height: outerH }}>
        <div
          className="page-inner"
          style={{
            width: W,
            height: H,
            left: (outerW - W) / 2,
            top: (outerH - H) / 2,
            transform: `rotate(${page.rotation}deg)`,
          }}
        >
          {page.source && <canvas ref={canvasRef} className="page-canvas" />}
          <div
            className="overlay"
            style={{ width: page.width, height: page.height, transform: `scale(${zoom})`, cursor: CURSORS[tool] ?? 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={(e) => {
              const id = (e.target as Element).closest('[data-ann]')?.getAttribute('data-ann');
              const a = page.annotations.find((x) => x.id === id);
              if (a?.type === 'text' && tool === 'select') startEditing(a.id);
            }}
          >
            {lines?.map((l, i) => (
              <div key={i} className="text-line-hint" style={{ left: l.x - 1, top: l.top, width: l.width + 2, height: l.height }} />
            ))}
            {!showOriginal && page.annotations.map((a) => <CoverView key={`c-${a.id}`} a={a} />)}
            {!showOriginal && page.annotations.map((a) => (
              <AnnotationView
                key={a.id}
                a={a}
                pageW={page.width}
                pageH={page.height}
                editing={a.id === editingId}
                onTextChange={(text) => st().updateAnnotation(page.id, a.id, { text }, false)}
                onEditEnd={() => {
                  st().setEditing(null);
                  const cur = st().pages.find((pg) => pg.id === page.id)?.annotations.find((x) => x.id === a.id);
                  if (cur?.type === 'text' && !cur.text.trim() && !cur.cover) st().removeAnnotation(page.id, a.id);
                }}
              />
            ))}
            {draft && <AnnotationView a={draft} pageW={page.width} pageH={page.height} />}
            {selBox && (
              <div
                className="sel-box"
                style={{ left: selBox.x - 3 / zoom, top: selBox.y - 3 / zoom, width: selBox.w + 6 / zoom, height: selBox.h + 6 / zoom, borderWidth: 1 / zoom }}
              />
            )}
            {tool === 'select' && sel && handlePos && sel.type !== 'path' && sel.id !== editingId && (
              <div
                data-handle
                className="sel-handle"
                style={{ left: handlePos.x - 5 / zoom, top: handlePos.y - 5 / zoom, width: 10 / zoom, height: 10 / zoom, borderWidth: 1 / zoom }}
              />
            )}
          </div>
        </div>
        {hint && <div className="page-hint">{hint}</div>}
      </div>
    </div>
  );
}
