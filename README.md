# PDF Studio

A clean, liquid-glass PDF editor for invoices and documents. Edit, annotate, sign, translate, merge and split PDFs in the browser.
React + TypeScript (Vite) frontend, NestJS backend.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173 (the API runs on http://localhost:3001 and is proxied under `/api`).

## Features

| Area | What you can do |
| --- | --- |
| Library | The home page lists every document you opened, with thumbnail, last change, page count, versions and tags (Edited, Translated EN → BG, OCR). Everything autosaves to this browser (IndexedDB), so nothing is lost on refresh and nothing leaves the computer. Search, rename, delete. |
| Navigation | Each document has its own address (`/doc/<id>`), so the browser's back/forward buttons and bookmarks work. `/batch` is batch translation. |
| Versions | A version is saved before every translation and on every download; you can also name one yourself. Restore any of them (undoable). |
| Side-by-side | Original and edited pages next to each other, zoomed to fit. |
| Quick actions | Edit text, Translate, Sign or Batch translate straight from the home page. |
| Batch translate | Drop many PDFs, translate them all, download one ZIP. Each result is also saved to the library. |
| Glossary | Terms that always translate a fixed way, or never get translated (names, brands, addresses). |
| Translation memory | When you correct a translated line, the next translation of the same text uses your version. |
| Dates | Dates are converted to the target language's format (18/11/2024 ⇄ 18.11.2024 г.), even when the engine rewrites or drops them. |
| OCR | "Recognise text in scans" reads scanned pages (Bulgarian + English) entirely on your computer. The recognised text can then be edited, searched and translated, and the exported file becomes searchable. |
| Watermark | COPY / PAID / КОПИЕ… stamped diagonally across every page on export. |
| Edit text | **Edit text** tool (E): click any line of the original and retype it. It keeps the same font (the PDF's own embedded font when that font has every character you type), the same size, colour and exact baseline. The old text is covered with the sampled background colour. |
| Find & replace | Ctrl+F. Replaces text across the whole document. Replaced lines keep their original font, size and colour. |
| Add | Text boxes (T), images (button or paste), signatures (draw pad), shapes, lines, arrows |
| Draw | Freehand pen (D), highlighter (H), rectangles (R), ellipses (O), lines (L), arrows (A). Hold Shift for squares, circles and 45° lines |
| Remove | Whiteout (W) hides any area; eraser (X) deletes items you added; Del deletes the selected item |
| Translate | Whole document or one page, Bulgarian ⇄ English plus 17 other languages. The translation keeps the original font, size and line spacing. A longer translation first grows into free space beside or below its paragraph, and the font shrinks only if there is no room. Each block stays editable, and one Undo reverts the whole translation. |
| Compare | Hold Space (or the eye icon) to see the untouched original. |
| Page numbers | Four formats, four positions, a custom start number, and an option to skip the first page. |
| Pages | Reorder (drag thumbnails), rotate, duplicate, delete, insert blank pages, merge other PDFs |
| Export | Download the PDF, extract a page range, split into single pages, download plain text |
| General | Undo/redo (Ctrl+Z / Ctrl+Y), zoom, arrow keys nudge the selection, full Unicode/Cyrillic fonts (DejaVu) on screen and in the exported file |

## Translation engines

Configure in `backend/.env` (copy from `.env.example`):

- **DeepL** – `DEEPL_API_KEY`. Best quality for Bulgarian; the free tier allows 500,000 characters/month.
- **Claude** – `ANTHROPIC_API_KEY` (model `ANTHROPIC_MODEL`, default `claude-opus-5-5`). Uses the whole page as context.
- **MyMemory** – used when no key is set. It needs no key but allows only about 5,000 characters/day (50,000 with `MYMEMORY_EMAIL`).

The engine is picked automatically (DeepL > Claude > MyMemory), and you can switch it in the Translate dialog.

## How it works

- The frontend renders pages with pdf.js and keeps every edit as a JSON "annotation" in PDF point coordinates.
- On export, the original PDF bytes plus the annotation JSON go to `POST /api/pdf/export`. The backend uses pdf-lib to copy the original pages, so the original text stays vector and searchable, then draws the edits and embeds subset fonts.
- `POST /api/translate` → `{ texts, source, target, provider? }` returns `{ translations }`.

```
backend/src
  pdf/        export endpoint, annotation types, drawing
  translate/  providers (DeepL, Claude, MyMemory)
  fonts/      serves the Unicode TTFs used for editing + export
frontend/src
  lib/        store (zustand), pdf.js helpers, text extraction, translation flow, API
  components/ Toolbar, Sidebar (pages), PageView (editor), PropertiesPanel, dialogs
```

## Limits / next steps

- On export, original text under an edit/translation cover or an opaque whiteout is **removed from the file**, not just hidden (`backend/src/pdf/redact.ts`), so it cannot be copied, searched or extracted. Text after it on the same line keeps its exact position. Not covered: text drawn inside form XObjects, Type3 fonts without metrics, text that is part of an image, and vector graphics or images under a whiteout, which are still only covered.
- Scanned PDFs have no text layer, so they need OCR before their text can be edited or translated.
- Paid version: auth + plans (e.g. Stripe) can gate endpoints in the NestJS backend. Translation volume and export count are natural limits to meter.

## How text keeps its look

1. pdf.js converts every font embedded in the PDF to OpenType. The app registers those fonts with the browser, and on export it sends them to the server, which embeds them again. Edited text therefore uses the document's own font.
2. Embedded fonts are usually *subsets* that contain only the characters the document uses. If new text needs a character the subset lacks (for example English letters in a Bulgarian-only font), the whole block switches to a **metric-compatible substitute**, so widths and line breaks match the original font: Liberation Sans for Arial/Helvetica, Liberation Serif for Times, Liberation Mono for Courier, Carlito for Calibri. All of them include Cyrillic.
3. Text is placed by its baseline, the same coordinate the PDF uses, so it sits exactly where the original line was. Size and line spacing are copied from the original.

## Tests

```bash
npm test -w backend
```

Six export-fidelity tests on a generated invoice-like PDF:
- Re-typesetting every line unchanged reproduces it within 0.05 pt and removes the original.
- Centred and right-aligned edits keep their anchor.
- Whiteout removes text and a highlight doesn't.
- Partial removal keeps the rest of a line in place.
- The watermark is stamped along the page diagonal.
- The OCR layer is searchable.

They build into `dist-test/`, so they can run while the dev server is running.

## Not built yet

- **Accounts, cloud sync and payments.** These need a hosted database and auth provider, plus your own Stripe account and keys. The library is local-only for now, and `lib/library.ts` is the single place to swap for a cloud store.
- **Totals recalculation.** Changing a line item doesn't yet update the subtotal, VAT and total automatically.
- **PDF form filling.**
- **Password protection.**
- **Compression.**
