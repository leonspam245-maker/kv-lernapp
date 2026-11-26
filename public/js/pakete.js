// Ansicht «Lernpakete»: fertige Merkblätter, Lernkarten, Übungen und Probeprüfungen mit einem Klick übernehmen.
// Nur online und nur für Konten mit bestätigter Schul-E-Mail-Adresse (Inhalte stützen sich auf myKV).
import { store, commit } from './store.js';
import { esc, uid, plural, norm, todayISO } from './util.js';
import { toast, emptyState } from './ui.js';
import { isCloud, isSchoolMember, paketeIndex, paketLaden } from './backend.js';
import { applyPaket, hasPaket } from './pakete-core.js';

const YEARS = [['lj1', '1. Lehrjahr'], ['lj2', '2. Lehrjahr'], ['lj3', '3. Lehrjahr']];
const KATS = [['alle', 'Alle'], ['modul', 'Module'], ['pruefung', 'Probeprüfungen & Fallstudien'], ['quiz', 'Quiz'], ['karten', 'Lernkarten'], ['unterlage', 'Unterlagen']];
const KAT_LABEL = { modul: 'Modul', pruefung: 'Probeprüfung', quiz: 'Quiz', karten: 'Lernkarten', unterlage: 'Unterlage' };

let cache = null; // { member, index }
const state = { year: '', kat: 'alle', q: '', selected: new Set() };

async function load() {
  if (cache) return cache;
  const member = await isSchoolMember();
  cache = { member, index: member ? (await paketeIndex()).pakete : [] };
  return cache;
}
const myYear = () => { const y = Number(store.db?.settings?.profile?.apprenticeshipYear); return y >= 1 && y <= 3 ? `lj${y}` : 'lj1'; };

export function paketeView(el, _p, query = {}) {
  if (!state.year) state.year = query.jahr || myYear();
  if (query.kat) state.kat = query.kat;
  el.innerHTML = '<div class="page-head"><div><h1>Lernpakete</h1><p>Wird geladen …</p></div></div>';
  if (!isCloud()) {
    el.innerHTML = `<div class="page-head"><div><h1>Lernpakete</h1></div></div>${emptyState('Nur online verfügbar', 'Die Lernpakete gibt es in der Online-Version von KV-Learn unter kv-learn.app.')}`;
    return;
  }
  load().then(() => {
    if (!el.isConnected) return;
    if (!cache.member) {
      el.innerHTML = `<div class="page-head"><div><h1>Lernpakete</h1></div></div>${emptyState('Nur mit Schul-E-Mail-Adresse', 'Die Lernpakete stehen Konten mit bestätigter Schul-E-Mail-Adresse offen.')}`;
      return;
    }
    render(el);
  }).catch((e) => {
    cache = null;
    el.innerHTML = `<div class="page-head"><div><h1>Lernpakete</h1></div></div><div class="notice notice-bad"><p>${esc(e.message)}</p><button class="btn" id="retry">Erneut versuchen</button></div>`;
    el.querySelector('#retry').addEventListener('click', () => paketeView(el, null, query));
  });
}

function visible() {
  const t = norm(state.q);
  return cache.index.filter((p) => p.year === state.year && (state.kat === 'alle' || p.kategorie === state.kat) && (!t || norm(`${p.title} ${p.hkbLabel} ${p.lfLabel} ${p.art}`).includes(t)));
}
const groupKey = (p) => (p.kategorie === 'modul' ? `${p.hkbLabel} · ${p.lfLabel}` : `${KAT_LABEL[p.kategorie]}${p.hkbLabel ? ` · ${p.hkbLabel}` : ''}`);
const meta = (p) => [p.art && p.kategorie !== 'modul' ? p.art : '', p.sources ? (p.kategorie === 'modul' ? 'Merkblatt' : plural(p.sources, 'Unterlage', 'Unterlagen')) : '', p.cards ? plural(p.cards, 'Karte', 'Karten') : '', p.questions ? `${plural(p.questions, 'Aufgabe', 'Aufgaben')}${p.exam ? ' mit Timer' : ''}` : ''].filter(Boolean).join(' · ');

