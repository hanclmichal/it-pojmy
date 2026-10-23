// Daily review queue (ported from the "Pojem dne" app). No DOM access here.
import { INTERVALS, LEVELS, LEVEL_NAMES, addDays, parseDay } from './format.js';

export const RATINGS = [
  { k: 'again', name: 'Nevím' },
  { k: 'hard', name: 'Těžké' },
  { k: 'good', name: 'Dobré' },
  { k: 'easy', name: 'Snadné' }
];
export const LIMITS = [1, 2, 3, 5, 10];

export function hash(s) { let x = 5381; s = String(s); for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) >>> 0; return x; }

/** Nevím resets to Nové, Těžké keeps the level, Dobré goes one level up, Snadné two. */
export function outcome(k, lvl0, today) {
  const L = lvl0 < 0 ? 0 : lvl0;
  let n;
  if (k === 'again') n = 0;
  else if (k === 'hard') n = L;
  else if (k === 'good') n = Math.min(3, L + 1);
  else n = Math.min(3, L + 2);
  return { lvl: n, due: addDays(today, INTERVALS[n]) };
}
/** On a Nové topic Těžké would equal Nevím, so that button is left out. */
export function ratingsFor(lvl0) {
  const L = lvl0 < 0 ? 0 : lvl0;
  return RATINGS.filter(r => !(r.k === 'hard' && L === 0));
}
/** Oldest due date first, higher priority on a tie, then a fixed pseudo-random order. */
export function ordered(pages, today, excl = {}) {
  return pages.filter(p => !excl[p.id]).sort((a, b) =>
    (a.due || today).localeCompare(b.due || today) || b.prio - a.prio || hash(a.id) - hash(b.id));
}
export function dueToday(pages, today, limit, excl) {
  if (limit <= 0) return [];
  return ordered(pages, today, excl).filter(p => !p.due || p.due <= today).slice(0, limit);
}
export const entryOf = p => ({ id: p.id, lvl0: p.lvl, due0: p.due || null, res: null });
export const doneIn = day => day && day.fronta ? day.fronta.filter(e => e.res).length : 0;

/** Working days in a row with at least one rated topic; weekends never break the series. */
export function streakOf(dny, today) {
  let k = today, n = 0, guard = 0;
  if (!doneIn(dny[k])) k = addDays(k, -1);
  while (guard++ < 400) {
    if (doneIn(dny[k])) n++;
    else { const wd = parseDay(k).getDay(); if (wd !== 0 && wd !== 6) break; }
    k = addDays(k, -1);
  }
  return n;
}

export const levelValue = i => LEVELS[i];
export const lvlName = i => (i < 0 || i > 3 ? 'Bez úrovně' : LEVEL_NAMES[i]);
