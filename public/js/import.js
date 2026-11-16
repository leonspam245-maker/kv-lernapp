// Import von PDF-Handouts, myKV-Unterlagen, Quizlet-Karten und OneNote-Seiten.
import { store, commit, byId, topicsOf } from './store.js';
import { esc, uid, plural, todayISO } from './util.js';
import { toast, renderMarkdown } from './ui.js';
import { newCard } from './srs.js';
import { createSubject, createTopic, setLeaveGuard } from './app.js';
import { docxToMarkdown } from './docx.js';

const DRAFT_KEY = 'kvlern-import-entwurf';
const TABS = [['pdf', 'PDF-Handout'], ['mykv', 'myKV'], ['quizlet', 'Quizlet'], ['onenote', 'OneNote']];
const MIN_TEXT = 25; // weniger Zeichen = vermutlich gescannte Seite

let st = null; // Formularzustand (wird als Entwurf gesichert)
const pdfBuffers = new Map(); // Dateiinhalte für Texterkennung (nur im Speicher)

function freshState() {
  return {
    tab: 'pdf', subjectId: '', topicId: '',
    pdf: { files: [] },
    mykv: { mode: 'text', kind: 'lernziele', title: '', text: '', link: '', files: [] },
    quizlet: { title: '', raw: '', sep: 'auto', customSep: '', cardSep: 'newline', rows: null },
    onenote: { mode: 'paste', title: '', md: '', files: [] },
  };
}
function loadDraft() {
  try { const raw = localStorage.getItem(DRAFT_KEY); if (raw) return { ...freshState(), ...JSON.parse(raw) }; } catch { /* kein Entwurf */ }
  return freshState();
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(st)); } catch { /* Speicher voll – Entwurf bleibt nur im geöffneten Fenster */ }
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* egal */ } }
const hasInput = () => st && (st.pdf.files.length || st.mykv.text.trim() || st.mykv.files.length || st.quizlet.raw.trim() || st.onenote.md.trim() || st.onenote.files.length);

export function importView(el, _id, query) {
  if (!st) st = loadDraft();
  if (query.fach && byId('subjects', query.fach)) { st.subjectId = query.fach; if (!query.thema) st.topicId = ''; }
  if (query.thema && byId('topics', query.thema)) st.topicId = query.thema;
  if (query.art && TABS.some(([k]) => k === query.art)) st.tab = query.art;
  setLeaveGuard(() => Boolean(hasInput()));
  render(el);
}

