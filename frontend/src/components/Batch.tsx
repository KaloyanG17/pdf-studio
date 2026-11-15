import { zipSync } from 'fflate';
import { useEffect, useRef, useState } from 'react';
import { buildPdf, download, getTranslateInfo, type TranslateInfo } from '../lib/api';
import { detectDocument, oppositeOf } from '../lib/detect';
import { saveNow } from '../lib/persist';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { translatePages } from '../lib/translate';
import { Icon } from './Icon';
import { IconButton, ThemeToggle } from './Toolbar';

type Status = 'waiting' | 'working' | 'done' | 'failed';
interface Item {
  file: File;
  status: Status;
  note?: string;
  docId?: string;
  out?: Uint8Array;
  /** Language this file was translated into (per file in auto mode). */
  target?: string;
}

/** Translate many PDFs in one go; each result is also saved to the library. */
export function Batch() {
  const [items, setItems] = useState<Item[]>([]);
  const [info, setInfo] = useState<TranslateInfo | null>(null);
  // 'pair': detect each file and translate Bulgarian ⇄ English.
  const [source, setSource] = useState('pair');
  const [target, setTarget] = useState('bg');
  const [provider, setProvider] = useState('');
  const [running, setRunning] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getTranslateInfo()
      .then((i) => {
        setInfo(i);
        setProvider(i.defaultProvider);
      })
      .catch(() => setInfo(null));
  }, []);

  const add = (files: FileList | null) => {
    const pdfs = [...(files ?? [])].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    setItems((cur) => [...cur, ...pdfs.map((file) => ({ file, status: 'waiting' as Status }))]);
  };

  const run = async () => {
    setRunning(true);
    const list = [...items];
    const update = (i: number, patch: Partial<Item>) => {
      list[i] = { ...list[i], ...patch };
      setItems([...list]);
    };
    for (let i = 0; i < list.length; i++) {
      if (list[i].status === 'done') continue;
      update(i, { status: 'working', note: 'Opening…' });
      try {
        const s = useStore.getState();
        const id = await s.createDoc([list[i].file]);
        if (!id) throw new Error('Could not open this PDF');
        let src = source;
        let tgt = target;
        if (source === 'pair') {
          const lang = await detectDocument();
          src = lang ?? 'auto';
          tgt = oppositeOf(lang ?? 'en');
        }
        const names = info?.languages ?? {};
        update(i, { note: src === 'auto' ? 'Translating…' : `Translating ${names[src] ?? src} → ${names[tgt] ?? tgt}…`, docId: id, target: tgt });
        const r = await translatePages({
          pageIds: useStore.getState().pages.map((p) => p.id),
          source: src,
          target: tgt,
          provider,
          font: 'auto',
        });
        await saveNow();
        update(i, { note: 'Building PDF…' });
        const st = useStore.getState();
        const blob = await buildPdf(st.pages, st.fileName);
        update(i, {
          status: 'done',
          out: new Uint8Array(await blob.arrayBuffer()),
          note: r.blocks ? `${r.blocks} blocks translated${src !== 'auto' ? ` (${src.toUpperCase()} → ${tgt.toUpperCase()})` : ''}` : 'No selectable text (scanned?)',
        });
      } catch (e) {
        update(i, { status: 'failed', note: (e as Error).message });
      }
    }
    useStore.getState().closeDoc();
    setRunning(false);
  };

  const done = items.filter((i) => i.status === 'done' && i.out);
  const zip = () => {
    const files: Record<string, Uint8Array> = {};
    for (const it of done) {
      const t = it.target ?? target;
      let name = it.file.name.replace(/\.pdf$/i, '') + `-${t}.pdf`;
      for (let k = 2; files[name]; k++) name = it.file.name.replace(/\.pdf$/i, '') + `-${t}-${k}.pdf`;
      files[name] = it.out!;
    }
    download(new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: 'application/zip' }), `translated${source === 'pair' ? '' : `-${target}`}.zip`);
  };

  const langs = info ? Object.entries(info.languages) : [];
  return (
    <div className="home batch">
      <div className="ambient" />
      <input ref={input} type="file" accept="application/pdf" multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
      <header className="home-bar">
        <IconButton icon="home" label="Back to your documents" onClick={() => navigate('/')} />
        <div className="brand">
          <span className="dot" /> Batch translate
        </div>
        <span className="grow" />
        <ThemeToggle />
      </header>

      <section className="batch-panel glass heavy">
        <div className="lang-row">
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="From" disabled={running}>
            <option value="pair">Auto: Bulgarian ⇄ English</option>
            <option value="auto">Detect language</option>
            {langs.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            title="Swap languages"
            disabled={running || source === 'auto' || source === 'pair'}
            onClick={() => {
              setSource(target);
              setTarget(source);
            }}
          >
            <Icon name="swap" />
          </button>
          <select value={source === 'pair' ? 'pair' : target} onChange={(e) => setTarget(e.target.value)} aria-label="To" disabled={running || source === 'pair'}>
            {source === 'pair' && <option value="pair">the other language</option>}
            {langs.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Engine" disabled={running}>
            {info?.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div
          className="batch-drop"
          onClick={() => !running && input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!running) add(e.dataTransfer.files);
          }}
        >
          <Icon name="open" size={22} />
          <span>Add PDFs, or drop them here</span>
        </div>

        {!!items.length && (
          <div className="batch-list">
            {items.map((it, i) => (
              <div key={i} className={`batch-item ${it.status}`}>
                <span className="batch-dot" />
                <div className="grow">
                  <div className="batch-name">{it.file.name}</div>
                  <div className="faint">{it.note ?? 'Waiting'}</div>
                </div>
                {it.status === 'done' && it.docId && (
                  <button className="ghost small" onClick={() => navigate(`/doc/${it.docId}`)}>
                    Open
                  </button>
                )}
                {!running && it.status !== 'done' && (
                  <IconButton icon="close" label="Remove" onClick={() => setItems(items.filter((_, k) => k !== i))} />
                )}
              </div>
            ))}
          </div>
        )}

        {provider === 'mymemory' && <p className="note">The free engine allows about 5,000 characters a day, so it will run out quickly on many invoices.</p>}

        <div className="modal-foot">
          {done.length > 0 && !running && (
            <button className="ghost" onClick={zip}>
              <Icon name="download" size={16} /> Download ZIP ({done.length})
            </button>
          )}
          <button className="solid" disabled={running || !items.some((i) => i.status !== 'done') || source === target} onClick={run}>
            {running ? 'Translating…' : `Translate ${items.filter((i) => i.status !== 'done').length || ''} PDF${items.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </section>
    </div>
  );
}
