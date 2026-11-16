// Optionale KI-Generierung über die Claude API (Anthropic).
// Der Schlüssel wird nur serverseitig aus .env gelesen und nie an den Browser geschickt.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = () => process.env.CLAUDE_MODEL || 'claude-opus-5-5';

export function aiStatus() {
  return { configured: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL(), provider: 'Anthropic (Claude API)' };
}

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const REFS = {
  type: 'array',
  items: { type: 'object', additionalProperties: false, required: ['sourceId', 'page'], properties: { sourceId: { type: 'string' }, page: nullable({ type: 'integer' }) } },
};
const QUESTION = {
  type: 'object', additionalProperties: false,
  required: ['type', 'topicId', 'prompt', 'options', 'answer', 'answerBool', 'pairs', 'model', 'keywords', 'explanation', 'points', 'refs', 'uncertain'],
  properties: {
    type: { type: 'string', enum: ['mc', 'tf', 'match', 'open'] },
    topicId: { type: 'string' },
    prompt: { type: 'string' },
    options: nullable({ type: 'array', items: { type: 'string' } }),
    answer: nullable({ type: 'integer' }),
    answerBool: nullable({ type: 'boolean' }),
    pairs: nullable({ type: 'array', items: { type: 'object', additionalProperties: false, required: ['left', 'right'], properties: { left: { type: 'string' }, right: { type: 'string' } } } }),
    model: nullable({ type: 'string' }),
    keywords: nullable({ type: 'array', items: { type: 'string' } }),
    explanation: { type: 'string' },
    points: { type: 'integer' },
    refs: REFS,
    uncertain: nullable({ type: 'string' }),
  },
};
const SCHEMAS = {
  merkblatt: {
    type: 'object', additionalProperties: false, required: ['sections', 'differences', 'examples', 'conflicts', 'gaps'],
    properties: {
      sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['heading', 'items'], properties: {
        heading: { type: 'string' },
        items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['term', 'def', 'refs'], properties: { term: { type: 'string' }, def: { type: 'string' }, refs: REFS } } },
      } } },
      differences: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'refs'], properties: { text: { type: 'string' }, refs: REFS } } },
      examples: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'refs', 'own'], properties: { text: { type: 'string' }, refs: REFS, own: { type: 'boolean' } } } },
      conflicts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['term', 'variants'], properties: {
        term: { type: 'string' },
        variants: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['def', 'refs'], properties: { def: { type: 'string' }, refs: REFS } } },
      } } },
      gaps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } } },
    },
  },
  quiz: { type: 'object', additionalProperties: false, required: ['questions'], properties: { questions: { type: 'array', items: QUESTION } } },
  exam: { type: 'object', additionalProperties: false, required: ['questions'], properties: { questions: { type: 'array', items: QUESTION } } },
  cards: { type: 'object', additionalProperties: false, required: ['cards'], properties: { cards: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['topicId', 'term', 'def', 'refs'], properties: { topicId: { type: 'string' }, term: { type: 'string' }, def: { type: 'string' }, refs: REFS },
  } } } },
};

const TASKS = {
  merkblatt: 'Erstelle ein Merkblatt: Abschnitte mit Definitionen (Begriff + Erklärung), wichtige Unterschiede und verständliche Beispiele.',
  quiz: 'Erstelle ein Quiz mit 10 abwechslungsreichen Fragen: Multiple Choice (type "mc", 4 Optionen, answer = Index), Richtig/Falsch ("tf", answerBool), Zuordnung ("match", 3–5 pairs) und kurze offene Fragen ("open", model = Musterlösung, keywords = 3–6 Schlüsselbegriffe). points = 1 bei mc/tf, Anzahl Paare bei match, 2–4 bei open.',
  exam: 'Erstelle eine Probeprüfung mit 8–12 Aufgaben in gemischten Typen wie beim Quiz, mit realistischer Punkteverteilung (Total ca. 30 Punkte). Offene Aufgaben brauchen eine vollständige Musterlösung und Schlüsselbegriffe.',
  cards: 'Erstelle 10–25 Karteikarten (Begriff auf der Vorderseite, kurze Definition auf der Rückseite).',
};

