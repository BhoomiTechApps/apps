/* OCR Studio service worker.
 * Precaches the whole app, including the recognition engine and the
 * Bengali, Assamese and English models, so OCR works fully offline after
 * the first visit. Bump CACHE on every release. */
const CACHE = "ocr-studio-v2.0.0";

const SHELL = [
  "./",
  "./index.html",
  "./favicon.ico",
  "./icon-192.png",
  "./icon-512.png",
  "./manifest.json",
  "./style.css",
  "./app.js",
  "./js/studio.js",
  "./js/zip.js",
  "./js/ime/engine.js",
  "./js/ime/forwardMap.json",
  "./js/ime/reverseMap.json",
  "./js/ime/defaults.json",
  "./js/ime/js-engine-settings.default.json",
  "./cdn/pdf.min.js",
  "./cdn/pdf.worker.min.js",
  "./cdn/tesseract.min.js",
  "./cdn/lucide.min.js",
  "./vendor/tesseract/worker.min.js",
  "./vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js",
  "./vendor/tesseract/core/tesseract-core-lstm.wasm.js",
  "./vendor/tesseract/lang/ben.traineddata.gz",
  "./vendor/tesseract/lang/asm.traineddata.gz",
  "./vendor/tesseract/lang/eng.traineddata.gz"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(caches.match("./index.html").then(r => r || fetch(req)));
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
