// Unit-Tests der Kernlogik: node --test tests/unit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, moveUnit } from '../public/js/planner.js';
import { extract, buildMerkblatt, buildQuestions, grade, gradeOpen, swissGrade, collect } from '../public/js/gen.js';
import { rateCard, newCard, sessionQueue } from '../public/js/srs.js';
import { addDays, weekdayIndex, fmtDate, parseDate, seededRng } from '../public/js/util.js';

const TODAY = '2026-11-16'; // Montag
const pdfSource = {
  id: 's1', title: '[Beispiel] Handout Vertragsrecht', origin: 'pdf', topicId: 't1',
  pages: [
    { n: 1, text: 'Vertragsentstehung\nAntrag: Verbindliches Angebot einer Partei, einen bestimmten Vertrag abzuschliessen.\nAnnahme: Zustimmung der anderen Partei zum Antrag innert der\nAnnahmefrist.\nZum Beispiel: Ein Gast bestellt per E-Mail eine Führung.' },
    { n: 2, text: 'Formvorschriften\nFormfreiheit: Verträge sind grundsätzlich an keine Form gebunden (Art. 11 OR).\nIm Gegensatz zum Werkvertrag schuldet der Beauftragte nur sorgfältiges Tätigwerden.' },
  ],
};
const noteSource = { id: 's2', title: 'Notizen', origin: 'onenote', topicId: 't1', content: '# Begriffe\n- Antrag: Mündliche Einladung zu einem Gespräch über Ferienwohnungen im Prättigau.\n\n| Mangel | Folge | Frist |\n|---|---|---|\n| Nichtigkeit | ungültig | keine |' };

