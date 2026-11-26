// Gemeinsame Ablage: Lehrmittel, Handouts und Zusammenfassungen, die alle angemeldeten Personen teilen.
// Ordnerstruktur fest vorgegeben: Lehrjahr → Handlungskompetenzbereich (HKB) nach Bildungsplan Kauffrau/Kaufmann EFZ 2023.
import { store } from './store.js';
import { esc, fmtDate, norm, plural } from './util.js';
import { toast, confirmDialog, emptyState } from './ui.js';
import { isCloud, isSchoolMember, listClasses, listLibrary, isLibraryAdmin, uploadLibraryItem, libraryFileUrl, libraryFile, reportLibraryItem, deleteLibraryItem, setLibraryHidden } from './backend.js';
import { importFromLibrary } from './import.js';
import { setLeaveGuard } from './app.js';
import { MYKV } from './mykv-struktur.js';

export const YEARS = [['lj1', '1. Lehrjahr'], ['lj2', '2. Lehrjahr'], ['lj3', '3. Lehrjahr']];
const HKB = [
  ['hkb-a', 'HKB a', 'Handeln in agilen Arbeits- und Organisationsformen'],
  ['hkb-b', 'HKB b', 'Interagieren in einem vernetzten Arbeitsumfeld'],
  ['hkb-c', 'HKB c', 'Koordinieren von unternehmerischen Arbeitsprozessen'],
  ['hkb-d', 'HKB d', 'Gestalten von Kunden- oder Lieferantenbeziehungen'],
  ['hkb-e', 'HKB e', 'Einsetzen von Technologien der digitalen Arbeitswelt'],
];
const EXTRA = [
  ['wahlpflicht', 'Wahlpflichtbereich', '2. Fremdsprache oder individuelle Projektarbeit'],
  ['uek', 'Überbetriebliche Kurse (üK)', 'Unterlagen und Aufträge aus den üK'],
  ['allgemein', 'Allgemeines', 'Lerntechnik, Stundenpläne, Vorlagen und Übergreifendes'],
];
const QV = ['qv', 'Qualifikationsverfahren (QV)', 'Prüfungsvorbereitung, Probeprüfungen und Hinweise zum QV'];
// Optionen im 3. Lehrjahr (wie in myKV)
const OPTIONS = [
  ['option-finanzen', 'Option Finanzen', 'Buchhaltung vertiefen an einem Gesamtfall'],
  ['option-kommunikation', 'Option Kommunikation Landessprache', 'Kommunikative Fähigkeiten in der Landessprache'],
  ['option-technologie', 'Option Technologie', 'Websites, Datenbanken und digitale Werkzeuge'],
];

/** Hauptordner eines Lehrjahres */
export const foldersOf = (year) => [...HKB, ...(year === 'lj3' ? OPTIONS : []), ...EXTRA, ...(year === 'lj3' ? [QV] : [])].map(([id, short, long]) => ({ id: `${year}/${id}`, short, long }));
const lfLabel = (k) => (k.startsWith('glf') ? `Grundlagenlernfeld ${k.slice(3)}` : `Lernfeld ${k.slice(2)}`);
/** Unterordner eines HKB: die Lernfelder aus myKV mit ihren Modulen */
// Feste Unterordner von «Allgemeines»
const ALLGEMEIN = [
  ['pruefungen', 'Probeprüfungen', 'Prüfungen pro HKB und Semester, Lösungen separat'],
  ['zusammenfassungen', 'Zusammenfassungen', 'Überblick pro HKB, Glossare und Jahresüberblick'],
  ['formeln', 'Formelsammlungen', 'Rechnen, Excel, Gesetzesartikel und Regeln auf einen Blick'],
  ['lerntechnik', 'Lerntechnik & Vorlagen', 'Lernmethoden, Lernpläne, Checklisten und Vorlagen'],
  ['lernkarten', 'Lernkarten', 'Karten zum Ausdrucken und Ausschneiden'],
  ['fallstudien', 'Fallstudien', 'HKB-übergreifende Praxisfälle aus Tourismus und Büro'],
  ['quiz', 'Quiz & Rätsel', 'Wissensquiz, Zuordnen, Richtig/Falsch und häufige Fehler'],
];
export const subfoldersOf = (folderId) => {
  const [year, hkb] = folderId.split('/');
  if (hkb === 'allgemein') return ALLGEMEIN.map(([k, short, long]) => ({ id: `${folderId}-${k}`, short, long, parent: folderId }));
  return Object.entries(MYKV[year]?.[hkb] || {}).map(([k, modules]) => ({ id: `${folderId}-${k}`, short: lfLabel(k), long: modules.join(' · '), modules, parent: folderId }));
};
const allFolders = (year) => foldersOf(year).flatMap((f) => [f, ...subfoldersOf(f.id)]);
const yearLabel = (year) => YEARS.find(([y]) => y === year)?.[1] || year;
const folderInfo = (folder) => allFolders(folder.split('/')[0]).find((f) => f.id === folder);
/** Pfadangabe für Trefferlisten, z. B. «HKB c · Lernfeld 4» */
const folderPath = (f) => (f.parent ? `${folderInfo(f.parent).short} · ${f.short}` : f.short);

