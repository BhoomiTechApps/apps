const CACHE_NAME = '3dviewer-v1';
const urlsToCache = [
  '/apps/3dview/',
  '/apps/3dview/index.html',
  '/apps/3dview/favicon.ico',
  '/apps/3dview/manifest.json',
  '/apps/3dview/icon-192.png',
  '/apps/3dview/icon-512.png',
  '/apps/3dview/viewer.js',
  '/apps/3dview/ui.js',
  '/apps/3dview/three/three.module.min.js',
  '/apps/3dview/three/addons/controls/OrbitControls.js',
  '/apps/3dview/three/addons/loaders/ColladaLoader.js',
  '/apps/3dview/three/addons/loaders/KMZLoader.js',
  '/apps/3dview/three/addons/renderers/TGALoader.js',
  '/apps/3dview/three/addons/libs/fflate.module.js',
  '/apps/3dview/three/addons/libs/lil-gui.module.mn.js'
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