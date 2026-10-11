/* Interview Recorder service worker (the constants above are written by the plugin).
 * - The recorder's own files (scripts, styles, font, icons, workers) are kept in a cache named
 *   after the plugin version, so the app opens fast and works offline; a new plugin version
 *   replaces the cache.
 * - The recorder page is always fetched fresh; the last good copy is the offline fallback.
 * - Website calls (/wp-json/, logins, anything else) are never touched. */
self.addEventListener('install', function (e) {
	e.waitUntil(caches.open(CACHE).then(function (c) {
		return Promise.all(PRECACHE.map(function (u) {
			return c.add(new Request(u, { cache: 'reload' })).catch(function () { /* one missing file must not block install */ });
		}));
	}).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
	e.waitUntil(caches.keys().then(function (keys) {
		return Promise.all(keys.filter(function (k) { return k.indexOf('ir-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
	}).then(function () { return self.clients.claim(); }));
});

function isShell(url) {
	var s = new URL(SHELL);
	if (url.pathname !== s.pathname) return false;
	if (url.searchParams.has('ir_embed') || url.searchParams.has('ir_join')) return false;
	return s.search === '' ? url.search === '' : url.searchParams.get('ir_app') === '1';
}

function offlinePage() {
	var html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
		+ '<title>' + OFFLINE_TITLE + '</title>'
		+ '<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#e8e6e0;color:#23221f;font:15px/1.5 system-ui,sans-serif;text-align:center;padding:24px">'
		+ '<div><h1 style="font-size:20px;font-weight:650;margin:0 0 8px">' + OFFLINE_TITLE + '</h1><p style="margin:0;color:#5b5953">' + OFFLINE_TEXT + '</p></div>';
	return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('fetch', function (e) {
	var req = e.request;
	if (req.method !== 'GET') return;
	var url = new URL(req.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname.indexOf('/wp-json/') !== -1 || url.searchParams.has('rest_route')) return;

	if (req.mode === 'navigate') {
		var shell = isShell(url);
		e.respondWith(fetch(req).then(function (res) {
			if (shell && res.ok && res.type === 'basic') {
				var copy = res.clone();
				caches.open(CACHE).then(function (c) { return c.put(SHELL, copy); });
			}
			return res;
		}).catch(function () {
			return caches.match(SHELL, { ignoreSearch: false }).then(function (hit) { return hit || offlinePage(); });
		}));
		return;
	}

	if (req.url.indexOf(ASSETS) === 0) {
		e.respondWith(caches.match(req).then(function (hit) {
			return hit || fetch(req).then(function (res) {
				if (res.ok && res.type === 'basic') {
					var copy = res.clone();
					caches.open(CACHE).then(function (c) { return c.put(req, copy); });
				}
				return res;
			});
		}));
	}
});
