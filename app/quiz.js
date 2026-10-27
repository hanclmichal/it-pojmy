// Multiple-choice quiz (A–D) generated from the knowledge base. No DOM access here.
//
// Two kinds of question, both built from the `definice` of the pages:
//   def   "Která definice patří k pojmu X?"  the options are four definitions
//   name  "Který pojem odpovídá definici?"   the options are four term names
// Wrong options come from the same category first, then from the same type, then from the
// rest, so the choice is between related terms. A term's own name (its title and its forms
// from slovnik.json) is hidden in its definition, otherwise "VLAN je…" gives the answer away.
import { formPattern } from './glossary.js';
import { LEVEL_NAMES, norm } from './format.js';

export const LETTERS = ['A', 'B', 'C', 'D'];

export const KINDS = [
  { k: 'mix', name: 'Mix', help: 'Střídá oba typy otázek.' },
  { k: 'def', name: 'Najdi definici', help: 'Ukáže pojem, vyberete jeho definici.' },
  { k: 'name', name: 'Najdi pojem', help: 'Ukáže definici, vyberete pojem. Jeho název je v definici skrytý.' }
];

/** 0 means every term in the selection. */
export const COUNTS = [5, 10, 20, 0];

export const SCOPES = [
  { k: 'all', name: 'Všechny úrovně' },
  { k: 'learn', name: `${LEVEL_NAMES[0]} a ${LEVEL_NAMES[1]}` },
  { k: 'l0', name: LEVEL_NAMES[0] },
  { k: 'l1', name: LEVEL_NAMES[1] },
  { k: 'l2', name: LEVEL_NAMES[2] },
  { k: 'l3', name: LEVEL_NAMES[3] },
  { k: 'missed', name: 'Chybné v kvízu' }
];

export const missedLast = (terms, id) => !!(terms && terms[id] && terms[id].last === 'bad');

/** Does a page belong to the chosen group? A page without a level counts as Nové. */
export function inScope(p, scope, terms = {}) {
  const l = p.lvl < 0 ? 0 : p.lvl;
  switch (scope) {
    case 'learn': return l <= 1;
    case 'l0': return l === 0;
    case 'l1': return l === 1;
    case 'l2': return l === 2;
    case 'l3': return l === 3;
    case 'missed': return missedLast(terms, p.id);
    default: return true;
  }
}

export const usable = pages => pages.filter(p => p.def && String(p.def).trim());

export function poolOf(pages, { cat = '', scope = 'all' } = {}, terms = {}) {
  return usable(pages).filter(p => (!cat || p.cat === cat) && inScope(p, scope, terms));
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Lower levels and terms answered wrong last time come up more often. */
export function weightOf(p, terms = {}) {
  const l = p.lvl < 0 ? 0 : p.lvl;
  return (l <= 1 ? 3 : l === 2 ? 2 : 1) + (missedLast(terms, p.id) ? 3 : 0);
}

/** Weighted sample without replacement (Efraimidis–Spirakis). n = 0 takes all. */
export function pickTerms(pool, n, terms = {}, rnd = Math.random) {
  const keyed = pool.map(p => ({ p, key: Math.pow(Math.max(rnd(), 1e-12), 1 / weightOf(p, terms)) }));
  keyed.sort((a, b) => b.key - a.key);
  return (n > 0 ? keyed.slice(0, n) : keyed).map(x => x.p);
}

/** Three wrong options: same category, then the same type, then anything else. */
export function distractors(p, pages, k = 3, rnd = Math.random) {
  const t0 = norm(p.title), d0 = String(p.def).trim();
  const others = usable(pages).filter(x => x.id !== p.id && norm(x.title) !== t0 && String(x.def).trim() !== d0);
  const sameType = x => !!(x.type && x.type === p.type);
  const tiers = [
    others.filter(x => x.cat === p.cat),
    others.filter(x => x.cat !== p.cat && sameType(x)),
    others.filter(x => x.cat !== p.cat && !sameType(x))
  ];
  const out = [];
  for (const tier of tiers) {
    for (const x of shuffle(tier, rnd)) {
      if (out.length >= k) return out;
      out.push(x);
    }
  }
  return out;
}

const formOwners = new WeakMap();
/** form → set of headword ids (or '' for a headword without a page), cached per glossary. */
function ownersOf(glossary) {
  let map = formOwners.get(glossary);
  if (!map) {
    map = new Map();
    for (const e of glossary) for (const f of e.tvary) {
      const k = f.toLowerCase();
      if (!map.has(k)) map.set(k, new Set());
      map.get(k).add(e.id || '');
    }
    formOwners.set(glossary, map);
  }
  return map;
}

/** Every way the term's name can appear in text: glossary forms plus the parts of the title.
 *  A part in brackets that is another headword is a qualifier, not a name ("Node (Kubernetes)"),
 *  so it stays visible; a translation ("Event (Událost)") is hidden. */
export function namesOf(p, glossary = []) {
  const gl = glossary || [];
  const forms = new Set();
  for (const e of gl) if (e.id === p.id) e.tvary.forEach(f => forms.add(f));
  const owners = ownersOf(gl);
  const foreign = v => [...(owners.get(v.toLowerCase()) || [])].some(id => id !== p.id);
  const t = String(p.title || '').trim();
  const m = t.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const parts = m ? [t, m[1], ...m[2].split(',').filter(x => !foreign(x.trim()))] : [t];
  for (const part of parts) {
    const v = part.trim();
    if (v.length < 2) continue;
    forms.add(v);
    // "Aktér" also as "aktér" in the middle of a sentence; short words ("Pod") would hit ordinary words
    if (v.length >= 4 && /^\p{Lu}\p{Ll}/u.test(v)) forms.add(v[0].toLowerCase() + v.slice(1));
  }
  return [...forms];
}

export function maskRe(forms) {
  const list = forms.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!list.length) return null;
  try {
    return new RegExp(`(^|[^\\p{L}\\p{N}_])(?:${list.map(formPattern).join('|')})(?![\\p{L}\\p{N}_]|\\.[\\p{L}\\p{N}_])`, 'gu');
  } catch (e) {
    return null;
  }
}

