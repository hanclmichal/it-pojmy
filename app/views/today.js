// "Dnes": the daily review queue.
import { store, saveHistory, updatePageMeta } from '../store.js';
import { h, put, toast, openSheet, closeSheet, fmtLong, fmtShort, icon } from '../ui.js';
import { dayKey, parseDay, plural, LEVELS, quizOf } from '../format.js';
import { outcome, ratingsFor, ordered, dueToday, entryOf, doneIn, streakOf, lvlName, LIMITS } from '../srs.js';
import { renderMarkdown } from '../render.js';

const reopen = {};
const busy = {};
let ensuring = false;

const dm = k => fmtShort.format(parseDay(k));
const today = () => dayKey(new Date());
const limit = () => { const n = Number(store.history.nastaveni && store.history.nastaveni.denne); return LIMITS.includes(n) ? n : 3; };
const dayQueue = () => { const d = store.history.dny[today()]; return d && d.fronta ? d.fronta : null; };
const queueIds = () => Object.fromEntries((dayQueue() || []).map(e => [e.id, 1]));

/** Make sure today's queue exists and has up to `limit` topics. */
async function ensureQueue() {
  if (ensuring || !store.pages.size) return;
  const t = today();
  const q = dayQueue();
  if (q && q.length >= limit()) return;
  ensuring = true;
  try {
    const cur = q || [];
    const ex = Object.fromEntries(cur.map(e => [e.id, 1]));
    const add = dueToday([...store.pages.values()], t, limit() - cur.length, ex).map(entryOf);
    if (!q || add.length) await saveHistory(hh => { hh.dny[t] = { fronta: cur.concat(add) }; });
  } finally { ensuring = false; }
}

async function setQueue(fn) {
  const t = today();
  await saveHistory(hh => { const d = hh.dny[t] || { fronta: [] }; d.fronta = fn(d.fronta || []); hh.dny[t] = d; });
}

async function rate(e, k) {
  if (busy[e.id]) return;
  const p = store.pages.get(e.id);
  if (!p) { toast('Pojem už neexistuje.'); return; }
  busy[e.id] = true;
  // an unrated topic starts from its current level (it may have changed since the queue was made);
  // changing an existing rating starts again from the level the topic had before it was rated
  const lvl0 = e.res ? e.lvl0 : p.lvl;
  const due0 = e.res ? e.due0 : (p.due || null);
  const res = outcome(k, lvl0 == null ? 0 : lvl0, today());
  try {
    await updatePageMeta(e.id, { uroven: LEVELS[res.lvl], opakovani: res.due });
    await setQueue(f => f.map(x => x.id === e.id ? { ...x, lvl0, due0, res: { k, lvl: res.lvl, due: res.due, at: new Date().toISOString() } } : x));
    delete reopen[e.id];
    toast(`Uloženo: ${lvlName(res.lvl)}, opakovat ${dm(res.due)}.`);
  } finally { busy[e.id] = false; }
}

function quizSheet(p) {
  const qs = quizOf(p.body);
  let i = 0, shown = false;
  const box = h('div', { class: 'quiz' });
  function draw() {
    const q = qs[i];
    const answer = h('div', { class: 'quiz__a prose', html: renderMarkdown(q.a) });
    answer.hidden = !shown;
    put(box,
      h('p', { class: 'quiz__n', text: `Otázka ${i + 1} z ${qs.length}` }),
      h('p', { class: 'quiz__q', html: window.DOMPurify.sanitize(q.q) }),
      answer,
      h('div', { class: 'row-actions' },
        !shown ? h('button', { class: 'btn btn--primary', type: 'button', onclick: () => { shown = true; draw(); } }, 'Ukázat odpověď') : null,
        shown && i < qs.length - 1 ? h('button', { class: 'btn btn--primary', type: 'button', onclick: () => { i++; shown = false; draw(); } }, 'Další otázka') : null,
        shown && i === qs.length - 1 ? h('button', { class: 'btn btn--primary', type: 'button', onclick: () => closeSheet() }, 'Hotovo, ohodnotit') : null));
  }
  draw();
  openSheet(p.title, box);
}

