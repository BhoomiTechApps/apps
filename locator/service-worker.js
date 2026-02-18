const CACHE_NAME = 'locator-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/src/main.js',
  '/src/locator.js',
  '/src/db.js',
  '/src/styles.css',
  '/src/leaflet.js',
  '/src/leaflet.css'
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
