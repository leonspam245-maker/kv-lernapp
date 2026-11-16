// Lokale Erstellung von Lerninhalten direkt aus den Unterlagen (ohne KI).
// Jede Aussage trägt einen Verweis auf Unterlage und – falls vorhanden – PDF-Seite.
import { norm, keywords, similarity, shuffle, uid } from './util.js';

const NOT_TERMS = /^(beispiel|beispiele|hinweis|achtung|aufgabe|aufgaben|lernziel|lernziele|seite|quelle|datum|name|klasse|lösung|losung|notiz|notizen|merke|tipp|frage|antwort|fach|thema|zum beispiel|z\. ?b\.)$/i;
const EXAMPLE_RE = /(\bbeispiel\b|\bz\. ?b\.|zum beispiel|beispielsweise)/i;
const DIFF_RE = /(unterschied|im gegensatz|hingegen|unterscheide|unterscheidet|während (der|die|das|beim|bei)|anders als|abgrenzung)/i;
const GOAL_VERBS = new Set('erklären erklaren nennen beschreiben unterscheiden kennen aufzählen aufzahlen anwenden beurteilen kann können konnen ich die den das lernende lernenden verstehen zuordnen erläutern erlautern'.split(' '));

/** Text einer Unterlage in Abschnitte mit Seitenangabe zerlegen. */
export function segments(source) {
  if (source.pages?.length) return source.pages.filter((p) => p.include !== false && p.text?.trim()).map((p) => ({ text: p.text, page: p.n }));
  if (source.content?.trim()) return [{ text: source.content, page: null }];
  return [];
}

/** Zeilen logisch zusammenfügen (PDF-Zeilenumbrüche mitten im Satz). */
export function logicalLines(text) {
  const raw = String(text).replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/g, ''));
  const out = [];
  for (const line of raw) {
    const t = line.trim();
    if (!t) { out.push(''); continue; }
    const prev = out.at(-1);
    const startsNew = /^([-•*–]|\d+[.)]|#|\|)/.test(t) || /^[A-ZÄÖÜ][^:]{0,40}:/.test(t);
    // Fortsetzung, wenn die vorige Zeile nicht mit Satzzeichen endet und entweder lang ist (Umbruch) oder klein weitergeht.
    const continues = prev && !/[.:!?|]$/.test(prev) && !startsNew && !prev.startsWith('#') && !prev.startsWith('|') && (/^[a-zäöü(]/.test(t) || prev.length >= 40);
    if (continues) out[out.length - 1] = prev + ' ' + t;
    else out.push(t);
  }
  return out;
}

