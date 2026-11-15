import { create } from 'zustand';
import { clearEmbedded } from './embedded';
import * as lib from './library';
import type { Version, Watermark } from './library';
import { getPage, getTextLines, openPdf, type PDFDocumentProxy } from './pdf';
import { uid, type Annotation, type Page, type Rotation, type Style, type Tool } from './types';

/** Small JPEG of the first page for the library grid. */
async function makeThumb(doc: PDFDocumentProxy): Promise<string> {
  const page = await getPage(doc, 0);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 360 / base.width });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width);
  c.height = Math.ceil(vp.height);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, viewport: vp, intent: 'print' }).promise;
  return c.toDataURL('image/jpeg', 0.8);
}

export interface Source {
  name: string;
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
}

interface Selection {
  pageId: string;
  annId: string;
}

interface State {
  fileName: string;
  sources: Source[];
  pages: Page[];
  past: Page[][];
  future: Page[][];
  tool: Tool;
  style: Style;
  zoom: number;
  selected: Selection | null;
  editingId: string | null;
  currentPageId: string | null;
  busy: string | null;
  showOriginal: boolean;
  toggleOriginal(): void;

  // ---- library document
  docId: string | null;
  docMeta: { createdAt: number; thumb: string } | null;
  tags: string[];
  versions: Version[];
  watermark: Watermark | null;
  /** Side-by-side review: original page next to the edited one. */
  split: boolean;
  /** What to do right after a document opens (set by the home page's quick actions). */
  intent: 'translate' | 'sign' | 'edit' | null;
  /** Bumped when original fonts finish loading so text re-renders with them. */
  fontsVersion: number;
  createDoc(files: File[]): Promise<string | null>;
  openDoc(id: string): Promise<boolean>;
  closeDoc(): void;
  saveVersion(label: string): void;
  restoreVersion(id: string): void;
  deleteVersion(id: string): void;
  addTag(tag: string): void;
  setWatermark(w: Watermark | null): void;
  toggleSplit(): void;
  setIntent(i: State['intent']): void;

  loadFiles(files: File[], mode: 'replace' | 'append'): Promise<void>;
  setTool(t: Tool): void;
  setStyle(p: Partial<Style>): void;
  setZoom(z: number): void;
  select(s: Selection | null): void;
  setEditing(id: string | null): void;
  setCurrentPage(id: string): void;
  setBusy(msg: string | null): void;

  /** Push a history snapshot (call once before a series of non-recorded updates). */
  checkpoint(): void;
  commit(fn: (pages: Page[]) => Page[]): void;
  undo(): void;
  redo(): void;

  addAnnotation(pageId: string, a: Annotation, select?: boolean): void;
  updateAnnotation(pageId: string, id: string, patch: Partial<Annotation>, record?: boolean): void;
  removeAnnotation(pageId: string, id: string): void;

  rotatePage(id: string, delta: 90 | -90): void;
  deletePage(id: string): void;
  duplicatePage(id: string): void;
  movePage(from: number, to: number): void;
  insertBlank(afterIndex: number): void;
}

const HISTORY_LIMIT = 100;
let splitPrevZoom: number | null = null;

