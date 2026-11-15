import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteDoc, listDocs, onLibraryChange, renameDoc, timeAgo, type DocRecord } from '../lib/library';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { DocArt, Icon, type IconName } from './Icon';
import { IconButton, ThemeToggle } from './Toolbar';

type Intent = 'edit' | 'translate' | 'sign';

const ACTIONS: { id: Intent | 'batch'; icon: IconName; title: string; text: string }[] = [
  { id: 'edit', icon: 'edittext', title: 'Edit text', text: 'Change any line in its original font' },
  { id: 'translate', icon: 'translate', title: 'Translate', text: 'Bulgarian ⇄ English, layout intact' },
  { id: 'sign', icon: 'sign', title: 'Sign', text: 'Draw a signature and place it' },
  { id: 'batch', icon: 'merge', title: 'Batch translate', text: 'Many PDFs at once, one ZIP' },
];

export function Home() {
  const [docs, setDocs] = useState<DocRecord[] | null>(null);
  const [query, setQuery] = useState('');
  const [drag, setDrag] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const busy = useStore((s) => s.busy);
  const input = useRef<HTMLInputElement>(null);
  const intent = useRef<Intent>('edit');

  useEffect(() => {
    const load = () => listDocs().then(setDocs).catch(() => setDocs([]));
    load();
    return onLibraryChange(load);
  }, []);

  const open = async (files: FileList | File[] | null) => {
    const pdfs = [...(files ?? [])].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!pdfs.length) return;
    const s = useStore.getState();
    const id = await s.createDoc(pdfs.slice(0, 1));
    if (!id) return;
    s.setIntent(intent.current === 'edit' ? null : intent.current);
    navigate(`/doc/${id}`);
  };

  const pick = (i: Intent | 'batch') => {
    if (i === 'batch') return navigate('/batch');
    intent.current = i;
    input.current?.click();
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (docs ?? []).filter((d) => !q || d.name.toLowerCase().includes(q) || d.tags.some((t) => t.toLowerCase().includes(q)));
  }, [docs, query]);

  return (
    <div
      className={`home ${drag ? 'drag' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        intent.current = 'edit';
        void open(e.dataTransfer.files);
      }}
    >
      <div className="ambient" />
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          void open(e.target.files);
          e.target.value = '';
        }}
      />
      <header className="home-bar">
        <div className="brand">
          <span className="dot" /> PDF Studio
        </div>
        <span className="grow" />
        <ThemeToggle />
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>
            Invoices and documents,
            <br />
            <em>edited cleanly.</em>
          </h1>
          <p>Change text in the original font, translate Bulgarian ⇄ English with the layout intact, then sign and send. Everything you open is kept here.</p>
          <div className="hero-cta">
            <button
              className="solid big"
              onClick={() => {
                intent.current = 'edit';
                input.current?.click();
              }}
            >
              Open a PDF
            </button>
            <span className="faint">{busy ? `${busy}…` : 'or drop a file anywhere'}</span>
          </div>
        </div>
        <div className="hero-art glass heavy">
          <DocArt />
        </div>
      </section>

      <section className="actions">
        {ACTIONS.map((a) => (
          <button key={a.id} className="action glass" onClick={() => pick(a.id)}>
            <span className="action-icon">
              <Icon name={a.icon} />
            </span>
            <span className="action-title">{a.title}</span>
            <span className="action-text">{a.text}</span>
          </button>
        ))}
      </section>

      <section className="library">
        <div className="library-head">
          <h2>
            Your documents {docs?.length ? <span className="faint">{docs.length}</span> : null}
          </h2>
          {!!docs?.length && (
            <label className="search">
              <Icon name="search" size={16} />
              <input placeholder="Search by name or tag" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
        </div>

        {docs === null ? null : docs.length === 0 ? (
          <div className="library-empty glass">
            <p>No documents yet. Anything you open, edit or translate is saved here automatically, and stays on this computer.</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="muted">Nothing matches “{query}”.</p>
        ) : (
          <div className="grid">
            {shown.map((d) => (
              <article key={d.id} className="card glass" onClick={() => navigate(`/doc/${d.id}`)}>
                <div className="card-thumb">{d.thumb ? <img src={d.thumb} alt="" draggable={false} /> : <Icon name="page" size={32} />}</div>
                <div className="card-body">
                  <div className="card-title" title={d.name}>
                    {d.name}
                  </div>
                  <div className="card-meta">
                    {timeAgo(d.updatedAt)} · {d.pageCount} page{d.pageCount === 1 ? '' : 's'}
                    {d.versions?.length ? ` · ${d.versions.length} version${d.versions.length === 1 ? '' : 's'}` : ''}
                  </div>
                  {!!d.tags.length && (
                    <div className="card-tags">
                      {d.tags.slice(0, 3).map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="card-menu" onClick={(e) => e.stopPropagation()}>
                  <IconButton icon="more" label="More" onClick={() => setMenu(menu === d.id ? null : d.id)} />
                  {menu === d.id && (
                    <div className="menu glass heavy" onMouseLeave={() => setMenu(null)}>
                      <button
                        onClick={async () => {
                          setMenu(null);
                          const name = prompt('Rename document', d.name);
                          if (name?.trim()) await renameDoc(d.id, name.trim());
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="danger"
                        onClick={async () => {
                          setMenu(null);
                          if (confirm(`Delete “${d.name}” and its history from this computer? This cannot be undone.`)) await deleteDoc(d.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {drag && <div className="drop-hint">Drop a PDF to open it</div>}
    </div>
  );
}
