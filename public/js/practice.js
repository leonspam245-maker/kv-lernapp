// Üben: Lerninhalte erstellen, Merkblatt anzeigen, Karteikarten, Quiz und Probeprüfung.
import { store, commit, saveProgress, byId, subjectName, topicName, sourceTitle, topicsOf } from './store.js';
import { esc, uid, todayISO, fmtDateTime, plural, norm, shuffle } from './util.js';
import { toast, confirmDialog, refChips, originBadge, emptyState, renderMarkdown, progressBar } from './ui.js';
import { buildMerkblatt, buildCards, buildQuestions, grade, swissGrade } from './gen.js';
import { newCard, rateCard, sessionQueue, REINSERT_AFTER } from './srs.js';
import { rerender } from './app.js';
import { accessToken, isCloud } from './backend.js';
import { getAiKey } from './aikeys.js';
import { billingMode, aiAccess, chf } from './billing.js';

const TYPE = { merkblatt: 'Merkblatt', quiz: 'Quiz', exam: 'Probeprüfung' };
/** Gewählter KI-Anbieter: Claude (Anthropic) oder ChatGPT (OpenAI) */
export const AI_PROVIDERS = { claude: { name: 'Claude', company: 'Anthropic' }, chatgpt: { name: 'ChatGPT', company: 'OpenAI' } };
const aiProvider = () => (store.db.settings.aiProvider === 'chatgpt' ? 'chatgpt' : 'claude');
const aiConfigured = (p = aiProvider()) => aiAccess(p); // Guthaben oder eigener Schlüssel dieser Person
const aiReady = () => aiConfigured() && store.db.settings.aiConsent;

