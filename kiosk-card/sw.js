// LexiPic Kiosk PWA — Service Worker
// Caches all app shell files on install so the kiosk works fully offline.
// USB-loaded set data (images/audio embedded as base64 in the JSON) is
// handled by IndexedDB in app.js — the service worker only caches the
// app shell itself.

const CACHE_NAME = 'lexipic-kiosk-v1';

const APP_SHELL = [
    './',
    './index.html',
    './kiosk.css',
    './app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,700;1,9..144,400&display=swap',
    'https://fonts.googleapis.com/icon?family=Material+Icons',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            // Cache what we can; don't fail install if external fonts miss.
            return cache.addAll(
                APP_SHELL.filter(u => u.startsWith('./') || u.startsWith('/'))
            ).then(() =>
                cache.addAll(
                    APP_SHELL.filter(u => u.startsWith('https://'))
                ).catch(() => {}) // Fonts may fail offline — that's fine.
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
    const isAppShell = url.origin === location.origin || url.hostname.includes('googleapis.com');

    // Anything that isn't our own app shell (including the iframe's remote
    // page in URL mode, and any of its sub-resources) passes straight
    // through to the network untouched — we never want to intercept or
    // rewrite a kiosk page being displayed in the iframe.
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
