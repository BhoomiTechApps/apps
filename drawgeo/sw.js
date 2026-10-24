const VERSION = "3.2.0",
  SHELL = ["./", "./app.min.css", "./app.min.js", "./favicon.ico", "./fonts/onest-latin-wght-normal.woff2", "./fonts/onest-latin-ext-wght-normal.woff2", "./icon-192.png", "./icon-512.png", "./icon-maskable-192.png", "./icon-maskable-512.png", "./index.html", "./leaflet/images/layers-2x.png", "./leaflet/images/layers.png", "./leaflet/images/marker-icon-2x.png", "./leaflet/images/marker-icon.png", "./leaflet/images/marker-shadow.png", "./leaflet/images/spritesheet.svg", "./leaflet/leaflet.css", "./leaflet/leaflet.draw.css", "./leaflet/leaflet.draw.js", "./leaflet/leaflet.js", "./manifest.json", "./vendor/geographiclib-geodesic.min.js", "./vendor/sql-wasm.js", "./vendor/sql-wasm.wasm"],
  SHELL_CACHE = "drawgeo-shell-" + VERSION,
  TILE_CACHE = "drawgeo-tiles-v1",
  TILE_HOSTS = ["tile.openstreetmap.org", "server.arcgisonline.com", "mt0.google.com", "mt1.google.com", "mt2.google.com", "mt3.google.com"],
  MAX_TILES = 3e3,
  TILE_MAX_AGE_MS = 336 * 3600 * 1e3,
  TRIM_EVERY = 50,
  CODE_RE = /\.(m?js|css|map)$/i;
let tileWrites = 0;
self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(t => t.addAll(SHELL.map(a => new Request(a, {
    cache: "reload"
  })))).then(() => self.skipWaiting()))
}), self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(t => Promise.all(t.filter(a => a.startsWith("drawgeo-") && !a.startsWith("drawgeo-area-") && a !== SHELL_CACHE && a !== TILE_CACHE).map(a => caches.delete(a)))).then(() => self.clients.claim()))
}), self.addEventListener("fetch", e => {
  const t = e.request;
  if (t.method !== "GET") return;
  const a = new URL(t.url);
  if (a.origin === self.location.origin) {
    if ((t.mode === "navigate" || t.destination === "document" || t.destination === "iframe") && CODE_RE.test(a.pathname)) {
      e.respondWith(Response.redirect(new URL("./index.html", self.registration.scope).href, 302));
      return
    }
    e.respondWith(fromShell(t))
  } else TILE_HOSTS.includes(a.hostname) && e.respondWith(fromTiles(e, t))
});
async function fromShell(e) {
  const t = await caches.open(SHELL_CACHE),
    a = await t.match(e, {
      ignoreSearch: e.mode === "navigate"
    });
  if (a) return a;
  try {
    return await fetch(e)
  } catch (n) {
    if (e.mode === "navigate") {
      const s = await t.match("./index.html");
      if (s) return s
    }
    throw n
  }
}
/* Areas saved with "Save an area for offline use" live in their own
   "drawgeo-area-<id>" caches; they never expire and are checked first. */
async function fromAreas(t) {
  /* Google tiles are saved from mt0; the map asks mt0-mt3 for the same tile */
  const u = new URL(t.url);
  /^mt[0-3]\.google\.com$/.test(u.hostname) && ((u.hostname = "mt0.google.com"), (t = u.href));
  const keys = (await caches.keys()).filter(k => k.startsWith("drawgeo-area-"));
  for (const k of keys) {
    const hit = await (await caches.open(k)).match(t, {
      ignoreVary: !0
    });
    if (hit) return hit
  }
  return null
}
async function fromTiles(e, t) {
  const saved = await fromAreas(t).catch(() => null);
  if (saved) return saved;
  const a = await caches.open(TILE_CACHE),
    n = await a.match(t);
  if (n && !expired(n)) return n;
  try {
    const s = await fetch(t);
    return s.ok && s.type === "cors" && e.waitUntil(storeTile(a, t, s.clone())), s
  } catch (s) {
    if (n) return n;
    throw s
  }
}

function expired(e) {
  const t = Number(e.headers.get("x-dg-cached-at"));
  return !t || Date.now() - t > TILE_MAX_AGE_MS
}
async function storeTile(e, t, a) {
  try {
    const n = new Headers(a.headers);
    n.set("x-dg-cached-at", String(Date.now()));
    const s = await a.blob();
    await e.put(t, new Response(s, {
      status: a.status,
      statusText: a.statusText,
      headers: n
    })), ++tileWrites % TRIM_EVERY === 0 && await trimTiles(e)
  } catch {
    await trimTiles(e, Math.floor(MAX_TILES / 2)).catch(() => {})
  }
}
async function trimTiles(e, t = MAX_TILES) {
  const a = await e.keys(),
    n = a.length - t;
  n > 0 && await Promise.all(a.slice(0, n).map(s => e.delete(s)))
}