/* GeneaMap service worker
   - App shell: stale-while-revalidate (instant offline start, updates picked up in the background)
   - Navigations: network-first with cached fallback
   - Opening a script, stylesheet or source-map URL directly in the address bar returns to index.html
   Paths are relative to the SW scope, so the app works from any folder. */
const VERSION = 'geneamap-v202610031856';
const SHELL_CACHE = `${VERSION}-shell`;
const SHELL = [
  './', './index.html', './style.min.css', './code.min.js', './manifest.json',
  './favicon.ico', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png',
  './assets/vendor/onest/onest-latin.woff2', './assets/vendor/onest/onest-latin-ext.woff2'
];
const scoped = p => new URL(p, self.registration.scope).href;
const CODE_URL = /\.(?:m?js|css|map)$|^dev(?:\/|$)/i;   // tested against the path inside the app folder
const inScope = url => (url.href.startsWith(self.registration.scope) ? url.href.slice(self.registration.scope.length) : url.pathname).split(/[?#]/)[0];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL.map(scoped).map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL_CACHE).map(k => caches.delete(k)));   // also drops the old Google Fonts cache
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // someone typed the address of code.min.js / style.min.css / sw.js / dev/… — send them to the app instead
    if (CODE_URL.test(inScope(url))) { e.respondWith(Response.redirect(scoped('./index.html'), 302)); return; }
    e.respondWith((async () => {
      try {
        const preload = await e.preloadResponse;
        const res = preload || await fetch(req);
        if (res.ok) (await caches.open(SHELL_CACHE)).put(scoped('./index.html'), res.clone());
        return res;
      } catch {
        return (await caches.match(scoped('./index.html'))) || (await caches.match(scoped('./'))) || Response.error();
      }
    })());
    return;
  }
  e.respondWith(staleWhileRevalidate(req, e));
});

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(network); return cached; }
  return (await network) || Response.error();
}
