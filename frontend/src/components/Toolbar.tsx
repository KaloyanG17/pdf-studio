import { useEffect, useState } from 'react';
import { AccountButton } from './Account';
import { exportPdf, exportText } from '../lib/api';
import { FAMILIES } from '../lib/fonts';
import { timeAgo } from '../lib/library';
import { lastSaved, onSaved } from '../lib/persist';
import { useStore } from '../lib/store';
import { toggleTheme, useTheme } from '../lib/theme';
import type { FontFamily, Tool } from '../lib/types';
import { Icon, type IconName } from './Icon';

const TOOLS: { id: Tool; label: string; icon: IconName; key: string }[] = [
  { id: 'select', label: 'Select', icon: 'select', key: 'V' },
  { id: 'edittext', label: 'Edit text', icon: 'edittext', key: 'E' },
  { id: 'text', label: 'Add text', icon: 'text', key: 'T' },
  { id: 'draw', label: 'Draw', icon: 'draw', key: 'D' },
  { id: 'highlight', label: 'Highlight', icon: 'highlight', key: 'H' },
  { id: 'whiteout', label: 'Whiteout', icon: 'whiteout', key: 'W' },
  { id: 'rect', label: 'Rectangle', icon: 'rect', key: 'R' },
  { id: 'ellipse', label: 'Ellipse', icon: 'ellipse', key: 'O' },
  { id: 'line', label: 'Line', icon: 'line', key: 'L' },
  { id: 'arrow', label: 'Arrow', icon: 'arrow', key: 'A' },
  { id: 'eraser', label: 'Remove added item', icon: 'eraser', key: 'X' },
];
export const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));
export const TOOL_LIST = TOOLS;

/** "1-3, 5, 8-" -> zero-based indexes */
function parseRanges(input: string, count: number): number[] {
  const out: number[] = [];
  for (const part of input.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    if (m) {
      const a = m[1] ? +m[1] : 1;
      const b = m[2] ? +m[2] : count;
      for (let i = a; i <= b; i++) if (i >= 1 && i <= count) out.push(i - 1);
    } else if (/^\d+$/.test(part) && +part >= 1 && +part <= count) out.push(+part - 1);
  }
  return out;
}

async function run(label: string, fn: () => Promise<void>) {
  useStore.getState().setBusy(label);
  try {
    await fn();
  } catch (e) {
    alert(`${label} failed: ${(e as Error).message}`);
  } finally {
    useStore.getState().setBusy(null);
  }
}

