// App shell: routing, top bar, sync indicator, service worker updates.
import { store, load, onChange, setSyncHook, pendingFiles } from './store.js';
import { sync, onStatus, status } from './sync.js';
import { persistStorage } from './db.js';
import { $, h, put, icon, toast, closeAllSheets, fmtTime } from './ui.js';
import { plural } from './format.js';
import { rerenderDiagrams } from './render.js';
import * as today from './views/today.js';
import * as list from './views/list.js';
import * as page from './views/page.js';
import * as stats from './views/stats.js';
import * as settings from './views/settings.js';
import * as create from './views/create.js';

export const APP_VERSION = '1.1.2';

const routes = [
  { re: /^#?\/?$/, view: today, tab: 'dnes' },
  { re: /^#\/dnes$/, view: today, tab: 'dnes' },
  { re: /^#\/pojmy$/, view: list, tab: 'pojmy' },
  { re: /^#\/pojem\/([0-9a-f]{32})$/, view: page, tab: 'pojmy', back: true },
  { re: /^#\/novy$/, view: create, tab: 'pojmy', back: true },
  { re: /^#\/prehled$/, view: stats, tab: 'prehled' },
  { re: /^#\/nastaveni$/, view: settings, tab: null, back: true }
];

let current = null;   // { route, params, ctx }
const scrollMemo = new Map();

function match(hash) {
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) return { route: r, params: m.slice(1) };
  }
  return { route: routes[0], params: [] };
}

export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
const navStack = [];
export function back(fallback) {
  if (navStack.length > 1) history.back();
  else location.replace(fallback || (current && current.route.tab ? '#/' + current.route.tab : '#/dnes'));
}

function route() {
  closeAllSheets();
  if (current) {
    scrollMemo.set(current.key, window.scrollY);
    if (current.ctx && current.ctx.destroy) current.ctx.destroy();
  }
  const hash = location.hash || '#/dnes';
  if (navStack.length > 1 && navStack[navStack.length - 2] === hash) navStack.pop();
  else if (navStack[navStack.length - 1] !== hash) navStack.push(hash);
  // first run: no connection and no data → settings
  if (store.ready && !store.conn && !store.pages.size && !/^#\/nastaveni$/.test(hash)) { location.replace('#/nastaveni'); return; }
  const { route: r, params } = match(hash);
  const container = $('#view');
  container.replaceChildren();
  container.className = 'view view--' + (r.tab || 'other');
  const ctx = r.view.render(container, params, nav) || {};
  current = { key: hash, route: r, params, ctx };
  document.querySelectorAll('.tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === r.tab ? 'page' : 'false'));
  $('#barBack').hidden = !r.back;
  const y = scrollMemo.get(hash);
  window.scrollTo(0, ctx.keepScroll === false ? 0 : (y || 0));
}

function setTitle(text) { $('#barTitle').textContent = text; }
const nav = { go, back: (f) => back(f), setTitle, applyTheme: (t) => applyTheme(t), runSync: (m) => runSync(m) };

function refreshView() {
  if (!current) return;
  if (current.ctx && current.ctx.refresh) { current.ctx.refresh(); return; }
  const y = window.scrollY;
  const container = $('#view');
  if (current.ctx && current.ctx.destroy) current.ctx.destroy();
  container.replaceChildren();
  current.ctx = current.route.view.render(container, current.params, nav) || {};
  window.scrollTo(0, y);
}

/* ---------- sync indicator ---------- */
function renderSync() {
  const btn = $('#syncBtn');
  const pend = pendingFiles().length;
  let state, text;
  if (!store.conn) { state = 'off'; text = 'Nepřipojeno'; }
  else if (status.running) { state = 'busy'; text = status.total ? `${status.phase} ${status.done}/${status.total}` : status.phase || 'Synchronizuji'; }
  else if (status.error && status.error.code === 'offline') { state = 'offline'; text = pend ? `Offline, čeká ${pend}` : 'Offline'; }
  else if (status.error) { state = 'error'; text = 'Chyba synchronizace'; }
  else if (pend) { state = 'pending'; text = `Čeká ${pend} ${plural(pend, 'změna', 'změny', 'změn')}`; }
  else {
    state = 'ok';
    const t = store.lastSync ? new Date(store.lastSync) : null;
    const sameDay = t && t.toDateString() === new Date().toDateString();
    text = !t ? 'Synchronizováno' : sameDay ? `Aktuální ${t.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}` : `Aktuální k ${fmtTime.format(t)}`;
  }
  btn.dataset.state = state;
  btn.setAttribute('aria-label', text);
  btn.title = text;
  put($('#syncText'), text);
}

async function runSync(manual) {
  if (!store.conn) { if (manual) location.hash = '#/nastaveni'; return; }
  try {
    const r = await sync();
    if (manual) toast(r.pulled || r.pushed ? `Hotovo: staženo ${r.pulled}, odesláno ${r.pushed}.` : 'Vše je aktuální.');
    if (r.conflicts) toast(`${r.conflicts} ${plural(r.conflicts, 'změna se nedala', 'změny se nedaly', 'změn se nedalo')} sloučit. Druhá verze je v Nastavení, v části Konflikty.`);
  } catch (e) {
    if (manual || e.code !== 'offline') toast(e.message);
  }
}

/* ---------- theme ---------- */
export function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#14181d' : '#f4f6f8');
  rerenderDiagrams(document);
}

/* ---------- service worker ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const show = w => {
      const bar = $('#update');
      bar.hidden = false;
      bar.querySelector('button').onclick = () => { w.postMessage('skipWaiting'); };
    };
    if (reg.waiting && navigator.serviceWorker.controller) show(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) show(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
}

/* ---------- start ---------- */
async function start() {
  let theme = 'system';
  try { theme = localStorage.getItem('theme') || 'system'; } catch (e) { /* storage blocked */ }
  applyTheme(theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme((() => { try { return localStorage.getItem('theme'); } catch (e) { return null; } })() || 'system'));

  $('#barBack').append(icon('back'));
  $('#barBack').addEventListener('click', () => back());
  $('#gearBtn').append(icon('gear'));
  $('#syncBtn').addEventListener('click', () => runSync(true));
  window.addEventListener('hashchange', route);

  try { await load(); }
  catch (e) {
    put($('#view'), h('div', { class: 'empty' }, h('h2', { text: 'Místní data nejdou otevřít' }), h('p', { text: e.message || String(e) })));
    return;
  }
  setSyncHook(() => runSync(false));
  onChange(() => { renderSync(); refreshView(); });
  onStatus(() => renderSync());
  renderSync();
  route();
  persistStorage();
  registerSW();

  if (store.conn) setTimeout(() => runSync(false), 400);
  window.addEventListener('online', () => runSync(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !store.conn) return;
    const last = store.lastSync ? Date.parse(store.lastSync) : 0;
    if (Date.now() - last > 2 * 60 * 1000) runSync(false);
    if (current && current.route.view === today) refreshView();
  });
}

start();
