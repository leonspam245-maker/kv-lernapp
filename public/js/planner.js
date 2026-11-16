// Lernplan-Berechnung – funktioniert vollständig ohne KI.
import { addDays, diffDays, weekdayIndex, uid } from './util.js';

export const KIND_LABEL = { erarbeiten: 'Erarbeiten', wiederholen: 'Wiederholen', selbsttest: 'Selbsttest' };
const MIN_UNIT = 15;

/**
 * Berechnet den Lernplan einer Prüfung.
 * @param exam       { date, topicIds, minutesByWeekday[7], blocked:[{date,reason}], difficultTopicIds }
 * @param topicInfo  { [topicId]: { name, cardCount } }
 * @param stats      { [topicId]: { errorRate (0..1|null), cardsDue } }
 * @param today      YYYY-MM-DD
 * @param previous   bisherige Einheiten (abgeschlossene und manuell verschobene bleiben erhalten)
 * @returns { units, unplaced, days }
 */
export function buildPlan({ exam, topicInfo, stats = {}, today, previous = [] }) {
  const lastDay = addDays(exam.date, -1);
  const blocked = new Map((exam.blocked || []).map((b) => [b.date, b.reason || 'Gesperrt']));

  // 1. Bestehende Einheiten übernehmen: erledigte immer, verschobene (pinned) wenn sie noch in der Zukunft liegen.
  const kept = previous.filter((u) => u.done || (u.pinned && u.date >= today && u.date <= lastDay));

  // 2. Verfügbare Minuten pro Tag
  const days = [];
  for (let d = today; diffDays(d, lastDay) >= 0; d = addDays(d, 1)) {
    const base = blocked.has(d) ? 0 : Number(exam.minutesByWeekday?.[weekdayIndex(d)] || 0);
    const used = kept.filter((u) => u.date === d && (!u.done || u.date === today)).reduce((s, u) => s + u.minutes, 0);
    days.push({ date: d, capacity: base, free: Math.max(0, base - used), blockedReason: blocked.get(d) || null });
  }
  const dayOf = (date) => days.find((x) => x.date === date);

  // 3. Bedarf pro Thema bestimmen
  const topics = (exam.topicIds || []).filter((id) => topicInfo[id]);
  const difficult = new Set(exam.difficultTopicIds || []);
  const needs = topics.map((id) => {
    const info = topicInfo[id];
    const st = stats[id] || {};
    const err = st.errorRate ?? null;
    const weak = err !== null && err > 0.3;
    const isDifficult = difficult.has(id);
    const doneUnits = kept.filter((u) => u.topicId === id && u.done);
    const learned = doneUnits.some((u) => u.kind === 'erarbeiten') || kept.some((u) => u.topicId === id && u.kind === 'erarbeiten');
    const reviewsPlanned = kept.filter((u) => u.topicId === id && u.kind === 'wiederholen').length;
    const reviewsWanted = 1 + (isDifficult ? 1 : 0) + (weak ? 1 : 0);
    const priority = 3 + (isDifficult ? 2 : 0) + (err !== null ? err * 3 : 0) + (st.cardsDue ? 0.5 : 0) + (learned ? 0 : 1);
    // Wiederholungen richten sich nach der letzten erledigten Einheit (verschobene Einheiten blockieren nicht).
    const lastLearn = doneUnits.map((u) => u.date).sort().at(-1) || kept.filter((u) => u.topicId === id && u.kind === 'erarbeiten').map((u) => u.date).sort().at(-1) || null;
    return { id, name: info.name, cardCount: info.cardCount || 0, weak, isDifficult, err, learned, reviews: Math.max(0, reviewsWanted - reviewsPlanned), priority, lastDate: lastLearn };
  }).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));

  const units = [];
  const unplaced = [];
  const place = (unit, earliest, opts = {}) => {
    const candidates = days.filter((d) => d.date >= earliest);
    const order = opts.latestFirst ? [...candidates].reverse() : candidates;
    for (const d of order) {
      let minutes = unit.minutes;
      if (d.free < minutes && d.free >= Math.max(MIN_UNIT, Math.round(unit.minutes * 0.6))) minutes = d.free; // etwas kürzer, aber sinnvoll
      if (d.free >= minutes && minutes >= MIN_UNIT) {
        d.free -= minutes;
        const u = { id: uid('u'), date: d.date, done: false, pinned: false, result: null, ...unit, minutes };
        u.task = describe(u, opts.ctx);
        units.push(u);
        return u;
      }
    }
    unplaced.push({ ...unit, task: describe(unit, opts.ctx), reason: 'Keine freie Lernzeit mehr vor der Prüfung' });
    return null;
  };

  // 4. Selbsttest zuerst reservieren: möglichst spät (idealerweise am Vortag), ausser schon erledigt/geplant
  const testKept = kept.some((u) => u.kind === 'selbsttest');
  if (!testKept && topics.length) {
    const minutes = Math.min(60, 20 + topics.length * 5);
    // Erst ab Tag 2 versuchen, damit vorher gelernt werden kann – sonst irgendwann.
    const earliest = days.length > 1 ? days[1].date : today;
    place({ kind: 'selbsttest', topicId: null, topicIds: topics, minutes }, earliest, { latestFirst: true, ctx: { count: topics.length } });
  }
  const testDate = units.find((u) => u.kind === 'selbsttest')?.date || kept.find((u) => u.kind === 'selbsttest')?.date || null;

  // 5. Erarbeiten (wichtigste Themen zuerst, so früh wie möglich)
  const lastPlaced = {};
  for (const n of needs) {
    if (n.learned) { lastPlaced[n.id] = n.lastDate || addDays(today, -1); continue; }
    const minutes = n.isDifficult || n.weak ? 35 : 25;
    const u = place({ kind: 'erarbeiten', topicId: n.id, minutes }, today, { ctx: n });
    if (u) lastPlaced[n.id] = u.date;
  }
  // 6. Wiederholungen in Runden (verteilt: +1 Tag, dann +2 Tage), wichtigste Themen zuerst
  for (let round = 0; round < 3; round++) {
    for (const n of needs) {
      if (n.reviews <= round || !lastPlaced[n.id]) continue;
      const gap = round === 0 ? 1 : 2;
      let earliest = addDays(lastPlaced[n.id], gap);
      if (earliest < today) earliest = today;
      const minutes = n.weak && round === n.reviews - 1 ? 20 : 15;
      const u = place({ kind: 'wiederholen', topicId: n.id, minutes, focusMistakes: n.weak }, earliest, { ctx: n });
      if (u) lastPlaced[n.id] = u.date;
    }
  }
  // Themen, deren Erarbeiten keinen Platz hatte, bekommen keine Wiederholungen – sie erscheinen in «unplaced».
  for (const n of needs) {
    if (!lastPlaced[n.id] && !n.learned) {
      for (let i = 0; i < n.reviews; i++) unplaced.push({ kind: 'wiederholen', topicId: n.id, minutes: 15, task: describe({ kind: 'wiederholen', topicId: n.id, minutes: 15 }, n), reason: 'Thema konnte nicht eingeplant werden' });
    }
  }

  const all = [...kept, ...units].sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b));
  return { units: all, unplaced, days: days.map(({ date, capacity, blockedReason }) => ({ date, capacity, blockedReason })), testDate, generatedAt: new Date().toISOString() };
}

