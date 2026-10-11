/* OCR Studio service worker.
 * Precaches the whole app, including the recognition engine and the
 * Bengali, Assamese and English models, so OCR works fully offline after
 * the first visit. Bump CACHE on every release. Machine voices are cached
 * separately, on first use (see VOICE_CACHE). */
const CACHE = "ocr-studio-v3.0.0";

// Machine voices and the speech engine (vendor/tts/) are large, so they are
// not precached. They are downloaded the first time someone presses Listen
// and kept in their own cache, which survives app updates.
const VOICE_CACHE = "ocr-studio-voices-v1";
const TTS_PATH = /\/vendor\/tts\//;

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
  "./js/theme.js",
  "./js/protect.js",
  "./js/voice.js",
  "./js/tts-worker.js",
  "./vendor/onest/onest-latin-wght-normal.woff2",
  "./vendor/onest/onest-latin-ext-wght-normal.woff2",
  "./js/zip.js",
  "./js/pdfwriter.js",
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
    await Promise.all(keys.filter(k => k !== CACHE && k !== VOICE_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Cross-origin isolation. GitHub Pages cannot send these headers, so the
// service worker adds them to everything it serves. They let the machine
// voice use several processor cores (shared memory). Every file of the app
// comes from this site, so nothing else is affected.
function isolate(res) {
  if (!res || res.type === "opaque" || res.type === "opaqueredirect" || res.status === 0) return res;
  const headers = new Headers(res.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// Script and style files may only be loaded by the app itself (as a script,
// stylesheet or worker), never opened as a page or fetched from the console.
const CODE_FILE = /\.(?:m?js|css|map)$/i;

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // Any page other than the app itself (for example /app.js typed into the
    // address bar) goes back to index.html.
    const scope = new URL(self.registration.scope);
    const rel = url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : url.pathname;
    if (rel !== "" && rel !== "index.html") {
      event.respondWith(Response.redirect(new URL("index.html", scope).href, 302));
      return;
    }
    event.respondWith(caches.match("./index.html").then(r => r || fetch(req)).then(isolate));
    return;
  }

  // Machine voice and speech engine (fetched by js/tts-worker.js).
  if (TTS_PATH.test(url.pathname)) {
    event.respondWith(caches.open(VOICE_CACHE).then(async cache => {
      // Voice lists and descriptions: newest first, the copy on this device when offline.
      if (/\.json$/i.test(url.pathname)) {
        try {
          const res = await fetch(req, { cache: "no-cache" });
          if (res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        } catch (e) {
          const hit = await cache.match(req, { ignoreSearch: true });
          if (hit) return hit;
          throw e;
        }
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).then(isolate));
    return;
  }

  if (CODE_FILE.test(url.pathname) && req.destination === "") {
    event.respondWith(new Response("", { status: 403, statusText: "Forbidden" }));
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    })).then(isolate)
  );
});
