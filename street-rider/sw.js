/* Street Journey Lite service worker.
 * App shell: precached, cache-first (works offline).
 * Map tiles: cache-first, stored as they're seen, capped in size.
 * Routing (OSRM): network only. */
const VERSION = 'sjl-1.0.0';
const SHELL = VERSION + '-shell';
const TILES = 'sjl-tiles';
const TILE_MAX = 3000;

const ASSETS = [
  './', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'sample-points.json',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'fonts/onest-latin-wght-normal.woff2', 'fonts/onest-latin-ext-wght-normal.woff2',
  'icons/motorcycle.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

const TILE_HOSTS = ['tile.openstreetmap.org', 'basemaps.cartocdn.com', 'arcgisonline.com', 'stadiamaps.com', 'opentopomap.org', 'google.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

let trimming = false;
async function trimTiles() {
  if (trimming) return;
  trimming = true;
  try {
    const c = await caches.open(TILES);
    const keys = await c.keys();
    const extra = keys.length - TILE_MAX;
    for (let i = 0; i < extra; i++) await c.delete(keys[i]);
  } finally { trimming = false; }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname.includes('project-osrm.org')) return; // live routing only

  if (TILE_HOSTS.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(
      caches.open(TILES).then((c) => c.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) { c.put(req, res.clone()); trimTiles(); }
          return res;
        });
      }))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
    );
  }
});
