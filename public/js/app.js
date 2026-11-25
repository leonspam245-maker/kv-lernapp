// Einstieg: Router, Startseite, Fächer, Themen und Unterlagen.
import { store, loadAll, commit, byId, subjectName, topicName, topicsOf, sourcesOf, sync, refreshIfStale } from './store.js';
import { esc, uid, todayISO, fmtDate, fmtDateLong, fmtDateShort, fmtDateTime, diffDays, plural } from './util.js';
import { toast, confirmDialog, refChips, originBadge, demoBadge, emptyState, progressBar, renderMarkdown, ORIGIN, KIND_MYKV } from './ui.js';
import { topicStats } from './srs.js';
import { KIND_LABEL } from './planner.js';
import { importView } from './import.js';
import { practiceView, contentView, cardsView } from './practice.js';
import { planListView, examFormView, examPlanView, toggleUnit, unitStartLink, routeHtml } from './plan.js';
import { settingsView } from './settings.js';
import { ablageView } from './ablage.js';
import { initBackend, currentUser, isCloud, isRecovery, recoveryLinkError } from './backend.js';
import { loginView, newPasswordView } from './auth.js';

const view = document.getElementById('view');
export const today = () => todayISO();

const ROUTES = [
  [/^$/, homeView, 'home'],
  [/^faecher$/, subjectsView, 'faecher'],
  [/^fach\/([\w-]+)$/, subjectView, 'faecher'],
  [/^thema\/([\w-]+)$/, topicView, 'faecher'],
  [/^quelle\/([\w-]+)$/, sourceView, 'faecher'],
  [/^import$/, importView, 'import'],
  [/^ueben$/, practiceView, 'ueben'],
  [/^inhalt\/([\w-]+)$/, contentView, 'ueben'],
  [/^karten$/, cardsView, 'ueben'],
  [/^plan$/, planListView, 'plan'],
  [/^pruefung\/neu$/, examFormView, 'plan'],
  [/^pruefung\/([\w-]+)\/bearbeiten$/, examFormView, 'plan'],
  [/^pruefung\/([\w-]+)$/, examPlanView, 'plan'],
  [/^ablage$/, ablageView, 'ablage'],
  [/^ablage\/(lj[123](?:\/[a-z0-9-]+)?)$/, ablageView, 'ablage'],
  [/^einstellungen$/, settingsView, 'einstellungen'],
];

let leaveGuard = null;
/** Ansichten mit ungesicherten Eingaben können das Verlassen absichern. */
export const setLeaveGuard = (fn) => { leaveGuard = fn; };