const stripBullet = (t) => t.replace(/^([-•*–]\s+|\d+[.)]\s+)/, '').replace(/\*\*/g, '').trim();
const wordCount = (t) => t.split(/\s+/).filter(Boolean).length;
const isTermLike = (t) => t.length >= 2 && t.length <= 60 && wordCount(t) <= 6 && /^[A-ZÄÖÜ0-9«"]/.test(t) && !NOT_TERMS.test(t.trim()) && !/[.!?]$/.test(t);
const sentences = (t) => t.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ«"])/).map((s) => s.trim()).filter(Boolean);
const cleanDef = (d) => d.trim().replace(/^[-–:]\s*/, '');

function parseTableRow(line) {
  if (!line.startsWith('|')) return null;
  const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return 'sep';
  return cells;
}

/**
 * Wissen aus einer Unterlage extrahieren.
 * @returns { defs:[{term,def,heading,refs}], examples:[...], differences:[...], tables:[...], goals:[...] }
 */
export function extract(source) {
  const res = { defs: [], examples: [], differences: [], tables: [], goals: [] };
  const ref = (page) => [{ sourceId: source.id, page }];
  if (source.cards?.length) {
    for (const c of source.cards) res.defs.push({ term: c.term, def: c.def, heading: source.title, refs: ref(null), topicId: source.topicId });
  }
  const isGoals = source.kind === 'lernziele';
  for (const seg of segments(source)) {
    let heading = null;
    let table = null;
    const flushTable = () => {
      if (!table) return;
      if (table.rows.length && table.header.length >= 3) {
        res.tables.push({ heading, header: table.header, rows: table.rows, refs: ref(seg.page), topicId: source.topicId });
      } else if (table.header.length === 2) {
        for (const r of table.rows) if (r[0] && r[1] && isTermLike(r[0])) res.defs.push({ term: r[0], def: r[1], heading, refs: ref(seg.page), topicId: source.topicId });
      }
      table = null;
    };
    for (const line of logicalLines(seg.text)) {
      const row = parseTableRow(line);
      if (row) {
        if (row === 'sep') continue;
        if (!table) table = { header: row, rows: [] }; else table.rows.push(row);
        continue;
      }
      flushTable();
      if (!line) continue;
      if (line.startsWith('#')) { heading = line.replace(/^#+\s*/, ''); continue; }
      const t = stripBullet(line);
      if (isGoals) { if (wordCount(t) >= 3) res.goals.push({ text: t, refs: ref(seg.page), topicId: source.topicId }); continue; }
      // Kurze Zeile ohne Satzzeichen = Zwischentitel (typisch in PDFs)
      if (!/^[-•*–]/.test(line) && wordCount(t) <= 7 && t.length < 60 && !/[.:,;!?]$/.test(t) && !/[:–—]\s/.test(t) && /^[A-ZÄÖÜ0-9]/.test(t)) { heading = t; continue; }

      let m = t.match(/^(.{2,60}?)\s*(?::|\s[–—-]\s)\s*(.{10,})$/);
      if (m && isTermLike(m[1].trim())) {
        const term = m[1].trim(); const def = cleanDef(m[2]);
        if (/^(z\. ?b\.|beispiel)/i.test(term)) res.examples.push({ text: t, refs: ref(seg.page), own: false, topicId: source.topicId });
        else res.defs.push({ term, def, heading, refs: ref(seg.page), topicId: source.topicId });
        if (EXAMPLE_RE.test(def)) res.examples.push({ text: `${term}: ${def}`, refs: ref(seg.page), own: false, topicId: source.topicId });
        continue;
      }
      for (const s of sentences(t)) {
        let d = s.match(/^Unter (?:einem |einer |einen |dem |der |den |die |das )?(.{2,50}?) (?:versteht man|wird .{0,20}verstanden) (.{10,})$/i);
        if (!d) d = s.match(/^(?:Der |Die |Das )?([A-ZÄÖÜ][\wäöüß-]+(?: [A-ZÄÖÜ][\wäöüß-]+){0,2}) (?:ist eine?|ist der|ist die|ist das|sind|bezeichnet|bedeutet|nennt man) (.{10,})$/);
        if (d && isTermLike(d[1])) { res.defs.push({ term: d[1].trim(), def: cleanDef(d[2]), heading, refs: ref(seg.page), topicId: source.topicId, fromSentence: true }); }
        if (EXAMPLE_RE.test(s)) res.examples.push({ text: s, refs: ref(seg.page), own: false, topicId: source.topicId });
        else if (DIFF_RE.test(s)) res.differences.push({ text: s, refs: ref(seg.page), topicId: source.topicId });
      }
    }
    flushTable();
  }
  return res;
}

/** Wissen aus mehreren Unterlagen zusammenführen, Dubletten entfernen, Widersprüche erkennen. */
export function collect(sources) {
  const all = { defs: [], examples: [], differences: [], tables: [], goals: [], conflicts: [] };
  for (const s of sources) {
    const e = extract(s);
    for (const k of Object.keys(e)) all[k].push(...e[k]);
  }
  const byTerm = new Map();
  for (const d of all.defs) {
    const key = norm(d.term);
    if (!byTerm.has(key)) { byTerm.set(key, [d]); continue; }
    const list = byTerm.get(key);
    const same = list.find((x) => similarity(x.def, d.def) >= 0.3);
    if (same) { // gleiche Aussage → nur Verweis ergänzen
      for (const r of d.refs) if (!same.refs.some((q) => q.sourceId === r.sourceId && q.page === r.page)) same.refs.push(r);
    } else list.push(d);
  }
  all.defs = [];
  for (const [, list] of byTerm) {
    all.defs.push(list[0]);
    const otherSources = list.filter((x) => x.refs[0].sourceId !== list[0].refs[0].sourceId);
    if (list.length > 1 && otherSources.length) {
      list[0].conflict = true;
      all.conflicts.push({ term: list[0].term, topicId: list[0].topicId, variants: list.map((x) => ({ def: x.def, refs: x.refs })) });
    } else if (list.length > 1) {
      list[0].def = list.map((x) => x.def).join(' – ');
    }
  }
  return all;
}

// ---------- Merkblatt ----------
export function buildMerkblatt(sources, topicsById) {
  const k = collect(sources);
  const gaps = [];
  const sections = [];
  const topicIds = [...new Set(sources.map((s) => s.topicId))];
  for (const tid of topicIds) {
    const tName = topicsById[tid]?.name || 'Thema';
    const defs = k.defs.filter((d) => d.topicId === tid);
    if (!defs.length) gaps.push({ text: `Zum Thema «${tName}» wurden in den ausgewählten Unterlagen keine Definitionen erkannt. Prüfe den importierten Text oder ergänze ihn.` });
    const groups = new Map();
    for (const d of defs) {
      const h = d.heading || tName;
      if (!groups.has(h)) groups.set(h, []);
      groups.get(h).push({ term: d.term, def: d.def, refs: d.refs, conflict: !!d.conflict });
    }
    for (const [heading, items] of groups) sections.push({ heading: heading === tName ? tName : `${tName} · ${heading}`, topicId: tid, items });
  }
  const searchable = norm(k.defs.map((d) => d.term + ' ' + d.def).join(' ') + ' ' + k.tables.map((t) => t.rows.flat().join(' ')).join(' '));
  for (const g of k.goals) {
    const words = keywords(g.text, 12).filter((w) => !GOAL_VERBS.has(w));
    const hit = words.filter((w) => searchable.includes(w.slice(0, Math.max(5, w.length - 2))));
    if (words.length && hit.length / words.length < 0.34) gaps.push({ text: `Zum Lernziel «${g.text}» wurde in den ausgewählten Unterlagen kaum passender Inhalt gefunden.`, refs: g.refs });
  }
  if (!k.examples.length) gaps.push({ text: 'Die ausgewählten Unterlagen enthalten keine Beispiele. Mit aktiviertem KI-Dienst können gekennzeichnete eigene Beispiele ergänzt werden.' });
  return {
    goals: k.goals.map(({ text, refs }) => ({ text, refs })),
    sections,
    tables: k.tables.map(({ heading, header, rows, refs }) => ({ heading, header, rows, refs })),
    differences: k.differences.map(({ text, refs }) => ({ text, refs })),
    examples: k.examples.map(({ text, refs, own }) => ({ text, refs, own })),
    conflicts: k.conflicts.map(({ term, variants }) => ({ term, variants })),
    gaps,
  };
}

/** Karteikarten-Vorschläge aus erkannten Definitionen. */
export function buildCards(sources) {
  return collect(sources).defs.filter((d) => d.def.length <= 400).map((d) => ({ topicId: d.topicId, term: d.term, def: d.def, sourceId: d.refs[0].sourceId, page: d.refs[0].page }));
}

// ---------- Quiz und Probeprüfung ----------
const short = (t, n = 220) => (t.length > n ? t.slice(0, n - 1).trimEnd() + ' …' : t);

function explanationFor(d, titleOf) {
  const r = d.refs[0];
  return `Laut «${titleOf(r.sourceId)}»${r.page ? `, S. ${r.page}` : ''}: ${d.term} – ${d.def}`;
}

function pickDistractors(pool, d, n, rng) {
  const same = pool.filter((x) => x !== d && x.topicId === d.topicId && norm(x.def) !== norm(d.def));
  const other = pool.filter((x) => x !== d && x.topicId !== d.topicId);
  return [...shuffle(same, rng), ...shuffle(other, rng)].slice(0, n);
}

function makeQuestion(type, d, pool, titleOf, rng) {
  const base = { id: uid('q'), topicId: d.topicId, refs: d.refs, explanation: explanationFor(d, titleOf), uncertain: d.conflict ? 'Die Unterlagen definieren diesen Begriff unterschiedlich – siehe Merkblatt.' : null };
  if (type === 'mc' || type === 'mcTerm') {
    const ds = pickDistractors(pool, d, 3, rng);
    if (!ds.length) return null;
    const reverse = type === 'mcTerm';
    const optionsSrc = shuffle([d, ...ds], rng);
    return {
      ...base, type: 'mc', points: 1,
      prompt: reverse ? `Welcher Begriff passt zu dieser Beschreibung?\n«${short(d.def, 300)}»` : `Was trifft auf «${d.term}» zu?`,
      options: optionsSrc.map((x) => (reverse ? x.term : short(x.def))),
      answer: optionsSrc.indexOf(d),
    };
  }
  if (type === 'tf') {
    const ds = pickDistractors(pool, d, 1, rng);
    const truth = !ds.length || rng() < 0.5;
    return { ...base, type: 'tf', points: 1, prompt: `Richtig oder falsch?\n${d.term}: ${short(truth ? d.def : ds[0].def, 300)}`, answerBool: truth };
  }
  if (type === 'open') {
    const kw = keywords(d.def, 6);
    return { ...base, type: 'open', points: kw.length >= 4 ? 3 : 2, prompt: `Erkläre in eigenen Worten: Was bedeutet «${d.term}»?`, model: d.def, keywords: kw };
  }
  return null;
}

function makeMatch(defs, titleOf, rng) {
  const pairs = defs.map((d) => ({ left: d.term, right: short(d.def, 160) }));
  return {
    id: uid('q'), type: 'match', topicId: defs[0].topicId, points: pairs.length,
    prompt: 'Ordne jedem Begriff die passende Beschreibung zu.',
    pairs, rightOrder: shuffle(pairs.map((_, i) => i), rng),
    refs: defs.flatMap((d) => d.refs).slice(0, 4),
    explanation: defs.map((d) => `${d.term}: ${short(d.def, 160)}`).join('\n'), uncertain: null,
  };
}

/**
 * @param kind 'quiz' | 'exam'
 * @param titleOf (sourceId) => Titel der Unterlage
 */
export function buildQuestions(sources, kind, titleOf, rng = Math.random) {
  const pool = collect(sources).defs.filter((d) => d.def.length >= 8);
  if (pool.length < 2) throw new Error('Zu wenig Inhalt: In den ausgewählten Unterlagen wurden weniger als 2 Begriffe mit Erklärung erkannt. Ergänze Definitionen oder importiere Quizlet-Karten.');
  const target = kind === 'exam' ? Math.min(12, Math.max(6, pool.length)) : Math.min(10, Math.max(4, pool.length));
  const cycle = kind === 'exam' ? ['mc', 'open', 'tf', 'mcTerm', 'match', 'open'] : ['mc', 'tf', 'mcTerm', 'open', 'match'];
  const queue = shuffle(pool, rng);
  const questions = [];
  let i = 0; let guard = 0;
  while (questions.length < target && guard++ < target * 4) {
    const type = cycle[i++ % cycle.length];
    if (type === 'match') {
      if (pool.length < 3) continue;
      const tid = queue[0]?.topicId;
      let group = shuffle(pool.filter((d) => d.topicId === tid), rng).slice(0, 4);
      if (group.length < 3) group = shuffle(pool, rng).slice(0, 4);
      questions.push(makeMatch(group, titleOf, rng));
      continue;
    }
    if (!queue.length) queue.push(...shuffle(pool, rng));
    const d = queue.shift();
    const q = makeQuestion(type, d, pool, titleOf, rng);
    if (q) questions.push(q);
  }
  if (kind === 'exam') for (const q of questions) if (q.type === 'open') q.points = Math.max(q.points, 3);
  return questions;
}

// ---------- Bewertung ----------
/** Offene Antwort grob prüfen. status: 'richtig' | 'falsch' | 'unklar' (→ selbst bestätigen) */
export function gradeOpen(answer, question) {
  const a = norm(answer);
  if (!a) return { status: 'falsch', points: 0, hits: [], missing: question.keywords || [] };
  const kws = question.keywords?.length ? question.keywords : keywords(question.model || '', 6);
  const words = a.split(' ');
  const hits = kws.filter((k) => { const stem = k.slice(0, Math.max(4, Math.min(k.length, 6))); return words.some((w) => w.startsWith(stem) || (w.length > 4 && k.startsWith(w.slice(0, 5)))); });
  const ratio = kws.length ? hits.length / kws.length : 0;
  const missing = kws.filter((k) => !hits.includes(k));
  if (ratio >= 0.7) return { status: 'richtig', points: question.points, hits, missing };
  return { status: 'unklar', points: Math.round(ratio * question.points), hits, missing };
}

/** Automatische Bewertung einer Antwort. Liefert { points, status }. */
export function grade(question, answer) {
  if (question.type === 'mc') return answer === question.answer ? { status: 'richtig', points: question.points } : { status: 'falsch', points: 0 };
  if (question.type === 'tf') return answer === question.answerBool ? { status: 'richtig', points: question.points } : { status: 'falsch', points: 0 };
  if (question.type === 'match') {
    const right = (question.pairs || []).filter((p, i) => answer?.[i] === i).length;
    return { status: right === question.pairs.length ? 'richtig' : right ? 'teilweise' : 'falsch', points: right };
  }
  if (question.type === 'open') return gradeOpen(answer, question);
  return { status: 'unklar', points: 0 };
}

/** Schweizer Notenformel: Punkte ÷ Maximum × 5 + 1, auf halbe Noten gerundet */
export const swissGrade = (points, max) => (max ? Math.round(((points / max) * 5 + 1) * 2) / 2 : null);
