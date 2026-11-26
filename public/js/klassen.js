// Klassen & Lerngruppen: Klasse erstellen oder per Code beitreten, gemeinsame Ziele, freiwillige Wochen-Rangliste, Klassenordner.
import { store } from './store.js';
import { esc, plural, fmtDate, todayISO, addDays, weekdayIndex } from './util.js';
import { toast, confirmDialog, emptyState } from './ui.js';
import { isCloud, isSchoolMember, listClasses, createClass, joinClass, classDetail, setShareStats, publishStats, addGoal, deleteGoal, removeMember, leaveClass, deleteClass } from './backend.js';

/** ISO-Kalenderwoche, z. B. «2026-W48» */
export function isoWeek(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3); // Donnerstag der Woche
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
/** Eigene Lernleistung der laufenden Woche (ab Montag): wiederholte Karten und Punkte aus Quiz/Prüfungen */
export function weekStats(db, today) {
  const monday = addDays(today, -weekdayIndex(today));
  const cards = db.cards.filter((c) => c.last && c.last >= monday).length;
  const atts = db.attempts.filter((a) => (a.date || '') >= monday);
  return { cards, quiz_points: atts.reduce((s, a) => s + (a.score || 0), 0), quiz_max: atts.reduce((s, a) => s + (a.max || 0), 0) };
}
const score = (s) => (s ? s.cards + Number(s.quiz_points) : 0);

export function klassenView(el, id) {
  if (!isCloud()) { el.innerHTML = `<div class="page-head"><div><h1>Klassen</h1></div></div>${emptyState('Nur online verfügbar', 'Klassen und Lerngruppen gibt es in der Online-Version von KV-Learn unter kv-learn.app.')}`; return; }
  el.innerHTML = '<div class="page-head"><div><h1>Klassen</h1><p>Wird geladen …</p></div></div>';
  (async () => {
    if (!(await isSchoolMember())) { el.innerHTML = `<div class="page-head"><div><h1>Klassen</h1></div></div>${emptyState('Nur mit Schul-E-Mail-Adresse', 'Klassen und Lerngruppen stehen Konten mit bestätigter Schul-E-Mail-Adresse offen.')}`; return; }
    if (id) await detail(el, id); else await overview(el);
  })().catch((e) => {
    el.innerHTML = `<div class="page-head"><div><h1>Klassen</h1></div></div><div class="notice notice-bad"><p>${esc(e.message)}</p><button class="btn" id="retry">Erneut versuchen</button></div>`;
    el.querySelector('#retry').addEventListener('click', () => klassenView(el, id));
  });
}

async function overview(el) {
  const classes = await listClasses();
  el.innerHTML = `
    <div class="page-head"><div><h1>Klassen & Lerngruppen</h1><p>Lernt gemeinsam: Ziele festlegen, Fortschritt vergleichen und Unterlagen im Klassenordner teilen.</p></div></div>
    ${classes.length ? `<section class="card"><h2>Meine Klassen</h2><ul class="list">${classes.map((c) => `<li><a class="list-link" href="#/klassen/${esc(c.id)}"><span><span class="title">${esc(c.name)}</span><br><span class="meta">Code ${esc(c.code)}</span></span><span aria-hidden="true">›</span></a></li>`).join('')}</ul></section>` : ''}
    <div class="grid grid-2">
      <section class="card"><h2>Klasse beitreten</h2><p class="muted small">Den Code bekommst du von der Person, die die Klasse erstellt hat.</p>
        <form id="join" class="inline-new" autocomplete="off"><input type="text" name="code" id="join-code" maxlength="6" placeholder="Code, z. B. K7M2PQ" aria-label="Klassencode" required style="text-transform:uppercase"><button class="btn btn-primary">Beitreten</button></form></section>
      <section class="card"><h2>Neue Klasse erstellen</h2><p class="muted small">Für deine Schulklasse oder eine Lerngruppe. Du erhältst einen Code zum Teilen.</p>
        <form id="create" class="inline-new" autocomplete="off"><input type="text" name="name" id="create-name" maxlength="60" placeholder="z. B. KV Chur 2a" aria-label="Name der Klasse" required><button class="btn">Erstellen</button></form></section>
    </div>
    <p class="small muted">Datenschutz: Andere Mitglieder sehen deinen Vornamen. Deine Lernstatistik erscheint nur, wenn du sie in der Klasse freigibst.</p>`;
  const once = (form, fn) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = form.querySelector('button'); if (b.disabled) return; b.disabled = true;
    try { await fn(); } catch (err) { toast(err.message, 'error'); b.disabled = false; }
  });
  once(el.querySelector('#join'), async () => {
    const code = el.querySelector('#join-code').value.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('Der Code hat 6 Zeichen (Buchstaben und Ziffern).');
    const id = await joinClass(code);
    toast('Willkommen in der Klasse!'); location.hash = `#/klassen/${id}`;
  });
  once(el.querySelector('#create'), async () => {
    const name = el.querySelector('#create-name').value.trim();
    if (!name) throw new Error('Bitte einen Namen eingeben.');
    const r = await createClass(name);
    toast(`Klasse erstellt. Code zum Teilen: ${r.code}`); location.hash = `#/klassen/${r.id}`;
  });
}

