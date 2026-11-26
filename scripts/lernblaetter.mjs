// Lernblätter als PDF im Design von KV-Learn (Farben und Logo der App, Arial).
// Eingabe: lernblaetter/inhalt/*.json (je Datei ein Merkblatt oder Übungsblatt), Ausgabe: lernblaetter/pdf/<ordner>/<datei>.pdf
// Aufruf: node scripts/lernblaetter.mjs [filter]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = path.join(ROOT, 'lernblaetter', 'inhalt');
const OUT = path.join(ROOT, 'lernblaetter', 'pdf');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'))('playwright')); }

const LOGO = fs.readFileSync(path.join(ROOT, 'branding', 'kv-learn-logo.svg'), 'utf8').replace(/width="945" height="240"/, 'width="150" height="38"');
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// **fett** im Fliesstext
const rich = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const YEAR = { lj1: '1. Lehrjahr', lj2: '2. Lehrjahr', lj3: '3. Lehrjahr' };
const lfLabel = (k) => (k?.startsWith('glf') ? `Grundlagenlernfeld ${k.slice(3)}` : k ? `Lernfeld ${k.slice(2)}` : '');

const CSS = `
@page { size: A4; margin: 14mm 0 16mm 0; }
@page :first { margin-top: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1D1B1A; }
.page { padding: 0 18mm; }
.band { background: #E8442C; color: #1D1B1A; padding: 9mm 18mm 8mm; margin: 0 -18mm; position: relative; overflow: hidden; }
.band::after { content: ""; position: absolute; right: -30mm; top: -25mm; width: 90mm; height: 90mm; border-radius: 50%; background: #F8A487; opacity: .55; }
.band .row { display: flex; justify-content: space-between; align-items: center; position: relative; z-index: 1; }
.band .logo { background: #FBF6F1; border-radius: 10px; padding: 5px 9px 3px; line-height: 0; }
.kind { font-size: 8.5pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; background: #1D1B1A; color: #FBF6F1; padding: 4px 10px; border-radius: 99px; }
.crumb { position: relative; z-index: 1; margin: 7mm 0 1.5mm; font-size: 9pt; font-weight: 700; }
h1 { position: relative; z-index: 1; margin: 0; font-size: 22pt; line-height: 1.12; letter-spacing: -.01em; max-width: 150mm; }
.lead { position: relative; z-index: 1; margin: 3mm 0 0; font-size: 10.5pt; max-width: 155mm; }
main { padding-top: 6mm; }
h2 { font-size: 12.5pt; margin: 6mm 0 2mm; padding-bottom: 1.2mm; border-bottom: 2px solid #E8442C; break-after: avoid; }
h2 .no { color: #B5301B; margin-right: 2mm; }
p { margin: 0 0 2.2mm; }
ul { margin: 0 0 2.5mm; padding-left: 5mm; } li { margin: 0 0 1mm; }
table { width: 100%; border-collapse: collapse; margin: 1mm 0 3mm; font-size: 9.8pt; break-inside: auto; }
thead { display: table-header-group; }
th { background: #1D1B1A; color: #FBF6F1; text-align: left; padding: 2mm 2.5mm; font-weight: 700; }
td { padding: 2mm 2.5mm; border-bottom: 1px solid #E9DDD3; vertical-align: top; }
tr:nth-child(even) td { background: #FBF6F1; }
tr { break-inside: avoid; }
td.term { font-weight: 700; width: 34%; }
.box { border-radius: 4mm; padding: 4mm 5mm; margin: 3mm 0 4mm; break-inside: avoid; }
.box h3 { margin: 0 0 1.5mm; font-size: 10.5pt; }
.box p:last-child, .box ul:last-child { margin-bottom: 0; }
.beispiel { background: #FDEDE6; border-left: 5px solid #F8A487; }
.merke { background: #1D1B1A; color: #FBF6F1; }
.merke h3 { color: #F8A487; }
.formel { background: #FBF6F1; border: 1.5px solid #1D1B1A; font-family: "Courier New", monospace; }
.aufgabe { margin: 0 0 5mm; break-inside: avoid; }
.aufgabe .q { display: flex; gap: 3mm; }
.aufgabe .nr { flex: none; width: 7mm; height: 7mm; border-radius: 50%; background: #E8442C; color: #1D1B1A; font-weight: 700; display: grid; place-items: center; font-size: 9.5pt; }
.aufgabe .txt { flex: 1; }
.aufgabe .pt { flex: none; font-size: 8.5pt; font-weight: 700; color: #B5301B; }
.lines { margin: 2mm 0 0 10mm; }
.lines div { height: 8mm; border-bottom: 1px solid #CFC4BA; }
.loesung { margin: 0 0 3.5mm; break-inside: avoid; display: flex; gap: 3mm; }
.loesung .nr { flex: none; font-weight: 700; color: #B5301B; width: 7mm; }
.pagebreak { break-before: page; padding-top: 10mm; }
.total { text-align: right; font-weight: 700; margin: 0 0 4mm; font-size: 9.5pt; }
.note { font-size: 8.5pt; color: #5E5853; margin-top: 6mm; }
`;

