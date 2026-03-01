const CACHE_NAME = 'bmtype-cache-v1';
const FILES_TO_CACHE = [
  './index.html',
  './manifest.json',
  './assets/css/style-kp.css',
  './assets/css/style-noto.css',
  './assets/js/main.js',
  './modules/ime/transliterator.js',
  './modules/ime/reverse.js',
  './modules/ime/reverseMap.js',
  './modules/ime/utils.js',
  './modules/ime/phoneticMap.js',
  './modules/ime/ime.js',
  './modules/recording/recording.js',
  './assets/fonts/Kaliprasad.ttf',
  './assets/fonts/NotoSansBengali-Regular.ttf',
  './assets/fonts/NotoSansBengali-Bold.ttf',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png'
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

