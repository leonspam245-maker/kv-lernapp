// End-to-End-Test mit Beispieldaten aus samples/ (eigener Datenordner, echte Daten bleiben unberührt).
// Aufruf: npm run e2e   (benötigt Playwright mit Chromium)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { assertReadable } from './contrast.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); }
catch { ({ chromium, devices } = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'))('playwright')); }

const PORT = 5288;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(ROOT, 'test-data', 'e2e');
const SHOTS = path.join(ROOT, 'screenshots');
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const sample = (f) => path.join(ROOT, 'samples', f);

// Nachgebauter OpenAI-Server: zeichnet auf, mit welchem Schlüssel angefragt wurde
const MOCK_AI_PORT = PORT + 7;
const aiCalls = [];
const mockAi = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => {
    const body = JSON.parse(b || '{}');
    const kind = body.response_format?.json_schema?.name;
    aiCalls.push({ auth: req.headers.authorization, model: body.model, kind, user: body.messages?.[1]?.content });
    const content = kind === 'lernapp_grade'
      ? JSON.stringify({ results: [{ index: 0, points: 1.5, status: 'teilweise', feedback: '[KI-Test] Verbindlich stimmt, es fehlt der Vertragsabschluss.' }] })
      : JSON.stringify({ questions: [
        { type: 'mc', topicId: 'x', prompt: '[KI-Test] Was ist ein Antrag?', options: ['Verbindliches Angebot', 'Unverbindliche Anfrage', 'Rechnung', 'Mahnung'], answer: 0, answerBool: null, pairs: null, model: null, keywords: null, explanation: 'Ein Antrag bindet den Antragsteller.', points: 1, refs: [], uncertain: null },
        { type: 'open', topicId: 'x', prompt: '[KI-Test] Erkläre den Antrag.', options: null, answer: null, answerBool: null, pairs: null, model: 'Ein verbindliches Angebot zum Abschluss eines Vertrags.', keywords: ['verbindlich', 'Angebot', 'Vertrag'], explanation: 'E', points: 2, refs: [], uncertain: null },
      ] });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content, refusal: null } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
});
await new Promise((r) => mockAi.listen(MOCK_AI_PORT, r));

let server;
async function startServer() {
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', OPENAI_BASE_URL: `http://localhost:${MOCK_AI_PORT}/v1` }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/status')).ok) return; } catch { /* warten */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('Server startet nicht');
}
const stopServer = () => new Promise((r) => { server.once('exit', r); server.kill(); });
// Daten des im Test-Browser angemeldeten Kontos (Cookie aus dem Browser übernehmen)
let ctx;
const cookieOf = async (c) => (await c.cookies()).map((x) => `${x.name}=${x.value}`).join('; ');
const state = async (c = ctx) => (await (await fetch(BASE + '/api/state', { headers: { cookie: await cookieOf(c) } })).json()).data;
const EMAIL = 'leon.test@example.ch'; const PW = 'Lernen2026';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['OK  ', name]); console.log('OK   ', name); }
  catch (e) { results.push(['FEHL', name]); console.log('FEHL ', name, '\n     ', e.message.split('\n')[0]); throw e; }
}

await startServer();
const browser = await chromium.launch();
ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const go = async (hash) => { await page.goto(BASE + '/' + hash); await page.waitForSelector('main h1'); };
// Wartet, bis aller Lernfortschritt beim Server gespeichert ist
const settled = (p = page) => p.waitForFunction(() => !Object.keys(localStorage).some((k) => k.startsWith('kv-lernapp:fortschritt:')) && document.querySelector('#save-state')?.dataset.state !== 'saving');
async function answerAny(p, q) {
  if (q.type === 'mc') await p.locator('[data-opt] input').first().check();
  if (q.type === 'tf') await p.locator('[data-opt="true"] input').check();
  if (q.type === 'match') for (let k = 0; k < q.pairs.length; k++) await p.selectOption(`select[name="a-${k}"]`, String(k));
  if (q.type === 'open') await p.fill('textarea[name=a]', q.model);
  await p.click('#check'); await p.waitForSelector('.feedback');
  if (await p.locator('[data-self]').count()) await p.click('[data-self="0"]'); else await p.click('#next');
}
const toastText = async () => (await page.locator('.toast').allTextContents()).join(' | ');
async function chooseTarget(subject, topic) {
  const subj = page.locator('#imp-subject');
  if (!(await subj.locator('option', { hasText: subject }).count())) {
    await subj.selectOption('__new'); await page.fill('#new-subject input', subject); await page.click('#new-subject button');
    await page.waitForFunction((s) => document.querySelector('#imp-subject option:checked')?.textContent === s, subject);
  } else await subj.selectOption({ label: subject });
  const top = page.locator('#imp-topic');
  if (!(await top.locator('option', { hasText: topic }).count())) {
    await top.selectOption('__new'); await page.fill('#new-topic input', topic); await page.click('#new-topic button');
    await page.waitForFunction((t) => document.querySelector('#imp-topic option:checked')?.textContent === t, topic);
  } else await top.selectOption({ label: topic });
}

