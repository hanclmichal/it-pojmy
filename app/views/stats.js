// "Přehled": levels, categories, upcoming reviews and review history.
import { store } from '../store.js';
import { h, fmtLong, fmtNarrow } from '../ui.js';
import { dayKey, addDays, parseDay, daysBetween, plural, LEVELS } from '../format.js';
import { doneIn, streakOf, lvlName } from '../srs.js';

function computeStats(today) {
  const rows = [...store.pages.values()];
  const byLvl = [0, 0, 0, 0, 0];
  const cats = {};
  const fc = new Array(14).fill(0);
  let noDate = 0, checked = 0, later = 0;
  for (const r of rows) {
    const li = r.lvl < 0 ? 4 : r.lvl;
    byLvl[li]++;
    const c = cats[r.cat] || (cats[r.cat] = { name: r.cat || 'Bez kategorie', n: 0, lv: [0, 0, 0, 0, 0] });
    c.n++; c.lv[li]++;
    if (r.checked) checked++;
    if (!r.due) { noDate++; continue; }
    const diff = daysBetween(today, r.due);
    if (diff <= 0) fc[0]++; else if (diff < 14) fc[diff]++; else later++;
  }
  const catList = Object.values(cats).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'cs'));
  return { total: rows.length, byLvl, cats: catList, fc, later, overdue: fc[0], noDate, checked };
}

const sec = (title, right, cap, body) => h('section', { class: 'stat' },
  h('h2', { class: 'stat__h' }, title, right ? h('small', { text: right }) : null),
  cap ? h('p', { class: 'muted', text: cap }) : null, body);

function levelBar(st) {
  const seg = h('div', { class: 'lvlbar', role: 'img', 'aria-label': 'Rozložení pojmů podle úrovně znalosti' });
  const legend = h('ul', { class: 'legend' });
  [0, 1, 2, 3, 4].forEach(i => {
    const n = st.byLvl[i];
    if (!n) return;
    const li = i === 4 ? -1 : i;
    seg.append(h('span', { class: `lvlbar__p lv${li < 0 ? 'n' : li}`, style: { flex: String(n) }, title: `${lvlName(li)}: ${n}` }, n / st.total > 0.07 ? String(n) : ''));
    legend.append(h('li', null, h('i', { class: `dot lv${li < 0 ? 'n' : li}` }), lvlName(li), h('b', { text: String(n) })));
  });
  return [seg, legend];
}

function catBars(st) {
  const max = st.cats.length ? st.cats[0].n : 1;
  return h('ul', { class: 'cats' }, st.cats.map(c => h('li', { class: 'cats__row' },
    h('span', { class: 'cats__n', text: c.name }),
    h('span', { class: 'cats__track' },
      h('span', { class: 'cats__bar', style: { width: `${Math.max(2, Math.round(c.n / max * 100))}%` } },
        [0, 1, 2, 3].map(i => c.lv[i] ? h('span', { class: `lv${i}`, style: { flex: String(c.lv[i]) }, title: `${lvlName(i)}: ${c.lv[i]}` }) : null)),
      h('span', { class: 'cats__v', text: String(c.n) })))));
}

function columns(counts, days, max, unit, today, firstLabel) {
  return h('div', { class: 'cols' }, counts.map((n, i) => h('div', { class: 'cols__c', title: `${firstLabel && i === 0 ? firstLabel : fmtLong.format(parseDay(days[i]))}: ${n} ${plural(n, unit[0], unit[1], unit[2])}` },
    h('div', { class: 'cols__plot' },
      n ? h('span', { class: 'cols__v', text: String(n) }) : null,
      n ? h('div', { class: 'cols__bar', style: { height: `${Math.max(3, Math.round(n / max * 84))}px` } }) : null),
    h('span', { class: 'cols__l' + (days[i] === today ? ' now' : '') }, fmtNarrow.format(parseDay(days[i])), h('br'), String(parseDay(days[i]).getDate())))));
}

export function render(root, params, nav) {
  nav.setTitle('Přehled');
  function draw() {
    root.replaceChildren();
    const today = dayKey(new Date());
    if (!store.pages.size) { root.append(h('div', { class: 'empty' }, h('p', { text: 'Statistiky se zobrazí po stažení pojmů.' }))); return; }
    const st = computeStats(today);
    const d = store.history.dny[today];
    const q = d && d.fronta;
    const tiles = h('div', { class: 'tiles' }, [
      ['Pojmů', st.total],
      ['Čeká na opakování', st.overdue],
      ['Hotovo dnes', q ? `${doneIn(d)} z ${q.length}` : '0'],
      [plural(streakOf(store.history.dny, today), 'Den v sérii', 'Dny v sérii', 'Dní v sérii'), String(streakOf(store.history.dny, today))]
    ].map(([l, v]) => h('div', { class: 'tile2' }, h('b', { text: String(v) }), h('span', { text: l }))));
    const lim = Number(store.history.nastaveni && store.history.nastaveni.denne) || 3;
    const hints = [];
    if (st.overdue > lim) hints.push(`Po termínu čeká ${st.overdue} pojmů, při ${lim} denně je to zhruba ${Math.ceil(st.overdue / lim)} dní jen na první průchod.`);
    if (st.noDate) hints.push(`${st.noDate} ${plural(st.noDate, 'pojem nemá', 'pojmy nemají', 'pojmů nemá')} datum opakování a berou se jako splatné dnes.`);

    const fcDays = st.fc.map((n, i) => addDays(today, i));
    const histDays = []; for (let i = 13; i >= 0; i--) histDays.push(addDays(today, -i));
    const cnt = histDays.map(k => doneIn(store.history.dny[k]));
    const sn = streakOf(store.history.dny, today);

    root.append(h('div', { class: 'stats' },
      tiles,
      hints.length ? h('p', { class: 'note note--soft', text: hints.join(' ') }) : null,
      sec('Úroveň znalosti', `${st.total} ${plural(st.total, 'pojem', 'pojmy', 'pojmů')}`, null, levelBar(st)),
      sec('Kategorie', `${st.cats.length}`, 'Počet pojmů v kategorii, barva ukazuje úroveň znalosti.', catBars(st)),
      sec('Opakování v příštích 14 dnech', null, 'První sloupec je dnes a vše po termínu.' + (st.later ? ` Později: ${st.later}.` : ''),
        columns(st.fc, fcDays, Math.max(1, ...st.fc), ['pojem', 'pojmy', 'pojmů'], today, 'Dnes a po termínu')),
      sec('Ohodnocená témata', sn > 0 ? `série ${sn}` : null, `Posledních 14 dní. Cíl je ${lim} denně.`,
        cnt.some(n => n) ? columns(cnt, histDays, Math.max(lim, ...cnt), ['téma', 'témata', 'témat'], today, null)
          : h('p', { class: 'muted', text: 'Zatím žádný záznam. Ohodnoťte téma na záložce Dnes.' }))));
  }
  draw();
  return { refresh: draw };
}
