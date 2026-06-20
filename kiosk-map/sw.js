// MediaMap Kiosk PWA — Service Worker
// Caches the entire app shell — including Leaflet and Material Icons,
// which are vendored locally rather than loaded from a CDN (see
// vendor/README.md) — on install, so the kiosk works fully offline in
// USB mode from the very first launch, even one that happens with zero
// network connectivity. USB-loaded layer data (images/audio/video
// referenced by URL, or local files read via the File System Access
// API) is handled entirely by app.js — the service worker only caches
// the app shell itself.
//
// URL mode deliberately bypasses this service worker for the remote
// page shown in the iframe (see the fetch handler below) — we never
// want to intercept or cache a kiosk page being displayed from someone
// else's site.

const CACHE_NAME = 'mediamap-kiosk-v2'; // bumped: v1 cached CDN URLs that no longer exist in the app shell

const APP_SHELL = [
    './',
    './index.html',
    './kiosk.css',
    './app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './vendor/material-icons/material-icons.css',
    './vendor/material-icons/material-icons.woff2',
    './vendor/leaflet/leaflet.css',
    './vendor/leaflet/leaflet.js',
    './vendor/leaflet/images/marker-icon.png',
    './vendor/leaflet/images/marker-icon-2x.png',
    './vendor/leaflet/images/marker-shadow.png',
    './vendor/leaflet/images/layers.png',
    './vendor/leaflet/images/layers-2x.png',
];

self.addEventListener('install', event => {
    event.waitUntil(
        // Every entry here is now same-origin (no CDN), so a single
        // cache.addAll() either fully succeeds or fully fails — no more
        // "best effort" split between local files and external assets.
        // If this fails, the browser keeps any PREVIOUSLY installed
        // service worker active rather than activating a half-cached
        // one, which is exactly the safe behavior we want here.
        caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Anything that isn't our own same-origin app shell (the iframe's
    // remote page in URL mode and any of its sub-resources, plus any
    // external map-tile/media URLs fetched directly by Leaflet or the
    // lightbox) passes straight through to the network untouched.
    if (url.origin !== location.origin) return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});