// Erlaubte Formate (gleiche Liste wie im Speicher von Supabase)
const TYPES = {
  pdf: ['application/pdf', 'PDF'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Word'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PowerPoint'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel'],
  txt: ['text/plain', 'Text'],
  png: ['image/png', 'Bild'],
  jpg: ['image/jpeg', 'Bild'],
  jpeg: ['image/jpeg', 'Bild'],
};
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = Object.keys(TYPES).map((x) => '.' + x).join(',');
const extOf = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const typeLabel = (item) => Object.values(TYPES).find(([m]) => m === item.mime)?.[1] || 'Datei';
const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.0', '')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const importable = (item) => ['pdf', 'docx', 'txt'].includes(extOf(item.file_name));
const REASONS = ['Urheberrecht verletzt (z. B. Lehrmittel eines Verlags)', 'Persönliche Daten sichtbar', 'Unpassender Inhalt', 'Falscher Ordner oder fehlerhafte Datei'];

let cache = { items: null, admin: false, member: false, at: 0 };
async function load(force = false) {
  if (!force && cache.items && Date.now() - cache.at < 30000) return cache;
  const member = await isSchoolMember();
  const [items, admin] = member ? await Promise.all([listLibrary(), isLibraryAdmin()]) : [[], false];
  cache = { items, admin, member, at: Date.now() };
  return cache;
}

/** Route #/ablage, #/ablage/lj1 und #/ablage/lj1/hkb-a */
export function ablageView(el, param = '', query = {}) {
  if (!isCloud()) {
    el.innerHTML = `<div class="page-head"><div><h1>Ablage</h1></div></div>${emptyState('Nur online verfügbar', 'Die gemeinsame Ablage gibt es nur in der Online-Version von KV-Learn unter kv-learn.app.')}`;
    return;
  }
  el.innerHTML = '<div class="page-head"><div><h1>Ablage</h1><p>Wird geladen …</p></div></div>';
  load(Boolean(query.neu)).then(() => {
    if (!el.isConnected) return;
    if (!cache.member) {
      el.innerHTML = `<div class="page-head"><div><h1>Ablage</h1></div></div>${emptyState('Nur mit Schul-E-Mail-Adresse', 'Die gemeinsame Ablage steht nur Konten offen, die mit einer bestätigten Schul-E-Mail-Adresse registriert sind. So haben nur KV-Lernende Zugang. Erstelle ein Konto mit deiner Schuladresse, oder melde dich bei info@kv-learn.app.')}`;
      return;
    }
    if (!param) overview(el);
    else if (/^kl\/[0-9a-f-]{36}$/.test(param)) classFolderView(el, param);
    else if (/^lj[123]$/.test(param)) yearView(el, param);
    else if (folderInfo(param)) folderView(el, param);
    else el.innerHTML = emptyState('Ordner nicht gefunden', 'Diesen Ordner gibt es in der Ablage nicht.', '<a class="btn" href="#/ablage">Zur Ablage</a>');
  }).catch((e) => {
    el.innerHTML = `<div class="page-head"><div><h1>Ablage</h1></div></div><div class="notice notice-bad"><p>${esc(e.message)}</p><button class="btn" id="retry">Erneut versuchen</button></div>`;
    el.querySelector('#retry').addEventListener('click', () => ablageView(el, param, { neu: 1 }));
  });
}

// Anzahl Dateien in einem Ordner samt Unterordnern (Lehrjahr «lj1», HKB «lj1/hkb-a» oder Lernfeld «lj1/hkb-a-lf1»)
const countIn = (id) => cache.items.filter((i) => i.folder === id || i.folder.startsWith(id + (id.includes('/') ? '-' : '/'))).length;
const myYear = () => { const y = Number(store.db?.settings?.profile?.apprenticeshipYear || store.user?.user_metadata?.apprenticeshipYear); return y >= 1 && y <= 3 ? `lj${y}` : ''; };

function overview(el) {
  const mine = myYear();
  el.innerHTML = `
    <div class="page-head"><div><h1>Ablage</h1><p>Gemeinsamer Ordner für Handouts, Zusammenfassungen und Vorlagen. Zugang haben nur KV-Lernende mit bestätigter Schul-E-Mail-Adresse.</p></div></div>
    <div class="field ablage-search"><label for="lib-q">In der ganzen Ablage suchen</label><input type="search" id="lib-q" placeholder="Titel, Beschreibung oder Dateiname" autocomplete="off"></div>
    <div id="lib-results"></div>
    <div class="ablage-years" id="lib-years">${YEARS.map(([y, label]) => `
      <section class="card ablage-year${y === mine ? ' is-mine' : ''}">
        <div class="tile-head"><h2><a href="#/ablage/${y}">${label}</a></h2>${y === mine ? '<span class="badge badge-accent">Dein Lehrjahr</span>' : ''}</div>
        <p class="meta">${plural(countIn(y), 'Datei', 'Dateien')}</p>
        <ul class="list">${foldersOf(y).map((f) => folderLink(f)).join('')}</ul>
      </section>`).join('')}</div>
    <div id="lib-klassen"></div>
    ${rulesHtml()}`;
  listClasses().then((cls) => {
    const box = el.querySelector('#lib-klassen');
    if (!box) return;
    box.innerHTML = `<section class="card ablage-klassen"><div class="tile-head"><h2>Klassenordner</h2><a class="btn-link" href="#/klassen">${cls.length ? 'Klassen verwalten' : 'Klasse erstellen oder beitreten'}</a></div>
      ${cls.length ? `<ul class="list">${cls.map((c) => { const n = cache.items.filter((i) => i.folder === `kl/${c.id}`).length; return `<li><a class="list-link" href="#/ablage/kl/${esc(c.id)}"><span><span class="title">${esc(c.name)}</span><br><span class="meta">Nur für Mitglieder dieser Klasse sichtbar</span></span><span class="badge${n ? ' badge-accent' : ''}">${n}</span><span aria-hidden="true">›</span></a></li>`; }).join('')}</ul>` : '<p class="muted small">Teile Unterlagen nur mit deiner Klasse oder Lerngruppe.</p>'}</section>`;
  }).catch(() => {});
  const q = el.querySelector('#lib-q');
  q.addEventListener('input', () => {
    const t = norm(q.value);
    const box = el.querySelector('#lib-results');
    el.querySelector('#lib-years').hidden = Boolean(t);
    if (!t) { box.innerHTML = ''; return; }
    const hits = cache.items.filter((i) => norm(`${i.title} ${i.description || ''} ${i.file_name}`).includes(t));
    box.innerHTML = `<section class="card"><h2>${plural(hits.length, 'Treffer', 'Treffer')}</h2>${hits.length ? itemList(hits, true) : '<p class="muted">Nichts gefunden. Versuche einen anderen Begriff.</p>'}</section>`;
    bindItems(box, () => q.dispatchEvent(new Event('input')));
  });
}

function folderLink(f) {
  const n = countIn(f.id);
  return `<li><a class="list-link" href="#/ablage/${f.id}"><span><span class="title">${esc(f.short)}</span><br><span class="meta${f.modules ? ' ablage-modules' : ''}">${f.modules ? 'myKV: ' : ''}${esc(f.long)}</span></span><span class="badge${n ? ' badge-accent' : ''}">${n}</span><span aria-hidden="true">›</span></a></li>`;
}

function yearView(el, year) {
  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow"><a href="#/ablage">Ablage</a></div><h1>${yearLabel(year)}</h1><p>${plural(countIn(year), 'Datei', 'Dateien')} in ${foldersOf(year).length} Ordnern</p></div></div>
    <section class="card"><ul class="list">${foldersOf(year).map((f) => folderLink(f)).join('')}</ul></section>`;
}

async function classFolderView(el, folder) {
  const cls = (await listClasses()).find((c) => `kl/${c.id}` === folder);
  if (!cls) { el.innerHTML = emptyState('Klassenordner nicht gefunden', 'Du bist kein Mitglied dieser Klasse.', '<a class="btn" href="#/klassen">Zu den Klassen</a>'); return; }
  const items = cache.items.filter((i) => i.folder === folder);
  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow"><a href="#/ablage">Ablage</a> › <a href="#/klassen/${esc(cls.id)}">Klasse</a></div><h1>${esc(cls.name)}</h1><p>Klassenordner – nur Mitglieder dieser Klasse sehen die Dateien.</p></div>
      <button class="btn btn-primary" id="lib-add" aria-expanded="false">Datei hochladen</button></div>
    <div id="lib-upload"></div>
    <section class="card">${items.length ? itemList(items) : emptyState('Noch leer', 'Teile Zusammenfassungen oder Aufträge mit deiner Klasse.')}</section>`;
  const btn = el.querySelector('#lib-add');
  btn.addEventListener('click', () => {
    const box = el.querySelector('#lib-upload');
    const open = !box.innerHTML;
    btn.setAttribute('aria-expanded', String(open));
    if (open) uploadForm(box, folder, () => classFolderView(el, folder)); else { box.innerHTML = ''; setLeaveGuard(null); }
  });
  bindItems(el, () => classFolderView(el, folder));
}

function folderView(el, folder) {
  const f = folderInfo(folder);
  const year = folder.split('/')[0];
  const parent = f.parent ? folderInfo(f.parent) : null;
  const subs = subfoldersOf(folder);
  const items = cache.items.filter((i) => i.folder === folder);
  const empty = emptyState('Noch leer', subs.length
    ? (subs[0].modules ? 'Hier liegen Dateien, die den ganzen HKB betreffen. Für ein bestimmtes Thema wähle oben das passende Lernfeld.' : 'Hier liegen Dateien ohne eigenen Unterordner. Die meisten Dateien findest du oben in den Unterordnern.')
    : 'In diesem Ordner liegt noch nichts. Teile eine eigene Zusammenfassung oder ein Handout, das du weitergeben darfst.');
  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow"><a href="#/ablage">Ablage</a> › <a href="#/ablage/${year}">${yearLabel(year)}</a>${parent ? ` › <a href="#/ablage/${parent.id}">${esc(parent.short)}</a>` : ''}</div>
      <h1>${esc(parent ? `${parent.short} · ${f.short}` : f.short)}</h1>
      ${f.modules ? `<p>Passende Module in myKV:</p><ul class="ablage-chips">${f.modules.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : `<p>${esc(f.long)}</p>`}</div>
      <button class="btn btn-primary" id="lib-add" aria-expanded="false">Datei hochladen</button></div>
    <div id="lib-upload"></div>
    ${subs.length ? `<section class="card"><h2>${subs[0].modules ? 'Lernfelder' : 'Unterordner'}</h2>${subs[0].modules ? '<p class="small muted">Gegliedert wie die Lernmodule in myKV.</p>' : ''}<ul class="list">${subs.map((s2) => folderLink(s2)).join('')}</ul></section>` : ''}
    <section class="card">${subs.length ? `<h2>${subs[0].modules ? `Übergreifend zu ${esc(f.short)}` : 'Weitere Dateien'}</h2>` : ''}${items.length ? itemList(items) : empty}</section>`;
  const btn = el.querySelector('#lib-add');
  btn.addEventListener('click', () => {
    const box = el.querySelector('#lib-upload');
    const open = !box.innerHTML;
    btn.setAttribute('aria-expanded', String(open));
    if (open) uploadForm(box, folder, () => folderView(el, folder)); else { box.innerHTML = ''; setLeaveGuard(null); }
  });
  bindItems(el, () => folderView(el, folder));
}

function itemList(items, showFolder = false) {
  const me = store.user?.id;
  return `<ul class="list ablage-items">${items.map((i) => {
    const own = i.uploader_id === me;
    const f = showFolder ? folderInfo(i.folder) : null; // unbekannter Ordner (z. B. alte Struktur): ohne Pfad anzeigen
    return `<li data-item="${esc(i.id)}">
      <div class="ablage-item">
        <span class="ablage-type" aria-hidden="true">${esc(extOf(i.file_name).toUpperCase() || 'DATEI')}</span>
        <div class="ablage-body">
          <p class="title">${esc(i.title)} ${i.hidden ? '<span class="badge badge-warn">Ausgeblendet</span>' : ''}</p>
          ${i.description ? `<p class="ablage-desc">${esc(i.description)}</p>` : ''}
          <p class="meta">${f ? `<a href="#/ablage/${esc(i.folder)}">${yearLabel(i.folder.split('/')[0])} · ${esc(folderPath(f))}</a> · ` : ''}${typeLabel(i)} · ${fmtSize(i.size_bytes)} · von ${esc(i.uploader_name || 'Anonym')}${own ? ' (du)' : ''} · ${fmtDate(i.created_at.slice(0, 10))}${cache.admin && i.report_count ? ` · ${plural(i.report_count, 'Meldung', 'Meldungen')}` : ''}</p>
          ${i.hidden && own && !cache.admin ? '<p class="small muted">Nach Meldungen ausgeblendet. Nur du siehst den Eintrag, bis er geprüft ist.</p>' : ''}
          <div class="row ablage-actions">
            <button class="btn btn-small btn-primary" data-act="open">Öffnen</button>
            <button class="btn btn-small" data-act="download">Herunterladen</button>
            ${importable(i) ? '<button class="btn btn-small" data-act="import">In meine Unterlagen</button>' : ''}
            ${!own ? '<button class="btn-link" data-act="report">Melden</button>' : ''}
            ${cache.admin ? `<button class="btn-link" data-act="${i.hidden ? 'show' : 'hide'}">${i.hidden ? 'Wieder einblenden' : 'Ausblenden'}</button>` : ''}
            ${own || cache.admin ? '<button class="btn-link btn-link-danger" data-act="delete">Löschen</button>' : ''}
          </div>
          <div class="ablage-report"></div>
        </div>
      </div></li>`;
  }).join('')}</ul>`;
}

function bindItems(root, refresh) {
  root.querySelectorAll('[data-item]').forEach((li) => {
    const item = cache.items.find((x) => x.id === li.dataset.item);
    li.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act, item, li, refresh, b)));
  });
}