export function route() {
  if (!store.db) return;
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, qs] = hash.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  leaveGuard = null;
  for (const [re, fn, nav] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
    try {
      fn(view, m[1], query);
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="notice notice-bad"><h4>Diese Ansicht konnte nicht angezeigt werden.</h4><p>${esc(e.message)}</p><a class="btn" href="#/">Zur Startseite</a></div>`;
    }
    return;
  }
  view.innerHTML = emptyState('Seite nicht gefunden', 'Diese Adresse gibt es in KV-Learn nicht.', '<a class="btn btn-primary" href="#/">Zur Startseite</a>');
}
export const rerender = () => route();

// ---------- Abgleich zwischen Geräten (Computer und Handy) ----------
/** Laufende Übungen und Formulare werden nie automatisch neu aufgebaut. */
function safeToRerender() {
  const path = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (leaveGuard?.()) return false;
  if (/^(inhalt|karten|pruefung\/neu|pruefung\/[\w-]+\/bearbeiten)/.test(path)) return false;
  if (/^quelle\//.test(path) && location.hash.includes('bearbeiten=1')) return false;
  return true;
}
function applyExternalChange() {
  if (safeToRerender()) route();
  else toast('Auf einem anderen Gerät wurde etwas geändert. Die Anzeige wird aktualisiert, sobald du diese Seite verlässt.', 'info', { action: 'Jetzt aktualisieren', onAction: () => route() });
}
sync.onExternalChange = applyExternalChange;
let lastCheck = 0;
async function checkForUpdates() {
  if (!store.db || Date.now() - lastCheck < 2000) return;
  lastCheck = Date.now();
  if (await refreshIfStale()) { toast('Neuer Stand von einem anderen Gerät geladen.', 'info'); applyExternalChange(); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdates(); });
window.addEventListener('focus', checkForUpdates);
setInterval(() => { if (document.visibilityState === 'visible') checkForUpdates(); }, 60000);

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
window.addEventListener('beforeunload', (e) => { if (leaveGuard?.()) { e.preventDefault(); e.returnValue = ''; } });

// ---------- Gemeinsame Aktionen ----------
export async function createSubject(name) {
  const n = name.trim();
  if (!n) throw new Error('Bitte einen Namen für das Fach eingeben.');
  if (store.db.subjects.some((s) => s.name.toLowerCase() === n.toLowerCase())) throw new Error(`Das Fach «${n}» gibt es bereits.`);
  const s = { id: uid('f'), name: n, createdAt: new Date().toISOString() };
  await commit((db) => db.subjects.push(s));
  return s;
}
export async function createTopic(subjectId, name) {
  const n = name.trim();
  if (!subjectId) throw new Error('Bitte zuerst ein Fach wählen.');
  if (!n) throw new Error('Bitte einen Namen für das Thema eingeben.');
  if (store.db.topics.some((t) => t.subjectId === subjectId && t.name.toLowerCase() === n.toLowerCase())) throw new Error(`Das Thema «${n}» gibt es in diesem Fach bereits.`);
  const t = { id: uid('t'), subjectId, name: n, createdAt: new Date().toISOString() };
  await commit((db) => db.topics.push(t));
  return t;
}

/** Alle Lerneinheiten von heute und überfällige offene Einheiten */
function todayUnits() {
  const t = today();
  const list = [];
  for (const ex of store.db.exams) {
    if (ex.date < t || !ex.plan) continue;
    for (const u of ex.plan.units) {
      if (u.date === t || (u.date < t && !u.done)) list.push({ exam: ex, unit: u, overdue: u.date < t });
    }
  }
  return list.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.unit.date.localeCompare(b.unit.date));
}

export function unitHtml(exam, u, { showDate = false, overdue = false } = {}) {
  const topic = u.topicId ? topicName(u.topicId) : `${plural(u.topicIds?.length || 0, 'Thema', 'Themen')}`;
  return `<div class="unit ${u.done ? 'done' : ''} ${overdue ? 'missed' : ''}" data-unit="${u.id}" data-exam="${exam.id}">
    <div class="today-unit">
      <input type="checkbox" class="unit-check" ${u.done ? 'checked' : ''} aria-label="Einheit abhaken: ${esc(u.task)}">
      <div>
        <div class="kind kind-${u.kind}">${KIND_LABEL[u.kind]} · ${esc(topic)} · ${u.minutes} Min.${u.pinned ? ' · verschoben' : ''}</div>
        <div class="unit-task">${esc(u.task)}</div>
        ${showDate || overdue ? `<div class="meta">${overdue ? 'Überfällig seit ' : ''}${fmtDateShort(u.date)}</div>` : ''}
        ${u.result ? `<div class="meta">Ergebnis: ${esc(u.result)}</div>` : ''}
        <div class="unit-actions no-print">${u.done ? '' : `<a class="btn btn-small btn-primary" href="${unitStartLink(exam, u)}">Starten</a>`}</div>
      </div>
    </div>
  </div>`;
}

export function bindUnitChecks(root, after = rerender) {
  root.querySelectorAll('.unit .unit-check').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const el = cb.closest('.unit');
      try {
        const saved = await toggleUnit(el.dataset.exam, el.dataset.unit, cb.checked);
        toast(cb.checked ? (saved ? 'Einheit abgehakt und gespeichert.' : 'Einheit abgehakt. Gespeichert wird, sobald wieder eine Verbindung besteht.') : 'Einheit wieder geöffnet.', saved ? undefined : 'info');
        after();
      } catch (e) { cb.checked = !cb.checked; toast(e.message, 'error'); }
    });
  });
}

// ---------- Startseite ----------
const greeting = () => (store.db.settings.profile?.firstName ? `Hallo ${esc(store.db.settings.profile.firstName)}. ` : '');
function homeView(el) {
  const db = store.db;
  const t = today();
  const units = todayUnits();
  const minutes = units.filter((x) => !x.unit.done).reduce((s, x) => s + x.unit.minutes, 0);
  const nextExam = db.exams.filter((e) => e.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];
  const dueByTopic = new Map();
  for (const c of db.cards) if (c.due <= t) dueByTopic.set(c.topicId, (dueByTopic.get(c.topicId) || 0) + 1);
  const dueTotal = [...dueByTopic.values()].reduce((a, b) => a + b, 0);
  const weak = db.topics.map((tp) => ({ tp, st: topicStats(tp.id, db, t) })).filter((x) => x.st.errorRate !== null && x.st.errorRate > 0.3).sort((a, b) => b.st.errorRate - a.st.errorRate).slice(0, 4);

  const openUnits = units.filter((x) => !x.unit.done);
  const summary = !units.length ? 'Für heute ist nichts geplant.' : minutes ? `${plural(openUnits.length, 'Einheit', 'Einheiten')} offen, etwa ${minutes} Minuten.` : 'Alles erledigt für heute. Gut gemacht.';

  let hero; let routeTile = '';
  if (nextExam) {
    const left = diffDays(t, nextExam.date);
    const all = nextExam.plan?.units || [];
    const done = all.filter((u) => u.done).length;
    hero = `<section class="hero" aria-labelledby="hero-title">
      <div class="hero-bg" aria-hidden="true">LERNEN</div>
      <p class="hero-date">${greeting()}${fmtDateLong(t)}</p>
      <h1 class="hero-count" id="hero-title"><span class="hero-num">${left}</span><span class="hero-text">${left === 1 ? 'Tag' : 'Tage'} bis zur Prüfung</span></h1>
      <p class="hero-sub">${esc(nextExam.title)} ${demoBadge(nextExam)}</p>
      <p class="hero-meta">${esc(subjectName(nextExam.subjectId))}, ${fmtDateLong(nextExam.date)}. ${done} von ${plural(all.length, 'Einheit', 'Einheiten')} erledigt.</p>
      <div class="hero-ctas"><a class="btn btn-primary" href="#/pruefung/${nextExam.id}">Lernplan ansehen</a>${dueTotal ? `<a class="btn" href="#/karten?themen=${[...dueByTopic.keys()].join(',')}">Karten üben</a>` : `<a class="btn" href="#/ueben">Üben</a>`}</div>
    </section>`;
    routeTile = `<section class="tile tile-route" aria-label="Dein Weg zur Prüfung"><div class="tile-head"><h2>Dein Weg zur Prüfung</h2><a class="link-more" href="#/pruefung/${nextExam.id}">Ganzer Plan</a></div><div class="route-wrap">${routeHtml(nextExam)}</div></section>`;
  } else {
    hero = `<section class="hero hero-empty" aria-labelledby="hero-title">
      <div class="hero-bg" aria-hidden="true">LERNEN</div>
      <p class="hero-date">${greeting()}${fmtDateLong(t)}</p>
      <h1 class="hero-title" id="hero-title">Wann ist deine nächste Prüfung?</h1>
      <p class="hero-meta">Erfasse Datum, Themen und deine freie Zeit. Die App plant den Weg dorthin.</p>
      <div class="hero-ctas"><a class="btn btn-primary" href="#/pruefung/neu">Prüfung erfassen</a><a class="btn" href="#/import">Material importieren</a></div>
    </section>`;
  }

  el.innerHTML = `${hero}${routeTile}
    <div class="home-grid bento">
      <section class="tile tile-today today" aria-labelledby="h-today">
        <div class="tile-head"><h2 id="h-today">Heute lernen</h2></div>
        <p class="tile-lead">${summary}</p>
        ${units.length ? units.map((x) => unitHtml(x.exam, x.unit, { overdue: x.overdue })).join('') : emptyState('Heute ist frei', db.exams.length ? 'Wiederhole fällige Karten oder geniesse den freien Tag.' : 'Sobald du eine Prüfung erfasst, stehen hier deine Aufgaben.')}
        ${units.some((x) => x.overdue) ? '<p class="small muted" style="margin-top:12px">Überfällige Einheiten kannst du abhaken oder im Lernplan mit «Neu berechnen» neu verteilen.</p>' : ''}
      </section>
      <section class="tile tile-dark" aria-labelledby="h-due">
        <h2 id="h-due">Fällige Karten</h2>
        ${dueTotal ? `<p class="tile-figure"><span class="figure">${dueTotal}</span><span>zum Wiederholen</span></p>
          <ul class="list">${[...dueByTopic].map(([tid, n]) => `<li><a class="list-link" href="#/karten?themen=${tid}"><span class="title">${esc(topicName(tid))}</span><span class="badge badge-accent">${n}</span></a></li>`).join('')}</ul>
          <a class="btn btn-primary btn-block" href="#/karten?themen=${[...dueByTopic.keys()].join(',')}">Fällige Karten üben</a>`
          : `<p class="tile-figure"><span class="figure">0</span><span>Alles wiederholt.</span></p><p class="muted">${db.cards.length ? 'Morgen kommen neue Karten dran.' : 'Importiere Quizlet-Karten oder erstelle Karten aus deinen Unterlagen.'}</p>`}
      </section>
      ${weak.length ? `<section class="tile" aria-labelledby="h-weak"><h2 id="h-weak">Hier machst du noch Fehler</h2><ul class="list">${weak.map((w) => `<li><a class="list-link" href="#/thema/${w.tp.id}"><span class="title">${esc(w.tp.name)}</span><span class="badge badge-bad">${Math.round(w.st.errorRate * 100)} % falsch</span></a></li>`).join('')}</ul></section>` : ''}
      <section class="tile" aria-labelledby="h-more">
        <h2 id="h-more">Deine Sammlung</h2>
        <ul class="list link-list">
          <li><a class="list-link" href="#/faecher"><span class="title">Fächer und Unterlagen</span><span class="meta">${plural(db.subjects.length, 'Fach', 'Fächer')}, ${plural(db.sources.length, 'Unterlage', 'Unterlagen')}</span></a></li>
          <li><a class="list-link" href="#/import"><span class="title">Material importieren</span><span class="meta">PDF, myKV, Quizlet, OneNote</span></a></li>
          <li><a class="list-link" href="#/ueben"><span class="title">Üben</span><span class="meta">Merkblatt, Quiz, Probeprüfung</span></a></li>
          <li><a class="list-link" href="#/plan"><span class="title">Lernplan</span><span class="meta">${plural(db.exams.length, 'Prüfung', 'Prüfungen')}</span></a></li>
        </ul>
      </section>
    </div>`;
  bindUnitChecks(el);
}

// ---------- Fächer ----------
function subjectsView(el) {
  const db = store.db;
  el.innerHTML = `
    <div class="page-head"><div><h1>Fächer</h1><p>Lege Fächer und Themen an und ordne ihnen deine Unterlagen zu.</p></div>
      <a class="btn btn-primary" href="#/import">Material importieren</a></div>
    <section class="card">
      ${db.subjects.length ? `<ul class="list">${db.subjects.slice().sort((a, b) => a.name.localeCompare(b.name, 'de-CH')).map((s) => {
        const topics = topicsOf(s.id);
        const srcCount = db.sources.filter((x) => x.subjectId === s.id).length;
        return `<li><a class="list-link" href="#/fach/${s.id}"><span><span class="title">${esc(s.name)}</span> ${demoBadge(s)}<br><span class="meta">${plural(topics.length, 'Thema', 'Themen')} · ${plural(srcCount, 'Unterlage', 'Unterlagen')}</span></span><span aria-hidden="true">›</span></a></li>`;
      }).join('')}</ul>` : emptyState('Noch keine Fächer', 'Lege dein erstes Fach an, zum Beispiel «W&G» oder «IKA».')}
      <form class="inline-new" id="new-subject" autocomplete="off">
        <input type="text" name="name" placeholder="Neues Fach, z. B. W&G" aria-label="Name des neuen Fachs" required>
        <button class="btn btn-primary">Fach anlegen</button>
      </form>
    </section>`;
  el.querySelector('#new-subject').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const s = await createSubject(e.target.name.value); toast(`Fach «${s.name}» angelegt.`); location.hash = `#/fach/${s.id}`; }
    catch (err) { toast(err.message, 'error'); }
  });
}

