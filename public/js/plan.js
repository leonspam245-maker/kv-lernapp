// Prüfungen erfassen und Lernplan anzeigen, abhaken, verschieben, neu berechnen.
import { store, commit, saveProgress, byId, subjectName, topicName, topicsOf } from './store.js';
import { esc, uid, todayISO, addDays, diffDays, fmtDate, fmtDateLong, fmtDateShort, WEEKDAYS, plural } from './util.js';
import { toast, confirmDialog, emptyState, progressBar, demoBadge } from './ui.js';
import { buildPlan, moveUnit, KIND_LABEL } from './planner.js';
import { topicStats } from './srs.js';
import { unitHtml, bindUnitChecks, rerender, setLeaveGuard } from './app.js';

const REASONS = ['Arbeit', 'Schule', 'ÜK', 'Ferien', 'Anderes'];
const DEFAULT_MINUTES = [30, 30, 30, 30, 30, 60, 0];

function planInputs(exam) {
  const db = store.db; const t = todayISO();
  const topicInfo = {}; const stats = {};
  for (const id of exam.topicIds) {
    const tp = byId('topics', id); if (!tp) continue;
    topicInfo[id] = { name: tp.name, cardCount: db.cards.filter((c) => c.topicId === id).length };
    const s = topicStats(id, db, t);
    stats[id] = { errorRate: s.errorRate, cardsDue: s.cardsDue };
  }
  return { topicInfo, stats, today: t };
}
export function computePlan(exam) {
  return buildPlan({ exam, ...planInputs(exam), previous: exam.plan?.units || [] });
}

/** Ergebnis-Zusammenfassung für eine abgehakte Einheit aus den heutigen Übungen */
function unitResult(u) {
  const db = store.db; const t = todayISO();
  const tids = u.topicId ? [u.topicId] : u.topicIds || [];
  const cards = db.cards.filter((c) => tids.includes(c.topicId) && c.last === t).length;
  let got = 0; let max = 0; const kinds = new Set();
  for (const a of db.attempts.filter((x) => x.date === t)) {
    for (const ans of a.answers) if (tids.includes(ans.topicId)) { got += ans.points; max += ans.maxPoints; kinds.add(a.type); }
  }
  const parts = [];
  if (cards) parts.push(`${plural(cards, 'Karte', 'Karten')} geübt`);
  if (max) parts.push(`${kinds.has('exam') ? 'Probeprüfung' : 'Quiz'} ${got}/${max} P.`);
  return parts.join(' · ') || null;
}

export async function toggleUnit(examId, unitId, done) {
  const u = store.db.exams.find((e) => e.id === examId)?.plan?.units.find((x) => x.id === unitId);
  if (!u) return true;
  const fields = { done, doneAt: done ? new Date().toISOString() : null, result: done ? unitResult(u) : null };
  if (done && u.date > todayISO()) fields.date = todayISO(); // vorgezogen erledigt
  // Häkchen gilt sofort; ohne Verbindung wird das Speichern nachgeholt
  return saveProgress({ kind: 'unit', examId, unitId, fields });
}

