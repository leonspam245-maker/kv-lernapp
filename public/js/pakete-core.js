// Übernahme eines fertigen Lernpakets in die eigenen Daten (ohne Oberfläche, testbar).
// Ein Paket: { id, title, subject, topic, sources:[{title, content}], cards:[{term, def}], contents:[{type:'quiz'|'exam', title, data}] }
import { newCard } from './srs.js';

/** Ist das Paket schon übernommen? (erkennbar an paketId auf Unterlagen, Karten oder Inhalten) */
export const hasPaket = (db, id) => db.sources.some((s) => s.paketId === id) || db.contents.some((c) => c.paketId === id) || db.cards.some((c) => c.paketId === id);

/**
 * Paket in db übernehmen (läuft innerhalb von commit, darf mehrfach ausgeführt werden).
 * Fach und Thema werden wiederverwendet, wenn es sie mit gleichem Namen schon gibt. Bereits übernommene Pakete werden übersprungen.
 * Gibt eine kurze Zusammenfassung zurück.
 */
export function applyPaket(db, paket, { today, uid, now = new Date().toISOString() }) {
  if (hasPaket(db, paket.id)) return { skipped: true };
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  let subject = db.subjects.find((s) => same(s.name, paket.subject));
  if (!subject) { subject = { id: uid('f'), name: paket.subject, createdAt: now }; db.subjects.push(subject); }
  let topic = db.topics.find((t) => t.subjectId === subject.id && same(t.name, paket.topic));
  if (!topic) { topic = { id: uid('t'), subjectId: subject.id, name: paket.topic, createdAt: now }; db.topics.push(topic); }

  const sources = (paket.sources || []).map((s) => ({ id: uid('s'), subjectId: subject.id, topicId: topic.id, title: s.title, origin: 'paket', content: s.content, createdAt: now, paketId: paket.id }));
  db.sources.push(...sources);
  const sourceId = sources[0]?.id || null;

  const known = new Set(db.cards.filter((c) => c.topicId === topic.id).map((c) => c.term.trim().toLowerCase()));
  const cards = [];
  for (const c of paket.cards || []) {
    const key = c.term.trim().toLowerCase();
    if (known.has(key)) continue; // gleicher Begriff im gleichen Thema nur einmal
    known.add(key);
    cards.push({ ...newCard({ id: uid('k'), topicId: topic.id, sourceId, term: c.term, def: c.def, origin: 'paket' }, today), paketId: paket.id });
  }
  db.cards.push(...cards);

  const contents = (paket.contents || []).map((c) => ({
    id: uid('i'), type: c.type, title: c.title, topicIds: [topic.id], sourceIds: sources.map((s) => s.id), engine: 'paket', createdAt: now, paketId: paket.id,
    data: { ...c.data, questions: (c.data.questions || []).map((q) => ({ ...q, id: uid('q'), topicId: topic.id, refs: sourceId ? [{ sourceId, page: null }] : [] })) },
  }));
  db.contents.push(...contents);
  return { skipped: false, subjectId: subject.id, topicId: topic.id, sources: sources.length, cards: cards.length, contents: contents.length };
}
