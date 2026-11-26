// Übernahme fertiger Lernpakete in die eigenen Daten
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPaket, hasPaket } from '../public/js/pakete-core.js';

const freshDb = () => ({ subjects: [], topics: [], sources: [], cards: [], contents: [], attempts: [], exams: [], sessions: {} });
let n = 0; const uid = (p) => `${p}${++n}`;
const paket = {
  id: 'lj1-hkb-c-lf4-kaufvertrag', subject: 'HKB c · 1. Lehrjahr', topic: 'Kaufvertrag',
  sources: [{ title: 'Merkblatt: Kaufvertrag', content: '## Pflichten\n- Ware gegen Geld' }],
  cards: [{ term: 'Mängelrüge', def: 'Sofort melden' }, { term: 'Verzug', def: 'Nicht rechtzeitig' }, { term: 'mängelrüge ', def: 'doppelt' }],
  contents: [{ type: 'quiz', title: 'Übung: Kaufvertrag', data: { questions: [{ key: 'q1', type: 'open', points: 2, prompt: 'Was ist ein Kaufvertrag?', model: 'Ware gegen Geld', keywords: [] }] } }],
};

test('Paket anlegen: Fach, Thema, Unterlage, Karten ohne Doppelte, Quiz mit Fragen-IDs', () => {
  const db = freshDb();
  const r = applyPaket(db, paket, { today: '2026-11-26', uid, now: 'x' });
  assert.equal(r.skipped, false);
  assert.equal(db.subjects.length, 1); assert.equal(db.subjects[0].name, 'HKB c · 1. Lehrjahr');
  assert.equal(db.topics[0].subjectId, db.subjects[0].id);
  assert.equal(db.sources[0].origin, 'paket'); assert.equal(db.sources[0].paketId, paket.id);
  assert.equal(db.cards.length, 2, 'gleicher Begriff nur einmal');
  assert.equal(db.cards[0].box, 0); assert.equal(db.cards[0].due, '2026-11-26'); assert.equal(db.cards[0].sourceId, db.sources[0].id);
  const q = db.contents[0].data.questions[0];
  assert.ok(q.id && q.topicId === db.topics[0].id, 'Frage hat ID und Thema');
  assert.deepEqual(db.contents[0].topicIds, [db.topics[0].id]);
  assert.ok(hasPaket(db, paket.id));
});

test('Paket zweimal übernehmen: wird übersprungen; vorhandenes Fach/Thema wird wiederverwendet', () => {
  const db = freshDb();
  db.subjects.push({ id: 'f0', name: 'hkb c · 1. lehrjahr' });
  db.topics.push({ id: 't0', subjectId: 'f0', name: 'Kaufvertrag' });
  db.cards.push({ id: 'k0', topicId: 't0', term: 'Verzug', def: 'eigene Karte' });
  applyPaket(db, paket, { today: '2026-11-26', uid });
  assert.equal(db.subjects.length, 1); assert.equal(db.topics.length, 1);
  assert.equal(db.cards.filter((c) => c.term === 'Verzug').length, 1, 'eigene Karte bleibt, keine Kopie');
  assert.equal(applyPaket(db, paket, { today: '2026-11-26', uid }).skipped, true);
  assert.equal(db.sources.length, 1);
});