const SYSTEM = `Du erstellst Lernmaterial für eine kaufmännische Lernende (KV-Lehre, Wirtschaftsschule KV Chur, Schweiz).
Regeln:
- Schreibe Deutsch mit Schweizer Rechtschreibung (ss statt ß).
- Leite alle fachlichen Aussagen und Lösungen ausschliesslich aus den gelieferten Unterlagen ab. Verwende deren Begriffe und Einteilungen.
- Jede Aussage bekommt refs mit der sourceId und, falls vorhanden, der Seitenzahl (page) der Unterlage, auf die sie sich stützt.
- Fehlt eine Information in den Unterlagen, erfinde nichts: Nenne die Lücke in "gaps" bzw. im Feld "uncertain" der Frage.
- Widersprechen sich Unterlagen, nenne beide Varianten in "conflicts" (Merkblatt) bzw. im Feld "uncertain".
- Beispiele aus Büroalltag, Gästeberatung oder Tourismus sind willkommen. Selbst erstellte Beispiele markierst du mit own=true und refs=[] oder den Quellen, auf deren Regel sie beruhen.
- Verwende bei topicId exakt eine der angegebenen Themen-IDs.`;

function buildDocument(sources) {
  return sources.map((s) => {
    const body = s.pages?.length
      ? s.pages.map((p) => `[Seite ${p.n}]\n${p.text}`).join('\n\n')
      : (s.content || '');
    return `<unterlage sourceId="${s.id}" titel="${escapeAttr(s.title)}" herkunft="${s.origin}" themaId="${s.topicId}">\n${body}\n</unterlage>`;
  }).join('\n\n');
}
const escapeAttr = (t) => String(t || '').replace(/"/g, "'");

export async function generateWithAi({ type, subjectName, topics, sources }) {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('Kein API-Schlüssel eingerichtet (ANTHROPIC_API_KEY in der Datei .env).'), { status: 400 });
  if (!SCHEMAS[type]) throw Object.assign(new Error('Unbekannter Inhaltstyp.'), { status: 400 });
  if (!Array.isArray(sources) || !sources.length) throw Object.assign(new Error('Keine Unterlagen ausgewählt.'), { status: 400 });

  const client = new Anthropic();
  const topicList = (topics || []).map((t) => `- ${t.name} (ID: ${t.id})`).join('\n');
  const user = `Fach: ${subjectName}\nThemen:\n${topicList}\n\nAuftrag: ${TASKS[type]}\n\nUnterlagen:\n${buildDocument(sources)}`;

  let message;
  try {
    const stream = client.beta.messages.stream({
      model: MODEL(),
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMAS[type] } },
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
    message = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw Object.assign(new Error('Der API-Schlüssel wurde abgelehnt. Prüfe ANTHROPIC_API_KEY in der Datei .env.'), { status: 401 });
    if (e instanceof Anthropic.RateLimitError) throw Object.assign(new Error('Zu viele Anfragen oder Guthaben aufgebraucht. Bitte später erneut versuchen.'), { status: 429 });
    if (e instanceof Anthropic.APIConnectionError) throw Object.assign(new Error('Keine Verbindung zum KI-Dienst. Internetverbindung prüfen.'), { status: 503 });
    if (e instanceof Anthropic.APIError) throw Object.assign(new Error(`KI-Dienst meldet Fehler ${e.status}: ${e.message}`), { status: 502 });
    throw e;
  }
  if (message.stop_reason === 'refusal') throw Object.assign(new Error('Der KI-Dienst hat die Anfrage abgelehnt.'), { status: 422 });
  if (message.stop_reason === 'max_tokens') throw Object.assign(new Error('Die Antwort war zu lang. Bitte weniger Unterlagen auswählen.'), { status: 422 });
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return { data: JSON.parse(text), model: message.model, usage: message.usage };
  } catch {
    throw Object.assign(new Error('Die KI-Antwort war nicht lesbar. Bitte erneut versuchen.'), { status: 502 });
  }
}