async function act(action, item, li, refresh, btn) {
  try {
    if (action === 'open') {
      // Fenster sofort öffnen (sonst blockiert der Browser das Popup nach dem Warten auf den Link)
      const w = window.open('', '_blank');
      try { const url = await libraryFileUrl(item); if (w) { w.opener = null; w.location.href = url; } else location.href = url; }
      catch (e) { w?.close(); throw e; }
    } else if (action === 'download') {
      location.href = await libraryFileUrl(item, true);
    } else if (action === 'import') {
      btn.disabled = true; btn.textContent = 'Wird geladen …';
      importFromLibrary(await libraryFile(item));
      location.hash = '#/import';
    } else if (action === 'report') {
      reportForm(li.querySelector('.ablage-report'), item);
    } else if (action === 'hide' || action === 'show') {
      await setLibraryHidden(item.id, action === 'hide');
      item.hidden = action === 'hide';
      toast(item.hidden ? 'Eintrag ausgeblendet.' : 'Eintrag wieder sichtbar.');
      refresh();
    } else if (action === 'delete') {
      if (!(await confirmDialog(`«${item.title}» endgültig aus der Ablage löschen?`, { ok: 'Löschen', danger: true }))) return;
      await deleteLibraryItem(item);
      cache.items = cache.items.filter((x) => x.id !== item.id);
      toast('Eintrag gelöscht.');
      refresh();
    }
  } catch (e) {
    if (btn) { btn.disabled = false; if (action === 'import') btn.textContent = 'In meine Unterlagen'; }
    toast(e.message, 'error');
  }
}