/** Split text into plain strings and `null` where a name was hidden. */
export function maskParts(text, re) {
  const s = String(text || '');
  if (!re) return [s];
  const out = [];
  let last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(s))) {
    const start = m.index + m[1].length;
    if (start > last) out.push(s.slice(last, start));
    out.push(null);
    last = m.index + m[0].length;
    if (!m[0].length) re.lastIndex++;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export const maskedDef = (p, glossary) => maskParts(p.def, maskRe(namesOf(p, glossary)));

/** One question, or null when there are not enough other terms for three wrong options. */
export function makeQuestion(p, pages, kind, glossary = [], rnd = Math.random) {
  const ds = distractors(p, pages, 3, rnd);
  if (ds.length < 3) return null;
  const opts = shuffle([p, ...ds], rnd);
  return {
    id: p.id,
    kind,
    title: p.title,
    icon: p.icon || '',
    cat: p.cat || '',
    prompt: kind === 'name' ? maskedDef(p, glossary) : null,
    options: opts.map(x => ({
      id: x.id,
      title: x.title,
      icon: x.icon || '',
      def: String(x.def).trim(),
      text: kind === 'def' ? maskedDef(x, glossary) : null
    })),
    correct: opts.findIndex(x => x.id === p.id),
    answer: null
  };
}

/**
 * Build a quiz. opts: { cat, scope, kind, n } or { ids, kind } to repeat chosen terms.
 * terms: local answer statistics { id: { ok, bad, last } } used for weighting and the "missed" group.
 */
export function makeQuiz(pages, opts, terms = {}, glossary = [], rnd = Math.random) {
  const kind = KINDS.some(k => k.k === opts.kind) ? opts.kind : 'mix';
  let chosen;
  if (opts.ids) {
    const want = new Set(opts.ids);
    chosen = shuffle(usable(pages).filter(p => want.has(p.id)), rnd);
  } else {
    chosen = pickTerms(poolOf(pages, opts, terms), Number(opts.n) || 0, terms, rnd);
  }
  // in Mix the two kinds take turns in a random order, so neither dominates a short quiz
  const kinds = kind === 'mix' ? shuffle(chosen.map((_, i) => (i % 2 ? 'def' : 'name')), rnd) : chosen.map(() => kind);
  const qs = [];
  chosen.forEach((p, i) => {
    const q = makeQuestion(p, pages, kinds[i], glossary, rnd);
    if (q) qs.push(q);
  });
  return qs;
}

export function recordAnswer(terms, id, ok, at) {
  const t = (terms && terms[id]) || { ok: 0, bad: 0 };
  return { ...terms, [id]: { ok: (t.ok || 0) + (ok ? 1 : 0), bad: (t.bad || 0) + (ok ? 0 : 1), last: ok ? 'ok' : 'bad', at } };
}

export const isRight = q => q.answer != null && q.answer === q.correct;
export const scoreOf = qs => qs.filter(isRight).length;

export function verdict(ok, n) {
  const r = n ? ok / n : 0;
  if (r >= 0.9) return 'Výborně.';
  if (r >= 0.7) return 'Dobrá práce.';
  return 'Tohle chce ještě opakovat.';
}
