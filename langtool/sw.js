const CACHE_NAME = "langtool-v1";

const ASSETS = [
  "/apps/langtool/",
  "/apps/langtool/index.html",
  "/apps/langtool/manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
