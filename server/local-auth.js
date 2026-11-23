// Konten für die lokale Version: beliebig viele Personen, jede mit eigener Datendatei.
// Passwörter werden mit scrypt (Salz pro Konto) gespeichert, nie im Klartext.
// Anmeldung über ein HttpOnly-Cookie (für Skripte im Browser nicht lesbar).
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const SESSION_DAYS = 30;
const COOKIE = 'kvsid';

export function createLocalAuth(dataDir) {
  const usersFile = path.join(dataDir, 'users.json');
  const sessionsFile = path.join(dataDir, 'sessions.json');
  let users = null; let sessions = null;
  let chain = Promise.resolve();

  const load = async () => {
    if (users) return;
    users = fs.existsSync(usersFile) ? JSON.parse(await fsp.readFile(usersFile, 'utf8')) : [];
    sessions = fs.existsSync(sessionsFile) ? JSON.parse(await fsp.readFile(sessionsFile, 'utf8')) : {};
  };
  const persist = () => {
    chain = chain.then(async () => {
      await fsp.mkdir(dataDir, { recursive: true });
      for (const [file, content] of [[usersFile, users], [sessionsFile, sessions]]) {
        await fsp.writeFile(file + '.tmp', JSON.stringify(content, null, 1));
        await fsp.rename(file + '.tmp', file);
      }
    });
    return chain;
  };
  const hash = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
  const publicUser = (u) => ({ id: u.id, email: u.email, user_metadata: u.profile || {} });
  const err = (message, status) => Object.assign(new Error(message), { status });

  // Einfacher Schutz gegen Durchprobieren von Passwörtern: höchstens 10 Fehlversuche pro 5 Minuten und Adresse
  const attempts = new Map();
  const tooMany = (ip) => {
    const now = Date.now();
    const list = (attempts.get(ip) || []).filter((t) => now - t < 5 * 60000);
    attempts.set(ip, list);
    return list.length >= 10;
  };

  const newSession = async (userId) => {
    const token = crypto.randomBytes(32).toString('hex');
    sessions[token] = { userId, expires: Date.now() + SESSION_DAYS * 86400000 };
    for (const [t, s] of Object.entries(sessions)) if (s.expires < Date.now()) delete sessions[t];
    await persist();
    return token;
  };
  const cookieHeader = (token, maxAge) => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

  return {
    /** Angemeldetes Konto zum Request oder null */
    async userFor(req) {
      await load();
      const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
      const s = m && sessions[m[1]];
      if (!s || s.expires < Date.now()) return null;
      return users.find((u) => u.id === s.userId) || null;
    },
    async register({ email, password, profile }) {
      await load();
      const mail = String(email || '').trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(mail)) throw err('Bitte eine gültige E-Mail-Adresse eingeben.', 400);
      if (String(password || '').length < 8 || !/\d/.test(password)) throw err('Das Passwort muss mindestens 8 Zeichen und eine Zahl enthalten.', 400);
      if (users.some((u) => u.email === mail)) throw err('Mit dieser E-Mail-Adresse besteht bereits ein Konto. Bitte anmelden.', 409);
      const salt = crypto.randomBytes(16).toString('hex');
      const clean = {
        firstName: String(profile?.firstName || '').slice(0, 60),
        apprenticeshipYear: [1, 2, 3].includes(Number(profile?.apprenticeshipYear)) ? Number(profile.apprenticeshipYear) : 1,
        school: String(profile?.school || '').slice(0, 120),
        consentAt: profile?.consentAt || new Date().toISOString(),
      };
      const user = { id: 'u' + crypto.randomBytes(8).toString('hex'), email: mail, salt, hash: hash(password, salt), profile: clean, createdAt: new Date().toISOString() };
      users.push(user);
      const isFirst = users.length === 1;
      const token = await newSession(user.id);
      return { user: publicUser(user), cookie: cookieHeader(token, SESSION_DAYS * 86400), isFirst, userId: user.id };
    },
    async login({ email, password }, ip) {
      await load();
      if (tooMany(ip)) throw err('Zu viele Versuche. Bitte einige Minuten warten.', 429);
      const u = users.find((x) => x.email === String(email || '').trim().toLowerCase());
      const ok = u && crypto.timingSafeEqual(Buffer.from(hash(String(password || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
      if (!ok) { attempts.get(ip).push(Date.now()); throw err('E-Mail-Adresse oder Passwort stimmt nicht.', 401); }
      const token = await newSession(u.id);
      return { user: publicUser(u), cookie: cookieHeader(token, SESSION_DAYS * 86400) };
    },
    async logout(req) {
      await load();
      const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
      if (m) { delete sessions[m[1]]; await persist(); }
      return cookieHeader('', 0);
    },
    publicUser,
  };
}
