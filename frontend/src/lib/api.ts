import { authed, requestUpgrade } from './cloud';
import { getEmbedded } from './embedded';
import { getTextLines, groupBlocks } from './pdf';
import { useStore } from './store';
import type { Page } from './types';

async function errorText(res: Response) {
  try {
    const j = await res.json();
    return j.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Builds the final PDF on the server and downloads it. */
export async function exportPdf(pages: Page[], fileName: string) {
  download(await buildPdf(pages, fileName), `${fileName}.pdf`);
}

/** Builds the final PDF on the server and returns it. */
export async function buildPdf(pages: Page[], fileName: string): Promise<Blob> {
  const { sources, watermark } = useStore.getState();
  // Only send source files that are actually used, and re-index them.
  const used = [...new Set(pages.filter((p) => p.source).map((p) => p.source!.file))];
  const remap = new Map(used.map((f, i) => [f, i]));
  const spec = {
    title: fileName,
    watermark: watermark?.text.trim() ? watermark : undefined,
    pages: pages.map((p) => ({
      source: p.source ? { file: remap.get(p.source.file)!, index: p.source.index } : null,
      width: p.width,
      height: p.height,
      rotation: p.rotation,
      annotations: p.annotations,
      ocr: p.ocr,
    })),
  };
  const form = new FormData();
  for (const f of used) form.append('files', new Blob([sources[f].bytes as BlobPart], { type: 'application/pdf' }), sources[f].name);
  // Original fonts used by edited text travel with the export.
  const refs = new Set(pages.flatMap((p) => p.annotations.flatMap((a) => (a.type === 'text' && a.fontRef ? [a.fontRef] : []))));
  for (const ref of refs) {
    const f = getEmbedded(ref);
    if (f) form.append('fonts', new Blob([f.data as BlobPart], { type: 'font/otf' }), ref);
  }
  form.append('spec', JSON.stringify(spec));
  const res = await fetch('/api/pdf/export', { method: 'POST', body: form });
  if (!res.ok) throw new Error(await errorText(res));
  return res.blob();
}

export async function exportText(pages: Page[], fileName: string) {
  const { sources } = useStore.getState();
  const parts: string[] = [];
  for (const [i, p] of pages.entries()) {
    const chunks: string[] = [];
    if (p.source) {
      const blocks = groupBlocks(await getTextLines(sources[p.source.file].doc, p.source.index));
      chunks.push(...blocks.map((b) => b.text));
    }
    for (const a of p.annotations) if (a.type === 'text' && a.text.trim()) chunks.push(a.text);
    parts.push(`--- Page ${i + 1} ---\n\n${chunks.join('\n\n')}`);
  }
  download(new Blob([parts.join('\n\n')], { type: 'text/plain;charset=utf-8' }), `${fileName}.txt`);
}

export interface TranslateInfo {
  defaultProvider: string;
  providers: { id: string; name: string }[];
  languages: Record<string, string>;
}

export async function getTranslateInfo(): Promise<TranslateInfo> {
  const res = await fetch('/api/translate');
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export async function translateTexts(texts: string[], source: string, target: string, provider?: string) {
  // Signed-in users count against their own plan; guests against a daily allowance.
  const res = await authed('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, source, target, provider }),
  });
  if (res.status === 402) {
    const msg = await errorText(res);
    requestUpgrade(msg);
    throw new Error(msg);
  }
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()) as { provider: string; translations: string[] };
}
