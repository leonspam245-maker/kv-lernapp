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
    assert.match(await p2.innerText('.notice-bad'), /bereits ein Konto/);
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
