// "Nový pojem": a new page from the template.
import { store, createPage } from '../store.js';
import { h, put, toast } from '../ui.js';
import { norm } from '../format.js';
import { relationSheetFor } from './relations.js';

function options(prop) {
  const o = store.schema && store.schema.vlastnosti && store.schema.vlastnosti[prop];
  return o ? o.moznosti.map(x => x.hodnota) : [];
}

export function render(root, params, nav) {
  nav.setTitle('Nový pojem');
  const defaults = (store.schema && store.schema.novy_pojem) || {};
  const rel = new Set();
  const f = {
    pojem: h('input', { class: 'field', type: 'text', required: true, placeholder: 'např. Kafka Connect', autocapitalize: 'sentences' }),
    ikona: h('input', { class: 'field field--emoji', type: 'text', placeholder: '🔌', maxlength: '8', 'aria-describedby': 'iconHint' }),
    kategorie: h('select', { class: 'field' }, h('option', { value: '', text: 'Vyberte kategorii' }), options('kategorie').map(v => h('option', { value: v, text: v }))),
    typ: h('select', { class: 'field' }, h('option', { value: '', text: 'Vyberte typ' }), options('typ').map(v => h('option', { value: v, text: v }))),
    priorita: h('select', { class: 'field' }, options('priorita').map(v => h('option', { value: v, text: v, selected: v === (defaults.priorita || '🟡 Střední') }))),
    definice: h('textarea', { class: 'field', rows: '3', placeholder: 'Jedna věta, stejná jako „Jednou větou“ na stránce.' })
  };
  const dup = h('p', { class: 'warn', hidden: true });
  const iconHint = h('p', { class: 'muted small', id: 'iconHint', text: 'Jedno emoji, které v databázi ještě nemá jiný pojem.' });
  const relList = h('p', { class: 'muted', text: 'Zatím žádné vazby.' });

  f.pojem.addEventListener('input', () => {
    const q = norm(f.pojem.value.trim());
    const hit = q.length > 1 && [...store.pages.values()].find(p => norm(p.title) === q || norm(p.title).split(' (')[0] === q.split(' (')[0]);
    dup.hidden = !hit;
    if (hit) put(dup, 'Podobný pojem už existuje: ', h('a', { href: `#/pojem/${hit.id}`, text: hit.title }), '. Raději doplňte stávající stránku.');
  });
  f.ikona.addEventListener('input', () => {
    const v = f.ikona.value.trim();
    const other = v && [...store.pages.values()].find(p => p.icon === v);
    iconHint.textContent = other ? `Ikonu ${v} už má ${other.title}. Zkuste jinou.` : 'Jedno emoji, které v databázi ještě nemá jiný pojem.';
    iconHint.classList.toggle('warn', !!other);
  });
  const drawRel = () => put(relList, rel.size ? [...rel].map(id => store.pages.get(id)).filter(Boolean).map(p => `${p.icon || '•'} ${p.title}`).join(', ') : 'Zatím žádné vazby.');

  const label = (text, el, extra) => h('label', { class: 'form__row' }, h('span', { class: 'form__label', text }), el, extra || null);
  const form = h('form', { class: 'form', novalidate: true, onsubmit: async ev => {
    ev.preventDefault();
    const pojem = f.pojem.value.trim();
    if (!pojem) { toast('Vyplňte název pojmu.'); f.pojem.focus(); return; }
    if (!f.kategorie.value) { toast('Vyberte kategorii.'); f.kategorie.focus(); return; }
    const id = await createPage({
      pojem, ikona: f.ikona.value.trim(), kategorie: f.kategorie.value, typ: f.typ.value,
      priorita: f.priorita.value, definice: f.definice.value.trim(), souvisi: [...rel]
    });
    toast('Pojem vytvořen ze šablony.');
    location.replace(`#/pojem/${id}`);
  } },
    h('p', { class: 'muted', text: 'Stránka vznikne ze šablony „📖 IT pojem“. Úroveň bude Nové a první opakování zítra.' }),
    label('Název', f.pojem, dup),
    label('Ikona', f.ikona, iconHint),
    label('Kategorie', f.kategorie),
    label('Typ', f.typ),
    label('Priorita', f.priorita),
    label('Definice', f.definice),
    h('div', { class: 'form__row' }, h('span', { class: 'form__label', text: 'Souvisí s' }), relList,
      h('button', { class: 'btn btn--sm', type: 'button', onclick: () => relationSheetFor('Souvisí s', rel, ids => { rel.clear(); ids.forEach(i => rel.add(i)); drawRel(); }) }, 'Vybrat pojmy')),
    h('div', { class: 'row-actions' },
      h('a', { class: 'btn', href: '#/pojmy' }, 'Zrušit'),
      h('button', { class: 'btn btn--primary', type: 'submit' }, 'Vytvořit pojem')));
  root.append(h('div', { class: 'narrow' }, form));
  setTimeout(() => f.pojem.focus(), 50);
  return { refresh() {} };
}
