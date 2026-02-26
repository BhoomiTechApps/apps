const CACHE_NAME = 'bmtype-cache-v1';
const FILES_TO_CACHE = [
  '/apps/bmtype/index.html',
  '/apps/bmtype/manifest.json',
  '/apps/bmtype/assets/css/style-kp.css',
  '/apps/bmtype/assets/css/style-noto.css',
  '/apps/bmtype/assets/js/main.js',
  '/apps/bmtype/modules/ime/transliterator.js',
  '/apps/bmtype/modules/ime/reverse.js',
  '/apps/bmtype/modules/ime/reverseMap.js',
  '/apps/bmtype/modules/ime/utils.js',
  '/apps/bmtype/modules/ime/phoneticMap.js',
  '/apps/bmtype/modules/ime/ime.js',
  '/apps/bmtype/modules/recording/recording.js';
  '/apps/bmtype/assets/fonts/Kaliprasad.ttf',
  '/apps/bmtype/assets/fonts/NotoSansBengali-Regular.ttf',
  '/appsbmtype/assets/fonts/NotoSansBengali-Bold.ttf',
  '/apps/bmtype/favicon.ico',
  '/apps/bmtype/icon-192.png',
  '/apps/bmtype/icon-512.png'
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
