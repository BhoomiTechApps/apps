const CACHE_NAME = 'geoimg-v1';

const ASSETS = [
  '/apps/geoimg/',
  '/apps/geoimg/manifest.json',
  '/apps/geoimg/index.html',
  '/apps/geoimg/styles.css',
  '/apps/geoimg/scripts.js',
  '/apps/geoimg/favicon.png',
  '/apps/geoimg/icon-192.png',
  '/apps/geoimg/icon-512.png',
  '/apps/geoimg/editor/escripts.js',
  '/apps/geoimg/editor/estyles.css',
  '/apps/geoimg/editor/index.html'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
