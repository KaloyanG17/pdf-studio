import { learnFrom } from './glossary';
import { saveDoc, saveFile } from './library';
import { useStore } from './store';

/** Autosave: every change to the open document is written to the library shortly after. */
const savedFiles = new Map<string, number>();
let timer: number | undefined;
let lastSavedAt = 0;
const listeners = new Set<() => void>();

export const lastSaved = () => lastSavedAt;
export function onSaved(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export async function saveNow() {
  window.clearTimeout(timer);
  const s = useStore.getState();
  if (!s.docId || !s.docMeta || !s.pages.length) return;
  const id = s.docId;
  learnFrom(s.pages); // remember corrected translations for next time
  // Merged-in PDFs are new source files: store them too.
  for (let i = savedFiles.get(id) ?? 0; i < s.sources.length; i++) await saveFile(id, i, s.sources[i].bytes);
  savedFiles.set(id, s.sources.length);
  const edited = s.pages.some((p) => p.annotations.length > 0);
  const tags = [...s.tags.filter((t) => t !== 'Edited'), ...(edited && !s.tags.some((t) => t.startsWith('Translated')) ? ['Edited'] : [])];
  await saveDoc({
    id,
    name: s.fileName || 'Untitled',
    createdAt: s.docMeta.createdAt,
    updatedAt: Date.now(),
    pageCount: s.pages.length,
    thumb: s.docMeta.thumb,
    tags,
    pages: s.pages,
    sourceNames: s.sources.map((x) => x.name),
    versions: s.versions,
    watermark: s.watermark,
  });
  lastSavedAt = Date.now();
  listeners.forEach((l) => l());
}

export function startAutosave() {
  useStore.subscribe((s, prev) => {
    if (!s.docId) return;
    if (s.docId !== prev.docId) {
      savedFiles.set(s.docId, s.sources.length); // freshly created / opened: files are already stored
      return;
    }
    const dirty =
      s.pages !== prev.pages ||
      s.fileName !== prev.fileName ||
      s.versions !== prev.versions ||
      s.tags !== prev.tags ||
      s.watermark !== prev.watermark ||
      s.sources.length !== prev.sources.length;
    if (!dirty) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void saveNow().catch((e) => console.warn('Autosave failed', e)), 600);
  });
  // Don't lose the last half-second of work when the tab closes.
  window.addEventListener('pagehide', () => void saveNow());
}
