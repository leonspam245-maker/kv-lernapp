// Speicherort der Daten: lokal (eigener Node-Server) oder online (Supabase, Rechenzentrum Zürich).
// Welche Variante gilt, steht in /config.json. Lokal liefert server.js {"mode":"local"}.

let cfg = null;
let sb = null; // Supabase-Client im Online-Betrieb

export const isCloud = () => cfg?.mode === 'cloud';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Die Anmeldung konnte nicht geladen werden. Internetverbindung prüfen.'));
    document.head.appendChild(s);
  });
}

export async function initBackend() {
  try { cfg = await (await fetch('/config.json', { cache: 'no-store' })).json(); } catch { cfg = { mode: 'local' }; }
  if (!isCloud()) return;
  if (!window.supabase) await loadScript('/vendor/supabase/supabase.js');
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
}

// ---------- Anmeldung (nur online) ----------
export async function currentUser() {
  if (!isCloud()) return { local: true };
  const { data } = await sb.auth.getSession();
  return data.session?.user || null;
}
const authError = (error) => {
  const m = error?.message || '';
  if (/invalid login credentials/i.test(m)) return 'E-Mail-Adresse oder Passwort stimmt nicht.';
  if (/registrierung ist geschlossen|database error saving new user/i.test(m)) return 'Für diese Lernapp gibt es bereits ein Konto. Melde dich mit diesem Konto an.';
  if (/already registered/i.test(m)) return 'Diese E-Mail-Adresse ist bereits registriert. Bitte anmelden.';
  if (/password should be at least/i.test(m)) return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
  if (/rate limit/i.test(m)) return 'Zu viele Versuche. Bitte einige Minuten warten.';
  if (/fetch|network/i.test(m)) return 'Keine Verbindung. Internetverbindung prüfen.';
  return m || 'Unbekannter Fehler bei der Anmeldung.';
};
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(authError(error));
}
export async function signUp(email, password) {
  const { error } = await sb.auth.signUp({ email, password });
  if (error) throw new Error(authError(error));
  // Das Konto wird serverseitig direkt bestätigt; danach gleich anmelden.
  await signIn(email, password);
}
export async function signOut() {
  if (isCloud()) await sb.auth.signOut();
}
export async function accessToken() {
  if (!isCloud()) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}

// ---------- Daten ----------
/** Aktueller Stand: { version, data } */
export async function getState() {
  if (!isCloud()) {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('Die gespeicherten Daten konnten nicht geladen werden.');
    return res.json();
  }
  const { data, error } = await sb.from('app_state').select('version, data').maybeSingle();
  if (error) throw new Error('Die Daten konnten nicht aus der Cloud geladen werden: ' + error.message);
  return data || { version: 0, data: null };
}

/** Speichern mit Versionsprüfung. Liefert { version } oder { conflict: true }. */
export async function putState(baseVersion, data) {
  if (!isCloud()) {
    const res = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion, data }) });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) return { conflict: true };
    if (!res.ok) throw new Error(body.error || `Server antwortet mit Fehler ${res.status}`);
    return { version: body.version };
  }
  const { data: version, error } = await sb.rpc('save_state', { base_version: baseVersion, new_data: data });
  if (error) {
    if (error.code === '40001' || /Versionskonflikt/.test(error.message)) return { conflict: true };
    if (/JWT|not authenticated|Nicht angemeldet/i.test(error.message)) throw new Error('Deine Anmeldung ist abgelaufen. Bitte neu laden und anmelden.');
    throw new Error('Speichern in der Cloud fehlgeschlagen: ' + error.message);
  }
  return { version };
}

export async function getVersion() {
  if (!isCloud()) return (await (await fetch('/api/version')).json()).version;
  const { data, error } = await sb.from('app_state').select('version').maybeSingle();
  if (error) throw error;
  return data?.version ?? 0;
}

export async function getStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) return await res.json();
  } catch { /* offline */ }
  return { ocrAvailable: true, ai: { configured: false } };
}
