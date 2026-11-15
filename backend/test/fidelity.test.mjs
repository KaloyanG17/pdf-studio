// Fidelity regression tests for the PDF export: run with `npm test` in backend/.
// They build their own invoice-like PDF (no real documents in the repo), export it through the
// real PdfService, and read the result back with pdf.js to check exact positions.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { PdfService } = require(path.join(here, '../dist-test/pdf/pdf.service.js'));
const { FontsService } = require(path.join(here, '../dist-test/fonts/fonts.service.js'));
const { removeCoveredText } = require(path.join(here, '../dist-test/pdf/redact.js'));
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const stdFonts = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts').replace(/\\/g, '/') + '/';

const service = new PdfService(new FontsService());
const H = 842;

/** An invoice-like page: standard Times fonts (not embedded), a table with centred and right-aligned cells. */
async function fixture() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, H]);
  const r = await doc.embedFont(StandardFonts.TimesRoman);
  const b = await doc.embedFont(StandardFonts.TimesRomanBold);
  const left = [
    ['Acme Trading Limited,', 36, 776],
    ['12 Market Street,', 36, 758],
    ['Order Date: 18/11/2024', 300, 747],
    ['Bill Number: 11519965FN80719417', 300, 729],
  ];
  for (const [t, x, y] of left) page.drawText(t, { x, y, size: 12, font: r });
  page.drawText('Your Invoice', { x: 303, y: 770, size: 18, font: b });
  // centred cells (x = centre - width / 2) and right-aligned amounts (x = right - width)
  const centred = [
    ['CARRIER', 77, 440, b],
    ['Hermes', 77, 420, r],
    ['Product Name', 243, 440, b],
    ['Tom Ford Oud Wood Eau de Parfum Spray 50ml', 243, 420, r],
  ];
  for (const [t, cx, y, f] of centred) page.drawText(t, { x: cx - f.widthOfTextAtSize(t, 12) / 2, y, size: 12, font: f });
  const amounts = [
    ['£166.50', 557, 300],
    ['£0.00', 557, 283],
    ['£16.65', 557, 266],
  ];
  for (const [t, rx, y] of amounts) page.drawText(t, { x: rx - r.widthOfTextAtSize(t, 12), y, size: 12, font: r });
  page.drawRectangle({ x: 30, y: 410, width: 530, height: 45, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
  return Buffer.from(await doc.save());
}

async function items(bytes) {
  const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: stdFonts, useSystemFonts: false, verbosity: 0 }).promise;
  const tc = await (await d.getPage(1)).getTextContent();
  return tc.items
    .filter((i) => i.str.trim())
    .map((i) => ({ str: i.str, x: i.transform[4], baseline: H - i.transform[5], width: i.width, size: Math.hypot(i.transform[2], i.transform[3]) }));
}

const stdOf = (size, bold) => (bold ? 'Times-Bold' : 'Times-Roman');

/** Re-typesets every line exactly as the editor's "edit text" tool would, with the given text. */
function retype(orig, change = (t) => t, align = () => 'left') {
  return orig.map((it, i) => {
    const a = align(it);
    const x = a === 'center' ? it.x + it.width / 2 : a === 'right' ? it.x + it.width : it.x;
    const bold = it.str === 'Your Invoice' || it.str === 'CARRIER' || it.str === 'Product Name';
    return {
      type: 'text',
      id: `t${i}`,
      x,
      align: a,
      y: it.baseline,
      text: change(it.str),
      fontSize: it.size,
      color: '#000000',
      font: 'serif',
      bold,
      stdFont: stdOf(it.size, bold),
      cover: { x: it.x - 1, y: it.baseline - it.size * 0.9, w: it.width + 2, h: it.size * 1.15, color: '#ffffff' },
    };
  });
}

const spec = (annotations, extra = {}) => ({ pages: [{ source: { file: 0, index: 0 }, width: 595, height: H, rotation: 0, annotations, ...extra }] });

test('unchanged re-typesetting reproduces every line within 0.05 pt and removes the original', async () => {
  const src = await fixture();
  const orig = await items(src);
  const out = await service.export(spec(retype(orig)), [src]);
  const got = await items(out);
  assert.equal(got.length, orig.length, 'each line must appear exactly once (originals removed)');
  for (const o of orig) {
    const g = got.find((x) => x.str === o.str);
    assert.ok(g, `missing "${o.str}"`);
    assert.ok(Math.abs(g.x - o.x) < 0.05, `"${o.str}" x ${g.x} vs ${o.x}`);
    assert.ok(Math.abs(g.baseline - o.baseline) < 0.05, `"${o.str}" baseline`);
    assert.ok(Math.abs(g.width - o.width) < 0.05, `"${o.str}" width ${g.width} vs ${o.width}`);
  }
});

