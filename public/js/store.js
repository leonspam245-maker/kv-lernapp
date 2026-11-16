// Datenhaltung im Browser mit Speicherung auf dem lokalen Server (data/lernapp.json).
import { toast, showSaveState } from './ui.js';
// Schlägt das Speichern fehl, wird die Änderung zurückgenommen: Die Anzeige zeigt immer den gespeicherten Stand.

export const store = { db: null, version: 0, server: { ocrAvailable: false, ai: { configured: false } } };

export async function loadAll() {
  const [stateRes, statusRes] = await Promise.all([fetch('/api/state'), fetch('/api/status')]);
  if (!stateRes.ok) throw new Error('Die gespeicherten Daten konnten nicht geladen werden.');
  const state = await stateRes.json();
  store.db = migrate(state.data);
  store.version = state.version;
  if (statusRes.ok) store.server = await statusRes.json();
}

function migrate(data) {
  const d = data || {};
  for (const k of ['subjects', 'topics', 'sources', 'cards', 'contents', 'attempts', 'exams']) if (!Array.isArray(d[k])) d[k] = [];
  d.settings = { aiConsent: false, aiConsentAt: null, ...(d.settings || {}) };
  d.schema = 1;
  return d;
}

let chain = Promise.resolve();
/** Wird aufgerufen, wenn Daten eines anderen Geräts übernommen wurden (setzt app.js). */
export const sync = { onExternalChange: null };

async function fetchState() {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('Der aktuelle Stand konnte nicht geladen werden.');
  const state = await res.json();
  return { data: migrate(state.data), version: state.version };
}

/**
 * Änderung anwenden und sofort speichern. Hat ein anderes Gerät inzwischen gespeichert,
 * wird dessen Stand geladen, die Änderung darauf erneut angewendet und nochmals gespeichert.
 * Schlägt das Speichern fehl, wird die Änderung zurückgenommen und der Fehler weitergegeben
 * (Eingaben bleiben im Formular).
 */
export function commit(mutator) {
  const run = async () => {
    const snapshot = structuredClone(store.db);
    const snapshotVersion = store.version;
    let merged = false;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        mutator(store.db);
        showSaveState('saving');
        const res = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion: store.version, data: store.db }) });
        const body = await res.json().catch(() => ({}));
        if (res.status === 409) {
          // Anderes Gerät war schneller: aktuellen Stand holen und Änderung darauf anwenden
          const fresh = await fetchState();
          store.db = fresh.data; store.version = fresh.version; merged = true;
          continue;
        }
        if (!res.ok) throw new Error(body.error || `Server antwortet mit Fehler ${res.status}`);
        store.version = body.version;
        showSaveState('saved');
        if (merged) {
          toast('Änderungen von einem anderen Gerät wurden übernommen und deine Änderung ergänzt.', 'info');
          sync.onExternalChange?.();
        }
        return;
      }
      throw new Error('Die Daten werden gerade auf einem anderen Gerät geändert. Bitte nochmals versuchen.');
    } catch (e) {
      if (!merged) { store.db = snapshot; store.version = snapshotVersion; }
      else { try { const fresh = await fetchState(); store.db = fresh.data; store.version = fresh.version; } catch { store.db = snapshot; store.version = snapshotVersion; } }
      showSaveState('error');
      if (e instanceof TypeError) throw new Error('Keine Verbindung zum Lernapp-Server. Läuft «npm start» noch?');
      throw e;
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

/**
 * Prüft, ob auf einem anderen Gerät gespeichert wurde, und lädt dann den aktuellen Stand.
 * Gibt true zurück, wenn neue Daten geladen wurden.
 */
export async function refreshIfStale() {
  let latest;
  try { latest = (await (await fetch('/api/version')).json()).version; } catch { return false; }
  if (latest === store.version) return false;
  const run = async () => {
    const fresh = await fetchState();
    if (fresh.version === store.version) return false;
    store.db = fresh.data; store.version = fresh.version;
    return true;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p.catch(() => false);
}

// ---------- Abfragen ----------
export const byId = (list, id) => store.db[list].find((x) => x.id === id);
export const subjectName = (id) => byId('subjects', id)?.name || 'Ohne Fach';
export const topicName = (id) => byId('topics', id)?.name || 'Ohne Thema';
export const sourceTitle = (id) => byId('sources', id)?.title || 'Gelöschte Unterlage';
export const topicsOf = (subjectId) => store.db.topics.filter((t) => t.subjectId === subjectId).sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
export const sourcesOf = (topicId) => store.db.sources.filter((s) => s.topicId === topicId);
