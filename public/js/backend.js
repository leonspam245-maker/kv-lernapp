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
  const confirmLink = /type=(signup|email_change)|access_token=/.test(hash) && !recovery;
  const linkError = /error_code=|error=access_denied/.test(hash);
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  if (recovery || confirmLink || linkError) {
    await sb.auth.getSession(); // wartet, bis die Anmeldung aus dem Link übernommen ist
    flags.recovery = recovery && !linkError;
    flags.confirmed = confirmLink && !linkError;
    flags.linkError = linkError ? 'Der Link ist abgelaufen oder wurde schon verwendet. Melde dich an; falls deine E-Mail-Adresse noch nicht bestätigt ist, kannst du den Link neu anfordern. Für ein neues Passwort: «Passwort vergessen?».' : '';
    history.replaceState(null, '', location.pathname);
  }
}
const flags = { recovery: false, confirmed: false, linkError: '' };
/** Wurde die App über den Bestätigungslink aus der Registrierungs-E-Mail geöffnet? */
export const justConfirmed = () => flags.confirmed;
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
  if (/database error saving new user|schul-e-mail/i.test(m)) return 'Das Konto konnte nicht erstellt werden. Registrieren kannst du dich nur mit deiner Schul-E-Mail-Adresse.';
  if (/email not confirmed/i.test(m)) return 'Deine E-Mail-Adresse ist noch nicht bestätigt. Öffne den Link in der E-Mail von KV-Learn (auch im Spam-Ordner nachsehen).';
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
/**
 * Konto erstellen. Online muss die (Schul-)E-Mail-Adresse zuerst über den Link in der E-Mail bestätigt werden:
 * Rückgabe { confirm: true }. Lokal ist man sofort angemeldet.
 */
export async function signUp(email, password, profile = {}) {
  if (!isCloud()) { await localAuth('/api/auth/register', { email, password, profile }); return { confirm: false }; }
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: profile, emailRedirectTo: `${location.origin}/` } });
  if (error) throw new Error(authError(error));
  if (data?.session) return { confirm: false };
  // Supabase verrät aus Datenschutzgründen nicht, ob die Adresse schon registriert ist: Hinweis bleibt neutral
  return { confirm: true };
}
/** Bestätigungs-E-Mail erneut senden. */
export async function resendConfirmation(email) {
  const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${location.origin}/` } });
  if (error) throw new Error(authError(error));
}
let domainCache = null;
/** Erlaubte Schul-Domains für die Registrierung (leer = alle Adressen erlaubt). */
export async function schoolDomains() {
  if (!isCloud()) return [];
  if (domainCache) return domainCache;
  const { data, error } = await sb.rpc('school_domains');
  if (error) return [];
  domainCache = data || [];
  return domainCache;
}
/** Darf das angemeldete Konto die gemeinsame Ablage nutzen? */
export async function isSchoolMember() {
  if (!isCloud()) return false;
  const { data, error } = await sb.rpc('is_school_member');
  return !error && data === true;
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

// ---------- Gemeinsame Ablage (nur online) ----------
// Dateien liegen im privaten Speicher «ablage»; Zugriff nur für angemeldete Personen über kurzlebige Links.
const BUCKET = 'ablage';
const libError = (msg) => { const e = new Error(msg); e.userFacing = true; return e; };
const safeFileName = (name) => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(-80) || 'datei';

/** Alle sichtbaren Einträge der Ablage (neueste zuerst). */
export async function listLibrary() {
  if (!isCloud()) return [];
  const { data, error } = await sb.from('library_items')
    .select('id, folder, title, description, file_path, file_name, mime, size_bytes, uploader_id, uploader_name, hidden, report_count, created_at')
    .order('created_at', { ascending: false });
  if (error) throw libError('Die Ablage konnte nicht geladen werden.');
  return data || [];
}
/** Ist das angemeldete Konto Administrator der Ablage? */
export async function isLibraryAdmin() {
  if (!isCloud()) return false;
  const { data, error } = await sb.rpc('is_admin');
  return !error && data === true;
}
/** Datei hochladen und Eintrag anlegen. Schlägt der Eintrag fehl, wird die Datei wieder entfernt. */
export async function uploadLibraryItem({ folder, title, description, file }) {
  const { data: { session } } = await sb.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw libError('Bitte melde dich erneut an.');
  const path = `${userId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw libError(/size|large|exceed/i.test(up.error.message || '') ? 'Die Datei ist grösser als 20 MB.' : /mime|type/i.test(up.error.message || '') ? 'Dieses Dateiformat ist in der Ablage nicht erlaubt.' : 'Die Datei konnte nicht hochgeladen werden.');
  const { data, error } = await sb.from('library_items').insert({
    folder, title, description: description || null, file_path: path, file_name: file.name, mime: file.type, size_bytes: file.size, rights_confirmed_at: new Date().toISOString(),
  }).select().single();
  if (error) { await sb.storage.from(BUCKET).remove([path]); throw libError('Der Eintrag konnte nicht gespeichert werden.'); }
  return data;
}
/** Kurzlebiger Link zum Öffnen oder Herunterladen (2 Minuten gültig). */
export async function libraryFileUrl(item, download = false) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(item.file_path, 120, download ? { download: item.file_name } : undefined);
  if (error || !data?.signedUrl) throw libError('Die Datei konnte nicht geöffnet werden.');
  return data.signedUrl;
}
/** Datei als File-Objekt laden (für die Übernahme in die eigenen Unterlagen). */
export async function libraryFile(item) {
  const { data, error } = await sb.storage.from(BUCKET).download(item.file_path);
  if (error || !data) throw libError('Die Datei konnte nicht geladen werden.');
  return new File([data], item.file_name, { type: item.mime });
}
export async function reportLibraryItem(id, reason) {
  const { error } = await sb.from('library_reports').insert({ item_id: id, reason });
  if (error) throw libError(error.code === '23505' ? 'Du hast diesen Eintrag bereits gemeldet.' : 'Die Meldung konnte nicht gesendet werden.');
}
export async function deleteLibraryItem(item) {
  // Zuerst die Datei: Der Speicher gibt sie nur frei, solange der Eintrag noch existiert
  const rm = await sb.storage.from(BUCKET).remove([item.file_path]);
  if (rm.error) throw libError('Die Datei konnte nicht gelöscht werden.');
  const { error } = await sb.from('library_items').delete().eq('id', item.id);
  if (error) throw libError('Der Eintrag konnte nicht gelöscht werden.');
}
export async function setLibraryHidden(id, hidden) {
  const { error } = await sb.from('library_items').update({ hidden }).eq('id', id);
  if (error) throw libError('Der Eintrag konnte nicht geändert werden.');
}

// ---------- Lernpakete (nur online, nur Schulkonten) ----------
// Fertige Pakete liegen als JSON im privaten Speicher «pakete»: index.json (Übersicht) und <id>.json
async function paketDatei(name) {
  const { data, error } = await sb.storage.from('pakete').download(name);
  if (error || !data) throw libError('Die Lernpakete konnten nicht geladen werden. Bitte später erneut versuchen.');
  return JSON.parse(await data.text());
}
/** Übersicht aller Lernpakete: { version, pakete:[{id, kategorie, year, hkb, lf, title, cards, questions, sources, …}] } */
export async function paketeIndex() {
  if (!isCloud()) return null;
  return paketDatei('index.json');
}
/** Ein Lernpaket mit Inhalt */
export async function paketLaden(id) {
  if (!/^[a-z0-9-]{1,80}$/.test(id)) throw libError('Ungültiges Lernpaket.');
  return paketDatei(`${id}.json`);
}
