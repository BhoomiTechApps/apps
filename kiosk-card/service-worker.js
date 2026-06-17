// =============================================================================
// LexiPic Kiosk — Service Worker
//
// This is a kiosk app: it's expected to run unattended, often on flaky or
// absent network connections, and all of its actual content (word sets,
// images, audio) already lives in IndexedDB as base64 data — none of that
// is fetched over the network. The only things this service worker needs
// to guarantee availability for are:
//
//   1. The app shell itself (HTML/CSS/JS) — cached on install, served
//      cache-first so the kiosk boots instantly and works fully offline.
//   2. The three CDN dependencies (Tailwind, Material Icons, Google Fonts)
//      — cached opportunistically with a stale-while-revalidate strategy,
//      so a first successful load makes the kiosk resilient to later
//      network outages without ever blocking on a slow/dead CDN.
//
// Versioned cache names mean a deploy of a new SHELL_CACHE_VERSION cleans
// up the old shell cache on activate, while the CDN cache is left alone
// (those assets don't change with this app's releases).
// =============================================================================

const SHELL_CACHE_VERSION = 'lexipic-shell-v1';
const CDN_CACHE_VERSION = 'lexipic-cdn-v1';

// Everything needed to render and run the kiosk without a network connection.
const SHELL_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './admin-ui.js',
    './manifest.webmanifest',
    './icon-192.png',
    './icon-512.png',
    './icon-512-maskable.png',
    './favicon.ico'
];

// Third-party assets the app references directly in index.html. Cached
// stale-while-revalidate rather than at install time, since a CDN hiccup
// during install shouldn't ever block the service worker from activating.
const CDN_HOSTS = [
    'cdn.tailwindcss.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE_VERSION)
            .then((cache) => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys
                .filter((key) => key !== SHELL_CACHE_VERSION && key !== CDN_CACHE_VERSION)
                .map((key) => caches.delete(key))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Only handle simple GETs — let everything else (POSTs, browser
    // extension requests, etc.) fall through to the network untouched.
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    if (CDN_HOSTS.includes(url.hostname)) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirst(request));
    }
});

async function cacheFirst(request) {
    const cache = await caches.open(SHELL_CACHE_VERSION);
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
    } catch (err) {
        // Navigations (e.g. a direct load of a deep link) fall back to the
        // cached shell page so the kiosk still boots while offline.
        if (request.mode === 'navigate') {
            const fallback = await cache.match('./index.html');
            if (fallback) return fallback;
        }
        throw err;
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CDN_CACHE_VERSION);
    const cached = await cache.match(request);

    const networkFetch = fetch(request)
        .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
        })
        .catch(() => null);

    // Serve the cached copy instantly if we have one, refreshing it in the
    // background; otherwise wait on the network as a last resort.
    return cached || (await networkFetch) || Response.error();
}
