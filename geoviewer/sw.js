// GeoViewer Service Worker
const CACHE = 'geoviewer-v1';
const PRECACHE = [
  './',
  './index.html',
  './res/style.css',
  './res/code.js',
  './res/leaflet.css',
  './leaflet.js',
  './favicon.ico',
  './icon-512.png',
  './icon-192.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Network-first for tile requests; cache-first for app shell
  const url = new URL(event.request.url);
  const isTile = url.hostname.includes('tile') || url.pathname.includes('/MapServer/tile/');

  if (isTile) {
    // Cache tiles for offline use
    event.respondWith(
      caches.open(CACHE + '-tiles').then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached);
        })
      )
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).catch(() => caches.match('./index.html'))
      )
    );
  }
});