function render(el) {
  const restored = hasInput() ? '<div class="notice notice-info small">Deine bisherigen Eingaben sind erhalten. <button class="btn-link" id="discard">Entwurf verwerfen</button></div>' : '';
  el.innerHTML = `
    <div class="page-head"><div><h1>Material importieren</h1><p>Wähle die Herkunft, das Fach und das Thema. Vor dem Speichern prüfst und korrigierst du den erkannten Inhalt.</p></div></div>
    ${restored}
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${st.tab === k}">${l}</button>`).join('')}</div>
    <section class="card" id="target">${targetHtml()}</section>
    <section id="panel"></section>`;
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; saveDraft(); render(el); }));
  el.querySelector('#discard')?.addEventListener('click', () => { st = freshState(); pdfBuffers.clear(); clearDraft(); render(el); toast('Entwurf verworfen.', 'info'); });
  bindTarget(el);
  const panel = el.querySelector('#panel');
  ({ pdf: pdfPanel, mykv: mykvPanel, quizlet: quizletPanel, onenote: onenotePanel })[st.tab](panel, el);
}

// ---------- Fach / Thema ----------
function targetHtml() {
  const subjects = store.db.subjects.slice().sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
  const topics = st.subjectId ? topicsOf(st.subjectId) : [];
  return `<div class="grid grid-2">
    <div class="field"><label for="imp-subject">Fach</label>
      <select id="imp-subject"><option value="">Fach wählen …</option>${subjects.map((s) => `<option value="${s.id}" ${s.id === st.subjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="__new">+ Neues Fach …</option></select>
      <div class="inline-new" id="new-subject" hidden><input type="text" placeholder="Name des Fachs" aria-label="Name des neuen Fachs"><button class="btn" type="button">Anlegen</button></div></div>
    <div class="field"><label for="imp-topic">Thema</label>
      <select id="imp-topic" ${st.subjectId ? '' : 'disabled'}><option value="">${st.subjectId ? 'Thema wählen …' : 'Zuerst Fach wählen'}</option>${topics.map((t) => `<option value="${t.id}" ${t.id === st.topicId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}${st.subjectId ? '<option value="__new">+ Neues Thema …</option>' : ''}</select>
      <div class="inline-new" id="new-topic" hidden><input type="text" placeholder="Name des Themas" aria-label="Name des neuen Themas"><button class="btn" type="button">Anlegen</button></div></div>
  </div>`;
}
function bindTarget(root) {
  const box = root.querySelector('#target');
  const rerenderTarget = () => { box.innerHTML = targetHtml(); bindTarget(root); };
  const sSel = box.querySelector('#imp-subject'); const tSel = box.querySelector('#imp-topic');
  sSel.addEventListener('change', () => {
    if (sSel.value === '__new') { box.querySelector('#new-subject').hidden = false; box.querySelector('#new-subject input').focus(); return; }
    st.subjectId = sSel.value; st.topicId = ''; saveDraft(); rerenderTarget();
  });
  tSel.addEventListener('change', () => {
    if (tSel.value === '__new') { box.querySelector('#new-topic').hidden = false; box.querySelector('#new-topic input').focus(); return; }
    st.topicId = tSel.value; saveDraft();
  });
  const add = async (which) => {
    const wrap = box.querySelector(which === 'subject' ? '#new-subject' : '#new-topic');
    try {
      if (which === 'subject') { const s = await createSubject(wrap.querySelector('input').value); st.subjectId = s.id; st.topicId = ''; toast(`Fach «${s.name}» angelegt.`); }
      else { const t = await createTopic(st.subjectId, wrap.querySelector('input').value); st.topicId = t.id; toast(`Thema «${t.name}» angelegt.`); }
      saveDraft(); rerenderTarget();
    } catch (e) { toast(e.message, 'error'); }
  };
  box.querySelector('#new-subject button').addEventListener('click', () => add('subject'));
  box.querySelector('#new-topic button').addEventListener('click', () => add('topic'));
  box.querySelectorAll('.inline-new input').forEach((inp) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.nextElementSibling.click(); } }));
}
function requireTarget() {
  if (!st.subjectId || !byId('subjects', st.subjectId)) throw new Error('Bitte zuerst ein Fach wählen oder anlegen.');
  if (!st.topicId || !byId('topics', st.topicId)) throw new Error('Bitte ein Thema wählen oder anlegen.');
}

// ---------- PDF-Auslesen ----------
let pdfjsPromise = null;
async function pdfjs() {
  pdfjsPromise ||= import('/vendor/pdfjs/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'; return m; });
  return pdfjsPromise;
}

/** Text einer PDF seitenweise auslesen, Zeilenumbrüche anhand der Position rekonstruieren. */
export async function readPdf(buffer) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: buffer.slice(0) }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    let text = ''; let lastY = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2 && !text.endsWith('\n')) text += '\n';
      text += it.str;
      if (it.hasEOL) text += '\n';
      lastY = y;
    }
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const empty = text.replace(/\s/g, '').length < MIN_TEXT;
    pages.push({ n, text, empty, include: true, ocr: false, manual: false });
  }
  return pages;
}

async function addPdfFiles(fileList, target) {
  const results = [];
  for (const file of fileList) {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { toast(`«${file.name}» ist keine PDF-Datei und wurde übersprungen.`, 'error'); continue; }
    const key = uid('pdf');
    try {
      const buf = await file.arrayBuffer();
      const pages = await readPdf(buf);
      pdfBuffers.set(key, buf);
      const entry = { key, name: file.name, title: file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim(), pages };
      target.push(entry);
      results.push(entry);
    } catch (e) {
      const reason = /password/i.test(e?.name + e?.message) ? 'Die Datei ist passwortgeschützt.' : 'Die Datei ist beschädigt oder keine gültige PDF.';
      toast(`«${file.name}» konnte nicht gelesen werden. ${reason}`, 'error');
    }
  }
  saveDraft();
  const scans = results.reduce((s, f) => s + f.pages.filter((p) => p.empty).length, 0);
  if (results.length) toast(`${plural(results.length, 'PDF', 'PDFs')} gelesen${scans ? ` – ${plural(scans, 'Seite', 'Seiten')} ohne auslesbaren Text` : ''}. Bitte Inhalt prüfen.`, scans ? 'info' : 'success');
}

let ocrWorker = null;
async function ocrPage(fileEntry, page, onProgress) {
  const buf = pdfBuffers.get(fileEntry.key);
  if (!buf) throw new Error('Die PDF-Datei ist nach dem Neuladen nicht mehr im Speicher. Bitte die Datei erneut auswählen, um die Texterkennung zu starten.');
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: buf.slice(0) }).promise;
  const p = await doc.getPage(page.n);
  const viewport = p.getViewport({ scale: 2.5 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  if (!ocrWorker) {
    onProgress?.('Texterkennung wird geladen …');
    const mod = await import('/vendor/tesseract/tesseract.esm.min.js');
    const T = mod.default || mod;
    ocrWorker = await T.createWorker('deu', 1, {
      workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/tesseract-core', langPath: '/vendor/tessdata', gzip: true,
    });
  }
  onProgress?.('Text wird erkannt …');
  const { data } = await ocrWorker.recognize(canvas);
  return data.text.replace(/\n{3,}/g, '\n\n').trim();
}

function pdfReviewHtml(files, label = 'PDF') {
  if (!files.length) return '';
  const ocr = store.server.ocrAvailable;
  return files.map((f, fi) => {
    const scans = f.pages.filter((p) => p.empty && !p.text.trim()).length;
    return `<div class="card" data-file="${fi}">
      <div class="row between"><h3 style="margin:0">${esc(f.name)}</h3><button class="btn btn-small btn-danger" data-remove-file="${fi}">Entfernen</button></div>
      <div class="field" style="margin-top:12px"><label for="ft-${fi}">Titel der Unterlage</label><input type="text" id="ft-${fi}" data-file-title="${fi}" value="${esc(f.title)}"></div>
      ${f.isText ? '<p class="meta">Text aus der Datei – bitte prüfen und bei Bedarf korrigieren.</p>' : `<p class="meta">${plural(f.pages.length, 'Seite', 'Seiten')} · ${plural(f.pages.filter((p) => !p.empty).length, 'mit Text', 'mit Text')}${scans ? ` · <strong>${plural(scans, 'Seite', 'Seiten')} ohne Text</strong>` : ''}</p>`}
      ${f.pages.map((p, pi) => `<div class="page-review ${p.empty && !p.text.trim() ? 'scan' : ''}">
        <div class="row between"><strong>${f.isText ? 'Inhalt' : `Seite ${p.n}`}</strong>
          <label class="check" style="padding:0"><input type="checkbox" data-include="${fi}:${pi}" ${p.include ? 'checked' : ''}> übernehmen</label></div>
        ${p.empty && !p.text.trim() ? `<div class="notice notice-warn"><h4>Kein Text auslesbar – vermutlich eine gescannte Seite.</h4>
          ${ocr ? `<p>Du kannst die Texterkennung (OCR) starten. Sie läuft lokal auf deinem Gerät, es wird nichts übertragen. Prüfe das Ergebnis danach genau.</p>
            <button class="btn btn-small btn-primary" data-ocr="${fi}:${pi}">Texterkennung starten</button> <span class="small muted" data-ocr-status="${fi}:${pi}"></span>` : ''}
          <p style="margin-top:8px"><strong>Text manuell ergänzen:</strong></p>
          <ol><li>Öffne die PDF und markiere den Text der Seite (falls möglich) oder tippe die wichtigsten Punkte ab.</li>
          <li>Füge ihn unten ins Feld ein. Schreibe Begriffe als «Begriff: Erklärung», damit Karteikarten und Quiz entstehen.</li>
          <li>Ohne Text: Haken bei «übernehmen» entfernen, dann wird die Seite übersprungen.</li></ol></div>` : ''}
        ${p.ocr ? '<p class="small"><span class="badge badge-accent">per Texterkennung</span> Bitte auf Erkennungsfehler prüfen.</p>' : ''}
        <textarea data-page-text="${fi}:${pi}" aria-label="Text von Seite ${p.n}" placeholder="Text dieser Seite …" ${p.include ? '' : 'disabled'}>${esc(p.text)}</textarea>
      </div>`).join('')}
    </div>`;
  }).join('') + `<p class="small muted">Jede ${label}-Datei wird als eigene Unterlage gespeichert; Seitenzahlen bleiben für Verweise erhalten.</p>`;
}

function bindPdfReview(root, files, rerenderPanel) {
  root.querySelectorAll('[data-remove-file]').forEach((b) => b.addEventListener('click', () => { const [f] = files.splice(Number(b.dataset.removeFile), 1); pdfBuffers.delete(f.key); saveDraft(); rerenderPanel(); }));
  root.querySelectorAll('[data-file-title]').forEach((inp) => inp.addEventListener('input', () => { files[inp.dataset.fileTitle].title = inp.value; saveDraft(); }));
  root.querySelectorAll('[data-include]').forEach((cb) => cb.addEventListener('change', () => {
    const [fi, pi] = cb.dataset.include.split(':').map(Number);
    files[fi].pages[pi].include = cb.checked; saveDraft();
    root.querySelector(`[data-page-text="${fi}:${pi}"]`).disabled = !cb.checked;
  }));
  root.querySelectorAll('[data-page-text]').forEach((ta) => ta.addEventListener('input', () => {
    const [fi, pi] = ta.dataset.pageText.split(':').map(Number);
    const p = files[fi].pages[pi]; p.text = ta.value; p.manual = !p.ocr; saveDraft();
  }));
  root.querySelectorAll('[data-ocr]').forEach((b) => b.addEventListener('click', async () => {
    const [fi, pi] = b.dataset.ocr.split(':').map(Number);
    const status = root.querySelector(`[data-ocr-status="${fi}:${pi}"]`);
    b.disabled = true;
    try {
      const text = await ocrPage(files[fi], files[fi].pages[pi], (m) => { status.textContent = m; });
      const p = files[fi].pages[pi];
      if (!text.trim()) { status.textContent = 'Es wurde kein Text erkannt. Bitte manuell ergänzen.'; b.disabled = false; return; }
      p.text = text; p.ocr = true; p.manual = false; saveDraft();
      toast(`Seite ${p.n}: Text erkannt. Bitte prüfen und korrigieren.`);
      rerenderPanel();
    } catch (e) {
      status.textContent = '';
      b.disabled = false;
      toast(`Texterkennung fehlgeschlagen: ${e.message}`, 'error');
    }
  }));
}

function pdfSourcesFromFiles(files, origin, extra = {}) {
  const now = new Date().toISOString();
  return files.map((f) => {
    const title = f.title.trim();
    if (!title) throw new Error(`Bitte einen Titel für «${f.name}» eingeben.`);
    return { id: uid('s'), subjectId: st.subjectId, topicId: st.topicId, title, origin, fileName: f.name, createdAt: now, pages: f.pages.map(({ n, text, include, ocr, manual }) => ({ n, text: include ? text : '', include, ocr, manual })), ...extra };
  });
}

/** Word-Dateien einlesen; Ergebnis als bearbeitbarer Text (eine «Seite») */
async function addDocxFiles(files, target) {
  for (const f of files) {
    try {
      const text = await docxToMarkdown(await f.arrayBuffer());
      if (!text) throw new Error('Die Datei enthält keinen Text.');
      target.push({ key: uid('docx'), name: f.name, title: f.name.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ').trim(), pages: [{ n: 1, text, empty: false, include: true, ocr: false, manual: false }], isText: true });
      toast(`«${f.name}» eingelesen. Überschriften, Listen und Tabellen bitte prüfen.`);
    } catch (e) { toast(`«${f.name}» konnte nicht gelesen werden: ${e.message}`, 'error'); }
  }
}
/** Quellen aus PDF- und Textdateien: Textdateien ohne Seitenangabe speichern */
const textAwareSources = (files, origin, extra) => pdfSourcesFromFiles(files, origin, extra).map((s, i) => (files[i].isText ? { ...s, pages: undefined, content: s.pages[0].text } : s));

function dropzone(id, accept, text) {
  return `<div class="dropzone" id="${id}"><p><strong>${text}</strong></p><p class="small muted">Datei hierher ziehen oder auswählen</p>
    <label class="btn btn-primary" style="display:inline-flex">Dateien auswählen<input type="file" accept="${accept}" multiple hidden></label></div>`;
}
function bindDropzone(root, id, onFiles) {
  const dz = root.querySelector('#' + id);
  if (!dz) return;
  const input = dz.querySelector('input[type=file]');
  input.addEventListener('change', () => { onFiles([...input.files]); input.value = ''; });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); onFiles([...e.dataTransfer.files]); });
}

async function saveSources(sources, cards = []) {
  requireTarget();
  if (!sources.length) throw new Error('Es gibt noch nichts zu speichern.');
  await commit((db) => { db.sources.push(...sources); db.cards.push(...cards); });
  clearDraft();
  setLeaveGuard(null);
}

function afterSave(sources, extraMsg = '') {
  const tab = st.tab;
  st = freshState(); st.tab = tab;
  pdfBuffers.clear();
  toast(`${plural(sources.length, 'Unterlage', 'Unterlagen')} gespeichert.${extraMsg}`);
  location.hash = sources.length === 1 ? `#/quelle/${sources[0].id}` : `#/thema/${sources[0].topicId}`;
}

// ---------- Tab: PDF ----------
function pdfPanel(panel, root) {
  const rerenderPanel = () => pdfPanel(panel, root);
  panel.innerHTML = `
    <section class="card">${dropzone('dz-pdf', '.pdf,application/pdf', 'PDF-Handouts hochladen (mehrere möglich)')}
      <p class="small muted" style="margin-top:10px">Der Text wird seitenweise auf deinem Gerät ausgelesen. Gescannte Seiten ohne Textebene werden erkannt.</p></section>
    <div id="review">${pdfReviewHtml(st.pdf.files)}</div>
    ${st.pdf.files.length ? '<div class="row end"><button class="btn btn-primary" id="save">Unterlagen speichern</button></div>' : ''}`;
  bindDropzone(panel, 'dz-pdf', async (files) => { await addPdfFiles(files, st.pdf.files); rerenderPanel(); });
  bindPdfReview(panel, st.pdf.files, rerenderPanel);
  panel.querySelector('#save')?.addEventListener('click', async () => {
    try {
      requireTarget();
      const sources = pdfSourcesFromFiles(st.pdf.files, 'pdf');
      const missing = sources.reduce((s, src) => s + src.pages.filter((p) => p.include && !p.text.trim()).length, 0);
      await saveSources(sources);
      afterSave(sources, missing ? ` Hinweis: ${plural(missing, 'Seite ist', 'Seiten sind')} ohne Text gespeichert und kann später ergänzt werden.` : '');
    } catch (e) { toast(`Import nicht gespeichert: ${e.message} Deine Eingaben bleiben erhalten.`, 'error'); }
  });
}

// ---------- Tab: myKV ----------
const MYKV_KINDS = [['lernziele', 'Lernziele'], ['aufgaben', 'Aufgaben'], ['notizen', 'Notizen'], ['unterlage', 'Unterlage']];
function mykvPanel(panel, root) {
  const m = st.mykv;
  const rerenderPanel = () => mykvPanel(panel, root);
  panel.innerHTML = `
    <div class="notice notice-info"><h4>So übernimmst du Inhalte aus myKV</h4>
      <p>myKV braucht eine Anmeldung. Die Lernapp verbindet sich nicht mit myKV und speichert keine Zugangsdaten. Lade Unterlagen in myKV herunter und importiere die Datei, oder kopiere Lernziele, Aufgaben und Notizen und füge sie hier ein. Den myKV-Link kannst du als Quellenverweis speichern. Unterstützt werden PDF, Word (.docx) und Textdateien.</p></div>
    <section class="card">
      <div class="tabs" role="tablist" style="margin-bottom:14px">
        ${[['text', 'Text einfügen'], ['file', 'Datei importieren'], ['link', 'Nur Link speichern']].map(([k, l]) => `<button role="tab" data-mode="${k}" aria-selected="${m.mode === k}">${l}</button>`).join('')}
      </div>
      <div class="grid grid-2">
        <div class="field"><label for="mk-kind">Art</label><select id="mk-kind">${MYKV_KINDS.map(([k, l]) => `<option value="${k}" ${m.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${m.mode !== 'file' ? `<div class="field"><label for="mk-title">Titel</label><input type="text" id="mk-title" value="${esc(m.title)}" placeholder="z. B. Lernziele Vertragsentstehung"></div>` : '<div></div>'}
      </div>
      <div class="field"><label for="mk-link">myKV-Link ${m.mode === 'link' ? '' : '(optional)'}</label><input type="url" id="mk-link" value="${esc(m.link)}" placeholder="https://…" inputmode="url">
        <p class="hint">Wird als Quellenverweis gespeichert. Der Inhalt hinter der Anmeldung wird nicht abgerufen.</p></div>
      ${m.mode === 'text' ? `<div class="field"><label for="mk-text">Kopierter Text</label><textarea id="mk-text" style="min-height:220px" placeholder="Lernziele, Aufgaben oder Notizen hier einfügen …">${esc(m.text)}</textarea>
        <p class="hint">Tipp: Eine Zeile pro Lernziel. Begriffe als «Begriff: Erklärung» schreiben, dann entstehen daraus Karteikarten und Quizfragen.</p></div>` : ''}
      ${m.mode === 'file' ? `${dropzone('dz-mykv', '.pdf,.docx,.txt,.md,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Heruntergeladene myKV-Unterlagen (PDF, Word oder Text)')}` : ''}
    </section>
    ${m.mode === 'file' ? `<div id="review">${pdfReviewHtml(m.files)}</div>` : ''}
    <div class="row end"><button class="btn btn-primary" id="save">${m.mode === 'link' ? 'Link speichern' : 'Unterlage speichern'}</button></div>`;
  panel.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { m.mode = b.dataset.mode; saveDraft(); rerenderPanel(); }));
  panel.querySelector('#mk-kind').addEventListener('change', (e) => { m.kind = e.target.value; saveDraft(); });
  panel.querySelector('#mk-title')?.addEventListener('input', (e) => { m.title = e.target.value; saveDraft(); });
  panel.querySelector('#mk-link').addEventListener('input', (e) => { m.link = e.target.value; saveDraft(); });
  panel.querySelector('#mk-text')?.addEventListener('input', (e) => { m.text = e.target.value; saveDraft(); });
  if (m.mode === 'file') {
    bindDropzone(panel, 'dz-mykv', async (files) => {
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
      for (const f of files.filter((x) => /\.(txt|md)$/i.test(x.name))) {
        try {
          const text = await f.text();
          m.files.push({ key: uid('txt'), name: f.name, title: f.name.replace(/\.(txt|md)$/i, ''), pages: [{ n: 1, text, empty: !text.trim(), include: true, ocr: false, manual: false }], isText: true });
          toast(`«${f.name}» eingelesen. Bitte Inhalt prüfen.`);
        } catch { toast(`«${f.name}» konnte nicht gelesen werden.`, 'error'); }
      }
      await addDocxFiles(files.filter((x) => /\.docx$/i.test(x.name)), m.files);
      const other = files.filter((f) => !/\.(pdf|txt|md|docx)$/i.test(f.name));
      for (const f of other) toast(`«${f.name}»: Dieses Format wird nicht unterstützt. Ältere Word-Dateien (.doc) bitte als .docx oder PDF speichern.`, 'error');
      if (pdfs.length) await addPdfFiles(pdfs, m.files);
      saveDraft(); rerenderPanel();
    });
    bindPdfReview(panel, m.files, rerenderPanel);
  }
  panel.querySelector('#save').addEventListener('click', async () => {
    try {
      requireTarget();
      const link = m.link.trim();
      if (link && !/^https?:\/\/\S+$/i.test(link)) throw new Error('Der Link muss mit https:// beginnen.');
      let sources;
      const now = new Date().toISOString();
      if (m.mode === 'file') {
        if (!m.files.length) throw new Error('Bitte zuerst eine Datei auswählen.');
        sources = textAwareSources(m.files, 'mykv', { kind: m.kind, link: link || null });
      } else {
        const title = m.title.trim() || (m.mode === 'link' ? 'myKV-Link' : '');
        if (!title) throw new Error('Bitte einen Titel eingeben.');
        if (m.mode === 'text' && !m.text.trim()) throw new Error('Bitte Text einfügen.');
        if (m.mode === 'link' && !link) throw new Error('Bitte den myKV-Link eingeben.');
        sources = [{ id: uid('s'), subjectId: st.subjectId, topicId: st.topicId, title, origin: 'mykv', kind: m.mode === 'link' ? 'link' : m.kind, link: link || null, content: m.mode === 'text' ? m.text.trim() : '', createdAt: now }];
      }
      await saveSources(sources);
      afterSave(sources);
    } catch (e) { toast(`Import nicht gespeichert: ${e.message} Deine Eingaben bleiben erhalten.`, 'error'); }
  });
}

// ---------- Tab: Quizlet ----------
const SEPS = { tab: '\t', comma: ',', semicolon: ';', dash: ' - ', colon: ':' };
/** Begriff-Definition-Paare zerlegen. Markiert Zeilen, deren Trennung unsicher ist. */
export function parseQuizlet(raw, sep = 'auto', customSep = '', cardSep = 'newline') {
  let lines;
  if (cardSep === 'semicolon') lines = raw.split(';');
  else if (cardSep.startsWith('custom:')) lines = raw.split(cardSep.slice(7) || '\n');
  else lines = raw.split(/\r?\n/);
  lines = lines.map((l) => l.trim()).filter(Boolean);
  const order = sep === 'auto' ? ['\t', ' - ', ' – ', ';', ':', ','] : [sep === 'custom' ? customSep : SEPS[sep]];
  const counts = new Map();
  if (sep === 'auto') for (const l of lines) for (const s of order) if (l.includes(s)) { counts.set(s, (counts.get(s) || 0) + 1); break; }
  const main = sep === 'auto' ? [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] : order[0];
  return lines.map((line) => {
    let used = main && line.includes(main) ? main : (sep === 'auto' ? order.find((s) => line.includes(s)) : null);
    if (!used) return { term: line, def: '', flag: 'Kein Trennzeichen gefunden – Definition ergänzen oder Zeile entfernen' };
    const i = line.indexOf(used);
    const term = line.slice(0, i).trim(); const def = line.slice(i + used.length).trim();
    let flag = null;
    if (used !== main) flag = 'Anderes Trennzeichen als in den übrigen Zeilen – bitte prüfen';
    else if (!term || !def) flag = 'Begriff oder Definition fehlt';
    else if (term.length > 80 && def.length < 30) flag = 'Begriff sehr lang – evtl. falsch getrennt oder vertauscht';
    return { term, def, flag };
  });
}

function quizletPanel(panel, root) {
  const q = st.quizlet;
  const rerenderPanel = () => quizletPanel(panel, root);
  const rows = q.rows;
  const flagged = rows ? rows.filter((r) => r.flag).length : 0;
  panel.innerHTML = `
    <div class="notice notice-info"><h4>Karten aus Quizlet übernehmen</h4>
      <p>Exportiere dein Quizlet-Set über die Export-Funktion des Sets oder markiere die Karten und kopiere sie. Füge den Text hier ein: eine Karte pro Zeile, zwischen Begriff und Definition ein Tabulator (Standard beim Quizlet-Export). Andere Trennzeichen kannst du unten wählen. Eine Quizlet-Anmeldung ist nicht nötig.</p></div>
    <section class="card">
      <div class="field"><label for="ql-title">Titel</label><input type="text" id="ql-title" value="${esc(q.title)}" placeholder="z. B. Quizlet: Vertragsarten"></div>
      <div class="field"><label for="ql-raw">Begriff-Definition-Paare</label><textarea id="ql-raw" style="min-height:200px" placeholder="Kaufvertrag&#9;Übergabe einer Sache gegen Kaufpreis …">${esc(q.raw)}</textarea></div>
      <div class="grid grid-2">
        <div class="field"><label for="ql-sep">Trennzeichen zwischen Begriff und Definition</label><select id="ql-sep">
          ${[['auto', 'Automatisch erkennen'], ['tab', 'Tabulator'], ['comma', 'Komma'], ['semicolon', 'Semikolon'], ['dash', 'Bindestrich ( - )'], ['colon', 'Doppelpunkt'], ['custom', 'Eigenes …']].map(([k, l]) => `<option value="${k}" ${q.sep === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          ${q.sep === 'custom' ? `<input type="text" id="ql-custom" value="${esc(q.customSep)}" placeholder="Zeichen" style="margin-top:6px">` : ''}</div>
        <div class="field"><label for="ql-cardsep">Trennung zwischen Karten</label><select id="ql-cardsep">
          <option value="newline" ${q.cardSep === 'newline' ? 'selected' : ''}>Neue Zeile</option><option value="semicolon" ${q.cardSep === 'semicolon' ? 'selected' : ''}>Semikolon</option></select></div>
      </div>
      <button class="btn btn-primary" id="preview">Vorschau anzeigen</button>
    </section>
    ${rows ? `<section class="card" id="ql-preview"><h2 style="margin-top:0">Vorschau: ${plural(rows.length, 'Karte', 'Karten')}</h2>
      ${flagged ? `<div class="notice notice-warn">${plural(flagged, 'Zeile ist', 'Zeilen sind')} markiert. Korrigiere Begriff und Definition direkt in der Tabelle, tausche sie oder entferne die Zeile.</div>` : '<div class="notice notice-ok">Alle Zeilen wurden eindeutig getrennt.</div>'}
      <div class="table-wrap"><table class="preview-table"><thead><tr><th>#</th><th>Begriff</th><th>Definition</th><th><span class="sr">Aktionen</span></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.flag ? 'flag' : ''}" data-row="${i}"><td>${i + 1}</td>
        <td><input type="text" data-term="${i}" value="${esc(r.term)}" aria-label="Begriff ${i + 1}">${r.flag ? `<div class="small" style="color:var(--warn)">${esc(r.flag)}</div>` : ''}</td>
        <td><input type="text" data-def="${i}" value="${esc(r.def)}" aria-label="Definition ${i + 1}"></td>
        <td style="white-space:nowrap"><button class="btn btn-small" data-swap="${i}" title="Begriff und Definition tauschen" aria-label="Zeile ${i + 1} tauschen">⇄</button> <button class="btn btn-small btn-danger" data-del="${i}" aria-label="Zeile ${i + 1} entfernen">✕</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row end"><button class="btn btn-primary" id="save">${plural(rows.length, 'Karte', 'Karten')} speichern</button></div></section>` : ''}`;
  panel.querySelector('#ql-title').addEventListener('input', (e) => { q.title = e.target.value; saveDraft(); });
  panel.querySelector('#ql-raw').addEventListener('input', (e) => { q.raw = e.target.value; saveDraft(); });
  panel.querySelector('#ql-sep').addEventListener('change', (e) => { q.sep = e.target.value; saveDraft(); rerenderPanel(); });
  panel.querySelector('#ql-custom')?.addEventListener('input', (e) => { q.customSep = e.target.value; saveDraft(); });
  panel.querySelector('#ql-cardsep').addEventListener('change', (e) => { q.cardSep = e.target.value; saveDraft(); });
  panel.querySelector('#preview').addEventListener('click', () => {
    if (!q.raw.trim()) return toast('Bitte zuerst Karten einfügen.', 'error');
    if (q.sep === 'custom' && !q.customSep) return toast('Bitte das eigene Trennzeichen eingeben.', 'error');
    q.rows = parseQuizlet(q.raw, q.sep, q.customSep, q.cardSep); saveDraft(); rerenderPanel();
    panel.querySelector('#ql-preview')?.scrollIntoView({ behavior: 'smooth' });
  });
  if (!rows) return;
  panel.querySelectorAll('[data-term]').forEach((i) => i.addEventListener('input', () => { rows[i.dataset.term].term = i.value; saveDraft(); }));
  panel.querySelectorAll('[data-def]').forEach((i) => i.addEventListener('input', () => { rows[i.dataset.def].def = i.value; saveDraft(); }));
  panel.querySelectorAll('[data-swap]').forEach((b) => b.addEventListener('click', () => { const r = rows[b.dataset.swap]; [r.term, r.def] = [r.def, r.term]; r.flag = null; saveDraft(); rerenderPanel(); }));
  panel.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { rows.splice(Number(b.dataset.del), 1); saveDraft(); rerenderPanel(); }));
  panel.querySelector('#save').addEventListener('click', async () => {
    try {
      requireTarget();
      const title = q.title.trim() || 'Quizlet-Karten';
      const bad = rows.map((r, i) => (!r.term.trim() || !r.def.trim() ? i + 1 : null)).filter(Boolean);
      if (!rows.length) throw new Error('Keine Karten vorhanden.');
      if (bad.length) throw new Error(`Zeile ${bad.join(', ')}: Begriff oder Definition fehlt. Bitte ergänzen oder entfernen.`);
      const src = { id: uid('s'), subjectId: st.subjectId, topicId: st.topicId, title, origin: 'quizlet', createdAt: new Date().toISOString(), cards: rows.map((r) => ({ term: r.term.trim(), def: r.def.trim() })) };
      const t = todayISO();
      const cards = src.cards.map((c) => newCard({ id: uid('c'), topicId: st.topicId, sourceId: src.id, term: c.term, def: c.def, origin: 'quizlet' }, t));
      const topicId = st.topicId;
      await saveSources([src], cards);
      const tab = st.tab; st = freshState(); st.tab = tab;
      toast(`${plural(cards.length, 'Karte', 'Karten')} gespeichert und im Karteikartenmodus verfügbar.`, 'success', { action: 'Jetzt üben', onAction: () => { location.hash = `#/karten?themen=${topicId}`; } });
      location.hash = `#/quelle/${src.id}`;
    } catch (e) { toast(`Import nicht gespeichert: ${e.message} Deine Eingaben bleiben erhalten.`, 'error'); }
  });
}

// ---------- Tab: OneNote ----------
/** OneNote-/Web-HTML in einfaches Markdown umwandeln (Überschriften, Listen, Tabellen bleiben erhalten). */
export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,head,meta,title').forEach((n) => n.remove());
  const clean = (t) => t.replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
  const inline = (node) => {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out += clean(c.textContent);
      else if (c.nodeType === 1) {
        const tag = c.tagName.toLowerCase();
        if (tag === 'br') out += '\n';
        else if (['b', 'strong'].includes(tag) || /font-weight:\s*(bold|[6-9]00)/i.test(c.getAttribute('style') || '')) { const t = inline(c).trim(); out += t ? `**${t}**` : ''; }
        else if (['ul', 'ol', 'table'].includes(tag)) out += '\n' + block(c, 0).trim() + '\n';
        else out += inline(c);
      }
    }
    return out;
  };
  const block = (node, depth) => {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { const t = clean(c.textContent).trim(); if (t) out += t + '\n\n'; continue; }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName.toLowerCase();
      const m = tag.match(/^h([1-6])$/);
      if (m) { out += `${'#'.repeat(Math.min(Number(m[1]), 4))} ${inline(c).trim()}\n\n`; continue; }
      if (tag === 'ul' || tag === 'ol') {
        let i = 1;
        for (const li of c.children) {
          if (li.tagName.toLowerCase() !== 'li') { out += block(li, depth); continue; }
          const nested = [...li.children].filter((x) => ['ul', 'ol'].includes(x.tagName.toLowerCase()));
          nested.forEach((n) => n.remove());
          out += `${'  '.repeat(depth)}${tag === 'ol' ? `${i++}.` : '-'} ${inline(li).trim().replace(/\n+/g, ' ')}\n`;
          for (const n of nested) { const w = doc.createElement('div'); w.appendChild(n); out += block(w, depth + 1); }
        }
        if (depth === 0) out += '\n';
        continue;
      }
      if (tag === 'table') {
        const rows = [...c.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => inline(td).trim().replace(/\n+/g, ' ').replace(/\|/g, '/')));
        if (rows.length) {
          const width = Math.max(...rows.map((r) => r.length));
          const norm = rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
          out += `| ${norm[0].join(' | ')} |\n| ${norm[0].map(() => '---').join(' | ')} |\n${norm.slice(1).map((r) => `| ${r.join(' | ')} |`).join('\n')}\n\n`;
        }
        continue;
      }
      if (['p', 'li', 'blockquote', 'pre'].includes(tag)) { const t = inline(c).trim(); if (t) out += t + '\n\n'; continue; }
      if (['div', 'section', 'article', 'body', 'span', 'main', 'font', 'tbody', 'thead'].includes(tag)) {
        const hasBlocks = c.querySelector('p,div,h1,h2,h3,h4,h5,h6,ul,ol,table,li');
        out += hasBlocks ? block(c, depth) : (inline(c).trim() ? inline(c).trim() + '\n\n' : '');
        continue;
      }
      const t = inline(c).trim(); if (t) out += t + '\n\n';
    }
    return out;
  };
  return block(doc.body, 0).replace(/\n{3,}/g, '\n\n').trim();
}

