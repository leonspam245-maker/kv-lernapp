// Nachgebautes Supabase für automatische Tests (nur mit MOCK_SUPABASE=1 aktiv).
// Bildet nur das nach, was die Lernapp nutzt: Anmeldung, app_state/save_state, KI-Guthaben und die gemeinsame Ablage.
// Speichert im localStorage des Test-Browsers; verhält sich wie die echte Datenbank (ein Konto, Versionsprüfung).
(function () {
  const KEY = 'mock-supabase';
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{"users":[],"rows":{},"session":null}');
  const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
  const delay = () => new Promise((r) => setTimeout(r, 20));

  function createClient() {
    const auth = {
      async getSession() { await delay(); const db = load(); return { data: { session: db.session } }; },
      // db.config: { domains: [...], confirm: true } bildet Schul-Domains (Datenbank-Trigger) und E-Mail-Bestätigung nach
      async signUp({ email, password, options }) {
        await delay(); const db = load(); const cfg = db.config || {};
        if (db.users.some((x) => x.email === email)) return { data: { user: null, session: null }, error: null }; // wie Supabase: kein Hinweis auf bestehende Adresse
        if (password.length < 8) return { error: { message: 'Password should be at least 8 characters' } };
        if (cfg.domains?.length && !cfg.domains.includes(email.split('@').pop().toLowerCase())) return { data: { user: null, session: null }, error: { message: 'Database error saving new user', status: 500 } };
        const id = 'u' + (db.users.length + 1);
        db.users.push({ id, email, password, user_metadata: options?.data || {}, confirmed: !cfg.confirm });
        if (cfg.confirm) { (db.mails ||= []).push({ type: 'signup', email, redirectTo: options?.emailRedirectTo }); save(db); return { data: { user: { id, email }, session: null }, error: null }; }
        db.session = { access_token: 'mock-token', user: { id, email, user_metadata: options?.data || {} } }; save(db);
        return { data: { user: { id, email }, session: db.session }, error: null };
      },
      async resend({ type, email }) { await delay(); const db = load(); (db.mails ||= []).push({ type, email }); save(db); return { data: {}, error: null };
      },
      async signInWithPassword({ email, password }) {
        await delay(); const db = load();
        const u = db.users.find((x) => x.email === email && x.password === password);
        if (!u) return { error: { message: 'Invalid login credentials' } };
        if (u.confirmed === false) return { error: { message: 'Email not confirmed' } };
        db.session = { access_token: 'mock-token', user: { id: u.id, email, user_metadata: u.user_metadata || {} } }; save(db);
        return { data: { session: db.session }, error: null };
      },
      async getUser() {
        await delay(); const db = load();
        const u = db.session && db.users.find((x) => x.id === db.session.user.id);
        return u ? { data: { user: { id: u.id, email: u.email, user_metadata: u.user_metadata || {} } }, error: null }
          : { data: { user: null }, error: { message: 'User from sub claim in JWT does not exist', status: 403 } };
      },
      async signOut() { await delay(); const db = load(); db.session = null; save(db); return { error: null }; },
      // Passwort zurücksetzen: Anfrage wird nur festgehalten (der Test prüft sie), kein echter E-Mail-Versand
      async resetPasswordForEmail(email, opts) { await delay(); const db = load(); (db.resets ||= []).push({ email, redirectTo: opts?.redirectTo }); save(db); return { data: {}, error: null }; },
      async updateUser({ password }) {
        await delay(); const db = load();
        const u = db.session && db.users.find((x) => x.id === db.session.user.id);
        if (!u) return { error: { message: 'Auth session missing!' } };
        if (u.password === password) return { error: { message: 'New password should be different from the old password.' } };
        u.password = password; save(db); return { data: { user: { id: u.id } }, error: null };
      },
    };
    const uid = () => load().session?.user.id;
    // ---------- Gemeinsame Ablage (wie Row Level Security der echten Datenbank) ----------
    const isAdmin = (db) => db.admin === uid();
    const visible = (db, i) => (!i.folder.startsWith('kl/') || (db.class_members || []).some((m) => m.class_id === i.folder.slice(3) && m.user_id === uid())) && (!i.hidden || i.uploader_id === uid() || isAdmin(db));
    const err = (message, code) => ({ data: null, error: { message, code } });
    function library(table) {
      if (table === 'library_reports') return {
        async insert({ item_id, reason }) {
          await delay(); const db = load(); const me = uid();
          if (!me) return err('nicht angemeldet', '42501');
          const reps = (db.reports ||= []);
          if (reps.some((r) => r.item_id === item_id && r.reporter_id === me)) return err('duplicate key', '23505');
          reps.push({ item_id, reporter_id: me, reason });
          const item = db.items.find((i) => i.id === item_id);
          item.report_count = reps.filter((r) => r.item_id === item_id).length;
          item.hidden = item.hidden || item.report_count >= 2;
          save(db); return { data: null, error: null };
        },
      };
      let filterId = null; let op = 'select'; let patch = null;
      const q = {
        select() { return q; }, order() { return q; },
        eq(_col, v) { filterId = v; return q; },
        delete() { op = 'delete'; return q; },
        update(p) { op = 'update'; patch = p; return q; },
        insert(row) {
          op = 'insert'; patch = row; return q;
        },
        async single() { return q.run(); },
        async run() {
          await delay(); const db = load(); const me = uid(); db.items ||= [];
          if (!me) return err('nicht angemeldet', '42501');
          if (op === 'insert') {
            const r = patch;
            const klOk = (f) => !f.startsWith('kl/') || (db.class_members || []).some((m) => m.class_id === f.slice(3) && m.user_id === me);
            if (!(/^lj[123]\/[a-z0-9-]{1,40}$/.test(r.folder) || /^kl\/[0-9a-f-]{36}$/.test(r.folder)) || !klOk(r.folder) || r.file_path.split('/')[0] !== me || !r.rights_confirmed_at) return err('new row violates row-level security policy', '42501');
            const u = db.users.find((x) => x.id === me);
            const item = { ...r, id: 'it' + (db.items.length + 1), uploader_id: me, uploader_name: u?.user_metadata?.firstName || 'Anonym', hidden: false, report_count: 0, created_at: new Date().toISOString() };
            db.items.push(item); save(db); return { data: item, error: null };
          }
          const item = db.items.find((i) => i.id === filterId);
          if (op === 'delete') {
            if (item && (item.uploader_id === me || isAdmin(db))) { db.items = db.items.filter((i) => i !== item); save(db); }
            return { data: null, error: null };
          }
          if (op === 'update') {
            if (item && isAdmin(db)) { Object.assign(item, patch); save(db); }
            return { data: null, error: null };
          }
          return { data: db.items.filter((i) => visible(db, i)).slice().reverse(), error: null };
        },
        then(resolve, reject) { q.run().then(resolve, reject); },
      };
      return q;
    }
    const fileKey = (p) => 'mock-file:' + p;
    const storage = {
      async upload(path, file) {
        await delay();
        if (path.split('/')[0] !== uid()) return err('new row violates row-level security policy', '42501');
        if (file.size > 20 * 1024 * 1024) return err('The object exceeded the maximum allowed size', '413');
        const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
        localStorage.setItem(fileKey(path), data); return { data: { path }, error: null };
      },
      async createSignedUrl(path) {
        await delay(); const db = load();
        if (!(db.items || []).some((i) => i.file_path === path && visible(db, i))) return err('Object not found', '404');
        const blob = await (await fetch(localStorage.getItem(fileKey(path)))).blob();
        return { data: { signedUrl: URL.createObjectURL(blob) }, error: null };
      },
      async download(path) {
        await delay(); const db = load();
        if (!(db.items || []).some((i) => i.file_path === path && visible(db, i))) return err('Object not found', '404');
        return { data: await (await fetch(localStorage.getItem(fileKey(path)))).blob(), error: null };
      },
      async remove(paths) {
        await delay(); const db = load();
        for (const p of paths) if (p.split('/')[0] === uid() || isAdmin(db)) localStorage.removeItem(fileKey(p));
        return { data: [], error: null };
      },
    };
    // Lernpakete: Dateien unter localStorage «mock-paket:<name>», lesbar nur für Schulkonten (wie die Speicher-Regel)
    const member = () => { const db = load(); const u = db.users.find((x) => x.id === uid()); const doms = db.config?.domains || [];
      return Boolean(u) && (db.admin === u.id || (u.confirmed !== false && (!doms.length || doms.includes(u.email.split('@').pop())))); };
    const paketStorage = {
      async download(name) {
        await delay();
        const raw = localStorage.getItem('mock-paket:' + name);
        if (!member() || raw == null) return err('Object not found', '404');
        return { data: new Blob([raw], { type: 'application/json' }), error: null };
      },
    };
    // Klassen (wie RLS: nur Mitglieder sehen Klasse, Mitglieder, Ziele; Statistik nur eigene oder freigegebene)
    function klassen(table) {
      const filters = []; let op = 'select'; let patch = null; let single = false;
      const isMember = (db, cid) => (db.class_members || []).some((m) => m.class_id === cid && m.user_id === uid());
      const q = {
        select() { return q; }, order() { return q; },
        eq(col, v) { filters.push([col, v]); return q; },
        insert(row) { op = 'insert'; patch = row; return q; }, upsert(row) { op = 'upsert'; patch = row; return q; },
        update(p) { op = 'update'; patch = p; return q; }, delete() { op = 'delete'; return q; },
        async maybeSingle() { single = true; return q.run(); },
        then(resolve, reject) { q.run().then(resolve, reject); },
        async run() {
          await delay(); const db = load(); const me = uid();
          db[table] ||= []; const rows = db[table];
          const match = (r) => filters.every(([c, v]) => r[c] === v);
          if (op === 'select') {
            let out = rows.filter(match).filter((r) => {
              const cid = table === 'classes' ? r.id : r.class_id;
              if (!isMember(db, cid)) return table === 'class_stats' && r.user_id === me;
              if (table === 'class_stats') return r.user_id === me || (db.class_members || []).some((m) => m.class_id === r.class_id && m.user_id === r.user_id && m.share_stats);
              return true;
            });
            return { data: single ? out[0] || null : out, error: null };
          }
          if (op === 'insert' || op === 'upsert') {
            const row = { ...patch }; if (table === 'class_goals') { row.id ||= 'g' + Date.now() + Math.random().toString(36).slice(2, 6); row.created_by = me; row.created_at = new Date().toISOString(); }
            if (!isMember(db, row.class_id) || (row.user_id && row.user_id !== me)) return err('new row violates row-level security policy', '42501');
            if (op === 'upsert') { const i = rows.findIndex((r) => r.class_id === row.class_id && r.user_id === row.user_id && r.week === row.week); if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push(row); }
            else rows.push(row);
            save(db); return { data: null, error: null };
          }
          if (op === 'update') { rows.filter(match).forEach((r) => { if (r.user_id === me) Object.assign(r, patch); }); save(db); return { data: null, error: null }; }
          if (op === 'delete') {
            const owner = (cid) => (db.classes || []).some((c) => c.id === cid && c.owner_id === me);
            db[table] = rows.filter((r) => !(match(r) && (table === 'classes' ? r.owner_id === me : table === 'class_members' ? r.role !== 'owner' && (r.user_id === me || owner(r.class_id)) : r.created_by === me || owner(r.class_id))));
            if (table === 'classes') for (const t of ['class_members', 'class_goals', 'class_stats']) db[t] = (db[t] || []).filter((r) => db.classes.some((c) => c.id === r.class_id));
            save(db); return { data: null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return q;
    }
    return {
      auth,
      from(table) {
        // KI-Guthaben (nur lesen, wie mit Row Level Security): db.credits[konto] = { balance, ledger: [] }
        if (table === 'ai_credit' || table === 'ai_ledger') {
          const credit = () => load().credits?.[uid()] || { balance: 0, ledger: [] };
          if (table === 'ai_credit') return { select() { return { async maybeSingle() { await delay(); return { data: uid() ? { balance_rappen: credit().balance } : null, error: null }; } }; } };
          const q = { select() { return q; }, neq() { return q; }, order() { return q; }, limit() { return q; },
            then(resolve) { delay().then(() => resolve({ data: uid() ? [...credit().ledger].reverse() : [], error: null })); } };
          return q;
        }
        if (table === 'library_items' || table === 'library_reports') return library(table);
        if (['classes', 'class_members', 'class_goals', 'class_stats'].includes(table)) return klassen(table);
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
      storage: { from: (bucket) => (bucket === 'pakete' ? paketStorage : storage) },
      async rpc(name, args = {}) {
        if (name === 'create_class' || name === 'join_class') {
          await delay(); const db = load(); const me = uid(); db.classes ||= []; db.class_members ||= [];
          if (!me || !member()) return err('Nur mit bestätigter Schul-E-Mail-Adresse', '42501');
          const u = db.users.find((x) => x.id === me); const nm = u?.user_metadata?.firstName || 'Anonym';
          if (name === 'create_class') {
            const id = '00000000-0000-4000-8000-' + String(db.classes.length + 1).padStart(12, '0');
            const code = 'K' + String(db.classes.length + 1).padStart(5, '2').replace(/[01]/g, '2');
            db.classes.push({ id, name: args.p_name.trim(), code, owner_id: me, created_at: new Date().toISOString() });
            db.class_members.push({ class_id: id, user_id: me, display_name: nm, share_stats: true, role: 'owner', joined_at: new Date().toISOString() });
            save(db); return { data: { id, code }, error: null };
          }
          const c = db.classes.find((x) => x.code === String(args.p_code).trim().toUpperCase());
          if (!c) return err('Code unbekannt', 'P0002');
          if (!db.class_members.some((m) => m.class_id === c.id && m.user_id === me)) db.class_members.push({ class_id: c.id, user_id: me, display_name: nm, share_stats: false, role: 'member', joined_at: new Date().toISOString() });
          save(db); return { data: c.id, error: null };
        }
        await delay();
        if (name === 'is_admin') return { data: Boolean(uid()) && load().admin === uid(), error: null };
        if (name === 'school_domains') return { data: load().config?.domains || [], error: null };
        if (name === 'is_school_member') {
          const db = load(); const u = db.users.find((x) => x.id === uid()); const doms = db.config?.domains || [];
          return { data: Boolean(u) && (db.admin === u.id || (u.confirmed !== false && (!doms.length || doms.includes(u.email.split('@').pop())))), error: null };
        }
        const { base_version, new_data } = args;
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
