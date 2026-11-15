import type { Page } from './types';

/**
 * The document library lives in the browser (IndexedDB): original PDF bytes plus the
 * edit state as JSON. Nothing is uploaded; a cloud sync can replace this module later.
 */
export interface Version {
  id: string;
  at: number;
  label: string;
  pages: Page[];
}

export interface Watermark {
  text: string;
  opacity: number;
}

export interface DocRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  /** Small JPEG data URL of the first page. */
  thumb: string;
  /** Short badges shown in the library, e.g. "Translated EN → BG". */
  tags: string[];
  pages: Page[];
  sourceNames: string[];
  versions: Version[];
  watermark?: Watermark | null;
}

const DB = 'pdf-studio';
const DOCS = 'docs';
const FILES = 'files';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DOCS, { keyPath: 'id' });
      req.result.createObjectStore(FILES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

const changed = new Set<() => void>();
export function onLibraryChange(fn: () => void) {
  changed.add(fn);
  return () => void changed.delete(fn);
}
const notify = () => changed.forEach((f) => f());

export async function listDocs(): Promise<DocRecord[]> {
  const all = await run<DocRecord[]>(DOCS, 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getDoc = (id: string) => run<DocRecord | undefined>(DOCS, 'readonly', (s) => s.get(id));

export async function saveDoc(rec: DocRecord) {
  await run(DOCS, 'readwrite', (s) => s.put(rec));
  notify();
}

export async function saveFile(docId: string, index: number, bytes: Uint8Array) {
  await run(FILES, 'readwrite', (s) => s.put(bytes, `${docId}:${index}`));
}

export async function loadFiles(docId: string, count: number): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const b = await run<Uint8Array | undefined>(FILES, 'readonly', (s) => s.get(`${docId}:${i}`));
    if (!b) throw new Error('A source file of this document is missing from the library.');
    out.push(b);
  }
  return out;
}

export async function deleteDoc(id: string) {
  const rec = await getDoc(id);
  await run(DOCS, 'readwrite', (s) => s.delete(id));
  for (let i = 0; i < (rec?.sourceNames.length ?? 0); i++) await run(FILES, 'readwrite', (s) => s.delete(`${id}:${i}`));
  notify();
}

export async function renameDoc(id: string, name: string) {
  const rec = await getDoc(id);
  if (rec) await saveDoc({ ...rec, name });
}

export function timeAgo(t: number): string {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString();
}
