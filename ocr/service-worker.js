const CACHE = "ocr-studio-v1";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => {
      return cache.addAll([
        "./",
        "./index.html",
        "./favicon.ico",
        "./icon-192.png",
        "./icon-512.png",
		"./cdn/pdf.min.js",
		"./cdn/tesseract.min.js",
		"./cdn/pdf.worker.min.js",
		"./cdn/lucide.min.js",
        "./style.css",
        "./app.js",
        "./manifest.json"
      ]);
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