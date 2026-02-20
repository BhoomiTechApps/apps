const CACHE_NAME = 'langtool-cache-v1';
const FILES_TO_CACHE = [
  '/apps/langtool/index.html',
  '/apps/langtool/manifest.json',
  '/apps/langtool/favicon.ico',
  '/apps/langtool/icon-192.png',
  '/apps/langtool/icon-512.png',
  '/apps/langtool/assets/css/style.css',
  '/apps/langtool/modules/ime/transliterator.js',
  '/apps/langtool/modules/ime/phoneticMap.js',
  '/apps/langtool/modules/ime/ime.js'
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
