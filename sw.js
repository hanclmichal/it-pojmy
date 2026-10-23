// Service worker: keeps the whole app available offline.
// App files are precached per version; the Mermaid library from the CDN is cached on first use.
const VERSION = 'v1.1.1';
const APP_CACHE = `app-${VERSION}`;
const LIB_CACHE = 'libs-v1';
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.min.js';

const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'app/main.js',
  'app/db.js',
  'app/store.js',
  'app/sync.js',
  'app/merge.js',
  'app/format.js',
  'app/render.js',
  'app/srs.js',
  'app/ui.js',
  'app/views/today.js',
  'app/views/list.js',
  'app/views/page.js',
  'app/views/editor.js',
  'app/views/relations.js',
  'app/views/create.js',
  'app/views/stats.js',
  'app/views/settings.js',
  'vendor/marked.min.js',
  'vendor/purify.min.js',
  'vendor/highlight.min.js',
  'vendor/hljs-gherkin.min.js',
  'vendor/hljs-powershell.min.js',
  'vendor/hljs-protobuf.min.js',
  'vendor/hljs-dockerfile.min.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(APP_FILES.map(u => new Request(u, { cache: 'reload' })));
    // best effort: diagrams library for offline use
    try {
      const libs = await caches.open(LIB_CACHE);
      if (!(await libs.match(MERMAID))) {
        const res = await fetch(MERMAID, { mode: 'cors' });
        if (res.ok) await libs.put(MERMAID, res);
      }
    } catch (e) { /* offline or CDN unavailable: cached on first use instead */ }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('app-') && key !== APP_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // GitHub API and anything else cross-origin except the CDN: straight to the network
  if (url.origin !== self.location.origin) {
    if (url.hostname === 'cdn.jsdelivr.net') {
      event.respondWith((async () => {
        const libs = await caches.open(LIB_CACHE);
        const hit = await libs.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) libs.put(req, res.clone());
        return res;
      })());
    }
    return;
  }

  // app shell: cache first, the page itself falls back to index.html
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      if (req.mode === 'navigate') {
        const shell = await cache.match('index.html') || await cache.match('./');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