export const useStore = create<State>((set, get) => ({
  fileName: '',
  sources: [],
  pages: [],
  past: [],
  future: [],
  tool: 'select',
  style: {
    color: '#211a1d',
    fill: null,
    strokeWidth: 2,
    fontSize: 14,
    font: 'sans',
    bold: false,
    italic: false,
    opacity: 1,
  },
  zoom: 1.25,
  selected: null,
  editingId: null,
  currentPageId: null,
  busy: null,
  showOriginal: false,
  toggleOriginal: () => set({ showOriginal: !get().showOriginal, selected: null, editingId: null }),

  docId: null,
  docMeta: null,
  tags: [],
  versions: [],
  watermark: null,
  split: false,
  intent: null,
  fontsVersion: 0,

  async createDoc(files) {
    await get().loadFiles(files, 'replace');
    const { pages, sources, fileName } = get();
    if (!pages.length) return null;
    const id = uid();
    const now = Date.now();
    const thumb = await makeThumb(sources[0].doc).catch(() => '');
    for (const [i, s] of sources.entries()) await lib.saveFile(id, i, s.bytes);
    await lib.saveDoc({
      id,
      name: fileName,
      createdAt: now,
      updatedAt: now,
      pageCount: pages.length,
      thumb,
      tags: [],
      pages,
      sourceNames: sources.map((s) => s.name),
      versions: [],
      watermark: null,
    });
    set({ docId: id, docMeta: { createdAt: now, thumb }, tags: [], versions: [], watermark: null, split: false });
    return id;
  },

  async openDoc(id) {
    if (get().docId === id && get().pages.length) return true;
    set({ busy: 'Opening' });
    try {
      const rec = await lib.getDoc(id);
      if (!rec) return false;
      const files = await lib.loadFiles(id, rec.sourceNames.length);
      const sources: Source[] = [];
      for (const [i, bytes] of files.entries()) sources.push({ name: rec.sourceNames[i], bytes, doc: await openPdf(bytes) });
      clearEmbedded();
      set({
        sources,
        pages: rec.pages,
        past: [],
        future: [],
        selected: null,
        editingId: null,
        showOriginal: false,
        split: false,
        fileName: rec.name,
        currentPageId: rec.pages[0]?.id ?? null,
        docId: id,
        docMeta: { createdAt: rec.createdAt, thumb: rec.thumb },
        tags: rec.tags ?? [],
        versions: rec.versions ?? [],
        watermark: rec.watermark ?? null,
      });
      // Recognised text of scanned pages comes back with the document.
      if (rec.pages.some((p) => p.ocr)) {
        const { registerOcr } = await import('./ocr');
        for (const p of rec.pages) if (p.ocr && p.source) registerOcr(sources[p.source.file].doc, p.source.index, p.ocr);
      }
      // Text that uses a font from the original PDF needs that page's fonts loaded again.
      void (async () => {
        for (const p of rec.pages) {
          if (!p.source || !p.annotations.some((a) => a.type === 'text' && a.fontRef)) continue;
          await getTextLines(sources[p.source.file].doc, p.source.index).catch(() => undefined);
        }
        set({ fontsVersion: get().fontsVersion + 1 });
      })();
      return true;
    } catch (e) {
      alert(`Could not open this document: ${(e as Error).message}`);
      return false;
    } finally {
      set({ busy: null });
    }
  },

  closeDoc() {
    set({ sources: [], pages: [], past: [], future: [], selected: null, editingId: null, docId: null, docMeta: null, tags: [], versions: [], watermark: null, fileName: '' });
  },

  saveVersion(label) {
    const v: Version = { id: uid(), at: Date.now(), label, pages: get().pages };
    set({ versions: [v, ...get().versions].slice(0, 30) });
  },
  restoreVersion(id) {
    const v = get().versions.find((x) => x.id === id);
    if (v) {
      get().commit(() => v.pages);
      set({ selected: null, editingId: null });
    }
  },
  deleteVersion: (id) => set({ versions: get().versions.filter((v) => v.id !== id) }),
  addTag: (tag) => set({ tags: [tag, ...get().tags.filter((t) => t !== tag && !(tag.startsWith('Translated') && t.startsWith('Translated')))] }),
  setWatermark: (watermark) => set({ watermark }),
  toggleSplit() {
    const on = !get().split;
    if (on) {
      // Fit both columns (original + edited) into the space between the side panels.
      const widest = Math.max(...get().pages.map((p) => (p.rotation % 180 ? p.height : p.width)));
      const room = window.innerWidth - 270 - 24 - 24 - 24;
      splitPrevZoom = get().zoom;
      get().setZoom(Math.min(get().zoom, Math.max(0.4, room / (2 * widest))));
    } else if (splitPrevZoom) get().setZoom(splitPrevZoom);
    set({ split: on, selected: null, editingId: null });
  },
  setIntent: (intent) => set({ intent }),

  async loadFiles(files, mode) {
    set({ busy: 'Opening' });
    try {
      const sources = mode === 'replace' ? [] : [...get().sources];
      const newPages: Page[] = [];
      for (const f of files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const doc = await openPdf(bytes);
        const fileIndex = sources.length;
        sources.push({ name: f.name, bytes, doc });
        for (let i = 0; i < doc.numPages; i++) {
          const p = await getPage(doc, i);
          const vp = p.getViewport({ scale: 1 });
          newPages.push({
            id: uid(),
            source: { file: fileIndex, index: i },
            width: vp.width,
            height: vp.height,
            rotation: 0,
            annotations: [],
          });
        }
      }
      if (mode === 'replace') {
        clearEmbedded();
        set({
          sources,
          pages: newPages,
          past: [],
          future: [],
          selected: null,
          editingId: null,
          fileName: files[0]?.name.replace(/\.pdf$/i, '') ?? 'document',
          currentPageId: newPages[0]?.id ?? null,
        });
      } else {
        set({ sources });
        get().commit((pages) => [...pages, ...newPages]);
      }
    } catch (e) {
      alert(`Could not open PDF: ${(e as Error).message}`);
    } finally {
      set({ busy: null });
    }
  },

  setTool: (tool) => set({ tool, selected: tool === 'select' ? get().selected : null, editingId: null }),
  setStyle: (p) => set({ style: { ...get().style, ...p } }),
  setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.25, Math.round(zoom * 100) / 100)) }),
  select: (selected) => set({ selected, editingId: selected ? get().editingId : null }),
  setEditing: (editingId) => set({ editingId }),
  setCurrentPage: (currentPageId) => set({ currentPageId }),
  setBusy: (busy) => set({ busy }),

  checkpoint() {
    const { past, pages } = get();
    set({ past: [...past.slice(-HISTORY_LIMIT + 1), pages], future: [] });
  },
  commit(fn) {
    get().checkpoint();
    set({ pages: fn(get().pages) });
  },
  undo() {
    const { past, pages, future } = get();
    if (!past.length) return;
    set({ pages: past[past.length - 1], past: past.slice(0, -1), future: [pages, ...future], selected: null, editingId: null });
  },
  redo() {
    const { past, pages, future } = get();
    if (!future.length) return;
    set({ pages: future[0], future: future.slice(1), past: [...past, pages], selected: null, editingId: null });
  },

  addAnnotation(pageId, a, select = false) {
    get().commit((pages) => pages.map((p) => (p.id === pageId ? { ...p, annotations: [...p.annotations, a] } : p)));
    if (select) set({ selected: { pageId, annId: a.id } });
  },
  updateAnnotation(pageId, id, patch, record = true) {
    const fn = (pages: Page[]) =>
      pages.map((p) =>
        p.id === pageId
          ? { ...p, annotations: p.annotations.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)) }
          : p,
      );
    if (record) get().commit(fn);
    else set({ pages: fn(get().pages) });
  },
  removeAnnotation(pageId, id) {
    get().commit((pages) => pages.map((p) => (p.id === pageId ? { ...p, annotations: p.annotations.filter((a) => a.id !== id) } : p)));
    const s = get().selected;
    if (s?.annId === id) set({ selected: null, editingId: null });
  },

  rotatePage(id, delta) {
    get().commit((pages) =>
      pages.map((p) => (p.id === id ? { ...p, rotation: (((p.rotation + delta) % 360) + 360) % 360 as Rotation } : p)),
    );
  },
  deletePage(id) {
    if (get().pages.length <= 1) return alert('A document needs at least one page.');
    get().commit((pages) => pages.filter((p) => p.id !== id));
  },
  duplicatePage(id) {
    get().commit((pages) => {
      const i = pages.findIndex((p) => p.id === id);
      const copy: Page = {
        ...pages[i],
        id: uid(),
        annotations: pages[i].annotations.map((a) => ({ ...a, id: uid() })),
      };
      return [...pages.slice(0, i + 1), copy, ...pages.slice(i + 1)];
    });
  },
  movePage(from, to) {
    if (from === to) return;
    get().commit((pages) => {
      const next = [...pages];
      const [p] = next.splice(from, 1);
      next.splice(to, 0, p);
      return next;
    });
  },
  insertBlank(afterIndex) {
    get().commit((pages) => {
      const ref = pages[afterIndex] ?? pages[0];
      const w = ref ? (ref.rotation % 180 ? ref.height : ref.width) : 595.28;
      const h = ref ? (ref.rotation % 180 ? ref.width : ref.height) : 841.89;
      const blank: Page = { id: uid(), source: null, width: w, height: h, rotation: 0, annotations: [] };
      return [...pages.slice(0, afterIndex + 1), blank, ...pages.slice(afterIndex + 1)];
    });
  },
}));

export const findPage = (id: string | null | undefined) => useStore.getState().pages.find((p) => p.id === id);

// Handy for debugging in the browser console during development.
if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore;
