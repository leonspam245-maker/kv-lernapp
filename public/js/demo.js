// Gekennzeichnete Beispieldaten zum Ausprobieren (alle Einträge mit demo: true).
import { uid, addDays } from './util.js';
import { newCard } from './srs.js';
import { buildPlan } from './planner.js';

export function buildDemoData(today) {
  const now = new Date().toISOString();
  const subject = { id: uid('f'), name: 'W&G (Beispiel)', createdAt: now, demo: true };
  const t1 = { id: uid('t'), subjectId: subject.id, name: 'Vertragsarten', createdAt: now, demo: true };
  const t2 = { id: uid('t'), subjectId: subject.id, name: 'Vertragsentstehung', createdAt: now, demo: true };
  const t3 = { id: uid('t'), subjectId: subject.id, name: 'Mängel beim Vertragsabschluss', createdAt: now, demo: true };
  const base = { subjectId: subject.id, createdAt: now, demo: true };
  const quizlet = { ...base, id: uid('s'), topicId: t1.id, origin: 'quizlet', title: '[Beispiel] Quizlet: Vertragsarten', cards: [
    { term: 'Kaufvertrag', def: 'Der Verkäufer übergibt den Kaufgegenstand und verschafft das Eigentum; der Käufer bezahlt den Kaufpreis (Art. 184 OR).' },
    { term: 'Mietvertrag', def: 'Der Vermieter überlässt eine Sache zum Gebrauch; der Mieter bezahlt einen Mietzins (Art. 253 OR).' },
    { term: 'Werkvertrag', def: 'Der Unternehmer stellt ein Werk her, der Besteller leistet eine Vergütung; geschuldet ist ein Erfolg (Art. 363 OR).' },
    { term: 'Einfacher Auftrag', def: 'Der Beauftragte besorgt Geschäfte oder Dienste sorgfältig; geschuldet ist Tätigwerden, kein Erfolg (Art. 394 OR).' },
    { term: 'Gebrauchsleihe', def: 'Der Verleiher überlässt eine Sache unentgeltlich zum Gebrauch (Art. 305 OR).' },
  ] };
  const handout = { ...base, id: uid('s'), topicId: t2.id, origin: 'pdf', title: '[Beispiel] Handout Vertragsentstehung', fileName: 'beispiel-handout.pdf', pages: [
    { n: 1, include: true, text: 'Vertragsentstehung\nEin Vertrag entsteht durch übereinstimmende gegenseitige Willensäusserung der Parteien (Art. 1 OR).\nAntrag: Verbindliches Angebot einer Partei, einen bestimmten Vertrag abzuschliessen.\nAnnahme: Zustimmung der anderen Partei zum Antrag innert der Annahmefrist.\nZum Beispiel: Ein Gast bestellt per E-Mail eine Führung; das Tourismusbüro bestätigt am gleichen Tag.' },
    { n: 2, include: true, text: 'Formvorschriften\nFormfreiheit: Verträge sind grundsätzlich an keine Form gebunden (Art. 11 OR).\nÖffentliche Beurkundung: Eine Urkundsperson beurkundet den Vertrag, zum Beispiel beim Grundstückkauf.' },
  ] };
  const goals = { ...base, id: uid('s'), topicId: t2.id, origin: 'mykv', kind: 'lernziele', title: '[Beispiel] Lernziele Vertragsentstehung', link: null,
    content: '- Ich kann erklären, wie ein Vertrag durch Antrag und Annahme zustande kommt.\n- Ich kann die Formvorschriften unterscheiden.' };
  const note = { ...base, id: uid('s'), topicId: t3.id, origin: 'onenote', title: '[Beispiel] OneNote: Mängel beim Vertragsabschluss',
    content: '# Mängel beim Vertragsabschluss\n## Willensmängel\n- Wesentlicher Irrtum: Eine Partei irrt sich über einen wesentlichen Punkt des Vertrags (Art. 23 OR).\n- Absichtliche Täuschung: Eine Partei wird durch bewusst falsche Angaben zum Vertragsabschluss verleitet (Art. 28 OR).\n\n| Mangel | Folge | Frist |\n|---|---|---|\n| Nichtigkeit | von Anfang an ungültig | keine |\n| Willensmangel | einseitig unverbindlich | 1 Jahr |' };
  const cards = quizlet.cards.map((c) => ({ ...newCard({ id: uid('c'), topicId: t1.id, sourceId: quizlet.id, term: c.term, def: c.def, origin: 'quizlet' }, today), demo: true }));
  const exam = {
    id: uid('p'), subjectId: subject.id, title: 'W&G-Prüfung Vertragsrecht (Beispiel)', date: addDays(today, 10), createdAt: now, demo: true,
    topicIds: [t1.id, t2.id, t3.id], difficultTopicIds: [t3.id], minutesByWeekday: [30, 30, 0, 30, 30, 60, 0],
    blocked: [{ date: addDays(today, 2), reason: 'ÜK' }],
  };
  exam.plan = buildPlan({ exam, topicInfo: { [t1.id]: { name: t1.name, cardCount: 5 }, [t2.id]: { name: t2.name, cardCount: 0 }, [t3.id]: { name: t3.name, cardCount: 0 } }, today });
  return { subjects: [subject], topics: [t1, t2, t3], sources: [quizlet, handout, goals, note], cards, contents: [], attempts: [], exams: [exam] };
}
