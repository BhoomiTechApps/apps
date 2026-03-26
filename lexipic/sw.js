const CACHE_NAME = 'lexipic-v1';
const ASSETS = [
  '/apps/lexipic/',
  '/apps/lexipic/manifest.json',
  '/apps/lexipic/index.html',
  '/apps/lexipic/style.css',
  '/apps/lexipic/script.js',
  '/apps/lexipic/database.js',
  '/apps/lexipic/favicon.ico',
  '/apps/lexipic/icon-192.png',
  '/apps/lexipic/icon-512.png',
  '/apps/lexipic/modules/ime/reverse.js',
  '/apps/lexipic/modules/ime/reverseMap.js',
  '/apps/lexipic/modules/ime/utils.js'
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