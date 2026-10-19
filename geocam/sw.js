// App-shell service worker: after ONE online visit, GeoCam runs with no network at all.
const CACHE = 'geocam-v3';
const ASSETS = [
  './', './index.html', './app.js', './style.css', './manifest.webmanifest',
  './icon.svg', './icon-192.png', './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' bypasses the HTTP cache so we never pin a stale file offline.
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first (instant + works offline), refreshed in the background when online.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Any page navigation (e.g. launched from home screen with a query string) → app shell.
    const cached = req.mode === 'navigate'
      ? (await cache.match('./index.html')) || (await cache.match('./'))
      : await cache.match(req, { ignoreSearch: true });

    const refresh = fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') cache.put(req.mode === 'navigate' ? './index.html' : req, res.clone());
        return res;
      })
      .catch(() => null);

    if (cached) { e.waitUntil(refresh); return cached; }
    const res = await refresh;
    return res || new Response('Offline and not cached yet', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })());
});

// Lets the page ask "is everything cached?" for the offline-ready badge.
self.addEventListener('message', async (e) => {
  if (e.data !== 'offline-status') return;
  const cache = await caches.open(CACHE);
  const missing = [];
  for (const u of ASSETS) if (!(await cache.match(u))) missing.push(u);
  e.source.postMessage({ type: 'offline-status', ready: missing.length === 0, missing });
});
