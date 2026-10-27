// "Kvíz": multiple-choice questions (A–D) generated from the definitions of the pages.
// Answer statistics stay on this device (IndexedDB, key `quiz`); the review levels and dates
// of the pages are not changed by the quiz. Wrong answers can be added to today's review queue.
import { store, saveHistory } from '../store.js';
import { kv } from '../db.js';
import { h, put, toast, icon, fmtTime, confirmSheet } from '../ui.js';
import { dayKey, plural } from '../format.js';
import { dueToday, entryOf, LIMITS } from '../srs.js';
import { LETTERS, KINDS, COUNTS, SCOPES, usable, poolOf, makeQuiz, recordAnswer, isRight, scoreOf, verdict, missedLast } from '../quiz.js';

const data = { loaded: false, settings: { cat: '', scope: 'all', kind: 'mix', n: 10 }, terms: {}, runs: [] };
let loading = null;
/** The quiz in progress survives switching tabs or opening a page: { qs, i, opts, label, at, saved, added } */
let session = null;

function load() {
  if (!loading) {
    loading = kv.get('quiz')
      .then(v => {
        if (!v) return;
        Object.assign(data.settings, v.settings || {});
        data.terms = v.terms || {};
        data.runs = Array.isArray(v.runs) ? v.runs : [];
      })
      .catch(() => { /* storage unavailable: start empty */ })
      .finally(() => { data.loaded = true; });
  }
  return loading;
}
const save = () => kv.set('quiz', { settings: data.settings, terms: data.terms, runs: data.runs }).catch(() => {});

const allPages = () => [...store.pages.values()];
const qWord = n => plural(n, 'otázka', 'otázky', 'otázek');
const scopeName = k => (SCOPES.find(s => s.k === k) || SCOPES[0]).name;

/** Text with hidden names: strings stay text, `null` becomes a dashed placeholder. */
const masked = parts => parts.map(x => x === null
  ? h('span', { class: 'qz-mask', role: 'img', 'aria-label': 'skrytý název pojmu', text: '•••' })
  : x);

function progress(qs, cur) {
  return h('div', { class: 'prog', 'aria-hidden': 'true' }, qs.map((q, j) =>
    h('i', { class: q.answer == null ? (j === cur ? 'cur' : '') : isRight(q) ? 'on' : 'bad' })));
}

