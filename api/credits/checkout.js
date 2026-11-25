// Guthaben aufladen: erstellt eine Zahlungsseite bei Stripe (Stripe Checkout) und liefert deren Adresse.
// Gutgeschrieben wird erst, wenn Stripe die Zahlung bestätigt (siehe api/stripe/webhook.js).
import Stripe from 'stripe';
import { PACKS, creditsEnabled } from '../../server/credits.js';
import { send, authorizedUser } from '../_shared.js';

export const deps = { stripe: () => new Stripe(process.env.STRIPE_SECRET_KEY) };

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Nur POST erlaubt.' });
  try {
    if (!creditsEnabled()) return send(res, 503, { error: 'Das Aufladen ist noch nicht eingerichtet.' });
    const { user } = await authorizedUser(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const amount = Number(body?.amount);
    if (!PACKS.includes(amount)) return send(res, 400, { error: 'Bitte einen der angebotenen Beträge wählen.' });
    const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const session = await deps.stripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'chf', unit_amount: amount, product_data: { name: `KI-Guthaben Lernapp CHF ${(amount / 100).toFixed(2)}`, description: 'Guthaben für KI-Erstellungen in der KV-Lernapp' } } }],
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      metadata: { user_id: user.id, credit_rappen: String(amount) },
      payment_intent_data: { metadata: { user_id: user.id, credit_rappen: String(amount) } },
      locale: 'de',
      success_url: `${origin}/?guthaben=ok#/einstellungen`,
      cancel_url: `${origin}/?guthaben=abbruch#/einstellungen`,
    });
    return send(res, 200, { url: session.url });
  } catch (e) {
    return send(res, e.status && e.status < 500 ? e.status : 502, { error: e.type?.startsWith('Stripe') ? 'Stripe ist gerade nicht erreichbar oder nicht richtig eingerichtet. Bitte später erneut versuchen.' : (e.message || 'Aufladen fehlgeschlagen.') });
  }
}
