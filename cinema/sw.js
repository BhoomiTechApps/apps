const CACHE = 'cinemaview-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/theatre-bg.jpg',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
  '/favicon-32.png',
  '/favicon-16.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('youtube') || e.request.url.includes('googleapis')) {
    return; // let YouTube handle itself
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
