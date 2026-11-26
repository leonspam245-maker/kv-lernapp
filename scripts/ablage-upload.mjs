// Lädt die erstellten Lernblatt-PDFs in die gemeinsame Ablage (Edge Function «ablage-import»).
// Aufruf: IMPORT_UPLOADER=<admin-uuid> [REPLACE=1] node scripts/ablage-upload.mjs [filter ...]
// REPLACE=1 ersetzt vorhandene Einträge gleichen Titels (neue Fassung eines Blatts).
// Der Einmal-Schlüssel liegt in lernblaetter/.import-token (nicht im Repository). Bereits vorhandene Einträge werden übersprungen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputsOf } from './lernblaetter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = path.join(ROOT, 'lernblaetter', 'inhalt');
const PDF = path.join(ROOT, 'lernblaetter', 'pdf');
const URL_ = 'https://scqnlssmcudknekniivo.supabase.co/functions/v1/ablage-import';
const token = fs.readFileSync(path.join(ROOT, 'lernblaetter', '.import-token'), 'utf8').trim();
const uploader = process.env.IMPORT_UPLOADER;
if (!uploader) throw new Error('IMPORT_UPLOADER fehlt');

const filters = process.argv.slice(2);
const files = fs.readdirSync(IN).filter((f) => f.endsWith('.json') && (!filters.length || filters.some((x) => f.includes(x)))).sort();
let ok = 0, skip = 0, repl = 0; const fail = [];
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8'));
  for (const [name, variant] of outputsOf(f, d)) {
    const pdf = path.join(PDF, d.folder.replace('/', '__'), name);
    if (!fs.existsSync(pdf)) { fail.push(`${name}: PDF fehlt`); continue; }
    let title, description;
    if (d.modul) {
      const kind = d.kind === 'uebung' ? 'Übungsblatt mit Lösungen' : 'Merkblatt';
      title = `${d.kind === 'uebung' ? 'Übungsblatt' : 'Merkblatt'}: ${d.modul}`;
      description = `${kind} zum myKV-Modul «${d.modul}». Von KV-Learn in eigenen Worten erstellt, Stand 26.11.2026.`;
    } else {
      const t = d.ablage?.title || d.title;
      title = variant === 'loesungen' ? `Lösungen: ${t}` : t;
      description = variant === 'loesungen' ? `Lösungen und Notenskala zu «${t}».` : (d.ablage?.description || d.lead || '');
      description = `${description} Von KV-Learn erstellt, Stand 26.11.2026.`.trim();
    }
    const body = { folder: d.folder, title: title.slice(0, 140), description: description.slice(0, 500), file_name: name, b64: fs.readFileSync(pdf).toString('base64'), uploader_id: uploader, replace: process.env.REPLACE === '1' };
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-token': token }, body: JSON.stringify(body) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${res.status} ${j.error || ''}`);
        if (j.skipped) skip++; else if (j.replaced) repl++; else ok++;
        break;
      } catch (e) {
        if (attempt === 3) fail.push(`${name}: ${e.message}`);
        else await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
}
console.log(`${ok} neu hochgeladen, ${repl} ersetzt, ${skip} übersprungen${fail.length ? `, ${fail.length} Fehler:\n  ` + fail.join('\n  ') : ''}`);
if (fail.length) process.exitCode = 1;