/** Stellen markieren, die vermutlich schlecht erkannt wurden. */
export function findProblems(md) {
  const problems = [];
  const lines = md.split('\n');
  let tableCols = null;
  lines.forEach((l, i) => {
    if (/[�\u0000]|â€|Ã[¤¶¼„–œŸ]/.test(l)) problems.push({ line: i + 1, text: l, why: 'Unlesbare Zeichen (Zeichensatz-Fehler)' });
    if (/^\s*\|/.test(l)) {
      const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (tableCols !== null && cells.length !== tableCols) problems.push({ line: i + 1, text: l, why: 'Tabellenzeile mit abweichender Spaltenzahl' });
      tableCols = cells.length;
      if (cells.some((c) => c === '')) problems.push({ line: i + 1, text: l, why: 'Leere Tabellenzelle' });
    } else tableCols = null;
    if (/\[(Bild|Image|Grafik)\]|<img/i.test(l)) problems.push({ line: i + 1, text: l, why: 'Bild – Inhalt bitte als Text ergänzen' });
    if (l.length > 400 && !/[.!?]/.test(l.slice(0, 300))) problems.push({ line: i + 1, text: l.slice(0, 80) + ' …', why: 'Sehr lange Zeile ohne Satzende – evtl. fehlen Umbrüche' });
  });
  return problems;
}

