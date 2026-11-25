// KI-Erstellung im Online-Betrieb, auf zwei Arten:
// 1. Mit eigenem Schlüssel (Kopfzeile X-AI-Key): nur für diese Anfrage weitergereicht, nirgends gespeichert.
// 2. Mit Guthaben: Anfrage mit dem Schlüssel des Betreibers (Umgebungsvariable bei Vercel), vorher wird
//    der Höchstbetrag reserviert, danach der tatsächliche Preis abgerechnet und der Rest zurückgebucht.
import { generateWithAi, requestChars, maxTokensFor } from '../../server/ai.js';
import { creditsEnabled, creditConfig, costUsd, chargeRappen, holdRappen, serverKeyFor } from '../../server/credits.js';
import { send, authorizedUser, rpc, chf } from '../_shared.js';

export const deps = { generate: generateWithAi };

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Nur POST erlaubt.' });
  try {
    const { settings, auth } = await authorizedUser(req);
    // Sicherheitsnetz: Ohne gespeicherte, bewusste Aktivierung wird nichts übertragen.
    if (!settings.aiConsent) return send(res, 403, { error: 'Der KI-Dienst ist nicht aktiviert. Aktiviere ihn zuerst unter «Einstellungen».' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { apiKey: _ignored, ...request } = body || {};
    const provider = settings.aiProvider === 'chatgpt' ? 'chatgpt' : 'claude';

    const ownKey = req.headers['x-ai-key'];
    if (ownKey) return send(res, 200, await deps.generate({ ...request, provider, apiKey: ownKey }));

    // Abrechnung über Guthaben
    if (!creditsEnabled()) return send(res, 503, { error: 'Die Abrechnung über Guthaben ist noch nicht eingerichtet. Nutze einen eigenen Schlüssel.' });
    const serverKey = serverKeyFor(provider);
    if (!serverKey) return send(res, 503, { error: `Für ${provider === 'chatgpt' ? 'ChatGPT' : 'Claude'} ist kein Guthaben-Zugang eingerichtet. Wähle den anderen Anbieter oder nutze einen eigenen Schlüssel.` });
    const cfg = creditConfig();
    const secret = process.env.CREDITS_SERVER_SECRET;
    const hold = holdRappen(provider, requestChars(request), cfg, maxTokensFor(request.type));
    let holdId;
    try {
      holdId = await rpc('ai_hold', { p_secret: secret, p_amount: hold, p_provider: provider }, auth);
    } catch (e) {
      if (e.db?.hint === 'guthaben') return send(res, 402, { error: `Dein Guthaben reicht nicht. Für diese Erstellung werden bis zu ${chf(hold)} reserviert; abgerechnet wird nur der tatsächliche Verbrauch. Lade dein Guthaben unter «Einstellungen» auf.`, hold });
      throw e;
    }
    let result;
    try {
      result = await deps.generate({ ...request, provider, apiKey: serverKey, billed: true });
    } catch (e) {
      await rpc('ai_settle', { p_secret: secret, p_hold: holdId, p_amount: 0, p_cost_usd: null, p_model: null, p_in: null, p_out: null }, auth).catch(() => {});
      throw e;
    }
    const usd = costUsd(provider, result.usage, cfg);
    const charged = Math.min(chargeRappen(usd, cfg), hold);
    const balance = await rpc('ai_settle', {
      p_secret: secret, p_hold: holdId, p_amount: charged, p_cost_usd: Number(usd.toFixed(6)),
      p_model: result.model || null, p_in: result.usage?.input ?? null, p_out: result.usage?.output ?? null,
    }, auth);
    return send(res, 200, { ...result, billing: { charged, balance } });
  } catch (e) {
    return send(res, e.status || 502, { error: e.message || 'Die KI-Anfrage ist fehlgeschlagen.' });
  }
}
