// In-memory model of the data repository, persisted to IndexedDB on every change.
import { files as fileDb, kv } from './db.js';
import { parsePage, serializePage, levelIndex, priorityRank, slugify, newId, nowStamp, addDays, dayKey } from './format.js';
import { parseHistory, serializeHistory } from './merge.js';

const listeners = new Set();
export const store = {
  files: new Map(),        // path -> { path, text, base, sha, deleted }
  pages: new Map(),        // id -> page view model
  byPath: new Map(),       // path -> page
  history: { verze: 1, nastaveni: {}, dny: {} },
  schema: null,
  template: '',
  rules: '',
  conn: null,              // { owner, repo, branch, token, api }
  head: null,              // last synced commit sha
  lastSync: null,
  ready: false
};

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
let notifyQueued = false;
export function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => { notifyQueued = false; listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); });
}

export const tracked = p => /^pojmy\/[^/]+\.md$/.test(p) || ['historie.json', 'schema.json', 'sablona.md', 'pravidla.md'].includes(p) || /^konflikty\/[^/]+\.md$/.test(p);

export async function load() {
  const all = await fileDb.all();
  store.files = new Map(all.map(f => [f.path, f]));
  store.conn = (await kv.get('conn')) || null;
  store.head = (await kv.get('head')) || null;
  store.lastSync = (await kv.get('lastSync')) || null;
  rebuild();
  store.ready = true;
  notify();
}

/** Recompute pages, history, schema and template from the files. */
export function rebuild() {
  store.pages = new Map();
  store.byPath = new Map();
  for (const f of store.files.values()) {
    if (f.deleted || !/^pojmy\/[^/]+\.md$/.test(f.path)) continue;
    const p = toPage(f);
    if (p) { store.pages.set(p.id, p); store.byPath.set(p.path, p); }
  }
  const h = store.files.get('historie.json');
  store.history = parseHistory(h && !h.deleted ? h.text : '');
  const s = store.files.get('schema.json');
  try { store.schema = s ? JSON.parse(s.text) : null; } catch (e) { store.schema = null; }
  const t = store.files.get('sablona.md');
  store.template = t ? t.text : '';
  const r = store.files.get('pravidla.md');
  store.rules = r ? r.text : '';
}

function toPage(f) {
  const parsed = parsePage(f.text);
  if (!parsed || !parsed.meta.id) return null;
  const m = parsed.meta;
  return {
    id: m.id,
    path: f.path,
    meta: m,
    body: parsed.body,
    title: String(m.pojem || '').trim() || '(bez názvu)',
    icon: m.ikona || '',
    cat: m.kategorie || '',
    type: m.typ || '',
    def: m.definice || '',
    lvl: levelIndex(m.uroven),
    prio: priorityRank(m.priorita),
    due: m.opakovani ? String(m.opakovani).slice(0, 10) : null,
    checked: String(m.stav || '').toLowerCase().startsWith('zkontrol'),
    rel: Array.isArray(m.souvisi) ? m.souvisi : [],
    created: m.vytvoreno || '',
    dirty: f.base == null || f.text !== f.base
  };
}

async function saveFiles(list) {
  await fileDb.putMany(list);
}

/** Replace a file's local text (marks it as changed until the next sync). */
export async function writeFile(path, text) {
  const f = store.files.get(path) || { path, text: '', base: null, sha: null, deleted: false };
  f.text = text;
  f.deleted = false;
  store.files.set(path, f);
  await saveFiles([f]);
  rebuild();
  notify();
  scheduleSync();
}

/* ---------- page operations ---------- */

export async function updatePageMeta(id, patch) {
  const p = store.pages.get(id);
  if (!p) throw new Error('Pojem nenalezen.');
  const meta = { ...p.meta, ...patch };
  await writeMany([[p.path, serializePage(meta, p.body)]]);
}

export async function updatePageBody(id, body) {
  const p = store.pages.get(id);
  if (!p) throw new Error('Pojem nenalezen.');
  await writeMany([[p.path, serializePage(p.meta, body)]]);
}

