import { useState } from 'react';
import { translateTexts } from '../lib/api';
import { getEmbedded } from '../lib/embedded';
import { FAMILIES, textBox, usesOriginal } from '../lib/fonts';
import { useStore } from '../lib/store';
import type { Annotation, FontFamily, TextAnnotation } from '../lib/types';
import { IconButton } from './Toolbar';

function Swatch({ value, onChange, title }: { value: string; onChange: (v: string) => void; title: string }) {
  return (
    <label className="swatch" title={title}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <span style={{ background: value }} />
    </label>
  );
}

const ORIGINAL = '__original__';

export function PropertiesPanel() {
  const selected = useStore((s) => s.selected);
  const ann = useStore((s) =>
    s.selected ? s.pages.find((p) => p.id === s.selected!.pageId)?.annotations.find((a) => a.id === s.selected!.annId) : undefined,
  );
  const [target, setTarget] = useState('en');
  const [busy, setBusy] = useState(false);
  if (!selected || !ann) return null;

  const st = useStore.getState();
  const upd = (patch: Partial<Annotation>) => st.updateAnnotation(selected.pageId, ann.id, patch);
  // Changing the look of original-font text switches it to the substitute family.
  const updText = (a: TextAnnotation, patch: Partial<TextAnnotation>) => upd(a.fontRef ? { ...patch, fontRef: undefined } : patch);
  // x is the alignment anchor, so move it when the alignment changes to keep the text where it is.
  const setAlign = (a: TextAnnotation, align: 'left' | 'center' | 'right') => {
    const b = textBox(a);
    upd({ align, x: align === 'center' ? b.x + b.w / 2 : align === 'right' ? b.x + b.w : b.x });
  };
  const reorder = (dir: 'front' | 'back') =>
    st.commit((pages) =>
      pages.map((p) => {
        if (p.id !== selected.pageId) return p;
        const rest = p.annotations.filter((a) => a.id !== ann.id);
        return { ...p, annotations: dir === 'front' ? [...rest, ann] : [ann, ...rest] };
      }),
    );
  const title = ann.type === 'rect' && ann.blend === 'multiply' ? 'highlight' : ann.type === 'rect' && ann.fill === '#ffffff' && !ann.stroke ? 'whiteout' : ann.type;

  return (
    <aside className="props glass heavy">
      <div className="props-head">
        <span>{title}</span>
        <IconButton icon="close" label="Close" onClick={() => st.select(null)} />
      </div>

      {ann.type === 'text' && (
        <>
          <section>
            <textarea
              rows={4}
              value={ann.text}
              spellCheck={false}
              onFocus={() => st.checkpoint()}
              onChange={(e) => st.updateAnnotation(selected.pageId, ann.id, { text: e.target.value }, false)}
            />
          </section>
          <section>
            <h4>font</h4>
            <select
              value={ann.fontRef ? ORIGINAL : ann.font}
              onChange={(e) => (e.target.value === ORIGINAL ? null : upd({ font: e.target.value as FontFamily, fontRef: undefined }))}
            >
              {ann.fontRef && <option value={ORIGINAL}>Original · {getEmbedded(ann.fontRef)?.name.replace(/^[A-Z]{6}\+/, '')}</option>}
              {FAMILIES.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            {ann.fontRef && !usesOriginal(ann) && (
              <p className="note">The original font lacks some of these characters, so the matching {FAMILIES.find((f) => f.id === ann.font)?.label} substitute is used.</p>
            )}
            <div className="row">
              <label className="field">
                <input type="number" min={3} max={300} step={0.5} value={ann.fontSize} onChange={(e) => upd({ fontSize: +e.target.value || 12 })} />
                pt
              </label>
              <Swatch value={ann.color} onChange={(color) => upd({ color })} title="Text colour" />
            </div>
            <div className="row">
              <IconButton icon="bold" label="Bold" active={ann.bold} onClick={() => updText(ann, { bold: !ann.bold })} />
              <IconButton icon="italic" label="Italic" active={ann.italic} onClick={() => updText(ann, { italic: !ann.italic })} />
              <IconButton icon="underline" label="Underline" active={ann.underline} onClick={() => upd({ underline: !ann.underline })} />
              <span className="sep" />
              <IconButton icon="alignl" label="Align left" active={(ann.align ?? 'left') === 'left'} onClick={() => setAlign(ann, 'left')} />
              <IconButton icon="alignc" label="Align centre" active={ann.align === 'center'} onClick={() => setAlign(ann, 'center')} />
              <IconButton icon="alignr" label="Align right" active={ann.align === 'right'} onClick={() => setAlign(ann, 'right')} />
            </div>
            <label className="slider">
              <span>Line spacing</span>
              <input type="range" min={0.8} max={2.5} step={0.05} value={ann.lineHeight ?? 1.2} onChange={(e) => upd({ lineHeight: +e.target.value })} />
            </label>
          </section>
          {ann.cover && (
            <section>
              <h4>cover</h4>
              <div className="row">
                <Swatch value={ann.cover.color} onChange={(color) => upd({ cover: { ...ann.cover!, color } })} title="Cover colour" />
                <button className="ghost small" onClick={() => upd({ cover: undefined })} title="Show the original text underneath again">
                  Remove
                </button>
              </div>
            </section>
          )}
          <section>
            <h4>translate</h4>
            <div className="row">
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="en">To English</option>
                <option value="bg">To Bulgarian</option>
                <option value="de">To German</option>
                <option value="fr">To French</option>
                <option value="es">To Spanish</option>
                <option value="ru">To Russian</option>
              </select>
              <button
                className="ghost small"
                disabled={busy || !ann.text.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const { translations } = await translateTexts([ann.text.replace(/\n/g, ' ')], 'auto', target);
                    upd({ text: translations[0] });
                  } catch (e) {
                    alert((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? '…' : 'Translate'}
              </button>
            </div>
          </section>
        </>
      )}

      {(ann.type === 'rect' || ann.type === 'ellipse') && (
        <section>
          <h4>shape</h4>
          <div className="row">
            <label className="field">
              <input type="checkbox" checked={!!ann.stroke} onChange={(e) => upd({ stroke: e.target.checked ? '#000000' : null })} />
              Stroke
            </label>
            {ann.stroke && <Swatch value={ann.stroke} onChange={(stroke) => upd({ stroke })} title="Stroke colour" />}
            {ann.stroke && (
              <label className="field">
                <input type="number" min={0.5} max={40} step={0.5} value={ann.strokeWidth} onChange={(e) => upd({ strokeWidth: +e.target.value || 1 })} />
                pt
              </label>
            )}
          </div>
          <div className="row">
            <label className="field">
              <input type="checkbox" checked={!!ann.fill} onChange={(e) => upd({ fill: e.target.checked ? '#ffffff' : null })} />
              Fill
            </label>
            {ann.fill && <Swatch value={ann.fill} onChange={(fill) => upd({ fill })} title="Fill colour" />}
          </div>
        </section>
      )}

      {(ann.type === 'line' || ann.type === 'path') && (
        <section>
          <h4>stroke</h4>
          <div className="row">
            <Swatch value={ann.color} onChange={(color) => upd({ color })} title="Colour" />
            <label className="field">
              <input type="number" min={0.5} max={40} step={0.5} value={ann.width} onChange={(e) => upd({ width: +e.target.value || 1 })} />
              pt
            </label>
            {ann.type === 'line' && (
              <label className="field">
                <input type="checkbox" checked={!!ann.arrow} onChange={(e) => upd({ arrow: e.target.checked })} /> Arrow
              </label>
            )}
          </div>
        </section>
      )}

      <section>
        <label className="slider">
          <span>Opacity</span>
          <input type="range" min={0.05} max={1} step={0.05} value={ann.opacity ?? 1} onChange={(e) => upd({ opacity: +e.target.value })} />
        </label>
        <div className="row">
          <button className="ghost small" onClick={() => reorder('front')}>To front</button>
          <button className="ghost small" onClick={() => reorder('back')}>To back</button>
          <span className="grow" />
          <IconButton icon="trash" label="Delete (del)" onClick={() => st.removeAnnotation(selected.pageId, ann.id)} />
        </div>
      </section>
    </aside>
  );
}
