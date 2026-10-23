// "Pojmy": the five database views from Notion plus full-text search.
import { store } from '../store.js';
import { h, put, icon, chip, fmtShort } from '../ui.js';
import { norm, parseDay, dayKey, plural, LEVELS } from '../format.js';
import { lvlName } from '../srs.js';

export const VIEWS = [
  { k: 'vse', name: 'Všechny pojmy', icon: '📚' },
  { k: 'dnes', name: 'Dnes opakovat', icon: '🔁' },
  { k: 'uroven', name: 'Podle úrovně', icon: '📊' },
  { k: 'kategorie', name: 'Podle kategorie', icon: '🗂️' },
  { k: 'kontrola', name: 'Ke kontrole', icon: '🔍' }
];

const state = { view: 'vse', q: '' };
const plainCache = new Map();

export function colorOf(prop, value) {
  const opts = store.schema && store.schema.vlastnosti && store.schema.vlastnosti[prop] && store.schema.vlastnosti[prop].moznosti;
  const o = opts && opts.find(x => x.hodnota === value);
  return o ? o.barva : 'default';
}

function plain(p) {
  const key = p.body;
  let v = plainCache.get(p.id);
  if (v && v.key === key) return v.text;
  const text = p.body
    .replace(/<[^>]+>/g, ' ')
    .replace(/\]\((kb:[0-9a-f]+|[^)\s]+)\)/g, ']')
    .replace(/\\([\\`*_{}\[\]()#+\-.!|<>~&])/g, '$1')
    .replace(/\*\*|[`|]|^#+ |^> ?/gm, ' ')
    .replace(/[[\]]/g, '')
    .replace(/\s+/g, ' ');
  plainCache.set(p.id, { key, text });
  return text;
}

function matches(p, nq) {
  if (!nq) return { ok: true };
  if (norm(p.title).includes(nq) || norm(p.def).includes(nq) || norm(p.cat).includes(nq) || norm(p.type).includes(nq)) return { ok: true };
  const t = plain(p);
  const i = norm(t).indexOf(nq);
  if (i < 0) return { ok: false };
  const a = Math.max(0, i - 50), b = Math.min(t.length, i + nq.length + 70);
  return { ok: true, snippet: (a ? '…' : '') + t.slice(a, b).trim() + (b < t.length ? '…' : ''), at: i - a + (a ? 1 : 0), len: nq.length };
}

const dm = k => fmtShort.format(parseDay(k));
function dueText(p) {
  if (!p.due) return 'bez data';
  const t = dayKey(new Date());
  if (p.due < t) return `po termínu od ${dm(p.due)}`;
  if (p.due === t) return 'opakovat dnes';
  return `opakovat ${dm(p.due)}`;
}

function row(p, extra) {
  return h('li', null, h('a', { class: 'row' + (p.dirty ? ' is-dirty' : ''), href: `#/pojem/${p.id}` },
    h('span', { class: 'row__icon', text: p.icon || '•', 'aria-hidden': 'true' }),
    h('span', { class: 'row__main' },
      h('span', { class: 'row__t', text: p.title }),
      extra && extra.snippet ? h('span', { class: 'row__d' }, highlight(extra.snippet, extra.at, extra.len)) : (p.def ? h('span', { class: 'row__d', text: p.def }) : null),
      h('span', { class: 'row__meta' },
        h('span', null, h('i', { class: `dot lv${p.lvl < 0 ? 'n' : p.lvl}` }), lvlName(p.lvl)),
        h('span', { text: dueText(p) }),
        p.type ? h('span', { text: p.type }) : null))));
}

function highlight(text, at, len) {
  if (at == null || at < 0) return text;
  return [text.slice(0, at), h('mark', { text: text.slice(at, at + len) }), text.slice(at + len)];
}

function byCatTitle(a, b) { return a.cat.localeCompare(b.cat, 'cs') || a.title.localeCompare(b.title, 'cs'); }

function grouped(pages, keyFn, order) {
  const groups = new Map();
  for (const p of pages) { const k = keyFn(p) || 'Bez hodnoty'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const keys = [...groups.keys()].sort(order || ((a, b) => a.localeCompare(b, 'cs')));
  return keys.map(k => [k, groups.get(k)]);
}

function viewAll(pages) {
  return grouped(pages.sort(byCatTitle), p => p.cat).map(([k, ps]) =>
    h('section', { class: 'group' },
      h('h3', { class: 'group__h' }, chip(k, colorOf('kategorie', k)), h('span', { class: 'group__n', text: String(ps.length) })),
      h('ul', { class: 'rows' }, ps.map(p => row(p)))));
}

function viewToday(pages) {
  const t = dayKey(new Date());
  const due = pages.filter(p => p.due && p.due <= t).sort((a, b) => a.due.localeCompare(b.due) || b.prio - a.prio);
  if (!due.length) return [h('div', { class: 'note' }, h('strong', { text: 'Nic po termínu.' }), h('p', { text: 'Žádný pojem dnes nečeká na opakování.' }))];
  return [h('p', { class: 'muted count', text: `${due.length} ${plural(due.length, 'pojem čeká', 'pojmy čekají', 'pojmů čeká')} na opakování, nejstarší nahoře.` }), h('ul', { class: 'rows' }, due.map(p => row(p)))];
}

function viewBoard(pages) {
  const cols = [0, 1, 2, 3].map(i => [i, pages.filter(p => p.lvl === i).sort(byCatTitle)]);
  const none = pages.filter(p => p.lvl < 0);
  if (none.length) cols.push([-1, none]);
  return [h('div', { class: 'board' }, cols.map(([i, ps]) =>
    h('section', { class: 'board__col' },
      h('h3', { class: 'board__h' }, i < 0 ? 'Bez úrovně' : LEVELS[i], h('span', { class: 'group__n', text: String(ps.length) })),
      h('ul', { class: 'cards' }, ps.map(p => h('li', null, h('a', { class: 'tile', href: `#/pojem/${p.id}` },
        h('span', { class: 'tile__t' }, h('span', { 'aria-hidden': 'true', text: (p.icon || '•') + ' ' }), p.title),
        h('span', { class: 'tile__m' }, chip(p.cat, colorOf('kategorie', p.cat), 'chip--sm')),
        h('span', { class: 'tile__d', text: dueText(p) }))))))))];
}

function viewGallery(pages) {
  return grouped(pages, p => p.cat).map(([k, ps]) =>
    h('section', { class: 'group' },
      h('h3', { class: 'group__h' }, chip(k, colorOf('kategorie', k)), h('span', { class: 'group__n', text: String(ps.length) })),
      h('ul', { class: 'gallery' }, ps.sort((a, b) => a.title.localeCompare(b.title, 'cs')).map(p => h('li', null, h('a', { class: 'gcard', href: `#/pojem/${p.id}` },
        h('span', { class: 'gcard__icon', text: p.icon || '•', 'aria-hidden': 'true' }),
        h('span', { class: 'gcard__t', text: p.title }),
        h('span', { class: 'gcard__m' }, p.type ? chip(p.type, colorOf('typ', p.type), 'chip--sm') : null, h('span', null, h('i', { class: `dot lv${p.lvl < 0 ? 'n' : p.lvl}` }), lvlName(p.lvl))),
        p.def ? h('span', { class: 'gcard__d', text: p.def }) : null))))));
}

function viewReview(pages) {
  const ps = pages.filter(p => !p.checked).sort(byCatTitle);
  if (!ps.length) return [h('div', { class: 'note' }, h('strong', { text: 'Vše zkontrolováno.' }), h('p', { text: 'Žádná stránka nečeká na vaši kontrolu.' }))];
  return [h('p', { class: 'muted count', text: `${ps.length} ${plural(ps.length, 'stránka je', 'stránky jsou', 'stránek je')} ve stavu Koncept.` }), ...viewAll(ps)];
}

export function render(root, params, nav) {
  nav.setTitle('Pojmy');
  const input = h('input', { type: 'search', class: 'search__in', placeholder: 'Hledat v názvech i textu', 'aria-label': 'Hledat pojmy', value: state.q, enterkeyhint: 'search', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' });
  const tabs = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Pohledy' });
  const body = h('div', { class: 'listbody' });
  root.append(
    h('div', { class: 'listtop' },
      h('div', { class: 'search' }, icon('search'), input,
        h('a', { class: 'iconbtn iconbtn--accent', href: '#/novy', 'aria-label': 'Nový pojem', title: 'Nový pojem' }, icon('plus'))),
      tabs),
    body);

  function drawTabs() {
    put(tabs, VIEWS.map(v => h('button', { type: 'button', role: 'tab', class: 'chipbtn', 'aria-selected': String(state.view === v.k && !state.q), onclick: () => { state.view = v.k; state.q = ''; input.value = ''; draw(); } }, `${v.icon} ${v.name}`)));
  }
  function draw() {
    drawTabs();
    const pages = [...store.pages.values()];
    if (!pages.length) { put(body, h('div', { class: 'empty' }, h('p', { text: 'Zatím žádné pojmy.' }))); return; }
    const nq = norm(state.q.trim());
    if (nq) {
      const hits = [];
      for (const p of pages) { const m = matches(p, nq); if (m.ok) hits.push([p, m]); }
      hits.sort((a, b) => (a[1].snippet ? 1 : 0) - (b[1].snippet ? 1 : 0) || a[0].title.localeCompare(b[0].title, 'cs'));
      put(body,
        h('p', { class: 'muted count', text: hits.length ? `${hits.length} ${plural(hits.length, 'výsledek', 'výsledky', 'výsledků')}` : 'Nic nenalezeno. Zkuste jiné slovo nebo zkratku.' }),
        h('ul', { class: 'rows' }, hits.map(([p, m]) => row(p, m))));
      return;
    }
    const v = state.view;
    put(body, v === 'dnes' ? viewToday(pages) : v === 'uroven' ? viewBoard(pages) : v === 'kategorie' ? viewGallery(pages) : v === 'kontrola' ? viewReview(pages) : viewAll(pages));
  }
  input.addEventListener('input', () => { state.q = input.value; draw(); });
  draw();
  return { refresh: draw };
}
