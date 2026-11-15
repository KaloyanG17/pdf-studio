// Generates the demo invoice (frontend/public/samples/invoice-bg.pdf): a Bulgarian invoice with
// a header, parties, a line-item table and totals, all fictional. It exercises the hard parts
// of the editor: embedded subset fonts, Cyrillic, right-aligned numbers and table cells.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'backend', 'package.json'));
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fonts = path.join(path.dirname(require.resolve('@docx-editor.dev/fonts/package.json')), 'assets');

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
doc.setTitle('Фактура 0000001042');
doc.setAuthor('PDF Studio sample');
const font = (f) => doc.embedFont(readFileSync(path.join(fonts, f)), { subset: true });
const sans = await font('LiberationSans-Regular.ttf');
const bold = await font('LiberationSans-Bold.ttf');

const page = doc.addPage([595.28, 841.89]);
const ink = rgb(0.13, 0.1, 0.11);
const grey = rgb(0.42, 0.42, 0.45);
const accent = rgb(0.39, 0.13, 0.93);
const line = rgb(0.85, 0.85, 0.87);

const text = (s, x, y, { size = 10, f = sans, color = ink, align = 'left' } = {}) => {
  const w = f.widthOfTextAtSize(s, size);
  page.drawText(s, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y, size, font: f, color });
};
const rule = (y, x1 = 50, x2 = 545, color = line) => page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.75, color });

// Header
page.drawRectangle({ x: 50, y: 770, width: 28, height: 28, color: accent });
text('Северен Бряг ЕООД', 88, 787, { size: 13, f: bold });
text('Софтуер и дизайн', 88, 773, { size: 9, color: grey });
text('ФАКТУРА', 545, 785, { size: 22, f: bold, align: 'right' });
text('ОРИГИНАЛ', 545, 770, { size: 9, color: grey, align: 'right' });

// Invoice facts
const facts = [
  ['Номер', '0000001042'],
  ['Дата на издаване', '03.11.2026'],
  ['Дата на данъчното събитие', '03.11.2026'],
  ['Падеж', '17.11.2026'],
];
facts.forEach(([k, v], i) => {
  text(k, 360, 735 - i * 15, { size: 9, color: grey });
  text(v, 545, 735 - i * 15, { size: 9.5, align: 'right' });
});

// Parties
const party = (title, lines, x) => {
  text(title, x, 735, { size: 8.5, f: bold, color: accent });
  lines.forEach((l, i) => text(l, x, 718 - i * 13.5, { size: i === 0 ? 10.5 : 9.5, f: i === 0 ? bold : sans }));
};
party('ДОСТАВЧИК', ['Северен Бряг ЕООД', 'ЕИК: 000000000', 'ул. „Примерна“ 12, Варна', 'МОЛ: Иван Иванов'], 50);
party('ПОЛУЧАТЕЛ', ['Зелена Долина ООД', 'ЕИК: 111111111', 'бул. „Тестов“ 7, София', 'МОЛ: Мария Петрова'], 205);

// Line items
const top = 620;
page.drawRectangle({ x: 50, y: top - 6, width: 495, height: 22, color: rgb(0.96, 0.95, 1) });
const cols = { n: 58, desc: 80, qty: 370, price: 450, sum: 537 };
text('№', cols.n, top + 1, { size: 8.5, f: bold, color: grey });
text('Описание', cols.desc, top + 1, { size: 8.5, f: bold, color: grey });
text('Кол.', cols.qty, top + 1, { size: 8.5, f: bold, color: grey, align: 'right' });
text('Ед. цена', cols.price, top + 1, { size: 8.5, f: bold, color: grey, align: 'right' });
text('Стойност', cols.sum, top + 1, { size: 8.5, f: bold, color: grey, align: 'right' });

const items = [
  ['Дизайн на уебсайт', 1, 2400],
  ['Разработка на онлайн магазин', 1, 5200],
  ['Хостинг и поддръжка (месечно)', 12, 45],
  ['Превод на съдържание', 18, 25],
  ['Обучение на служители', 4, 90],
];
const money = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let y = top - 26;
let net = 0;
items.forEach(([d, q, p], i) => {
  const sum = q * p;
  net += sum;
  text(String(i + 1), cols.n, y, { size: 9.5 });
  text(d, cols.desc, y, { size: 9.5 });
  text(String(q), cols.qty, y, { size: 9.5, align: 'right' });
  text(money(p), cols.price, y, { size: 9.5, align: 'right' });
  text(money(sum), cols.sum, y, { size: 9.5, align: 'right' });
  rule(y - 8);
  y -= 24;
});

// Totals
const vat = net * 0.2;
const totals = [
  ['Данъчна основа', money(net) + ' лв.'],
  ['ДДС 20%', money(vat) + ' лв.'],
];
y -= 6;
totals.forEach(([k, v]) => {
  text(k, 400, y, { size: 9.5, color: grey });
  text(v, 545, y, { size: 9.5, align: 'right' });
  y -= 16;
});
page.drawRectangle({ x: 390, y: y - 8, width: 155, height: 24, color: accent });
text('Сума за плащане', 398, y, { size: 9.5, f: bold, color: rgb(1, 1, 1) });
text(money(net + vat) + ' лв.', 538, y, { size: 10.5, f: bold, color: rgb(1, 1, 1), align: 'right' });

// Payment and notes
text('НАЧИН НА ПЛАЩАНЕ', 50, 330, { size: 8.5, f: bold, color: accent });
text('Банков превод', 50, 314, { size: 9.5 });
text('IBAN: BG00 TEST 0000 0000 0000 00', 50, 300, { size: 9.5 });
text('Основание за неначисляване на ДДС: не е приложимо', 50, 286, { size: 9.5, color: grey });
text('Благодарим Ви за доверието!', 50, 250, { size: 10.5, f: bold });

rule(120);
text('Съставил: Иван Иванов', 50, 100, { size: 9, color: grey });
text('Получил: Мария Петрова', 545, 100, { size: 9, color: grey, align: 'right' });
text('Примерен документ, създаден за демонстрация на PDF Studio. Всички данни са измислени.', 297.6, 60, { size: 7.5, color: grey, align: 'center' });

const out = path.join(root, 'frontend', 'public', 'samples');
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'invoice-bg.pdf'), await doc.save());
console.log('wrote frontend/public/samples/invoice-bg.pdf');