const order = (u) => ({ erarbeiten: 0, wiederholen: 1, selbsttest: 2 }[u.kind] ?? 3);

/** Konkrete Aufgabenbeschreibung, z. B. «20 Min. Vertragsarten vergleichen und 8 Karteikarten beantworten». */
export function describe(u, ctx = {}) {
  const name = ctx.name || 'Thema';
  const cards = Math.min(ctx.cardCount || 0, Math.max(4, Math.round(u.minutes / 2.5)));
  if (u.kind === 'selbsttest') return `${u.minutes} Min. Selbsttest: Probeprüfung zu ${ctx.count || u.topicIds?.length || ''} Themen unter Prüfungsbedingungen lösen`;
  if (u.kind === 'erarbeiten') {
    return cards
      ? `${u.minutes} Min. ${name} erarbeiten: Merkblatt durcharbeiten und ${cards} Karteikarten beantworten`
      : `${u.minutes} Min. ${name} erarbeiten: Unterlagen lesen und Merkblatt erstellen`;
  }
  const extra = u.focusMistakes ? ' und Fehler aus dem letzten Quiz nacharbeiten' : ' und ein kurzes Quiz lösen';
  return cards
    ? `${u.minutes} Min. ${name} wiederholen: ${Math.min(cards, 12)} fällige Karteikarten${extra}`
    : `${u.minutes} Min. ${name} wiederholen: Merkblatt repetieren${extra}`;
}

/** Einheit auf ein anderes Datum verschieben (bleibt beim Neuberechnen erhalten). */
export function moveUnit(units, unitId, newDate) {
  return units.map((u) => (u.id === unitId ? { ...u, date: newDate, pinned: true } : u));
}