function render(el) {
  const list = visible();
  const groups = new Map();
  for (const p of list) { const k = groupKey(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const done = (p) => hasPaket(store.db, p.id);
  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow"><a href="#/faecher">Fächer</a></div><h1>Lernpakete</h1>
      <p>Fertige Merkblätter, Lernkarten, Übungen und Probeprüfungen, gegliedert wie myKV. Mit einem Klick landen sie in deinen Fächern.</p></div></div>
    <div class="tabs" role="tablist">${YEARS.map(([y, l]) => `<button role="tab" data-year="${y}" aria-selected="${state.year === y}">${l}</button>`).join('')}</div>
    <div class="pakete-filter">
      <div class="chips" role="group" aria-label="Art">${KATS.map(([k, l]) => `<button class="chip${state.kat === k ? ' on' : ''}" data-kat="${k}" aria-pressed="${state.kat === k}">${l}</button>`).join('')}</div>
      <div class="field"><label for="pk-q" class="sr-only">Suchen</label><input type="search" id="pk-q" placeholder="Suchen, z. B. Kaufvertrag oder Excel" value="${esc(state.q)}" autocomplete="off"></div>
    </div>
    ${list.length ? [...groups].map(([g, ps]) => `<section class="card pakete-gruppe">
      <div class="tile-head"><h2>${esc(g)}</h2>${ps.some((p) => !done(p)) ? `<button class="btn-link" data-all="${esc(g)}">Alle auswählen</button>` : ''}</div>
      <ul class="list">${ps.map((p) => `<li><label class="paket-row${done(p) ? ' is-done' : ''}">
        <input type="checkbox" data-id="${esc(p.id)}" ${done(p) ? 'disabled checked' : state.selected.has(p.id) ? 'checked' : ''}>
        <span><span class="title">${esc(p.title)}</span> ${done(p) ? '<span class="badge badge-ok">übernommen</span>' : ''}<br><span class="meta">${esc(meta(p))}</span></span></label></li>`).join('')}</ul></section>`).join('')
    : emptyState('Nichts gefunden', 'Versuche einen anderen Begriff oder eine andere Auswahl.')}
    <div class="pakete-bar" ${state.selected.size ? '' : 'hidden'}><span id="pk-count">${plural(state.selected.size, 'Paket', 'Pakete')} ausgewählt</span><button class="btn btn-primary" id="pk-go">Übernehmen</button></div>`;
  el.querySelectorAll('[data-year]').forEach((b) => b.addEventListener('click', () => { state.year = b.dataset.year; render(el); }));
  el.querySelectorAll('[data-kat]').forEach((b) => b.addEventListener('click', () => { state.kat = b.dataset.kat; render(el); }));
  const q = el.querySelector('#pk-q');
  q.addEventListener('input', () => { state.q = q.value; const pos = q.selectionStart; render(el); const n = el.querySelector('#pk-q'); n.focus(); n.setSelectionRange(pos, pos); });
  el.querySelectorAll('input[data-id]:not(:disabled)').forEach((c) => c.addEventListener('change', () => { if (c.checked) state.selected.add(c.dataset.id); else state.selected.delete(c.dataset.id); updateBar(el); }));
  el.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => { (groups.get(b.dataset.all) || []).filter((p) => !done(p)).forEach((p) => state.selected.add(p.id)); render(el); }));
  el.querySelector('#pk-go')?.addEventListener('click', () => uebernehmen(el));
}
function updateBar(el) {
  const bar = el.querySelector('.pakete-bar');
  bar.hidden = !state.selected.size;
  el.querySelector('#pk-count').textContent = `${plural(state.selected.size, 'Paket', 'Pakete')} ausgewählt`;
}

async function uebernehmen(el) {
  const btn = el.querySelector('#pk-go');
  if (btn.disabled) return;
  const ids = [...state.selected].filter((id) => !hasPaket(store.db, id));
  btn.disabled = true;
  try {
    const pakete = [];
    for (const [i, id] of ids.entries()) { btn.textContent = `Wird geladen … ${i + 1}/${ids.length}`; pakete.push(await paketLaden(id)); }
    btn.textContent = 'Wird gespeichert …';
    const sum = { cards: 0, contents: 0, sources: 0 };
    await commit((db) => {
      sum.cards = 0; sum.contents = 0; sum.sources = 0; // commit kann bei Konflikten wiederholt werden
      for (const p of pakete) { const r = applyPaket(db, p, { today: todayISO(), uid }); if (!r.skipped) { sum.cards += r.cards; sum.contents += r.contents; sum.sources += r.sources; } }
    });
    state.selected.clear();
    toast(`${plural(pakete.length, 'Paket', 'Pakete')} übernommen: ${plural(sum.sources, 'Unterlage', 'Unterlagen')}, ${plural(sum.cards, 'Karte', 'Karten')}, ${plural(sum.contents, 'Übung/Prüfung', 'Übungen/Prüfungen')}.`, 'success', { action: 'Zu den Fächern', onAction: () => { location.hash = '#/faecher'; } });
    render(el);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Übernehmen';
    toast(e.message, 'error');
  }
}
