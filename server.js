// KV-Lernapp – kleiner lokaler Server ohne Framework.
// Liefert die Webapp aus, speichert alle Daten in data/lernapp.json
// und leitet KI-Anfragen (nur nach Aktivierung) an Claude weiter.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { aiStatus, generateWithAi } from './server/ai.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 5173);
// «--handy» macht die App im eigenen WLAN erreichbar (funktioniert unter Windows, macOS und Linux)
const HOST = process.argv.includes('--handy') ? '0.0.0.0' : (process.env.HOST || '127.0.0.1');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const DATA_FILE = path.join(DATA_DIR, 'lernapp.json');
const MAX_BODY = 60 * 1024 * 1024;

// MOCK_SUPABASE=1: Online-Betrieb mit nachgebautem Supabase testen (nur für automatische Tests)
const MOCK = process.env.MOCK_SUPABASE === '1';
const STATIC = [
  ['/vendor/supabase/', MOCK ? path.join(ROOT, 'tests/mock-supabase') : path.join(ROOT, 'node_modules/@supabase/supabase-js/dist/umd')],
  ['/vendor/pdfjs/', path.join(ROOT, 'node_modules/pdfjs-dist/build')],
  ['/vendor/tesseract/', path.join(ROOT, 'node_modules/tesseract.js/dist')],
  ['/vendor/tesseract-core/', path.join(ROOT, 'node_modules/tesseract.js-core')],
  ['/vendor/tessdata/', path.join(ROOT, 'node_modules/@tesseract.js-data/deu/4.0.0_best_int')],
  ['/', path.join(ROOT, 'public')],
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.gz': 'application/gzip',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---------- Datenspeicher ----------
function emptyData() {
  return { schema: 1, settings: { aiConsent: false, aiConsentAt: null }, subjects: [], topics: [], sources: [], cards: [], contents: [], attempts: [], exams: [] };
}

let cache = null; // { version, savedAt, data }
async function readStore() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fsp.readFile(DATA_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error('Datendatei konnte nicht gelesen werden: ' + e.message);
    cache = { version: 0, savedAt: null, data: emptyData() };
  }
  return cache;
}

let writeChain = Promise.resolve();
function writeStore(next) {
  // Schreibvorgänge nacheinander und atomar (temporäre Datei + rename), mit Sicherungskopie.
  writeChain = writeChain.then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    if (fs.existsSync(DATA_FILE)) await fsp.copyFile(DATA_FILE, DATA_FILE.replace(/\.json$/, '.backup.json'));
    const tmp = DATA_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(next));
    await fsp.rename(tmp, DATA_FILE);
    cache = next;
  });
  return writeChain;
}

// ---------- HTTP-Helfer ----------
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Die Daten sind zu gross (max. 60 MB).'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Ungültige Anfrage (kein JSON).'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res, urlPath) {
  for (const [prefix, dir] of STATIC) {
    if (!urlPath.startsWith(prefix)) continue;
    let rel = decodeURIComponent(urlPath.slice(prefix.length)) || 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) return send(res, 403, 'Nicht erlaubt');
    try {
      const stat = await fsp.stat(file);
      if (stat.isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': prefix === '/' ? 'no-cache' : 'max-age=86400' });
        fs.createReadStream(file).pipe(res);
        return;
      }
    } catch { /* weiter zum nächsten Verzeichnis */ }
    if (prefix !== '/') return send(res, 404, 'Nicht gefunden');
  }
  // Unbekannte Pfade: App ausliefern (Navigation über #-Routen)
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  fs.createReadStream(path.join(ROOT, 'public/index.html')).pipe(res);
}

// ---------- API ----------
async function handleApi(req, res, urlPath) {
  if (urlPath === '/api/status' && req.method === 'GET') {
    const ocr = fs.existsSync(path.join(ROOT, 'node_modules/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz'));
    return send(res, 200, { ok: true, ocrAvailable: ocr, ai: aiStatus() });
  }
  if (urlPath === '/api/version' && req.method === 'GET') {
    return send(res, 200, { version: (await readStore()).version });
  }
  if (urlPath === '/api/state' && req.method === 'GET') {
    return send(res, 200, await readStore());
  }
  if (urlPath === '/api/state' && req.method === 'PUT') {
    const body = await readBody(req);
    const current = await readStore();
    if (!body || typeof body.data !== 'object' || !Array.isArray(body.data.subjects)) return send(res, 400, { error: 'Ungültige Daten – nichts gespeichert.' });
    if (!body.force && body.baseVersion !== current.version) {
      return send(res, 409, { error: 'Die Daten wurden inzwischen auf einem anderen Gerät oder Tab geändert.', version: current.version });
    }
    const next = { version: current.version + 1, savedAt: new Date().toISOString(), data: body.data };
    await writeStore(next);
    return send(res, 200, { version: next.version, savedAt: next.savedAt });
  }
  if (urlPath === '/api/ai/generate' && req.method === 'POST') {
    const store = await readStore();
    // Sicherheitsnetz: Ohne gespeicherte, bewusste Aktivierung wird nichts übertragen.
    if (!store.data?.settings?.aiConsent) return send(res, 403, { error: 'Der KI-Dienst ist nicht aktiviert. Aktiviere ihn zuerst unter «Einstellungen».' });
    const body = await readBody(req);
    try {
      const result = await generateWithAi(body);
      return send(res, 200, result);
    } catch (e) {
      return send(res, e.status || 502, { error: e.message || 'Die KI-Anfrage ist fehlgeschlagen.' });
    }
  }
  return send(res, 404, { error: 'Unbekannter API-Pfad' });
}

const server = http.createServer(async (req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  try {
    // Lokal läuft die App ohne Anmeldung mit Speicherung in data/. public/config.json gilt nur online.
    if (urlPath === '/config.json') return send(res, 200, MOCK ? { mode: 'cloud', supabaseUrl: 'mock', supabaseKey: 'mock' } : { mode: 'local' });
    if (urlPath.startsWith('/api/')) return await handleApi(req, res, urlPath);
    return await serveStatic(req, res, urlPath);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || 'Interner Fehler' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\nKV-Lernapp läuft:  http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`Im gleichen WLAN (Handy): http://${n.address}:${PORT}`);
    }
    console.log('Hinweis: Im Handy-Modus ist die App für alle Geräte im selben Netzwerk erreichbar. Nur im privaten WLAN verwenden.');
  }
  console.log(`Daten: ${DATA_FILE}`);
  console.log(`KI-Dienst: ${aiStatus().configured ? 'Schlüssel vorhanden (Aktivierung in der App nötig)' : 'nicht eingerichtet (optional)'}\n`);
});