function subjectView(el, id) {
  const db = store.db;
  const s = byId('subjects', id);
  if (!s) { el.innerHTML = emptyState('Fach nicht gefunden', 'Es wurde vielleicht gelöscht.', '<a class="btn" href="#/faecher">Zu den Fächern</a>'); return; }
  const t = today();
  const topics = topicsOf(id);
  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow"><a href="#/faecher">Fächer</a></div><h1>${esc(s.name)} ${demoBadge(s)}</h1></div>
      <div class="row"><a class="btn" href="#/import?fach=${id}">Material importieren</a><a class="btn" href="#/ueben?fach=${id}">Üben</a></div></div>
    <section class="card">
      <h2 style="margin-top:0">Themen</h2>
      ${topics.length ? `<ul class="list">${topics.map((tp) => {
        const st = topicStats(tp.id, db, t);
        const n = sourcesOf(tp.id).length;
        const err = st.errorRate === null ? '<span class="badge">noch nicht geübt</span>' : `<span class="badge ${st.errorRate > 0.3 ? 'badge-bad' : 'badge-ok'}">${Math.round((1 - st.errorRate) * 100)} % richtig</span>`;
        return `<li><a class="list-link" href="#/thema/${tp.id}"><span style="flex:1"><span class="title">${esc(tp.name)}</span><br>
          <span class="meta">${plural(n, 'Unterlage', 'Unterlagen')} · ${st.cardsMastered}/${st.cardsTotal} Karten beherrscht${st.cardsDue ? ` · ${st.cardsDue} fällig` : ''}</span>
          <span style="display:block;margin-top:6px;max-width:320px">${progressBar(st.cardsMastered, st.cardsTotal, 'Karten beherrscht')}</span></span>${err}</a></li>`;
      }).join('')}</ul>` : emptyState('Noch keine Themen', 'Lege Themen an, zum Beispiel «Vertragsarten».')}
      <form class="inline-new" id="new-topic" autocomplete="off">
        <input type="text" name="name" placeholder="Neues Thema" aria-label="Name des neuen Themas" required>
        <button class="btn btn-primary">Thema anlegen</button>
      </form>
    </section>
    <section class="card no-print">
      <h3>Fach bearbeiten</h3>
      <form class="inline-new" id="rename"><input type="text" name="name" value="${esc(s.name)}" aria-label="Fachname"><button class="btn">Umbenennen</button></form>
      <p style="margin-top:12px"><button class="btn btn-danger btn-small" id="del">Fach löschen</button></p>
    </section>`;
  el.querySelector('#new-topic').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const tp = await createTopic(id, e.target.name.value); toast(`Thema «${tp.name}» angelegt.`); rerender(); }
    catch (err) { toast(err.message, 'error'); }
  });
  el.querySelector('#rename').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return toast('Der Name darf nicht leer sein.', 'error');
    try { await commit((db2) => { byId('subjects', id).name = name; }); toast('Fach umbenannt.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelector('#del').addEventListener('click', async () => {
    const topicIds = topics.map((x) => x.id);
    const srcCount = db.sources.filter((x) => x.subjectId === id).length;
    if (!(await confirmDialog(`Fach «${s.name}» mit ${plural(topics.length, 'Thema', 'Themen')}, ${plural(srcCount, 'Unterlage', 'Unterlagen')}, Karten und Lernständen endgültig löschen?`, { ok: 'Löschen', danger: true }))) return;
    try {
      await commit((d) => {
        d.subjects = d.subjects.filter((x) => x.id !== id);
        d.topics = d.topics.filter((x) => x.subjectId !== id);
        d.sources = d.sources.filter((x) => x.subjectId !== id);
        d.cards = d.cards.filter((x) => !topicIds.includes(x.topicId));
        d.contents = d.contents.filter((x) => !x.topicIds.every((tid) => topicIds.includes(tid)));
        d.exams = d.exams.filter((x) => x.subjectId !== id);
      });
      toast('Fach gelöscht.'); location.hash = '#/faecher';
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------- Thema ----------
function topicView(el, id) {
  const db = store.db;
  const tp = byId('topics', id);
  if (!tp) { el.innerHTML = emptyState('Thema nicht gefunden', 'Es wurde vielleicht gelöscht.', '<a class="btn" href="#/faecher">Zu den Fächern</a>'); return; }
  const t = today();
  const st = topicStats(id, db, t);
  const sources = sourcesOf(id);
  const contents = db.contents.filter((c) => c.topicIds.includes(id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const TYPE = { merkblatt: 'Merkblatt', quiz: 'Quiz', exam: 'Probeprüfung' };
  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow"><a href="#/fach/${tp.subjectId}">${esc(subjectName(tp.subjectId))}</a></div><h1>${esc(tp.name)}</h1></div>
      <div class="row"><a class="btn" href="#/import?fach=${tp.subjectId}&thema=${id}">Material hinzufügen</a><a class="btn btn-primary" href="#/ueben?fach=${tp.subjectId}&themen=${id}">Üben</a></div></div>
    <section class="card">
      <h2 style="margin-top:0">Lernstand</h2>
      <div class="grid grid-3">
        <div><div class="big-number">${st.cardsMastered}<span class="muted" style="font-size:1rem"> / ${st.cardsTotal}</span></div><div class="meta">Karten beherrscht</div></div>
        <div><div class="big-number">${st.cardsDue}</div><div class="meta">Karten fällig</div></div>
        <div><div class="big-number">${st.errorRate === null ? '–' : Math.round(st.errorRate * 100) + ' %'}</div><div class="meta">Fehlerquote in ${plural(st.questionsAnswered, 'Frage', 'Fragen')}</div></div>
      </div>
      <p class="meta" style="margin-top:12px">${st.practiced ? `Zuletzt geübt am ${fmtDate(st.lastPracticed)}.` : 'Noch nicht geübt.'}${st.cardsStruggling ? ` ${plural(st.cardsStruggling, 'Karte braucht', 'Karten brauchen')} noch Übung.` : ''}</p>
      <div class="row">${st.cardsTotal ? `<a class="btn btn-primary" href="#/karten?themen=${id}">Karteikarten üben</a>` : ''}</div>
      ${st.mistakes.length ? `<h3 style="margin-top:18px">Hier machst du noch Fehler</h3><ul class="list">${st.mistakes.map((m) => `<li><div>${esc(m.prompt || 'Frage')}</div><div class="meta">${fmtDate(m.date)} · ${m.points}/${m.maxPoints} P.${m.contentId && byId('contents', m.contentId) ? ` · <a href="#/inhalt/${m.contentId}">erneut üben</a>` : ''}</div></li>`).join('')}</ul>` : ''}
    </section>
    <section class="card">
      <h2 style="margin-top:0">Unterlagen</h2>
      ${sources.length ? `<ul class="list">${sources.map((s) => `<li><a class="list-link" href="#/quelle/${s.id}"><span><span class="title">${esc(s.title)}</span> ${demoBadge(s)}<br><span class="meta">${originBadge(s.origin)} ${esc(sourceMeta(s))}</span></span><span aria-hidden="true">›</span></a></li>`).join('')}</ul>`
        : emptyState('Noch keine Unterlagen', 'Importiere ein PDF-Handout, Lernziele aus myKV, Quizlet-Karten oder OneNote-Notizen.', `<a class="btn btn-primary" href="#/import?fach=${tp.subjectId}&thema=${id}">Material importieren</a>`)}
    </section>
    <section class="card">
      <h2 style="margin-top:0">Erstellte Lerninhalte</h2>
      ${contents.length ? `<ul class="list">${contents.map((c) => `<li><a class="list-link" href="#/inhalt/${c.id}"><span><span class="title">${TYPE[c.type]}: ${esc(c.title)}</span><br><span class="meta">${fmtDateTime(c.createdAt)} · ${c.engine === 'ki' ? 'mit KI erstellt' : 'lokal aus Unterlagen'}</span></span><span aria-hidden="true">›</span></a></li>`).join('')}</ul>` : '<p class="muted">Noch keine. Unter «Üben» erstellst du Merkblatt, Quiz und Probeprüfung.</p>'}
    </section>
    <section class="card no-print">
      <h3>Thema bearbeiten</h3>
      <form class="inline-new" id="rename"><input type="text" name="name" value="${esc(tp.name)}" aria-label="Themenname"><button class="btn">Umbenennen</button></form>
      <p style="margin-top:12px"><button class="btn btn-danger btn-small" id="del">Thema löschen</button></p>
    </section>`;
  el.querySelector('#rename').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return toast('Der Name darf nicht leer sein.', 'error');
    try { await commit(() => { byId('topics', id).name = name; }); toast('Thema umbenannt.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelector('#del').addEventListener('click', async () => {
    if (!(await confirmDialog(`Thema «${tp.name}» mit ${plural(sources.length, 'Unterlage', 'Unterlagen')}, ${plural(st.cardsTotal, 'Karte', 'Karten')} und Lernständen löschen?`, { ok: 'Löschen', danger: true }))) return;
    try {
      await commit((d) => {
        d.topics = d.topics.filter((x) => x.id !== id);
        d.sources = d.sources.filter((x) => x.topicId !== id);
        d.cards = d.cards.filter((x) => x.topicId !== id);
        d.contents = d.contents.filter((x) => !(x.topicIds.length === 1 && x.topicIds[0] === id));
        for (const ex of d.exams) ex.topicIds = ex.topicIds.filter((x) => x !== id);
      });
      toast('Thema gelöscht.'); location.hash = `#/fach/${tp.subjectId}`;
    } catch (err) { toast(err.message, 'error'); }
  });
}

