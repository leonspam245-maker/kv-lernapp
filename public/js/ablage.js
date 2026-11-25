// Gemeinsame Ablage: Lehrmittel, Handouts und Zusammenfassungen, die alle angemeldeten Personen teilen.
// Ordnerstruktur fest vorgegeben: Lehrjahr → Handlungskompetenzbereich (HKB) nach Bildungsplan Kauffrau/Kaufmann EFZ 2023.
import { store } from './store.js';
import { esc, fmtDate, norm, plural } from './util.js';
import { toast, confirmDialog, emptyState } from './ui.js';
import { isCloud, listLibrary, isLibraryAdmin, uploadLibraryItem, libraryFileUrl, libraryFile, reportLibraryItem, deleteLibraryItem, setLibraryHidden } from './backend.js';
import { importFromLibrary } from './import.js';
import { setLeaveGuard } from './app.js';

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

/** Ordner eines Lehrjahres: [id, Kurzname, Beschreibung] */
export const foldersOf = (year) => [...HKB, ...EXTRA, ...(year === 'lj3' ? [QV] : [])].map(([id, short, long]) => ({ id: `${year}/${id}`, short, long }));
const yearLabel = (year) => YEARS.find(([y]) => y === year)?.[1] || year;
const folderInfo = (folder) => foldersOf(folder.split('/')[0]).find((f) => f.id === folder);

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

let cache = { items: null, admin: false, at: 0 };
async function load(force = false) {
  if (!force && cache.items && Date.now() - cache.at < 30000) return cache;
  const [items, admin] = await Promise.all([listLibrary(), isLibraryAdmin()]);
  cache = { items, admin, at: Date.now() };
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
    if (!param) overview(el);
    else if (/^lj[123]$/.test(param)) yearView(el, param);
    else if (folderInfo(param)) folderView(el, param);
    else el.innerHTML = emptyState('Ordner nicht gefunden', 'Diesen Ordner gibt es in der Ablage nicht.', '<a class="btn" href="#/ablage">Zur Ablage</a>');
  }).catch((e) => {
    el.innerHTML = `<div class="page-head"><div><h1>Ablage</h1></div></div><div class="notice notice-bad"><p>${esc(e.message)}</p><button class="btn" id="retry">Erneut versuchen</button></div>`;
    el.querySelector('#retry').addEventListener('click', () => ablageView(el, param, { neu: 1 }));
  });
}

const countIn = (prefix) => cache.items.filter((i) => i.folder === prefix || i.folder.startsWith(prefix + '/')).length;
const myYear = () => { const y = Number(store.db?.settings?.profile?.apprenticeshipYear || store.user?.user_metadata?.apprenticeshipYear); return y >= 1 && y <= 3 ? `lj${y}` : ''; };

function overview(el) {
  const mine = myYear();
  el.innerHTML = `
    <div class="page-head"><div><h1>Ablage</h1><p>Gemeinsamer Ordner für Handouts, Zusammenfassungen und Vorlagen. Alles hier sehen alle angemeldeten Lernenden.</p></div></div>
    <div class="field ablage-search"><label for="lib-q">In der ganzen Ablage suchen</label><input type="search" id="lib-q" placeholder="Titel, Beschreibung oder Dateiname" autocomplete="off"></div>
    <div id="lib-results"></div>
    <div class="ablage-years" id="lib-years">${YEARS.map(([y, label]) => `
      <section class="card ablage-year${y === mine ? ' is-mine' : ''}">
        <div class="tile-head"><h2><a href="#/ablage/${y}">${label}</a></h2>${y === mine ? '<span class="badge badge-accent">Dein Lehrjahr</span>' : ''}</div>
        <p class="meta">${plural(countIn(y), 'Datei', 'Dateien')}</p>
        <ul class="list">${foldersOf(y).map((f) => folderLink(f)).join('')}</ul>
      </section>`).join('')}</div>
    ${rulesHtml()}`;
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
  return `<li><a class="list-link" href="#/ablage/${f.id}"><span><span class="title">${esc(f.short)}</span><br><span class="meta">${esc(f.long)}</span></span><span class="badge${n ? ' badge-accent' : ''}">${n}</span><span aria-hidden="true">›</span></a></li>`;
}

