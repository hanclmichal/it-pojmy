// Small DOM helpers shared by the views.

export const $ = (sel, root = document) => root.querySelector(sel);

/** h('div', { class: 'x', onclick }, child, [children], 'text') */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export function put(el, ...kids) { el.replaceChildren(); append(el, kids); }

/* ---------- toast ---------- */
let toastTimer = null;
export function toast(msg) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ---------- bottom sheet ---------- */
let sheetStack = [];
export function openSheet(title, content, opts = {}) {
  const panel = h('div', { class: 'sheet__panel' + (opts.full ? ' sheet__panel--full' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('div', { class: 'sheet__head' },
      h('h2', { text: title }),
      opts.action || null,
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Zavřít', onclick: () => requestClose() }, icon('close'))),
    h('div', { class: 'sheet__body' }, content));
  const back = h('div', { class: 'sheet__back', onclick: () => { if (!opts.modal) requestClose(); } });
  const sheet = h('div', { class: 'sheet' }, back, panel);
  document.body.append(sheet);
  document.body.classList.add('lock');
  sheetStack.push({ sheet, onClose: opts.onClose, beforeClose: opts.beforeClose, prevFocus: document.activeElement });
  requestAnimationFrame(() => { sheet.classList.add('in'); (opts.focus ? panel.querySelector(opts.focus) : panel)?.focus({ preventScroll: true }); });
  return { close: closeSheet, panel };
}
/** Close the top sheet unless its beforeClose hook vetoes it (e.g. unsaved text). */
export function requestClose() {
  const top = sheetStack[sheetStack.length - 1];
  if (top && top.beforeClose && top.beforeClose() === false) return;
  closeSheet();
}
export function closeSheet() {
  const top = sheetStack.pop();
  if (!top) return;
  top.sheet.remove();
  if (!sheetStack.length) document.body.classList.remove('lock');
  if (top.onClose) top.onClose();
  if (top.prevFocus && top.prevFocus.focus) top.prevFocus.focus({ preventScroll: true });
}
export function closeAllSheets() { while (sheetStack.length) closeSheet(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetStack.length) requestClose(); });

export function confirmSheet(title, text, okLabel, onOk, danger = false) {
  openSheet(title, [
    h('p', { class: 'muted', text }),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => closeSheet() }, 'Zrušit'),
      h('button', { class: 'btn ' + (danger ? 'btn--danger' : 'btn--primary'), type: 'button', onclick: () => { closeSheet(); onOk(); } }, okLabel))
  ]);
}

/* ---------- icons (stroke icons drawn inline) ---------- */
const PATHS = {
  today: 'M4 6h16M4 6v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6M8 3v4M16 3v4M8.5 14l2.5 2.5 5-5',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  sync: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  cloudoff: 'M3 3l18 18M8 18H7a5 5 0 0 1-1.3-9.8M10.5 5.2A6 6 0 0 1 17.6 10H18a4 4 0 0 1 2.3 7.3'
};
export function icon(name, cls = 'ico') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', PATHS[name] || '');
  svg.append(p);
  return svg;
}

/* ---------- formatting ---------- */
export const fmtShort = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' });
export const fmtLong = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtNarrow = new Intl.DateTimeFormat('cs-CZ', { weekday: 'short' });
export const fmtTime = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ---------- Notion select colours ---------- */
export function chip(value, colorName, extra = '') {
  return h('span', { class: `chip chip--${colorName || 'default'} ${extra}`.trim(), text: value });
}
