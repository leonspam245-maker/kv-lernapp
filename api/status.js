import { aiStatus } from '../server/ai.js';
import { send } from './_shared.js';

export default function handler(req, res) {
  send(res, 200, { ok: true, ocrAvailable: true, ai: aiStatus() });
}
