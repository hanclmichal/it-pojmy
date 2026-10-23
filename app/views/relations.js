// Multi-select picker of terms, used for the "Souvisí s" relation.
import { store } from '../store.js';
import { h, put, icon, openSheet, closeSheet } from '../ui.js';
import { norm } from '../format.js';

export function relationSheetFor(title, selected, onSave, excludeId) {
  const chosen = new Set(selected);
  const input = h('input', { class: 'field', type: 'search', placeholder: 'Hledat pojem', 'aria-label': 'Hledat pojem' });
  const list = h('ul', { class: 'choices choices--multi' });
  const all = [...store.pages.values()].filter(x => x.id !== excludeId).sort((a, b) => a.title.localeCompare(b.title, 'cs'));
  const initial = new Set(selected);
  function draw() {
    const q = norm(input.value.trim());
    const shown = all.filter(x => !q || norm(x.title).includes(q) || norm(x.cat).includes(q))
      .sort((a, b) => (initial.has(b.id) ? 1 : 0) - (initial.has(a.id) ? 1 : 0));
    put(list, shown.map(x => h('li', null, h('button', { type: 'button', role: 'checkbox', 'aria-checked': String(chosen.has(x.id)), onclick: () => { chosen.has(x.id) ? chosen.delete(x.id) : chosen.add(x.id); draw(); } },
      h('span', { class: 'check' }, chosen.has(x.id) ? icon('check') : null),
      h('span', { class: 'pick__icon', text: x.icon || '•' }),
      h('span', { class: 'pick__t' }, h('b', { text: x.title }), h('small', { text: x.cat }))))));
  }
  input.addEventListener('input', draw);
  draw();
  openSheet(title, [
    h('p', { class: 'muted', text: 'Vazba je obousměrná: pojem se přidá nebo odebere i na druhé stránce.' }),
    input, list
  ], { action: h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => { closeSheet(); onSave([...chosen]); } }, 'Uložit') });
}