function reportForm(box, item) {
  if (box.innerHTML) { box.innerHTML = ''; return; }
  box.innerHTML = `<form class="ablage-report-form" autocomplete="off">
    <fieldset><legend>Warum meldest du diesen Eintrag?</legend>
      ${REASONS.map((r, n) => `<label class="check"><input type="radio" name="reason" value="${esc(r)}" ${n === 0 ? 'checked' : ''}> ${esc(r)}</label>`).join('')}</fieldset>
    <div class="field"><label for="rep-${esc(item.id)}">Ergänzung (optional)</label><input type="text" id="rep-${esc(item.id)}" name="note" maxlength="300"></div>
    <p class="small muted">Nach zwei Meldungen wird der Eintrag automatisch ausgeblendet und vom Betreiber geprüft.</p>
    <div class="row"><button class="btn btn-small btn-primary">Meldung senden</button><button type="button" class="btn btn-small" data-cancel>Abbrechen</button></div></form>`;
  const form = box.querySelector('form');
  form.querySelector('[data-cancel]').addEventListener('click', () => { box.innerHTML = ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const send = form.querySelector('.btn-primary');
    if (send.disabled) return;
    send.disabled = true;
    const note = form.note.value.trim();
    try {
      await reportLibraryItem(item.id, (form.reason.value + (note ? `: ${note}` : '')).slice(0, 500));
      box.innerHTML = '<p class="notice notice-info small">Danke, die Meldung ist eingegangen.</p>';
    } catch (err) { send.disabled = false; toast(err.message, 'error'); }
  });
}

