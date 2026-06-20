// MediaMap Kiosk PWA — Service Worker
// Caches the app shell (including Leaflet + Material Icons from their
// CDNs) on install so the kiosk works fully offline in USB mode. USB-
// loaded layer data (images/audio/video referenced by URL, or local
// files read via the File System Access API) is handled entirely by
// app.js — the service worker only caches the app shell itself.
//
// URL mode deliberately bypasses this service worker for the remote
// page shown in the iframe (see the fetch handler below) — we never
// want to intercept or cache a kiosk page being displayed from someone
// else's site.

const CACHE_NAME = 'mediamap-kiosk-v1';

const APP_SHELL = [
    './',
    './index.html',
    './kiosk.css',
    './app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    'https://fonts.googleapis.com/icon?family=Material+Icons',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            // Cache what we can; don't fail install if a CDN asset misses
            // (e.g. first install happens offline on a kiosk that was
            // already provisioned with USB data and never needs URL mode).
            return cache.addAll(
                APP_SHELL.filter(u => u.startsWith('./') || u.startsWith('/'))
            ).then(() =>
                cache.addAll(
                    APP_SHELL.filter(u => u.startsWith('https://'))
                ).catch(() => {})
            );
        })
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
    const isAppShell = url.origin === location.origin
        || url.hostname.includes('googleapis.com')
        || url.hostname.includes('gstatic.com')
        || url.hostname === 'unpkg.com';

    // Anything that isn't our own app shell (including the iframe's remote
    // page in URL mode and any of its sub-resources, plus any external
    // map-tile/media URLs fetched directly by Leaflet or the lightbox)
    // passes straight through to the network untouched.
    if (!isAppShell) return;

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
