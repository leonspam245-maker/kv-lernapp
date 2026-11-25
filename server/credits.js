// KI-Guthaben: Preisberechnung für die Abrechnung über Stripe.
// Preis für die Person = Anbieterkosten (USD) × Umrechnungskurs (CHF/USD) × Faktor (Standard 3).
// Alle Werte lassen sich über Umgebungsvariablen bei Vercel anpassen, ohne den Code zu ändern.

/** Pakete zum Aufladen in Rappen (Kartengebühr bei Stripe: 2,9 % + CHF 0.30 pro Zahlung). */
export const PACKS = [500, 1000, 2000];
/** Höchstzahl Ausgabe-Tokens pro Anfrage (begrenzt auch die Reservation). */
export const MAX_OUTPUT_TOKENS = 32000;
/** Ausgabegrenze für die Bewertung offener Antworten (kurz, daher kleine Reservation). */
export const GRADE_MAX_TOKENS = 4000;

const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);

export function creditConfig(env = process.env) {
  return {
    markup: num(env.AI_MARKUP, 3),
    usdChf: num(env.USD_CHF, 0.85),
    // USD pro Million Tokens (Eingabe / Ausgabe)
    prices: {
      claude: { in: num(env.CLAUDE_PRICE_IN, 4), out: num(env.CLAUDE_PRICE_OUT, 20) },
      chatgpt: { in: num(env.OPENAI_PRICE_IN, 2), out: num(env.OPENAI_PRICE_OUT, 10) },
    },
  };
}

/** Ist die Abrechnung über Guthaben vollständig eingerichtet? */
export function creditsEnabled(env = process.env) {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.CREDITS_SERVER_SECRET);
}
/** Für welche Anbieter liegt ein Schlüssel des Betreibers auf dem Server? */
export function serverProviders(env = process.env) {
  return { claude: Boolean(env.ANTHROPIC_API_KEY), chatgpt: Boolean(env.OPENAI_API_KEY) };
}
export const serverKeyFor = (provider, env = process.env) => (provider === 'chatgpt' ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY) || '';

export function costUsd(provider, usage, cfg = creditConfig()) {
  const p = cfg.prices[provider === 'chatgpt' ? 'chatgpt' : 'claude'];
  return ((usage?.input || 0) * p.in + (usage?.output || 0) * p.out) / 1e6;
}
/** Betrag in Rappen, aufgerundet, mindestens 1 Rappen. */
export function chargeRappen(usd, cfg = creditConfig()) {
  return Math.max(1, Math.ceil(usd * cfg.usdChf * cfg.markup * 100 - 1e-9));
}
/** Höchstbetrag, der vor einer Anfrage reserviert wird (Eingabe grob geschätzt, Ausgabe maximal). */
export function holdRappen(provider, inputChars, cfg = creditConfig(), maxOutput = MAX_OUTPUT_TOKENS) {
  const input = Math.ceil((inputChars || 0) / 2.5) + 4000; // Text + Anweisungen und Schema
  return chargeRappen(costUsd(provider, { input, output: maxOutput }, cfg), cfg);
}

export function creditStatus(env = process.env) {
  const cfg = creditConfig(env);
  return { enabled: creditsEnabled(env), providers: serverProviders(env), markup: cfg.markup, usdChf: cfg.usdChf, prices: cfg.prices, packs: PACKS };
}
