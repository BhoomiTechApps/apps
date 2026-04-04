const CACHE_NAME = 'lexipic-v1';
const ASSETS = [
  '/apps/dynaform/',
  '/apps/dynaform/manifest.json',
  '/apps/dynaform/index.html',
  '/apps/dynaform/style.css',
  '/apps/dynaform/app.js',
  '/apps/dynaform/conn.js',
  '/apps/dynaform/conns.json',
  '/apps/dynaform/favicon.ico',
  '/apps/dynaform/icon-192.png',
  '/apps/dynaform/icon-512.png',
  '/apps/dynaform/lohitass.js',
  '/apps/dynaform/noto_sans_bengali-normal.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});