/** Set the related pages of `id`, keeping the relation symmetric on both sides. */
export async function setRelations(id, newIds) {
  const p = store.pages.get(id);
  const after = new Set(newIds.filter(x => x !== id && store.pages.has(x)));
  const writes = [[p.path, serializePage({ ...p.meta, souvisi: [...after] }, p.body)]];
  for (const other of store.pages.values()) {
    if (other.id === id) continue;
    const had = other.rel.includes(id);
    const should = after.has(other.id);
    if (had === should) continue;
    const rel = should ? [...other.rel, id] : other.rel.filter(x => x !== id);
    writes.push([other.path, serializePage({ ...other.meta, souvisi: rel }, other.body)]);
  }
  await writeMany(writes);
}

async function writeMany(pairs) {
  const changed = [];
  for (const [path, text] of pairs) {
    const f = store.files.get(path) || { path, text: '', base: null, sha: null, deleted: false };
    if (f.text === text && !f.deleted) continue;
    f.text = text; f.deleted = false;
    store.files.set(path, f);
    changed.push(f);
  }
  if (!changed.length) return;
  await saveFiles(changed);
  rebuild();
  notify();
  scheduleSync();
}

export async function createPage(fields) {
  const id = newId();
  const taken = new Set([...store.files.keys()].filter(p => p.startsWith('pojmy/')).map(p => p.slice(6, -3)));
  const slug = slugify(fields.pojem, taken);
  const defaults = (store.schema && store.schema.novy_pojem) || {};
  const today = dayKey(new Date());
  const meta = {
    id,
    pojem: fields.pojem.trim(),
    ikona: fields.ikona || '',
    kategorie: fields.kategorie || '',
    typ: fields.typ || '',
    definice: fields.definice || '',
    priorita: fields.priorita || defaults.priorita || '🟡 Střední',
    uroven: defaults.uroven || '🆕 Nové',
    stav: defaults.stav || 'Koncept',
    opakovani: addDays(today, Number(defaults.opakovani_za_dni) || 1),
    vytvoreno: nowStamp(),
    souvisi: []
  };
  const body = (store.template || '# 🧭 Přehled\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  await writeMany([[`pojmy/${slug}.md`, serializePage(meta, body)]]);
  if (fields.souvisi && fields.souvisi.length) await setRelations(id, fields.souvisi);
  return id;
}

export async function deletePage(id) {
  const p = store.pages.get(id);
  if (!p) return;
  const writes = [];
  for (const other of store.pages.values()) {
    if (other.id !== id && other.rel.includes(id)) {
      writes.push([other.path, serializePage({ ...other.meta, souvisi: other.rel.filter(x => x !== id) }, other.body)]);
    }
  }
  if (writes.length) await writeMany(writes);
  const f = store.files.get(p.path);
  if (f.base == null) { store.files.delete(p.path); await fileDb.del(p.path); }
  else { f.deleted = true; await saveFiles([f]); }
  rebuild();
  notify();
  scheduleSync();
}

/** Remove a non-page file (e.g. a conflict copy) locally and, after sync, from the repository. */
export async function removeFile(path) {
  const f = store.files.get(path);
  if (!f) return;
  if (f.base == null) { store.files.delete(path); await fileDb.del(path); }
  else { f.deleted = true; await saveFiles([f]); }
  rebuild();
  notify();
  scheduleSync();
}

/* ---------- history (review queue) ---------- */

export async function saveHistory(mutator) {
  const h = JSON.parse(JSON.stringify(store.history));
  mutator(h);
  await writeFile('historie.json', serializeHistory(h));
}

/* ---------- pending changes ---------- */

export function pendingFiles() {
  return [...store.files.values()].filter(f => f.deleted ? f.base != null : (f.base == null || f.text !== f.base));
}

/* ---------- connection & sync scheduling ---------- */

export async function setConn(conn) { store.conn = conn; await kv.set('conn', conn); notify(); }
export async function setHead(sha) { store.head = sha; await kv.set('head', sha); }
export async function setLastSync(t) { store.lastSync = t; await kv.set('lastSync', t); }
export async function resetLocal() {
  await fileDb.clear();
  store.files = new Map();
  store.head = null;
  await kv.del('head');
  rebuild();
  notify();
}

let syncHook = null;
let syncTimer = null;
export function setSyncHook(fn) { syncHook = fn; }
export function scheduleSync(delay = 4000) {
  if (!syncHook) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncHook(), delay);
}

/** Persist the outcome of a sync: files changed in memory are written in one batch. */
export async function commitFiles(changed, removed) {
  if (changed.length) await fileDb.putMany(changed);
  if (removed.length) await fileDb.delMany(removed);
  rebuild();
  notify();
}
