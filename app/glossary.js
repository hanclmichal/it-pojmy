// Glossary: headwords from slovnik.json are underlined in the text of a page and a tap
// shows a short explanation in a small popover next to the word (no new screen).
//
// Matching rules (also described in CLAUDE.md of the data repository):
// - a form matches as a whole word; case matters, but a word of the form starting with a
//   lower-case letter also matches with a capital first letter (start of a sentence, Title Case),
// - a form ending in a letter may be followed by a common Czech case ending or English "s",
// - spaces in a form match any whitespace, the longest form wins,
// - only the first occurrence of each headword in a section is underlined,
// - nothing is underlined in headings, code, links, diagrams and quiz questions,
// - a headword with `id` is not underlined on its own page, `kategorie` limits it to pages
//   of those categories.

const ENDINGS = '(?:ům|ech|ích|ami|ovi|em|ím|ou|ů|u|y|e|i|a|s)?';
const WORD = '[\\p{L}\\p{N}_]';
const SKIP = 'a, code, pre, summary, h1, h2, h3, h4, h5, h6, figure, button, .gl';

/** Parse slovnik.json; malformed entries are skipped, a broken file gives an empty glossary. */
export function parseGlossary(text) {
  let data;
  try { data = JSON.parse(text || ''); } catch (e) { return []; }
  const list = data && Array.isArray(data.hesla) ? data.hesla : [];
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const out = [];
  list.forEach(e => {
    if (!e || !Array.isArray(e.tvary)) return;
    const tvary = e.tvary.map(str).filter(Boolean);
    if (!tvary.length) return;
    out.push({
      pojem: str(e.pojem),
      vysvetleni: str(e.vysvetleni),
      id: str(e.id) || null,
      viz: str(e.viz) || null,
      tvary,
      kategorie: Array.isArray(e.kategorie) ? e.kategorie.map(str).filter(Boolean) : []
    });
  });
  return out;
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex source for one form (also used by the quiz to hide a term's name in its definition). */
export function formPattern(form) {
  const parts = form.split(/\s+/).map(w => {
    const c = w[0];
    // a word written with a lower-case initial also matches Title Case ("refresh token" → "Refresh Token")
    return c !== c.toUpperCase() && c === c.toLowerCase() ? `[${c}${c.toUpperCase()}]` + esc(w.slice(1)) : esc(w);
  });
  return parts.join('\\s+') + (/\p{L}$/u.test(form) ? ENDINGS : '');
}

/**
 * Compile the glossary for one page.
 * pages: Map id -> page ({ title, icon, def }); exclude: id of the page being shown;
 * category: its category. Returns null when nothing applies.
 */
export function buildMatcher(entries, { pages, exclude = null, category = '' } = {}) {
  const forms = [];
  for (const e of entries || []) {
    if (e.kategorie.length && !e.kategorie.includes(category)) continue;
    let info;
    if (e.id) {
      if (e.id === exclude) continue;
      const page = pages && pages.get(e.id);
      const text = e.vysvetleni || (page && page.def) || '';
      if (!text) continue;
      info = { title: page ? page.title : (e.pojem || e.tvary[0]), icon: page ? page.icon : '', text, link: page ? { id: e.id, own: true, title: page.title, icon: page.icon } : null };
    } else {
      if (!e.vysvetleni) continue;
      const viz = e.viz && e.viz !== exclude && pages ? pages.get(e.viz) : null;
      info = { title: e.pojem || e.tvary[0], icon: '', text: e.vysvetleni, link: viz ? { id: e.viz, own: false, title: viz.title, icon: viz.icon } : null };
    }
    for (const f of e.tvary) forms.push({ form: f, info });
  }
  if (!forms.length) return null;
  forms.sort((a, b) => b.form.length - a.form.length);
  let re;
  try {
    re = new RegExp(`(^|[^\\p{L}\\p{N}_])(?:${forms.map(x => `(${formPattern(x.form)})`).join('|')})(?!${WORD}|\\.${WORD})`, 'gu');
  } catch (e) {
    console.error('Slovníček nejde zkompilovat', e);
    return null;
  }
  return { re, forms };
}

/** Find headword occurrences in a string: [{ start, end, info }], first occurrence per headword. */
export function findTerms(text, matcher, seen = new Set()) {
  const out = [];
  if (!matcher) return out;
  const { re, forms } = matcher;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    let g = 2;
    while (g < m.length && m[g] === undefined) g++;
    const info = forms[g - 2].info;
    if (seen.has(info)) continue;
    seen.add(info);
    out.push({ start: m.index + m[1].length, end: m.index + m[0].length, info });
  }
  return out;
}

const infoOf = new WeakMap();

/** Underline headwords inside a rendered element (one section of a page). */
export function annotate(root, matcher, seen = new Set()) {
  if (!matcher || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!/\S/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
      const skip = n.parentElement && n.parentElement.closest(SKIP);
      return skip && root.contains(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const hits = findTerms(text, matcher, seen);
    if (!hits.length) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const hit of hits) {
      frag.append(text.slice(last, hit.start));
      const span = document.createElement('span');
      span.className = 'gl';
      span.tabIndex = 0;
      span.setAttribute('role', 'button');
      span.setAttribute('aria-haspopup', 'dialog');
      span.setAttribute('aria-expanded', 'false');
      span.textContent = text.slice(hit.start, hit.end);
      infoOf.set(span, hit.info);
      frag.append(span);
      last = hit.end;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

/* ---------- popover ---------- */

let open = null; // { span, pop }

export function closeGlossary() {
  if (!open) return;
  open.pop.remove();
  open.span.classList.remove('on');
  open.span.setAttribute('aria-expanded', 'false');
  open = null;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function show(span) {
  const info = infoOf.get(span);
  if (!info) return;
  if (open && open.span === span) { closeGlossary(); return; }
  closeGlossary();

  const pop = el('div', 'glpop');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', info.title);
  const arrow = el('span', 'glpop__arrow');
  arrow.setAttribute('aria-hidden', 'true');
  const title = el('p', 'glpop__title');
  if (info.icon) title.append(el('span', 'glpop__icon', info.icon));
  title.append(el('span', null, info.title));
  pop.append(arrow, title, el('p', 'glpop__text', info.text));
  if (info.link) {
    const a = el('a', 'glpop__link');
    a.href = `#/pojem/${info.link.id}`;
    a.append(el('span', null, info.link.own ? 'Otevřít stránku pojmu' : `Více: ${info.link.icon ? info.link.icon + ' ' : ''}${info.link.title}`), el('span', 'glpop__chev', '›'));
    pop.append(a);
  }
  document.body.append(pop);
  place(pop, arrow, span);
  span.classList.add('on');
  span.setAttribute('aria-expanded', 'true');
  open = { span, pop };
}

function place(pop, arrow, span) {
  const rects = [...span.getClientRects()].filter(r => r.width);
  const r = rects[0] || span.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const bar = document.querySelector('.bar');
  const rail = document.querySelector('.rail');
  const tabs = document.querySelector('.tabs');
  const topEdge = (bar ? bar.getBoundingClientRect().bottom : 0) + (rail ? rail.offsetHeight : 0) + 8;
  const bottomEdge = (tabs ? tabs.getBoundingClientRect().top : window.innerHeight) - 8;
  const w = pop.offsetWidth, ht = pop.offsetHeight, gap = 10;
  const spaceBelow = bottomEdge - r.bottom, spaceAbove = r.top - topEdge;
  const up = spaceBelow < ht + gap && spaceAbove > spaceBelow;
  const center = r.left + r.width / 2;
  const left = Math.round(Math.min(Math.max(12, center - w / 2), vw - w - 12));
  const top = Math.round(up ? r.top - ht - gap : r.bottom + gap);
  pop.dataset.side = up ? 'top' : 'bottom';
  pop.style.left = `${left + window.scrollX}px`;
  pop.style.top = `${top + window.scrollY}px`;
  arrow.style.left = `${Math.round(Math.min(Math.max(16, center - left), w - 16))}px`;
  // neither side has room: scroll just enough to show the whole bubble
  const overflow = up ? top - topEdge : top + ht - bottomEdge;
  if ((up && overflow < 0) || (!up && overflow > 0)) {
    window.scrollBy({ top: overflow, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

let wired = false;
/** Install the document-level listeners once. */
export function initGlossary() {
  if (wired) return;
  wired = true;
  document.addEventListener('click', ev => {
    const span = ev.target instanceof Element ? ev.target.closest('.gl') : null;
    if (span) { ev.preventDefault(); show(span); }
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && open) { const s = open.span; closeGlossary(); s.focus({ preventScroll: true }); return; }
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target instanceof Element && ev.target.classList.contains('gl')) { ev.preventDefault(); show(ev.target); }
  });
  // close on a tap outside; a drag (scrolling) keeps the bubble, which scrolls with the text.
  // pointer events are used because iOS does not send clicks for taps on plain text.
  let down = null;
  document.addEventListener('pointerdown', ev => { down = { x: ev.clientX, y: ev.clientY, t: ev.target }; }, true);
  document.addEventListener('pointerup', ev => {
    const d = down;
    down = null;
    if (!open || !d) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 10) return;
    const t = d.t instanceof Element ? d.t : d.t && d.t.parentElement;
    if (t && (open.pop.contains(t) || t.closest('.gl'))) return;
    closeGlossary();
  }, true);
  // rotation or a new width moves the text; height changes (Safari toolbars) do not
  let width = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth !== width) { width = window.innerWidth; closeGlossary(); } });
}
