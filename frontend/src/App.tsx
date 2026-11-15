import { useEffect, useRef, useState } from 'react';
import { Batch } from './components/Batch';
import {
  FindReplaceDialog,
  GlossaryDialog,
  PageNumbersDialog,
  ShortcutsDialog,
  SignatureDialog,
  TranslateDialog,
  VersionsDialog,
  WatermarkDialog,
} from './components/Dialogs';
import { AccountDialogs } from './components/Account';
import { Home } from './components/Home';
import { PageView } from './components/PageView';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Sidebar } from './components/Sidebar';
import { ContextBar, TOOL_KEYS, ToolRail, TopBar } from './components/Toolbar';
import { pullDoc } from './lib/cloud';
import { loadFonts } from './lib/fonts';
import { moveBy } from './lib/geometry';
import { saveNow } from './lib/persist';
import { docIdOf, navigate, usePath } from './lib/router';
import { useStore } from './lib/store';
import { uid, type Tool } from './lib/types';

type Dialog = 'translate' | 'sign' | 'find' | 'numbers' | 'keys' | 'versions' | 'watermark' | 'glossary' | null;

export default function App() {
  const path = usePath();
  useEffect(() => {
    let tries = 0;
    const attempt = () =>
      loadFonts().catch(() => {
        if (++tries < 20) setTimeout(attempt, 1500);
        else console.warn('fonts could not be loaded. is the backend running?');
      });
    attempt();
  }, []);

  const docId = docIdOf(path);
  return (
    <>
      {docId ? <DocRoute id={docId} /> : path === '/batch' ? <Batch /> : <Home />}
      <AccountDialogs />
    </>
  );
}

/** Loads a library document for the editor; unknown ids go back to the library. */
function DocRoute({ id }: { id: string }) {
  const current = useStore((s) => s.docId);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    if (useStore.getState().docId !== id) {
      void (async () => {
        await saveNow(); // keep whatever was open before
        let ok = await useStore.getState().openDoc(id);
        // Not on this computer yet: fetch it from the signed-in user's cloud library.
        if (!ok && (await pullDoc(id).catch(() => false))) ok = await useStore.getState().openDoc(id);
        if (live && !ok) setMissing(true);
      })();
    }
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => {
    if (missing) navigate('/', true);
  }, [missing]);
  if (current !== id)
    return (
      <div className="loading">
        <div className="ambient" />
        <span className="bar" />
      </div>
    );
  return <Editor key={id} />;
}

/** Reads an image file as PNG/JPEG data URL (other formats are converted to PNG). */
async function readImage(file: Blob): Promise<{ src: string; w: number; h: number }> {
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = new Image();
  img.src = url;
  await img.decode();
  let src = url;
  if (!/^data:image\/(png|jpe?g);/i.test(url)) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    src = c.toDataURL('image/png');
  }
  return { src, w: img.naturalWidth, h: img.naturalHeight };
}

function placeImage(src: string, w: number, h: number, maxW = 220) {
  const { pages, currentPageId, addAnnotation, setTool } = useStore.getState();
  const page = pages.find((p) => p.id === currentPageId) ?? pages[0];
  if (!page) return;
  const scale = Math.min(1, maxW / w, (page.height * 0.8) / h);
  const iw = w * scale;
  const ih = h * scale;
  setTool('select');
  addAnnotation(page.id, { type: 'image', id: uid(), x: (page.width - iw) / 2, y: (page.height - ih) / 2, w: iw, h: ih, src }, true);
}