export function render(root, params, nav) {
  nav.setTitle('Kvíz');
  const box = h('div', { class: 'quizv' });
  root.append(box);
  let alive = true;

  function draw() {
    if (!alive) return;
    if (!data.loaded) {
      put(box, h('div', { class: 'empty' }, h('p', { class: 'muted', text: 'Načítám…' })));
      load().then(draw);
      return;
    }
    if (!store.pages.size) {
      put(box, h('div', { class: 'empty' },
        h('h2', { text: 'Zatím tu nejsou žádné pojmy' }),
        h('p', { text: 'Kvíz bude k dispozici po stažení pojmů.' })));
      return;
    }
    if (!session) drawSetup();
    else if (session.i < session.qs.length) drawQuestion();
    else drawResult();
  }

  /* ---------- start ---------- */
  function start(opts, label) {
    const qs = makeQuiz(allPages(), opts, data.terms, store.glossary);
    if (!qs.length) { toast('Pro tento výběr nejde sestavit žádná otázka.'); return; }
    session = { qs, i: 0, opts, label, at: new Date().toISOString(), saved: false, added: false };
    window.scrollTo(0, 0);
    draw();
  }

  /* ---------- setup ---------- */
  function drawSetup() {
    const s = data.settings;
    const pages = allPages();
    const good = usable(pages);
    const cats = [...new Set(good.map(p => p.cat).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs'));
    if (s.cat && !cats.includes(s.cat)) s.cat = '';
    if (!SCOPES.some(x => x.k === s.scope)) s.scope = 'all';
    if (!KINDS.some(x => x.k === s.kind)) s.kind = 'mix';
    if (!COUNTS.includes(Number(s.n))) s.n = 10;
    const pool = poolOf(pages, s, data.terms);
    const n = s.n ? Math.min(s.n, pool.length) : pool.length;
    const set = patch => { Object.assign(data.settings, patch); save(); draw(); };
    const missedN = good.filter(p => missedLast(data.terms, p.id)).length;
    const enough = good.length >= 4;

    const catSel = h('select', { class: 'field', 'aria-label': 'Kategorie', onchange: e => set({ cat: e.target.value }) },
      h('option', { value: '', text: `Všechny kategorie (${good.length})` }),
      cats.map(c => h('option', { value: c, text: `${c} (${good.filter(p => p.cat === c).length})`, selected: c === s.cat })));
    const scopeSel = h('select', { class: 'field', 'aria-label': 'Úroveň znalosti', onchange: e => set({ scope: e.target.value }) },
      SCOPES.map(x => h('option', { value: x.k, text: x.k === 'missed' ? `${x.name} (${missedN})` : x.name, selected: x.k === s.scope })));
    const seg = (label, items, cur, key) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, items.map(it =>
      h('button', { type: 'button', 'aria-pressed': String(cur === it.v), onclick: () => set({ [key]: it.v }) }, it.t)));

    const runs = data.runs.slice(0, 5);
    put(box,
      h('header', { class: 'dayhead' },
        h('h2', { class: 'dayhead__title', text: 'Kvíz' }),
        h('p', { class: 'muted', text: 'Otázky s možnostmi A až D z definic pojmů. Špatné možnosti jsou hlavně pojmy ze stejné kategorie, takže rozlišujete příbuzné věci.' })),
      h('section', { class: 'panel' },
        h('h3', { text: 'Které pojmy' }),
        h('div', { class: 'qz-sels' }, catSel, scopeSel),
        h('p', { class: 'muted small', text: pool.length ? `Ve výběru: ${pool.length} ${plural(pool.length, 'pojem', 'pojmy', 'pojmů')}. Častěji přijdou na řadu nové a minule chybné.` : 'Tomuto výběru neodpovídá žádný pojem.' })),
      h('section', { class: 'panel' },
        h('h3', { text: 'Typ otázek' }),
        seg('Typ otázek', KINDS.map(k => ({ v: k.k, t: k.name })), s.kind, 'kind'),
        h('p', { class: 'muted small', text: (KINDS.find(k => k.k === s.kind) || KINDS[0]).help })),
      h('section', { class: 'panel' },
        h('h3', { text: 'Počet otázek' }),
        seg('Počet otázek', COUNTS.map(c => ({ v: c, t: c ? String(c) : 'Vše' })), Number(s.n), 'n')),
      !enough ? h('p', { class: 'note note--soft', text: 'Na kvíz jsou potřeba aspoň 4 pojmy s definicí.' }) : null,
      h('button', {
        class: 'btn btn--primary btn--block qz-start', type: 'button', disabled: !enough || !n,
        onclick: () => start({ ...data.settings }, `${s.cat || 'Všechny kategorie'}, ${scopeName(s.scope).toLowerCase()}`)
      }, n ? `Začít kvíz: ${n} ${qWord(n)}` : 'Začít kvíz'),
      runs.length ? h('section', { class: 'panel' },
        h('h3', { text: 'Poslední kvízy' }),
        h('ul', { class: 'qz-runs' }, runs.map(r => h('li', null,
          h('span', { class: 'qz-runs__t' }, h('span', { text: fmtTime.format(new Date(r.at)) }), h('small', { class: 'muted', text: r.label || '' })),
          h('b', { text: `${r.ok} z ${r.n}` }))))) : null);
  }

  /* ---------- question ---------- */
  function answer(j) {
    const q = session && session.qs[session.i];
    if (!q || q.answer != null) return;
    q.answer = j;
    data.terms = recordAnswer(data.terms, q.id, j === q.correct, new Date().toISOString());
    save();
    draw();
    requestAnimationFrame(() => {
      const nx = box.querySelector('.qz-next');
      if (nx) nx.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function next() {
    session.i++;
    if (session.i >= session.qs.length && !session.saved) {
      session.saved = true;
      data.runs = [{ at: new Date().toISOString(), n: session.qs.length, ok: scoreOf(session.qs), label: session.label }, ...data.runs].slice(0, 30);
      save();
    }
    window.scrollTo(0, 0);
    draw();
  }

  function quit() {
    const end = () => { session = null; window.scrollTo(0, 0); draw(); };
    if (!session.qs.some(q => q.answer != null)) { end(); return; }
    confirmSheet('Ukončit kvíz?', 'Odpovědi, které už máte, zůstanou ve statistice kvízu.', 'Ukončit', end);
  }

  function drawQuestion() {
    const { qs, i } = session;
    const q = qs[i];
    const done = q.answer != null;
    const right = isRight(q);
    const last = i === qs.length - 1;

    const prompt = q.kind === 'def'
      ? h('div', { class: 'qz-q' },
          h('p', { class: 'qz-ask', text: 'Která definice patří k pojmu?' }),
          q.cat ? h('p', { class: 'qcard__cat', text: q.cat }) : null,
          h('h2', { class: 'qz-term' }, q.icon ? h('span', { class: 'qz-term__icon', text: q.icon, 'aria-hidden': 'true' }) : null, h('span', { text: q.title })))
      : h('div', { class: 'qz-q' },
          h('p', { class: 'qz-ask', text: 'Který pojem odpovídá definici?' }),
          h('p', { class: 'qz-def' }, masked(q.prompt)));

    const opts = h('ol', { class: 'qz-opts qz-opts--' + q.kind }, q.options.map((o, j) => {
      const st = !done ? '' : j === q.correct ? ' is-ok' : j === q.answer ? ' is-bad' : ' is-dim';
      const body = q.kind === 'def'
        ? [h('span', { class: 'qz-opt__t' }, masked(o.text)),
           done ? h('span', { class: 'qz-opt__who', text: `${o.icon ? o.icon + ' ' : ''}${o.title}` }) : null]
        : [h('span', { class: 'qz-opt__t', text: `${o.icon ? o.icon + ' ' : ''}${o.title}` }),
           done && j === q.answer && !right ? h('span', { class: 'qz-opt__who qz-opt__who--def', text: o.def }) : null];
      return h('li', null, h('button', {
        type: 'button', class: 'qz-opt' + st, 'aria-disabled': done ? 'true' : null,
        'aria-label': `${LETTERS[j]}: ${q.kind === 'def' ? o.def : o.title}${done && j === q.correct ? ', správná odpověď' : ''}${done && j === q.answer && !right ? ', vaše odpověď' : ''}`,
        onclick: () => answer(j)
      },
        h('span', { class: 'qz-opt__l', text: LETTERS[j], 'aria-hidden': 'true' }),
        h('span', { class: 'qz-opt__b', 'aria-hidden': 'true' }, body),
        done && (j === q.correct || j === q.answer) ? icon(j === q.correct ? 'check' : 'close', 'ico qz-opt__mark') : null));
    }));

    const page = store.pages.get(q.id);
    put(box,
      h('div', { class: 'qz-top' },
        h('div', { class: 'qz-meta' },
          h('span', { text: `Otázka ${i + 1} z ${qs.length}` }),
          h('span', { text: `Správně ${scoreOf(qs)}` }),
          h('button', { class: 'linkbtn', type: 'button', onclick: quit }, 'Ukončit')),
        progress(qs, i)),
      prompt,
      opts,
      done ? h('div', { class: 'qz-fb ' + (right ? 'is-ok' : 'is-bad'), role: 'status' },
        h('strong', { text: right ? 'Správně.' : `Špatně, správná je ${LETTERS[q.correct]}.` }),
        page ? h('a', { href: `#/pojem/${q.id}` }, 'Číst stránku pojmu') : null) : null,
      done ? h('button', { class: 'btn btn--primary btn--block qz-next', type: 'button', onclick: next }, last ? 'Zobrazit výsledek' : 'Další otázka') : null);
  }

  /* ---------- result ---------- */
  async function addMissed(ids) {
    const t = dayKey(new Date());
    const n = Number(store.history.nastaveni && store.history.nastaveni.denne);
    const lim = LIMITS.includes(n) ? n : 3;
    let added = 0;
    await saveHistory(hh => {
      const d = hh.dny[t] || {};
      // no queue yet today: start it the way the Dnes tab would, then append the missed terms
      const f = d.fronta ? d.fronta.slice() : dueToday(allPages(), t, lim, {}).map(entryOf);
      const have = new Set(f.map(e => e.id));
      for (const id of ids) {
        const p = store.pages.get(id);
        if (p && !have.has(id)) { f.push(entryOf(p)); have.add(id); added++; }
      }
      hh.dny[t] = { ...d, fronta: f };
    });
    if (session) session.added = true;
    toast(added ? `Přidáno do dnešního opakování: ${added} ${plural(added, 'téma', 'témata', 'témat')}.` : 'Tato témata už v dnešním opakování jsou.');
    draw();
  }

  function drawResult() {
    const { qs } = session;
    const n = qs.length, ok = scoreOf(qs);
    const missed = qs.filter(q => !isRight(q));
    const ids = missed.map(q => q.id);
    put(box,
      h('header', { class: 'dayhead' },
        h('p', { class: 'dayhead__date', text: 'Výsledek kvízu' }),
        h('h2', { class: 'dayhead__title', text: `${ok} z ${n}` }),
        progress(qs, -1),
        h('p', { class: 'muted', text: `${Math.round(ok / n * 100)} % správně. ${verdict(ok, n)}` })),
      missed.length
        ? h('section', { class: 'panel' },
            h('h3', { text: `Chybné odpovědi (${missed.length})` }),
            h('ul', { class: 'qz-miss' }, missed.map(q => h('li', null, h('a', { href: `#/pojem/${q.id}` },
              h('span', { class: 'pick__icon', text: q.icon || '•', 'aria-hidden': 'true' }),
              h('span', { class: 'pick__t' }, h('b', { text: q.title }), h('small', { text: q.options[q.correct].def })))))))
        : h('div', { class: 'note' }, h('strong', { text: 'Bez chyby.' }), h('p', { text: 'Všechny odpovědi byly správně.' })),
      h('div', { class: 'qz-actions' },
        missed.length ? h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => start({ ids, kind: session.opts.kind }, 'Chybné z minulého kvízu') }, 'Zopakovat chybné') : null,
        missed.length ? h('button', { class: 'btn btn--block', type: 'button', disabled: session.added, onclick: () => addMissed(ids) },
          session.added ? 'Přidáno do dnešního opakování' : 'Přidat chybné do dnešního opakování') : null,
        h('button', { class: 'btn btn--block', type: 'button', onclick: () => { session = null; window.scrollTo(0, 0); draw(); } }, 'Nový kvíz')));
  }

  draw();
  return { refresh: draw, destroy: () => { alive = false; }, keepScroll: false };
}
