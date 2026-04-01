const CACHE_NAME = 'mapviewer-v1';
const urlsToCache = [
  './',
  './index.html',
  './favicon.ico',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './res/mapapp.js',
  './res/maproute.js',
  './res/mapstyle.css',
  './fontas/all.min.css',
  './webfonts/fa-brands-400.woff2',
  './webfonts/fa-regular-400.woff2',
  './webfonts/fa-solid-900.woff2',
  './webfonts/fa-v4compatibility.woff2',
  './geofile/jszip.min.js',
  './geofile/togeojson/togeojson.umd.js',
  './leaflet/leaflet.css',
  './leaflet/leaflet.js',
  './leaflet/leaflet-measure.js',
  './leaflet/leaflet-mesure.css',
  './leaflet/leaflet-routing-machine.css',
  './leaflet/leaflet-routing-machine.js',
  './leaflet/L.Control.Locate.min.css',
  './leaflet/L.Control.Locate.min.js',
  './leaflet/Control.FullScreen.css',
  './leaflet/Control.FullScreen.js',
  './leaflet/icon-fulscreen.svg',
  './leaflet/assets/cancel.png',
  './leaflet/assets/cancel_@2X.png',
  './leaflet/assets/check.png',
  './leaflet/assets/check_@2X.png',
  './leaflet/assets/focus.png',
  './leaflet/assets/focus_@2X.png',
  './leaflet/assets/rulers.png',
  './leaflet/assets/rulers_@2X.png',
  './leaflet/assets/start.png',
  './leaflet/assets/start_@2X.png',
  './leaflet/assets/trash.png',
  './leaflet/assets/trash_@2X.png',
  './leaflet/images/layers.png',
  './leaflet/images/layers-2x.png',
  './leaflet/images/marker-icon.png',
  './leaflet/images/marker-icon-2x.png',
  './leaflet/images/marker-shadow.png',
  './leaflet-ext/leaflet.markercluster.js',
  './leaflet-ext/leaflet-heat.js',
  './leaflet-ext/turf-min.js',
  './leaflet-ext/MarkerCluster.css',
  './leaflet-ext/MarkerCluster.Default.css'
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