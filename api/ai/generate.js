// KI-Erstellung im Online-Betrieb. Jede Person schickt ihren eigenen API-Schlüssel mit (Kopfzeile X-AI-Key);
// er wird nur für diese Anfrage weitergereicht und nirgends gespeichert oder protokolliert.
import { generateWithAi } from '../../server/ai.js';
import { send, authorizedSettings } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Nur POST erlaubt.' });
  try {
    const settings = await authorizedSettings(req);
    // Sicherheitsnetz: Ohne gespeicherte, bewusste Aktivierung wird nichts übertragen.
    if (!settings.aiConsent) return send(res, 403, { error: 'Der KI-Dienst ist nicht aktiviert. Aktiviere ihn zuerst unter «Einstellungen».' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { apiKey: _ignored, ...request } = body || {};
    return send(res, 200, await generateWithAi({ ...request, provider: settings.aiProvider || 'claude', apiKey: req.headers['x-ai-key'] }));
  } catch (e) {
    return send(res, e.status || 502, { error: e.message || 'Die KI-Anfrage ist fehlgeschlagen.' });
  }
}
