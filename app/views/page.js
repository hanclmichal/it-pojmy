// A single term: properties, related terms, section rail and the rendered study page.
import { store, updatePageMeta, updatePageBody, setRelations, deletePage, saveHistory } from '../store.js';
import { h, put, icon, chip, openSheet, closeSheet, confirmSheet, toast, fmtShort } from '../ui.js';
import { splitSections, joinSections, sectionMark, sectionLabel, parseDay, dayKey, addDays, daysBetween, norm, LEVELS, INTERVALS, plural } from '../format.js';
import { mount } from '../render.js';
import { buildMatcher, annotate, closeGlossary } from '../glossary.js';
import { lvlName, entryOf } from '../srs.js';
import { colorOf } from './list.js';
import { openEditor } from './editor.js';
import { relationSheetFor } from './relations.js';

const dm = k => fmtShort.format(parseDay(k));

function relDue(due) {
  if (!due) return 'nenastaveno';
  const d = daysBetween(dayKey(new Date()), due);
  if (d === 0) return `dnes (${dm(due)})`;
  if (d < 0) return `${dm(due)}, před ${-d} ${plural(-d, 'dnem', 'dny', 'dny')}`;
  return `${dm(due)}, za ${d} ${plural(d, 'den', 'dny', 'dní')}`;
}

function options(prop) {
  const o = store.schema && store.schema.vlastnosti && store.schema.vlastnosti[prop];
  return o ? o.moznosti.map(x => x.hodnota) : [];
}

/* ---------- property editors ---------- */

function selectSheet(p, prop, label) {
  const cur = p.meta[prop] || '';
  openSheet(label, h('ul', { class: 'choices', role: 'listbox' }, options(prop).map(v =>
    h('li', null, h('button', { type: 'button', role: 'option', 'aria-selected': String(v === cur), onclick: async () => { closeSheet(); if (v !== cur) { await updatePageMeta(p.id, { [prop]: v }); toast(`${label}: ${v}`); } } },
      chip(v, colorOf(prop, v)), v === cur ? icon('check') : null)))));
}

function textSheet(p, prop, label, multiline) {
  const field = multiline
    ? h('textarea', { class: 'field', rows: '4', value: p.meta[prop] || '' })
    : h('input', { class: 'field', type: 'text', value: p.meta[prop] || '' });
  openSheet(label, [field,
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => closeSheet() }, 'Zrušit'),
      h('button', { class: 'btn btn--primary', type: 'button', onclick: async () => {
        const v = field.value.trim();
        if (prop === 'pojem' && !v) { toast('Název nesmí být prázdný.'); return; }
        if (prop === 'ikona' && v) {
          const other = [...store.pages.values()].find(x => x.id !== p.id && x.icon === v);
          if (other) toast(`Ikonu ${v} už má ${other.title}.`);
        }
        closeSheet();
        await updatePageMeta(p.id, { [prop]: v });
      } }, 'Uložit'))], { focus: '.field' });
}

function dateSheet(p) {
  const today = dayKey(new Date());
  const input = h('input', { class: 'field', type: 'date', value: p.due || today });
  const set = async v => { closeSheet(); await updatePageMeta(p.id, { opakovani: v }); toast(v ? `Opakovat ${dm(v)}` : 'Datum opakování odebráno'); };
  openSheet('Datum opakování', [
    h('p', { class: 'muted', text: 'Rychlá volba podle úrovně znalosti počítá od dneška.' }),
    h('div', { class: 'quick' }, LEVELS.map((l, i) => h('button', { class: 'btn btn--sm', type: 'button', onclick: () => set(addDays(today, INTERVALS[i])) }, `+${INTERVALS[i]} ${plural(INTERVALS[i], 'den', 'dny', 'dní')}`))),
    input,
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => set(null) }, 'Odebrat datum'),
      h('button', { class: 'btn btn--primary', type: 'button', onclick: () => set(input.value || null) }, 'Uložit'))
  ]);
}

export function relationSheet(p) {
  relationSheetFor('Souvisí s', p.rel, async ids => { await setRelations(p.id, ids); toast('Vazby uloženy.'); }, p.id);
}

