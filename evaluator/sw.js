// Speed first, updates still arrive:
// - The page itself (index.html) comes from the network when it answers within
//   3 seconds, otherwise from the saved copy.
// - Scripts and styles carry a version number (js/main.js?v=16), so a saved copy is
//   always the right one: they are served instantly from the cache. A new
//   release changes the number in index.html, and the new files are fetched.
// - The source list is fetched fresh when online. Calls to AI providers,
//   Tavily and fonts are never touched.
const CACHE = 'evaluator-v16';
const SHELL = ['./', 'index.html', 'styles.css?v=16', 'lib/logic.js?v=16', 'lib/local.js?v=16',
  'js/core.js?v=16', 'js/store.js?v=16', 'js/providers.js?v=16', 'js/prompts.js?v=16', 'js/citations.js?v=16', 'js/evidence.js?v=16', 'js/analysis.js?v=16', 'js/settings.js?v=16', 'js/manage.js?v=16', 'js/results.js?v=16', 'js/main.js?v=16',
  'manifest.webmanifest', 'trusted-sources.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function saveCopy(request, res) {
  if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
  return res;
}

function networkFirst(request, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const fromCache = () => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'));
    const timer = timeoutMs ? setTimeout(() => fromCache().then((hit) => { if (!settled && hit) { settled = true; resolve(hit); } }), timeoutMs) : null;
    fetch(request, { cache: 'no-cache' })
      .then((res) => { saveCopy(request, res); if (!settled) { settled = true; clearTimeout(timer); resolve(res); } })
      .catch(() => fromCache().then((hit) => { if (!settled) { settled = true; clearTimeout(timer); resolve(hit || Response.error()); } }));
  });
}

function cacheFirst(request) {
  return caches.match(request).then((hit) => hit || fetch(request).then((res) => saveCopy(request, res)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith(networkFirst(request, 3000));
  } else if (url.searchParams.has('v') || url.pathname.includes('/vendor/') || url.pathname.includes('/icons/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request, 0));
  }
});
