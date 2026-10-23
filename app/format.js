// File format of the data repository: front matter (`key: <JSON>` per line) + Markdown body.

export const KEY_ORDER = ['id', 'pojem', 'ikona', 'kategorie', 'typ', 'definice', 'priorita', 'uroven', 'stav', 'opakovani', 'vytvoreno', 'souvisi'];

export const LEVELS = ['🆕 Nové', '📖 Učím se', '✅ Umím', '🎓 Ovládám'];
export const LEVEL_NAMES = ['Nové', 'Učím se', 'Umím', 'Ovládám'];
export const INTERVALS = [1, 7, 30, 90];
export const PRIORITIES = ['🔴 Vysoká', '🟡 Střední', '🟢 Nízká'];

/** Parse a page file. Returns { meta, body } or null when the file has no front matter. */
export function parsePage(text) {
  const src = String(text || '').replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) return null;
  const end = src.indexOf('\n---\n', 4);
  const endAtEof = end < 0 && src.endsWith('\n---');
  if (end < 0 && !endAtEof) return null;
  const head = src.slice(4, end < 0 ? src.length - 4 : end);
  const body = end < 0 ? '' : src.slice(end + 5).replace(/^\n+/, '');
  const meta = {};
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    meta[key] = parseValue(raw);
  }
  return { meta, body };
}

function parseValue(raw) {
  if (raw === '' || raw === '~' || raw === 'null') return null;
  try { return JSON.parse(raw); } catch (e) { /* plain YAML scalar */ }
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return raw.replace(/^["']|["']$/g, '');
}

export function serializePage(meta, body) {
  const lines = ['---'];
  const keys = KEY_ORDER.filter(k => k in meta).concat(Object.keys(meta).filter(k => !KEY_ORDER.includes(k)));
  for (const k of keys) {
    const v = meta[k] === undefined ? null : meta[k];
    // arrays as ["a", "b"] (with a space) to match the files written by the converter and keep diffs small
    lines.push(`${k}: ${Array.isArray(v) ? '[' + v.map(x => JSON.stringify(x)).join(', ') + ']' : JSON.stringify(v)}`);
  }
  lines.push('---');
  const b = String(body || '').replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return lines.join('\n') + '\n\n' + b + '\n';
}

/* ---------- sections ---------- */

/** Split a Markdown body into sections at level-1 headings, ignoring fenced code.
 *  Returns { pre, sections: [{ title, text }] } where text includes the heading line
 *  but not the `---` separator that follows the section. */
export function splitSections(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const chunks = [[]];
  let fence = null;
  for (const line of lines) {
    const fm = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && line.trim() === fm[1]) fence = null;
    } else if (fm) {
      fence = fm[1];
    } else if (/^# /.test(line)) {
      chunks.push([]);
    }
    chunks[chunks.length - 1].push(line);
  }
  const clean = arr => stripSep(arr.join('\n'));
  const pre = clean(chunks[0]);
  const sections = chunks.slice(1).map(arr => {
    const text = clean(arr);
    return { title: arr[0].replace(/^# /, '').trim(), text };
  });
  return { pre, sections };
}

function stripSep(text) {
  let t = text.replace(/\s+$/, '');
  // a trailing thematic break separates this section from the next one
  for (;;) {
    const m = t.match(/\n\s*(-{3,}|\*{3,}|_{3,})\s*$/);
    if (!m) break;
    t = t.slice(0, m.index).replace(/\s+$/, '');
  }
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t.trim())) t = '';
  return t;
}

export function joinSections(pre, sections) {
  const parts = [];
  if (pre && pre.trim()) parts.push(pre.trim());
  for (const s of sections) if (s.text && s.text.trim()) parts.push(s.text.trim());
  return parts.join('\n\n---\n\n') + '\n';
}

/** Short emoji (or first letters) for a section title, used by the section rail. */
export function sectionMark(title) {
  const m = String(title).match(/^(\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*️?)/u);
  return m ? m[1] : String(title).slice(0, 2);
}
export function sectionLabel(title) {
  return String(title).replace(/^(\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*️?)\s*/u, '');
}

/* ---------- self-test questions ---------- */

/** Extract <details> blocks from the "Otestuj se" section: [{ q, a }] (q is HTML, a is Markdown). */
export function quizOf(body) {
  const { sections } = splitSections(body);
  const sec = sections.find(s => /otestuj/i.test(s.title));
  if (!sec) return [];
  const out = [];
  const re = /<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
  let m;
  while ((m = re.exec(sec.text))) out.push({ q: m[1].trim(), a: m[2].trim() });
  return out;
}

/* ---------- ids, slugs, dates ---------- */

export function newId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

export function slugify(title, taken) {
  let s = String(title || '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const noParen = s.replace(/\([^)]*\)/g, '');
  if (noParen.trim().length >= 2) s = noParen;
  s = s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'pojem';
  let out = s, i = 2;
  while (taken && taken.has(out)) out = `${s}-${i++}`;
  return out;
}

export const pad = n => String(n).padStart(2, '0');
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseDay(k) { const p = String(k).slice(0, 10).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
export function addDays(k, n) { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); }
export function nowStamp() { const d = new Date(); return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function daysBetween(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 86400000); }

export function levelIndex(v) { const i = LEVELS.indexOf(v); return i; }
export function priorityRank(v) { const i = PRIORITIES.indexOf(v); return i < 0 ? 0 : 3 - i; }
export function strip(v) { return String(v || '').replace(/^[^\p{L}\p{N}]+/u, '').trim(); }
export function norm(s) { return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(); }
export function plural(n, one, few, many) { return n === 1 ? one : (n >= 2 && n <= 4 ? few : many); }
