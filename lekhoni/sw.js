// sw.js — offline support for Lekhoni.
//
// - App files are precached under a versioned cache and served cache-first.
//   Requests are matched ignoring "?v=", so a version mismatch between
//   index.html and this list can't cause offline misses.
// - index.html and the transliteration map are network-first (cache fallback),
//   so map fixes and HTML changes reach users on the next online load.
// - Google Fonts are cached at runtime and kept across versions.
//
// Bump APP_VERSION whenever any app file changes.

const APP_VERSION = "5.0.3";
const SHELL_CACHE = `lekhoni-shell-${APP_VERSION}`;
const FONT_CACHE = "lekhoni-fonts-v1";

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/translit-engine.js",
  "./js/translit-hooks.js",
  "./js/translit-wrapper.js",
  "./data/translit-forward-map.json",
  "./js/feature.js",
  "./js/shapes.js",
  "./js/typography.js",
  "./js/masterpages.js",
  "./js/colors.js",
  "./js/layers.js",
  "./js/export.js",
  "./js/app.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Fetch fresh copies (bypassing the HTTP cache) so a new version never
      // precaches stale files.
      Promise.all(
        SHELL_ASSETS.map((url) =>
          fetch(new Request(url, { cache: "reload" })).then((resp) => {
            if (!resp.ok) throw new Error(`${url}: ${resp.status}`);
            return cache.put(url, resp);
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request, cacheKey) {
  return fetch(request)
    .then((resp) => {
      if (resp.ok) {
        const copy = resp.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(cacheKey, copy));
      }
      return resp;
    })
    .catch(() =>
      caches.match(cacheKey, { ignoreSearch: true }).then(
        (cached) => cached || new Response("Offline and not cached", { status: 503 })
      )
    );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === "navigate") {
      event.respondWith(networkFirst(request, "./index.html"));
      return;
    }
    if (url.pathname.endsWith("/data/translit-forward-map.json")) {
      event.respondWith(networkFirst(request, "./data/translit-forward-map.json"));
      return;
    }
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request))
    );
    return;
  }

  // Google Fonts (stylesheet + font files): cache-first, filled on first online load.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((resp) => {
              if (resp.ok || resp.type === "opaque") cache.put(request, resp.clone());
              return resp;
            })
        )
      )
    );
  }
});