export function IconButton({
  icon,
  label,
  active,
  onClick,
  disabled,
  className = '',
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button className={`icon-btn ${active ? 'active' : ''} ${className}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

export function ThemeToggle() {
  const theme = useTheme();
  const dark = theme === 'dark';
  return (
    <IconButton
      icon={dark ? 'sun' : 'moon'}
      label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={toggleTheme}
      className="theme-toggle"
    />
  );
}

interface TopProps {
  onHome: () => void;
  onOpen: () => void;
  onTranslate: () => void;
  onFind: () => void;
  onNumbers: () => void;
  onShortcuts: () => void;
  onVersions: () => void;
  onWatermark: () => void;
  onGlossary: () => void;
}

/** "Saved" indicator for autosave. */
function SavedState() {
  const [, tick] = useState(0);
  useEffect(() => {
    const off = onSaved(() => tick((n) => n + 1));
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      off();
      window.clearInterval(t);
    };
  }, []);
  const at = lastSaved();
  return <span className="saved faint">{at ? `Saved ${timeAgo(at)}` : 'Saved'}</span>;
}

export function TopBar({ onHome, onOpen, onTranslate, onFind, onNumbers, onShortcuts, onVersions, onWatermark, onGlossary }: TopProps) {
  const fileName = useStore((s) => s.fileName);
  const showOriginal = useStore((s) => s.showOriginal);
  const split = useStore((s) => s.split);
  const versions = useStore((s) => s.versions.length);
  const watermark = useStore((s) => !!s.watermark?.text);
  const [menu, setMenu] = useState(false);
  const pages = () => useStore.getState().pages;
  const name = () => fileName || 'document';
  const downloaded = (label: string) => useStore.getState().saveVersion(label);

  return (
    <header className="topbar glass heavy">
      <IconButton icon="home" label="Back to your documents" onClick={onHome} className="home-btn" />
      <div className="brand">
        <span className="dot" />
        PDF Studio
      </div>
      <input
        className="filename"
        value={fileName}
        spellCheck={false}
        onChange={(e) => useStore.setState({ fileName: e.target.value })}
        title="Document name (also used when downloading)"
      />
      <SavedState />
      <div className="top-actions">
        <IconButton icon="open" label="Open another PDF" onClick={onOpen} />
        <IconButton icon="search" label="Find & replace (ctrl+f)" onClick={onFind} />
        <IconButton icon="hash" label="Page numbers" onClick={onNumbers} />
        <IconButton
          icon="eye"
          label={showOriginal ? 'Showing the original. Click to return to your edits' : 'Compare with original (hold Space)'}
          active={showOriginal}
          onClick={() => useStore.getState().toggleOriginal()}
        />
        <IconButton icon="columns" label={split ? 'Close side-by-side review' : 'Side-by-side review: original and edited'} active={split} onClick={() => useStore.getState().toggleSplit()} />
        <IconButton icon="clock" label={`Version history${versions ? ` (${versions})` : ''}`} onClick={onVersions} />
        <IconButton icon="keys" label="Shortcuts (?)" onClick={onShortcuts} />
        <AccountButton />
        <ThemeToggle />
        <span className="sep" />
        <button className="ghost" onClick={onTranslate}>
          <Icon name="translate" size={16} /> Translate
        </button>
        <div className="menu-wrap">
          <button
            className="solid"
            onClick={() =>
              run('Exporting', async () => {
                await exportPdf(pages(), name());
                downloaded('Downloaded PDF');
              })
            }
          >
            <Icon name="download" size={16} /> Download
          </button>
          <button className="solid caret" aria-label="More export options" onClick={() => setMenu((m) => !m)}>
            <Icon name="more" size={16} />
          </button>
          {menu && (
            <div className="menu glass heavy" onMouseLeave={() => setMenu(false)}>
              <button
                onClick={() => {
                  setMenu(false);
                  const all = pages();
                  const input = prompt(`Pages to export, e.g. 1-3, 5 (the document has ${all.length})`, `1-${all.length}`);
                  if (!input) return;
                  const idx = parseRanges(input, all.length);
                  if (!idx.length) return alert('No valid pages in that range.');
                  void run('Exporting', () => exportPdf(idx.map((i) => all[i]), `${name()}-pages`));
                }}
              >
                Extract pages…
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  const all = pages();
                  void run('Splitting', async () => {
                    for (const [i, p] of all.entries()) await exportPdf([p], `${name()}-page-${i + 1}`);
                  });
                }}
              >
                Split into single pages
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  void run('Exporting text', () => exportText(pages(), name()));
                }}
              >
                Download text (.txt)
              </button>
              <div className="menu-sep" />
              <button
                onClick={() => {
                  setMenu(false);
                  void run('Recognising text', async () => {
                    const { runOcr } = await import('../lib/ocr');
                    const n = await runOcr((msg) => useStore.getState().setBusy(msg));
                    alert(
                      n
                        ? `Recognised text on ${n} scanned page${n === 1 ? '' : 's'}. You can now edit, search and translate it.`
                        : 'Every page already has real text, so there was nothing to recognise.',
                    );
                  });
                }}
              >
                Recognise text in scans (OCR)
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  onWatermark();
                }}
              >
                Watermark{watermark ? ' (on)' : '…'}
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  onGlossary();
                }}
              >
                Translation glossary…
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export function ToolRail({ onImage, onSignature }: { onImage: () => void; onSignature: () => void }) {
  const tool = useStore((s) => s.tool);
  return (
    <nav className="rail glass">
      {TOOLS.map((t, i) => (
        <span key={t.id} className="rail-item">
          {(i === 1 || i === 3 || i === 10) && <span className="rail-sep" />}
          <IconButton icon={t.icon} label={`${t.label} (${t.key})`} active={tool === t.id} onClick={() => useStore.getState().setTool(t.id)} />
        </span>
      ))}
      <span className="rail-sep" />
      <IconButton icon="image" label="Insert image (or paste)" onClick={onImage} />
      <IconButton icon="sign" label="Signature" onClick={onSignature} />
    </nav>
  );
}

export function ContextBar() {
  const tool = useStore((s) => s.tool);
  const style = useStore((s) => s.style);
  const zoom = useStore((s) => s.zoom);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { setStyle, setZoom, undo, redo } = useStore.getState();
  const isText = tool === 'text';
  const isShape = ['draw', 'rect', 'ellipse', 'line', 'arrow'].includes(tool);

  return (
    <div className="contextbar glass heavy">
      <div className="ctx-group">
        <IconButton icon="undo" label="Undo (ctrl+z)" onClick={undo} disabled={!canUndo} />
        <IconButton icon="redo" label="Redo (ctrl+y)" onClick={redo} disabled={!canRedo} />
      </div>
      {(isText || isShape) && (
        <div className="ctx-group">
          <label className="swatch" title="Colour">
            <input type="color" value={style.color} onChange={(e) => setStyle({ color: e.target.value })} />
            <span style={{ background: style.color }} />
          </label>
          {isShape && (
            <>
              <label className="field" title="Line width">
                <input type="number" min={0.5} max={40} step={0.5} value={style.strokeWidth} onChange={(e) => setStyle({ strokeWidth: +e.target.value || 1 })} />
                pt
              </label>
              {(tool === 'rect' || tool === 'ellipse') && (
                <label className="field" title="Fill">
                  <input type="checkbox" checked={style.fill !== null} onChange={(e) => setStyle({ fill: e.target.checked ? '#d4d4d4' : null })} />
                  Fill
                  {style.fill !== null && (
                    <span className="swatch small">
                      <input type="color" value={style.fill} onChange={(e) => setStyle({ fill: e.target.value })} />
                      <span style={{ background: style.fill }} />
                    </span>
                  )}
                </label>
              )}
            </>
          )}
          {isText && (
            <>
              <select value={style.font} onChange={(e) => setStyle({ font: e.target.value as FontFamily })} title="Font">
                {FAMILIES.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
              <label className="field" title="Size">
                <input type="number" min={4} max={200} value={style.fontSize} onChange={(e) => setStyle({ fontSize: +e.target.value || 12 })} />
                pt
              </label>
              <IconButton icon="bold" label="Bold" active={style.bold} onClick={() => setStyle({ bold: !style.bold })} />
              <IconButton icon="italic" label="Italic" active={style.italic} onClick={() => setStyle({ italic: !style.italic })} />
            </>
          )}
        </div>
      )}
      <div className="ctx-hint">{HINTS[tool]}</div>
      <div className="ctx-group right">
        <IconButton icon="minus" label="Zoom out (ctrl -)" onClick={() => setZoom(zoom - 0.25)} />
        <button className="zoom" onClick={() => setZoom(1.25)} title="Reset zoom">
          {Math.round(zoom * 100)}%
        </button>
        <IconButton icon="plus" label="Zoom in (ctrl +)" onClick={() => setZoom(zoom + 0.25)} />
      </div>
    </div>
  );
}

const HINTS: Record<Tool, string> = {
  select: 'Drag to move · corner resizes · double-click text to type',
  edittext: 'Click any line of the original text to retype it in the same font',
  text: 'Click to place text',
  draw: 'Drag to draw',
  highlight: 'Drag over text to highlight',
  whiteout: 'Drag to hide an area',
  rect: 'Drag · shift for a square',
  ellipse: 'Drag · shift for a circle',
  line: 'Drag · shift snaps to 45°',
  arrow: 'Drag · shift snaps to 45°',
  eraser: 'Click an added item to remove it',
};
