// Lädt lernblaetter/pakete/*.json in den Supabase-Speicher «pakete» (Edge Function «pakete-import»).
// Aufruf: node scripts/pakete-upload.mjs   (Einmal-Schlüssel in lernblaetter/.import-token, nicht im Repository)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'lernblaetter', 'pakete');
const URL_ = 'https://scqnlssmcudknekniivo.supabase.co/functions/v1/pakete-import';
const token = fs.readFileSync(path.join(ROOT, 'lernblaetter', '.import-token'), 'utf8').trim();
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort((a, b) => (a === 'index.json') - (b === 'index.json')); // Index zuletzt
let ok = 0; const fail = [];
for (const name of files) {
  const body = fs.readFileSync(path.join(DIR, name), 'utf8');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-token': token }, body: JSON.stringify({ name, body }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status} ${j.error || ''}`);
      ok++; break;
    } catch (e) { if (attempt === 3) fail.push(`${name}: ${e.message}`); else await new Promise((r) => setTimeout(r, 1500 * attempt)); }
  }
}
console.log(`${ok} von ${files.length} Paketdateien hochgeladen${fail.length ? `, Fehler:\n  ` + fail.join('\n  ') : ''}`);
if (fail.length) process.exitCode = 1;