function moreSheet(p, nav) {
  const t = dayKey(new Date());
  const day = store.history.dny[t];
  const inQueue = !!(day && day.fronta && day.fronta.some(e => e.id === p.id));
  openSheet(p.title, h('div', { class: 'menu' },
    h('button', { type: 'button', disabled: inQueue, onclick: async () => { closeSheet(); await saveHistory(hh => { const d = hh.dny[t] || { fronta: [] }; d.fronta = [...(d.fronta || []), entryOf(p)]; hh.dny[t] = d; }); toast('Přidáno do dnešní řady.'); } }, inQueue ? 'Už je v dnešní řadě' : 'Přidat do dnešní řady'),
    h('button', { type: 'button', onclick: () => { closeSheet(); openEditor({ title: `${p.title}: celá stránka`, text: p.body, onSave: body => updatePageBody(p.id, body) }); } }, 'Upravit celou stránku'),
    h('button', { type: 'button', onclick: () => { closeSheet(); textSheet(p, 'pojem', 'Název pojmu', false); } }, 'Přejmenovat'),
    h('button', { type: 'button', onclick: () => { closeSheet(); textSheet(p, 'ikona', 'Ikona (emoji)', false); } }, 'Změnit ikonu'),
    h('button', { type: 'button', class: 'danger', onclick: () => { closeSheet(); confirmSheet('Smazat pojem?', `Stránka „${p.title}“ zmizí z aplikace i z úložiště a odeberou se její vazby. V historii úložiště na GitHubu zůstane dohledatelná.`, 'Smazat', async () => { await deletePage(p.id); toast('Pojem smazán.'); nav.go('#/pojmy'); }, true); } }, 'Smazat pojem')));
}

/* ---------- view ---------- */

function keyOf(p) {
  const f = store.files.get(p.path);
  return (f ? f.text : '') + '|' + p.dirty + '|' + p.rel.map(r => (store.pages.get(r) || {}).title).join(',') + '|' + store.glossaryRev;
}