function card(e, nav) {
  const p = store.pages.get(e.id);
  if (!p) return h('article', { class: 'qcard' }, h('p', { class: 'muted', text: 'Tento pojem byl smazán.' }));
  const res = e.res && !reopen[e.id] ? e.res : null;
  const qn = quizOf(p.body).length;
  const lvl0 = e.res ? e.lvl0 : p.lvl;
  const due0 = e.res ? e.due0 : (p.due || null);
  const kids = [
    h('div', { class: 'qcard__head' },
      h('span', { class: 'qcard__icon', text: p.icon || '•', 'aria-hidden': 'true' }),
      h('div', null,
        h('p', { class: 'qcard__cat', text: p.cat }),
        h('h2', { class: 'qcard__title' }, h('a', { href: `#/pojem/${p.id}`, text: p.title })))),
    p.def ? h('p', { class: 'qcard__def', text: p.def }) : null,
    h('ul', { class: 'facts-inline' },
      h('li', null, h('i', { class: `dot lv${lvl0 == null || lvl0 < 0 ? 'n' : lvl0}` }), `${e.res ? 'Předtím' : 'Teď'} ${lvlName(lvl0 == null ? -1 : lvl0)}`),
      h('li', { text: due0 ? `Termín ${dm(due0)}` : 'Bez termínu' }),
      h('li', { text: p.prio ? `Priorita ${['', 'nízká', 'střední', 'vysoká'][p.prio]}` : 'Bez priority' })),
    h('div', { class: 'qcard__actions' },
      h('a', { class: 'btn btn--sm btn--primary', href: `#/pojem/${p.id}` }, 'Číst stránku'),
      qn ? h('button', { class: 'btn btn--sm', type: 'button', onclick: () => quizSheet(p) }, `Otázky (${qn})`) : null,
      !e.res ? h('button', { class: 'btn btn--sm', type: 'button', onclick: () => chooser(e.id, nav) }, 'Vyměnit') : null)
  ];
  if (res) {
    kids.push(h('div', { class: 'qcard__done' },
      h('span', null, icon('check'), ` ${lvlName(res.lvl)}, další opakování ${dm(res.due)}`),
      h('button', { class: 'linkbtn', type: 'button', onclick: () => { reopen[e.id] = true; nav.refresh(); } }, 'Změnit hodnocení')));
  } else {
    kids.push(h('p', { class: 'qcard__ask', text: 'Jak to šlo?' }));
    const rs = ratingsFor(lvl0 == null ? 0 : lvl0);
    kids.push(h('div', { class: 'rate rate--' + rs.length, role: 'group', 'aria-label': 'Jak to šlo' }, rs.map(rt => {
      const o = outcome(rt.k, lvl0 == null ? 0 : lvl0, today());
      return h('button', { type: 'button', disabled: !!busy[e.id], onclick: () => rate(e, rt.k) },
        h('b', { text: rt.name }), h('span', { text: `${lvlName(o.lvl)}, ${dm(o.due)}` }));
    })));
  }
  return h('article', { class: 'qcard' + (e.res ? ' is-done' : '') }, kids);
}

function chooser(replaceId, nav) {
  const q = dayQueue();
  if (!q) return;
  const f = { cat: '', lvl: '' };
  const ex = queueIds();
  const cats = [...new Set([...store.pages.values()].map(p => p.cat).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs'));
  const pool = () => ordered([...store.pages.values()], today(), ex).filter(p => (!f.cat || p.cat === f.cat) && (f.lvl === '' || p.lvl === Number(f.lvl)));
  const pick = async p => {
    closeSheet();
    if (replaceId) { await setQueue(fr => fr.map(x => x.id === replaceId && !x.res ? entryOf(p) : x)); toast('Téma je vyměněné.'); }
    else { await setQueue(fr => fr.concat(entryOf(p))); toast('Přidáno do dnešní řady.'); }
  };
  const cat = h('select', { 'aria-label': 'Kategorie', onchange: ev => { f.cat = ev.target.value; redraw(); } },
    h('option', { value: '', text: 'Všechny kategorie' }), cats.map(c => h('option', { value: c, text: c })));
  const lvl = h('select', { 'aria-label': 'Úroveň znalosti', onchange: ev => { f.lvl = ev.target.value; redraw(); } },
    h('option', { value: '', text: 'Všechny úrovně' }), [0, 1, 2, 3].map(i => h('option', { value: String(i), text: lvlName(i) })));
  const list = h('ul', { class: 'pick' });
  function redraw() {
    const p = pool();
    if (!p.length) { put(list, h('li', { class: 'muted', text: 'Pro tento výběr není žádné téma.' })); return; }
    put(list, p.slice(0, 8).map(x => h('li', null, h('button', { type: 'button', onclick: () => pick(x) },
      h('span', { class: 'pick__icon', text: x.icon || '•' }),
      h('span', { class: 'pick__t' }, h('b', { text: x.title }), h('small', { text: `${x.cat}, ${lvlName(x.lvl)}, ${x.due ? 'termín ' + dm(x.due) : 'bez termínu'}` }))))));
  }
  redraw();
  openSheet(replaceId ? 'Vyměnit téma' : 'Přidat téma', [
    h('p', { class: 'muted', text: 'Nahoře jsou témata, kterým termín uplynul nejdéle.' }),
    h('div', { class: 'two' }, cat, lvl),
    h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => { const p = pool(); if (p.length) pick(p[Math.floor(Math.random() * p.length)]); } }, 'Vybrat náhodně'),
    list
  ]);
}

