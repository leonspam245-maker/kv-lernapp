// Gemeinsame Oberflächen-Bausteine: Meldungen, Dialoge, Verweise, Markdown-Darstellung.
import { esc, fmtDate } from './util.js';

export const ORIGIN = {
  pdf: { label: 'PDF-Handout', short: 'PDF' },
  mykv: { label: 'myKV', short: 'myKV' },
  quizlet: { label: 'Quizlet', short: 'Quizlet' },
  onenote: { label: 'OneNote', short: 'OneNote' },
};
export const KIND_MYKV = { lernziele: 'Lernziele', aufgaben: 'Aufgaben', notizen: 'Notizen', unterlage: 'Unterlage', link: 'Link' };

export function toast(message, type = 'success', opts = {}) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span>${esc(message)}</span>${opts.action ? `<button class="btn-link">${esc(opts.action)}</button>` : ''}<button class="toast-close" aria-label="Meldung schliessen">×</button>`;
  el.querySelector('.toast-close').onclick = () => el.remove();
  if (opts.action) el.querySelector('.btn-link').onclick = () => { opts.onAction?.(); el.remove(); };
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove(); // höchstens drei Meldungen gleichzeitig
  if (!opts.sticky) setTimeout(() => el.remove(), type === 'error' ? 9000 : 4000);
}

export function showSaveState(state) {
  const el = document.getElementById('save-state');
  if (!el) return;
  const map = { saving: 'Speichert …', saved: 'Gespeichert', error: 'Nicht gespeichert', offline: 'Offline – wird nachgeholt' };
  el.textContent = map[state] || '';
  el.dataset.state = state;
}

/** Bestätigungsdialog. Liefert Promise<boolean>. */
export function confirmDialog(message, { ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = `<p>${esc(message)}</p><div class="row end"><button class="btn" value="no">Abbrechen</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="yes">${esc(ok)}</button></div>`;
    document.body.appendChild(dlg);
    dlg.querySelectorAll('button').forEach((b) => (b.onclick = () => { dlg.close(); dlg.remove(); resolve(b.value === 'yes'); }));
    dlg.addEventListener('cancel', () => { dlg.remove(); resolve(false); });
    dlg.showModal();
  });
}

/** Verweis-Chip auf Unterlage und PDF-Seite */
export function refChips(refs, db) {
  if (!refs?.length) return '<span class="ref ref-missing" title="Keine Quelle angegeben">ohne Quellenangabe</span>';
  const seen = new Set();
  return refs.filter((r) => { const k = r.sourceId + ':' + r.page; if (seen.has(k)) return false; seen.add(k); return true; }).map((r) => {
    const s = db.sources.find((x) => x.id === r.sourceId);
    if (!s) return '<span class="ref ref-missing">Unterlage gelöscht</span>';
    const page = r.page ? ` · S. ${r.page}` : '';
    return `<a class="ref" href="#/quelle/${s.id}${r.page ? `?seite=${r.page}` : ''}" title="${esc(ORIGIN[s.origin]?.label || '')}: ${esc(s.title)}">${esc(s.title)}${page}</a>`;
  }).join(' ');
}

export const originBadge = (origin) => `<span class="badge badge-${origin}">${esc(ORIGIN[origin]?.short || origin)}</span>`;
export const demoBadge = (item) => (item?.demo ? '<span class="badge badge-demo">Beispiel</span>' : '');

export function emptyState(title, text, actionHtml = '') {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p>${actionHtml}</div>`;
}

export function progressBar(value, max, label = '') {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(label)}"><span style="width:${pct}%"></span></div>`;
}

/** Schlanke Markdown-Darstellung: Überschriften, Listen, Tabellen, Fett. */
export function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  let html = ''; let list = null; let table = null; let para = [];
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>');
  const flushPara = () => { if (para.length) { html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
  const flushTable = () => {
    if (!table) return;
    const [head, ...rows] = table;
    html += `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    table = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*\|/.test(line)) {
      flushPara(); flushList();
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      (table ||= []).push(cells);
      continue;
    }
    flushTable();
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushPara(); flushList(); const lvl = Math.min(m[1].length + 1, 5); html += `<h${lvl}>${inline(m[2])}</h${lvl}>`; continue; }
    if ((m = line.match(/^\s*(?:[-•*]|(\d+)[.)])\s+(.*)$/))) {
      flushPara();
      const type = m[1] ? 'ol' : 'ul';
      if (list !== type) { flushList(); html += `<${type}>`; list = type; }
      const indent = raw.match(/^\s*/)[0].length;
      html += `<li${indent >= 2 ? ' class="sub"' : ''}>${inline(m[2])}</li>`;
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList(); flushTable();
  return html;
}

export const dateLabel = (iso) => fmtDate(iso);