function onenotePanel(panel, root) {
  const o = st.onenote;
  const rerenderPanel = () => onenotePanel(panel, root);
  const problems = o.md ? findProblems(o.md) : [];
  panel.innerHTML = `
    <div class="notice notice-info"><h4>OneNote-Seite übernehmen</h4>
      <p>Variante 1: In OneNote den Seiteninhalt markieren (Ctrl+A bzw. Cmd+A), kopieren und unten ins Einfügefeld einfügen. Überschriften, Listen und Tabellen bleiben soweit möglich erhalten. Variante 2: Die Seite in OneNote als PDF oder Word-Dokument (.docx) exportieren bzw. als PDF drucken und hochladen. Eine Microsoft-Anmeldung in der Lernapp ist nicht nötig.</p></div>
    <section class="card">
      <div class="tabs" role="tablist" style="margin-bottom:14px">${[['paste', 'Inhalt einfügen'], ['pdf', 'Als Datei hochladen']].map(([k, l]) => `<button role="tab" data-mode="${k}" aria-selected="${o.mode === k}">${l}</button>`).join('')}</div>
      ${o.mode === 'paste' ? `
        <div class="field"><label for="on-title">Titel</label><input type="text" id="on-title" value="${esc(o.title)}" placeholder="z. B. OneNote: Mängel beim Vertragsabschluss"></div>
        <div class="field"><label id="paste-label">Einfügefeld</label><div class="paste-area" id="paste" contenteditable="true" role="textbox" aria-labelledby="paste-label" aria-multiline="true" data-placeholder="Hier klicken und einfügen (Ctrl+V / Cmd+V)"></div>
          <p class="hint">Der eingefügte Inhalt erscheint unten als bearbeitbarer Text mit Vorschau.</p></div>
        ${o.md ? `<div class="split-edit">
          <div class="field"><label for="on-md">Erkannter Inhalt (bearbeitbar)</label><textarea id="on-md" style="min-height:360px;font-family:Arial, sans-serif">${esc(o.md)}</textarea>
            <p class="hint"># Überschrift · - Aufzählung · | Tabelle | · **fett**</p></div>
          <div><label>Vorschau</label><div class="md-preview md" id="on-preview">${renderMarkdown(o.md)}</div></div></div>
          <div id="problems">${problemsHtml(problems)}</div>` : ''}
      ` : dropzone('dz-on', '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'OneNote-Seite als PDF oder Word-Datei')}
    </section>
    ${o.mode === 'pdf' ? `<div id="review">${pdfReviewHtml(o.files)}</div>` : ''}
    ${(o.mode === 'paste' && o.md) || (o.mode === 'pdf' && o.files.length) ? '<div class="row end"><button class="btn btn-primary" id="save">Unterlage speichern</button></div>' : ''}`;
  panel.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { o.mode = b.dataset.mode; saveDraft(); rerenderPanel(); }));
  if (o.mode === 'paste') {
    panel.querySelector('#on-title').addEventListener('input', (e) => { o.title = e.target.value; saveDraft(); });
    const paste = panel.querySelector('#paste');
    paste.addEventListener('paste', (e) => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      const md = html ? htmlToMarkdown(html) : text.trim();
      if (!md) return toast('Die Zwischenablage enthält keinen Text.', 'error');
      o.md = o.md ? o.md + '\n\n' + md : md;
      if (!o.title) { const h = md.match(/^#+\s+(.+)$/m); if (h) o.title = h[1].trim(); }
      saveDraft();
      const n = findProblems(o.md).length;
      toast(n ? `Inhalt übernommen – ${plural(n, 'Stelle', 'Stellen')} bitte prüfen.` : 'Inhalt übernommen. Bitte prüfen.', n ? 'info' : 'success');
      rerenderPanel();
    });
    const ta = panel.querySelector('#on-md');
    ta?.addEventListener('input', () => {
      o.md = ta.value; saveDraft();
      panel.querySelector('#on-preview').innerHTML = renderMarkdown(o.md);
      panel.querySelector('#problems').innerHTML = problemsHtml(findProblems(o.md));
    });
  } else {
    bindDropzone(panel, 'dz-on', async (files) => {
      await addDocxFiles(files.filter((f) => /\.docx$/i.test(f.name)), o.files);
      for (const f of files.filter((x) => !/\.(pdf|docx)$/i.test(x.name))) toast(`«${f.name}»: Bitte als PDF oder Word-Datei (.docx) exportieren.`, 'error');
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
      if (pdfs.length) await addPdfFiles(pdfs, o.files);
      saveDraft(); rerenderPanel();
    });
    bindPdfReview(panel, o.files, rerenderPanel);
  }
  panel.querySelector('#save')?.addEventListener('click', async () => {
    try {
      requireTarget();
      let sources;
      if (o.mode === 'pdf') sources = textAwareSources(o.files, 'onenote');
      else {
        const title = o.title.trim();
        if (!title) throw new Error('Bitte einen Titel eingeben.');
        if (!o.md.trim()) throw new Error('Bitte zuerst Inhalt einfügen.');
        sources = [{ id: uid('s'), subjectId: st.subjectId, topicId: st.topicId, title, origin: 'onenote', content: o.md.trim(), createdAt: new Date().toISOString() }];
      }
      await saveSources(sources);
      afterSave(sources);
    } catch (e) { toast(`Import nicht gespeichert: ${e.message} Deine Eingaben bleiben erhalten.`, 'error'); }
  });
}

function problemsHtml(problems) {
  if (!problems.length) return '<div class="notice notice-ok small">Keine auffälligen Stellen gefunden. Prüfe den Inhalt trotzdem kurz.</div>';
  return `<div class="notice notice-warn"><h4>Bitte prüfen (${problems.length})</h4><ul>${problems.slice(0, 12).map((p) => `<li>Zeile ${p.line}: ${esc(p.why)} – <span class="problem">${esc(p.text.slice(0, 90))}</span></li>`).join('')}</ul></div>`;
}
