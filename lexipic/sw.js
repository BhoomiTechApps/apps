const CACHE_NAME = 'lexipic-v1';
const ASSETS = [
  '/aShiv/lexipic/',
  '/aShiv/lexipic/manifest.json',
  '/aShiv/lexipic/index.html',
  '/aShiv/lexipic/style.css',
  '/aShiv/lexipic/script.js',
  '/aShiv/lexipic/database.js',
  '/aShiv/lexipic/favicon.ico',
  '/aShiv/lexipic/icon-192.png',
  '/aShiv/lexipic/icon-512.png',
  '/aShiv/lexipic/modules/ime/reverse.js',
  '/aShiv/lexipic/modules/ime/reverseMap.js',
  '/aShiv/lexipic/modules/ime/utils.js'
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