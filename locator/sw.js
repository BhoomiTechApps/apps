/* GeoTag service worker
   - App files (HTML/JS/CSS): network first, so updates arrive without bumping a version by hand
   - Libraries and images: cache first
   - Map tiles you have viewed: cached (capped) so the map works offline
   - Photos shared into the app (share_target): parked in a cache for the page to pick up */

const VERSION = '2.0.2';
const SHELL_CACHE = `geotag-shell-${VERSION}`;
const STATIC_CACHE = `geotag-static-${VERSION}`;
const TILE_CACHE = 'geotag-tiles-v1';
const SHARE_CACHE = 'geotag-share-inbox';
const MAX_TILES = 2000;

const SHELL = ['./', 'index.html', 'scripts.min.js', 'styles.min.css', 'manifest.json'];
const STATIC = [
  'leaflet.js',
  'leaflet.css',
  'Control.Geocoder.js',
  'Control.Geocoder.css',
  'vendor/jszip.min.js',
  'vendor/exifr-lite.umd.js',
  'vendor/piexif.min.js',
  'favicon.ico',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'images/layers.png',
  'images/layers-2x.png',
  'images/pegman.png',
];
const SHELL_PATHS = new Set(SHELL.map((p) => new URL(p, self.registration.scope).pathname));
const TILE_HOSTS = new Set(['tile.openstreetmap.org', 'server.arcgisonline.com', 'mt0.google.com', 'mt1.google.com', 'mt2.google.com', 'mt3.google.com']);

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)),
    caches.open(STATIC_CACHE).then((c) => c.addAll(STATIC)),
  ]));
  // No skipWaiting here: the page shows "A new version is ready" and the user chooses when to reload.
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, STATIC_CACHE, TILE_CACHE, SHARE_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('geotag-') && !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET') return;

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(request, 'index.html'));
    } else if (SHELL_PATHS.has(url.pathname)) {
      event.respondWith(networkFirst(request));
    } else {
      event.respondWith(cacheFirst(request, STATIC_CACHE));
    }
    return;
  }

  if (TILE_HOSTS.has(url.hostname)) {
    event.respondWith(tile(request));
  }
  // Everything else (e.g. place search) goes straight to the network.
});

async function networkFirst(request, fallbackPath) {
  const cache = await caches.open(SHELL_CACHE);
  const key = fallbackPath || request;
  try {
    const response = await withTimeout(fetch(request), 4000);
    if (response.ok) cache.put(key, response.clone());
    return response;
  } catch {
    const cached = await cache.match(key, { ignoreSearch: true });
    if (cached) return cached;
    return new Response('GeoTag is offline and this page is not cached yet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

let tilePuts = 0;
async function tile(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // Only CORS tiles (OSM, Esri) are stored. Google tiles arrive opaque, and Chrome counts each opaque
    // response as ~7 MB of storage quota, so caching them would crowd out saved captures.
    if (response.ok && response.type === 'cors') {
      await cache.put(request, response.clone());
      if (++tilePuts % 50 === 0) trimCache(TILE_CACHE, MAX_TILES);
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  const extra = keys.length - max;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]); // oldest first
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function receiveShare(request) {
  const target = new URL('./?share=1', self.registration.scope).href;
  try {
    const form = await request.formData();
    const files = form.getAll('image').filter((f) => f && typeof f === 'object' && f.size);
    const cache = await caches.open(SHARE_CACHE);
    const t = Date.now();
    await Promise.all(files.map((f, i) => cache.put(
      new URL(`share-inbox/${t}-${i}`, self.registration.scope).href,
      new Response(f, {
        headers: {
          'Content-Type': f.type || 'application/octet-stream',
          'X-Filename': encodeURIComponent(f.name || `shared-${i}.jpg`),
        },
      }),
    )));
  } catch (err) {
    console.warn('Share target failed', err);
  }
  return Response.redirect(target, 303);
}