export function render(root, params, nav) {
  const id = params[0];
  let observer = null;
  let renderedText = null;

  function draw() {
    if (observer) { observer.disconnect(); observer = null; }
    closeGlossary();
    const p = store.pages.get(id);
    if (!p) {
      nav.setTitle('Pojem');
      put(root, h('div', { class: 'empty' }, h('h2', { text: 'Pojem nenalezen' }), h('p', { text: 'Mohl být smazán nebo přejmenován při synchronizaci.' }), h('a', { class: 'btn', href: '#/pojmy' }, 'Zpět na pojmy')));
      renderedText = null;
      return;
    }
    nav.setTitle(p.title);
    renderedText = keyOf(p);
    const { pre, sections } = splitSections(p.body);
    // glossary: underline known terms, first occurrence of each per section
    const terms = buildMatcher(store.glossary, { pages: store.pages, exclude: p.id, category: p.cat });

    const propRow = (label, value, onEdit) => h('div', { class: 'prop' },
      h('dt', { text: label }),
      h('dd', null, h('button', { type: 'button', class: 'prop__btn', onclick: onEdit }, value)));
    const rel = p.rel.map(r => store.pages.get(r)).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title, 'cs'));

    const hero = h('header', { class: 'hero' },
      h('button', { class: 'hero__icon', type: 'button', 'aria-label': 'Změnit ikonu', onclick: () => textSheet(p, 'ikona', 'Ikona (emoji)', false), text: p.icon || '＋' }),
      h('h1', { class: 'hero__title', text: p.title }),
      p.def ? h('p', { class: 'hero__def', text: p.def }) : null,
      p.dirty ? h('p', { class: 'hero__dirty', text: 'Změny čekají na odeslání do úložiště.' }) : null);

    const props = h('dl', { class: 'props' },
      propRow('Kategorie', chip(p.cat || 'Nevyplněno', colorOf('kategorie', p.cat)), () => selectSheet(p, 'kategorie', 'Kategorie')),
      propRow('Typ', chip(p.type || 'Nevyplněno', colorOf('typ', p.type)), () => selectSheet(p, 'typ', 'Typ')),
      propRow('Úroveň', [h('i', { class: `dot lv${p.lvl < 0 ? 'n' : p.lvl}` }), lvlName(p.lvl)], () => selectSheet(p, 'uroven', 'Úroveň znalosti')),
      propRow('Opakovat', relDue(p.due), () => dateSheet(p)),
      propRow('Priorita', chip(p.meta.priorita || 'Nevyplněno', colorOf('priorita', p.meta.priorita)), () => selectSheet(p, 'priorita', 'Priorita')),
      propRow('Definice', h('span', { class: 'prop__long', text: p.def || 'Nevyplněno' }), () => textSheet(p, 'definice', 'Definice', true)),
      p.created ? h('div', { class: 'prop' }, h('dt', { text: 'Vytvořeno' }), h('dd', null, h('span', { class: 'prop__static', text: dm(p.created) }))) : null);

    const relBox = h('section', { class: 'rel' },
      h('div', { class: 'rel__head' }, h('h2', { text: 'Souvisí s' }), h('button', { class: 'linkbtn', type: 'button', onclick: () => relationSheet(p) }, 'Upravit')),
      rel.length ? h('ul', { class: 'rel__list' }, rel.map(r => h('li', null, h('a', { href: `#/pojem/${r.id}` }, h('span', { 'aria-hidden': 'true', text: r.icon || '•' }), ' ', r.title))))
        : h('p', { class: 'muted', text: 'Zatím žádné vazby.' }));

    const rail = h('nav', { class: 'rail', 'aria-label': 'Sekce stránky' },
      h('ul', null, sections.map((s, i) => h('li', null, h('a', { href: `#s${i}`, 'data-i': String(i), title: sectionLabel(s.title), 'aria-label': sectionLabel(s.title), onclick: ev => { ev.preventDefault(); jump(i); } },
        h('span', { class: 'rail__mark', text: sectionMark(s.title) }), h('span', { class: 'rail__label', text: sectionLabel(s.title) }))))));

    const secEls = sections.map((s, i) => {
      const body = h('div', { class: 'prose' });
      const rest = s.text.replace(/^# .*\n?/, '');
      mount(body, rest);
      annotate(body, terms);
      return h('section', { class: 'sec', id: `s${i}`, 'data-i': String(i) },
        h('div', { class: 'sec__head' },
          h('h2', { class: 'sec__title' }, h('span', { class: 'sec__mark', text: sectionMark(s.title), 'aria-hidden': 'true' }), sectionLabel(s.title)),
          h('button', { class: 'iconbtn iconbtn--quiet', type: 'button', 'aria-label': `Upravit sekci ${sectionLabel(s.title)}`, onclick: () => editSection(p, i) }, icon('edit'))),
        body);
    });
    const preEl = pre && pre.trim() ? (() => { const d = h('div', { class: 'prose' }); mount(d, pre); annotate(d, terms); return h('section', { class: 'sec' }, d); })() : null;

    const footer = h('footer', { class: 'pagefoot' },
      h('button', { class: 'btn', type: 'button', onclick: () => openEditor({ title: 'Nová sekce', text: '# 📝 Nová sekce\n\n', onSave: txt => updatePageBody(p.id, joinSections(pre, [...sections, { title: '', text: txt }])) }) }, 'Přidat sekci'),
      h('button', { class: 'btn', type: 'button', onclick: () => moreSheet(p, nav) }, icon('more'), ' Další akce'));

    put(root, h('article', { class: 'page' }, hero, props, relBox, sections.length > 1 ? rail : null, preEl, secEls, footer));

    // highlight the section in view on the rail
    if (sections.length > 1 && 'IntersectionObserver' in window) {
      const links = [...rail.querySelectorAll('a')];
      observer = new IntersectionObserver(entries => {
        const vis = entries.filter(e => e.isIntersecting).map(e => Number(e.target.dataset.i));
        if (!vis.length) return;
        const i = Math.min(...vis);
        links.forEach(a => a.classList.toggle('on', Number(a.dataset.i) === i));
        const on = links[i];
        if (on && on.scrollIntoView) {
          const ul = rail.querySelector('ul');
          const left = on.offsetLeft - ul.clientWidth / 2 + on.clientWidth / 2;
          ul.scrollTo({ left, behavior: 'smooth' });
        }
      }, { rootMargin: '-120px 0px -60% 0px' });
      secEls.forEach(s => observer.observe(s));
    }
  }

  function jump(i) {
    const el = root.querySelector(`#s${i}`);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - (document.querySelector('.bar').offsetHeight + (root.querySelector('.rail') ? root.querySelector('.rail').offsetHeight : 0)) - 8;
    window.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function editSection(p, i) {
    const { pre, sections } = splitSections(p.body);
    openEditor({
      title: sectionLabel(sections[i].title),
      text: sections[i].text,
      onSave: txt => {
        const next = sections.slice();
        if (!txt.trim()) next.splice(i, 1); else next[i] = { title: '', text: txt };
        return updatePageBody(p.id, joinSections(pre, next));
      }
    });
  }

  draw();
  return {
    refresh() {
      const p = store.pages.get(id);
      if ((p ? keyOf(p) : null) === renderedText) return;
      const y = window.scrollY;
      draw();
      window.scrollTo(0, y);
    },
    destroy() { if (observer) observer.disconnect(); closeGlossary(); },
    keepScroll: true
  };
}
