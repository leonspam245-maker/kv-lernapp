// KI-Erstellung im Online-Betrieb. Der API-Schlüssel liegt nur als Umgebungsvariable bei Vercel.
import { generateWithAi } from '../../server/ai.js';
import { send, authorizedSettings } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Nur POST erlaubt.' });
  try {
    const settings = await authorizedSettings(req);
    // Sicherheitsnetz: Ohne gespeicherte, bewusste Aktivierung wird nichts übertragen.
    if (!settings.aiConsent) return send(res, 403, { error: 'Der KI-Dienst ist nicht aktiviert. Aktiviere ihn zuerst unter «Einstellungen».' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    return send(res, 200, await generateWithAi({ ...(body || {}), provider: settings.aiProvider || 'claude' }));
  } catch (e) {
    return send(res, e.status || 502, { error: e.message || 'Die KI-Anfrage ist fehlgeschlagen.' });
  }
}