export function render(root, params, nav) {
  nav.setTitle('Dnes');
  const box = h('div', { class: 'today' });
  root.append(box);
  const localNav = { ...nav, refresh: draw };

  function draw() {
    const t = today();
    if (!store.pages.size) {
      put(box, h('div', { class: 'empty' },
        h('h2', { text: store.conn ? 'Stahuji pojmy…' : 'Zatím tu nejsou žádné pojmy' }),
        h('p', { text: store.conn ? 'První synchronizace stáhne celou knowledge base do telefonu.' : 'Připojte úložiště v nastavení a aplikace si pojmy stáhne.' }),
        !store.conn ? h('a', { class: 'btn btn--primary', href: '#/nastaveni' }, 'Otevřít nastavení') : null));
      return;
    }
    const q = dayQueue();
    if (!q) { ensureQueue(); put(box, h('div', { class: 'empty' }, h('p', { class: 'muted', text: 'Připravuji dnešní řadu…' }))); return; }
    if (q.length < limit()) ensureQueue();
    const done = q.filter(e => e.res).length;
    const kids = [
      h('header', { class: 'dayhead' },
        h('p', { class: 'dayhead__date', text: fmtLong.format(parseDay(t)) }),
        h('h2', { class: 'dayhead__title', text: q.length ? `Hotovo ${done} z ${q.length}` : 'Dnes nic nečeká' }),
        q.length ? h('div', { class: 'prog', 'aria-hidden': 'true' }, q.map(e => h('i', { class: e.res ? 'on' : '' }))) : null)
    ];
    if (q.length) kids.push(h('div', { class: 'qlist' }, q.map(e => card(e, localNav))));
    if (!q.length) {
      const nx = ordered([...store.pages.values()], t, {})[0];
      kids.push(h('div', { class: 'note' }, h('strong', { text: 'Na dnes není nic po termínu.' }),
        h('p', { text: nx ? `Nejbližší termín je ${dm(nx.due || t)} (${nx.title}).` : 'V knowledge base nejsou žádné pojmy.' })));
    } else if (done === q.length) {
      kids.push(h('div', { class: 'note' }, h('strong', { text: 'Hotovo na dnes.' }), h('p', { text: 'Další téma můžete přidat, ale nemusíte.' })));
    }
    kids.push(h('div', { class: 'two' },
      h('button', { class: 'btn', type: 'button', onclick: async () => { const nx = ordered([...store.pages.values()], t, queueIds())[0]; if (!nx) { toast('Není co přidat.'); return; } await setQueue(fr => fr.concat(entryOf(nx))); toast('Přidáno do dnešní řady.'); } }, 'Přidat další téma'),
      h('button', { class: 'btn', type: 'button', onclick: () => chooser(null, localNav) }, 'Vybrat ručně')));
    const overdue = [...store.pages.values()].filter(p => p.due && p.due <= t).length;
    kids.push(h('section', { class: 'panel' },
      h('h3', { text: 'Témat denně' }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Témat denně' }, LIMITS.map(n =>
        h('button', { type: 'button', 'aria-pressed': String(limit() === n), onclick: () => saveHistory(hh => { hh.nastaveni = { ...(hh.nastaveni || {}), denne: n }; }) }, String(n)))),
      overdue > limit() ? h('p', { class: 'muted', text: `Po termínu čeká ${overdue} ${plural(overdue, 'pojem', 'pojmy', 'pojmů')}. Víc témat denně je vyřídí rychleji.` }) : null));
    const sn = streakOf(store.history.dny, t);
    kids.push(h('p', { class: 'streak', text: sn > 0 ? `Série: ${sn} ${plural(sn, 'pracovní den', 'pracovní dny', 'pracovních dní')} v řadě` : 'Série začne prvním ohodnoceným tématem.' }));
    put(box, kids);
  }
  draw();
  return { refresh: draw };
}

export { doneIn };
