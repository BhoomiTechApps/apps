const CACHE_NAME = 'mapviewer-v1';
const urlsToCache = [
  '/apps/mapview/',
  '/apps/mapview/index.html',
  '/apps/mapview/favicon.ico',
  '/apps/mapview/manifest.json',
  '/apps/mapview/icon-192.png',
  '/apps/mapview/icon-512.png',
  '/apps/mapview/res/mapapp-mini.js',
  '/apps/mapview/res/maproute.js',
  '/apps/mapview/res/mapstyle-mini.css',
  '/apps/mapview/fontas/all.min.css',
  '/apps/mapview/webfonts/fa-brands-400.woff2',
  '/apps/mapview/webfonts/fa-regular-400.woff2',
  '/apps/mapview/webfonts/fa-solid-900.woff2',
  '/apps/mapview/webfonts/fa-v4compatibility.woff2',
  '/apps/mapview/geofile/jszip.min.js',
  '/apps/mapview/geofile/togeojson/togeojson.umd.js',
  '/apps/mapview/leaflet/leaflet.css',
  '/apps/mapview/leaflet/leaflet.js',
  '/apps/mapview/leaflet/leaflet-measure.js',
  '/apps/mapview/leaflet/leaflet-measure.css',
  '/apps/mapview/leaflet/leaflet-routing-machine.css',
  '/apps/mapview/leaflet/leaflet-routing-machine.js',
  '/apps/mapview/leaflet/L.Control.Locate.min.css',
  '/apps/mapview/leaflet/L.Control.Locate.min.js',
  '/apps/mapview/leaflet/Control.FullScreen.css',
  '/apps/mapview/leaflet/Control.FullScreen.js',
  '/apps/mapview/leaflet/icon-fullscreen.svg',
  '/apps/mapview/leaflet/assets/cancel.png',
  '/apps/mapview/leaflet/assets/cancel_@2X.png',
  '/apps/mapview/leaflet/assets/check.png',
  '/apps/mapview/leaflet/assets/check_@2X.png',
  '/apps/mapview/leaflet/assets/focus.png',
  '/apps/mapview/leaflet/assets/focus_@2X.png',
  '/apps/mapview/leaflet/assets/rulers.png',
  '/apps/mapview/leaflet/assets/rulers_@2X.png',
  '/apps/mapview/leaflet/assets/start.png',
  '/apps/mapview/leaflet/assets/start_@2X.png',
  '/apps/mapview/leaflet/assets/trash.png',
  '/apps/mapview/leaflet/assets/trash_@2X.png',
  '/apps/mapview/leaflet/images/layers.png',
  '/apps/mapview/leaflet/images/layers-2x.png',
  '/apps/mapview/leaflet/images/marker-icon.png',
  '/apps/mapview/leaflet/images/marker-icon-2x.png',
  '/apps/mapview/leaflet/images/marker-shadow.png',
  '/apps/mapview/leaflet-ext/leaflet.markercluster.js',
  '/apps/mapview/leaflet-ext/leaflet-heat.js',
  '/apps/mapview/leaflet-ext/turf-min.js',
  '/apps/mapview/leaflet-ext/MarkerCluster.css',
  '/apps/mapview/leaflet-ext/MarkerCluster.Default.css',
  '/apps/mapview/nominatim_proxy.php'
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