// Test des Online-Betriebs (Anmeldung, Cloud-Speicher, Konflikte, App-Installation) mit nachgebautem Supabase.
// Aufruf: npm run e2e:cloud
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

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

const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR, MOCK_SUPABASE: '1' }, stdio: 'pipe' });
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
