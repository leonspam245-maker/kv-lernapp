// Tests für die Abrechnung über KI-Guthaben (Stripe + Supabase werden nachgebaut).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy';
process.env.CREDITS_SERVER_SECRET = 'server-kennwort-test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-betreiber-dummy';
delete process.env.OPENAI_API_KEY;

const credits = await import('../server/credits.js');
const gen = await import('../api/ai/generate.js');
const checkout = await import('../api/credits/checkout.js');
const webhook = await import('../api/stripe/webhook.js');

// ---------- nachgebautes Supabase ----------
let db;
const calls = [];
beforeEach(() => { db = { balance: 1000, holds: {}, nextHold: 1, ledger: [], consent: true, provider: 'claude' }; calls.length = 0; });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/auth/v1/user')) return opts.headers.Authorization === 'Bearer gut' ? json(200, { id: 'user-1', email: 'leon@example.ch' }) : json(401, {});
  if (u.includes('/rest/v1/app_state')) return json(200, [{ settings: { aiConsent: db.consent, aiProvider: db.provider } }]);
  const m = u.match(/\/rpc\/(\w+)$/);
  if (m) {
    const a = JSON.parse(opts.body); calls.push([m[1], a]);
    if (a.p_secret !== 'server-kennwort-test') return json(403, { message: 'nicht erlaubt' });
    if (m[1] === 'ai_hold') {
      if (db.balance < a.p_amount) return json(400, { message: 'Guthaben reicht nicht', hint: 'guthaben' });
      db.balance -= a.p_amount; const id = db.nextHold++; db.holds[id] = a.p_amount; return json(200, id);
    }
    if (m[1] === 'ai_settle') { db.balance += db.holds[a.p_hold] - a.p_amount; delete db.holds[a.p_hold]; db.ledger.push(['usage', a.p_amount]); return json(200, db.balance); }
    if (m[1] === 'ai_topup') {
      if (db.ledger.some((l) => l[2] === a.p_session)) return json(200, db.balance);
      db.balance += a.p_amount; db.ledger.push(['topup', a.p_amount, a.p_session]); return json(200, db.balance);
    }
  }
  throw new Error('unerwarteter Aufruf ' + u);
};

const fakeRes = () => { const r = { statusCode: 0, body: null, setHeader() {}, end(b) { r.body = JSON.parse(b); } }; return r; };
const req = (body, headers = {}) => ({ method: 'POST', headers: { authorization: 'Bearer gut', host: 'kv-lernapp.vercel.app', ...headers }, body });
const REQUEST = { type: 'quiz', subjectName: 'W&G', topics: [{ id: 't1', name: 'Vertrag' }], sources: [{ id: 's1', title: 'Handout', origin: 'pdf', topicId: 't1', content: 'Antrag und Annahme. '.repeat(200) }] };

test('Preis: Anbieterkosten × Kurs × 3, aufgerundet auf Rappen', () => {
  const cfg = credits.creditConfig({});
  assert.equal(cfg.markup, 3);
  // 10 000 Eingabe- und 2 000 Ausgabe-Tokens bei Claude: 0.04 + 0.04 = USD 0.08 → × 0.85 × 3 = CHF 0.204 → 21 Rappen
  const usd = credits.costUsd('claude', { input: 10000, output: 2000 }, cfg);
  assert.ok(Math.abs(usd - 0.08) < 1e-12);
  assert.equal(credits.chargeRappen(usd, cfg), 21);
  assert.equal(credits.chargeRappen(0, cfg), 1, 'mindestens 1 Rappen');
  assert.equal(credits.creditConfig({ AI_MARKUP: '4' }).markup, 4, 'Faktor anpassbar');
  assert.ok(credits.holdRappen('claude', 30000, cfg) >= credits.chargeRappen(credits.costUsd('claude', { input: 12000, output: 32000 }, cfg), cfg));
});

test('Guthaben: reserviert, rechnet den tatsächlichen Preis ab und bucht den Rest zurück', async () => {
  gen.deps.generate = async (r) => { assert.equal(r.apiKey, 'sk-ant-betreiber-dummy'); assert.equal(r.billed, true); return { data: { questions: [] }, model: 'claude-opus-5-5', usage: { input: 10000, output: 2000 } }; };
  const res = fakeRes();
  await gen.default(req(REQUEST), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.billing.charged, 21);
  assert.equal(res.body.billing.balance, 1000 - 21);
  assert.equal(db.balance, 979);
  assert.deepEqual(calls.map((c) => c[0]), ['ai_hold', 'ai_settle']);
});

