// Abrechnung des KI-Dienstes: Guthaben (über Stripe aufgeladen, Abrechnung durch die Lernapp)
// oder eigener API-Schlüssel. Guthaben gibt es nur online und nur, wenn der Betreiber es eingerichtet hat.
import { store } from './store.js';
import { isCloud } from './backend.js';
import { hasAiKey } from './aikeys.js';

export const creditsInfo = () => store.server.ai?.credits || { enabled: false, providers: {} };
export const creditsAvailable = () => isCloud() && Boolean(creditsInfo().enabled);
/** 'credit' oder 'own' */
export const billingMode = () => (creditsAvailable() && store.db.settings.aiBilling !== 'own' ? 'credit' : 'own');
/** Kann mit dem gewählten Anbieter und der gewählten Abrechnung KI genutzt werden? */
export function aiAccess(provider) {
  if (billingMode() === 'credit') return Boolean(creditsInfo().providers?.[provider]);
  return hasAiKey(provider);
}
export const chf = (rappen) => `CHF ${(Number(rappen || 0) / 100).toFixed(2)}`;
