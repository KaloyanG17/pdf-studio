import { cssFont, loadFonts, measure } from './fonts';
import { getTextLines, sampleColors } from './pdf';
import { useStore } from './store';
import { uid, type Annotation, type Page, type TextAnnotation } from './types';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Counts matches of `find` in original text and in added text boxes. */
export async function countMatches(find: string, matchCase: boolean): Promise<number> {
  if (!find) return 0;
  const re = new RegExp(escape(find), matchCase ? 'g' : 'gi');
  const { pages, sources } = useStore.getState();
  let n = 0;
  for (const p of pages) {
    for (const a of p.annotations) if (a.type === 'text') n += a.text.match(re)?.length ?? 0;
    if (!p.source) continue;
    for (const l of await getTextLines(sources[p.source.file].doc, p.source.index)) {
      if (isCovered(p, l)) continue;
      n += l.str.match(re)?.length ?? 0;
    }
  }
  return n;
}

function isCovered(p: Page, l: { x: number; top: number; width: number; height: number }) {
  return p.annotations.some(
    (a) =>
      a.type === 'text' &&
      a.cover &&
      a.cover.x <= l.x + 1 &&
      a.cover.y <= l.top + 1 &&
      a.cover.x + a.cover.w >= l.x + l.width - 1 &&
      a.cover.y + a.cover.h >= l.top + l.height - 1,
  );
}

/**
 * Replaces text everywhere. Original lines are re-typeset in place with their own font,
 * size, colour and baseline (the same mechanism as the "edit text" tool).
 */
export async function findReplace(find: string, replace: string, matchCase: boolean): Promise<number> {
  if (!find) return 0;
  await loadFonts();
  const re = new RegExp(escape(find), matchCase ? 'g' : 'gi');
  const { pages, sources } = useStore.getState();
  const next: Page[] = [];
  let total = 0;

  for (const p of pages) {
    let anns: Annotation[] = p.annotations.map((a) => {
      if (a.type !== 'text' || !re.test(a.text)) return a;
      re.lastIndex = 0;
      total += a.text.match(re)?.length ?? 0;
      return { ...a, text: a.text.replace(re, replace) };
    });
    if (p.source) {
      const doc = sources[p.source.file].doc;
      const hits = (await getTextLines(doc, p.source.index)).filter((l) => {
        re.lastIndex = 0;
        return !isCovered(p, l) && re.test(l.str);
      });
      if (hits.length) {
        const colors = await sampleColors(
          doc,
          p.source.index,
          hits.map((l) => ({ x: l.x, y: l.top, w: l.width, h: l.height })),
        );
        const added: TextAnnotation[] = hits.map((l, i) => {
          total += l.str.match(re)?.length ?? 0;
          return {
            type: 'text',
            id: uid(),
            x: l.anchor,
            align: l.align,
            y: l.baseline,
            text: l.str.replace(re, replace),
            fontSize: Math.round(l.size * 1000) / 1000,
            lineHeight: 1.2,
            color: colors[i].fg,
            font: l.family,
            bold: l.bold,
            italic: l.italic,
            fontRef: l.fontRef,
            stdFont: l.stdFont,
            wordSpacing: l.wordSpacing || undefined,
            charSpacing: l.charSpacing || undefined,
            cover: { x: l.x - 1, y: l.top - 0.5, w: l.width + 2, h: l.height + 1, color: colors[i].bg },
          };
        });
        anns = [...anns, ...added];
      }
    }
    next.push(anns === p.annotations ? p : { ...p, annotations: anns });
  }
  if (total) useStore.getState().commit(() => next);
  return total;
}

export interface PageNumberOptions {
  format: string; // e.g. "{n}" or "{n} / {total}"
  position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-right';
  size: number;
  startAt: number;
  skipFirst: boolean;
}

export async function addPageNumbers(o: PageNumberOptions) {
  await loadFonts();
  const { pages } = useStore.getState();
  const total = pages.length - (o.skipFirst ? 1 : 0);
  const spec = { font: 'sans' as const, bold: false, italic: false, text: '' };
  useStore.getState().commit((ps) =>
    ps.map((p, i) => {
      if (o.skipFirst && i === 0) return p;
      const n = i + o.startAt - (o.skipFirst ? 1 : 0);
      const text = o.format.replace('{n}', String(n)).replace('{total}', String(total + o.startAt - 1));
      const margin = 36;
      const align = o.position === 'bottom-center' ? 'center' : o.position === 'bottom-left' ? 'left' : 'right';
      const x = align === 'center' ? p.width / 2 : align === 'left' ? margin : p.width - margin;
      const y = o.position === 'top-right' ? margin : p.height - margin * 0.75;
      const a: TextAnnotation = { type: 'text', id: uid(), x, y, text, align, fontSize: o.size, color: '#444444', font: 'sans' };
      return { ...p, annotations: [...p.annotations, a] };
    }),
  );
}