test('Datumshilfen im Schweizer Format', () => {
  assert.equal(fmtDate('2026-11-28'), '28.11.2026');
  assert.equal(parseDate('28.11.2026'), '2026-11-28');
  assert.equal(weekdayIndex(TODAY), 0);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('Definitionen, Beispiele und Unterschiede mit Seitenverweis', () => {
  const e = extract(pdfSource);
  const annahme = e.defs.find((d) => d.term === 'Annahme');
  assert.ok(annahme, 'Annahme erkannt');
  assert.match(annahme.def, /Annahmefrist/, 'umgebrochene Zeile zusammengefügt');
  assert.deepEqual(annahme.refs, [{ sourceId: 's1', page: 1 }]);
  assert.equal(e.defs.find((d) => d.term === 'Formfreiheit').refs[0].page, 2);
  assert.equal(e.examples.length, 1);
  assert.equal(e.differences.length, 1);
});

test('Widersprüche zwischen Quellen werden sichtbar', () => {
  const k = collect([pdfSource, noteSource]);
  assert.equal(k.conflicts.length, 1);
  assert.equal(k.conflicts[0].term, 'Antrag');
  const m = buildMerkblatt([pdfSource, noteSource], { t1: { name: 'Vertragsrecht' } });
  assert.equal(m.conflicts.length, 1);
  assert.equal(m.tables.length, 1, 'Vergleichstabelle übernommen');
});

test('Kein Begriff aus Satzanfängen, Beispielspalte ist kein Widerspruch', () => {
  const handout = { id: 'h1', title: 'Handout', origin: 'pdf', topicId: 't1', pages: [{ n: 1, text: 'Formfreiheit: Verträge sind grundsätzlich an keine Form gebunden (Art. 11 OR).\nDas Tourismusbüro bestätigt am gleichen Tag. Damit ist der Vertrag zustande gekommen.' }] };
  const aufgaben = { id: 'a1', title: 'Aufgaben', origin: 'mykv', topicId: 't1', content: '| Begriff | Beispiel |\n| --- | --- |\n| Formfreiheit | Reservation per Telefon |' };
  const e = extract(handout);
  assert.equal(e.defs.some((d) => d.term === 'Damit'), false, '«Damit» ist kein Begriff');
  assert.ok(e.defs.some((d) => d.term === 'Formfreiheit'));
  const k = collect([handout, aufgaben]);
  assert.equal(k.conflicts.length, 0, 'Definition und Beispiel widersprechen sich nicht');
  assert.ok(k.examples.some((x) => /Reservation per Telefon/.test(x.text)), 'Beispiel bleibt erhalten');
});

test('Quiz: abwechslungsreiche Typen und korrekte Bewertung', () => {
  const src = { id: 'q', title: 'Quizlet', origin: 'quizlet', topicId: 't1', cards: [
    { term: 'Kaufvertrag', def: 'Übergabe einer Sache und Eigentumsverschaffung gegen Kaufpreis' },
    { term: 'Mietvertrag', def: 'Überlassung einer Sache zum Gebrauch gegen Mietzins' },
    { term: 'Werkvertrag', def: 'Herstellung eines Werkes gegen Vergütung, geschuldet ist der Erfolg' },
    { term: 'Gebrauchsleihe', def: 'Unentgeltliche Überlassung einer Sache zum Gebrauch' },
    { term: 'Auftrag', def: 'Sorgfältiges Tätigwerden ohne geschuldeten Erfolg' },
  ] };
  const qs = buildQuestions([src], 'quiz', () => 'Quizlet', seededRng(7));
  const types = new Set(qs.map((q) => q.type));
  assert.ok(types.has('mc') && types.has('tf') && types.has('open') && types.has('match'), [...types].join(','));
  const mc = qs.find((q) => q.type === 'mc');
  assert.equal(grade(mc, mc.answer).points, 1);
  assert.equal(grade(mc, (mc.answer + 1) % mc.options.length).points, 0);
  const match = qs.find((q) => q.type === 'match');
  assert.equal(grade(match, match.pairs.map((_, i) => i)).points, match.pairs.length);
});

test('Offene Antwort: eindeutig richtig oder zur Selbstbewertung', () => {
  const q = { type: 'open', points: 3, model: 'Überlassung einer Sache zum Gebrauch gegen Mietzins', keywords: ['uberlassung', 'sache', 'gebrauch', 'mietzins'] };
  assert.equal(gradeOpen('Man überlässt eine Sache zum Gebrauch und zahlt Mietzins', q).status, 'richtig');
  assert.equal(gradeOpen('Man zahlt Geld', q).status, 'unklar');
  assert.equal(gradeOpen('', q).points, 0);
  assert.equal(swissGrade(24, 30), 5);
});

test('Karteikarten: «Noch üben» kommt früher wieder', () => {
  let c = newCard({ id: 'c', topicId: 't', term: 'A', def: 'B' }, TODAY);
  c = rateCard(c, true, TODAY); assert.equal(c.due, '2026-11-17');
  c = rateCard(c, true, '2026-11-17'); assert.equal(c.due, '2026-11-20');
  c = rateCard(c, false, '2026-11-20'); assert.equal(c.box, 0); assert.equal(c.due, '2026-11-20');
  const q = sessionQueue([{ ...c, id: 'x', box: 2, due: '2026-11-19' }, c], '2026-11-20');
  assert.equal(q[0].box, 0);
});

const exam = {
  date: '2026-11-26', topicIds: ['a', 'b', 'c'], difficultTopicIds: ['b'],
  minutesByWeekday: [60, 30, 0, 45, 30, 90, 0],
  blocked: [{ date: '2026-11-17', reason: 'ÜK' }],
};
const info = { a: { name: 'Vertragsarten', cardCount: 12 }, b: { name: 'Vertragsentstehung', cardCount: 6 }, c: { name: 'Willensmängel', cardCount: 0 } };

test('Lernplan: gesperrter Tag bleibt frei, Selbsttest vor der Prüfung, Kapazität eingehalten', () => {
  const plan = buildPlan({ exam, topicInfo: info, today: TODAY });
  assert.equal(plan.units.filter((u) => u.date === '2026-11-17').length, 0, 'ÜK-Tag gesperrt');
  assert.ok(plan.units.every((u) => u.date < exam.date));
  const test = plan.units.find((u) => u.kind === 'selbsttest');
  assert.ok(test && test.date >= '2026-11-21', 'Selbsttest spät eingeplant: ' + test?.date);
  for (const d of plan.days) {
    const used = plan.units.filter((u) => u.date === d.date).reduce((s, u) => s + u.minutes, 0);
    assert.ok(used <= d.capacity, `${d.date}: ${used} > ${d.capacity}`);
  }
  assert.equal(plan.units.filter((u) => u.topicId === 'b' && u.kind === 'wiederholen').length, 2, 'schwieriges Thema 2× wiederholt');
  const learnA = plan.units.find((u) => u.topicId === 'a' && u.kind === 'erarbeiten');
  assert.match(learnA.task, /Vertragsarten erarbeiten: Merkblatt durcharbeiten und \d+ Karteikarten beantworten/);
  const firstReviewA = plan.units.find((u) => u.topicId === 'a' && u.kind === 'wiederholen');
  assert.ok(firstReviewA.date > learnA.date, 'Wiederholung nach dem Erarbeiten');
});

test('Lernplan: knappe Zeit → Priorität und Liste ohne Platz', () => {
  const tight = { ...exam, minutesByWeekday: [30, 0, 0, 0, 0, 0, 0], date: '2026-11-24' };
  const plan = buildPlan({ exam: tight, topicInfo: info, today: TODAY });
  assert.ok(plan.unplaced.length > 0);
  const learnedFirst = plan.units.find((u) => u.kind === 'erarbeiten');
  assert.equal(learnedFirst.topicId, 'b', 'schwieriges Thema hat Vorrang');
});

test('Neuberechnung: Erledigtes und Verschobenes bleibt, Quizfehler erhöhen Wiederholungen', () => {
  const first = buildPlan({ exam, topicInfo: info, today: TODAY });
  const done = first.units.find((u) => u.date === TODAY);
  const units = first.units.map((u) => (u.id === done.id ? { ...u, done: true, result: 'Quiz 6/8' } : u));
  const movable = units.find((u) => !u.done && u.kind === 'wiederholen');
  const moved = moveUnit(units, movable.id, '2026-11-23');
  const next = buildPlan({ exam, topicInfo: info, today: '2026-11-18', previous: moved, stats: { [done.topicId]: { errorRate: 0.5 } } });
  const keptDone = next.units.find((u) => u.id === done.id);
  assert.ok(keptDone?.done && keptDone.result === 'Quiz 6/8');
  assert.equal(next.units.find((u) => u.id === movable.id)?.date, '2026-11-23');
  assert.ok(next.units.filter((u) => !u.done).every((u) => u.date >= '2026-11-18'));
  assert.ok(!next.units.some((u) => u.topicId === done.topicId && u.kind === 'erarbeiten' && !u.done), 'kein zweites Erarbeiten');
  assert.ok(next.units.some((u) => u.topicId === done.topicId && u.focusMistakes), 'Fehler werden nachgearbeitet');
});

test('Lernziele: Titelzeile ist kein Lernziel', () => {
  const src = { id: 'g', title: 'LZ', origin: 'mykv', kind: 'lernziele', topicId: 't', content: 'Lernziele Vertragsentstehung (Beispiel)\n- Ich kann Antrag und Annahme erklären.' };
  const goals = extract(src).goals.map((g) => g.text);
  assert.deepEqual(goals, ['Ich kann Antrag und Annahme erklären.']);
});