function block(b) {
  const h = b.h ? `<h2>${esc(b.h)}</h2>` : '';
  switch (b.type) {
    case 'text': return h + (Array.isArray(b.text) ? b.text : [b.text]).map((t) => `<p>${rich(t)}</p>`).join('');
    case 'list': return h + `<ul>${b.items.map((i) => `<li>${rich(i)}</li>`).join('')}</ul>`;
    case 'table': return h + `<table><thead><tr>${b.head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${rich(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    case 'begriffe': return (b.h ? h : '<h2>Wichtige Begriffe</h2>') + `<table><thead><tr><th>Begriff</th><th>Bedeutung</th></tr></thead><tbody>${b.items.map(([t, d]) => `<tr><td class="term">${esc(t)}</td><td>${rich(d)}</td></tr>`).join('')}</tbody></table>`;
    case 'beispiel': return `<div class="box beispiel"><h3>${esc(b.h || 'Beispiel aus der Praxis')}</h3>${(Array.isArray(b.text) ? b.text : [b.text]).map((t) => `<p>${rich(t)}</p>`).join('')}</div>`;
    case 'merke': return `<div class="box merke"><h3>${esc(b.h || 'Merke')}</h3><ul>${b.items.map((i) => `<li>${rich(i)}</li>`).join('')}</ul></div>`;
    case 'formel': return `<div class="box formel">${b.h ? `<h3>${esc(b.h)}</h3>` : ''}${(Array.isArray(b.text) ? b.text : [b.text]).map((t) => `<p>${rich(t)}</p>`).join('')}</div>`;
    default: throw new Error('Unbekannter Block: ' + b.type);
  }
}

function html(d) {
  const crumb = [YEAR[d.year], d.hkb?.replace('hkb-', 'HKB ').replace(/ ([a-e])$/, (m, x) => ' ' + x), lfLabel(d.lf), d.modul && `Modul «${d.modul}»`].filter(Boolean).join(' · ');
  const kind = d.kind === 'uebung' ? 'Übungsblatt' : 'Merkblatt';
  let body = '';
  if (d.kind === 'uebung') {
    const total = d.aufgaben.reduce((s, a) => s + (a.punkte || 0), 0);
    body += `<p class="total">Total ${total} Punkte · Zeit: ca. ${d.zeit || Math.max(10, Math.round(total * 1.5))} Minuten</p>`;
    body += d.aufgaben.map((a, i) => `<div class="aufgabe"><div class="q"><span class="nr">${i + 1}</span><div class="txt">${rich(a.frage)}${a.liste ? `<ul>${a.liste.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>` : ''}</div><span class="pt">${a.punkte || ''} P.</span></div><div class="lines">${'<div></div>'.repeat(a.linien ?? 3)}</div></div>`).join('');
    body += `<section class="pagebreak"><h2>Lösungen</h2>${d.aufgaben.map((a, i) => `<div class="loesung"><span class="nr">${i + 1}</span><div>${(Array.isArray(a.loesung) ? a.loesung : [a.loesung]).map((t) => `<p>${rich(t)}</p>`).join('')}</div></div>`).join('')}</section>`;
  } else body += d.blocks.map(block).join('');
  return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="page">
    <header class="band"><div class="row"><span class="logo">${LOGO}</span><span class="kind">${kind}</span></div>
      <p class="crumb">${esc(crumb)}</p><h1>${esc(d.title)}</h1>${d.lead ? `<p class="lead">${rich(d.lead)}</p>` : ''}</header>
    <main>${body}<p class="note">Eigene Zusammenfassung von KV-Learn in eigenen Worten, abgestimmt auf das myKV-Modul${d.modul ? ` «${esc(d.modul)}»` : ''} und den Bildungsplan Kauffrau/Kaufmann EFZ 2023. Stand: 26.11.2026. Ohne Gewähr; massgebend sind die Unterlagen deiner Schule.</p></main>
  </div></body></html>`;
}

const filter = process.argv[2] || '';
const files = fs.readdirSync(IN).filter((f) => f.endsWith('.json') && f.includes(filter)).sort();
const browser = await chromium.launch();
const page = await browser.newPage();
let ok = 0; const fail = [];
for (const f of files) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8'));
    await page.setContent(html(d), { waitUntil: 'load' });
    const dir = path.join(OUT, d.folder.replace('/', '__'));
    fs.mkdirSync(dir, { recursive: true });
    await page.pdf({ path: path.join(dir, f.replace(/\.json$/, '.pdf')), format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-family:Arial;font-size:7.5pt;color:#5E5853;padding:0 18mm;display:flex;justify-content:space-between"><span>KV-Learn · ${esc(d.title)}</span><span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span></div>`, preferCSSPageSize: true });
    ok++;
  } catch (e) { fail.push(`${f}: ${e.message}`); }
}
await browser.close();
console.log(`${ok} PDF erstellt${fail.length ? `, ${fail.length} Fehler:\n  ` + fail.join('\n  ') : ''}`);
if (fail.length) process.exitCode = 1;
