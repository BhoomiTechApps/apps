const CACHE_NAME = 'genealogy-map-v2';

const ASSETS = [
  '/apps/geneamap/',
  '/apps/geneamap/manifest.json',
  '/apps/geneamap/index.html',
  '/apps/geneamap/style.min.css',
  '/apps/geneamap/code.min.js',
  '/apps/geneamap/favicon.ico',
  '/apps/geneamap/icon-192.png',
  '/apps/geneamap/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => caches.match('/index.html')))
  );
});