export function sourceMeta(s) {
  const parts = [];
  if (s.kind && KIND_MYKV[s.kind]) parts.push(KIND_MYKV[s.kind]);
  if (s.pages?.length) parts.push(plural(s.pages.length, 'Seite', 'Seiten'));
  if (s.cards?.length) parts.push(plural(s.cards.length, 'Karte', 'Karten'));
  if (s.fileName) parts.push(s.fileName);
  parts.push(`importiert ${fmtDate(s.createdAt)}`);
  return parts.join(' · ');
}

// ---------- Unterlage ----------
function sourceView(el, id, query) {
  const db = store.db;
  const s = byId('sources', id);
  if (!s) { el.innerHTML = emptyState('Unterlage nicht gefunden', 'Sie wurde vielleicht gelöscht.', '<a class="btn" href="#/faecher">Zu den Fächern</a>'); return; }
  const editing = query.bearbeiten === '1';
  const tp = byId('topics', s.topicId);
  const topicOptions = db.topics.map((x) => `<option value="${x.id}" ${x.id === s.topicId ? 'selected' : ''}>${esc(subjectName(x.subjectId))} · ${esc(x.name)}</option>`).join('');
  const pageStatus = (p) => (p.include === false ? '<span class="badge">nicht übernommen</span>' : p.ocr ? '<span class="badge badge-accent">per Texterkennung</span>' : p.manual ? '<span class="badge badge-warn">manuell ergänzt</span>' : '');
  let body = '';
  if (s.pages?.length) {
    body = s.pages.map((p) => `<div class="source-page" id="seite-${p.n}"><div class="row between"><h3 style="margin:0">Seite ${p.n}</h3>${pageStatus(p)}</div>
      ${editing ? `<textarea data-page="${p.n}" aria-label="Text Seite ${p.n}">${esc(p.text)}</textarea>` : `<div class="source-text">${p.text ? esc(p.text) : '<span class="muted">Kein Text vorhanden.</span>'}</div>`}</div>`).join('');
  } else if (s.cards?.length) {
    body = `<div class="table-wrap"><table><thead><tr><th>Begriff</th><th>Definition</th></tr></thead><tbody>${s.cards.map((c) => `<tr><td>${esc(c.term)}</td><td>${esc(c.def)}</td></tr>`).join('')}</tbody></table></div>`;
  } else if (s.content) {
    body = editing ? `<textarea id="content" style="min-height:320px" aria-label="Inhalt">${esc(s.content)}</textarea>` : `<div class="md">${renderMarkdown(s.content)}</div>`;
  } else {
    body = '<p class="muted">Diese Quelle ist nur ein Verweis ohne übernommenen Text.</p>';
  }
  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow"><a href="#/thema/${s.topicId}">${esc(subjectName(s.subjectId))} · ${esc(tp?.name || '')}</a></div><h1>${esc(s.title)} ${demoBadge(s)}</h1></div>
      <div class="row no-print">${editing ? '' : `<a class="btn" href="#/quelle/${id}?bearbeiten=1">Bearbeiten</a>`}<a class="btn" href="#/ueben?fach=${s.subjectId}&themen=${s.topicId}&quellen=${id}">Damit üben</a></div></div>
    <section class="card">
      <div class="table-wrap"><table><tbody>
        <tr><th scope="row">Titel</th><td>${editing ? `<input type="text" id="title" value="${esc(s.title)}">` : esc(s.title)}</td></tr>
        <tr><th scope="row">Herkunft</th><td>${originBadge(s.origin)} ${esc(ORIGIN[s.origin]?.label || s.origin)}${s.kind && KIND_MYKV[s.kind] ? ` · ${KIND_MYKV[s.kind]}` : ''}</td></tr>
        <tr><th scope="row">Fach / Thema</th><td>${editing ? `<select id="topic">${topicOptions}</select>` : `${esc(subjectName(s.subjectId))} · ${esc(tp?.name || '')}`}</td></tr>
        ${s.fileName ? `<tr><th scope="row">Datei</th><td>${esc(s.fileName)}</td></tr>` : ''}
        ${s.link || editing ? `<tr><th scope="row">Link</th><td>${editing ? `<input type="url" id="link" value="${esc(s.link || '')}" placeholder="https://…">` : `<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.link)}</a> <span class="meta">(öffnet myKV, Anmeldung nötig)</span>`}</td></tr>` : ''}
        <tr><th scope="row">Importiert</th><td>${fmtDateTime(s.createdAt)}${s.updatedAt ? ` · bearbeitet ${fmtDateTime(s.updatedAt)}` : ''}</td></tr>
      </tbody></table></div>
    </section>
    <section class="card">${body}
      ${editing ? `<div class="row end" style="margin-top:14px"><a class="btn" href="#/quelle/${id}">Abbrechen</a><button class="btn btn-primary" id="save">Änderungen speichern</button></div>` : ''}
    </section>
    ${editing ? '' : `<p class="no-print"><button class="btn btn-danger btn-small" id="del">Unterlage löschen</button></p>`}`;

  if (query.seite) {
    const target = el.querySelector(`#seite-${CSS.escape(query.seite)}`);
    if (target) setTimeout(() => { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); target.classList.add('highlight'); }, 50);
  }
  if (editing) {
    setLeaveGuard(() => true);
    el.querySelector('#save').addEventListener('click', async () => {
      const title = el.querySelector('#title').value.trim();
      if (!title) return toast('Bitte einen Titel eingeben.', 'error');
      const topicId = el.querySelector('#topic').value;
      const link = el.querySelector('#link')?.value.trim() || '';
      if (link && !/^https?:\/\//i.test(link)) return toast('Der Link muss mit https:// beginnen.', 'error');
      const pageTexts = [...el.querySelectorAll('textarea[data-page]')].map((ta) => [Number(ta.dataset.page), ta.value]);
      const content = el.querySelector('#content')?.value;
      try {
        await commit((d) => {
          const src = d.sources.find((x) => x.id === id);
          src.title = title; src.link = link || null;
          if (topicId !== src.topicId) {
            src.topicId = topicId; src.subjectId = d.topics.find((x) => x.id === topicId).subjectId;
            for (const c of d.cards) if (c.sourceId === id) c.topicId = topicId;
          }
          for (const [n, text] of pageTexts) { const p = src.pages.find((x) => x.n === n); if (p.text !== text) { p.text = text; p.manual = true; } }
          if (content !== undefined) src.content = content;
          src.updatedAt = new Date().toISOString();
        });
        setLeaveGuard(null);
        toast('Unterlage gespeichert.');
        location.hash = `#/quelle/${id}`;
      } catch (e) { toast(e.message, 'error'); }
    });
  } else {
    el.querySelector('#del').addEventListener('click', async () => {
      const cards = db.cards.filter((c) => c.sourceId === id).length;
      if (!(await confirmDialog(`«${s.title}» löschen?${cards ? ` Dazu gehörende ${plural(cards, 'Karteikarte', 'Karteikarten')} werden ebenfalls gelöscht.` : ''} Bereits erstellte Lerninhalte bleiben erhalten, verweisen aber nicht mehr auf diese Unterlage.`, { ok: 'Löschen', danger: true }))) return;
      try {
        await commit((d) => { d.sources = d.sources.filter((x) => x.id !== id); d.cards = d.cards.filter((c) => c.sourceId !== id); });
        toast('Unterlage gelöscht.'); location.hash = `#/thema/${s.topicId}`;
      } catch (e) { toast(e.message, 'error'); }
    });
  }
}

