// Gemeinsame Hilfen für die Vercel-Funktionen (Online-Betrieb).
// URL und publishable Key sind öffentlich (wie in public/config.json); geschützt wird über die Anmeldung und Row Level Security.
export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scqnlssmcudknekniivo.supabase.co';
export const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Hc8_n3d51QcJn49U6pxPCA_c-c-Xd4X';

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Prüft die Anmeldung und liefert Konto, gespeicherte Einstellungen und die Anmeldung für weitere Aufrufe. */
export async function authorizedUser(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('Nicht angemeldet. Bitte neu laden und anmelden.'), { status: 401 });
  const headers = { apikey: SUPABASE_KEY, Authorization: auth };
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers });
  if (!userRes.ok) throw Object.assign(new Error('Die Anmeldung ist abgelaufen. Bitte neu laden und anmelden.'), { status: 401 });
  const user = await userRes.json();
  const rowRes = await fetch(`${SUPABASE_URL}/rest/v1/app_state?select=settings:data->settings`, { headers });
  if (!rowRes.ok) throw Object.assign(new Error('Die Einstellungen konnten nicht gelesen werden.'), { status: 502 });
  const rows = await rowRes.json();
  return { user: { id: user.id, email: user.email }, settings: rows[0]?.settings || {}, auth };
}
export async function authorizedSettings(req) {
  return (await authorizedUser(req)).settings;
}

/** Datenbankfunktion aufrufen; mit auth als angemeldete Person, sonst ohne Anmeldung. */
export async function rpc(name, args, auth = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(body?.message || `Datenbankfehler ${res.status}`), { status: 502, db: body || {} });
  return body;
}

/** Rohdaten der Anfrage lesen (für die Signaturprüfung von Stripe). */
export async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

export const chf = (rappen) => `CHF ${(rappen / 100).toFixed(2)}`;