test('Guthaben: Fehler des KI-Dienstes kostet nichts', async () => {
  gen.deps.generate = async () => { throw Object.assign(new Error('KI-Dienst meldet Fehler'), { status: 502 }); };
  const res = fakeRes();
  await gen.default(req(REQUEST), res);
  assert.equal(res.statusCode, 502);
  assert.equal(db.balance, 1000, 'Reservation zurückgebucht');
  assert.equal(calls.at(-1)[1].p_amount, 0);
});

test('Guthaben reicht nicht: 402 mit verständlicher Meldung, keine KI-Anfrage', async () => {
  db.balance = 5;
  let called = false; gen.deps.generate = async () => { called = true; };
  const res = fakeRes();
  await gen.default(req(REQUEST), res);
  assert.equal(res.statusCode, 402);
  assert.match(res.body.error, /Guthaben reicht nicht/);
  assert.equal(called, false);
});

test('Ohne Aktivierung oder Anmeldung keine Anfrage; Anbieter ohne Server-Zugang wird abgelehnt', async () => {
  db.consent = false; let res = fakeRes(); await gen.default(req(REQUEST), res); assert.equal(res.statusCode, 403);
  db.consent = true; res = fakeRes(); await gen.default(req(REQUEST, { authorization: 'Bearer falsch' }), res); assert.equal(res.statusCode, 401);
  db.provider = 'chatgpt'; res = fakeRes(); await gen.default(req(REQUEST), res); assert.equal(res.statusCode, 503); assert.match(res.body.error, /ChatGPT/);
});

test('Eigener Schlüssel: kein Guthaben belastet', async () => {
  gen.deps.generate = async (r) => { assert.equal(r.apiKey, 'sk-ant-eigener-0123456789abcdefghij'); assert.ok(!r.billed); return { data: {}, usage: { input: 1, output: 1 } }; };
  const res = fakeRes();
  await gen.default(req(REQUEST, { 'x-ai-key': 'sk-ant-eigener-0123456789abcdefghij' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 0);
  assert.equal(res.body.billing, undefined);
});

test('Aufladen: nur angebotene Beträge, Zahlungsseite mit Konto und Betrag', async () => {
  let params;
  checkout.deps.stripe = () => ({ checkout: { sessions: { create: async (p) => { params = p; return { url: 'https://checkout.stripe.com/c/pay/test' }; } } } });
  let res = fakeRes(); await checkout.default(req({ amount: 123 }), res); assert.equal(res.statusCode, 400);
  res = fakeRes(); await checkout.default(req({ amount: 1000 }), res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.url, 'https://checkout.stripe.com/c/pay/test');
  assert.equal(params.line_items[0].price_data.currency, 'chf');
  assert.equal(params.line_items[0].price_data.unit_amount, 1000);
  assert.equal(params.metadata.user_id, 'user-1');
  assert.equal(params.success_url, 'https://kv-lernapp.vercel.app/?guthaben=ok#/einstellungen');
});

test('Stripe-Bestätigung: gültige Signatur schreibt einmal gut, gefälschte wird abgelehnt', async () => {
  const stripe = new Stripe('sk_test_dummy');
  webhook.deps.stripe = () => stripe;
  const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_42', payment_status: 'paid', currency: 'chf', amount_total: 1000, client_reference_id: 'user-1', metadata: { user_id: 'user-1', credit_rappen: '1000' } } } };
  const payload = JSON.stringify(event);
  const send = async (body, sig) => { const res = fakeRes(); const r = { method: 'POST', headers: { 'stripe-signature': sig }, async *[Symbol.asyncIterator]() { yield Buffer.from(body); } }; await webhook.default(r, res); return res; };
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_dummy' });
  let res = await send(payload, sig);
  assert.equal(res.statusCode, 200); assert.equal(res.body.credited, true); assert.equal(db.balance, 2000);
  res = await send(payload, sig); // Stripe stellt dieselbe Meldung nochmals zu
  assert.equal(db.balance, 2000, 'nicht doppelt gutgeschrieben');
  const fake = JSON.stringify({ ...event, data: { object: { ...event.data.object, id: 'cs_fake', amount_total: 100000, metadata: { user_id: 'user-1', credit_rappen: '100000' } } } });
  res = await send(fake, sig);
  assert.equal(res.statusCode, 400, 'Signatur passt nicht zum veränderten Inhalt');
  const mismatch = JSON.stringify({ ...event, data: { object: { ...event.data.object, id: 'cs_2', amount_total: 500 } } });
  res = await send(mismatch, stripe.webhooks.generateTestHeaderString({ payload: mismatch, secret: 'whsec_test_dummy' }));
  assert.equal(res.body.credited, false, 'Gutschrift nur in Höhe der Zahlung');
  assert.equal(db.balance, 2000);
});
