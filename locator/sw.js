const CACHE_NAME = 'geotag-pwa-v1.1';
const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'styles.css',
  'scripts.js',
  'leaflet.js',
  'leaflet.css',
  'icon-192.png',
  'icon-512.png',
  'images/layers.png',
  'images/layers-2x.png',
  'images/marker-icon.png',
  'images/marker-icon-2x.png',
  'images/marker-shadow.png',
  'Control.Geocoder.css',
  'Control.Geocoder.js',
  'L.Control.Locate.min.css',
  'L.Control.Locate.min.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request).catch(() => {
      });
    })
  );
});