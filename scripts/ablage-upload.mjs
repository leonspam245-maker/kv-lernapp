// Lädt die erstellten Lernblatt-PDFs in die gemeinsame Ablage (Edge Function «ablage-import»).
// Aufruf: IMPORT_UPLOADER=<admin-uuid> node scripts/ablage-upload.mjs [filter]
// Der Einmal-Schlüssel liegt in lernblaetter/.import-token (nicht im Repository). Bereits vorhandene Einträge werden übersprungen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = path.join(ROOT, 'lernblaetter', 'inhalt');
const PDF = path.join(ROOT, 'lernblaetter', 'pdf');
const URL_ = 'https://scqnlssmcudknekniivo.supabase.co/functions/v1/ablage-import';
const token = fs.readFileSync(path.join(ROOT, 'lernblaetter', '.import-token'), 'utf8').trim();
const uploader = process.env.IMPORT_UPLOADER;
if (!uploader) throw new Error('IMPORT_UPLOADER fehlt');

const filter = process.argv[2] || '';
const files = fs.readdirSync(IN).filter((f) => f.endsWith('.json') && f.includes(filter)).sort();
let ok = 0, skip = 0; const fail = [];
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8'));
  const pdf = path.join(PDF, d.folder.replace('/', '__'), f.replace(/\.json$/, '.pdf'));
  if (!fs.existsSync(pdf)) { fail.push(`${f}: PDF fehlt`); continue; }
  const kind = d.kind === 'uebung' ? 'Übungsblatt mit Lösungen' : 'Merkblatt';
  const body = {
    folder: d.folder,
    title: `${d.kind === 'uebung' ? 'Übungsblatt' : 'Merkblatt'}: ${d.modul}`,
    description: `${kind} zum myKV-Modul «${d.modul}». Von KV-Learn in eigenen Worten erstellt, Stand 26.11.2026.`,
    file_name: f.replace(/\.json$/, '.pdf'),
    b64: fs.readFileSync(pdf).toString('base64'),
    uploader_id: uploader,
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-token': token }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status} ${j.error || ''}`);
      if (j.skipped) skip++; else ok++;
      break;
    } catch (e) {
      if (attempt === 3) fail.push(`${f}: ${e.message}`);
      else await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}
console.log(`${ok} hochgeladen, ${skip} schon vorhanden${fail.length ? `, ${fail.length} Fehler:\n  ` + fail.join('\n  ') : ''}`);
if (fail.length) process.exitCode = 1;
