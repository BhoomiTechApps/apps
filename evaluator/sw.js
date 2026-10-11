/* Evaluator: sw.js
 *
 * Keeps the app's own files so it installs and opens without a connection.
 * Only this app's files are handled: calls to AI providers and Tavily always
 * go to the network and are never stored. The settings file is not touched
 * here; it lives in the app's folder on the device (js/settingsfile.js).
 *
 * App files: network first (so updates show on the next start), falling back
 * to the stored copy offline. Large libraries, fonts and icons: stored copy
 * first, since they only change with a new version.
 *
 * Opening a code file (.js, .css, .map) directly in the address bar - typed,
 * from a link, or from the console with location = 'js/main.js' - is
 * redirected to index.html. The page's own <script>/<link> loads and the PDF
 * worker are not navigations and are served as usual.
 */
'use strict';

const VERSION = '16.3.3-pwa.1';
const CACHE = `evaluator-${VERSION}`;
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'trusted-sources.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'lib/logic.js', 'lib/local.js',
  'js/guard.js', 'js/core.js', 'js/settingsfile.js', 'js/store.js', 'js/providers.js', 'js/prompts.js', 'js/citations.js',
  'js/evidence.js', 'js/analysis.js', 'js/settings.js', 'js/manage.js', 'js/results.js', 'js/main.js',
  'vendor/onest/onest-latin-wght-normal.woff2', 'vendor/onest/onest-latin-ext-wght-normal.woff2',
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/mammoth.browser.min.js',
];
const STATIC = /\/(vendor|icons)\//;
const CODE_FILE = /\.(?:m?js|css|map)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('evaluator-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // providers, Tavily, links: straight to the network
  if (req.mode === 'navigate' && CODE_FILE.test(url.pathname)) {
    event.respondWith(Response.redirect(new URL('index.html', self.registration.scope).href, 302));
    return;
  }

  if (STATIC.test(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
