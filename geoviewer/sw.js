/* GeoViewer service worker (3.5.0)
 * - App shell: cached on install, served cache-first, replaced on each version.
 * - Basemap tiles you view: cached in "gv-tiles-v1", trimmed to TILE_LIMIT.
 * - Saved offline areas: each in its own "gv-area-<id>" cache, written by the
 *   page (Offline button) and never trimmed here. Tiles are looked up in every
 *   cache, so saved areas work with no connection.
 */
"use strict";
var VERSION = "3.5.0",
  SHELL = "gv-shell-" + VERSION,
  TILES = "gv-tiles-v1",
  TILE_LIMIT = 1500,
  SCOPE = self.registration.scope,
  INDEX = new URL("index.html", SCOPE).href,
  V = "?v=" + VERSION,
  SHELL_FILES = [
    "assets/css/geoviewer.css" + V,
    "assets/css/leaflet.css" + V,
    "assets/img/favicon.ico",
    "assets/img/icon-192.png",
    "assets/img/icon-512.png",
    "assets/img/icon-maskable-192.png",
    "assets/img/icon-maskable-512.png",
    "assets/js/geoviewer.js" + V,
    "assets/js/guard.js" + V,
    "assets/js/leaflet.js" + V,
    "assets/js/streetview.js" + V,
    "assets/vendor/lrm.css" + V,
    "assets/vendor/lrm.js" + V,
    "assets/vendor/togeojson.umd.js" + V,
    "assets/vendor/onest/onest-latin-ext-wght-normal.woff2",
    "assets/vendor/onest/onest-latin-wght-normal.woff2",
    "index.html",
    "manifest.webmanifest"
  ],
  TILE_HOSTS = /(^|\.)tile\.openstreetmap\.org$|(^|\.)basemaps\.cartocdn\.com$|^server\.arcgisonline\.com$/;

function isAppPage(u) {
  if (u.origin !== new URL(SCOPE).origin) return false;
  var p = u.href.split(/[?#]/)[0];
  return p === SCOPE || p === INDEX;
}

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return c.addAll(SHELL_FILES.map(function (f) {
      return new Request(new URL(f, SCOPE).href, { cache: "reload" });
    }));
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k.indexOf("gv-shell-") === 0 && k !== SHELL;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Offline areas: the page sends the list of tile addresses; the worker
   downloads them into "gv-area-<id>" and reports progress back. */
var areaJobs = {};
var AREA_HOST_OK = function (u) {
  try { var h = new URL(u); return h.protocol === "https:" && TILE_HOSTS.test(h.hostname); } catch (x) { return false; }
};

function saveArea(src, msg) {
  var id = String(msg.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 32);
  var urls = (Array.isArray(msg.urls) ? msg.urls : []).filter(AREA_HOST_OK).slice(0, 20000);
  var conc = Math.max(1, Math.min(6, msg.conc | 0 || 2));
  var delay = Math.max(0, Math.min(2000, msg.delay | 0));
  var job = areaJobs[id] = { stop: false };
  var i = 0, done = 0, failed = 0, total = urls.length;
  function post(m) { try { src.postMessage(m); } catch (x) {} }
  if (!id || !total) { post({ type: "gv-area-done", id: id, ok: 0, failed: 0, error: true }); return Promise.resolve(); }
  return caches.open("gv-area-" + id).then(function (cache) {
    function next() {
      if (job.stop || i >= total) return Promise.resolve();
      var url = urls[i++];
      return caches.match(url, { ignoreVary: true }).then(function (have) {
        if (have && have.type !== "opaque") return cache.put(url, have.clone());
        return fetch(url, { mode: "cors", credentials: "omit" }).then(function (res) {
          if (!res.ok || res.type !== "cors") throw new Error("bad tile");
          return cache.put(url, res);
        }).then(function () {
          if (delay) return new Promise(function (ok) { setTimeout(ok, delay); });
        });
      }).catch(function () { failed++; }).then(function () {
        done++;
        if (done % 5 === 0 || done === total) post({ type: "gv-area-progress", id: id, done: done, total: total });
      }).then(next);
    }
    var workers = [];
    for (var k = 0; k < conc; k++) workers.push(next());
    return Promise.all(workers);
  }).then(function () {
    var ok = done - failed;
    if (ok <= 0) caches.delete("gv-area-" + id);
    post({ type: "gv-area-done", id: id, ok: ok, failed: failed, stopped: job.stop });
  }).catch(function () {
    post({ type: "gv-area-done", id: id, ok: 0, failed: failed, error: true });
  }).then(function () { delete areaJobs[id]; });
}

self.addEventListener("message", function (e) {
  var d = e.data || {};
  if (d.type === "SKIP_WAITING") self.skipWaiting();
  else if (d.type === "gv-area-save" && e.source) e.waitUntil(saveArea(e.source, d));
  else if (d.type === "gv-area-stop" && areaJobs[d.id]) areaJobs[d.id].stop = true;
  else if (d.type === "gv-area-delete" && d.id) e.waitUntil(caches.delete("gv-area-" + String(d.id).replace(/[^a-z0-9]/gi, "")));
});

var tilePuts = 0;
function trimTiles() {
  return caches.open(TILES).then(function (c) {
    return c.keys().then(function (keys) {
      var extra = keys.length - TILE_LIMIT;
      if (extra > 0) return Promise.all(keys.slice(0, extra).map(function (k) { return c.delete(k); }));
    });
  });
}

function tile(req) {
  // Saved areas and viewed tiles both count; ignoreVary because the page's
  // fetch() and the map's <img> send slightly different headers.
  return caches.match(req, { ignoreVary: true }).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && res.ok && res.type === "cors") {
        var copy = res.clone();
        caches.open(TILES).then(function (c) {
          return c.put(req, copy).then(function () {
            if (++tilePuts % 100 === 0) trimTiles();
          });
        }).catch(function () {});
      }
      return res;
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  if (req.mode === "navigate") {
    // Any other page inside the app's folder (e.g. a code file opened
    // directly) returns to the app.
    if (url.origin === new URL(SCOPE).origin && url.href.indexOf(SCOPE) === 0 && !isAppPage(url)) {
      e.respondWith(Response.redirect(INDEX, 302));
      return;
    }
    if (isAppPage(url)) {
      e.respondWith(caches.match(INDEX, { cacheName: SHELL }).then(function (hit) {
        return hit || fetch(req).catch(function () { return caches.match(INDEX); });
      }));
    }
    return;
  }

  if (url.origin !== self.location.origin) {
    if (TILE_HOSTS.test(url.hostname)) e.respondWith(tile(req));
    return;
  }

  e.respondWith(caches.match(req, { cacheName: SHELL }).then(function (hit) {
    return hit || fetch(req);
  }));
});
