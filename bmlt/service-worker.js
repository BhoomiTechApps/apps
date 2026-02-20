const CACHE_NAME = 'bmlt-cache-v1';
const FILES_TO_CACHE = [
  '/apps/bmlt/index.html',
  '/apps/bmlt/manifest.json',
  '/apps/bmlt/assets/css/style.css',
  '/apps/bmlt/assets/js/main.js',
  '/apps/bmlt/modules/ime/transliterator.js',
  '/apps/bmlt/modules/ime/phoneticMap.js',
  '/apps/bmlt/modules/ime/ime.js',
  '/apps/bmlt/favicon.ico',
  '/apps/bmlt/icon-192.png',
  '/apps/bmlt/icon-512.png' // Removed the comma here
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  evt.respondWith(
    caches.match(evt.request).then(resp => resp || fetch(evt.request))
  );
});
