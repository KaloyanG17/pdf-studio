import { useEffect, useRef, useState } from 'react';
import { getPage } from '../lib/pdf';
import { useStore } from '../lib/store';
import type { Page } from '../lib/types';
import { IconButton } from './Toolbar';

function Thumb({ page }: { page: Page }) {
  const source = useStore((s) => (page.source ? s.sources[page.source.file] : null));
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = 120 / Math.max(page.width, page.height);
  useEffect(() => {
    if (!source || !page.source) return;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    getPage(source.doc, page.source.index).then((p) => {
      const vp = p.getViewport({ scale: scale * 2 });
      const c = ref.current;
      if (!c) return;
      c.width = vp.width;
      c.height = vp.height;
      task = p.render({ canvas: c, viewport: vp });
      task.promise.catch(() => {});
    });
    return () => task?.cancel();
  }, [source, page.source, scale]);
  const w = page.width * scale;
  const h = page.height * scale;
  const side = page.rotation % 180 !== 0;
  return (
    <div className="thumb-box" style={{ width: side ? h : w, height: side ? w : h }}>
      <div style={{ width: w, height: h, transform: `rotate(${page.rotation}deg)`, background: '#fff' }}>
        {page.source && <canvas ref={ref} style={{ width: w, height: h }} />}
      </div>
      {page.annotations.length > 0 && <span className="thumb-badge" title={`${page.annotations.length} edits`} />}
    </div>
  );
}

export function Sidebar({ onMerge }: { onMerge: () => void }) {
  const pages = useStore((s) => s.pages);
  const current = useStore((s) => s.currentPageId);
  const { rotatePage, deletePage, duplicatePage, movePage, insertBlank } = useStore.getState();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const scrollTo = (id: string) => {
    document.querySelector(`[data-page-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    useStore.getState().setCurrentPage(id);
  };

  return (
    <aside className="sidebar glass heavy">
      <div className="sidebar-head">
        <span>Pages <span className="faint">{pages.length}</span></span>
        <div>
          <IconButton icon="page" label="Insert blank page after current" onClick={() => insertBlank(Math.max(0, pages.findIndex((p) => p.id === current)))} />
          <IconButton icon="merge" label="Merge another pdf" onClick={onMerge} />
        </div>
      </div>
      <div className="thumbs">
        {pages.map((p, i) => (
          <div
            key={p.id}
            className={`thumb ${p.id === current ? 'active' : ''} ${dropAt === i ? 'drop' : ''}`}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setDropAt(i);
            }}
            onDragLeave={() => setDropAt(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) movePage(dragFrom, i);
              setDragFrom(null);
              setDropAt(null);
            }}
            onClick={() => scrollTo(p.id)}
          >
            <Thumb page={p} />
            <div className="thumb-footer">
              <span className="thumb-num">
                {p.id === current && <span className="dot" />}
                {i + 1}
              </span>
              <div className="thumb-tools" onClick={(e) => e.stopPropagation()}>
                <IconButton icon="rotl" label="Rotate left" onClick={() => rotatePage(p.id, -90)} />
                <IconButton icon="rotr" label="Rotate right" onClick={() => rotatePage(p.id, 90)} />
                <IconButton icon="copy" label="Duplicate" onClick={() => duplicatePage(p.id)} />
                <IconButton icon="up" label="Move up" disabled={i === 0} onClick={() => movePage(i, i - 1)} />
                <IconButton icon="down" label="Move down" disabled={i === pages.length - 1} onClick={() => movePage(i, i + 1)} />
                <IconButton icon="trash" label="Delete page" onClick={() => deletePage(p.id)} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
