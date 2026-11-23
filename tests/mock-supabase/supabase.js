// Nachgebautes Supabase für automatische Tests (nur mit MOCK_SUPABASE=1 aktiv).
// Bildet nur das nach, was die Lernapp nutzt: Anmeldung, Tabelle app_state und die Funktion save_state.
// Speichert im localStorage des Test-Browsers; verhält sich wie die echte Datenbank (ein Konto, Versionsprüfung).
(function () {
  const KEY = 'mock-supabase';
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{"users":[],"rows":{},"session":null}');
  const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
  const delay = () => new Promise((r) => setTimeout(r, 20));

  function createClient() {
    const auth = {
      async getSession() { await delay(); const db = load(); return { data: { session: db.session } }; },
      async signUp({ email, password, options }) {
        await delay(); const db = load();
        if (db.users.length) return { error: { message: 'Database error saving new user' } };
        if (password.length < 8) return { error: { message: 'Password should be at least 8 characters' } };
        db.users.push({ id: 'u1', email, password, user_metadata: options?.data || {} }); save(db);
        return { data: { user: { id: 'u1', email } }, error: null };
      },
      async signInWithPassword({ email, password }) {
        await delay(); const db = load();
        const u = db.users.find((x) => x.email === email && x.password === password);
        if (!u) return { error: { message: 'Invalid login credentials' } };
        db.session = { access_token: 'mock-token', user: { id: u.id, email, user_metadata: u.user_metadata || {} } }; save(db);
        return { data: { session: db.session }, error: null };
      },
      async signOut() { await delay(); const db = load(); db.session = null; save(db); return { error: null }; },
    };
    const uid = () => load().session?.user.id;
    return {
      auth,
      from(table) {
        if (table !== 'app_state') throw new Error('unbekannte Tabelle');
        return {
          select(cols) {
            return {
              async maybeSingle() {
                await delay(); const id = uid();
                if (!id) return { data: null, error: null }; // RLS: ohne Anmeldung keine Zeilen
                const row = load().rows[id];
                if (!row) return { data: null, error: null };
                return { data: cols.includes('data') ? { version: row.version, data: row.data } : { version: row.version }, error: null };
              },
            };
          },
        };
      },
      async rpc(name, { base_version, new_data }) {
        await delay();
        const id = uid();
        if (!id) return { data: null, error: { message: 'Nicht angemeldet', code: '28000' } };
        const db = load();
        const row = db.rows[id];
        if (row && row.version === base_version) { row.version++; row.data = new_data; save(db); return { data: row.version, error: null }; }
        if (!row && base_version === 0) { db.rows[id] = { version: 1, data: new_data }; save(db); return { data: 1, error: null }; }
        return { data: null, error: { message: 'Versionskonflikt', code: '40001' } };
      },
    };
  }
  window.supabase = { createClient };
})();
