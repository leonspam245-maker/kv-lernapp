// Hilfsfunktionen ohne DOM-Abhängigkeit (auch in Node-Tests nutzbar).

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const pad = (n) => String(n).padStart(2, '0');
/** Heutiges Datum als YYYY-MM-DD in lokaler Zeit. */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
const toUTC = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * 86400000);
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000); // b - a
/** Wochentag 0 = Montag … 6 = Sonntag */
export const weekdayIndex = (iso) => (new Date(toUTC(iso)).getUTCDay() + 6) % 7;
export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** 28.11.2026 */
export function fmtDate(iso) {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}
/** Mo, 28.11.2026 */
export const fmtDateShort = (iso) => `${WD_SHORT[weekdayIndex(iso)]}, ${fmtDate(iso)}`;
/** Montag, 28.11.2026 */
export const fmtDateLong = (iso) => `${WEEKDAYS[weekdayIndex(iso)]}, ${fmtDate(iso)}`;
/** 16.11.2026, 14.30 Uhr */
export function fmtDateTime(isoTs) {
  if (!isoTs) return '–';
  const d = new Date(isoTs);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}.${pad(d.getMinutes())} Uhr`;
}
/** Eingabe 28.11.2026 oder 2026-11-28 → 2026-11-28 (oder null) */
export function parseDate(text) {
  const t = String(text || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return null;
}

export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9äöü\s]/g, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set('der die das ein eine einer eines einem einen und oder ist sind wird werden von vom zu zum zur mit auf für fur bei aus im in an am als auch dem den des sich nicht nur dass wenn wie es er sie man durch über uber unter nach vor um so kann muss soll gegen ohne zwischen diese dieser dieses jede jeder jedes beim'.split(' '));
/** Bedeutungstragende Wörter eines Textes (für Ähnlichkeit und Schlüsselbegriffe). */
export function keywords(text, max = 8) {
  const words = norm(text).split(' ').filter((w) => w.length > 3 && !STOP.has(w));
  const seen = []; for (const w of words) if (!seen.includes(w)) seen.push(w);
  return seen.slice(0, max);
}
export function similarity(a, b) {
  const A = new Set(keywords(a, 40)); const B = new Set(keywords(b, 40));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** Deterministischer Zufall für Tests. */
export function seededRng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