async function detail(el, id) {
  const today = todayISO();
  const week = isoWeek(today);
  let d = await classDetail(id, week);
  if (!d.cls) { el.innerHTML = emptyState('Klasse nicht gefunden', 'Du bist kein Mitglied dieser Klasse (mehr).', '<a class="btn" href="#/klassen">Zu den Klassen</a>'); return; }
  // Eigene Wochenstatistik aktualisieren (auch wenn nicht freigegeben: nur du siehst sie)
  try { await publishStats(id, week, weekStats(store.db, today)); d = await classDetail(id, week); } catch { /* Anzeige trotzdem möglich */ }
  const me = d.members.find((m) => m.user_id === d.me);
  const owner = d.cls.owner_id === d.me;
  const statOf = (uid) => d.stats.find((s) => s.user_id === uid);
  const ranking = d.members.filter((m) => m.share_stats || m.user_id === d.me).map((m) => ({ ...m, s: statOf(m.user_id) })).sort((a, b) => score(b.s) - score(a.s));
  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow"><a href="#/klassen">Klassen</a></div><h1>${esc(d.cls.name)}</h1>
      <p>${plural(d.members.length, 'Mitglied', 'Mitglieder')} · Code <strong class="class-code">${esc(d.cls.code)}</strong> <button class="btn btn-small" id="copy">Code kopieren</button></p></div>
      <a class="btn" href="#/ablage/kl/${esc(id)}">Klassenordner</a></div>
    <div class="grid grid-2">
      <section class="card"><div class="tile-head"><h2>Rangliste ${esc(week.replace('-W', ', Woche '))}</h2></div>
        <p class="small muted">Punkte = wiederholte Karten + Punkte aus Quiz und Prüfungen dieser Woche. Freiwillig: Nur wer seine Statistik freigibt, erscheint hier.</p>
        <ol class="ranking">${ranking.map((m, i) => `<li class="${m.user_id === d.me ? 'is-me' : ''}"><span class="rank">${i + 1}</span><span class="who">${esc(m.display_name)}${m.user_id === d.me ? ' (du)' : ''}${m.user_id === d.me && !m.share_stats ? ' <span class="badge">nur für dich sichtbar</span>' : ''}</span><span class="pts">${score(m.s)}</span><span class="detail small muted">${m.s ? `${m.s.cards} Karten · ${m.s.quiz_points}/${m.s.quiz_max} P.` : 'noch nichts'}</span></li>`).join('')}</ol>
        <label class="check"><input type="checkbox" id="share" ${me?.share_stats ? 'checked' : ''}> Meine Wochenstatistik in der Rangliste zeigen</label></section>
      <section class="card"><h2>Gemeinsame Ziele</h2>
        ${d.goals.length ? `<ul class="list goals">${d.goals.map((g) => `<li><div class="row between"><span><strong>${esc(g.title)}</strong>${g.due_date ? `<br><span class="meta">bis ${fmtDate(g.due_date)}${g.due_date < today ? ' · abgelaufen' : ''}</span>` : ''}</span>${g.created_by === d.me || owner ? `<button class="btn-link btn-link-danger" data-goal="${esc(g.id)}">Löschen</button>` : ''}</div></li>`).join('')}</ul>` : '<p class="muted">Noch keine Ziele. Legt fest, was ihr bis wann können wollt.</p>'}
        <form id="goal" autocomplete="off" class="goal-form"><div class="field"><label for="goal-title">Neues Ziel</label><input type="text" id="goal-title" maxlength="140" placeholder="z. B. Kaufvertrag-Quiz mit 80 % lösen"></div>
          <div class="row"><div class="field" style="margin:0"><label for="goal-date">Bis (optional)</label><input type="date" id="goal-date" min="${today}"></div><button class="btn btn-primary" style="align-self:flex-end">Ziel hinzufügen</button></div></form></section>
    </div>
    <section class="card"><h2>Mitglieder</h2><ul class="list">${d.members.sort((a, b) => a.display_name.localeCompare(b.display_name, 'de-CH')).map((m) => `<li><div class="row between"><span>${esc(m.display_name)}${m.role === 'owner' ? ' <span class="badge badge-accent">erstellt</span>' : ''}${m.user_id === d.me ? ' <span class="muted small">(du)</span>' : ''}</span>${owner && m.user_id !== d.me ? `<button class="btn-link btn-link-danger" data-remove="${esc(m.user_id)}" data-name="${esc(m.display_name)}">Entfernen</button>` : ''}</div></li>`).join('')}</ul>
      <div class="row" style="margin-top:12px">${owner ? '<button class="btn btn-danger" id="delete-class">Klasse löschen</button>' : '<button class="btn" id="leave">Klasse verlassen</button>'}</div></section>`;
  const reload = () => detail(el, id).catch((e) => toast(e.message, 'error'));
  el.querySelector('#copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(d.cls.code); toast('Code kopiert.'); } catch { toast(`Code: ${d.cls.code}`, 'info'); } });
  el.querySelector('#share').addEventListener('change', async (e) => { try { await setShareStats(id, e.target.checked); toast(e.target.checked ? 'Deine Statistik ist für die Klasse sichtbar.' : 'Deine Statistik ist nicht mehr sichtbar.'); reload(); } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); } });
  el.querySelector('#goal').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = e.target.querySelector('button'); if (b.disabled) return;
    const title = el.querySelector('#goal-title').value.trim();
    if (!title) { toast('Bitte das Ziel beschreiben.', 'error'); return; }
    b.disabled = true;
    try { await addGoal(id, title, el.querySelector('#goal-date').value); toast('Ziel hinzugefügt.'); reload(); } catch (err) { b.disabled = false; toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-goal]').forEach((b) => b.addEventListener('click', async () => { try { await deleteGoal(b.dataset.goal); reload(); } catch (err) { toast(err.message, 'error'); } }));
  el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog(`${b.dataset.name} aus der Klasse entfernen?`, { ok: 'Entfernen', danger: true }))) return;
    try { await removeMember(id, b.dataset.remove); reload(); } catch (err) { toast(err.message, 'error'); }
  }));
  el.querySelector('#leave')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Klasse verlassen? Du kannst später mit dem Code wieder beitreten.', { ok: 'Verlassen', danger: true }))) return;
    try { await leaveClass(id); toast('Du hast die Klasse verlassen.'); location.hash = '#/klassen'; } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelector('#delete-class')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`«${d.cls.name}» endgültig löschen? Ziele, Statistik und Mitgliedschaften gehen verloren.`, { ok: 'Löschen', danger: true }))) return;
    try { await deleteClass(id); toast('Klasse gelöscht.'); location.hash = '#/klassen'; } catch (err) { toast(err.message, 'error'); }
  });
}