try {
  // ---------- 0. Anmeldung ----------
  await check('Lokale Anmeldung: ohne Konto keine Daten, Registrierung mit Profil, falsches Passwort abgelehnt', async () => {
    assert.equal((await fetch(BASE + '/api/state')).status, 401, 'API ohne Anmeldung gesperrt');
    assert.equal((await fetch(BASE + '/api/auth/me')).status, 401);
    await page.goto(BASE + '/#/faecher');
    await page.waitForSelector('#auth-form');
    assert.equal(await page.locator('#auth-title').count(), 1, 'Anmeldemaske statt App');
    await page.click('#auth-switch');
    await page.fill('#auth-name', 'Léon'); await page.selectOption('#auth-year', '2');
    await page.fill('#auth-email', EMAIL); await page.fill('#auth-pw', PW); await page.fill('#auth-pw2', PW);
    assert.match(await page.innerText('#auth-form'), /nur auf diesem Computer/);
    await page.click('#auth-submit');
    assert.match(await page.innerText('#auth-form'), /einverstanden/i, 'Einwilligung verlangt');
    await page.check('#auth-consent'); await page.click('#auth-submit');
    await page.waitForSelector('main h1:not(#auth-title)');
    await go('#/');
    assert.match(await page.innerText('main'), /Hallo Léon/);
    const raw = fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8');
    assert.ok(!raw.includes(PW), 'Passwort nicht im Klartext gespeichert');
    // Falsches Passwort und doppelte Adresse
    const bad = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: 'falsch1234' }) });
    assert.equal(bad.status, 401);
    const dup = await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: 'Anderes123' }) });
    assert.equal(dup.status, 409);
    await page.screenshot({ path: path.join(SHOTS, '00-lokal-angemeldet.png'), fullPage: true });
  });

  // ---------- 1. PDF-Import mit gescannter Seite und Texterkennung ----------
  await check('PDF: mehrere Seiten, Scan erkannt, Texterkennung, Speichern', async () => {
    await go('#/import?art=pdf');
    await chooseTarget('W&G', 'Vertragsentstehung');
    await page.setInputFiles('#dz-pdf input[type=file]', sample('beispiel-handout-vertragsrecht.pdf'));
    await page.waitForSelector('[data-page-text="0:2"]');
    assert.equal(await page.locator('.page-review').count(), 3);
    assert.equal(await page.locator('.page-review.scan').count(), 1, 'genau eine Scan-Seite');
    assert.match(await page.locator('.page-review.scan').innerText(), /Kein Text auslesbar/);
    assert.match(await page.inputValue('[data-page-text="0:0"]'), /Antrag: Verbindliches Angebot/);
    await page.click('[data-ocr="0:2"]');
    await page.waitForFunction(() => /Handlungs/.test(document.querySelector('[data-page-text="0:2"]')?.value || ''), null, { timeout: 120000 });
    const ocr = await page.inputValue('[data-page-text="0:2"]');
    assert.match(ocr, /urteilsf/i, 'OCR erkennt Text: ' + ocr.slice(0, 80));
    await page.fill('#ft-0', '[Beispiel] Handout Vertragsrecht');
    await page.screenshot({ path: path.join(SHOTS, '01-pdf-import-pruefen.png'), fullPage: true });
    await page.click('#save');
    await page.waitForURL(/#\/quelle\//);
    assert.match(await page.innerText('main'), /Seite 3/);
    assert.match(await page.innerText('main'), /per Texterkennung/);
    const db = await state();
    assert.equal(db.sources[0].pages.length, 3);
    assert.equal(db.sources[0].origin, 'pdf');
  });

  // ---------- 2. myKV: Fehler beim Speichern lässt Eingaben stehen, dann erfolgreicher Import ----------
  await check('myKV: Text + Link, Eingaben bleiben bei Speicherfehler erhalten', async () => {
    await go('#/import?art=mykv');
    await chooseTarget('W&G', 'Vertragsentstehung');
    const text = fs.readFileSync(sample('beispiel-mykv-lernziele.txt'), 'utf8');
    await page.fill('#mk-title', '[Beispiel] Lernziele Vertragsentstehung');
    await page.fill('#mk-link', 'https://mykv.example/lernziele/42');
    await page.fill('#mk-text', text);
    await page.route('**/api/state', (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
    await page.click('#save');
    await page.waitForSelector('.toast-error');
    assert.match(await toastText(), /Import nicht gespeichert.*Eingaben bleiben erhalten/);
    assert.equal(await page.inputValue('#mk-text'), text, 'Text noch vorhanden');
    await page.unroute('**/api/state');
    await page.reload(); await page.waitForSelector('#mk-text');
    assert.equal(await page.inputValue('#mk-text'), text, 'Entwurf übersteht auch Neuladen');
    await page.click('#save');
    await page.waitForURL(/#\/quelle\//);
    assert.match(await page.innerText('main'), /mykv\.example\/lernziele\/42/);
    assert.match(await page.innerText('main'), /Lernziele/);
  });

  // ---------- 3. Quizlet ----------
  await check('Quizlet: Vorschau, falsche Zeilen markiert und korrigiert, Karten direkt verfügbar', async () => {
    await go('#/import?art=quizlet');
    await chooseTarget('W&G', 'Vertragsarten');
    await page.fill('#ql-title', '[Beispiel] Quizlet: Vertragsarten');
    await page.fill('#ql-raw', fs.readFileSync(sample('beispiel-quizlet.txt'), 'utf8'));
    await page.click('#preview');
    await page.waitForSelector('#ql-preview');
    assert.equal(await page.locator('.preview-table tbody tr').count(), 8);
    assert.equal(await page.locator('.preview-table tr.flag').count(), 2, 'Bindestrich-Zeile und Zeile ohne Trennzeichen');
    await page.screenshot({ path: path.join(SHOTS, '02-quizlet-vorschau.png'), fullPage: true });
    await page.click('#save'); // Zeile 8 ohne Definition → Fehler
    assert.match(await toastText(), /Zeile 8/);
    await page.fill('[data-def="7"]', 'Der Aufbewahrer verpflichtet sich, eine bewegliche Sache sicher aufzubewahren (Art. 472 OR).');
    assert.match(await page.inputValue('[data-def="5"]'), /Arbeitnehmer verpflichtet/);
    await page.click('#save');
    await page.waitForURL(/#\/quelle\//);
    const db = await state();
    assert.equal(db.cards.length, 8);
    assert.ok(db.cards.every((c) => c.due <= new Date().toISOString().slice(0, 10)), 'sofort fällig');
  });

  // ---------- 4. OneNote ----------
  await check('OneNote: eingefügtes HTML behält Überschriften, Listen, Tabelle; Bearbeiten vor Speichern', async () => {
    await go('#/import?art=onenote');
    await chooseTarget('W&G', 'Mängel beim Vertragsabschluss');
    const html = fs.readFileSync(sample('beispiel-onenote.html'), 'utf8').replace('</table>', '<tr><td>Teilnichtigkeit</td><td>nur Teil ungültig</td></tr></table>');
    await page.evaluate((h) => {
      const dt = new DataTransfer(); dt.setData('text/html', h); dt.setData('text/plain', 'x');
      document.querySelector('#paste').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, html.replace('<td>keine</td>', '<td></td>'));
    await page.waitForSelector('#on-md');
    const md = await page.inputValue('#on-md');
    assert.match(md, /^# Mängel beim Vertragsabschluss/m);
    assert.match(md, /^## Willensmängel/m);
    assert.match(md, /^- Wesentlicher Irrtum:/m);
    assert.match(md, /^\| Mangel \| Folge \| Frist \|/m);
    assert.equal(await page.inputValue('#on-title'), 'Mängel beim Vertragsabschluss (Beispiel)');
    assert.match(await page.innerText('#problems'), /Leere Tabellenzelle/, 'schlecht erkannte Stelle markiert');
    assert.match(await page.innerText('#problems'), /Bitte prüfen \(2\)/, 'leere Zelle und unvollständige Zeile');
    await page.fill('#on-md', md.replace('| Nichtigkeit | Vertrag von Anfang an ungültig |  |', '| Nichtigkeit | Vertrag von Anfang an ungültig | keine |')
      .replace('| Teilnichtigkeit | nur Teil ungültig |  |', '| Teilnichtigkeit | nur Teil ungültig | keine |'));
    assert.match(await page.innerText('#problems'), /Keine auffälligen Stellen/);
    await page.screenshot({ path: path.join(SHOTS, '03-onenote-einfuegen.png'), fullPage: true });
    await page.fill('#on-title', '[Beispiel] OneNote: Mängel beim Vertragsabschluss');
    await page.click('#save');
    await page.waitForURL(/#\/quelle\//);
    assert.equal(await page.locator('main table th', { hasText: 'Frist' }).count(), 1);
  });

  // ---------- 5. Merkblatt mit Quellen- und Seitenverweis ----------
  await check('Merkblatt: Definitionen mit Unterlage und PDF-Seite, Lücken sichtbar', async () => {
    const db = await state();
    const topic = db.topics.find((t) => t.name === 'Vertragsentstehung');
    await go(`#/ueben?themen=${topic.id}`);
    await page.click('[data-make="merkblatt"]');
    await page.waitForURL(/#\/inhalt\//);
    const text = await page.innerText('main');
    assert.match(text, /Gestützt auf:/);
    assert.match(text, /Formfreiheit/);
    assert.match(text, /Fehlende Informationen|Lernziele/);
    const ref = page.locator('.def', { hasText: 'Formfreiheit' }).locator('a.ref');
    assert.match(await ref.first().innerText(), /Handout Vertragsrecht · S\. 2/);
    await page.screenshot({ path: path.join(SHOTS, '04-merkblatt.png'), fullPage: true });
    await ref.first().click();
    await page.waitForURL(/seite=2/);
    await page.waitForSelector('#seite-2.highlight');
  });

  // ---------- 6. Quiz-Durchlauf ----------
  await check('Quiz: verschiedene Fragetypen, Lösung und Erklärung nach jeder Antwort, Ergebnis gespeichert', async () => {
    let db = await state();
    const topic = db.topics.find((t) => t.name === 'Vertragsarten');
    await go(`#/ueben?themen=${topic.id}`);
    await page.click('[data-make="quiz"]');
    await page.waitForURL(/#\/inhalt\//);
    db = await state();
    const quiz = db.contents.find((c) => c.type === 'quiz');
    const types = new Set(quiz.data.questions.map((q) => q.type));
    assert.ok(types.size >= 3, 'Fragetypen: ' + [...types]);
    let expected = 0;
    for (const [i, q] of quiz.data.questions.entries()) {
      const right = i % 2 === 0;
      if (q.type === 'mc') { await page.locator('[data-opt] input').nth(right ? q.answer : (q.answer + 1) % q.options.length).check(); if (right) expected += q.points; }
      if (q.type === 'tf') { await page.locator(`[data-opt="${right ? q.answerBool : !q.answerBool}"] input`).check(); if (right) expected += q.points; }
      if (q.type === 'match') { for (let k = 0; k < q.pairs.length; k++) await page.selectOption(`select[name="a-${k}"]`, String(right ? k : (k + 1) % q.pairs.length)); if (right) expected += q.points; }
      if (q.type === 'open') await page.fill('textarea[name=a]', right ? q.model : 'weiss ich nicht');
      if (i === 0) await page.screenshot({ path: path.join(SHOTS, '05-quiz-frage.png'), fullPage: true });
      await page.click('#check');
      await page.waitForSelector('.feedback');
      const fb = await page.innerText('.feedback');
      assert.match(fb, /Quelle:/);
      if (q.type !== 'match') assert.match(fb, /Erklärung:|Musterlösung/);
      if (i === 0) await page.screenshot({ path: path.join(SHOTS, '06-quiz-loesung.png'), fullPage: true });
      if (await page.locator('[data-self]').count()) { await page.click('[data-self="0"]'); }
      else { if (q.type === 'open' && right) expected += q.points; await page.click('#next'); }
    }
    await page.waitForSelector('.result-hero');
    await page.waitForFunction(() => /gespeichert\./.test(document.querySelector('#saved')?.textContent || ''));
    db = await state();
    const att = db.attempts.find((a) => a.contentId === quiz.id);
    assert.equal(att.score, expected);
    assert.ok(att.score < att.max, 'Fehler erfasst');
    await page.screenshot({ path: path.join(SHOTS, '07-quiz-auswertung.png'), fullPage: true });
    await assertReadable(page, 'Quiz-Auswertung');
    await go(`#/thema/${topic.id}`);
    assert.match(await page.innerText('main'), /Hier machst du noch Fehler/);
  });

  // ---------- 7. Probeprüfung ----------
  await check('Probeprüfung: Punkte, Lösungen erst nach Abgabe, offene Antworten selbst bestätigen', async () => {
    const db = await state();
    const topic = db.topics.find((t) => t.name === 'Vertragsarten');
    await go(`#/ueben?themen=${topic.id}`);
    await page.click('[data-make="exam"]');
    await page.waitForURL(/#\/inhalt\//);
    assert.equal(await page.locator('.feedback').count(), 0, 'keine Lösungen vor Abgabe');
    assert.ok(await page.locator('.points').count() > 3);
    await page.locator('textarea').first().fill('Etwas mit Gebrauch');
    await page.click('#submit');
    await page.click('.dialog button[value=yes]');
    await page.waitForSelector('.feedback');
    if (await page.locator('input[id^=pts-]').count()) await page.locator('input[id^=pts-]').first().fill('1');
    await page.click('#finish');
    await page.waitForSelector('.result-hero');
    assert.match(await page.innerText('#result'), /Note ca\./);
    await page.screenshot({ path: path.join(SHOTS, '08-probepruefung-ergebnis.png'), fullPage: true });
    await assertReadable(page, 'Probeprüfung-Ergebnis');
  });

  // ---------- 8. Lernplan ----------
  const todayIso = new Date().toLocaleDateString('sv-SE');
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  await check('Lernplan: gesperrter Tag, schwieriges Thema, Selbsttest, keine Einheit am Sperrtag', async () => {
    await go('#/pruefung/neu');
    await page.fill('#ex-title', '[Beispiel] W&G-Prüfung Vertragsrecht');
    await page.fill('#ex-date', addDays(todayIso, 10));
    for (const box of await page.locator('[data-topic]').all()) await box.check();
    const mängel = (await state()).topics.find((t) => t.name.startsWith('Mängel'));
    await page.check(`[data-hard="${mängel.id}"]`);
    for (let i = 0; i < 7; i++) await page.fill(`#wd-${i}`, i === 6 ? '0' : '40');
    await page.fill('#bl-from', addDays(todayIso, 1));
    await page.selectOption('#bl-reason', 'ÜK');
    await page.click('#bl-add');
    await page.click('#save');
    await page.waitForURL(/#\/pruefung\/p/);
    const ex = (await state()).exams[0];
    const blocked = addDays(todayIso, 1);
    assert.equal(ex.plan.units.filter((u) => u.date === blocked).length, 0);
    assert.match(await page.innerText(`#tag-${blocked}`), /Gesperrt: ÜK/);
    assert.ok(ex.plan.units.some((u) => u.kind === 'selbsttest'));
    assert.ok(ex.plan.units.filter((u) => u.topicId === mängel.id && u.kind === 'wiederholen').length >= 2);
    assert.match(ex.plan.units[0].task, /^\d+ Min\. .+/);
    await page.screenshot({ path: path.join(SHOTS, '09-lernplan.png'), fullPage: true });
  });

  await check('Lernplan: Einheit abhaken, verschieben, neu berechnen – Erledigtes bleibt', async () => {
    const before = (await state()).exams[0];
    const first = before.plan.units.find((u) => u.date === todayIso);
    await page.locator(`.unit[data-unit="${first.id}"] .unit-check`).check();
    await page.waitForFunction((id) => document.querySelector(`.unit[data-unit="${id}"]`)?.classList.contains('done'), first.id);
    const movable = before.plan.units.find((u) => u.kind === 'wiederholen');
    const target = addDays(todayIso, 8);
    await page.click(`[data-move="${movable.id}"]`);
    await page.fill(`#mv-${movable.id}`, target);
    await page.locator(`.unit[data-unit="${movable.id}"] .btn-primary`).click();
    await page.waitForSelector(`#tag-${target} .unit[data-unit="${movable.id}"]`);
    await page.click('#recalc');
    await page.waitForSelector('.toast:has-text("Plan neu berechnet")');
    const after = (await state()).exams[0];
    const doneUnit = after.plan.units.find((u) => u.id === first.id);
    assert.ok(doneUnit?.done, 'erledigte Einheit bleibt erhalten');
    assert.equal(after.plan.units.find((u) => u.id === movable.id)?.date, target, 'verschobene Einheit bleibt');
    assert.ok(after.plan.units.every((u) => u.done || u.date >= todayIso));
    assert.equal(after.plan.units.filter((u) => u.topicId === first.topicId && u.kind === first.kind && u.kind === 'erarbeiten').length, 1, 'kein doppeltes Erarbeiten');
    assert.match(await toastText(), /erledigte Einheit bleibt gespeichert/);
  });

  // ---------- 9. Karteikarten ----------
  await check('Karteikarten: umdrehen, «Gewusst»/«Noch üben», nicht beherrschte kommen früher wieder', async () => {
    const db = await state();
    const topic = db.topics.find((t) => t.name === 'Vertragsarten');
    await go(`#/karten?themen=${topic.id}`);
    const firstTerm = await page.textContent('.face-front .term');
    await page.click('#fc');
    await page.waitForSelector('#rate:not([hidden])');
    await page.screenshot({ path: path.join(SHOTS, '10-karteikarte-rueckseite.png') });
    await page.click('[data-rate="0"]'); // Noch üben
    await page.waitForFunction((t) => document.querySelector('.face-front .term')?.textContent !== t, firstTerm);
    for (let i = 0; i < 3; i++) { await page.click('#fc'); await page.click('[data-rate="1"]'); await page.waitForTimeout(150); }
    assert.equal(await page.textContent('.face-front .term'), firstTerm, '«Noch üben»-Karte kommt nach 3 Karten wieder');
    await settled();
    const after = await state();
    const again = after.cards.find((c) => c.term === firstTerm);
    assert.equal(again.wrong, 1); assert.equal(again.box, 0);
    assert.ok(after.cards.filter((c) => c.box === 1).length >= 3);
  });

  // ---------- 9b. Lernfortschritt geht nie verloren ----------
  await check('Lernfortschritt bleibt: Quiz fortsetzen, Prüfungsantworten zurück, Speichern ohne Verbindung nachgeholt', async () => {
    let db = await state();
    // Quiz nach zwei Fragen abbrechen und nach dem Neuladen fortsetzen
    const quiz = db.contents.find((c) => c.type === 'quiz');
    await go(`#/inhalt/${quiz.id}`);
    for (let i = 0; i < 2; i++) await answerAny(page, quiz.data.questions[i]);
    await page.waitForSelector('.eyebrow:has-text("Frage 3 von")');
    await settled();
    db = await state();
    assert.equal(db.sessions[quiz.id]?.idx, 2, 'Stand nach jeder Frage gespeichert');
    await page.reload(); await page.waitForSelector('#resume');
    assert.match(await page.innerText('main'), /Frage 3 von/);
    await page.click('#resume');
    await page.waitForSelector('.eyebrow:has-text("Frage 3 von")');
    // Probeprüfung: Antwort eintippen, neu laden, Antwort ist wieder da
    const exam = db.contents.find((c) => c.type === 'exam');
    await go(`#/inhalt/${exam.id}`);
    await page.locator('#exam textarea').first().fill('Mein Entwurf zur Aufgabe');
    await page.waitForTimeout(1200); await settled();
    await page.reload(); await page.waitForSelector('#restored');
    assert.equal(await page.locator('#exam textarea').first().inputValue(), 'Mein Entwurf zur Aufgabe');
    // Karteikarte ohne Verbindung bewerten: Bewertung bleibt und wird nach dem Neuladen gespeichert
    const topic = db.topics.find((t) => t.name === 'Vertragsarten');
    await go(`#/karten?themen=${topic.id}&alle=1`);
    const term = await page.textContent('.face-front .term');
    const before = db.cards.find((c) => c.term === term);
    await page.route('**/api/state', (rt) => (rt.request().method() === 'PUT' ? rt.abort() : rt.continue()));
    await page.click('#fc'); await page.click('[data-rate="1"]');
    await page.waitForSelector('#save-state[data-state="offline"]');
    assert.match(await toastText(), /sobald wieder eine Verbindung besteht/);
    assert.equal((await state()).cards.find((c) => c.id === before.id).seen, before.seen, 'Server noch ohne Bewertung');
    await page.unroute('**/api/state');
    await page.reload(); await page.waitForSelector('#fc'); await settled();
    const saved = (await state()).cards.find((c) => c.id === before.id);
    assert.equal(saved.seen, before.seen + 1, 'Bewertung nachträglich gespeichert');
    assert.equal(saved.last, todayIso);
  });

  // ---------- 9c. Eigener KI-Schlüssel ----------
  await check('KI: jede Person nutzt den eigenen Schlüssel; er bleibt im Browser und landet nicht auf dem Server', async () => {
    const KEY = 'sk-test-leon-0123456789abcdefghijKLMN';
    await go('#/einstellungen');
    await page.click('[data-provider="chatgpt"]');
    await page.waitForSelector('#key-form');
    assert.equal(await page.locator('#ai-on').isDisabled(), true, 'ohne Schlüssel nicht aktivierbar');
    await page.fill('#key-input', 'sk-ant-falscher-anbieter-0123456789');
    await page.click('#key-save');
    assert.match(await toastText(), /nicht nach einem OpenAI-Schlüssel/);
    await page.fill('#key-input', KEY); await page.click('#key-save');
    await page.waitForSelector('#key-del');
    const shown = await page.innerText('main');
    assert.ok(!shown.includes(KEY), 'Schlüssel nicht vollständig angezeigt');
    assert.match(shown, /sk-…KLMN/);
    await page.check('#ai-ack'); await page.click('#ai-on');
    await page.waitForSelector('#ai-off');
    const topic = (await state()).topics.find((t) => t.name === 'Vertragsarten');
    await go(`#/ueben?themen=${topic.id}`);
    assert.match(await page.innerText('main'), /an OpenAI übertragen; abgerechnet wird über deinen eigenen Schlüssel/);
    await page.check('input[name=engine][value=ki]');
    await page.click('[data-make="quiz"]');
    await page.click('.dialog button[value=yes]');
    await page.waitForSelector('.question');
    assert.match(await page.innerText('main'), /\[KI-Test\] Was ist ein Antrag/);
    assert.equal(aiCalls.at(-1).auth, `Bearer ${KEY}`, 'Anfrage mit dem eigenen Schlüssel');
    // Offene Frage: die KI bewertet die Antwort
    await page.locator('[data-opt] input').first().check(); await page.click('#check'); await page.click('#next');
    await page.fill('textarea[name=a]', 'Ein verbindliches Angebot');
    await page.click('#check');
    await page.waitForSelector('.feedback:has-text("Bewertung der KI")');
    const fb = await page.innerText('.feedback');
    assert.match(fb, /Teilweise richtig · 1\.5 von 2 P\./);
    assert.match(fb, /es fehlt der Vertragsabschluss/);
    assert.equal(aiCalls.at(-1).kind, 'lernapp_grade');
    assert.match(aiCalls.at(-1).user, /<antwort>Ein verbindliches Angebot<\/antwort>/);
    assert.doesNotMatch(aiCalls.at(-1).user, /Handout|Vertragsentstehung/, 'keine Unterlagen übertragen, nur Frage, Musterlösung und Antwort');
    await assertReadable(page, 'KI-Bewertung');
    await page.click('#next'); await page.waitForSelector('.result-hero');
    await page.waitForFunction(() => /gespeichert\./.test(document.querySelector('#saved')?.textContent || ''));
    const att = (await state()).attempts.at(-1);
    assert.equal(att.score, 2.5, '1 (MC) + 1.5 (KI-Bewertung)');
    // Probeprüfung: offene Antworten nach dem Abgeben von der KI bewertet, Punkte anpassbar
    await go(`#/ueben?themen=${topic.id}`);
    await page.check('input[name=engine][value=ki]');
    await page.click('[data-make="exam"]'); await page.click('.dialog button[value=yes]');
    await page.waitForSelector('#submit');
    await page.locator('#exam input[type=radio]').first().check();
    await page.fill('#exam textarea', 'Ein verbindliches Angebot');
    await page.click('#submit');
    await page.waitForSelector('.feedback:has-text("Bewertung der KI")');
    assert.equal(await page.inputValue('#pts-1'), '1.5', 'Punkte der KI vorgeschlagen');
    assert.match(await page.innerText('[data-q="1"]'), /bei Bedarf anpassen/);
    await page.fill('#pts-1', '2');
    await page.click('#finish'); await page.waitForSelector('#result .result-hero');
    assert.match(await page.innerText('#result'), /3 \/ 3/, 'angepasste Punkte zählen');
    await assertReadable(page, 'Probeprüfung mit KI-Bewertung');
    // Ohne mitgeschickten Schlüssel lehnt der Server ab (kein gemeinsamer Schlüssel)
    const noKey = await fetch(BASE + '/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: await cookieOf(ctx) }, body: JSON.stringify({ type: 'quiz', subjectName: 'W&G', topics: [], sources: [{ id: 's', title: 't', origin: 'x', topicId: 't', content: 'x' }] }) });
    assert.equal(noKey.status, 400);
    assert.match((await noKey.json()).error, /eigener API-Schlüssel/);
    // Schlüssel nirgends auf dem Server gespeichert
    const files = fs.readdirSync(DATA_DIR, { recursive: true }).map(String).filter((f) => f.endsWith('.json'));
    for (const f of files) assert.ok(!fs.readFileSync(path.join(DATA_DIR, f), 'utf8').includes('sk-test-leon'), `Schlüssel in ${f}`);
    await page.screenshot({ path: path.join(SHOTS, '12-ki-eigener-schluessel.png'), fullPage: true });
  });

  // ---------- 10. Wiederöffnen ----------
  await check('Wiederöffnen nach Server-Neustart: Material und Lernfortschritt vorhanden', async () => {
    const before = await state();
    await stopServer(); await startServer();
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: await ctx.storageState() });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE + '/#/'); await p2.waitForSelector('main h1');
    const text = await p2.innerText('main');
    assert.match(text, /Tage bis zur Prüfung/i);
    assert.match(text, /W&G-Prüfung Vertragsrecht/);
    assert.match(text, /\b1 von \d+ Einheiten erledigt/);
    await p2.screenshot({ path: path.join(SHOTS, '11-start-nach-neustart.png'), fullPage: true });
    const after = await state();
    assert.equal(after.sources.length, 4);
    assert.deepEqual(after.cards.map((c) => [c.id, c.box, c.due]), before.cards.map((c) => [c.id, c.box, c.due]));
    assert.equal(after.attempts.length, before.attempts.length);
    await p2.goto(BASE + '/#/faecher'); await p2.waitForSelector('.list-link'); await p2.click('.list-link');
    await p2.waitForSelector('main h2');
    assert.match(await p2.innerText('main'), /Vertragsarten[\s\S]*richtig/);
    await ctx2.close();
  });

  // ---------- 11. Handy ----------
  await check('Handy (iPhone 13): Navigation unten, kein seitliches Scrollen, Karten per Tippen', async () => {
    const m = await browser.newContext({ ...devices['iPhone 13'], storageState: await ctx.storageState() });
    const mp = await m.newPage();
    mp.on('pageerror', (e) => errors.push('mobil: ' + e.message));
    for (const [hash, name] of [['#/', 'start'], ['#/import?art=quizlet', 'import'], ['#/ueben', 'ueben'], ['#/plan', 'plan'], ['#/faecher', 'faecher']]) {
      await mp.goto(BASE + '/' + hash); await mp.waitForSelector('main h1');
      const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${name}: ${overflow}px zu breit`);
      await mp.screenshot({ path: path.join(SHOTS, `mobil-${name}.png`), fullPage: true });
    }
    const navBox = await mp.locator('.nav').boundingBox();
    const vp = mp.viewportSize();
    assert.ok(navBox.y + navBox.height >= vp.height - 1 && navBox.y > vp.height / 2, 'Navigation am unteren Rand');
    const db = await state();
    const ex = db.exams[0];
    await mp.goto(`${BASE}/#/pruefung/${ex.id}`); await mp.waitForSelector('main h1');
    assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Plan passt');
    await mp.screenshot({ path: path.join(SHOTS, 'mobil-lernplan-detail.png'), fullPage: true });
    const topic = db.topics.find((t) => t.name === 'Vertragsarten');
    await mp.goto(`${BASE}/#/karten?themen=${topic.id}&alle=1`); await mp.waitForSelector('#fc');
    await mp.tap('#fc');
    await mp.waitForSelector('#rate:not([hidden])');
    const btn = await mp.locator('[data-rate="1"]').boundingBox();
    assert.ok(btn.height >= 44, 'Tippfläche gross genug');
    await mp.screenshot({ path: path.join(SHOTS, 'mobil-karteikarte.png') });
    const content = db.contents.find((c) => c.type === 'quiz');
    await mp.goto(`${BASE}/#/inhalt/${content.id}`); await mp.waitForSelector('.question, #resume');
    if (await mp.locator('#resume').count()) { await mp.tap('#resume'); await mp.waitForSelector('.question'); }
    assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Quiz passt');
    await mp.screenshot({ path: path.join(SHOTS, 'mobil-quiz.png'), fullPage: true });
    await m.close();
  });

  // ---------- 12. Word-Datei (myKV) ----------
  await check('myKV: Word-Datei (.docx) mit Überschriften, Liste und Tabelle', async () => {
    await go('#/import?art=mykv');
    await chooseTarget('W&G', 'Vertragsentstehung');
    await page.click('[data-mode="file"]');
    await page.selectOption('#mk-kind', 'aufgaben');
    await page.setInputFiles('#dz-mykv input[type=file]', sample('beispiel-mykv-aufgaben.docx'));
    await page.waitForSelector('[data-page-text="0:0"]');
    const md = await page.inputValue('[data-page-text="0:0"]');
    assert.match(md, /^# Aufgaben Vertragsentstehung \(Beispiel\)/m);
    assert.match(md, /^## Begriffe/m);
    assert.match(md, /^- Antrag: Verbindliches Angebot/m);
    assert.match(md, /^\| Formfreiheit \| Reservation per Telefon \|/m);
    assert.match(md, /viaSpluga/);
    await page.fill('#ft-0', '[Beispiel] Aufgaben Vertragsentstehung');
    await page.screenshot({ path: path.join(SHOTS, '12-word-import.png'), fullPage: true });
    await page.click('#save');
    await page.waitForURL(/#\/quelle\//);
    assert.equal(await page.locator('main table th', { hasText: 'Beispiel' }).count(), 1);
    const src = (await state()).sources.find((x) => x.fileName === 'beispiel-mykv-aufgaben.docx');
    assert.equal(src.kind, 'aufgaben'); assert.equal(src.origin, 'mykv'); assert.ok(src.content && !src.pages);
  });

  // ---------- 13. Zwei Geräte ----------
  await check('Zwei Geräte: Änderungen werden zusammengeführt statt überschrieben', async () => {
    const other = await browser.newContext({ ...devices['iPhone 13'], storageState: await ctx.storageState() });
    const phone = await other.newPage();
    await go('#/faecher');
    await phone.goto(BASE + '/#/faecher'); await phone.waitForSelector('#new-subject');
    await page.fill('#new-subject input', 'IKA'); await page.click('#new-subject button');
    await page.waitForURL(/#\/fach\//);
    await phone.fill('#new-subject input', 'Englisch'); await phone.click('#new-subject button'); // Handy kennt «IKA» noch nicht
    await phone.waitForURL(/#\/fach\//);
    await phone.waitForSelector('.toast:has-text("anderen Gerät")');
    const names = (await state()).subjects.map((x) => x.name).sort();
    assert.deepEqual(names, ['Englisch', 'IKA', 'W&G']);
    await go('#/faecher');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForSelector('.list-link:has-text("Englisch")');
    await other.close();
  });

  // ---------- 14. Zweites Konto und Abmelden ----------
  await check('Zweites Konto sieht keine fremden Daten; Abmelden sperrt die App wieder', async () => {
    const c3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p3 = await c3.newPage();
    p3.on('pageerror', (e) => errors.push('konto2: ' + e.message));
    await p3.goto(BASE + '/#/'); await p3.waitForSelector('#auth-form');
    await p3.click('#auth-switch');
    await p3.fill('#auth-name', 'Mia'); await p3.fill('#auth-email', 'mia@example.ch');
    await p3.fill('#auth-pw', 'Zweites123'); await p3.fill('#auth-pw2', 'Zweites123'); await p3.check('#auth-consent');
    await p3.click('#auth-submit'); await p3.waitForSelector('main h1:not(#auth-title)');
    const own = await state(c3);
    assert.equal(own.subjects.length, 0, 'neues Konto startet leer');
    assert.equal((await state()).subjects.length, 3, 'erstes Konto unverändert');
    await p3.goto(BASE + '/#/einstellungen'); await p3.waitForSelector('#logout2');
    await p3.click('[data-provider="chatgpt"]'); await p3.waitForSelector('#key-form');
    assert.equal(await p3.locator('#key-del').count(), 0, 'kein Schlüssel einer anderen Person');
    assert.match(await p3.innerText('main'), /mia@example\.ch/);
    await p3.click('#logout2');
    await p3.waitForSelector('#auth-form');
    assert.equal((await fetch(BASE + '/api/state', { headers: { cookie: await cookieOf(c3) } })).status, 401, 'Sitzung beendet');
    // wieder anmelden
    await p3.fill('#auth-email', 'mia@example.ch'); await p3.fill('#auth-pw', 'Zweites123'); await p3.click('#auth-submit');
    await p3.waitForSelector('main h1:not(#auth-title)');
    await c3.close();
  });

  // ---------- 15. Lesbarkeit ----------
  await check('Lesbarkeit: kein Text mit zu wenig Kontrast (z. B. weiss auf weiss), Computer und Handy', async () => {
    const db = await state();
    const pages = ['#/', '#/faecher', '#/import?art=pdf', '#/import?art=mykv', '#/import?art=quizlet', '#/import?art=onenote', '#/ueben', '#/plan', '#/einstellungen',
      `#/fach/${db.subjects[0].id}`, `#/thema/${db.topics[0].id}`, `#/pruefung/${db.exams[0].id}`, ...db.contents.slice(0, 4).map((c) => `#/inhalt/${c.id}`), `#/karten?themen=${db.cards[0].topicId}&alle=1`];
    const m = await browser.newContext({ ...devices['iPhone 13'], storageState: await ctx.storageState() });
    const mp = await m.newPage();
    for (const p of [page, mp]) {
      for (const h of pages) {
        await p.goto(BASE + '/' + h);
        await p.waitForSelector('main h1', { timeout: 10000 }).catch(() => { throw new Error(`Seite lädt nicht: ${h}`); });
        await assertReadable(p, `${p === page ? 'Computer' : 'Handy'} ${h}`);
      }
      await p.goto(BASE + '/rechtliches.html'); await assertReadable(p, 'Rechtliches');
    }
    // Anmeldeseite (ohne Anmeldung)
    const anon = await browser.newContext(); const ap = await anon.newPage();
    await ap.goto(BASE + '/'); await ap.waitForSelector('#auth-form'); await assertReadable(ap, 'Anmeldung');
    await ap.click('#auth-switch'); await assertReadable(ap, 'Registrierung');
    await anon.close(); await m.close();
  });

  await check('Keine JavaScript-Fehler im Browser', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser.close();
  await stopServer();
  mockAi.close();
  console.log(`\n${results.filter((r) => r[0] === 'OK  ').length}/${results.length} Prüfungen bestanden. Screenshots: screenshots/`);
}
