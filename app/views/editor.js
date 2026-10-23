// Markdown editor for one section or a whole page: toolbar, preview, links to other terms.
import { store } from '../store.js';
import { h, put, openSheet, closeSheet, confirmSheet, toast } from '../ui.js';
import { norm } from '../format.js';
import { mount } from '../render.js';

function surround(ta, before, after, placeholder) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const sel = v.slice(s, e) || placeholder;
  ta.setRangeText(before + sel + after, s, e, 'end');
  if (!v.slice(s, e)) { ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length; }
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

function insertBlock(ta, text, selectFrom, selectLen) {
  const { selectionStart: s, value: v } = ta;
  const lineStart = v.lastIndexOf('\n', s - 1) + 1;
  const atLineStart = s === lineStart && (s === 0 || v[s - 1] === '\n');
  const lead = atLineStart ? (s > 1 && v[s - 2] !== '\n' && s > 0 ? '\n' : '') : '\n\n';
  const insert = lead + text + '\n';
  ta.setRangeText(insert, s, ta.selectionEnd, 'end');
  if (selectFrom != null) { ta.selectionStart = s + lead.length + selectFrom; ta.selectionEnd = ta.selectionStart + selectLen; }
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

function prefixLines(ta, prefix) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const a = v.lastIndexOf('\n', s - 1) + 1;
  let b = v.indexOf('\n', e); if (b < 0) b = v.length;
  const lines = v.slice(a, b).split('\n');
  const out = lines.map((l, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + l).join('\n');
  ta.setRangeText(out, a, b, 'end');
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

function termPicker(onPick) {
  const input = h('input', { class: 'field', type: 'search', placeholder: 'Hledat pojem', 'aria-label': 'Hledat pojem' });
  const list = h('ul', { class: 'choices' });
  const all = [...store.pages.values()].sort((a, b) => a.title.localeCompare(b.title, 'cs'));
  function draw() {
    const q = norm(input.value.trim());
    put(list, all.filter(p => !q || norm(p.title).includes(q)).slice(0, 40).map(p => h('li', null, h('button', { type: 'button', onclick: () => { closeSheet(); onPick(p); } },
      h('span', { class: 'pick__icon', text: p.icon || '•' }), h('span', { class: 'pick__t' }, h('b', { text: p.title }), h('small', { text: p.cat }))))));
  }
  input.addEventListener('input', draw);
  draw();
  openSheet('Odkaz na pojem', [input, list], { focus: '.field' });
}

/** openEditor({ title, text, onSave(text) → Promise }) */
export function openEditor({ title, text, onSave }) {
  const original = text;
  const ta = h('textarea', { class: 'editor__ta', spellcheck: 'true', autocapitalize: 'sentences', 'aria-label': 'Text v Markdownu' });
  ta.value = text;
  const preview = h('div', { class: 'editor__preview prose', hidden: true });
  let previewOn = false;
  const tool = (label, title, fn) => h('button', { type: 'button', class: 'tool', title, 'aria-label': title, onmousedown: e => e.preventDefault(), onclick: fn }, label);
  const previewBtn = tool('Náhled', 'Přepnout náhled', () => {
    previewOn = !previewOn;
    previewBtn.setAttribute('aria-pressed', String(previewOn));
    previewBtn.textContent = previewOn ? 'Upravit' : 'Náhled';
    if (previewOn) mount(preview, ta.value.replace(/^# .*\n?/, ''));
    preview.hidden = !previewOn;
    ta.hidden = previewOn;
  });
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formátování' },
    tool(h('b', { text: 'B' }), 'Tučně', () => surround(ta, '**', '**', 'text')),
    tool(h('i', { text: 'I' }), 'Kurzíva', () => surround(ta, '*', '*', 'text')),
    tool(h('code', { text: '</>' }), 'Kód v textu', () => surround(ta, '`', '`', 'kód')),
    tool('•', 'Odrážka', () => prefixLines(ta, '- ')),
    tool('1.', 'Číslovaný seznam', () => prefixLines(ta, i => `${i + 1}. `)),
    tool('❝', 'Citace', () => prefixLines(ta, '> ')),
    tool('🔗', 'Odkaz na pojem', () => {
      const s = ta.selectionStart, e = ta.selectionEnd;
      termPicker(p => { ta.selectionStart = s; ta.selectionEnd = e; surround(ta, '[', `](kb:${p.id})`, p.title); });
    }),
    tool('{ }', 'Blok kódu', () => insertBlock(ta, '```txt\n\n```', 7, 0)),
    tool('◇', 'Diagram', () => insertBlock(ta, '```mermaid\nflowchart LR\n    A["Krok 1"] --> B["Krok 2"]\n```', 11, 12)),
    tool('?', 'Otázka s odpovědí', () => insertBlock(ta, '<details>\n<summary>Otázka</summary>\n\nOdpověď\n\n</details>', 19, 6)),
    tool('―', 'Oddělovač', () => insertBlock(ta, '---')),
    previewBtn);

  let saving = false;
  const save = h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: async () => {
    if (saving) return;
    saving = true;
    try { await onSave(ta.value.replace(/\s+$/, '') + '\n'); closeSheet(); toast('Uloženo.'); }
    catch (e) { toast(e.message || 'Uložení se nepovedlo.'); }
    finally { saving = false; }
  } }, 'Uložit');

  openSheet(title, h('div', { class: 'editor' }, toolbar, ta, preview,
    h('p', { class: 'editor__hint muted', text: 'Markdown: # nadpis sekce, **tučně**, - odrážka, ``` blok kódu. Sekci smažete vymazáním celého textu.' })),
  {
    full: true, modal: true, action: save, focus: '.editor__ta',
    // closing with unsaved changes asks first
    beforeClose: () => {
      if (ta.value === original || saving) return true;
      confirmSheet('Zahodit změny?', 'Upravený text se neuloží.', 'Zahodit', () => closeSheet(), true);
      return false;
    }
  });
}
