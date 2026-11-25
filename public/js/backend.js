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
  // Link aus der E-Mail «Passwort zurücksetzen»: Supabase hängt type=recovery (oder einen Fehler) an die Adresse
  const hash = location.hash + location.search;
  const recovery = /type=recovery/.test(hash);
  const linkError = /error_code=|error=access_denied/.test(hash);
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  if (recovery || linkError) {
    await sb.auth.getSession(); // wartet, bis die Anmeldung aus dem Link übernommen ist
    flags.recovery = recovery && !linkError;
    flags.linkError = linkError ? 'Der Link ist abgelaufen oder wurde schon verwendet. Fordere unter «Passwort vergessen?» einen neuen an.' : '';
    history.replaceState(null, '', location.pathname);
  }
}
const flags = { recovery: false, linkError: '' };
/** Wurde die App über den Link «Passwort zurücksetzen» geöffnet? */
export const isRecovery = () => flags.recovery;
export const recoveryLinkError = () => flags.linkError;

/** E-Mail mit Link zum Zurücksetzen schicken (nur online). */
export async function requestPasswordReset(email) {
  if (!isCloud()) throw new Error('In der lokalen Version gibt es keinen E-Mail-Versand.');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` });
  if (error) {
    if (/rate|limit|seconds/i.test(error.message)) throw new Error('Zu viele Anfragen. Bitte warte ein paar Minuten und versuche es erneut.');
    if (/invalid|format|validate/i.test(error.message)) throw new Error('Diese E-Mail-Adresse ist ungültig. Bitte prüfe sie auf Tippfehler.');
    throw new Error('Die E-Mail konnte nicht verschickt werden. Bitte später erneut versuchen.');
  }
}
/** Neues Passwort für das angemeldete Konto setzen (nach dem Link aus der E-Mail). */
export async function setNewPassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) {
    if (/same|different/i.test(error.message)) throw new Error('Das neue Passwort muss sich vom bisherigen unterscheiden.');
    if (/session|jwt|expired/i.test(error.message)) throw new Error('Der Link ist abgelaufen. Fordere unter «Passwort vergessen?» einen neuen an.');
    throw new Error('Das Passwort konnte nicht geändert werden. Bitte erneut versuchen.');
  }
  flags.recovery = false;
}

// ---------- Anmeldung (nur online) ----------
async function localAuth(path, body) {
  let res;
  try { res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  catch { throw new Error('Keine Verbindung zum KV-Learn-Server. Läuft «npm start» noch?'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

export async function currentUser() {
  if (!isCloud()) {
    // Lokale Version: Konto über Cookie beim eigenen Server prüfen
    const res = await fetch('/api/auth/me');
    if (res.status === 401) return null;
    if (!res.ok) throw new Error('Der KV-Learn-Server antwortet nicht richtig.');
    return (await res.json()).user;
  }
  const { data } = await sb.auth.getSession();
  const session = data.session;
  if (!session) return null;
  // Gespeicherte Anmeldung beim Server prüfen: gelöschte oder gesperrte Konten kommen nicht mehr in die App.
  const { data: checked, error } = await sb.auth.getUser();
  if (checked?.user) return checked.user;
  const offline = !navigator.onLine || /fetch|network/i.test(error?.message || '') || error?.status === 0;
  if (offline) return session.user; // ohne Internet: gespeicherte Anmeldung vorläufig weiter nutzen
  await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  return null;
}
const authError = (error) => {
  const m = error?.message || '';
  if (/invalid login credentials/i.test(m)) return 'E-Mail-Adresse oder Passwort stimmt nicht.';
  if (/database error saving new user/i.test(m)) return 'Das Konto konnte nicht erstellt werden. Bitte später erneut versuchen.';
  if (/already registered/i.test(m)) return 'Diese E-Mail-Adresse ist bereits registriert. Bitte anmelden.';
  if (/password should be at least/i.test(m)) return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
  if (/rate limit/i.test(m)) return 'Zu viele Versuche. Bitte einige Minuten warten.';
  if (/fetch|network/i.test(m)) return 'Keine Verbindung. Internetverbindung prüfen.';
  return m || 'Unbekannter Fehler bei der Anmeldung.';
};
export async function signIn(email, password) {
  if (!isCloud()) { await localAuth('/api/auth/login', { email, password }); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(authError(error));
}
export async function signUp(email, password, profile = {}) {
  if (!isCloud()) { await localAuth('/api/auth/register', { email, password, profile }); return; }
  const { error } = await sb.auth.signUp({ email, password, options: { data: profile } });
  // Das Konto wird serverseitig direkt bestätigt; danach gleich anmelden.
  // Auch bei einem Fehler (z. B. E-Mail-Versandgrenze) kann das Konto bereits bestehen: Anmeldung versuchen.
  try {
    await signIn(email, password);
  } catch (signInError) {
    if (error) throw new Error(authError(error));
    // Gibt es die E-Mail-Adresse schon mit anderem Passwort, meldet Supabase keinen Fehler; die Anmeldung scheitert dann.
    throw new Error('Mit dieser E-Mail-Adresse besteht bereits ein Konto. Bitte anmelden.');
  }
}
export async function signOut() {
  if (isCloud()) await sb.auth.signOut();
  else await localAuth('/api/auth/logout');
}
export async function accessToken() {
  if (!isCloud()) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}

// ---------- KI-Guthaben (nur online) ----------
export async function getCredits() {
  if (!isCloud()) return null;
  const [bal, led] = await Promise.all([
    sb.from('ai_credit').select('balance_rappen').maybeSingle(),
    sb.from('ai_ledger').select('kind, amount_rappen, provider, model, created_at').neq('kind', 'hold').order('created_at', { ascending: false }).limit(8),
  ]);
  if (bal.error || led.error) throw new Error('Das Guthaben konnte nicht geladen werden.');
  return { balance: bal.data?.balance_rappen || 0, ledger: led.data || [] };
}
/** Zahlungsseite bei Stripe öffnen (liefert deren Adresse). */
export async function startCheckout(amount) {
  const token = await accessToken();
  let res;
  try { res = await fetch('/api/credits/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ amount, termsAccepted: true }) }); }
  catch { throw new Error('Keine Verbindung. Bitte Internetverbindung prüfen.'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.url) throw new Error(body.error || 'Die Zahlungsseite konnte nicht geöffnet werden.');
  return body.url;
}

// ---------- Daten ----------
/** Aktueller Stand: { version, data } */
export async function getState() {
  if (!isCloud()) {
    const res = await fetch('/api/state');
    if (res.status === 401) throw new Error('Deine Anmeldung ist abgelaufen. Bitte neu laden und anmelden.');
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
    if (res.status === 401) throw new Error('Deine Anmeldung ist abgelaufen. Bitte neu laden und anmelden.');
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
