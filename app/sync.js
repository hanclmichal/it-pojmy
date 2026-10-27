// Synchronisation with the private GitHub repository through the Git Data API.
// Pull: download files whose blob changed, merging with local edits.
// Push: one commit with every local change, fast-forward only (retried after a fresh pull).
import { store, tracked, setHead, setLastSync, setTrackVersion, TRACK_VERSION, commitFiles, pendingFiles } from './store.js';
import { mergeFile } from './merge.js';
import { parsePage } from './format.js';

export class SyncError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const DEFAULT_API = 'https://api.github.com';

export function client(conn) {
  const api = (conn.api || DEFAULT_API).replace(/\/$/, '');
  const base = `/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}`;
  const branch = conn.branch || 'main';

  async function req(method, path, body) {
    let res;
    try {
      res = await fetch(api + path, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${conn.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new SyncError('offline', 'Bez připojení k internetu.');
    }
    if (res.ok) return res.status === 204 ? null : res.json();
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch (e) { /* no body */ }
    if (res.status === 401) throw new SyncError('auth', 'Přístupový klíč neplatí nebo vypršel.');
    if (res.status === 403 && /rate limit/i.test(detail)) throw new SyncError('rate', 'GitHub dočasně omezil počet požadavků. Zkuste to za chvíli.');
    if (res.status === 403) throw new SyncError('forbidden', 'Klíč nemá oprávnění k zápisu do úložiště.');
    if (res.status === 404) throw new SyncError('notfound', 'Úložiště nebo větev nenalezeny, nebo k nim klíč nemá přístup.');
    if (res.status === 409) throw new SyncError('empty', 'Úložiště je prázdné.');
    if (res.status === 422) throw new SyncError('conflict', detail || 'Změnu nešlo zapsat.');
    throw new SyncError('server', `GitHub odpověděl chybou ${res.status}. ${detail}`.trim());
  }

  return {
    repo: () => req('GET', base),
    head: async () => (await req('GET', `${base}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha,
    commit: sha => req('GET', `${base}/git/commits/${sha}`),
    tree: async sha => {
      const t = await req('GET', `${base}/git/trees/${sha}?recursive=1`);
      if (t.truncated) throw new SyncError('server', 'Úložiště je příliš velké pro načtení najednou.');
      return t.tree.filter(e => e.type === 'blob');
    },
    blob: async sha => decodeBase64((await req('GET', `${base}/git/blobs/${sha}`)).content),
    createTree: (baseTree, entries) => req('POST', `${base}/git/trees`, { base_tree: baseTree, tree: entries }),
    createCommit: (message, tree, parents) => req('POST', `${base}/git/commits`, { message, tree, parents }),
    updateRef: sha => req('PATCH', `${base}/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: false })
  };
}

function decodeBase64(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

/* ---------- state shared with the UI ---------- */

export const status = { running: false, phase: '', done: 0, total: 0, error: null, lastResult: null };
const statusListeners = new Set();
export function onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); }
function setStatus(patch) { Object.assign(status, patch); statusListeners.forEach(fn => fn(status)); }

let running = null;
/** Run one full synchronisation (pull, then push). Concurrent calls share the same run. */
export function sync(opts = {}) {
  if (running) return running;
  running = (async () => {
    setStatus({ running: true, phase: 'Kontroluji změny', done: 0, total: 0, error: null });
    try {
      if (!store.conn || !store.conn.token) throw new SyncError('noconn', 'Aplikace zatím není připojená k úložišti.');
      const gh = client(store.conn);
      let result = { pulled: 0, pushed: 0, conflicts: 0 };
      for (let attempt = 0; attempt < 4; attempt++) {
        const pulled = await pull(gh);
        result.pulled += pulled.count;
        result.conflicts += pulled.conflicts;
        const pushed = await push(gh, pulled.treeSha, opts);
        if (pushed !== 'retry') { result.pushed = pushed; break; }
      }
      await setLastSync(new Date().toISOString());
      setStatus({ running: false, phase: '', error: null, lastResult: result });
      return result;
    } catch (e) {
      const err = e instanceof SyncError ? e : new SyncError('unknown', e && e.message ? e.message : String(e));
      setStatus({ running: false, phase: '', error: err });
      throw err;
    } finally {
      running = null;
    }
  })();
  return running;
}

async function pull(gh) {
  const head = await gh.head();
  const commit = await gh.commit(head);
  const treeSha = commit.tree.sha;
  if (head === store.head && store.trackVersion === TRACK_VERSION) return { count: 0, conflicts: 0, treeSha, head };

  setStatus({ phase: 'Stahuji změny' });
  const remote = (await gh.tree(treeSha)).filter(e => tracked(e.path));
  const remotePaths = new Set(remote.map(e => e.path));
  const toFetch = remote.filter(e => { const f = store.files.get(e.path); return !f || f.sha !== e.sha; });
  setStatus({ total: toFetch.length, done: 0 });
  let done = 0;
  const texts = await pool(toFetch, 6, async e => {
    const t = await gh.blob(e.sha);
    setStatus({ done: ++done });
    return t;
  });

  const changed = [], removed = [];
  let conflicts = 0;
  toFetch.forEach((e, i) => {
    const remoteText = texts[i];
    const f = store.files.get(e.path);
    if (!f) {
      const nf = { path: e.path, text: remoteText, base: remoteText, sha: e.sha, deleted: false };
      store.files.set(e.path, nf); changed.push(nf); return;
    }
    const localChanged = f.deleted || f.base == null || f.text !== f.base;
    if (!localChanged) {
      Object.assign(f, { text: remoteText, base: remoteText, sha: e.sha, deleted: false });
      changed.push(f); return;
    }
    if (f.deleted) {
      // deleted on the phone, edited in the repository: keep the repository version
      Object.assign(f, { text: remoteText, base: remoteText, sha: e.sha, deleted: false });
      changed.push(f); return;
    }
    const m = mergeFile(e.path, f.base, f.text, remoteText);
    Object.assign(f, { text: m.text, base: remoteText, sha: e.sha });
    changed.push(f);
    if (m.conflict != null) {
      conflicts++;
      const name = e.path.replace(/^pojmy\//, '').replace(/\.md$/, '');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const cp = { path: `konflikty/${name}-${stamp}.md`, text: conflictCopy(m.conflict), base: null, sha: null, deleted: false };
      store.files.set(cp.path, cp); changed.push(cp);
    }
  });
  // files that disappeared from the repository
  for (const f of [...store.files.values()]) {
    if (!tracked(f.path) || remotePaths.has(f.path) || f.base == null) continue;
    const localChanged = !f.deleted && f.text !== f.base;
    if (localChanged) { Object.assign(f, { base: null, sha: null }); changed.push(f); }
    else { store.files.delete(f.path); removed.push(f.path); }
  }
  await commitFiles(changed, removed);
  await setHead(head);
  if (store.trackVersion !== TRACK_VERSION) await setTrackVersion(TRACK_VERSION);
  return { count: toFetch.length + removed.length, conflicts, treeSha, head };
}

function conflictCopy(text) {
  // conflict copies are plain notes, not pages: drop the id so they never shadow the real page
  const p = parsePage(text);
  if (!p) return text;
  return `Verze z úložiště, kterou se nepodařilo sloučit se změnou z telefonu (${new Date().toLocaleString('cs-CZ')}).\n\n` +
    `Pojem: ${p.meta.pojem || ''}\n\n---\n\n${p.body}`;
}

async function push(gh, treeSha, opts) {
  const pending = pendingFiles();
  if (!pending.length) return 0;
  setStatus({ phase: 'Odesílám změny', done: 0, total: pending.length });
  const snapshot = pending.map(f => ({ path: f.path, deleted: !!f.deleted, text: f.text, base: f.base }));
  const entries = snapshot.map(s => s.deleted
    ? { path: s.path, mode: '100644', type: 'blob', sha: null }
    : { path: s.path, mode: '100644', type: 'blob', content: s.text });
  const tree = await gh.createTree(treeSha, entries);
  const commit = await gh.createCommit(commitMessage(snapshot), tree.sha, [store.head]);
  try {
    await gh.updateRef(commit.sha);
  } catch (e) {
    if (e.code === 'conflict') return 'retry';
    throw e;
  }
  const newTree = (await gh.tree(tree.sha)).filter(e => tracked(e.path));
  const shaOf = new Map(newTree.map(e => [e.path, e.sha]));
  const changed = [], removed = [];
  for (const s of snapshot) {
    const f = store.files.get(s.path);
    if (s.deleted) {
      if (f && f.deleted) { store.files.delete(s.path); removed.push(s.path); }
      else if (f) { Object.assign(f, { base: null, sha: null }); changed.push(f); }
      continue;
    }
    if (!f) continue;
    Object.assign(f, { base: s.text, sha: shaOf.get(s.path) || null });
    changed.push(f);
  }
  await commitFiles(changed, removed);
  await setHead(commit.sha);
  setStatus({ done: pending.length });
  return snapshot.length;
}

function titleOf(text) {
  const p = parsePage(text);
  return p ? String(p.meta.pojem || '').trim() : '';
}

export function commitMessage(snapshot) {
  const review = [], edit = [], created = [], deleted = [], other = [];
  for (const s of snapshot) {
    if (!s.path.startsWith('pojmy/')) { if (s.path !== 'historie.json') other.push(s.path); continue; }
    if (s.deleted) { deleted.push(titleOf(s.base) || s.path); continue; }
    if (s.base == null) { created.push(titleOf(s.text) || s.path); continue; }
    const a = parsePage(s.base), b = parsePage(s.text);
    const t = titleOf(s.text) || s.path;
    if (a && b && a.body === b.body) {
      const keys = Object.keys({ ...a.meta, ...b.meta }).filter(k => JSON.stringify(a.meta[k]) !== JSON.stringify(b.meta[k]));
      if (keys.length && keys.every(k => k === 'uroven' || k === 'opakovani')) { review.push(t); continue; }
    }
    edit.push(t);
  }
  const parts = [];
  if (created.length) parts.push(`Nový pojem: ${created.join(', ')}`);
  if (edit.length) parts.push(`Úprava: ${edit.join(', ')}`);
  if (review.length) parts.push(`Opakování: ${review.join(', ')}`);
  if (deleted.length) parts.push(`Smazáno: ${deleted.join(', ')}`);
  if (other.length) parts.push(`Soubory: ${other.join(', ')}`);
  if (!parts.length) parts.push('Historie opakování');
  let subject = parts.join('; ');
  if (subject.length > 72) subject = subject.slice(0, 69).replace(/[,; ]+[^,; ]*$/, '') + '…';
  return `${subject}\n\nZměny z aplikace IT Pojmy na telefonu:\n` + parts.map(p => `- ${p}`).join('\n') + '\n';
}

/** Check a new connection: the token must see the repository and be allowed to write. */
export async function testConnection(conn) {
  const gh = client(conn);
  const repo = await gh.repo();
  if (repo.permissions && repo.permissions.push === false) throw new SyncError('forbidden', 'Klíč má k úložišti jen čtení. Povolte mu Contents: Read and write.');
  await gh.head();
  return repo;
}