function uploadForm(box, folder, onDone) {
  const year = folder.split('/')[0];
  const fixed = folder.startsWith('kl/'); // Klassenordner: kein Wechsel von Lehrjahr/Ordner
  box.innerHTML = `<section class="card ablage-upload">
    <h2>${fixed ? 'Datei in den Klassenordner hochladen' : 'Datei in die Ablage hochladen'}</h2>
    <form id="lib-form" autocomplete="off" novalidate>
      ${fixed ? `<input type="hidden" name="folder" value="${esc(folder)}">` : `<div class="grid grid-2">
        <div class="field"><label for="lib-year">Lehrjahr</label><select id="lib-year">${YEARS.map(([y, l]) => `<option value="${y}" ${y === year ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="lib-folder">Ordner</label><select id="lib-folder" name="folder"></select></div>
      </div>`}
      <div class="field"><span class="label">Datei</span>
        <div class="ablage-file"><label class="btn" for="lib-file">Datei auswählen</label><input type="file" id="lib-file" name="file" accept="${ACCEPT}" hidden><span class="name muted" id="lib-fname">Keine Datei ausgewählt</span></div>
        <p class="hint">PDF, Word, PowerPoint, Excel, Text oder Bild (PNG, JPG), höchstens 20 MB</p></div>
      <div class="field"><label for="lib-title">Titel</label><input type="text" id="lib-title" name="title" maxlength="140" placeholder="z. B. Zusammenfassung Kaufvertrag OR"></div>
      <div class="field"><label for="lib-desc">Beschreibung (optional)</label><textarea id="lib-desc" name="description" maxlength="500" style="min-height:80px" placeholder="Worum geht es? Für welche Prüfung oder welches Thema?"></textarea></div>
      <div class="notice notice-info small"><p>Alle Lernenden mit Schulkonto sehen die Datei zusammen mit deinem Vornamen. Teile keine Dateien mit persönlichen Daten anderer Personen.</p></div>
      <label class="check"><input type="checkbox" id="lib-rights" name="rights"> Ich darf diese Datei hier teilen: Ich habe sie selbst erstellt, oder die Lizenz bzw. die Rechteinhaber erlauben die Weitergabe an andere KV-Lernende (z. B. Unterlagen aus myKV im Rahmen der Lizenz).</label>
      <div id="lib-error"></div>
      <div class="row end"><button class="btn btn-primary" id="lib-send">Hochladen</button></div>
    </form></section>`;
  const form = box.querySelector('#lib-form');
  const fillFolders = () => {
    const y = form.querySelector('#lib-year').value;
    const sel = form.folder;
    const keep = sel.value || folder;
    // Hauptordner; HKB mit Lernfeldern als Gruppe (HKB übergreifend + einzelne Lernfelder)
    sel.innerHTML = foldersOf(y).map((f) => {
      const subs = subfoldersOf(f.id);
      if (!subs.length) return `<option value="${f.id}">${esc(f.short)} – ${esc(f.long)}</option>`;
      return `<optgroup label="${esc(f.short)} – ${esc(f.long)}"><option value="${f.id}">${esc(f.short)} übergreifend</option>${subs.map((s2) => `<option value="${s2.id}">${esc(f.short)} · ${esc(s2.short)}${s2.modules ? ` (${esc(s2.modules.slice(0, 2).join(', '))}${s2.modules.length > 2 ? ' …' : ''})` : ''}</option>`).join('')}</optgroup>`;
    }).join('');
    const same = `${y}/${keep.split('/')[1]}`;
    if (allFolders(y).some((f) => f.id === same)) sel.value = same;
  };
  if (!fixed) { fillFolders(); form.querySelector('#lib-year').addEventListener('change', fillFolders); }
  // Titel aus dem Dateinamen vorschlagen, solange er nicht von Hand geändert wurde
  let autoTitle = '';
  form.title.addEventListener('input', () => { autoTitle = null; });
  form.file.addEventListener('change', () => {
    const f = form.file.files[0];
    form.querySelector('#lib-fname').textContent = f ? `${f.name} (${fmtSize(f.size)})` : 'Keine Datei ausgewählt';
    if (f && (autoTitle !== null || !form.title.value.trim())) { autoTitle = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 140); form.title.value = autoTitle; }
  });
  setLeaveGuard(() => Boolean(form.file.files.length || form.description.value.trim()));
  const showError = (msg) => { form.querySelector('#lib-error').innerHTML = msg ? `<div class="notice notice-bad"><p>${esc(msg)}</p></div>` : ''; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const send = form.querySelector('#lib-send');
    if (send.disabled) return;
    showError('');
    let file = form.file.files[0];
    const title = form.title.value.trim();
    if (!file) return showError('Bitte wähle eine Datei aus.');
    const type = TYPES[extOf(file.name)];
    if (!type) return showError('Dieses Format ist nicht erlaubt. Erlaubt sind PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), Text (.txt) sowie PNG- und JPG-Bilder.');
    if (file.size > MAX_BYTES) return showError(`Die Datei ist ${fmtSize(file.size)} gross. Erlaubt sind höchstens 20 MB.`);
    if (!file.size) return showError('Die Datei ist leer.');
    if (!title) return showError('Bitte gib einen Titel ein.');
    if (!form.rights.checked) return showError('Bitte bestätige, dass du diese Datei teilen darfst.');
    if (file.type !== type[0]) file = new File([file], file.name, { type: type[0] });
    send.disabled = true; send.textContent = 'Wird hochgeladen …';
    try {
      const item = await uploadLibraryItem({ folder: form.folder.value, title, description: form.description.value.trim(), file });
      cache.items.unshift(item);
      setLeaveGuard(null);
      toast(`«${item.title}» ist jetzt in der Ablage.`);
      if (item.folder === folder) onDone(); else location.hash = `#/ablage/${item.folder}`;
    } catch (err) {
      send.disabled = false; send.textContent = 'Hochladen';
      showError(err.message);
    }
  });
}

function rulesHtml() {
  return `<details class="card ablage-rules"><summary><strong>Regeln der Ablage</strong></summary>
    <ul>
      <li>Zugang haben nur Konten mit bestätigter Schul-E-Mail-Adresse, also KV-Lernende.</li>
      <li>Teile eigene Zusammenfassungen und Notizen sowie Unterlagen (z. B. aus myKV), soweit die Lizenz oder die Rechteinhaber die Weitergabe an andere Lernende erlauben.</li>
      <li>Keine persönlichen Daten anderer Personen, keine Prüfungen, die noch geschrieben werden.</li>
      <li>Problematische Einträge kannst du melden. Nach zwei Meldungen wird ein Eintrag ausgeblendet und geprüft.</li>
    </ul></details>`;
}
