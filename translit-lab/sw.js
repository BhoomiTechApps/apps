/**
 * Transliteration Lab — Service Worker
 * Caches static assets for offline use.
 * Dynamic PHP API calls are always fetched from the network.
 */

const CACHE_NAME = 'translit-lab-v1';

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/engine.js',
  './js/app.js',
  './manifest.json'
];

// ── Install: pre-cache all static assets ──────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for PHP API, cache-first for static assets ───────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go to network for PHP API calls — data must be live
  if (url.pathname.endsWith('.php') || url.searchParams.has('action')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'You are offline. API is unavailable.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // Cache-first for all static assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      // Not in cache — fetch, then cache for next time
      return fetch(event.request).then(response => {
        // Only cache valid same-origin responses
        if (
          response.ok &&
          response.type === 'basic' &&
          event.request.method === 'GET'
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