function Editor() {
  const pages = useStore((s) => s.pages);
  const busy = useStore((s) => s.busy);
  const selected = useStore((s) => s.selected);
  const showOriginal = useStore((s) => s.showOriginal);
  const split = useStore((s) => s.split);
  const pdfInput = useRef<HTMLInputElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  // Quick actions from the home page land here.
  useEffect(() => {
    const s = useStore.getState();
    if (s.intent === 'translate') setDialog('translate');
    else if (s.intent === 'sign') setDialog('sign');
    if (s.intent) s.setIntent(null);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('.modal')) return;
      const s = useStore.getState();
      if (!s.pages.length) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        s.redo();
      } else if (mod && k === 'f') {
        e.preventDefault();
        setDialog('find');
      } else if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        if (!s.showOriginal) s.toggleOriginal();
      } else if (e.key === '?') {
        setDialog('keys');
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected) {
        e.preventDefault();
        s.removeAnnotation(s.selected.pageId, s.selected.annId);
      } else if (e.key === 'Escape') {
        s.select(null);
        s.setTool('select');
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        s.setZoom(s.zoom + 0.25);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        s.setZoom(s.zoom - 0.25);
      } else if (!mod && !e.altKey && TOOL_KEYS[k]) {
        s.setTool(TOOL_KEYS[k] as Tool);
      } else if (s.selected && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const a = s.pages.find((p) => p.id === s.selected!.pageId)?.annotations.find((x) => x.id === s.selected!.annId);
        if (a) s.updateAnnotation(s.selected.pageId, a.id, moveBy(a, dx, dy));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && useStore.getState().showOriginal) useStore.getState().toggleOriginal();
    };
    const onPaste = async (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file || !useStore.getState().pages.length) return;
      const { src, w, h } = await readImage(file);
      placeImage(src, w, h);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  // Track which page is in view.
  const onScroll = () => {
    const main = mainRef.current;
    if (!main) return;
    const mid = main.getBoundingClientRect().top + main.clientHeight / 3;
    let best: string | null = null;
    for (const el of main.querySelectorAll<HTMLElement>('[data-page-id]')) {
      if (el.getBoundingClientRect().top <= mid) best = el.dataset.pageId!;
    }
    if (best && best !== useStore.getState().currentPageId) useStore.getState().setCurrentPage(best);
  };

  const openFiles = (files: FileList | File[] | null, mode: 'replace' | 'append') => {
    const pdfs = [...(files ?? [])].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!pdfs.length) return;
    if (mode === 'append') return void useStore.getState().loadFiles(pdfs, 'append');
    // Opening another file creates a new library document; this one is already saved.
    void (async () => {
      await saveNow();
      const id = await useStore.getState().createDoc(pdfs.slice(0, 1));
      if (id) navigate(`/doc/${id}`);
    })();
  };

  const hidden = (
    <>
      <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => { openFiles(e.target.files, 'replace'); e.target.value = ''; }} />
      <input ref={mergeInput} type="file" accept="application/pdf" multiple hidden onChange={(e) => { openFiles(e.target.files, 'append'); e.target.value = ''; }} />
      <input
        ref={imgInput}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const { src, w, h } = await readImage(f);
          placeImage(src, w, h);
        }}
      />
    </>
  );

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        setDragOver(true);
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget === e.target) setDragOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setDragOver(false);
      openFiles(e.dataTransfer.files, pages.length ? 'append' : 'replace');
    },
  };

  return (
    <div className={`app ${showOriginal ? 'original' : ''} ${selected && !showOriginal ? 'has-props' : ''} ${split ? 'split' : ''}`} {...dropProps}>
      <div className="ambient" />
      {hidden}
      <TopBar
        onHome={async () => {
          await saveNow();
          navigate('/');
        }}
        onOpen={() => pdfInput.current?.click()}
        onTranslate={() => setDialog('translate')}
        onFind={() => setDialog('find')}
        onNumbers={() => setDialog('numbers')}
        onShortcuts={() => setDialog('keys')}
        onVersions={() => setDialog('versions')}
        onWatermark={() => setDialog('watermark')}
        onGlossary={() => setDialog('glossary')}
      />
      <ContextBar />
      <div className="body">
        <Sidebar onMerge={() => mergeInput.current?.click()} />
        <ToolRail onImage={() => imgInput.current?.click()} onSignature={() => setDialog('sign')} />
        <main ref={mainRef} className="main" onScroll={onScroll}>
          {split && (
            <div className="split-head">
              <span>Original</span>
              <span>Edited</span>
            </div>
          )}
          {pages.map((p, i) =>
            split ? (
              <div key={p.id} className="split-row">
                <PageView page={p} index={i} readOnly />
                <PageView page={p} index={i} />
              </div>
            ) : (
              <PageView key={p.id} page={p} index={i} />
            ),
          )}
        </main>
        {selected && !showOriginal && <PropertiesPanel />}
      </div>
      {showOriginal && <div className="badge-original glass heavy">Viewing the original</div>}
      {dialog === 'translate' && <TranslateDialog onClose={() => setDialog(null)} />}
      {dialog === 'find' && <FindReplaceDialog onClose={() => setDialog(null)} />}
      {dialog === 'numbers' && <PageNumbersDialog onClose={() => setDialog(null)} />}
      {dialog === 'keys' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'versions' && <VersionsDialog onClose={() => setDialog(null)} />}
      {dialog === 'watermark' && <WatermarkDialog onClose={() => setDialog(null)} />}
      {dialog === 'glossary' && <GlossaryDialog onClose={() => setDialog(null)} />}
      {dialog === 'sign' && (
        <SignatureDialog
          onClose={() => setDialog(null)}
          onDone={(src, w, h) => {
            setDialog(null);
            placeImage(src, w, h, 160);
          }}
        />
      )}
      {busy && (
        <div className="busy glass heavy">
          <span className="bar" />
          <span>{busy}…</span>
        </div>
      )}
      {dragOver && <div className="drop-hint">Drop to add pages</div>}
    </div>
  );
}
