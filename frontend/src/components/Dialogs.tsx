import { useEffect, useRef, useState } from 'react';
import { getTranslateInfo, type TranslateInfo } from '../lib/api';
import { detectDocument, oppositeOf } from '../lib/detect';
import { addPageNumbers, countMatches, findReplace, type PageNumberOptions } from '../lib/features';
import { FAMILIES } from '../lib/fonts';
import { clearMemory, getGlossary, memorySize, setGlossary, type GlossaryEntry } from '../lib/glossary';
import { timeAgo } from '../lib/library';
import { useStore } from '../lib/store';
import { translatePages } from '../lib/translate';
import type { FontFamily } from '../lib/types';
import { Icon } from './Icon';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
import { IconButton, TOOL_LIST } from './Toolbar';

export function Modal({ title, onClose, children, wide, locked }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; locked?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal glass heavy ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          {!locked && <IconButton icon="close" label="Close" onClick={onClose} />}
        </div>
        {children}
      </div>
    </div>
  );
}

export function TranslateDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<TranslateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState('bg');
  const [target, setTarget] = useState('en');
  const [scope, setScope] = useState<'current' | 'all'>('all');
  const [provider, setProvider] = useState<string>('');
  const [font, setFont] = useState<FontFamily | 'auto'>('auto');
  const [progress, setProgress] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null | undefined>(undefined); // undefined = still looking
  const touched = useRef(false); // the user picked languages themselves: don't override

  // Read the document's own text and pick the direction: Bulgarian → English, English → Bulgarian.
  useEffect(() => {
    let live = true;
    detectDocument()
      .then((lang) => {
        if (!live) return;
        setDetected(lang);
        if (lang && !touched.current) {
          setSource(lang);
          setTarget(oppositeOf(lang));
        }
      })
      .catch(() => live && setDetected(null));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    getTranslateInfo()
      .then((i) => {
        setInfo(i);
        setProvider(i.defaultProvider);
      })
      .catch((e) => setError(`Server not reachable: ${e.message}`));
  }, []);

  const go = async () => {
    const { pages, currentPageId } = useStore.getState();
    const ids = scope === 'all' ? pages.map((p) => p.id) : [currentPageId ?? pages[0].id];
    setError(null);
    setProgress('Starting…');
    try {
      const r = await translatePages({
        pageIds: ids,
        source,
        target,
        provider,
        font,
        onProgress: (d, t) => setProgress(`Page ${Math.min(d + 1, t)} of ${t}`),
      });
      setProgress(null);
      if (!r.blocks) setError('No selectable text found. Scanned pages need OCR first.');
      else onClose();
    } catch (e) {
      setProgress(null);
      setError((e as Error).message);
    }
  };

  const langs = info ? Object.entries(info.languages) : [];
  if (progress)
    return (
      <Modal title="Translating" onClose={() => {}} locked>
        <div className="progress">
          <span className="bar" />
          <p>{progress}</p>
        </div>
      </Modal>
    );

  return (
    <Modal title="Translate document" onClose={onClose}>
      <p className="muted">
        Each paragraph is replaced in place, in the same font, size and spacing. It stays editable, and a single undo reverts it.
      </p>
      <div className="lang-row">
        <select
          value={source}
          onChange={(e) => {
            touched.current = true;
            setSource(e.target.value);
            if (e.target.value === target) setTarget(oppositeOf(e.target.value));
          }}
          aria-label="From"
        >
          <option value="auto">Detect language</option>
          {langs.map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button
          className="icon-btn"
          title="Swap languages"
          onClick={() => {
            if (source === 'auto') return;
            touched.current = true;
            setSource(target);
            setTarget(source);
          }}
        >
          <Icon name="swap" />
        </button>
        <select
          value={target}
          onChange={(e) => {
            touched.current = true;
            setTarget(e.target.value);
          }}
          aria-label="To"
        >
          {langs.map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <p className="detect-note faint">
        {detected === undefined
          ? 'Detecting the document language…'
          : detected && info?.languages[detected]
            ? `Detected ${info.languages[detected]}. Change it above if that's wrong.`
            : 'Could not tell the language from the text. Choose it above.'}
      </p>
      <div className="seg">
        <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>All pages</button>
        <button className={scope === 'current' ? 'on' : ''} onClick={() => setScope('current')}>This page</button>
      </div>
      <div className="grid2">
        <label>
          <span>Engine</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {info?.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Font</span>
          <select value={font} onChange={(e) => setFont(e.target.value as FontFamily | 'auto')}>
            <option value="auto">Match original</option>
            {FAMILIES.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </label>
      </div>
      {provider === 'mymemory' && (
        <p className="note">The free engine allows about 5,000 characters a day. Add a DeepL or Anthropic key in backend/.env to translate whole documents.</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="modal-foot">
        <button className="ghost" onClick={onClose}>Cancel</button>
        <button className="solid" disabled={!info || source === target} onClick={go}>Translate</button>
      </div>
    </Modal>
  );
}

export function FindReplaceDialog({ onClose }: { onClose: () => void }) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    setDone(null);
    if (!find) return setCount(null);
    let live = true;
    const t = setTimeout(() => countMatches(find, matchCase).then((n) => live && setCount(n)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [find, matchCase]);

  return (
    <Modal title="Find & replace" onClose={onClose}>
      <label className="stack">
        <span>Find</span>
        <input autoFocus value={find} onChange={(e) => setFind(e.target.value)} spellCheck={false} />
      </label>
      <label className="stack">
        <span>Replace with</span>
        <input value={replace} onChange={(e) => setReplace(e.target.value)} spellCheck={false} />
      </label>
      <div className="row">
        <label className="field">
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
        </label>
        <span className="grow" />
        <span className="muted">{done ?? (count === null ? '' : `${count} ${count === 1 ? 'match' : 'matches'}`)}</span>
      </div>
      <p className="note">Replaced lines keep their original font, size and colour.</p>
      <div className="modal-foot">
        <button className="ghost" onClick={onClose}>Close</button>
        <button
          className="solid"
          disabled={!find || !count}
          onClick={async () => {
            const n = await findReplace(find, replace, matchCase);
            setDone(`${n} replaced`);
            setCount(0);
          }}
        >
          Replace all
        </button>
      </div>
    </Modal>
  );
}

export function PageNumbersDialog({ onClose }: { onClose: () => void }) {
  const [o, setO] = useState<PageNumberOptions>({ format: '{n}', position: 'bottom-center', size: 10, startAt: 1, skipFirst: false });
  const set = (p: Partial<PageNumberOptions>) => setO({ ...o, ...p });
  return (
    <Modal title="Page numbers" onClose={onClose}>
      <div className="seg">
        {(['{n}', '{n} / {total}', 'page {n}', 'page {n} of {total}'] as const).map((f) => (
          <button key={f} className={o.format === f ? 'on' : ''} onClick={() => set({ format: f })}>
            {f.replace('{n}', '3').replace('{total}', '12')}
          </button>
        ))}
      </div>
      <div className="seg">
        {(['bottom-left', 'bottom-center', 'bottom-right', 'top-right'] as const).map((p) => (
          <button key={p} className={o.position === p ? 'on' : ''} onClick={() => set({ position: p })}>
            {cap(p.replace('-', ' '))}
          </button>
        ))}
      </div>
      <div className="grid2">
        <label>
          <span>Size</span>
          <input type="number" min={6} max={24} value={o.size} onChange={(e) => set({ size: +e.target.value || 10 })} />
        </label>
        <label>
          <span>Start at</span>
          <input type="number" min={0} value={o.startAt} onChange={(e) => set({ startAt: +e.target.value || 1 })} />
        </label>
      </div>
      <label className="field">
        <input type="checkbox" checked={o.skipFirst} onChange={(e) => set({ skipFirst: e.target.checked })} /> Skip the first page
      </label>
      <div className="modal-foot">
        <button className="ghost" onClick={onClose}>Cancel</button>
        <button
          className="solid"
          onClick={async () => {
            await addPageNumbers(o);
            onClose();
          }}
        >
          Add numbers
        </button>
      </div>
    </Modal>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ...TOOL_LIST.map((t) => [t.key, cap(t.label)] as [string, string]),
    ['Ctrl Z / Ctrl Y', 'Undo / redo'],
    ['Ctrl F', 'Find & replace'],
    ['Hold Space', 'Show the original'],
    ['Del', 'Delete selection'],
    ['Arrows', 'Nudge (Shift = 10 pt)'],
    ['Ctrl + / −', 'Zoom'],
    ['Ctrl V', 'Paste an image'],
    ['Esc', 'Deselect'],
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <dl className="keys">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

/** Draw a signature; returns a trimmed transparent PNG. */
export function SignatureDialog({ onClose, onDone }: { onClose: () => void; onDone: (dataUrl: string, w: number, h: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState('#1f2a44');
  const drawing = useRef(false);
  const last = useRef<[number, number] | null>(null);

  useEffect(() => {
    const c = ref.current!;
    c.width = 1000;
    c.height = 360;
  }, []);

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 1000, ((e.clientY - r.top) / r.height) * 360];
  };

  const finish = () => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (d[(y * c.width + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 <= x0) return onClose();
    const pad = 8;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(c.width, x1 + pad); y1 = Math.min(c.height, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0;
    out.height = y1 - y0;
    out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    onDone(out.toDataURL('image/png'), out.width, out.height);
  };

  return (
    <Modal title="Signature" onClose={onClose} wide>
      <canvas
        ref={ref}
        className="sig-pad"
        onPointerDown={(e) => {
          drawing.current = true;
          last.current = pos(e);
          (e.target as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const p = pos(e);
          const ctx = ref.current!.getContext('2d')!;
          ctx.strokeStyle = color;
          ctx.lineWidth = 5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(...last.current);
          ctx.lineTo(...p);
          ctx.stroke();
          last.current = p;
        }}
        onPointerUp={() => (drawing.current = false)}
      />
      <div className="modal-foot">
        <label className="swatch" title="Ink colour">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          <span style={{ background: color }} />
        </label>
        <button className="ghost" onClick={() => ref.current!.getContext('2d')!.clearRect(0, 0, 1000, 360)}>Clear</button>
        <span className="grow" />
        <button className="ghost" onClick={onClose}>Cancel</button>
        <button className="solid" onClick={finish}>Insert</button>
      </div>
    </Modal>
  );
}

export function VersionsDialog({ onClose }: { onClose: () => void }) {
  const versions = useStore((s) => s.versions);
  const [label, setLabel] = useState('');
  const s = useStore.getState();
  const edits = (pages: { annotations: unknown[] }[]) => pages.reduce((n, p) => n + p.annotations.length, 0);
  return (
    <Modal title="Version history" onClose={onClose}>
      <p className="muted">
        A version is saved automatically before every translation and each time you download. Restoring one is undoable.
      </p>
      <div className="row nowrap">
        <input placeholder="Name this version, e.g. Sent to client" value={label} onChange={(e) => setLabel(e.target.value)} className="grow" />
        <button
          className="solid small"
          onClick={() => {
            s.saveVersion(label.trim() || 'Saved by you');
            setLabel('');
          }}
        >
          Save version
        </button>
      </div>
      <div className="versions">
        <div className="version current">
          <Icon name="clock" size={16} />
          <div className="grow">
            <div>Current</div>
            <div className="faint">{plural(edits(s.pages), "edit")}</div>
          </div>
        </div>
        {versions.map((v) => (
          <div key={v.id} className="version">
            <Icon name="clock" size={16} />
            <div className="grow">
              <div>{v.label}</div>
              <div className="faint">
                {timeAgo(v.at)} · {plural(edits(v.pages), "edit")}
              </div>
            </div>
            <button
              className="ghost small"
              onClick={() => {
                s.restoreVersion(v.id);
                onClose();
              }}
            >
              Restore
            </button>
            <IconButton icon="trash" label="Delete this version" onClick={() => s.deleteVersion(v.id)} />
          </div>
        ))}
        {!versions.length && <p className="faint">No versions yet.</p>}
      </div>
    </Modal>
  );
}

export function WatermarkDialog({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.watermark);
  const [text, setText] = useState(current?.text ?? 'COPY');
  const [opacity, setOpacity] = useState(current?.opacity ?? 0.15);
  return (
    <Modal title="Watermark" onClose={onClose}>
      <p className="muted">Printed diagonally across every page of the downloaded PDF.</p>
      <div className="seg">
        {['COPY', 'PAID', 'DRAFT', 'КОПИЕ', 'ПЛАТЕНО'].map((t) => (
          <button key={t} className={text === t ? 'on' : ''} onClick={() => setText(t)}>
            {t}
          </button>
        ))}
      </div>
      <label className="stack">
        <span>Text</span>
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="slider">
        <span>Strength</span>
        <input type="range" min={0.05} max={0.5} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} />
      </label>
      <div className="modal-foot">
        {current && (
          <button
            className="ghost"
            onClick={() => {
              useStore.getState().setWatermark(null);
              onClose();
            }}
          >
            Remove
          </button>
        )}
        <span className="grow" />
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="solid"
          disabled={!text.trim()}
          onClick={() => {
            useStore.getState().setWatermark({ text: text.trim(), opacity });
            onClose();
          }}
        >
          Apply
        </button>
      </div>
    </Modal>
  );
}

export function GlossaryDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<GlossaryEntry[]>(() => [...getGlossary(), { term: '', translation: '' }]);
  const [mem, setMem] = useState(memorySize());
  const set = (i: number, patch: Partial<GlossaryEntry>) => {
    const next = rows.map((r, k) => (k === i ? { ...r, ...patch } : r));
    if (next[next.length - 1].term) next.push({ term: '', translation: '' });
    setRows(next);
  };
  return (
    <Modal title="Translation glossary" onClose={onClose} wide>
      <p className="muted">
        Terms here are never sent to the translator as-is: they always become exactly what you write, or stay unchanged if you leave the
        translation empty. Use it for names, brands, addresses and your own wording.
      </p>
      <div className="glossary">
        <div className="glossary-head">
          <span>Term</span>
          <span>Always translate as (empty = keep)</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="glossary-row">
            <input value={r.term} placeholder="e.g. Nottingham" onChange={(e) => set(i, { term: e.target.value })} />
            <input value={r.translation} placeholder="e.g. Нотингам" onChange={(e) => set(i, { translation: e.target.value })} />
            {r.term ? <IconButton icon="trash" label="Remove" onClick={() => setRows(rows.filter((_, k) => k !== i))} /> : <span />}
          </div>
        ))}
      </div>
      <p className="note">
        Translation memory: {mem} correction{mem === 1 ? '' : 's'} remembered. When you fix a translated block, the next translation of the same text uses your
        version.{' '}
        {mem > 0 && (
          <button
            className="link-btn"
            onClick={() => {
              clearMemory();
              setMem(0);
            }}
          >
            Forget them
          </button>
        )}
      </p>
      <div className="modal-foot">
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="solid"
          onClick={() => {
            setGlossary(rows);
            onClose();
          }}
        >
          Save glossary
        </button>
      </div>
    </Modal>
  );
}