test('centred and right-aligned edits keep their anchor when the text changes length', async () => {
  const src = await fixture();
  const orig = await items(src);
  const changes = { Hermes: 'DHL Express', '£166.50': '£1,166.50' };
  const align = (it) => (it.str === 'Hermes' ? 'center' : it.str.startsWith('£') ? 'right' : 'left');
  const out = await service.export(spec(retype(orig, (t) => changes[t] ?? t, align)), [src]);
  const got = await items(out);
  const hermes = orig.find((o) => o.str === 'Hermes');
  const dhl = got.find((g) => g.str === 'DHL Express');
  assert.ok(Math.abs(dhl.x + dhl.width / 2 - (hermes.x + hermes.width / 2)) < 0.05, 'centre preserved');
  const amount = orig.find((o) => o.str === '£166.50');
  const bigger = got.find((g) => g.str === '£1,166.50');
  assert.ok(Math.abs(bigger.x + bigger.width - (amount.x + amount.width)) < 0.05, 'right edge preserved');
  assert.ok(!got.some((g) => g.str === 'Hermes' || g.str === '£166.50'), 'replaced originals are gone from the file');
});

test('a whiteout box removes the text under it, a highlight does not', async () => {
  const src = await fixture();
  const out = await service.export(
    spec([
      // "Acme Trading Limited," sits on baseline 66; the next line on 84.
      { type: 'rect', id: 'w', x: 30, y: 54, w: 200, h: 16, stroke: null, fill: '#ffffff', strokeWidth: 0, opacity: 1 },
      { type: 'rect', id: 'h', x: 30, y: 78, w: 200, h: 20, stroke: null, fill: '#fde047', strokeWidth: 0, opacity: 0.5, blend: 'multiply' },
    ]),
    [src],
  );
  const text = (await items(out)).map((i) => i.str).join(' | ');
  assert.ok(!text.includes('Acme Trading Limited'), 'whited-out text removed');
  assert.ok(text.includes('12 Market Street'), 'highlighted text kept');
});

test('removing part of a line keeps the rest exactly in place (spacing and kerning)', () => {
  const widths = { N: 722, a: 444, m: 778, e: 444, ':': 278, K: 722, l: 278, o: 500, y: 500, n: 500, ' ': 250, G: 722, d: 500, r: 333, v: 500 };
  const font = { twoByte: false, known: true, width: (c) => widths[String.fromCharCode(c)] ?? 500 };
  const src = 'BT /F1 12 Tf 0.5 Tc 2 Tw 50 700 Td\n[(Name:) -1500 (Kal)20(oyan Gaydarov)] TJ\nET';
  const { content, removed } = removeCoveredText(Buffer.from(src, 'latin1'), () => font, [{ x0: 49, y0: 695, x1: 86, y1: 712 }]);
  assert.equal(removed, 5);
  const out = Buffer.from(content).toString('latin1');
  // "Name:" = 2666/1000·12 + 5·0.5 Tc = 34.492 pt → -2874.33 TJ units, merged with the original -1500
  assert.match(out, /\[-4374\.33\d? <4b616c> 20 <6f79616e204761796461726f76>\] TJ/);
});

test('watermark is stamped diagonally on every page', async () => {
  const src = await fixture();
  const out = await service.export({ ...spec([]), watermark: { text: 'КОПИЕ', opacity: 0.2 } }, [src]);
  const d = await pdfjs.getDocument({ data: new Uint8Array(out), standardFontDataUrl: stdFonts, verbosity: 0 }).promise;
  const wm = (await (await d.getPage(1)).getTextContent()).items.find((i) => i.str === 'КОПИЕ');
  assert.ok(wm, 'watermark text present');
  const angle = (Math.atan2(wm.transform[1], wm.transform[0]) * 180) / Math.PI;
  assert.ok(Math.abs(angle - (Math.atan2(842, 595) * 180) / Math.PI) < 0.5, `diagonal angle, got ${angle}`);
});

test('OCR text of a scan is exported as an invisible, searchable layer, sized to the scan', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, H]); // stands in for an image-only scan
  const src = Buffer.from(await doc.save());
  const ocr = [{ str: 'Фактура № 1024', x: 50, width: 120, baseline: 100, size: 12, top: 89, height: 14 }];
  const out = await service.export(spec([], { ocr }), [src]);
  const got = await items(out);
  const line = got.find((g) => g.str === 'Фактура № 1024');
  assert.ok(line, 'recognised text is searchable');
  assert.ok(Math.abs(line.width - 120) < 0.5, `stretched to the scanned width, got ${line.width}`);
});
