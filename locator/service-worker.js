const CACHE_NAME = 'bhoomitech-cache-v3';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './main.js',
  './assets/modulepreload-polyfill-B5Qt9EMX.js',
  './db.js',
  './assets/main-lRD3bWCo.css',
  './leaflet/leaflet.css',
  './leaflet/leaflet.js',
  './dashboard/index.html',
  './dashboard/firebase.js',
  './dashboard/login.html',
  './assets/dashboard-CdaAg7P4.js',
  './leaflet/images/marker-icon.png',
  './leaflet/images/marker-shadow.png',
  './leaflet/images/marker-icon-2x.png',
  './leaflet/images/layers.png',
  './leaflet/images/layers-2x.png',
  './leaflet/images/pegman.png',
  './icon-192.png',
  './icon-512.png',
  './screenshot-mobile.png',
  './screenshot-desktop.png',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js',
  'https://unpkg.com/leaflet.markercluster/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster/dist/leaflet.markercluster.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // individual adds to prevent one 404 from breaking the whole install
      return Promise.allSettled(
        urlsToCache.map(url => cache.add(url).catch(e => console.log('Failed:', url)))
      );
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(res => res || fetch(event.request))
  );
});
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