export function unitStartLink(exam, u) {
  const db = store.db;
  if (u.kind === 'selbsttest') {
    const existing = db.contents.filter((c) => c.type === 'exam' && u.topicIds?.every((t) => c.topicIds.includes(t))).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return existing ? `#/inhalt/${existing.id}` : `#/ueben?fach=${exam.subjectId}&themen=${(u.topicIds || []).join(',')}`;
  }
  if (u.kind === 'erarbeiten') {
    const sheet = db.contents.filter((c) => c.type === 'merkblatt' && c.topicIds.includes(u.topicId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return sheet ? `#/inhalt/${sheet.id}` : `#/thema/${u.topicId}`;
  }
  return db.cards.some((c) => c.topicId === u.topicId) ? `#/karten?themen=${u.topicId}&alle=1` : `#/ueben?fach=${exam.subjectId}&themen=${u.topicId}`;
}

// ---------- Route bis zur Prüfung ----------
/**
 * Lernplan als Strecke: jeder Tag eine Station, die Prüfung das Ziel.
 * Gefüllt = erledigt, halb = teilweise, Ring = offen, unterbrochen = gesperrt.
 */
export function routeHtml(exam, { dark = false } = {}) {
  const t = todayISO();
  const plan = exam.plan || { units: [], days: [] };
  const blocked = new Map((exam.blocked || []).map((b) => [b.date, b.reason]));
  const stops = [];
  for (let d = t; d < exam.date; d = addDays(d, 1)) stops.push(d);
  const label = (d) => fmtDateShort(d).split(',')[0];
  const items = stops.map((d) => {
    const us = plan.units.filter((u) => u.date === d);
    const doneN = us.filter((u) => u.done).length;
    const min = us.reduce((s, u) => s + u.minutes, 0);
    let state = 'free'; let info = 'frei';
    if (blocked.has(d)) { state = 'blocked'; info = blocked.get(d); }
    else if (us.length && doneN === us.length) { state = 'done'; info = 'erledigt'; }
    else if (doneN) { state = 'partial'; info = `${doneN}/${us.length}`; }
    else if (us.length) { state = 'open'; info = `${min} Min.`; }
    const title = `${fmtDateLong(d)}: ${blocked.has(d) ? `gesperrt (${blocked.get(d)})` : us.length ? `${plural(us.length, 'Einheit', 'Einheiten')}, ${min} Min., ${doneN} erledigt` : 'keine Einheit'}`;
    return `<li class="stop is-${state}${d === t ? ' is-today' : ''}"><a href="#/pruefung/${exam.id}?tag=${d}" title="${esc(title)}" aria-label="${esc(title)}">
      <span class="stop-dot" aria-hidden="true"></span>
      <span class="stop-day">${d === t ? 'Heute' : label(d)}</span>
      <span class="stop-date">${d.slice(8)}.${d.slice(5, 7)}.</span>
      <span class="stop-info">${esc(info)}</span></a></li>`;
  }).join('');
  return `<ol class="route${dark ? ' route-dark' : ''}" aria-label="Lerntage bis zur Prüfung">${items}
    <li class="stop is-goal"><a href="#/pruefung/${exam.id}" aria-label="Prüfung am ${fmtDateLong(exam.date)}">
      <span class="stop-dot" aria-hidden="true"></span><span class="stop-day">Prüfung</span><span class="stop-date">${exam.date.slice(8)}.${exam.date.slice(5, 7)}.</span><span class="stop-info">Ziel</span></a></li></ol>`;
}

// ---------- Übersicht ----------
export function planListView(el) {
  const db = store.db; const t = todayISO();
  const upcoming = db.exams.filter((e) => e.date >= t).sort((a, b) => a.date.localeCompare(b.date));
  const past = db.exams.filter((e) => e.date < t).sort((a, b) => b.date.localeCompare(a.date));
  const row = (e) => {
    const units = e.plan?.units || []; const done = units.filter((u) => u.done).length;
    return `<li><a class="list-link" href="#/pruefung/${e.id}"><span style="flex:1"><span class="title">${esc(e.title)}</span> ${demoBadge(e)}<br><span class="meta">${esc(subjectName(e.subjectId))} · ${fmtDateLong(e.date)}${e.date >= t ? ` · in ${plural(diffDays(t, e.date), 'Tag', 'Tagen')}` : ''} · ${done}/${units.length} Einheiten</span>
      <span style="display:block;max-width:320px;margin-top:6px">${progressBar(done, units.length, 'Fortschritt')}</span></span><span aria-hidden="true">›</span></a></li>`;
  };
  el.innerHTML = `<div class="page-head"><div><h1>Lernplan</h1><p>Erfasse Prüfungen. Die App verteilt Erarbeiten, Wiederholungen und einen Selbsttest auf deine freien Lernzeiten.</p></div>
      <a class="btn btn-primary" href="#/pruefung/neu">Prüfung erfassen</a></div>
    <section class="card"><h2 style="margin-top:0">Anstehende Prüfungen</h2>${upcoming.length ? `<ul class="list">${upcoming.map(row).join('')}</ul>` : emptyState('Keine anstehende Prüfung', 'Erfasse Fach, Datum, Themen und deine Lernzeit.', '<a class="btn btn-primary" href="#/pruefung/neu">Prüfung erfassen</a>')}</section>
    ${past.length ? `<section class="card"><h2 style="margin-top:0">Vergangene Prüfungen</h2><ul class="list">${past.map(row).join('')}</ul></section>` : ''}`;
}

// ---------- Formular ----------
export function examFormView(el, id) {
  const db = store.db; const t = todayISO();
  const existing = id ? byId('exams', id) : null;
  if (id && !existing) { el.innerHTML = emptyState('Prüfung nicht gefunden', '', '<a class="btn" href="#/plan">Zum Lernplan</a>'); return; }
  if (!db.subjects.length) { el.innerHTML = emptyState('Zuerst ein Fach anlegen', 'Für den Lernplan brauchst du ein Fach mit Themen.', '<a class="btn btn-primary" href="#/faecher">Fächer</a>'); return; }
  const f = existing ? structuredClone(existing) : { title: '', subjectId: db.subjects[0].id, date: addDays(t, 14), topicIds: [], difficultTopicIds: [], minutesByWeekday: DEFAULT_MINUTES.slice(), blocked: [] };
  setLeaveGuard(() => true);

  const render = () => {
    const topics = topicsOf(f.subjectId);
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow"><a href="#/plan">Lernplan</a></div><h1>${existing ? 'Prüfung bearbeiten' : 'Prüfung erfassen'}</h1></div></div>
    <form id="exam-form" novalidate>
      <section class="card"><div class="grid grid-2">
        <div class="field"><label for="ex-subject">Fach</label><select id="ex-subject">${db.subjects.map((s) => `<option value="${s.id}" ${s.id === f.subjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="ex-date">Prüfungsdatum</label><input type="date" id="ex-date" value="${f.date}" min="${addDays(t, 1)}"><p class="hint" id="ex-date-label">${f.date ? fmtDateLong(f.date) : ''}</p></div>
      </div>
      <div class="field"><label for="ex-title">Bezeichnung</label><input type="text" id="ex-title" value="${esc(f.title)}" placeholder="z. B. W&G-Prüfung Vertragsrecht"></div></section>

      <section class="card"><h2 style="margin-top:0">Relevante Themen</h2>
        ${topics.length ? `<p class="small muted">Markiere Themen, die dir schwerfallen. Sie bekommen mehr Zeit und zusätzliche Wiederholungen.</p>${topics.map((tp) => `<div class="topic-pick">
          <label class="check" style="padding:0"><input type="checkbox" data-topic="${tp.id}" ${f.topicIds.includes(tp.id) ? 'checked' : ''}> ${esc(tp.name)}</label>
          <label class="chip-toggle"><input type="checkbox" data-hard="${tp.id}" ${f.difficultTopicIds.includes(tp.id) ? 'checked' : ''}> fällt mir schwer</label></div>`).join('')}`
        : `<p class="muted">Dieses Fach hat noch keine Themen. <a href="#/fach/${f.subjectId}">Themen anlegen</a></p>`}</section>

      <section class="card"><h2 style="margin-top:0">Lernzeit pro Wochentag</h2><p class="small muted">In Minuten. 0 = an diesem Wochentag nicht lernen.</p>
        <div class="weekday-grid">${WEEKDAYS.map((w, i) => `<div><label for="wd-${i}">${w}</label><input type="number" id="wd-${i}" data-wd="${i}" min="0" max="600" step="5" value="${f.minutesByWeekday[i]}" inputmode="numeric"></div>`).join('')}</div></section>

      <section class="card"><h2 style="margin-top:0">Gesperrte Tage</h2><p class="small muted">Tage, an denen du nicht lernen kannst, z. B. wegen Arbeit, Schule, ÜK oder Ferien.</p>
        ${f.blocked.length ? `<ul class="list">${f.blocked.slice().sort((a, b) => a.date.localeCompare(b.date)).map((b) => `<li class="row between"><span>${fmtDateShort(b.date)} · ${esc(b.reason)}</span><button type="button" class="btn btn-small btn-danger" data-unblock="${b.date}" aria-label="Sperre ${fmtDate(b.date)} entfernen">Entfernen</button></li>`).join('')}</ul>` : '<p class="muted">Keine.</p>'}
        <div class="grid grid-3" style="margin-top:10px;align-items:end">
          <div><label for="bl-from">Von</label><input type="date" id="bl-from" min="${t}"></div>
          <div><label for="bl-to">Bis (optional)</label><input type="date" id="bl-to" min="${t}"></div>
          <div><label for="bl-reason">Grund</label><select id="bl-reason">${REASONS.map((r) => `<option>${r}</option>`).join('')}</select></div>
        </div>
        <button type="button" class="btn" id="bl-add" style="margin-top:10px">Tag(e) sperren</button></section>

      <div class="row end"><a class="btn" href="${existing ? `#/pruefung/${existing.id}` : '#/plan'}">Abbrechen</a><button class="btn btn-primary" id="save">${existing ? 'Speichern und Plan neu berechnen' : 'Lernplan erstellen'}</button></div>
    </form>`;
    const read = () => {
      f.title = el.querySelector('#ex-title').value;
      f.date = el.querySelector('#ex-date').value;
      f.topicIds = [...el.querySelectorAll('[data-topic]:checked')].map((x) => x.dataset.topic);
      f.difficultTopicIds = [...el.querySelectorAll('[data-hard]:checked')].map((x) => x.dataset.hard).filter((x) => f.topicIds.includes(x));
      f.minutesByWeekday = [...el.querySelectorAll('[data-wd]')].map((x) => Math.max(0, Math.round(Number(x.value) || 0)));
    };
    el.querySelector('#ex-subject').addEventListener('change', (e) => { read(); f.subjectId = e.target.value; f.topicIds = []; f.difficultTopicIds = []; render(); });
    el.querySelector('#ex-date').addEventListener('change', (e) => { el.querySelector('#ex-date-label').textContent = e.target.value ? fmtDateLong(e.target.value) : ''; });
    el.querySelectorAll('[data-hard]').forEach((cb) => cb.addEventListener('change', () => { if (cb.checked) el.querySelector(`[data-topic="${cb.dataset.hard}"]`).checked = true; }));
    el.querySelectorAll('[data-unblock]').forEach((b) => b.addEventListener('click', () => { read(); f.blocked = f.blocked.filter((x) => x.date !== b.dataset.unblock); render(); }));
    el.querySelector('#bl-add').addEventListener('click', () => {
      read();
      const from = el.querySelector('#bl-from').value; const to = el.querySelector('#bl-to').value || from; const reason = el.querySelector('#bl-reason').value;
      if (!from) return toast('Bitte ein Datum wählen.', 'error');
      if (to < from) return toast('«Bis» liegt vor «Von».', 'error');
      if (diffDays(from, to) > 120) return toast('Bitte höchstens 120 Tage auf einmal sperren.', 'error');
      for (let d = from; d <= to; d = addDays(d, 1)) { f.blocked = f.blocked.filter((x) => x.date !== d); f.blocked.push({ date: d, reason }); }
      toast(from === to ? `${fmtDate(from)} gesperrt (${reason}).` : `${fmtDate(from)} bis ${fmtDate(to)} gesperrt (${reason}).`, 'info');
      render();
    });
    el.querySelector('#exam-form').addEventListener('submit', (e) => e.preventDefault());
    el.querySelector('#save').addEventListener('click', async () => {
      read();
      const title = f.title.trim() || `Prüfung ${subjectName(f.subjectId)}`;
      if (!f.date || f.date <= t) return toast('Bitte ein Prüfungsdatum in der Zukunft wählen.', 'error');
      if (!f.topicIds.length) return toast('Bitte mindestens ein Thema auswählen.', 'error');
      if (!f.minutesByWeekday.some((m) => m > 0)) return toast('Bitte an mindestens einem Wochentag Lernzeit eintragen.', 'error');
      const exam = { ...(existing || { id: uid('p'), createdAt: new Date().toISOString() }), ...f, title };
      exam.plan = computePlan(exam);
      try {
        await commit((d) => { const i = d.exams.findIndex((x) => x.id === exam.id); if (i >= 0) d.exams[i] = exam; else d.exams.push(exam); });
        setLeaveGuard(null);
        toast(`Lernplan ${existing ? 'neu berechnet' : 'erstellt'}: ${plural(exam.plan.units.length, 'Einheit', 'Einheiten')}${exam.plan.unplaced.length ? `, ${exam.plan.unplaced.length} ohne Platz` : ''}.`);
        location.hash = `#/pruefung/${exam.id}`;
      } catch (err) { toast(`Nicht gespeichert: ${err.message} Deine Eingaben bleiben erhalten.`, 'error'); }
    });
  };
  render();
}

// ---------- Plan-Ansicht ----------
export function examPlanView(el, id, query = {}) {
  const exam = byId('exams', id);
  if (!exam) { el.innerHTML = emptyState('Prüfung nicht gefunden', '', '<a class="btn" href="#/plan">Zum Lernplan</a>'); return; }
  const t = todayISO();
  const plan = exam.plan || { units: [], unplaced: [], days: [] };
  const units = plan.units;
  const done = units.filter((u) => u.done);
  const minutes = units.reduce((s, u) => s + u.minutes, 0);
  const blocked = new Map((exam.blocked || []).map((b) => [b.date, b.reason]));
  const dates = [...new Set([...plan.days.map((d) => d.date), ...units.map((u) => u.date)])].sort();
  const capacity = new Map(plan.days.map((d) => [d.date, d.capacity]));
  const missed = units.filter((u) => !u.done && u.date < t).length;
  const left = diffDays(t, exam.date);

  el.innerHTML = `<div class="page-head"><div><div class="eyebrow"><a href="#/plan">Lernplan</a> · ${esc(subjectName(exam.subjectId))}</div><h1>${esc(exam.title)} ${demoBadge(exam)}</h1>
      <p>${fmtDateLong(exam.date)}${left >= 0 ? ` · ${left === 0 ? 'heute' : `in ${plural(left, 'Tag', 'Tagen')}`}` : ' · vorbei'}</p></div>
      <div class="row no-print"><button class="btn btn-primary" id="recalc">Neu berechnen</button><a class="btn" href="#/pruefung/${id}/bearbeiten">Bearbeiten</a></div></div>
    ${left > 0 ? `<div class="route-wrap">${routeHtml(exam)}</div>` : ''}
    <section class="card"><div class="grid grid-3">
      <div><div class="big-number">${done.length}<span class="muted" style="font-size:1rem"> / ${units.length}</span></div><div class="meta">Einheiten erledigt</div></div>
      <div><div class="big-number">${Math.floor(minutes / 60)}<span class="muted" style="font-size:1rem"> Std. </span>${String(minutes % 60).padStart(2, '0')}</div><div class="meta">Lernzeit geplant</div></div>
      <div><div class="big-number">${exam.topicIds.length}</div><div class="meta">Themen${exam.difficultTopicIds?.length ? `, ${exam.difficultTopicIds.length} schwierig` : ''}</div></div></div>
      <div style="margin-top:12px">${progressBar(done.length, units.length, 'Fortschritt')}</div>
      <p class="small muted" style="margin-top:10px">Themen: ${exam.topicIds.map((tid) => `${esc(topicName(tid))}${exam.difficultTopicIds?.includes(tid) ? ' (schwierig)' : ''}`).join(', ')}. Zuletzt berechnet: ${fmtDate(plan.generatedAt)}.</p>
      ${missed ? `<div class="notice notice-warn">${plural(missed, 'Einheit ist', 'Einheiten sind')} überfällig. Mit «Neu berechnen» werden sie auf die verbleibenden Tage verteilt; Erledigtes bleibt gespeichert.</div>` : ''}
    </section>
    ${plan.unplaced.length ? `<section class="card" style="border-left:4px solid var(--bad)"><h2 style="margin-top:0">Kein Platz mehr (${plan.unplaced.length})</h2>
      <p class="small">Die verfügbare Lernzeit reicht nicht für alles. Wichtige und schwierige Themen wurden zuerst eingeplant. Mehr Lernzeit eintragen oder Sperrtage prüfen, dann neu berechnen.</p>
      <ul>${plan.unplaced.map((u) => `<li>${esc(u.task)} <span class="meta">– ${esc(u.reason)}</span></li>`).join('')}</ul></section>` : ''}
    <section class="card"><h2 style="margin-top:0">Tage bis zur Prüfung</h2>
      ${dates.map((d) => {
        const dayUnits = units.filter((u) => u.date === d);
        const isBlocked = blocked.has(d);
        if (d < t && !dayUnits.length) return '';
        const used = dayUnits.reduce((s, u) => s + u.minutes, 0);
        return `<div class="day ${isBlocked ? 'blocked' : ''} ${d === t ? 'today' : ''}" id="tag-${d}"><div class="day-head"><h3>${fmtDateShort(d)}</h3>
          <span class="meta">${isBlocked ? `Gesperrt: ${esc(blocked.get(d))}` : capacity.has(d) ? (capacity.get(d) ? `${used} von ${capacity.get(d)} Min.` : 'Keine Lernzeit') : `${used} Min.`}</span></div>
          ${dayUnits.map((u) => unitHtml(exam, u, { overdue: !u.done && u.date < t }).replace('<div class="unit-actions no-print">', `<div class="unit-actions no-print">${u.done ? '' : `<button class="btn btn-small" data-move="${u.id}">Verschieben</button>`}`)).join('')}
          ${!dayUnits.length ? `<p class="small muted" style="margin:0">${isBlocked ? 'Kein Lernen geplant.' : 'Frei.'}</p>` : ''}</div>`;
      }).join('')}
      <div class="day"><div class="day-head"><h3>${fmtDateShort(exam.date)}</h3><span class="badge badge-accent">Prüfung</span></div></div>
    </section>
    <p class="no-print"><button class="btn btn-danger btn-small" id="del">Prüfung und Lernplan löschen</button></p>`;

  bindUnitChecks(el);
  if (query.tag) {
    const target = el.querySelector(`#tag-${CSS.escape(query.tag)}`);
    if (target) setTimeout(() => { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); target.classList.add('highlight'); }, 50);
  }
  el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
    const u = units.find((x) => x.id === b.dataset.move);
    const box = b.parentElement;
    box.innerHTML = `<label class="sr" for="mv-${u.id}">Neues Datum</label><input type="date" id="mv-${u.id}" min="${t}" max="${addDays(exam.date, -1)}" value="${u.date >= t ? u.date : t}" style="max-width:180px"><button class="btn btn-small btn-primary">Übernehmen</button><button class="btn btn-small">Abbrechen</button>`;
    const [ok, cancel] = box.querySelectorAll('button');
    cancel.addEventListener('click', rerender);
    ok.addEventListener('click', async () => {
      const date = box.querySelector('input').value;
      if (!date || date < t || date >= exam.date) return toast('Bitte ein Datum zwischen heute und dem Tag vor der Prüfung wählen.', 'error');
      if (blocked.has(date) && !(await confirmDialog(`${fmtDate(date)} ist gesperrt (${blocked.get(date)}). Trotzdem dorthin verschieben?`, { ok: 'Verschieben' }))) return;
      try {
        await commit((d) => { const ex = d.exams.find((x) => x.id === id); ex.plan.units = moveUnit(ex.plan.units, u.id, date); });
        toast(`Auf ${fmtDateShort(date)} verschoben. Die Einheit bleibt beim Neuberechnen dort.`);
        rerender();
      } catch (e) { toast(e.message, 'error'); }
    });
  }));
  el.querySelector('#recalc').addEventListener('click', async () => {
    try {
      const next = computePlan(exam);
      await commit((d) => { d.exams.find((x) => x.id === id).plan = next; });
      toast(`Plan neu berechnet. ${plural(next.units.filter((u) => u.done).length, 'erledigte Einheit bleibt', 'erledigte Einheiten bleiben')} gespeichert${next.unplaced.length ? `, ${next.unplaced.length} ohne Platz` : ''}.`);
      rerender();
    } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#del').addEventListener('click', async () => {
    if (!(await confirmDialog(`Prüfung «${exam.title}» mit Lernplan löschen? Karten und Quizergebnisse bleiben erhalten.`, { ok: 'Löschen', danger: true }))) return;
    try { await commit((d) => { d.exams = d.exams.filter((x) => x.id !== id); }); toast('Prüfung gelöscht.'); location.hash = '#/plan'; } catch (e) { toast(e.message, 'error'); }
  });
}

export { KIND_LABEL };
