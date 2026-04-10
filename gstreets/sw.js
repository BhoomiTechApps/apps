const CACHE_NAME = 'gstreets-v1';
const urlsToCache = [
  '/apps/gstreets/',
  '/apps/gstreets/index.html',
  '/apps/gstreets/favicon.ico',
  '/apps/gstreets/manifest.json',
  '/apps/gstreets/icon-192.png',
  '/apps/gstreets/icon-512.png',
  '/apps/gstreets/res/code.js',
  '/apps/gstreets/res/style.css',
  '/apps/gstreets/fontas/all.min.css',
  '/apps/gstreets/webfonts/fa-brands-400.woff2',
  '/apps/gstreets/webfonts/fa-regular-400.woff2',
  '/apps/gstreets/webfonts/fa-solid-900.woff2',
  '/apps/gstreets/webfonts/fa-v4compatibility.woff2',
  '/apps/gstreets/leaflet/leaflet.css',
  '/apps/gstreets/leaflet/leaflet.js',
  '/apps/mapview/leaflet/Control.Geocoder.css',
  '/apps/mapview/leaflet/Control.Geocoder.js',
  '/apps/mapview/leaflet/images/layers.png',
  '/apps/mapview/leaflet/images/layers-2x.png',
  '/apps/mapview/leaflet/images/marker-icon.png',
  '/apps/mapview/leaflet/images/marker-icon-2x.png',
  '/apps/mapview/leaflet/images/marker-shadow.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
});