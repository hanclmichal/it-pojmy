// Markdown → safe HTML, code highlighting and lazily loaded Mermaid diagrams.
/* global marked, DOMPurify, hljs */

export const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.min.js';

const LANG_ALIAS = { txt: null, text: null, plaintext: null, http: 'http', sh: 'bash', shell: 'bash', yml: 'yaml', js: 'javascript', jsx: 'javascript', docker: 'dockerfile', py: 'python', ps: 'powershell', proto: 'protobuf', html: 'xml' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let configured = false;
function configure() {
  if (configured) return;
  configured = true;
  const renderer = new marked.Renderer();
  renderer.code = (code, infostring) => {
    const lang = String(infostring || '').trim().split(/\s+/)[0].toLowerCase();
    if (lang === 'mermaid') {
      return `<figure class="diagram" data-diagram="${escapeHtml(encodeURIComponent(code))}"><pre class="diagram__src"><code>${escapeHtml(code)}</code></pre></figure>`;
    }
    const target = lang in LANG_ALIAS ? LANG_ALIAS[lang] : lang;
    let html = escapeHtml(code);
    if (target && typeof hljs !== 'undefined' && hljs.getLanguage(target)) {
      try { html = hljs.highlight(code, { language: target, ignoreIllegals: true }).value; } catch (e) { /* keep plain */ }
    }
    const label = lang && lang !== 'txt' && lang !== 'text' ? `<span class="code__lang">${escapeHtml(lang)}</span>` : '';
    return `<div class="code">${label}<pre><code class="hljs">${html}</code></pre></div>`;
  };
  renderer.link = (href, title, text) => {
    const h = String(href || '');
    if (h.startsWith('kb:')) {
      const id = h.slice(3).replace(/[^0-9a-f]/gi, '');
      return `<a class="kb" href="#/pojem/${id}">${text}</a>`;
    }
    const safe = /^(https?:|mailto:)/i.test(h) ? h : '#';
    return `<a href="${escapeHtml(safe)}" class="ext" target="_blank" rel="noopener noreferrer"${title ? ` title="${escapeHtml(title)}"` : ''}>${text}</a>`;
  };
  renderer.table = (header, body) => `<div class="table"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
  renderer.heading = (text, level) => `<h${level}>${text}</h${level}>`;
  marked.setOptions({ gfm: true, breaks: false, mangle: false, headerIds: false, renderer });
}

export function renderMarkdown(md) {
  configure();
  const raw = marked.parse(String(md || ''));
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['details', 'summary', 'figure'],
    ADD_ATTR: ['target', 'rel', 'data-diagram'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#)/i
  });
}

/** Render Markdown into an element and upgrade its diagrams. */
export function mount(el, md) {
  el.innerHTML = renderMarkdown(md);
  hydrateDiagrams(el);
}

/* ---------- Mermaid ---------- */

let mermaidPromise = null;
let mermaidTheme = null;
let seq = 0;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('load failed')); };
    document.head.appendChild(s);
  });
}

function isDark() {
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced) return forced === 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function loadMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (!mermaidPromise) {
    mermaidPromise = loadScript(MERMAID_URL)
      .then(() => { if (!window.mermaid) throw new Error('mermaid missing'); return window.mermaid; })
      .catch(e => { mermaidPromise = null; throw e; });
  }
  return mermaidPromise;
}

function ensureTheme(m) {
  const theme = isDark() ? 'dark' : 'neutral';
  if (mermaidTheme === theme) return;
  mermaidTheme = theme;
  m.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    flowchart: { htmlLabels: true, useMaxWidth: true },
    sequence: { useMaxWidth: true }
  });
}

export function hydrateDiagrams(root) {
  const figs = [...root.querySelectorAll('figure.diagram:not([data-done])')];
  if (!figs.length) return;
  loadMermaid().then(async m => {
    ensureTheme(m);
    for (const fig of figs) {
      if (!fig.isConnected) continue;
      const code = decodeURIComponent(fig.getAttribute('data-diagram') || '');
      try {
        const { svg } = await m.render(`mmd-${++seq}`, code);
        const box = document.createElement('div');
        box.className = 'diagram__svg';
        // securityLevel "strict" makes Mermaid sanitise labels itself; the diagram source is the user's own page
        box.innerHTML = svg;
        fig.querySelector('.diagram__src').hidden = true;
        fig.prepend(box);
        fig.setAttribute('data-done', 'ok');
      } catch (e) {
        fig.setAttribute('data-done', 'error');
        const note = document.createElement('figcaption');
        note.textContent = 'Diagram se nepodařilo vykreslit, níže je jeho zdroj.';
        fig.prepend(note);
        document.querySelectorAll(`#dmmd-${seq}`).forEach(n => n.remove());
      }
    }
  }).catch(() => {
    for (const fig of figs) {
      if (fig.hasAttribute('data-done')) continue;
      fig.setAttribute('data-done', 'offline');
      const note = document.createElement('figcaption');
      note.textContent = 'Diagram se vykreslí, až aplikaci jednou otevřete s internetem. Zatím vidíte jeho zdroj.';
      fig.prepend(note);
    }
  });
}

/** Re-render diagrams when the colour scheme changes. */
export function rerenderDiagrams(root) {
  mermaidTheme = null;
  root.querySelectorAll('figure.diagram[data-done]').forEach(fig => {
    fig.removeAttribute('data-done');
    fig.querySelectorAll('.diagram__svg, figcaption').forEach(n => n.remove());
    const src = fig.querySelector('.diagram__src');
    if (src) src.hidden = false;
  });
  hydrateDiagrams(root);
}