// ---------- Start ----------
(async function init() {
  try {
    await initBackend();
    const user = await currentUser();
    const start = async () => {
      // Konto zuerst bestimmen: noch nicht gespeicherter Lernfortschritt gehört zum jeweiligen Konto
      const u = await currentUser();
      store.user = u;
      await loadAll();
      // Angaben aus der Registrierung einmalig ins Profil übernehmen
      const meta = u?.user_metadata;
      if (meta?.firstName && !store.db.settings.profile) {
        await commit((d) => { d.settings.profile = { firstName: meta.firstName, apprenticeshipYear: meta.apprenticeshipYear || 1, school: meta.school || '' }; }).catch(() => {});
      }
      route();
      // Rückkehr von der Zahlungsseite (Stripe)
      const pay = new URLSearchParams(location.search).get('guthaben');
      if (pay) {
        history.replaceState(null, '', location.pathname + location.hash);
        if (pay === 'ok') {
          toast('Zahlung erfolgreich. Das Guthaben wird gutgeschrieben, sobald Stripe die Zahlung bestätigt (meist wenige Sekunden).');
          if (location.hash.startsWith('#/einstellungen')) {
            const { awaitTopup } = await import('./settings.js');
            awaitTopup(view);
          }
        } else toast('Zahlung abgebrochen. Es wurde nichts belastet.', 'info');
      }
    };
    if (user && isRecovery()) { newPasswordView(view, async () => { await start(); toast('Neues Passwort gespeichert.'); }); return; }
    if (!user) { loginView(view, start, recoveryLinkError()); return; }
    await start();
  } catch (e) {
    view.innerHTML = `<div class="notice notice-bad"><h4>KV-Learn konnte nicht starten.</h4><p>${esc(e.message)}</p><p>${isCloud() ? 'Prüfe deine Internetverbindung' : 'Prüfe, ob der Server läuft (Befehl <code>npm start</code>)'} und lade die Seite neu.</p><button class="btn" onclick="location.reload()">Neu laden</button></div>`;
  }
})();

// Als App installierbar (Startbildschirm, Startmenü): Service Worker registrieren
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* ohne Installierbarkeit weiter nutzbar */ });
}
