/**
 * Translit Lab — Service Worker
 * Caches static app shell assets for offline use.
 * Never caches api.php — all engine/data calls always hit the network.
 */

const CACHE_NAME = 'translit-lab-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './engine.js',
  './manifest.json',
];

// ── Install: pre-cache app shell ───────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ──────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network passthrough for API, cache-first for app shell ─────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests; everything else (POST to api.php,
  // cross-origin requests, etc.) goes straight to the network untouched.
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Never cache the API endpoint or its data — always fresh.
  if (url.pathname.endsWith('/api.php') || url.pathname.includes('/data/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Cache-first with background refresh (stale-while-revalidate) for the
  // app shell: HTML, CSS, JS, manifest, icons.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached); // offline fallback to cache

      return cached || networkFetch;
    })
  );
});
