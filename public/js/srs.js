// Karteikarten-Wiederholung (Leitner-System) und Lernstatistik pro Thema.
import { addDays } from './util.js';

/** Abstand in Tagen bis zur nächsten Wiederholung je Fach (Box) */
export const INTERVALS = [0, 1, 3, 7, 14, 30];
export const MASTERED_BOX = 3;

export function newCard({ id, topicId, sourceId = null, page = null, term, def, origin = 'lokal' }, today) {
  return { id, topicId, sourceId, page, term, def, origin, box: 0, due: today, seen: 0, right: 0, wrong: 0, last: null };
}

/** Bewertung «Gewusst» (true) oder «Noch üben» (false). Gibt die aktualisierte Karte zurück. */
export function rateCard(card, known, today) {
  const c = { ...card, seen: card.seen + 1, last: today };
  if (known) {
    c.right++;
    c.box = Math.min(card.box + 1, INTERVALS.length - 1);
    c.due = addDays(today, INTERVALS[c.box]);
  } else {
    c.wrong++;
    c.box = 0;
    c.due = today; // kommt heute und in der Sitzung bald wieder
  }
  return c;
}

export const isDue = (card, today) => card.due <= today;

/**
 * Reihenfolge einer Lernsitzung: fällige Karten zuerst (tiefe Box zuerst), danach neue.
 * Mit onlyDue=false werden auch noch nicht fällige Karten angehängt.
 */
export function sessionQueue(cards, today, onlyDue = true) {
  const due = cards.filter((c) => isDue(c, today)).sort((a, b) => a.box - b.box || a.due.localeCompare(b.due));
  if (onlyDue) return due;
  const rest = cards.filter((c) => !isDue(c, today)).sort((a, b) => a.due.localeCompare(b.due));
  return [...due, ...rest];
}

/** Position, an der eine «Noch üben»-Karte in der laufenden Sitzung wieder eingefügt wird. */
export const REINSERT_AFTER = 3;

/** Statistik pro Thema aus Karten und Quiz-/Prüfungsversuchen. */
export function topicStats(topicId, db, today) {
  const cards = db.cards.filter((c) => c.topicId === topicId);
  const answers = [];
  for (const a of db.attempts) {
    for (const ans of a.answers || []) if (ans.topicId === topicId) answers.push({ ...ans, date: a.date, contentId: a.contentId, kind: a.type });
  }
  const scored = answers.filter((a) => a.maxPoints > 0);
  const got = scored.reduce((s, a) => s + (a.points || 0), 0);
  const max = scored.reduce((s, a) => s + a.maxPoints, 0);
  const errorRate = max ? 1 - got / max : null;
  const mistakes = answers.filter((a) => a.maxPoints > 0 && a.points < a.maxPoints).sort((a, b) => b.date.localeCompare(a.date));
  const lastDates = [...cards.map((c) => c.last).filter(Boolean), ...answers.map((a) => a.date)].sort();
  return {
    cardsTotal: cards.length,
    cardsMastered: cards.filter((c) => c.box >= MASTERED_BOX).length,
    cardsDue: cards.filter((c) => isDue(c, today)).length,
    cardsStruggling: cards.filter((c) => c.wrong > 0 && c.box < 2).length,
    questionsAnswered: answers.length,
    errorRate,
    mistakes: mistakes.slice(0, 8),
    lastPracticed: lastDates.at(-1) || null,
    practiced: cards.some((c) => c.seen > 0) || answers.length > 0,
  };
}
