// Erzeugt aus den Lernblatt-Inhalten (lernblaetter/inhalt/*.json) fertige Lernpakete für die App:
// lernblaetter/pakete/index.json (Übersicht) und lernblaetter/pakete/<id>.json (Inhalt im App-Format).
// Aufruf: node scripts/pakete.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = path.join(ROOT, 'lernblaetter', 'inhalt');
const OUT = path.join(ROOT, 'lernblaetter', 'pakete');
const YEAR = { lj1: '1. Lehrjahr', lj2: '2. Lehrjahr', lj3: '3. Lehrjahr' };
const hkbLabel = (h) => (h ? `HKB ${h.slice(-1)}` : '');
const lfLabel = (k) => (!k ? '' : k.startsWith('glf') ? `Grundlagenlernfeld ${k.slice(3)}` : `Lernfeld ${k.slice(2)}`);
const plain = (t) => String(t ?? '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
const arr = (t) => (Array.isArray(t) ? t : t == null ? [] : [t]);
const cell = (t) => String(t ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');

/** Lernblatt-Blöcke → Markdown (wie ihn renderMarkdown der App darstellt) */
function blocksToMd(blocks = []) {
  const out = [];
  for (const b of blocks) {
    if (b.h && !['beispiel', 'merke', 'formel'].includes(b.type)) out.push(`## ${b.h}`);
    switch (b.type) {
      case 'text': out.push(...arr(b.text)); break;
      case 'list': out.push(...b.items.map((i) => `- ${i}`)); break;
      case 'checkliste': out.push(...b.items.map((i) => `- ☐ ${i}`)); break;
      case 'table': out.push(`| ${b.head.map(cell).join(' | ')} |`, `| ${b.head.map(() => '---').join(' | ')} |`, ...b.rows.map((r) => `| ${r.map(cell).join(' | ')} |`)); break;
      case 'begriffe': if (!b.h) out.push('## Wichtige Begriffe'); out.push('| Begriff | Bedeutung |', '| --- | --- |', ...b.items.map(([t, d]) => `| **${cell(t)}** | ${cell(d)} |`)); break;
      case 'beispiel': out.push(`### ${b.h || 'Beispiel aus der Praxis'}`, ...arr(b.text)); break;
      case 'merke': out.push(`### ${b.h || 'Merke'}`, ...b.items.map((i) => `- ${i}`)); break;
      case 'formel': out.push(`### ${b.h || 'Formel'}`, ...arr(b.text).map((t) => `**${plain(t)}**`)); break;
      case 'felder': if (b.head) out.push(`| ${b.head.map(cell).join(' | ')} |`, `| ${b.head.map(() => '---').join(' | ')} |`, ...(b.rows || []).map((r) => `| ${r.map(cell).join(' | ')} |`)); else out.push(...b.items.map((i) => `- ${plain(i)}: ____________________`)); break;
      case 'karten': break; // werden zu Lernkarten
      default: break;
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
const cardsOf = (d) => (d.blocks || []).flatMap((b) => (b.type === 'begriffe' || b.type === 'karten' ? b.items.map(([t, x]) => ({ term: plain(t), def: plain(x) })) : [])).filter((c) => c.term && c.def);

/** Aufgaben (Übung, Quiz, Prüfung) → Fragen im App-Format (offene Fragen mit Musterlösung) */
const questionsOf = (d) => (d.aufgaben || []).map((a, i) => ({
  key: `q${i + 1}`, type: 'open', points: a.punkte || 2,
  prompt: [plain(a.frage), ...arr(a.liste).map((x) => plain(x))].join('\n'),
  model: arr(a.loesung).map(plain).join('\n'), keywords: [], explanation: a.bewertung ? plain(a.bewertung) : '',
}));

const KAT = { Lernkarten: 'karten', Glossar: 'karten', Probeprüfung: 'pruefung', Fallstudie: 'pruefung', Quiz: 'quiz', Zusammenfassung: 'unterlage', Überblick: 'unterlage', Formelsammlung: 'unterlage', Lerntechnik: 'unterlage', Vorlage: 'unterlage', Checkliste: 'unterlage' };

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(IN).filter((f) => f.endsWith('.json'));
const byModule = new Map();
const pakete = [];
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8'));
  if (d.modul) { // Modul-Paket: Merkblatt + Übung zusammen
    const key = f.replace(/-(merkblatt|uebung)\.json$/, '');
    const p = byModule.get(key) || { id: key, kategorie: 'modul', year: d.year, hkb: d.hkb, lf: d.lf, modul: d.modul, title: d.modul,
      subject: `${hkbLabel(d.hkb)} · ${YEAR[d.year]}`, topic: d.modul, sources: [], cards: [], contents: [] };
    if (d.kind === 'merkblatt') { p.sources.push({ title: `Merkblatt: ${d.title}`, content: [d.lead || '', blocksToMd(d.blocks)].filter(Boolean).join('\n\n') }); p.cards.push(...cardsOf(d)); }
    if (d.kind === 'uebung') p.contents.push({ type: 'quiz', title: `Übung: ${d.modul}`, data: { questions: questionsOf(d) } });
    byModule.set(key, p);
    continue;
  }
  const kat = KAT[d.label] || 'unterlage';
  const id = f.replace(/\.json$/, '');
  const thema = d.thema && !['Lerntechnik', 'Formelsammlung', 'Quiz', 'Fallstudie', 'Überblick'].includes(d.thema) ? d.thema : '';
  const p = { id, kategorie: kat, art: d.label || '', year: d.year, hkb: /^HKB [a-e]$/.test(thema) ? `hkb-${thema.slice(-1)}` : null, title: d.title,
    subject: `Allgemeines · ${YEAR[d.year]}`, topic: d.title, sources: [], cards: [], contents: [] };
  if (d.kind === 'pruefung') p.contents.push({ type: 'exam', title: d.title, data: { questions: questionsOf(d), intro: blocksToMd(d.blocks), zeit: d.zeit || null, hilfsmittel: d.hilfsmittel || '' } });
  else if (d.kind === 'uebung') p.contents.push({ type: 'quiz', title: d.title, data: { questions: questionsOf(d) } });
  else {
    const md = blocksToMd(d.blocks);
    if (md) p.sources.push({ title: d.title, content: [d.lead || '', md].filter(Boolean).join('\n\n') });
    p.cards.push(...cardsOf(d));
  }
  pakete.push(p);
}
pakete.push(...byModule.values());

const index = pakete.map((p) => ({ id: p.id, kategorie: p.kategorie, art: p.art || '', year: p.year, hkb: p.hkb || null, lf: p.lf || null, title: p.title,
  hkbLabel: hkbLabel(p.hkb), lfLabel: lfLabel(p.lf), cards: p.cards.length, questions: p.contents.reduce((s, c) => s + c.data.questions.length, 0), sources: p.sources.length,
  exam: p.contents.some((c) => c.type === 'exam') }));
index.sort((a, b) => (a.year + (a.hkb || 'z') + (a.lf || '') + a.title).localeCompare(b.year + (b.hkb || 'z') + (b.lf || '') + b.title, 'de-CH'));
for (const p of pakete) fs.writeFileSync(path.join(OUT, `${p.id}.json`), JSON.stringify({ ...p, version: '2026-11-26' }));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ version: '2026-11-26', pakete: index }));
const sum = (k) => index.reduce((s, p) => s + p[k], 0);
console.log(`${index.length} Pakete: ${sum('cards')} Karten, ${sum('questions')} Fragen, ${sum('sources')} Unterlagen`);
