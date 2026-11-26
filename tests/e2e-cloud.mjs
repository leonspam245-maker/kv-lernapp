// Test des Online-Betriebs (Anmeldung, Cloud-Speicher, Konflikte, App-Installation) mit nachgebautem Supabase.
// Aufruf: npm run e2e:cloud
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { assertReadable } from './contrast.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); }
catch { ({ chromium, devices } = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'))('playwright')); }

const PORT = 5289;
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const DATA_DIR = path.join(ROOT, 'test-data', 'cloud');
fs.rmSync(DATA_DIR, { recursive: true, force: true });

const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR, MOCK_SUPABASE: '1', STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: 'whsec_dummy', CREDITS_SERVER_SECRET: 'test', ANTHROPIC_API_KEY: 'sk-ant-betreiber-dummy', OPENAI_API_KEY: '' }, stdio: 'pipe' });
for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/status')).ok) break; } catch { /* warten */ } await new Promise((r) => setTimeout(r, 100)); }

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log('OK   ', name); }
  catch (e) { results.push(false); console.log('FEHL ', name, '\n     ', e.message.split('\n')[0]); throw e; }
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const mockState = (p = page) => p.evaluate(() => JSON.parse(localStorage.getItem('mock-supabase') || 'null'));

try {
  await check('Ohne Anmeldung: Anmeldeseite statt Daten, Navigation ausgeblendet', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('#auth-form');
    assert.equal(await page.locator('.nav').isVisible(), false);
    assert.match(await page.innerText('main'), /Willkommen zurück/i);
    await page.screenshot({ path: path.join(SHOTS, 'cloud-01-anmeldung.png') });
  });

  await check('Konto einrichten: Vorname, Lehrjahr, Schule, Passwort zweimal, Zustimmung; dann direkt in der App mit Begrüssung', async () => {
    await page.click('#auth-switch');
    assert.equal(await page.inputValue('#auth-school'), 'Wirtschaftsschule KV Chur');
    await page.fill('#auth-name', 'Lea');
    await page.selectOption('#auth-year', '2');
    await page.fill('#auth-email', 'lernende@example.ch');
    await page.fill('#auth-pw', 'kurz');
    await page.click('#auth-submit');
    assert.match(await page.innerText('.notice-bad'), /mindestens 8 Zeichen/);
    assert.equal(await page.inputValue('#auth-name'), 'Lea', 'Eingaben bleiben erhalten');
    await page.fill('#auth-pw', 'passwort-ohne-zahl');
    await page.fill('#auth-pw2', 'passwort-ohne-zahl');
    await page.click('#auth-submit');
    assert.match(await page.innerText('.notice-bad'), /eine Zahl/);
    await page.fill('#auth-pw', 'sicheres-passwort1');
    await page.fill('#auth-pw2', 'anderes-passwort1');
    await page.click('#auth-submit');
    assert.match(await page.innerText('.notice-bad'), /stimmen nicht überein/);
    await page.fill('#auth-pw', 'sicheres-passwort1');
    await page.fill('#auth-pw2', 'sicheres-passwort1');
    await page.check('#auth-show');
    assert.equal(await page.getAttribute('#auth-pw', 'type'), 'text', 'Passwort anzeigen');
    await page.click('#auth-submit');
    assert.match(await page.innerText('.notice-bad'), /bestätige/);
    await page.fill('#auth-pw', 'sicheres-passwort1');
    await page.fill('#auth-pw2', 'sicheres-passwort1');
    await page.check('#auth-consent');
    await page.screenshot({ path: path.join(SHOTS, 'cloud-03-registrierung.png'), fullPage: true });
    await page.click('#auth-submit');
    await page.waitForSelector('.home-grid');
    assert.equal(await page.locator('.nav').isVisible(), true);
    assert.match(await page.innerText('.hero-date'), /Hallo Lea\./);
    const st = await mockState();
    assert.deepEqual([st.users[0].user_metadata.firstName, st.users[0].user_metadata.apprenticeshipYear, st.users[0].user_metadata.school], ['Lea', 2, 'Wirtschaftsschule KV Chur']);
    assert.equal(st.rows.u1.data.settings.profile.firstName, 'Lea', 'Profil gespeichert');
  });

  await check('Speichern in der Cloud und Wiederöffnen ohne erneute Anmeldung', async () => {
    await page.goto(BASE + '/#/einstellungen');
    await page.waitForSelector('#demo-add');
    assert.match(await page.innerText('main'), /Rechenzentrum Zürich/);
    await page.click('#demo-add');
    await page.waitForSelector('.hero-num');
    const st = await mockState();
    assert.equal(st.rows.u1.version, 2, 'Profil (1) und Beispieldaten (2) gespeichert');
    assert.equal(st.rows.u1.data.subjects[0].name, 'W&G (Beispiel)');
    await page.reload();
    await page.waitForSelector('.hero-num');
    assert.match(await page.innerText('main'), /Tage bis zur Prüfung/i);
  });

  await check('Abmelden, falsches Passwort, Anmelden: Daten wieder da', async () => {
    await page.goto(BASE + '/#/einstellungen');
    await page.click('#logout');
    await page.waitForSelector('#auth-form');
    await page.fill('#auth-email', 'lernende@example.ch');
    await page.fill('#auth-pw', 'falsches-passwort1');
    await page.click('#auth-submit');
    assert.match(await page.innerText('.notice-bad'), /stimmt nicht/);
    await page.fill('#auth-pw', 'sicheres-passwort1');
    await page.click('#auth-submit');
    await page.waitForSelector('#demo-del'); // bleibt auf der zuletzt geöffneten Seite, Beispieldaten vorhanden
    await page.goto(BASE + '/'); await page.waitForSelector('.hero-num');
  });

  await check('Gelöschtes Konto: gespeicherte Anmeldung gilt nicht mehr, Anmeldeseite erscheint', async () => {
    const ctx3 = await browser.newContext();
    const p3 = await ctx3.newPage();
    await p3.goto(BASE + '/');
    // Konto «weg», aber Anmeldung noch im Browser gespeichert (wie nach dem Löschen in der Datenbank)
    await p3.evaluate((st) => localStorage.setItem('mock-supabase', JSON.stringify({ ...st, users: [], session: { access_token: 'alt', user: { id: 'u9', email: 'weg@example.ch' } } })), await mockState());
    await p3.reload();
    await p3.waitForSelector('#auth-form');
    assert.equal(await p3.locator('.nav').isVisible(), false);
    const after = await p3.evaluate(() => JSON.parse(localStorage.getItem('mock-supabase')).session);
    assert.equal(after, null, 'alte Anmeldung entfernt');
    await ctx3.close();
  });

  await check('Weitere Konten möglich, jedes sieht nur die eigenen Daten', async () => {
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.goto(BASE + '/');
    await p2.evaluate((st) => localStorage.setItem('mock-supabase', JSON.stringify({ ...st, session: null })), await mockState());
    await p2.reload(); await p2.waitForSelector('#auth-form');
    await p2.click('#auth-switch');
    await p2.fill('#auth-name', 'Noah');
    await p2.fill('#auth-email', 'noah@example.ch');
    await p2.fill('#auth-pw', 'anderes-passwort1');
    await p2.fill('#auth-pw2', 'anderes-passwort1');
    await p2.check('#auth-consent');
    await p2.click('#auth-submit');
    await p2.waitForSelector('.home-grid');
    assert.match(await p2.innerText('.hero-date'), /Hallo Noah\./);
    assert.doesNotMatch(await p2.innerText('main'), /W&G-Prüfung Vertragsrecht/, 'keine fremden Daten');
    // Bestehende E-Mail-Adresse mit anderem Passwort
    await p2.evaluate(() => { const s = JSON.parse(localStorage.getItem('mock-supabase')); s.session = null; localStorage.setItem('mock-supabase', JSON.stringify(s)); });
    await p2.reload(); await p2.waitForSelector('#auth-form');
    await p2.click('#auth-switch');
    await p2.fill('#auth-name', 'Doppelt');
    await p2.fill('#auth-email', 'noah@example.ch');
    await p2.fill('#auth-pw', 'drittes-passwort1');
    await p2.fill('#auth-pw2', 'drittes-passwort1');
    await p2.check('#auth-consent');
    await p2.click('#auth-submit');
    // Wie Supabase: kein Hinweis, ob die Adresse schon registriert ist; neutraler Hinweis, kein Zugang
    await p2.waitForSelector('#auth-confirm');
    assert.match(await p2.innerText('#auth-confirm'), /Falls zu noah@example\.ch noch kein Konto besteht/);
    assert.equal((await mockState(p2)).session, null);
    await other.close();
  });

  await check('Zwei Geräte gleichzeitig: Änderungen werden zusammengeführt', async () => {
    const p2 = await ctx.newPage(); // gleiche Anmeldung, älterer Stand
    await p2.goto(BASE + '/#/faecher'); await p2.waitForSelector('#new-subject');
    await page.goto(BASE + '/#/faecher'); await page.waitForSelector('#new-subject');
    await page.fill('#new-subject input', 'IKA'); await page.click('#new-subject button');
    await page.waitForURL(/#\/fach\//);
    await p2.fill('#new-subject input', 'Englisch'); await p2.click('#new-subject button');
    await p2.waitForURL(/#\/fach\//);
    const names = (await mockState()).rows.u1.data.subjects.map((s) => s.name).sort();
    assert.deepEqual(names, ['Englisch', 'IKA', 'W&G (Beispiel)']);
    await p2.close();
  });

  await check('KI-Guthaben: anzeigen, über Stripe aufladen, KI ohne eigenen Schlüssel nutzen und Kosten sehen', async () => {
    await page.goto(BASE + '/#/einstellungen');
    await page.waitForSelector('#credit-balance:not(:has-text("…"))');
    assert.equal(await page.getAttribute('[data-billing="credit"]', 'aria-checked'), 'true', 'Guthaben ist Standard');
    assert.equal(await page.innerText('#credit-balance'), 'CHF 0.00');
    const text = await page.innerText('main');
    assert.match(text, /Anbieterkosten × 3/);
    assert.match(text, /CHF 5\.00 aufladen[\s\S]*CHF 10\.00 aufladen[\s\S]*CHF 20\.00 aufladen/);
    // ChatGPT hat keinen Guthaben-Zugang (kein Schlüssel des Betreibers)
    await page.click('[data-provider="chatgpt"]');
    await page.waitForSelector('.notice-warn:has-text("kein Guthaben-Zugang")');
    await page.click('[data-provider="claude"]');
    await page.waitForSelector('[data-provider="claude"][aria-checked="true"]');
    // Aufladen: Zahlungsseite (nachgebaut), Stripe bestätigt, Rückkehr in die App
    let checkoutBody = null; let checkoutAuth = null;
    await page.route('**/api/credits/checkout', async (rt) => {
      checkoutBody = rt.request().postDataJSON(); checkoutAuth = rt.request().headers().authorization;
      await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('mock-supabase')); s.credits = { u1: { balance: 1000, ledger: [{ kind: 'topup', amount_rappen: 1000, created_at: new Date().toISOString() }] } }; localStorage.setItem('mock-supabase', JSON.stringify(s)); });
      await rt.fulfill({ json: { url: BASE + '/?guthaben=ok#/einstellungen' } });
    });
    assert.equal(await page.locator('[data-pack="1000"]').isDisabled(), true, 'erst nach Zustimmung zu den Bedingungen');
    await page.check('#terms-ok');
    await page.click('[data-pack="1000"]');
    await page.waitForSelector('.toast:has-text("Guthaben gutgeschrieben: jetzt CHF 10.00")', { timeout: 20000 });
    assert.equal(checkoutBody.amount, 1000);
    assert.equal(checkoutBody.termsAccepted, true);
    assert.match(checkoutAuth, /^Bearer /);
    assert.equal(new URL(page.url()).search, '', 'Rückkehr-Hinweis aus der Adresse entfernt');
    assert.match(await page.innerText('#credit-ledger'), /Aufgeladen[\s\S]*\+CHF 10\.00/);
    await page.screenshot({ path: path.join(SHOTS, 'cloud-guthaben.png'), fullPage: true });
    await assertReadable(page, 'Einstellungen mit Guthaben');
    // Aktivieren und eine KI-Erstellung über das Guthaben
    await page.check('#ai-ack'); await page.click('#ai-on'); await page.waitForSelector('#ai-off');
    let aiHeaders = null;
    await page.route('**/api/ai/generate', async (rt) => {
      aiHeaders = rt.request().headers();
      await rt.fulfill({ json: { data: { questions: [{ type: 'mc', topicId: 'x', prompt: '[KI-Test] Frage', options: ['A', 'B'], answer: 0, answerBool: null, pairs: null, model: null, keywords: null, explanation: 'E', points: 1, refs: [], uncertain: null }] }, model: 'claude-opus-5-5', billing: { charged: 23, balance: 977 } } });
    });
    await page.goto(BASE + '/#/ueben'); await page.waitForSelector('[data-make="quiz"]');
    assert.match(await page.innerText('main'), /über dein Guthaben nach Verbrauch/);
    await page.check('input[name=engine][value=ki]');
    await page.click('[data-make="quiz"]');
    assert.match(await page.innerText('.dialog'), /von deinem Guthaben abgezogen/);
    await page.click('.dialog button[value=yes]');
    await page.waitForSelector('.toast:has-text("KI-Kosten: CHF 0.23 · Guthaben: CHF 9.77")');
    assert.equal(aiHeaders['x-ai-key'], undefined, 'kein eigener Schlüssel nötig');
    await page.unroute('**/api/ai/generate'); await page.unroute('**/api/credits/checkout');
  });

  await check('Rechtliches: Impressum, Bedingungen und Datenschutz öffentlich ohne Anmeldung', async () => {
    const p = await (await browser.newContext()).newPage();
    await p.goto(BASE + '/rechtliches.html');
    const t = await p.innerText('main');
    for (const h of ['Impressum', 'Bedingungen für das KI-Guthaben', 'Datenschutzerklärung', 'Rückerstattung', 'Stripe']) assert.ok(t.includes(h), h);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await p.goto(BASE + '/'); await p.waitForSelector('#auth-form');
    assert.equal(await p.locator('a[href="/rechtliches.html"]').count(), 1, 'Link auf der Anmeldeseite');
    await p.context().close();
  });

  await check('Passwort vergessen: Link anfordern, neues Passwort über den Link setzen, geleakte Passwörter abgelehnt', async () => {
    const c = await browser.newContext(); const p = await c.newPage();
    p.on('pageerror', (e) => errors.push('passwort: ' + e.message));
    await p.goto(BASE + '/'); await p.waitForSelector('#auth-form');
    await p.evaluate((st) => localStorage.setItem('mock-supabase', JSON.stringify({ ...st, session: null })), await mockState());
    await p.reload(); await p.waitForSelector('#auth-forgot');
    await p.fill('#auth-email', 'lernende@example.ch');
    await p.click('#auth-forgot');
    assert.equal(await p.inputValue('#auth-email'), 'lernende@example.ch', 'E-Mail übernommen');
    await p.click('#auth-submit');
    await p.waitForSelector('.notice-ok:has-text("ist die E-Mail unterwegs")');
    const resets = (await mockState(p)).resets;
    assert.equal(resets.at(-1).email, 'lernende@example.ch');
    assert.equal(resets.at(-1).redirectTo, BASE + '/', 'Link führt zurück zur App');
    // Link aus der E-Mail öffnen (Supabase setzt die Anmeldung und type=recovery)
    await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('mock-supabase')); const u = s.users.find((x) => x.email === 'lernende@example.ch'); s.session = { access_token: 'reset', user: { id: u.id, email: u.email, user_metadata: u.user_metadata } }; localStorage.setItem('mock-supabase', JSON.stringify(s)); });
    // Dienst für geleakte Passwörter nachbauen: «Passwort123» gilt als geleakt
    await p.route('https://api.pwnedpasswords.com/range/**', async (rt) => {
      const prefix = rt.request().url().split('/').pop();
      const sha = await p.evaluate(async () => { const b = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode('Passwort123'))); return [...b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase(); });
      await rt.fulfill({ body: prefix === sha.slice(0, 5) ? `${sha.slice(5)}:4242\r\n0000000000000000000000000000000000A:1` : '0000000000000000000000000000000000A:1' });
    });
    await p.goto('about:blank'); await p.goto(BASE + '/#access_token=reset&type=recovery'); await p.waitForSelector('#auth-title:has-text("Neues Passwort")');
    assert.equal(new URL(p.url()).hash, '', 'Zugangsdaten aus der Adresse entfernt');
    await p.fill('#auth-pw', 'Passwort123'); await p.fill('#auth-pw2', 'Passwort123'); await p.click('#auth-submit');
    await p.waitForSelector('.notice-bad:has-text("Datenlecks")');
    await p.fill('#auth-pw', 'Neu-und-sicher-2026'); await p.fill('#auth-pw2', 'Neu-und-sicher-2026'); await p.click('#auth-submit');
    await p.waitForSelector('.toast:has-text("Neues Passwort gespeichert")');
    await p.waitForSelector('.home-grid');
    assert.equal((await mockState(p)).users.find((x) => x.email === 'lernende@example.ch').password, 'Neu-und-sicher-2026');
    await assertReadable(p, 'Passwort-Ablauf');
    // Abgelaufener Link: verständliche Meldung auf der Anmeldeseite
    await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('mock-supabase')); s.session = null; localStorage.setItem('mock-supabase', JSON.stringify(s)); });
    await p.goto('about:blank'); await p.goto(BASE + '/#error=access_denied&error_code=otp_expired'); await p.waitForSelector('.notice-bad:has-text("abgelaufen")');
    // Registrierung mit geleaktem Passwort abgelehnt
    await p.click('#auth-switch'); await p.fill('#auth-name', 'Test'); await p.fill('#auth-email', 'leak@example.ch');
    await p.fill('#auth-pw', 'Passwort123'); await p.fill('#auth-pw2', 'Passwort123'); await p.check('#auth-consent'); await p.click('#auth-submit');
    await p.waitForSelector('.notice-bad:has-text("Datenlecks")');
    assert.ok(!(await mockState(p)).users.some((x) => x.email === 'leak@example.ch'), 'kein Konto angelegt');
    await c.close();
  });

  await check('Gemeinsame Ablage: Ordner nach Lehrjahr und HKB, hochladen mit Rechtebestätigung, für andere sichtbar, öffnen, übernehmen, melden, Admin', async () => {
    // Lea (2. Lehrjahr) lädt eine eigene Zusammenfassung hoch
    await page.goto(BASE + '/#/ablage');
    await page.waitForSelector('.ablage-year');
    assert.equal(await page.locator('.ablage-year').count(), 3);
    assert.match(await page.locator('.ablage-year.is-mine').innerText(), /2\. Lehrjahr[\s\S]*Dein Lehrjahr/);
    assert.match(await page.locator('.ablage-year').nth(0).innerText(), /HKB a[\s\S]*HKB e[\s\S]*Wahlpflichtbereich[\s\S]*üK/);
    assert.doesNotMatch(await page.locator('.ablage-year').nth(0).innerText(), /Qualifikationsverfahren/);
    assert.match(await page.locator('.ablage-year').nth(2).innerText(), /Qualifikationsverfahren/);
    assert.equal(await page.locator('.nav a[data-nav=ablage]').getAttribute('class'), 'active');
    await assertReadable(page, 'Ablage Übersicht');
    await page.screenshot({ path: path.join(SHOTS, 'cloud-ablage-1-uebersicht.png'), fullPage: true });
    // Lernfelder als Unterordner, gegliedert wie die Lernmodule in myKV
    assert.match(await page.locator('.ablage-year').nth(2).innerText(), /Option Finanzen[\s\S]*Option Technologie/);
    await page.click('a[href="#/ablage/lj1/hkb-c"]');
    await page.waitForSelector('a[href="#/ablage/lj1/hkb-c-lf4"]');
    assert.match(await page.innerText('main'), /Lernfeld 4[\s\S]*Kaufvertrag[\s\S]*Lernfeld 5[\s\S]*Übergreifend zu HKB c/);
    await page.click('a[href="#/ablage/lj1/hkb-c-lf4"]');
    await page.waitForSelector('.ablage-chips');
    assert.match(await page.textContent('h1'), /HKB c · Lernfeld 4/);
    assert.match(await page.innerText('.ablage-chips'), /Grundlagen des Rechts[\s\S]*Verträge auf Arbeitsleistung/);
    assert.match(await page.innerText('.eyebrow'), /Ablage › 1\. Lehrjahr › HKB c/);
    await page.click('#lib-add');
    assert.equal(await page.inputValue('#lib-folder'), 'lj1/hkb-c-lf4', 'Lernfeld vorausgewählt');
    await assertReadable(page, 'Ablage Lernfeld');
    await page.screenshot({ path: path.join(SHOTS, 'cloud-ablage-0-lernfeld.png'), fullPage: true });
    // Allgemeines mit festen Unterordnern (Probeprüfungen, Formelsammlungen …)
    await page.goto(BASE + '/#/ablage/lj2/allgemein');
    await page.waitForSelector('a[href="#/ablage/lj2/allgemein-pruefungen"]');
    assert.match(await page.innerText('main'), /Unterordner[\s\S]*Probeprüfungen[\s\S]*Formelsammlungen[\s\S]*Lernkarten[\s\S]*Fallstudien/);
    assert.doesNotMatch(await page.innerText('main'), /myKV:/);
    await page.click('a[href="#/ablage/lj2/allgemein-formeln"]');
    await page.waitForFunction(() => /Allgemeines · Formelsammlungen/.test(document.querySelector('h1')?.textContent || ''));
    await page.click('#lib-add');
    assert.equal(await page.inputValue('#lib-folder'), 'lj2/allgemein-formeln');
    await assertReadable(page, 'Ablage Allgemeines');
    await page.goto(BASE + '/#/ablage');
    await page.waitForSelector('.ablage-year');
    await page.click('a[href="#/ablage/lj2/hkb-d"]');
    await page.waitForSelector('#lib-add');
    assert.match(await page.textContent('h1'), /HKB d/);
    assert.match(await page.innerText('main'), /Noch leer/);
    await page.click('#lib-add');
    assert.equal(await page.inputValue('#lib-folder'), 'lj2/hkb-d', 'aktueller Ordner vorausgewählt');
    await page.setInputFiles('#lib-file', { name: 'programm.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
    await page.click('#lib-send');
    assert.match(await page.innerText('#lib-error'), /Format ist nicht erlaubt/);
    await page.setInputFiles('#lib-file', path.join(ROOT, 'samples', 'beispiel-handout-vertragsrecht.pdf'));
    assert.equal(await page.inputValue('#lib-title'), 'beispiel handout vertragsrecht', 'Titel aus Dateiname');
    await page.fill('#lib-title', 'Zusammenfassung Vertragsrecht');
    await page.fill('#lib-desc', 'Antrag, Annahme und Fristen – selbst erstellt.');
    await page.click('#lib-send');
    assert.match(await page.innerText('#lib-error'), /bestätige, dass du diese Datei teilen darfst/);
    await assertReadable(page, 'Ablage Hochladen');
    assert.match(await page.innerText('#lib-fname'), /beispiel-handout-vertragsrecht\.pdf \(\d+ KB\)/);
    await page.screenshot({ path: path.join(SHOTS, 'cloud-ablage-2-hochladen.png'), fullPage: true });
    await page.check('#lib-rights');
    await page.click('#lib-send');
    await page.waitForSelector('.ablage-items li');
    const row = await page.innerText('.ablage-items li');
    assert.match(row, /Zusammenfassung Vertragsrecht[\s\S]*selbst erstellt[\s\S]*PDF · \d+ KB · von Lea \(du\)/);
    assert.equal(await page.locator('.ablage-items [data-act=report]').count(), 0, 'eigene Einträge nicht meldbar');
    assert.equal(await page.locator('.ablage-items [data-act=delete]').count(), 1, 'eigene Einträge löschbar');
    const stored = await mockState();
    assert.equal(stored.items.length, 1);
    assert.match(stored.items[0].file_path, new RegExp(`^${stored.session.user.id}/`), 'Datei im eigenen Ordner');
    assert.ok(stored.items[0].rights_confirmed_at, 'Rechtebestätigung gespeichert');
    await assertReadable(page, 'Ablage Ordner');

    // Mia (anderes Konto) sieht die Datei, öffnet sie, übernimmt sie und meldet sie
    const all = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('mock-')).map((k) => [k, localStorage.getItem(k)])));
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(BASE + '/');
    await p2.evaluate((ls) => { for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); const s = JSON.parse(ls['mock-supabase']); s.session = null; localStorage.setItem('mock-supabase', JSON.stringify(s)); }, all);
    await p2.reload(); await p2.waitForSelector('#auth-form');
    await p2.click('#auth-switch');
    await p2.fill('#auth-name', 'Mia'); await p2.selectOption('#auth-year', '1');
    await p2.fill('#auth-email', 'mia@example.ch');
    await p2.fill('#auth-pw', 'mia-passwort-77'); await p2.fill('#auth-pw2', 'mia-passwort-77');
    await p2.check('#auth-consent'); await p2.click('#auth-submit');
    await p2.waitForSelector('.home-grid');
    await p2.goto(BASE + '/#/ablage'); await p2.waitForSelector('.ablage-year');
    assert.match(await p2.locator('.ablage-year.is-mine').innerText(), /1\. Lehrjahr/);
    assert.match(await p2.locator('.ablage-year').nth(1).innerText(), /1 Datei/);
    await p2.fill('#lib-q', 'vertragsrecht');
    await p2.waitForSelector('#lib-results .ablage-items li');
    assert.match(await p2.innerText('#lib-results'), /1 Treffer[\s\S]*2\. Lehrjahr · HKB d[\s\S]*von Lea/);
    await p2.fill('#lib-q', 'gibtsnicht');
    assert.match(await p2.innerText('#lib-results'), /Nichts gefunden/);
    await p2.goto(BASE + '/#/ablage/lj2/hkb-d'); await p2.waitForSelector('.ablage-items li');
    assert.equal(await p2.locator('[data-act=delete]').count(), 0, 'fremde Einträge nicht löschbar');
    // Öffnen: neues Fenster erhält einen kurzlebigen Link (PDF-Anzeige gibt es im Testbrowser nicht, daher Fenster nachgebildet)
    await p2.evaluate(() => { window.__opened = []; window.open = () => { const loc = {}; Object.defineProperty(loc, 'href', { set: (v) => window.__opened.push(v) }); return { opener: 1, close() {}, location: loc }; }; });
    await p2.click('[data-act=open]');
    await p2.waitForFunction(() => window.__opened.length === 1);
    const blob = await p2.evaluate(async () => { const r = await fetch(window.__opened[0]); return { type: r.headers.get('content-type') || (await r.blob()).type, size: (await r.clone().arrayBuffer()).byteLength }; });
    assert.ok(blob.size > 1000, 'Datei ist abrufbar');
    await p2.click('[data-act=report]');
    await p2.check('input[name=reason] >> nth=0');
    await p2.fill('.ablage-report-form input[name=note]', 'Test');
    await p2.click('.ablage-report-form .btn-primary');
    await p2.waitForSelector('text=Danke, die Meldung ist eingegangen.');
    await p2.click('[data-act=report]'); await p2.click('[data-act=report]');
    await p2.click('.ablage-report-form .btn-primary');
    await p2.waitForSelector('.toast:has-text("bereits gemeldet")');
    assert.equal((await mockState(p2)).reports.length, 1);
    await p2.click('[data-act=import]');
    await p2.waitForURL(/#\/import$/);
    await p2.waitForSelector('[data-page-text="0:0"]');
    assert.match(await p2.inputValue('[data-page-text="0:0"]'), /Antrag/, 'PDF aus der Ablage im Import eingelesen');
    assert.equal(await p2.getAttribute('[data-tab=pdf]', 'aria-selected'), 'true');

    // Betreiber (Admin) kann ausblenden und löschen
    await p2.evaluate(() => { const s = JSON.parse(localStorage.getItem('mock-supabase')); s.admin = s.session.user.id; localStorage.setItem('mock-supabase', JSON.stringify(s)); });
    p2.once('dialog', () => {});
    await p2.goto(BASE + '/#/ablage/lj2/hkb-d'); await p2.reload(); await p2.waitForSelector('.ablage-items li');
    assert.match(await p2.innerText('.ablage-items li'), /1 Meldung/);
    await p2.click('[data-act=hide]');
    await p2.waitForSelector('.badge-warn:has-text("Ausgeblendet")');
    await assertReadable(p2, 'Ablage Admin');
    await p2.click('[data-act=delete]');
    await p2.click('dialog [value=yes]');
    await p2.waitForSelector('text=Noch leer');
    const end = await mockState(p2);
    assert.equal(end.items.length, 0);
    assert.equal(await p2.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mock-file:')).length), 0, 'Datei mitgelöscht');
    await c2.close();
    // Handy: Ablage mit Eintrag passt ohne seitliches Scrollen, Navigation mit sieben Punkten bleibt lesbar
    const m = await browser.newContext({ ...devices['iPhone 13'] });
    const mp = await m.newPage();
    await mp.goto(BASE + '/');
    await mp.evaluate((ls) => { for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }, all);
    await mp.goto(BASE + '/#/ablage/lj2/hkb-d'); await mp.reload(); await mp.waitForSelector('.ablage-items li');
    assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'kein seitliches Scrollen');
    const cut = await mp.evaluate(() => [...document.querySelectorAll('.nav a span')].filter((s) => s.offsetParent && s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent));
    assert.deepEqual(cut, [], 'Navigationstexte nicht abgeschnitten');
    await assertReadable(mp, 'Ablage Handy');
    await mp.screenshot({ path: path.join(SHOTS, 'cloud-ablage-3-handy.png'), fullPage: true });
    await m.close();
  });

  await check('Lernpakete übernehmen und digitale Probeprüfung mit Timer, Auto-Abgabe, Note und Auswertung', async () => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.clock.install();
    await p.goto(BASE + '/');
    const all = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('mock-supabase')).map((k) => [k, localStorage.getItem(k)])));
    const modul = { id: 'lj2-hkb-c-lf3-verkaufskalkulation', kategorie: 'modul', year: 'lj2', hkb: 'hkb-c', lf: 'lf3', title: 'Verkaufskalkulation', subject: 'HKB c · 2. Lehrjahr', topic: 'Verkaufskalkulation',
      sources: [{ title: 'Merkblatt: Verkaufskalkulation', content: '## Kalkulationsschema\n| Position | CHF |\n| --- | --- |\n| Einstandspreis | 200.00 |' }],
      cards: [{ term: 'Selbstkosten', def: 'Einstandspreis plus Gemeinkosten' }, { term: 'Nettoerlös', def: 'Selbstkosten plus Reingewinn' }],
      contents: [{ type: 'quiz', title: 'Übung: Verkaufskalkulation', data: { questions: [{ type: 'open', points: 2, prompt: 'Was sind Selbstkosten?', model: 'Einstandspreis plus Gemeinkosten', keywords: [] }] } }] };
    const pruef = { id: 'lj2-allg-pruefungen-hkb-c-sem1', kategorie: 'pruefung', art: 'Probeprüfung', year: 'lj2', hkb: 'hkb-c', title: 'Probeprüfung HKB c – 1. Semester', subject: 'Allgemeines · 2. Lehrjahr', topic: 'Probeprüfung HKB c – 1. Semester', sources: [], cards: [],
      contents: [{ type: 'exam', title: 'Probeprüfung HKB c – 1. Semester', data: { zeit: 1, hilfsmittel: 'Taschenrechner', intro: '## Ausgangslage\nDu arbeitest im **Tourismusbüro**.', questions: [
        { type: 'open', points: 2, prompt: 'Nenne die Formel für die Selbstkosten.', model: 'Einstandspreis plus Gemeinkosten', keywords: [] },
        { type: 'open', points: 4, prompt: 'Berechne den Bruttogewinn.\na) Einstandspreis 200\nb) Nettoerlös 330', model: 'Bruttogewinn = 330 − 200 = CHF 130', keywords: [] }] } }] };
    const index = { version: 't', pakete: [modul, pruef].map((x) => ({ id: x.id, kategorie: x.kategorie, art: x.art || '', year: x.year, hkb: x.hkb, lf: x.lf || null, title: x.title, hkbLabel: 'HKB c', lfLabel: x.lf ? 'Lernfeld 3' : '', cards: x.cards.length, questions: x.contents.reduce((s, y) => s + y.data.questions.length, 0), sources: x.sources.length, exam: x.kategorie === 'pruefung' })) };
    await p.evaluate(({ ls, files }) => { for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); for (const [k, v] of Object.entries(files)) localStorage.setItem('mock-paket:' + k, JSON.stringify(v)); },
      { ls: all, files: { 'index.json': index, [modul.id + '.json']: modul, [pruef.id + '.json']: pruef } });
    await p.goto(BASE + '/#/faecher'); await p.reload();
    await p.waitForSelector('a[href="#/pakete"]');
    await p.click('a[href="#/pakete"]');
    await p.waitForSelector('.pakete-gruppe');
    assert.equal(await p.getAttribute('[data-year="lj2"]', 'aria-selected'), 'true', 'eigenes Lehrjahr vorgewählt');
    assert.match(await p.innerText('main'), /HKB c · Lernfeld 3[\s\S]*Verkaufskalkulation[\s\S]*Merkblatt · 2 Karten · 1 Aufgabe/);
    await p.click('[data-kat="pruefung"]');
    assert.doesNotMatch(await p.innerText('main'), /Verkaufskalkulation\n/);
    await p.click('[data-kat="alle"]');
    await p.fill('#pk-q', 'kalkulation');
    assert.equal(await p.locator('input[data-id]').count(), 1, 'Suche filtert');
    await p.fill('#pk-q', '');
    await assertReadable(p, 'Lernpakete');
    await p.screenshot({ path: path.join(SHOTS, 'cloud-pakete.png'), fullPage: true });
    await p.locator('[data-all]').nth(0).click(); await p.locator('[data-all]').nth(1).click();
    assert.match(await p.innerText('#pk-count'), /2 Pakete ausgewählt/);
    await p.click('#pk-go');
    await p.waitForSelector('.toast:has-text("übernommen")');
    assert.equal(await p.locator('.badge-ok:has-text("übernommen")').count(), 2);
    const data = (await mockState(p)).rows[(await mockState(p)).session.user.id].data;
    assert.ok(data.subjects.some((x) => x.name === 'HKB c · 2. Lehrjahr'));
    assert.equal(data.cards.filter((x) => x.paketId === modul.id).length, 2);
    const exam = data.contents.find((x) => x.paketId === pruef.id);
    assert.equal(exam.type, 'exam');
    // Digitale Probeprüfung
    await p.goto(BASE + '/#/inhalt/' + exam.id);
    await p.waitForSelector('#timer-start');
    assert.match(await p.innerText('main'), /Hilfsmittel: Taschenrechner[\s\S]*Ausgangslage[\s\S]*Tourismusbüro/);
    await p.fill('[data-q="0"] textarea', 'Einstandspreis plus Gemeinkosten');
    await p.click('#timer-start');
    await p.waitForSelector('.timer-clock');
    assert.match(await p.innerText('.timer-clock'), /0[01]:\d\d/);
    await assertReadable(p, 'Prüfung mit Timer');
    await p.clock.fastForward('01:05');
    await p.waitForSelector('#finish');
    assert.match(await p.innerText('main'), /Abgegeben nach 1 Min\./);
    await p.click('#finish');
    await p.waitForSelector('.exam-analysis');
    assert.match(await p.innerText('.result-hero'), /\/ 6[\s\S]*Note ca\./);
    assert.match(await p.innerText('.exam-analysis'), /repetieren[\s\S]*Aufgabe 2/);
    await assertReadable(p, 'Prüfungsauswertung');
    await p.screenshot({ path: path.join(SHOTS, 'cloud-pruefung.png'), fullPage: true });
    await c.close();
  });

  await check('Schul-E-Mail-Adresse: Registrierung nur mit @stud.kvchur.ch, Bestätigung per E-Mail, Ablage nur für Schulkonten', async () => {
    const c = await browser.newContext(); const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(BASE + '/');
    // Bisherige Konten übernehmen (Lea mit example.ch-Adresse), dann Schul-Domain und E-Mail-Bestätigung einschalten
    await p.evaluate((st) => localStorage.setItem('mock-supabase', JSON.stringify({ ...st, session: null, config: { domains: ['stud.kvchur.ch'], confirm: true } })), await mockState());
    await p.reload(); await p.waitForSelector('#auth-form');
    await p.click('#auth-switch');
    assert.match(await p.innerText('label[for=auth-email]'), /Schul-E-Mail-Adresse/i);
    await p.waitForFunction(() => /@stud\.kvchur\.ch/.test(document.querySelector('#auth-email-hint')?.textContent || ''));
    await p.fill('#auth-name', 'Sara');
    await p.fill('#auth-email', 'sara@gmail.com');
    await p.fill('#auth-pw', 'schul-passwort-9'); await p.fill('#auth-pw2', 'schul-passwort-9');
    await p.check('#auth-consent'); await p.click('#auth-submit');
    assert.match(await p.innerText('.notice-bad'), /nur mit deiner Schul-E-Mail-Adresse \(@stud\.kvchur\.ch\)/);
    await assertReadable(p, 'Registrierung Schuladresse');
    await p.screenshot({ path: path.join(SHOTS, 'cloud-schuladresse-1.png'), fullPage: true });
    // Auch am Browser vorbei abgelehnt (wie der Datenbank-Trigger)
    const direct = await p.evaluate(async () => (await window.supabase.createClient().auth.signUp({ email: 'x@gmail.com', password: 'abcdefgh1' })).error?.message);
    assert.match(direct, /Database error saving new user/);
    await p.fill('#auth-email', 'Sara.Muster@stud.kvchur.ch'.toLowerCase());
    await p.fill('#auth-pw', 'schul-passwort-9'); await p.fill('#auth-pw2', 'schul-passwort-9');
    await p.click('#auth-submit');
    await p.waitForSelector('#auth-confirm');
    assert.match(await p.innerText('#auth-confirm'), /sara\.muster@stud\.kvchur\.ch/);
    assert.equal((await mockState(p)).mails.at(-1).redirectTo, BASE + '/');
    await assertReadable(p, 'E-Mail bestätigen');
    await p.screenshot({ path: path.join(SHOTS, 'cloud-schuladresse-2-bestaetigen.png'), fullPage: true });
    await p.click('#auth-resend-now');
    await p.waitForSelector('text=Die E-Mail wurde erneut gesendet.');
    // Anmelden vor der Bestätigung: Hinweis mit Möglichkeit, die E-Mail erneut zu senden
    await p.click('#auth-back');
    await p.fill('#auth-pw', 'schul-passwort-9'); await p.click('#auth-submit');
    assert.match(await p.innerText('.notice-bad'), /noch nicht bestätigt/);
    assert.equal(await p.locator('#auth-resend').count(), 1);
    // Bestätigung (Link aus der E-Mail) nachbilden, dann anmelden: Ablage offen
    await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('mock-supabase')); s.users.find((u) => u.email === 'sara.muster@stud.kvchur.ch').confirmed = true; localStorage.setItem('mock-supabase', JSON.stringify(s)); });
    await p.fill('#auth-pw', 'schul-passwort-9'); await p.click('#auth-submit');
    await p.waitForSelector('.home-grid');
    await p.goto(BASE + '/#/ablage'); await p.waitForSelector('.ablage-year');
    // Konto ohne Schuladresse (Lea, example.ch): Ablage gesperrt, übrige App nutzbar
    await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('mock-supabase')); s.session = null; localStorage.setItem('mock-supabase', JSON.stringify(s)); });
    await p.goto(BASE + '/'); await p.waitForSelector('#auth-form');
    await p.fill('#auth-email', 'lernende@example.ch'); await p.fill('#auth-pw', 'sicheres-passwort1'); await p.click('#auth-submit');
    await p.waitForSelector('.home-grid');
    await p.goto(BASE + '/#/ablage');
    await p.waitForSelector('text=Nur mit Schul-E-Mail-Adresse');
    assert.equal(await p.locator('.ablage-year').count(), 0);
    await assertReadable(p, 'Ablage gesperrt');
    await c.close();
  });

  await check('Installierbar: Manifest, Symbole und Service Worker', async () => {
    const man = await (await fetch(BASE + '/manifest.webmanifest')).json();
    assert.equal(man.display, 'standalone');
    for (const i of man.icons) assert.equal((await fetch(BASE + i.src)).status, 200, i.src);
    await page.goto(BASE + '/'); await page.waitForSelector('.hero-num');
    const sw = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL || null);
    assert.match(sw, /\/sw\.js$/);
  });

  await check('Handy: Anmeldeseite passt ohne seitliches Scrollen', async () => {
    const m = await browser.newContext({ ...devices['iPhone 13'] });
    const mp = await m.newPage();
    await mp.goto(BASE + '/'); await mp.waitForSelector('#auth-form');
    assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await mp.screenshot({ path: path.join(SHOTS, 'cloud-02-anmeldung-handy.png'), fullPage: true });
    await m.close();
  });

  await check('Keine JavaScript-Fehler', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.kill();
  console.log(`\n${results.filter(Boolean).length}/${results.length} Prüfungen bestanden.`);
}
