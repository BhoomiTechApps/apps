/* ============================================================
   MediaMap Kiosk — Service Worker
   Cache strategy:
     - Local app shell  →  Cache-first (always fast)
     - CDN assets       →  Stale-while-revalidate (works offline,
                           refreshes in background when online)
     - Everything else  →  Network-first with cache fallback
   ============================================================ */

const CACHE_VERSION = 'v1';
const APP_SHELL_CACHE  = `mediamap-shell-${CACHE_VERSION}`;
const CDN_CACHE        = `mediamap-cdn-${CACHE_VERSION}`;
const RUNTIME_CACHE    = `mediamap-runtime-${CACHE_VERSION}`;

// Local files that form the app shell — always cached at install time
const APP_SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './admin-ui.js',
  './layer-style.js',
  './styles.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon.ico',
];

// CDN origins served stale-while-revalidate
const CDN_ORIGINS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// ─── Install: pre-cache app shell ───────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL_FILES);
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate: prune old caches ─────────────────────────────
self.addEventListener('activate', (event) => {
  const validCaches = [APP_SHELL_CACHE, CDN_CACHE, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !validCaches.includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: route requests ───────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Non-GET requests bypass the cache entirely
  if (request.method !== 'GET') return;

  // Browser-internal / extension requests — ignore
  if (!url.protocol.startsWith('http')) return;

  // ① Local app shell — cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, APP_SHELL_CACHE));
    return;
  }

  // ② CDN assets — stale-while-revalidate
  if (CDN_ORIGINS.some((origin) => url.href.startsWith(origin))) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  // ③ Everything else (tile servers, APIs, etc.) — network-first
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// ─── Strategy helpers ────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline — resource not cached.', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || fetchPromise || new Response('Offline.', { status: 503 });
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline — resource not available.', { status: 503 });
  }
}
