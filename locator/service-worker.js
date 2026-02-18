const CACHE_NAME = 'locator-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './assets/favicon-BPfJLI-x.ico',
  './assets/icon-192.png',
  './assets/index-C81D2Fy4.js',
  './assets/index-Dke6wNcH.css',
  './assets/manifest-D_VhgHti.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});


