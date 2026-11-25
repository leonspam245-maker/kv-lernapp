// Meldungen von Stripe. Nur Meldungen mit gültiger Signatur (STRIPE_WEBHOOK_SECRET) zählen.
// - Zahlung abgeschlossen: Guthaben gutschreiben (genau einmal, die Datenbank prüft die Stripe-Sitzungsnummer)
// - Rückerstattung: erstatteten Betrag vom Guthaben abziehen
// - Angefochtene Zahlung (Chargeback): Betrag abziehen; gewinnst du den Fall, wird er zurückgebucht
// Alle Abzüge sind wiederholbar: Stripe darf eine Meldung mehrfach schicken, abgezogen wird trotzdem nur einmal.
import Stripe from 'stripe';
import { send, rpc, rawBody } from '../_shared.js';

export const deps = { stripe: () => new Stripe(process.env.STRIPE_SECRET_KEY) };

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Nur POST erlaubt.' });
  let event;
  try {
    const raw = await rawBody(req);
    event = deps.stripe().webhooks.constructEvent(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return send(res, 400, { error: 'Ungültige Signatur.' });
  }
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const s = event.data.object;
      if (s.payment_status !== 'paid') return send(res, 200, { received: true, credited: false });
      const userId = s.metadata?.user_id || s.client_reference_id;
      const amount = Number(s.metadata?.credit_rappen);
      // Gutgeschrieben wird höchstens der tatsächlich bezahlte Betrag in CHF
      if (!userId || !amount || s.currency !== 'chf' || s.amount_total !== amount) return send(res, 200, { received: true, credited: false, reason: 'Angaben passen nicht' });
      const balance = await rpc('ai_topup', { p_secret: process.env.CREDITS_SERVER_SECRET, p_user: userId, p_amount: amount, p_session: s.id, p_payment_intent: s.payment_intent || null });
      return send(res, 200, { received: true, credited: true, balance });
    }
    if (event.type === 'charge.refunded') {
      const c = event.data.object;
      if (!c.payment_intent || c.currency !== 'chf') return send(res, 200, { received: true, adjusted: false });
      const balance = await rpc('ai_payment_adjust', { p_secret: process.env.CREDITS_SERVER_SECRET, p_payment_intent: c.payment_intent, p_kind: 'refund', p_target: c.amount_refunded || 0 });
      return send(res, 200, { received: true, adjusted: balance !== null, balance });
    }
    if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
      const d = event.data.object;
      if (!d.payment_intent || d.currency !== 'chf') return send(res, 200, { received: true, adjusted: false });
      // Gewonnen (oder nur Vorwarnung geschlossen): nichts abziehen; sonst den angefochtenen Betrag
      const target = ['won', 'warning_closed'].includes(d.status) ? 0 : d.amount || 0;
      const balance = await rpc('ai_payment_adjust', { p_secret: process.env.CREDITS_SERVER_SECRET, p_payment_intent: d.payment_intent, p_kind: 'dispute', p_target: target });
      return send(res, 200, { received: true, adjusted: balance !== null, balance });
    }
    return send(res, 200, { received: true });
  } catch (e) {
    // Fehler melden, damit Stripe die Zustellung später wiederholt
    return send(res, 500, { error: e.message || 'Gutschrift fehlgeschlagen.' });
  }
}