// ---------- Auswahl & Erstellung ----------
export function practiceView(el, _id, query) {
  const db = store.db;
  if (!db.subjects.length) { el.innerHTML = emptyState('Noch kein Lernmaterial', 'Importiere zuerst Unterlagen, dann kannst du damit üben.', '<a class="btn btn-primary" href="#/import">Material importieren</a>'); return; }
  const preTopics = query.themen ? query.themen.split(',') : [];
  const subjectId = query.fach || byId('topics', preTopics[0])?.subjectId || db.subjects[0].id;
  const topics = topicsOf(subjectId);
  const selTopics = new Set(preTopics.length ? preTopics.filter((t) => topics.some((x) => x.id === t)) : topics.map((t) => t.id));
  const preSources = query.quellen ? new Set(query.quellen.split(',')) : null;
  const contents = db.contents.filter((c) => c.topicIds.some((t) => topics.some((x) => x.id === t))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const cardCount = db.cards.filter((c) => selTopics.has(c.topicId)).length;

  el.innerHTML = `
    <div class="page-head"><div><h1>Üben</h1><p>Wähle Themen und Unterlagen. Daraus entstehen Merkblatt, Karteikarten, Quiz und Probeprüfung.</p></div>${isCloud() ? '<a class="btn" href="#/pakete">Fertige Lernpakete</a>' : ''}</div>
    <section class="card">
      <div class="field"><label for="pr-subject">Fach</label><select id="pr-subject">${db.subjects.map((s) => `<option value="${s.id}" ${s.id === subjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <fieldset style="border:0;padding:0;margin:0 0 12px"><legend class="eyebrow">Themen</legend>
        ${topics.length ? topics.map((t) => `<label class="check"><input type="checkbox" name="topic" value="${t.id}" ${selTopics.has(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('') : '<p class="muted">In diesem Fach gibt es noch keine Themen.</p>'}
      </fieldset>
      <fieldset style="border:0;padding:0;margin:0"><legend class="eyebrow">Unterlagen</legend><div id="sources"></div></fieldset>
    </section>
    <section class="card">
      <div class="eyebrow">Erstellen mit</div>
      <label class="check"><input type="radio" name="engine" value="lokal" checked> <span><strong>Lokal aus den Unterlagen</strong><br><span class="small muted">Funktioniert ohne Internet. Übernimmt Begriffe, Erklärungen, Tabellen und Beispiele direkt aus den Quellen.</span></span></label>
      <label class="check"><input type="radio" name="engine" value="ki" ${aiReady() ? '' : 'disabled'}> <span><strong>Mit KI (${AI_PROVIDERS[aiProvider()].name})</strong><br><span class="small muted">${aiReady() ? `Formuliert verständlicher und ergänzt gekennzeichnete eigene Beispiele. Die gewählten Unterlagen werden an ${AI_PROVIDERS[aiProvider()].company} übertragen; abgerechnet wird ${billingMode() === 'credit' ? 'über dein Guthaben nach Verbrauch' : 'über deinen eigenen Schlüssel'}.` : 'Nicht aktiviert. Einrichtung und Hinweise unter <a href="#/einstellungen">Einstellungen</a>.'}</span></span></label>
      <div class="grid grid-2" style="margin-top:14px">
        <button class="btn btn-primary" data-make="merkblatt">Merkblatt erstellen</button>
        <button class="btn btn-primary" data-make="cards">Karteikarten erstellen</button>
        <button class="btn btn-primary" data-make="quiz">Quiz starten</button>
        <button class="btn btn-primary" data-make="exam">Probeprüfung erstellen</button>
      </div>
      ${cardCount ? `<p style="margin-top:14px"><a class="btn" href="#/karten?themen=${[...selTopics].join(',')}">Vorhandene Karteikarten üben (${cardCount})</a></p>` : ''}
      <p class="small muted" id="busy" aria-live="polite"></p>
    </section>
    <section class="card"><h2 style="margin-top:0">Erstellte Lerninhalte</h2>
      ${contents.length ? `<ul class="list">${contents.map((c) => `<li><a class="list-link" href="#/inhalt/${c.id}"><span><span class="title">${TYPE[c.type]}: ${esc(c.title)}</span><br><span class="meta">${fmtDateTime(c.createdAt)} · ${c.engine === 'ki' ? 'mit KI erstellt' : 'lokal aus Unterlagen'}${attemptsOf(c.id).length ? ` · ${plural(attemptsOf(c.id).length, 'Durchgang', 'Durchgänge')}` : ''}</span></span><span aria-hidden="true">›</span></a></li>`).join('')}</ul>` : '<p class="muted">Noch keine.</p>'}
    </section>`;

  const renderSources = () => {
    const tids = [...el.querySelectorAll('input[name=topic]:checked')].map((i) => i.value);
    const list = db.sources.filter((s) => tids.includes(s.topicId));
    el.querySelector('#sources').innerHTML = list.length
      ? list.map((s) => `<label class="check"><input type="checkbox" name="source" value="${s.id}" ${!preSources || preSources.has(s.id) ? 'checked' : ''}> <span>${originBadge(s.origin)} ${esc(s.title)} <span class="meta">· ${esc(topicName(s.topicId))}</span></span></label>`).join('')
      : '<p class="muted">Keine Unterlagen in den gewählten Themen. <a href="#/import">Material importieren</a></p>';
  };
  renderSources();
  el.querySelector('#pr-subject').addEventListener('change', (e) => { location.hash = `#/ueben?fach=${e.target.value}`; });
  el.querySelectorAll('input[name=topic]').forEach((cb) => cb.addEventListener('change', renderSources));
  el.querySelectorAll('[data-make]').forEach((b) => b.addEventListener('click', async () => {
    const sources = [...el.querySelectorAll('input[name=source]:checked')].map((i) => byId('sources', i.value));
    const engine = el.querySelector('input[name=engine]:checked').value;
    const busy = el.querySelector('#busy');
    if (!sources.length) return toast('Bitte mindestens eine Unterlage auswählen.', 'error');
    const buttons = el.querySelectorAll('[data-make]');
    buttons.forEach((x) => (x.disabled = true));
    try {
      busy.textContent = engine === 'ki' ? 'KI erstellt Inhalte … das kann bis zu einer Minute dauern.' : 'Wird erstellt …';
      await make(b.dataset.make, sources, engine, subjectId);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy.textContent = '';
      buttons.forEach((x) => (x.disabled = false));
    }
  }));
}

const attemptsOf = (contentId) => store.db.attempts.filter((a) => a.contentId === contentId);

/** KI-Anfrage an den KV-Learn-Server (Guthaben oder eigener Schlüssel). Liefert die Antwort des Servers. */
async function postAi(payload, { quiet = false } = {}) {
  const credit = billingMode() === 'credit';
  const aiKey = credit ? '' : getAiKey(aiProvider());
  if (!credit && !aiKey) throw new Error('Kein eigener API-Schlüssel hinterlegt. Trage ihn unter «Einstellungen» ein.');
  let res;
  try {
    const token = await accessToken();
    res = await fetch('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(aiKey ? { 'X-AI-Key': aiKey } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
  }
  catch { throw new Error('Keine Verbindung zum KV-Learn-Server.'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `KI-Anfrage fehlgeschlagen (${res.status}).`);
  if (body.billing && !quiet) toast(`KI-Kosten: ${chf(body.billing.charged)} · Guthaben: ${chf(body.billing.balance)}`, 'info');
  return body;
}

/** Offene Antworten mit KI bewerten? (KI bewusst aktiviert und Bewertung nicht ausgeschaltet) */
export const aiGrading = () => aiReady() && store.db.settings.aiGrading !== false;
let gradeHint = false;
/**
 * Bewertet offene Antworten mit der KI. items: [{ q, answer }]. Liefert pro Eintrag { status, points, feedback, ai: true }
 * oder null, wenn die KI nicht verfügbar ist (dann gilt die Bewertung über Schlüsselbegriffe).
 */
async function gradeWithAi(items) {
  if (!items.length || !aiGrading()) return items.map(() => null);
  try {
    const body = await postAi({ type: 'grade', items: items.map(({ q, answer }) => ({ prompt: q.prompt, model: q.model || '', keywords: q.keywords || [], answer: String(answer || '').slice(0, 4000), points: q.points })) }, { quiet: true });
    return body.data.results.map((x) => (x.points === null ? null : { status: x.status, points: x.points, feedback: x.feedback, ai: true }));
  } catch (e) {
    if (!gradeHint) { gradeHint = true; toast(`KI-Bewertung nicht möglich: ${e.message} Bewertet wird über Schlüsselbegriffe.`, 'info'); }
    return items.map(() => null);
  }
}

async function callAi(type, sources, subjectId) {
  const topicIds = [...new Set(sources.map((s) => s.topicId))];
  const chars = sources.reduce((n, s) => n + (s.pages?.reduce((m, p) => m + (p.text?.length || 0), 0) || 0) + (s.content?.length || 0) + (s.cards?.reduce((m, c) => m + c.term.length + c.def.length, 0) || 0), 0);
  const ok = await confirmDialog(`${plural(sources.length, 'Unterlage', 'Unterlagen')} (ca. ${chars.toLocaleString('de-CH')} Zeichen) werden an ${AI_PROVIDERS[aiProvider()].name} (${AI_PROVIDERS[aiProvider()].company}) übertragen, um ${TYPE[type] || 'Karteikarten'} zu erstellen.${billingMode() === 'credit' ? ' Die Kosten werden nach Verbrauch von deinem Guthaben abgezogen.' : ''} Lernfortschritt und andere Unterlagen werden nicht übertragen. Fortfahren?`, { ok: 'Übertragen und erstellen' });
  if (!ok) throw new Error('Abgebrochen – es wurde nichts übertragen.');
  const payload = {
    type,
    subjectName: subjectName(subjectId),
    topics: topicIds.map((id) => ({ id, name: topicName(id) })),
    sources: sources.map((s) => ({
      id: s.id, title: s.title, origin: s.origin, topicId: s.topicId,
      pages: s.pages?.filter((p) => p.include !== false && p.text?.trim()).map((p) => ({ n: p.n, text: p.text })),
      content: s.cards?.length ? s.cards.map((c) => `${c.term}: ${c.def}`).join('\n') : s.content,
    })),
  };
  const body = await postAi(payload);

  // Verweise und Themen absichern
  const valid = new Set(sources.map((s) => s.id));
  const fixRefs = (refs) => (refs || []).filter((r) => valid.has(r.sourceId)).map((r) => ({ sourceId: r.sourceId, page: r.page ?? null }));
  const d = body.data;
  if (type === 'merkblatt') {
    d.sections?.forEach((s) => s.items.forEach((i) => { i.refs = fixRefs(i.refs); }));
    ['differences', 'examples'].forEach((k) => d[k]?.forEach((i) => { i.refs = fixRefs(i.refs); }));
    d.conflicts?.forEach((c) => c.variants.forEach((v) => { v.refs = fixRefs(v.refs); }));
    d.goals = []; d.tables = [];
  } else if (type === 'cards') {
    d.cards = d.cards.map((c) => ({ ...c, topicId: topicIds.includes(c.topicId) ? c.topicId : topicIds[0], refs: fixRefs(c.refs) }));
  } else {
    d.questions = d.questions.map((q) => ({
      ...q, id: uid('q'), topicId: topicIds.includes(q.topicId) ? q.topicId : topicIds[0], refs: fixRefs(q.refs),
      points: Math.max(1, q.type === 'match' ? (q.pairs?.length || 1) : q.points || 1),
      answerBool: q.answerBool, rightOrder: q.type === 'match' ? shuffle((q.pairs || []).map((_, i) => i)) : undefined,
    })).filter((q) => (q.type !== 'mc' || (q.options?.length >= 2 && Number.isInteger(q.answer))) && (q.type !== 'match' || q.pairs?.length >= 2));
  }
  return d;
}

async function make(type, sources, engine, subjectId) {
  const db = store.db;
  const topicIds = [...new Set(sources.map((s) => s.topicId))];
  const topicsById = Object.fromEntries(db.topics.map((t) => [t.id, t]));
  const title = topicIds.map(topicName).join(', ');
  const base = { id: uid('i'), type, title, topicIds, sourceIds: sources.map((s) => s.id), engine, createdAt: new Date().toISOString() };

  if (type === 'cards') {
    const proposals = engine === 'ki'
      ? (await callAi('cards', sources, subjectId)).cards.map((c) => ({ topicId: c.topicId, term: c.term, def: c.def, sourceId: c.refs[0]?.sourceId || null, page: c.refs[0]?.page ?? null }))
      : buildCards(sources);
    const t = todayISO();
    const existing = new Set(db.cards.map((c) => c.topicId + '|' + norm(c.term)));
    const fresh = proposals.filter((p) => !existing.has(p.topicId + '|' + norm(p.term)));
    if (!proposals.length) throw new Error('In den ausgewählten Unterlagen wurden keine Begriffe mit Erklärung erkannt. Schreibe Begriffe als «Begriff: Erklärung» oder importiere Quizlet-Karten.');
    if (fresh.length) await commit((d) => d.cards.push(...fresh.map((p) => newCard({ id: uid('c'), ...p, origin: engine }, t))));
    toast(fresh.length ? `${plural(fresh.length, 'neue Karte', 'neue Karten')} erstellt${proposals.length - fresh.length ? `, ${proposals.length - fresh.length} waren schon vorhanden` : ''}.` : 'Alle erkannten Karten sind bereits vorhanden.');
    location.hash = `#/karten?themen=${topicIds.join(',')}&alle=1`;
    return;
  }
  let data;
  if (engine === 'ki') data = await callAi(type, sources, subjectId);
  else if (type === 'merkblatt') data = buildMerkblatt(sources, topicsById);
  else data = { questions: buildQuestions(sources, type, sourceTitle) };
  if (type !== 'merkblatt' && !data.questions?.length) throw new Error('Es konnten keine Fragen erstellt werden.');
  await commit((d) => d.contents.push({ ...base, data }));
  toast(`${TYPE[type]} erstellt.`);
  location.hash = `#/inhalt/${base.id}`;
}

// ---------- Inhalt anzeigen ----------
export function contentView(el, id) {
  const db = store.db;
  const c = byId('contents', id);
  if (!c) { el.innerHTML = emptyState('Lerninhalt nicht gefunden', 'Er wurde vielleicht gelöscht.', '<a class="btn" href="#/ueben">Zum Üben</a>'); return; }
  const sourcesHtml = c.sourceIds.map((sid) => refChips([{ sourceId: sid, page: null }], db)).join(' ');
  const engineNote = c.engine === 'ki'
    ? '<div class="notice notice-warn small">Mit KI erstellt. Prüfe die Aussagen anhand der verlinkten Unterlagen. Eigene Beispiele der KI sind gekennzeichnet.</div>'
    : c.engine === 'paket'
      ? '<div class="notice notice-info small">Aus einem Lernpaket von KV-Learn, abgestimmt auf myKV und den Bildungsplan. Massgebend sind die Unterlagen deiner Schule.</div>'
      : '<div class="notice notice-info small">Lokal aus deinen Unterlagen zusammengestellt. Begriffe und Erklärungen stammen aus den verlinkten Quellen.</div>';
  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">${TYPE[c.type]} · ${c.topicIds.map((t) => `<a href="#/thema/${t}">${esc(topicName(t))}</a>`).join(', ')}</div><h1>${esc(c.title)}</h1>
      <p class="small">Erstellt ${fmtDateTime(c.createdAt)}${c.sourceIds.length ? ` · Gestützt auf: ${sourcesHtml}` : ''}</p></div>
      <div class="row no-print">${c.type === 'merkblatt' ? '<button class="btn" id="print">Drucken / PDF</button>' : ''}<button class="btn btn-danger btn-small" id="del">Löschen</button></div></div>
    ${engineNote}
    <div id="content-body" class="content"></div>`;
  el.querySelector('#print')?.addEventListener('click', () => window.print());
  el.querySelector('#del').addEventListener('click', async () => {
    if (!(await confirmDialog(`${TYPE[c.type]} «${c.title}» löschen? Bisherige Ergebnisse bleiben in der Statistik.`, { ok: 'Löschen', danger: true }))) return;
    try { await commit((d) => { d.contents = d.contents.filter((x) => x.id !== id); }); toast('Gelöscht.'); location.hash = '#/ueben'; } catch (e) { toast(e.message, 'error'); }
  });
  const body = el.querySelector('#content-body');
  if (c.type === 'merkblatt') renderMerkblatt(body, c);
  else if (c.type === 'quiz') startQuiz(body, c);
  else runExam(body, c);
}

function renderMerkblatt(el, c) {
  const db = store.db; const m = c.data;
  el.innerHTML = `
    ${m.gaps?.length ? `<div class="notice notice-warn"><h4>Fehlende Informationen</h4><ul>${m.gaps.map((g) => `<li>${esc(g.text)}${g.refs ? ' ' + refChips(g.refs, db) : ''}</li>`).join('')}</ul></div>` : ''}
    ${m.conflicts?.length ? `<div class="notice notice-warn"><h4>Unterlagen widersprechen sich</h4>${m.conflicts.map((k) => `<p><strong>${esc(k.term)}</strong></p><ul>${k.variants.map((v) => `<li>${esc(v.def)} ${refChips(v.refs, db)}</li>`).join('')}</ul>`).join('')}<p class="small">Kläre den Punkt mit deiner Lehrperson oder im Lehrmittel.</p></div>` : ''}
    ${m.goals?.length ? `<section class="card"><h2 style="margin-top:0">Lernziele</h2><ul>${m.goals.map((g) => `<li>${esc(g.text)} ${refChips(g.refs, db)}</li>`).join('')}</ul></section>` : ''}
    ${(m.sections || []).map((s) => `<section class="card"><h2 style="margin-top:0">${esc(s.heading)}</h2><dl>${s.items.map((i) => `<div class="def ${i.conflict ? 'conflict' : ''}"><dt>${esc(i.term)}${i.conflict ? ' <span class="badge badge-warn">Quellen weichen ab</span>' : ''}</dt><dd>${esc(i.def)}</dd>${refChips(i.refs, db)}</div>`).join('')}</dl></section>`).join('')}
    ${m.tables?.length ? `<section class="card"><h2 style="margin-top:0">Vergleich</h2>${m.tables.map((t) => `${t.heading ? `<h3>${esc(t.heading)}</h3>` : ''}<div class="table-wrap"><table><thead><tr>${t.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${refChips(t.refs, db)}`).join('')}</section>` : ''}
    ${m.differences?.length ? `<section class="card"><h2 style="margin-top:0">Wichtige Unterschiede</h2><ul>${m.differences.map((d) => `<li>${esc(d.text)} ${refChips(d.refs, db)}</li>`).join('')}</ul></section>` : ''}
    ${m.examples?.length ? `<section class="card"><h2 style="margin-top:0">Beispiele</h2><ul>${m.examples.map((x) => `<li>${x.own ? '<span class="badge badge-demo">Eigenes Beispiel (KI)</span> ' : ''}${esc(x.text)} ${x.refs?.length ? refChips(x.refs, db) : ''}</li>`).join('')}</ul></section>` : ''}
    <div class="row no-print"><a class="btn btn-primary" href="#/ueben?themen=${c.topicIds.join(',')}&quellen=${c.sourceIds.join(',')}">Quiz oder Karten dazu erstellen</a></div>`;
}

// ---------- Fragen darstellen ----------
function questionInputHtml(q, name, disabled = false) {
  if (q.type === 'mc') return q.options.map((o, i) => `<label class="option" data-opt="${i}"><input type="radio" name="${name}" value="${i}" ${disabled ? 'disabled' : ''}> <span>${esc(o)}</span></label>`).join('');
  if (q.type === 'tf') return [['true', 'Richtig'], ['false', 'Falsch']].map(([v, l]) => `<label class="option" data-opt="${v}"><input type="radio" name="${name}" value="${v}" ${disabled ? 'disabled' : ''}> <span>${l}</span></label>`).join('');
  if (q.type === 'match') {
    const order = q.rightOrder || q.pairs.map((_, i) => i);
    return q.pairs.map((p, i) => `<div class="match-row" data-match="${i}"><strong>${esc(p.left)}</strong><select name="${name}-${i}" aria-label="Beschreibung für ${esc(p.left)}" ${disabled ? 'disabled' : ''}><option value="">Bitte wählen …</option>${order.map((j) => `<option value="${j}">${esc(q.pairs[j].right)}</option>`).join('')}</select></div>`).join('');
  }
  return `<textarea name="${name}" style="min-height:110px" placeholder="Deine Antwort …" aria-label="Antwort" ${disabled ? 'disabled' : ''}></textarea>`;
}
function fillAnswer(root, q, name, a) {
  if (a === null || a === undefined) return;
  if (q.type === 'mc' || q.type === 'tf') { const i = root.querySelector(`input[name="${name}"][value="${String(a)}"]`); if (i) i.checked = true; }
  else if (q.type === 'match') (a || []).forEach((v, i) => { const sel = root.querySelector(`select[name="${name}-${i}"]`); if (sel && v !== null) sel.value = String(v); });
  else { const t = root.querySelector(`textarea[name="${name}"]`); if (t) t.value = a; }
}
function readAnswer(root, q, name) {
  if (q.type === 'mc') { const v = root.querySelector(`input[name="${name}"]:checked`); return v ? Number(v.value) : null; }
  if (q.type === 'tf') { const v = root.querySelector(`input[name="${name}"]:checked`); return v ? v.value === 'true' : null; }
  if (q.type === 'match') return q.pairs.map((_, i) => { const v = root.querySelector(`select[name="${name}-${i}"]`).value; return v === '' ? null : Number(v); });
  return root.querySelector(`textarea[name="${name}"]`).value;
}
const isEmpty = (q, a) => a === null || a === undefined || (q.type === 'match' ? a.every((x) => x === null) : q.type === 'open' ? !String(a).trim() : false);

function solutionHtml(q, answer, result) {
  const db = store.db;
  let sol = '';
  if (q.type === 'mc') sol = `Richtige Antwort: <strong>${esc(q.options[q.answer])}</strong>`;
  if (q.type === 'tf') sol = `Die Aussage ist <strong>${q.answerBool ? 'richtig' : 'falsch'}</strong>.`;
  if (q.type === 'match') sol = `<ul>${q.pairs.map((p, i) => `<li${answer?.[i] === i ? '' : ' style="color:var(--bad)"'}><strong>${esc(p.left)}</strong> → ${esc(p.right)}</li>`).join('')}</ul>`;
  if (q.type === 'open') sol = `<strong>Musterlösung:</strong> ${esc(q.model)}${result.hits && !result.ai ? `<br><span class="small">Erkannte Schlüsselbegriffe: ${result.hits.length ? esc(result.hits.join(', ')) : 'keine'}${result.missing?.length ? ` · fehlend: ${esc(result.missing.join(', '))}` : ''}</span>` : ''}`;
  const cls = result.status === 'richtig' ? 'ok' : result.status === 'unklar' ? 'unsure' : 'bad';
  const head = { richtig: 'Richtig', falsch: 'Leider falsch', teilweise: 'Teilweise richtig', unklar: 'Nicht eindeutig bewertbar – vergleiche mit der Musterlösung' }[result.status];
  return `<div class="feedback ${cls}"><p><strong>${head}</strong>${q.points ? ` · ${result.points} von ${q.points} P.` : ''}</p><p>${sol}</p>
    ${result.ai ? `<p><strong>Bewertung der KI:</strong> ${esc(result.feedback)}</p>` : ''}
    ${q.explanation && q.type !== 'match' ? `<p class="small"><strong>Erklärung:</strong> ${esc(q.explanation)}</p>` : ''}
    ${q.uncertain ? `<p class="small" style="color:var(--warn)"><strong>Achtung:</strong> ${esc(q.uncertain)}</p>` : ''}
    <p class="small">Quelle: ${refChips(q.refs, db)}</p></div>`;
}
function markOptions(root, q, answer) {
  if (q.type === 'mc' || q.type === 'tf') {
    const correct = q.type === 'mc' ? String(q.answer) : String(q.answerBool);
    root.querySelectorAll('[data-opt]').forEach((o) => {
      if (o.dataset.opt === correct) o.classList.add('correct');
      else if (String(answer) === o.dataset.opt) o.classList.add('wrong');
    });
  }
  if (q.type === 'match') root.querySelectorAll('[data-match]').forEach((r) => r.classList.add(answer?.[Number(r.dataset.match)] === Number(r.dataset.match) ? 'correct' : 'wrong'));
}

function buildAttempt(c, type, items, id = uid('a')) {
  return {
    id, contentId: c.id, type, date: todayISO(), at: new Date().toISOString(),
    score: items.reduce((s, x) => s + x.points, 0), max: items.reduce((s, x) => s + x.maxPoints, 0),
    answers: items.map((x) => ({ qid: x.q.id, topicId: x.q.topicId, prompt: x.q.prompt.split('\n')[0].slice(0, 140), points: x.points, maxPoints: x.maxPoints })),
  };
}
const SAVED_LATER = 'Festgehalten. Gespeichert wird automatisch, sobald wieder eine Verbindung besteht.';

// Angefangenes Quiz fortsetzen oder neu beginnen
function startQuiz(el, c) {
  const s = store.db.sessions[c.id];
  const byQid = new Map(c.data.questions.map((q) => [q.id, q]));
  const valid = s?.kind === 'quiz' && s.order?.every((id) => byQid.has(id)) && s.idx > 0 && s.idx < s.order.length;
  if (!valid) return runQuiz(el, c, c.data.questions);
  el.innerHTML = `<section class="card"><div class="eyebrow">Angefangenes Quiz</div>
    <p><strong>Du warst bei Frage ${s.idx + 1} von ${s.order.length}.</strong> Deine bisherigen ${plural(s.idx, 'Antwort ist', 'Antworten sind')} gespeichert (${fmtDateTime(s.at)}).</p>
    <div class="row"><button class="btn btn-primary" id="resume">Fortsetzen</button><button class="btn" id="restart">Neu beginnen</button></div></section>`;
  el.querySelector('#resume').addEventListener('click', () => runQuiz(el, c, s.order.map((id) => byQid.get(id)), {
    idx: s.idx, results: s.results.filter((r) => byQid.has(r.qid)).map((r) => ({ q: byQid.get(r.qid), points: r.points, maxPoints: byQid.get(r.qid).points })),
  }));
  el.querySelector('#restart').addEventListener('click', () => { saveProgress({ kind: 'session', contentId: c.id, value: null }); runQuiz(el, c, c.data.questions); });
}

// ---------- Quiz ----------
function runQuiz(el, c, questions, resume = null) {
  let idx = resume?.idx || 0; const results = resume?.results || [];
  const step = () => {
    if (idx >= questions.length) return finish();
    const q = questions[idx];
    el.innerHTML = `<section class="card">
      <div class="row between"><span class="eyebrow">Frage ${idx + 1} von ${questions.length} · ${esc(topicName(q.topicId))}</span><span class="badge">${{ mc: 'Multiple Choice', tf: 'Richtig/Falsch', match: 'Zuordnung', open: 'Offene Frage' }[q.type]}</span></div>
      <div class="question"><div class="prompt">${esc(q.prompt)}</div>${questionInputHtml(q, 'a')}</div>
      <div id="fb"></div>
      <div class="row end" id="actions"><button class="btn btn-primary" id="check">Antwort prüfen</button></div></section>`;
    el.querySelector('#check').addEventListener('click', async () => {
      const answer = readAnswer(el, q, 'a');
      if (isEmpty(q, answer)) return toast('Bitte zuerst antworten.', 'error');
      let r = grade(q, answer);
      if (q.type === 'open' && aiGrading()) {
        const btn = el.querySelector('#check'); btn.disabled = true; btn.textContent = 'KI bewertet …';
        el.querySelectorAll('input,select,textarea').forEach((i) => (i.disabled = true));
        r = (await gradeWithAi([{ q, answer }]))[0] || r;
      }
      el.querySelectorAll('input,select,textarea').forEach((i) => (i.disabled = true));
      markOptions(el, q, answer);
      el.querySelector('#fb').innerHTML = solutionHtml(q, answer, r);
      const actions = el.querySelector('#actions');
      const next = (points) => {
        results.push({ q, points, maxPoints: q.points }); idx++;
        // Nach jeder Frage festhalten, damit ein Abbruch nichts verliert
        if (idx < questions.length) saveProgress({ kind: 'session', contentId: c.id, value: { kind: 'quiz', order: questions.map((x) => x.id), idx, results: results.map((x) => ({ qid: x.q.id, points: x.points })), at: new Date().toISOString() } });
        step(); window.scrollTo(0, 0);
      };
      if (q.type === 'open' && r.status === 'unklar') {
        actions.innerHTML = `<span class="small muted" style="flex:1">Wie viele Punkte gibst du dir?</span>${[...Array(q.points + 1).keys()].reverse().map((p) => `<button class="btn ${p === q.points ? 'btn-known' : p === 0 ? 'btn-again' : ''}" data-self="${p}">${p} P.</button>`).join('')}`;
        actions.querySelectorAll('[data-self]').forEach((b) => b.addEventListener('click', () => next(Number(b.dataset.self))));
      } else {
        actions.innerHTML = `<button class="btn btn-primary" id="next">${idx + 1 < questions.length ? 'Nächste Frage' : 'Auswertung'}</button>`;
        actions.querySelector('#next').addEventListener('click', () => next(r.points));
        actions.querySelector('#next').focus();
      }
    });
  };
  const finish = async () => {
    const got = results.reduce((s, r) => s + r.points, 0); const max = results.reduce((s, r) => s + r.maxPoints, 0);
    const wrong = results.filter((r) => r.points < r.maxPoints).map((r) => r.q);
    el.innerHTML = `<section class="card result-hero"><div class="eyebrow">Auswertung</div><div class="big-number">${got} / ${max}</div><p class="muted">Punkte · ${Math.round((got / Math.max(1, max)) * 100)} %</p><p id="saved" class="small muted">Ergebnis wird gespeichert …</p>
      <div class="row" style="justify-content:center">${wrong.length ? '<button class="btn btn-primary" id="retry">Fehler wiederholen</button>' : ''}<button class="btn" id="again">Quiz neu starten</button><a class="btn" href="#/thema/${c.topicIds[0]}">Zum Thema</a></div></section>
      ${wrong.length ? `<section class="card"><h2 style="margin-top:0">Noch üben</h2><ul>${wrong.map((q) => `<li>${esc(q.prompt.split('\n')[0])} ${refChips(q.refs, store.db)}</li>`).join('')}</ul></section>` : ''}`;
    el.querySelector('#again').addEventListener('click', () => runQuiz(el, c, shuffle(c.data.questions)));
    el.querySelector('#retry')?.addEventListener('click', () => runQuiz(el, c, wrong));
    const saved = await saveProgress({ kind: 'attempt', attempt: buildAttempt(c, 'quiz', results) }, { kind: 'session', contentId: c.id, value: null });
    el.querySelector('#saved').textContent = saved ? 'Ergebnis gespeichert. Fehler fliessen in Statistik und Lernplan ein.' : SAVED_LATER;
  };
  step();
}

// ---------- Probeprüfung ----------
function runExam(el, c) {
  clearInterval(el._examTick); // Timer einer früheren Runde beenden
  const qs = c.data.questions;
  const total = qs.reduce((s, q) => s + q.points, 0);
  const minutes = Number(c.data.zeit) || Math.max(10, Math.round(total * 1.5));
  el.innerHTML = `<section class="card"><div class="row between"><div><div class="eyebrow">Probeprüfung</div><strong>${plural(qs.length, 'Aufgabe', 'Aufgaben')} · ${total} Punkte · ${minutes} Min.</strong>${c.data.hilfsmittel ? `<div class="small muted">Hilfsmittel: ${esc(c.data.hilfsmittel)}</div>` : ''}</div>
      <div class="exam-timer" id="timer"><button type="button" class="btn btn-primary" id="timer-start">Mit Timer starten (${minutes} Min.)</button></div></div>
    <p class="small muted" style="margin-top:8px">Die Lösungen erscheinen erst nach dem Abgeben. Mit Timer wird die Prüfung bei Ablauf der Zeit automatisch abgegeben.</p></section>
    ${c.data.intro ? `<section class="card exam-intro"><div class="eyebrow">Ausgangslage und Unterlagen</div><div class="md">${renderMarkdown(c.data.intro)}</div></section>` : ''}
    <form id="exam" novalidate>${qs.map((q, i) => `<section class="card question" data-q="${i}"><span class="points">${q.points} P.</span><div class="eyebrow">Aufgabe ${i + 1}</div><div class="prompt">${esc(q.prompt)}</div>${questionInputHtml(q, `q${i}`)}<div class="sol"></div></section>`).join('')}
    <div class="row end"><button class="btn btn-primary" id="submit">Prüfung abgeben</button></div></form>
    <div id="result"></div>`;
  el.querySelector('#exam').addEventListener('submit', (e) => e.preventDefault());
  // Antworten laufend speichern und beim nächsten Öffnen wiederherstellen
  const draft = store.db.sessions[c.id];
  if (draft?.kind === 'exam' && Array.isArray(draft.answers) && draft.answers.length === qs.length) {
    qs.forEach((q, i) => fillAnswer(el, q, `q${i}`, draft.answers[i]));
    el.querySelector('#exam').insertAdjacentHTML('afterbegin', `<div class="notice notice-info small" id="restored">Deine Antworten vom ${fmtDateTime(draft.at)} wurden wiederhergestellt. <button type="button" class="btn-link" id="clear-draft">Leer neu beginnen</button></div>`);
    el.querySelector('#clear-draft').addEventListener('click', () => { saveProgress({ kind: 'session', contentId: c.id, value: null }); runExam(el, c); });
  }
  let draftTimer = null;
  let endsAt = draft?.kind === 'exam' && draft.endsAt ? draft.endsAt : null;
  let tick = null;
  const saveDraft = () => saveProgress({ kind: 'session', contentId: c.id, value: { kind: 'exam', answers: qs.map((q, i) => readAnswer(el, q, `q${i}`)), at: new Date().toISOString(), endsAt } });
  // Timer: läuft auch nach dem Neuladen weiter (Endzeit im Entwurf); bei Ablauf automatisch abgeben
  const showTimer = () => {
    const box = el.querySelector('#timer');
    if (!box || !endsAt) return;
    const left = Math.max(0, Math.round((new Date(endsAt) - Date.now()) / 1000));
    box.innerHTML = `<span class="timer-clock${left <= 300 ? ' warn' : ''}" role="timer" aria-live="off">${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}</span>`;
    if (left === 0) { clearInterval(tick); tick = null; if (el.querySelector('#submit')) { toast('Die Zeit ist abgelaufen. Die Prüfung wurde abgegeben.', 'info'); submit(true); } }
  };
  const startTimer = () => { clearInterval(tick); clearInterval(el._examTick); showTimer(); tick = el._examTick = setInterval(() => { if (!el.isConnected) { clearInterval(tick); return; } showTimer(); }, 1000); };
  el.querySelector('#timer-start').addEventListener('click', () => { endsAt = new Date(Date.now() + minutes * 60000).toISOString(); saveDraft(); startTimer(); });
  if (endsAt) startTimer();
  const scheduleDraft = () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 700); };
  el.querySelector('#exam').addEventListener('input', scheduleDraft);
  el.querySelector('#exam').addEventListener('change', scheduleDraft);
  el.querySelector('#submit').addEventListener('click', () => submit(false));
  async function submit(force) {
    if (!el.querySelector('#submit') || el.querySelector('#submit').disabled) return;
    const answers = qs.map((q, i) => readAnswer(el, q, `q${i}`));
    const open = answers.filter((a, i) => isEmpty(qs[i], a)).length;
    if (!force && open && !(await confirmDialog(`${plural(open, 'Aufgabe ist', 'Aufgaben sind')} noch nicht beantwortet. Trotzdem abgeben?`, { ok: 'Abgeben' }))) return;
    clearTimeout(draftTimer); clearInterval(tick); tick = null;
    const used = endsAt ? Math.min(minutes * 60, Math.max(0, minutes * 60 - Math.round((new Date(endsAt) - Date.now()) / 1000))) : null;
    if (el.querySelector('#timer')) el.querySelector('#timer').innerHTML = used !== null ? `<span class="small muted">Abgegeben nach ${Math.ceil(used / 60)} Min.</span>` : '';
    const graded = qs.map((q, i) => ({ q, answer: answers[i], r: grade(q, answers[i]) }));
    // Offene Antworten mit KI bewerten (leere Antworten bleiben bei 0 Punkten)
    const openIdx = graded.map((g, i) => (g.q.type === 'open' && !isEmpty(g.q, g.answer) ? i : null)).filter((i) => i !== null);
    if (openIdx.length && aiGrading()) {
      const btn = el.querySelector('#submit'); btn.disabled = true; btn.textContent = 'KI bewertet offene Antworten …';
      const ai = await gradeWithAi(openIdx.map((i) => graded[i]));
      openIdx.forEach((i, k) => { if (ai[k]) graded[i].r = ai[k]; });
    }
    // Ergebnis sofort festhalten (offene Antworten mit dem Vorschlag); bestätigte Punkte ersetzen es danach
    const attemptId = uid('a');
    saveProgress({ kind: 'attempt', attempt: buildAttempt(c, 'exam', graded.map((g) => ({ q: g.q, points: g.r.points, maxPoints: g.q.points })), attemptId) }, { kind: 'session', contentId: c.id, value: null });
    el.querySelectorAll('#exam input, #exam select, #exam textarea').forEach((x) => (x.disabled = true));
    el.querySelector('#submit').remove();
    graded.forEach((g, i) => {
      const box = el.querySelector(`[data-q="${i}"]`);
      markOptions(box, g.q, g.answer);
      box.querySelector('.sol').innerHTML = solutionHtml(g.q, g.answer, g.r) + (g.r.status === 'unklar' || g.r.ai
        ? `<div class="field" style="margin-top:10px"><label for="pts-${i}">${g.r.ai ? `Punkte (${g.q.points} möglich) – bei Bedarf anpassen` : `Punkte selbst bestätigen (0–${g.q.points})`}</label><div class="row"><input type="number" id="pts-${i}" min="0" max="${g.q.points}" step="0.5" value="${g.r.points}" style="max-width:120px"><span class="small muted">${g.r.ai ? `Bewertung der KI: ${g.r.points} P.` : `Vorschlag aufgrund der Schlüsselbegriffe: ${g.r.points} P.`}</span></div></div>` : '');
    });
    const pending = graded.map((g, i) => (g.r.status === 'unklar' ? i : null)).filter((x) => x !== null);
    const res = el.querySelector('#result');
    res.innerHTML = `<section class="card">${pending.length ? `<div class="notice notice-warn">${plural(pending.length, 'offene Antwort konnte', 'offene Antworten konnten')} nicht eindeutig bewertet werden. Vergleiche mit der Musterlösung und bestätige die Punkte.</div>` : ''}
      <button class="btn btn-primary" id="finish">${pending.length ? 'Punkte bestätigen und auswerten' : 'Auswerten und speichern'}</button></section>`;
    res.querySelector('#finish').addEventListener('click', async () => {
      const items = [];
      for (const [i, g] of graded.entries()) {
        let pts = g.r.points;
        if (g.r.status === 'unklar' || g.r.ai) {
          pts = Number(el.querySelector(`#pts-${i}`).value);
          if (Number.isNaN(pts) || pts < 0 || pts > g.q.points) { toast(`Aufgabe ${i + 1}: Bitte Punkte zwischen 0 und ${g.q.points} eingeben.`, 'error'); return; }
          el.querySelector(`#pts-${i}`).disabled = true;
        }
        items.push({ q: g.q, points: pts, maxPoints: g.q.points });
      }
      {
        const att = buildAttempt(c, 'exam', items, attemptId);
        const saved = await saveProgress({ kind: 'attempt', attempt: att });
        const note = swissGrade(att.score, att.max);
        res.innerHTML = `<section class="card result-hero"><div class="eyebrow">Ergebnis</div><div class="big-number">${att.score} / ${att.max}</div>
          <p>Note ca. <strong>${note.toFixed(1)}</strong> <span class="small muted">(Punkte ÷ Maximum × 5 + 1, auf halbe Noten gerundet – deine Schule kann anders rechnen)</span></p>
          <p class="small muted">${saved ? 'Gespeichert. Fehler fliessen in Statistik und Lernplan ein.' : SAVED_LATER}</p>
          <div class="row" style="justify-content:center"><button class="btn" id="again">Erneut lösen</button><a class="btn" href="#/plan">Zum Lernplan</a></div></section>`;
        res.insertAdjacentHTML('beforeend', weaknessHtml(items));
        res.querySelector('#again').addEventListener('click', () => { runExam(el, c); window.scrollTo(0, 0); });
      }
    });
    res.scrollIntoView({ behavior: 'smooth' });
  }
}

/** Auswertung: Themen und Aufgaben mit weniger als der Hälfte der Punkte (Schwächen) */
function weaknessHtml(items) {
  const byTopic = new Map();
  for (const it of items) {
    const t = byTopic.get(it.q.topicId) || { points: 0, max: 0 };
    t.points += it.points; t.max += it.maxPoints; byTopic.set(it.q.topicId, t);
  }
  const weak = items.map((it, i) => ({ ...it, nr: i + 1 })).filter((it) => it.maxPoints && it.points / it.maxPoints < 0.5);
  const topics = [...byTopic].map(([id, t]) => ({ id, name: topicName(id), pct: t.max ? Math.round((t.points / t.max) * 100) : 0 })).sort((a, b) => a.pct - b.pct);
  return `<section class="card exam-analysis"><h2>Auswertung</h2>
    ${topics.length > 1 ? `<h3>Nach Thema</h3><ul class="list">${topics.map((t) => `<li><div class="row between"><a href="#/thema/${t.id}">${esc(t.name)}</a><strong>${t.pct} %</strong></div>${progressBar(t.pct, 100)}</li>`).join('')}</ul>` : ''}
    ${weak.length ? `<h3>Das solltest du repetieren</h3><ul class="list">${weak.map((w) => `<li><span class="badge badge-warn">Aufgabe ${w.nr}</span> ${esc(w.q.prompt.split('\n')[0].slice(0, 140))} <span class="muted small">(${w.points}/${w.maxPoints} P.)</span></li>`).join('')}</ul>
      <div class="row"><a class="btn" href="#/karten?themen=${[...byTopic.keys()].join(',')}">Karteikarten zu diesen Themen</a></div>`
      : '<p>Stark: In keiner Aufgabe weniger als die Hälfte der Punkte.</p>'}</section>`;
}

// ---------- Karteikarten ----------
export function cardsView(el, _id, query) {
  const db = store.db;
  const t = todayISO();
  const topicIds = (query.themen || '').split(',').filter(Boolean);
  const all = db.cards.filter((c) => !topicIds.length || topicIds.includes(c.topicId));
  const onlyDue = query.alle !== '1';
  let queue = sessionQueue(all, t, onlyDue).map((c) => c.id);
  const heading = topicIds.length ? topicIds.map(topicName).join(', ') : 'Alle Themen';
  if (!all.length) { el.innerHTML = emptyState('Keine Karteikarten', 'Importiere Quizlet-Karten oder erstelle Karten unter «Üben».', '<a class="btn btn-primary" href="#/ueben">Zum Üben</a>'); return; }
  if (!queue.length) {
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Karteikarten</div><h1>${esc(heading)}</h1></div></div>` +
      emptyState('Keine Karten fällig', `Alle ${plural(all.length, 'Karte ist', 'Karten sind')} für heute erledigt.`, `<a class="btn btn-primary" href="#/karten?themen=${topicIds.join(',')}&alle=1">Trotzdem alle üben</a>`);
    return;
  }
  const reinserted = new Map(); let known = 0; let again = 0; let flipped = false; let offlineHint = false;
  const show = () => {
    if (!queue.length) {
      const nextDue = db.cards.filter((c) => all.some((a) => a.id === c.id) && c.due > t).map((c) => c.due).sort()[0];
      el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Karteikarten</div><h1>${esc(heading)}</h1></div></div>
        <section class="card result-hero"><div class="eyebrow">Runde beendet</div><div class="big-number">${known}</div><p class="muted">× gewusst · ${again} × noch üben</p>
        ${nextDue ? `<p class="small">Nächste Wiederholung: ${nextDue.split('-').reverse().join('.')}</p>` : ''}
        <div class="row" style="justify-content:center"><a class="btn btn-primary" href="#/">Zur Startseite</a><a class="btn" href="#/ueben?themen=${topicIds.join(',')}">Quiz zu diesen Themen</a></div></section>`;
      return;
    }
    const card = db.cards.find((c) => c.id === queue[0]);
    if (!card) { queue.shift(); return show(); }
    flipped = false;
    const ref = card.sourceId ? refChips([{ sourceId: card.sourceId, page: card.page }], db) : '';
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Karteikarten · ${onlyDue ? 'fällige Karten' : 'alle Karten'}</div><h1>${esc(heading)}</h1></div><span class="muted">noch ${queue.length} in dieser Runde</span></div>
      <div class="flashcard" id="fc" tabindex="0" role="button" aria-label="Karte umdrehen">
        <div class="flashcard-inner">
          <div class="face face-front"><div class="eyebrow">${esc(topicName(card.topicId))}</div><div class="term">${esc(card.term)}</div><span class="face-hint">Tippen oder Leertaste zum Umdrehen</span></div>
          <div class="face face-back"><div class="eyebrow">${esc(card.term)}</div><div class="def-text">${esc(card.def)}</div><div style="margin-top:10px">${ref}</div></div>
        </div></div>
      <div class="rate" id="rate" hidden><button class="btn btn-again" data-rate="0">Noch üben</button><button class="btn btn-known" data-rate="1">Gewusst</button></div>
      <p class="small muted" style="text-align:center">${card.box > 0 ? `Stufe ${card.box} von 5` : 'Neu oder noch nicht beherrscht'}</p>`;
    const fc = el.querySelector('#fc');
    const flip = () => { flipped = !flipped; fc.classList.toggle('flipped', flipped); el.querySelector('#rate').hidden = !flipped; };
    fc.addEventListener('click', (e) => { if (!e.target.closest('a')) flip(); });
    fc.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
    el.querySelectorAll('[data-rate]').forEach((b) => b.addEventListener('click', () => rate(card, b.dataset.rate === '1')));
    fc.focus({ preventScroll: true });
  };
  const rate = async (card, ok) => {
    // Bewertung gilt sofort; ohne Verbindung wird das Speichern automatisch nachgeholt
    saveProgress({ kind: 'card', cardId: card.id, fields: rateCard(card, ok, todayISO()) })
      .then((saved) => { if (!saved && !offlineHint) { offlineHint = true; toast(SAVED_LATER, 'info'); } });
    queue.shift();
    if (ok) known++;
    else {
      again++;
      const n = (reinserted.get(card.id) || 0) + 1; reinserted.set(card.id, n);
      if (n <= 3) queue.splice(Math.min(REINSERT_AFTER, queue.length), 0, card.id);
    }
    show();
  };
  show();
}
