// Persönliche API-Schlüssel für den KI-Dienst. Jede Person nutzt ihren eigenen Schlüssel und bezahlt ihre Nutzung selbst.
// Der Schlüssel bleibt im eigenen Browser (pro Konto). Er wird nie in den Lerndaten, in der Datenbank oder
// auf dem Server gespeichert, sondern nur zusammen mit einer bestätigten KI-Anfrage an den Anbieter weitergereicht.
import { store } from './store.js';

const PATTERN = { claude: /^sk-ant-[A-Za-z0-9_-]{20,400}$/, chatgpt: /^sk-[A-Za-z0-9_-]{20,400}$/ };
const keyName = (provider) => `kv-lernapp:ki-schluessel:${store.user?.id || 'lokal'}:${provider}`;
const stores = () => { const list = []; try { list.push(localStorage); } catch { /* gesperrt */ } try { list.push(sessionStorage); } catch { /* gesperrt */ } return list; };

export function getAiKey(provider) {
  for (const s of stores()) { try { const v = s.getItem(keyName(provider)); if (v) return v; } catch { /* weiter */ } }
  return '';
}
export const hasAiKey = (provider) => Boolean(getAiKey(provider));

/** Prüft das Format und speichert den Schlüssel (dauerhaft auf diesem Gerät oder nur bis zum Schliessen des Browsers). */
export function setAiKey(provider, raw, remember = true) {
  const key = String(raw || '').trim();
  if (!PATTERN[provider]?.test(key) || (provider === 'chatgpt' && key.startsWith('sk-ant-'))) {
    throw new Error(provider === 'claude'
      ? 'Das sieht nicht nach einem Claude-Schlüssel aus. Er beginnt mit «sk-ant-».'
      : 'Das sieht nicht nach einem OpenAI-Schlüssel aus. Er beginnt mit «sk-» (nicht «sk-ant-»).');
  }
  removeAiKey(provider);
  const target = remember ? localStorage : sessionStorage;
  try { target.setItem(keyName(provider), key); } catch { throw new Error('Der Browser erlaubt kein Speichern (privater Modus?). Der Schlüssel konnte nicht hinterlegt werden.'); }
}
export function removeAiKey(provider) {
  for (const s of stores()) { try { s.removeItem(keyName(provider)); } catch { /* weiter */ } }
}
export const isRemembered = (provider) => { try { return Boolean(localStorage.getItem(keyName(provider))); } catch { return false; } };
/** Nur Anfang und Ende anzeigen, z. B. «sk-ant-…a1B2». */
export function maskKey(key) {
  if (!key) return '';
  return `${key.slice(0, key.startsWith('sk-ant-') ? 7 : 3)}…${key.slice(-4)}`;
}
