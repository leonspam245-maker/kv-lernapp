// Datenhaltung im Browser. Gespeichert wird lokal (data/lernapp.json) oder online in Supabase (siehe backend.js).
import { toast, showSaveState } from './ui.js';
import { getState, putState, getVersion, getStatus } from './backend.js';
// Schlägt das Speichern fehl, wird die Änderung zurückgenommen: Die Anzeige zeigt immer den gespeicherten Stand.

export const store = { db: null, version: 0, server: { ocrAvailable: false, ai: { configured: false } } };

export async function loadAll() {
  const [state, status] = await Promise.all([getState(), getStatus()]);
  store.db = migrate(state.data);
  store.version = state.version;
  store.server = status;
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
  const state = await getState();
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
        const result = await putState(store.version, store.db);
        if (result.conflict) {
          // Anderes Gerät war schneller: aktuellen Stand holen und Änderung darauf anwenden
          const fresh = await fetchState();
          store.db = fresh.data; store.version = fresh.version; merged = true;
          continue;
        }
        store.version = result.version;
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
      if (e instanceof TypeError) throw new Error('Keine Verbindung zum Speicher. Internetverbindung prüfen (lokal: läuft «npm start» noch?).');
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
  try { latest = await getVersion(); } catch { return false; }
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
