// Three-way merge of a file changed both on the phone and in the repository.
import { parsePage, serializePage, splitSections, joinSections } from './format.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Returns { text, conflict } where conflict is the remote text that could not be merged
 *  (the caller keeps it as a separate copy so nothing is lost), or null. */
export function mergeFile(path, base, local, remote) {
  if (local === remote) return { text: remote, conflict: null };
  if (base == null) {
    // both sides created the same path independently
    return { text: local, conflict: remote };
  }
  if (local === base) return { text: remote, conflict: null };
  if (remote === base) return { text: local, conflict: null };
  if (path === 'historie.json') return { text: mergeHistory(base, local, remote), conflict: null };
  if (/\.md$/.test(path) && path.startsWith('pojmy/')) return mergePage(base, local, remote);
  return { text: local, conflict: remote };
}

export function mergePage(baseText, localText, remoteText) {
  const b = parsePage(baseText), l = parsePage(localText), r = parsePage(remoteText);
  if (!b || !l || !r) return { text: localText, conflict: remoteText };
  const meta = {};
  const keys = new Set([...Object.keys(r.meta), ...Object.keys(l.meta)]);
  for (const k of keys) {
    const bv = b.meta[k], lv = l.meta[k], rv = r.meta[k];
    if (k === 'souvisi') { meta[k] = mergeSet(bv || [], lv || [], rv || []); continue; }
    if (!(k in l.meta) && k in b.meta) continue; // removed locally
    meta[k] = same(lv, bv) ? (k in r.meta ? rv : lv) : lv;
  }
  const mb = mergeBody(b.body, l.body, r.body);
  return { text: serializePage(meta, mb.body), conflict: mb.conflict ? remoteText : null };
}

/** Merge page bodies section by section (sections are level-1 headings), so an edit made
 *  in the repository and another made on the phone combine when they touch different sections. */
export function mergeBody(base, local, remote) {
  if (local === base || local === remote) return { body: remote, conflict: false };
  if (remote === base) return { body: local, conflict: false };
  const B = splitSections(base), L = splitSections(local), R = splitSections(remote);
  const titles = s => s.sections.map(x => x.title);
  const unique = s => new Set(titles(s)).size === s.sections.length;
  if (!unique(B) || !unique(L) || !unique(R)) return { body: local, conflict: true };
  const map = s => new Map(s.sections.map(x => [x.title, x.text]));
  const bm = map(B), lm = map(L), rm = map(R);
  let conflict = false;
  const pick = (bv, lv, rv) => {
    if (lv === bv || lv === rv) return rv;
    if (rv === bv) return lv;
    conflict = true;
    return lv;
  };
  const pre = pick(B.pre, L.pre, R.pre);
  const out = [];
  const done = new Set();
  // repository order first
  for (const t of titles(R)) {
    const inB = bm.has(t), inL = lm.has(t);
    if (inL) out.push({ title: t, text: inB ? pick(bm.get(t), lm.get(t), rm.get(t)) : (lm.get(t) === rm.get(t) ? rm.get(t) : (conflict = true, lm.get(t))) });
    else if (!inB) out.push({ title: t, text: rm.get(t) });                 // added in the repository
    else if (rm.get(t) !== bm.get(t)) { conflict = true; out.push({ title: t, text: rm.get(t) }); } // deleted on phone, edited in repo
    done.add(t);
  }
  // sections only the phone has, inserted after their local predecessor
  titles(L).forEach((t, i) => {
    if (done.has(t)) return;
    if (bm.has(t)) {                       // deleted in the repository
      if (lm.get(t) === bm.get(t)) return; // unchanged locally: stay deleted
      conflict = true;
    }
    const prev = titles(L).slice(0, i).reverse().find(x => out.some(o => o.title === x));
    const at = prev ? out.findIndex(o => o.title === prev) + 1 : 0;
    out.splice(at, 0, { title: t, text: lm.get(t) });
    done.add(t);
  });
  return { body: joinSections(pre, out), conflict };
}

function mergeSet(base, local, remote) {
  const added = local.filter(x => !base.includes(x));
  const removed = new Set(base.filter(x => !local.includes(x)));
  const out = remote.filter(x => !removed.has(x));
  for (const x of added) if (!out.includes(x)) out.push(x);
  return out;
}

/* historie.json: { verze, nastaveni: { denne }, dny: { "YYYY-MM-DD": { fronta: [ { id, lvl0, due0, res } ] } } } */
export function parseHistory(text) {
  try {
    const h = JSON.parse(text || '{}');
    return { verze: 1, nastaveni: h.nastaveni || {}, dny: h.dny || {} };
  } catch (e) {
    return { verze: 1, nastaveni: {}, dny: {} };
  }
}
export function serializeHistory(h) {
  const dny = {};
  Object.keys(h.dny || {}).sort().forEach(k => { dny[k] = h.dny[k]; });
  return JSON.stringify({ verze: 1, nastaveni: h.nastaveni || {}, dny }, null, 1) + '\n';
}

export function mergeHistory(baseText, localText, remoteText) {
  const b = parseHistory(baseText), l = parseHistory(localText), r = parseHistory(remoteText);
  const out = { verze: 1, nastaveni: {}, dny: {} };
  const nb = b.nastaveni, nl = l.nastaveni, nr = r.nastaveni;
  for (const k of new Set([...Object.keys(nl), ...Object.keys(nr)])) out.nastaveni[k] = same(nl[k], nb[k]) ? (k in nr ? nr[k] : nl[k]) : nl[k];
  for (const day of new Set([...Object.keys(l.dny), ...Object.keys(r.dny)])) {
    const ld = (l.dny[day] && l.dny[day].fronta) || [], rd = (r.dny[day] && r.dny[day].fronta) || [];
    const byId = new Map();
    for (const e of rd) byId.set(e.id, e);
    for (const e of ld) {
      const o = byId.get(e.id);
      if (!o) { byId.set(e.id, e); continue; }
      const lt = (e.res && e.res.at) || '', rt = (o.res && o.res.at) || '';
      if (e.res && (!o.res || lt >= rt)) byId.set(e.id, e);
    }
    // keep the local order first, then entries only the repository had
    const order = [...ld.map(e => e.id), ...rd.map(e => e.id).filter(id => !ld.some(e => e.id === id))];
    out.dny[day] = { fronta: order.map(id => byId.get(id)) };
  }
  return serializeHistory(out);
}
