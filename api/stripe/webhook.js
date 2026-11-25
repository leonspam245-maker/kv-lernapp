// Bestätigung von Stripe nach einer Zahlung. Nur Meldungen mit gültiger Signatur (STRIPE_WEBHOOK_SECRET) zählen.
// Jede Zahlung wird genau einmal gutgeschrieben (die Datenbank prüft die Stripe-Sitzungsnummer).
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
      const balance = await rpc('ai_topup', { p_secret: process.env.CREDITS_SERVER_SECRET, p_user: userId, p_amount: amount, p_session: s.id });
      return send(res, 200, { received: true, credited: true, balance });
    }
    return send(res, 200, { received: true });
  } catch (e) {
    // Fehler melden, damit Stripe die Zustellung später wiederholt
    return send(res, 500, { error: e.message || 'Gutschrift fehlgeschlagen.' });
  }
}
