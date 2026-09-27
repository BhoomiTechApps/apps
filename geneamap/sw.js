/* GeneaMap service worker
   - App shell: stale-while-revalidate (instant offline start, updates picked up in the background)
   - Navigations: network-first with cached fallback
   - Google Fonts: cache-first
   Paths are relative to the SW scope, so the app works from any folder. */
const VERSION = 'geneamap-v202609270740';
const SHELL_CACHE = `${VERSION}-shell`;
const FONT_CACHE = 'geneamap-fonts';
const SHELL = [
  './', './index.html', './style.min.css', './code.min.js', './manifest.json',
  './favicon.ico', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'
];
const scoped = p => new URL(p, self.registration.scope).href;

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
    await Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== FONT_CACHE).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
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

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') (await caches.open(cacheName)).put(req, res.clone());
    return res;
  } catch { return Response.error(); }
}

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
