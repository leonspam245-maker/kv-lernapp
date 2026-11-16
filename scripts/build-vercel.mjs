// Build für Vercel: kopiert die benötigten Bibliotheken nach public/vendor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'vendor');
const COPY = [
  ['node_modules/pdfjs-dist/build', 'pdfjs', (f) => /^pdf(\.worker)?\.min\.mjs$/.test(f)],
  ['node_modules/tesseract.js/dist', 'tesseract', (f) => /^(tesseract\.esm\.min\.js|worker\.min\.js)$/.test(f)],
  ['node_modules/tesseract.js-core', 'tesseract-core', (f) => /^tesseract-core.*\.(js|wasm)$/.test(f)],
  ['node_modules/@tesseract.js-data/deu/4.0.0_best_int', 'tessdata', (f) => f.endsWith('.traineddata.gz')],
  ['node_modules/@supabase/supabase-js/dist/umd', 'supabase', (f) => f === 'supabase.js'],
];
fs.rmSync(OUT, { recursive: true, force: true });
for (const [src, dest, keep] of COPY) {
  const from = path.join(ROOT, src);
  const to = path.join(OUT, dest);
  fs.mkdirSync(to, { recursive: true });
  const files = fs.readdirSync(from).filter(keep);
  if (!files.length) throw new Error(`Keine Dateien in ${src}`);
  for (const f of files) fs.copyFileSync(path.join(from, f), path.join(to, f));
  console.log(`${dest}: ${files.length} Dateien`);
}