function yearView(el, year) {
  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow"><a href="#/ablage">Ablage</a></div><h1>${yearLabel(year)}</h1><p>${plural(countIn(year), 'Datei', 'Dateien')} in ${foldersOf(year).length} Ordnern</p></div></div>
    <section class="card"><ul class="list">${foldersOf(year).map((f) => folderLink(f)).join('')}</ul></section>`;
}

function folderView(el, folder) {
  const f = folderInfo(folder);
  const year = folder.split('/')[0];
  const items = cache.items.filter((i) => i.folder === folder);
  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow"><a href="#/ablage">Ablage</a> › <a href="#/ablage/${year}">${yearLabel(year)}</a></div><h1>${esc(f.short)}</h1><p>${esc(f.long)}</p></div>
      <button class="btn btn-primary" id="lib-add" aria-expanded="false">Datei hochladen</button></div>
    <div id="lib-upload"></div>
    <section class="card">${items.length ? itemList(items) : emptyState('Noch leer', 'In diesem Ordner liegt noch nichts. Teile eine eigene Zusammenfassung oder ein Handout, das du weitergeben darfst.')}</section>`;
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
    const f = showFolder ? folderInfo(i.folder) : null;
    return `<li data-item="${esc(i.id)}">
      <div class="ablage-item">
        <span class="ablage-type" aria-hidden="true">${esc(extOf(i.file_name).toUpperCase() || 'DATEI')}</span>
        <div class="ablage-body">
          <p class="title">${esc(i.title)} ${i.hidden ? '<span class="badge badge-warn">Ausgeblendet</span>' : ''}</p>
          ${i.description ? `<p class="ablage-desc">${esc(i.description)}</p>` : ''}
          <p class="meta">${f ? `<a href="#/ablage/${esc(i.folder)}">${yearLabel(i.folder.split('/')[0])} · ${esc(f.short)}</a> · ` : ''}${typeLabel(i)} · ${fmtSize(i.size_bytes)} · von ${esc(i.uploader_name || 'Anonym')}${own ? ' (du)' : ''} · ${fmtDate(i.created_at.slice(0, 10))}${cache.admin && i.report_count ? ` · ${plural(i.report_count, 'Meldung', 'Meldungen')}` : ''}</p>
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
  box.innerHTML = `<section class="card ablage-upload">
    <h2>Datei in die Ablage hochladen</h2>
    <form id="lib-form" autocomplete="off" novalidate>
      <div class="grid grid-2">
        <div class="field"><label for="lib-year">Lehrjahr</label><select id="lib-year">${YEARS.map(([y, l]) => `<option value="${y}" ${y === year ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="lib-folder">Ordner</label><select id="lib-folder" name="folder"></select></div>
      </div>
      <div class="field"><span class="label">Datei</span>
        <div class="ablage-file"><label class="btn" for="lib-file">Datei auswählen</label><input type="file" id="lib-file" name="file" accept="${ACCEPT}" hidden><span class="name muted" id="lib-fname">Keine Datei ausgewählt</span></div>
        <p class="hint">PDF, Word, PowerPoint, Excel, Text oder Bild (PNG, JPG), höchstens 20 MB</p></div>
      <div class="field"><label for="lib-title">Titel</label><input type="text" id="lib-title" name="title" maxlength="140" placeholder="z. B. Zusammenfassung Kaufvertrag OR"></div>
      <div class="field"><label for="lib-desc">Beschreibung (optional)</label><textarea id="lib-desc" name="description" maxlength="500" style="min-height:80px" placeholder="Worum geht es? Für welche Prüfung oder welches Thema?"></textarea></div>
      <div class="notice notice-info small"><p>Alle angemeldeten Lernenden sehen die Datei zusammen mit deinem Vornamen. Teile keine Dateien mit persönlichen Daten anderer Personen.</p></div>
      <label class="check"><input type="checkbox" id="lib-rights" name="rights"> Ich darf diese Datei teilen: Ich habe sie selbst erstellt, oder die Rechteinhaber erlauben die Weitergabe. Lehrmittel von Verlagen sowie Unterlagen aus myKV oder von Lehrpersonen lade ich nur mit deren ausdrücklicher Erlaubnis hoch.</label>
      <div id="lib-error"></div>
      <div class="row end"><button class="btn btn-primary" id="lib-send">Hochladen</button></div>
    </form></section>`;
  const form = box.querySelector('#lib-form');
  const fillFolders = () => {
    const y = form.querySelector('#lib-year').value;
    const sel = form.folder;
    const keep = sel.value || folder;
    sel.innerHTML = foldersOf(y).map((f) => `<option value="${f.id}">${esc(f.short)} – ${esc(f.long)}</option>`).join('');
    const same = `${y}/${keep.split('/')[1]}`;
    if (foldersOf(y).some((f) => f.id === same)) sel.value = same;
  };
  fillFolders();
  form.querySelector('#lib-year').addEventListener('change', fillFolders);
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
      <li>Teile nur, was du teilen darfst: eigene Zusammenfassungen, eigene Notizen oder Unterlagen, deren Weitergabe ausdrücklich erlaubt ist.</li>
      <li>Lehrmittel von Verlagen und Inhalte aus myKV sind urheberrechtlich geschützt. Deine myKV-Lizenz gilt nur für dich persönlich.</li>
      <li>Keine persönlichen Daten anderer Personen, keine Prüfungen, die noch geschrieben werden.</li>
      <li>Problematische Einträge kannst du melden. Nach zwei Meldungen wird ein Eintrag ausgeblendet und geprüft.</li>
    </ul></details>`;
}
