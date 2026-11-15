// Copies runtime assets from node_modules into frontend/public/vendor so they are served as
// plain static files (locally by Vite, on Vercel by the CDN): pdf.js standard fonts and the
// OCR engine with its Bulgarian + English models. Runs before `dev` and `build`.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'frontend', 'package.json'));
const pkg = (name) => path.dirname(require.resolve(`${name}/package.json`));
const out = path.join(root, 'frontend', 'public', 'vendor');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copy = (from, to, filter = () => true) => {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) if (filter(f)) cpSync(path.join(from, f), path.join(to, f), { recursive: true });
};

copy(path.join(pkg('pdfjs-dist'), 'standard_fonts'), path.join(out, 'standard_fonts'));
copy(path.join(pkg('tesseract.js'), 'dist'), path.join(out, 'ocr', 'worker'), (f) => f === 'worker.min.js');
// LSTM engine builds only (we run OEM 1); the browser picks the fastest variant it supports.
copy(pkg('tesseract.js-core'), path.join(out, 'ocr', 'core'), (f) => /^tesseract-core.*lstm/.test(f));
for (const lang of ['bul', 'eng']) copy(path.join(pkg(`@tesseract.js-data/${lang}`), '4.0.0_best_int'), path.join(out, 'ocr', 'lang'));

if (!existsSync(path.join(out, 'ocr', 'lang', 'bul.traineddata.gz'))) throw new Error('OCR language data missing');
console.log('vendor assets copied to frontend/public/vendor');
