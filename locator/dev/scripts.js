/* GeoTag 2.0: offline GPS photo capture.
   Sections: utilities · settings · storage (IndexedDB) · GPS · map · capture · image processing
             · captures list · export · settings sheet · service worker · startup */
'use strict';

const APP_VERSION = '2.0.2';

/* =========================================================================
   Utilities
   ========================================================================= */

const $ = (sel, root = document) => root.querySelector(sel);

const ICONS = {
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  flip: '<path d="M20 11a8 8 0 0 0-14.9-4"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 4"/><path d="M20 20v-4h-4"/><circle cx="12" cy="12" r="2.5"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  streetview: '<circle cx="12" cy="5" r="2.5"/><path d="M9.5 21v-6H8v-4.5A2.5 2.5 0 0 1 10.5 8h3a2.5 2.5 0 0 1 2.5 2.5V15h-1.5v6z"/>',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('i');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    if (!node.firstChild) node.append(icon(node.dataset.icon));
  });
}

/** Small DOM builder: h('div', {class:'x', onclick: fn}, 'text', child) — text is never parsed as HTML. */
function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const fmtCoord = (n) => Number(n).toFixed(6);
const fmtCoords = (lat, lng) => `${fmtCoord(lat)}, ${fmtCoord(lng)}`;
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

function fmtDateTime(ts) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtBytes(bytes) {
  if (!isNum(bytes)) return '?';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(bytes < 10 && i ? 1 : 0)} ${units[i]}`;
}

function stamp(ts, sep = '_') {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${sep}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/gif': 'gif', 'image/avif': 'avif',
};
const extFor = (mime) => EXT_BY_MIME[(mime || '').toLowerCase()] || 'jpg';

const SOURCE_LABELS = {
  gps: 'GPS', manual: 'Map pin', search: 'Search result', exif: 'Photo data', legacy: 'Older capture',
};

const scriptLoads = {};
function loadScript(src) {
  if (!scriptLoads[src]) {
    scriptLoads[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete scriptLoads[src]; reject(new Error(`Couldn't load ${src}. Check your connection and try again.`)); };
      document.head.append(s);
    });
  }
  return scriptLoads[src];
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ---------- Toasts (replace alert/confirm) ---------- */

const toastRoot = $('#toasts');

function toastHost() {
  const open = [...document.querySelectorAll('dialog[open]')];
  return open.length ? open[open.length - 1] : document.body;
}

/**
 * toast('Saved') or toast('Deleted', {action:'Undo', onAction, duration}).
 * Returns {update(text), close()}. duration: ms, or 0 to stay until closed.
 */
function toast(text, { action, onAction, duration = 3500, type = 'info', onTimeout } = {}) {
  const host = toastHost();
  if (toastRoot.parentElement !== host) host.append(toastRoot);
  const label = h('span', { text });
  const node = h('div', { class: `toast${type === 'error' ? ' toast--error' : ''}`, role: type === 'error' ? 'alert' : 'status' }, label);
  let timer;
  let acted = false;
  const close = () => { clearTimeout(timer); node.remove(); };
  if (action) {
    node.append(h('button', {
      type: 'button',
      text: action,
      onclick: () => { acted = true; close(); onAction?.(); },
    }));
  }
  toastRoot.append(node);
  while (toastRoot.children.length > 3) toastRoot.firstElementChild.remove();
  if (duration) timer = setTimeout(() => { close(); if (!acted) onTimeout?.(); }, duration);
  return { update: (t) => { label.textContent = t; }, close };
}

const toastError = (text) => toast(text, { type: 'error', duration: 6000 });

/* ---------- Dialog helpers ---------- */

function openSheet(dialog) {
  if (!dialog.open) dialog.showModal();
}

function wireSheet(dialog) {
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
  // Tap on the dimmed backdrop closes the sheet
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}

/* =========================================================================
   Settings
   ========================================================================= */

const DEFAULT_SETTINGS = {
  accuracy: 30,          // metres; 0 = any
  camera: 'environment', // 'environment' | 'user'
  maxSize: 2048,         // px on the long edge; 0 = original
  watermark: true,
  baseLayer: null,        // null = default (Esri Hybrid); set only when the user picks a layer
  view: null,            // {lat, lng, zoom}
};

const settings = (() => {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('geotag.settings') || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
})();

if (settings.layerPrefV !== 2) {
  settings.baseLayer = null;
  settings.layerPrefV = 2;
}

function saveSettings() {
  try { localStorage.setItem('geotag.settings', JSON.stringify(settings)); } catch { /* private mode */ }
}

const accuracyLimit = () => (settings.accuracy > 0 ? settings.accuracy : Infinity);

/* =========================================================================
   Storage: IndexedDB
   captures: metadata + small thumbnail (listing stays cheap)
   images:   full-size photo blobs, loaded only when exporting/sharing
   ========================================================================= */

const DB_NAME = 'GeoTagDB';
const DB_VERSION = 3;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = req.result;
      const tx = req.transaction;
      const caps = db.objectStoreNames.contains('captures')
        ? tx.objectStore('captures')
        : db.createObjectStore('captures', { keyPath: 'id' });
      if (!caps.indexNames.contains('createdAt')) caps.createIndex('createdAt', 'createdAt');

      if (!db.objectStoreNames.contains('images')) {
        const images = db.createObjectStore('images', { keyPath: 'id' });
        // Migrate v1/v2 records ({id, lat:'..', lng:'..', phone, desc, image}) to the new shape.
        if (e.oldVersion > 0) {
          caps.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) return;
            const v = cursor.value;
            if (v.image) images.put({ id: v.id, blob: v.image });
            cursor.update({
              id: v.id,
              lat: parseFloat(v.lat),
              lng: parseFloat(v.lng),
              accuracy: null,
              source: 'legacy',
              phone: v.phone || '',
              desc: v.desc || '',
              createdAt: Number(v.id) || Date.now(),
              takenAt: Number(v.id) || Date.now(),
              mime: v.image?.type || 'image/jpeg',
              thumb: null,
              needsThumb: !!v.image,
              exportedAt: null,
            });
            cursor.continue();
          };
        }
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        toast('GeoTag was updated in another tab. Reload this tab to keep going.', { action: 'Reload', onAction: () => location.reload(), duration: 0 });
      };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => toast('Close other GeoTag tabs to finish updating.', { duration: 6000 });
  });
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted', 'AbortError'));
  });
}

function reqResult(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const store = {
  async all() {
    const db = await openDB();
    const rows = await reqResult(db.transaction('captures').objectStore('captures').getAll());
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
  async image(id) {
    const db = await openDB();
    const row = await reqResult(db.transaction('images').objectStore('images').get(id));
    return row?.blob || null;
  },
  async add(record, blob) {
    const db = await openDB();
    const tx = db.transaction(['captures', 'images'], 'readwrite');
    tx.objectStore('captures').add(record);
    tx.objectStore('images').add({ id: record.id, blob });
    await txDone(tx);
  },
  async putMany(records) {
    const db = await openDB();
    const tx = db.transaction('captures', 'readwrite');
    records.forEach((r) => tx.objectStore('captures').put(r));
    await txDone(tx);
  },
  /** Deletes and returns what was removed so it can be restored (undo). */
  async remove(ids) {
    const db = await openDB();
    const tx = db.transaction(['captures', 'images'], 'readwrite');
    const caps = tx.objectStore('captures');
    const imgs = tx.objectStore('images');
    const removed = [];
    for (const id of ids) {
      const [record, image] = await Promise.all([reqResult(caps.get(id)), reqResult(imgs.get(id))]);
      if (record) removed.push({ record, image });
      caps.delete(id);
      imgs.delete(id);
    }
    await txDone(tx);
    return removed;
  },
  async restore(items) {
    const db = await openDB();
    const tx = db.transaction(['captures', 'images'], 'readwrite');
    items.forEach(({ record, image }) => {
      tx.objectStore('captures').put(record);
      if (image) tx.objectStore('images').put(image);
    });
    await txDone(tx);
  },
};

/** Ask the browser not to evict our data when the device is low on space. */
async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

/* =========================================================================
   GPS: one shared watchPosition, reference-counted by whoever needs it
   ========================================================================= */

const gps = {
  last: null,          // {lat, lng, accuracy, timestamp}
  error: null,         // GeolocationPositionError
  watchId: null,
  users: new Set(),
  listeners: new Set(),

  get supported() { return 'geolocation' in navigator; },

  start(reason) {
    this.users.add(reason);
    this._ensure();
  },
  stop(reason) {
    this.users.delete(reason);
    if (!this.users.size) this._clear();
  },
  /** Watch for a limited time (e.g. after tapping "locate"). */
  startFor(reason, ms) {
    this.start(reason);
    clearTimeout(this['_t_' + reason]);
    this['_t_' + reason] = setTimeout(() => this.stop(reason), ms);
  },
  on(fn) { this.listeners.add(fn); },

  _ensure() {
    if (!this.supported || this.watchId != null || document.hidden) return;
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        this.error = null;
        this.last = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: Math.max(1, Math.round(p.coords.accuracy)),
          timestamp: p.timestamp,
        };
        this._emit();
      },
      (err) => { this.error = err; this._emit(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
  },
  _clear() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  },
  _emit() { this.listeners.forEach((fn) => fn(this)); },
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) gps._clear();
  else if (gps.users.size) gps._ensure();
});

function gpsErrorText(err) {
  if (!gps.supported) return 'This browser has no location support.';
  if (!err) return '';
  switch (err.code) {
    case 1: return 'Location is blocked. Allow it in your browser’s site settings.';
    case 2: return 'Location unavailable. Turn on GPS or move to open sky.';
    case 3: return 'Still searching for a GPS signal…';
    default: return err.message || 'Location error.';
  }
}

/* =========================================================================
   Map
   ========================================================================= */

let map;
let pinMarker = null;
let accuracyCircle = null;
let savedLayer;
const savedMarkers = new Map(); // id -> circleMarker

/** The point a capture will use by default. source: gps | manual | search */
let pin = null;
let followGps = true;        // pin tracks GPS until the user places it by hand
let centerOnNextFix = true;
let lastPopupClose = 0;

function initMap() {
  // OSM and Esri send CORS headers, so their tiles can be cached for offline use.
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 21,
    maxNativeZoom: 19,
    crossOrigin: 'anonymous',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  const esri = (path, attribution) => L.tileLayer(
    `https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`,
    { maxZoom: 21, maxNativeZoom: 19, crossOrigin: 'anonymous', attribution },
  );
  const esriImageryAttr = 'Imagery &copy; Esri, Maxar, Earthstar Geographics';
  const esriHybrid = () => L.layerGroup([
    esri('World_Imagery', esriImageryAttr),
    esri('Reference/World_Transportation', ''),
    esri('Reference/World_Boundaries_and_Places', 'Labels &copy; Esri'),
  ]);
  // Google tiles (lyrs: m = streets, y = hybrid, s = satellite). Loaded as plain images, spread over mt0–mt3.
  const google = (lyrs) => L.tileLayer(`https://{s}.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}`, {
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    maxZoom: 21,
    maxNativeZoom: 20,
    attribution: 'Map data &copy; Google',
  });

  const DEFAULT_LAYER = 'Esri Hybrid';
  const baseLayers = {
    'Esri Hybrid': esriHybrid(),
    'Esri Satellite': esri('World_Imagery', esriImageryAttr),
    OpenStreetMap: osm,
    'Google Hybrid': google('y'),
    'Google Satellite': google('s'),
    'Google Streets': google('m'),
  };
  // Layer names used by earlier builds
  const legacyNames = {
    Map: 'OpenStreetMap', OSM: 'OpenStreetMap', Hybrid: 'Esri Hybrid', Satellite: 'Esri Satellite', Street: 'Google Streets',
  };
  const savedLayer0 = legacyNames[settings.baseLayer] || settings.baseLayer;

  const start = settings.view || { lat: 20.5937, lng: 78.9629, zoom: 5 };
  map = L.map('map', {
    zoomControl: false,
    layers: [baseLayers[savedLayer0] || baseLayers[DEFAULT_LAYER]],
  }).setView([start.lat, start.lng], start.zoom);
  map.attributionControl.setPrefix(false);

  // Search (Nominatim)
  const geocoder = L.Control.geocoder({
    defaultMarkGeocode: false,
    placeholder: 'Search places',
    position: 'topleft',
    collapsed: true,
  })
    .on('startgeocode', () => { if (!navigator.onLine) toast('Search needs an internet connection.'); })
    .on('markgeocode', (e) => {
      const c = e.geocode.center;
      setPin({ lat: c.lat, lng: c.lng, accuracy: null, source: 'search', timestamp: Date.now() }, { move: true });
    })
    .addTo(map);
  geocoder.getContainer?.()?.querySelector('input')?.setAttribute('aria-label', 'Search places');

  L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
  map.on('baselayerchange', (e) => { settings.baseLayer = e.name; saveSettings(); });

  // Bottom-right stack, added bottom-first: locate, zoom, street view
  const LocateControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', '', bar);
      a.href = '#';
      a.setAttribute('role', 'button');
      a.title = 'Use my location';
      a.setAttribute('aria-label', 'Use my location');
      a.append(icon('crosshair'));
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); useMyLocation(); });
      return bar;
    },
  });
  const StreetViewControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', '', bar);
      a.href = '#';
      a.setAttribute('role', 'button');
      a.title = 'Open Street View at the pin';
      a.setAttribute('aria-label', 'Open Google Street View at the pin');
      const img = L.DomUtil.create('img', '', a);
      img.src = 'images/pegman.png';
      img.alt = '';
      img.width = 26;
      img.height = 26;
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        if (!pin) { toast('Place a pin on the map first.'); return; }
        window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${pin.lat},${pin.lng}`, '_blank', 'noopener');
      });
      return bar;
    },
  });
  map.addControl(new LocateControl());
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.addControl(new StreetViewControl());

  savedLayer = L.layerGroup().addTo(map);

  map.on('popupclose', () => { lastPopupClose = Date.now(); });
  map.on('click', (e) => {
    if (Date.now() - lastPopupClose < 400) return; // this tap just closed a popup
    setPin({ lat: e.latlng.lat, lng: e.latlng.lng, accuracy: null, source: 'manual', timestamp: Date.now() }, { move: false });
  });
  map.on('moveend', () => {
    const c = map.getCenter();
    settings.view = { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), zoom: map.getZoom() };
    saveSettings();
  });

  gps.on(onGpsUpdate);
}

function pinIcon(source) {
  return L.divIcon({
    className: `pin-icon${source === 'gps' ? '' : ' pin-icon--manual'}`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function setPin(p, { move = false } = {}) {
  if (!isNum(p.lat) || !isNum(p.lng)) return;
  pin = p;
  followGps = p.source === 'gps';

  if (!pinMarker) {
    pinMarker = L.marker([p.lat, p.lng], {
      icon: pinIcon(p.source),
      draggable: true,
      keyboard: true,
      title: 'Capture location',
      alt: 'Capture location pin',
      zIndexOffset: 1000,
    }).addTo(map);
    pinMarker.on('dragend', () => {
      const ll = pinMarker.getLatLng();
      setPin({ lat: ll.lat, lng: ll.lng, accuracy: null, source: 'manual', timestamp: Date.now() });
    });
  } else {
    pinMarker.setLatLng([p.lat, p.lng]);
    pinMarker.setIcon(pinIcon(p.source));
  }

  if (p.source === 'gps' && isNum(p.accuracy)) {
    if (!accuracyCircle) {
      accuracyCircle = L.circle([p.lat, p.lng], {
        radius: p.accuracy, color: '#1d4ed8', weight: 1, fillOpacity: 0.12, interactive: false,
      }).addTo(map);
    } else {
      accuracyCircle.setLatLng([p.lat, p.lng]).setRadius(p.accuracy);
      if (!map.hasLayer(accuracyCircle)) accuracyCircle.addTo(map);
    }
  } else if (accuracyCircle) {
    map.removeLayer(accuracyCircle);
  }

  if (move) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 18));
  renderStatus();
  if (captureSheet.open) renderLocCard();
}

function onGpsUpdate() {
  if (gps.last && followGps) {
    setPin({ ...gps.last, source: 'gps' }, { move: centerOnNextFix });
    centerOnNextFix = false;
    if (gps.users.has('startup') && gps.last.accuracy <= accuracyLimit()) gps.stop('startup');
  }
  renderStatus();
  if (captureSheet.open) renderLocCard();
}

function useMyLocation() {
  if (!gps.supported) { toastError('This browser has no location support.'); return; }
  followGps = true;
  centerOnNextFix = true;
  if (gps.last) { setPin({ ...gps.last, source: 'gps' }, { move: true }); centerOnNextFix = false; }
  gps.startFor('locate', 60_000);
  renderStatus();
}

function renderStatus() {
  const dot = $('#status .status-dot');
  const main = $('#status-main');
  const sub = $('#status-sub');
  if (pin && !followGps) {
    dot.dataset.state = 'manual';
    main.textContent = fmtCoords(pin.lat, pin.lng);
    sub.textContent = `${SOURCE_LABELS[pin.source]} · tap ⌖ for GPS`;
    return;
  }
  if (gps.last) {
    const acc = gps.last.accuracy;
    dot.dataset.state = acc <= accuracyLimit() ? 'good' : 'fair';
    main.textContent = fmtCoords(gps.last.lat, gps.last.lng);
    sub.textContent = `GPS ±${acc} m`;
    return;
  }
  if (gps.error && gps.error.code !== 3) {
    dot.dataset.state = 'error';
    main.textContent = 'No location';
    sub.textContent = gpsErrorText(gps.error);
    return;
  }
  dot.dataset.state = 'wait';
  main.textContent = 'Finding your location…';
  sub.textContent = gps.supported ? 'Or tap the map to place a pin' : 'Tap the map to place a pin';
}

async function copyCoords() {
  if (!pin) { toast('No location yet. Tap the map to place a pin.'); return; }
  const text = fmtCoords(pin.lat, pin.lng);
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${text}`);
  } catch {
    toast(text);
  }
}

/* ---------- Saved captures on the map ---------- */

function renderSavedMarkers(records) {
  savedLayer.clearLayers();
  savedMarkers.clear();
  records.forEach((r) => {
    if (!isNum(r.lat) || !isNum(r.lng)) return;
    const m = L.circleMarker([r.lat, r.lng], {
      radius: 8,
      weight: 3,
      color: '#ffffff',
      fillColor: r.exportedAt ? '#15803d' : '#1d4ed8',
      fillOpacity: 1,
      bubblingMouseEvents: false,
    });
    let url = null;
    m.bindPopup(() => {
      if (url) URL.revokeObjectURL(url);
      url = r.thumb ? URL.createObjectURL(r.thumb) : null;
      return h('div', { class: 'map-popup' },
        url ? h('img', { src: url, alt: 'Capture thumbnail' }) : null,
        h('strong', { text: fmtDateTime(r.takenAt || r.createdAt) }),
        h('p', { class: 'coords', text: `${fmtCoords(r.lat, r.lng)}${isNum(r.accuracy) ? ` ±${r.accuracy} m` : ''}` }),
        r.desc ? h('p', { text: r.desc }) : null,
        h('p', { text: r.exportedAt ? `Exported ${fmtDateTime(r.exportedAt)}` : 'Not exported yet' }),
      );
    }, { maxWidth: 240 });
    m.on('popupclose', () => { if (url) { URL.revokeObjectURL(url); url = null; } });
    m.addTo(savedLayer);
    savedMarkers.set(r.id, m);
  });
}

/* =========================================================================
   Capture sheet
   ========================================================================= */

const captureSheet = $('#capture-sheet');
const video = $('#video');
const still = $('#still');

const cap = {
  mode: 'camera',          // camera | gallery
  stream: null,
  token: 0,                // cancels stale camera starts
  facing: settings.camera, // requested facing
  facingKnown: false,      // true when the browser reports facingMode (phones)
  deviceId: null,          // used to cycle cameras on desktops
  image: null,             // Blob/File waiting to be saved
  imageInfo: null,         // {from, takenAt, exif}
  stillUrl: null,
  locMode: 'live',         // live | pin | exif
  override: false,         // user accepted a less accurate fix
  inbox: [],               // files waiting (multi-select or shared into the app)
};

function openCapture(mode = 'camera') {
  openSheet(captureSheet);
  cap.override = false;
  cap.locMode = pin && !followGps ? 'pin' : 'live';
  gps.start('capture');
  loadScript('vendor/piexif.min.js').catch(() => {}); // warm up; used on save
  setCaptureMode(mode);
}

function setCaptureMode(mode) {
  cap.mode = mode;
  $('#tab-camera').setAttribute('aria-selected', String(mode === 'camera'));
  $('#tab-gallery').setAttribute('aria-selected', String(mode === 'gallery'));
  clearStill();
  if (mode === 'camera') {
    startCamera();
  } else {
    stopCamera();
    if (cap.inbox.length) loadNextFromInbox();
    else showGalleryPrompt();
  }
  renderLocCard();
  renderSaveState();
}

function showViewerMessage(text, actions = []) {
  $('#viewer-msg-text').textContent = text;
  const box = $('#viewer-msg-actions');
  box.replaceChildren(...actions.map(([label, fn]) => h('button', { class: 'pill-btn', type: 'button', text: label, onclick: fn })));
  $('#viewer-msg').hidden = false;
}
const hideViewerMessage = () => { $('#viewer-msg').hidden = true; };

function showGalleryPrompt() {
  $('#cam-controls').hidden = true;
  $('#still-controls').hidden = true;
  video.hidden = true;
  showViewerMessage('Choose one or more photos. If a photo has location data, GeoTag uses it.', [
    ['Choose photos', () => $('#file-gallery').click()],
  ]);
}

/* ---------- Camera ---------- */

async function openStream() {
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const attempts = [];
  if (cap.deviceId) attempts.push({ ...size, deviceId: { exact: cap.deviceId } });
  attempts.push(
    { ...size, facingMode: { exact: cap.facing } },
    { ...size, facingMode: { ideal: cap.facing } },
    { facingMode: { ideal: cap.facing } },
    true,
  );
  let lastErr;
  for (const videoConstraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    } catch (err) {
      lastErr = err;
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') throw err;
    }
  }
  throw lastErr;
}

async function startCamera() {
  stopCamera();
  const token = ++cap.token;
  video.hidden = false;
  $('#cam-controls').hidden = false;
  $('#still-controls').hidden = true;
  $('#btn-shutter').disabled = true;
  hideViewerMessage();

  const nativeOnly = [['Use phone camera', () => openNativeCamera()]];
  if (!navigator.mediaDevices?.getUserMedia) {
    showViewerMessage('This browser can’t show a live camera here. Use your phone’s camera app instead.', nativeOnly);
    return;
  }

  try {
    const stream = await openStream();
    if (token !== cap.token || !captureSheet.open || cap.mode !== 'camera') {
      stream.getTracks().forEach((t) => t.stop()); // sheet closed while we waited
      return;
    }
    cap.stream = stream;
    video.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    const s = track.getSettings ? track.getSettings() : {};
    cap.facingKnown = !!s.facingMode;
    if (s.facingMode) cap.facing = s.facingMode;
    // Phones: remember the facing (front/back). Desktops without facing info: remember the device to cycle from.
    cap.deviceId = cap.facingKnown ? null : (s.deviceId || null);
    // Mirror the preview for selfie cameras (and laptop webcams) so movement feels natural.
    const isFront = s.facingMode ? s.facingMode === 'user' : !matchMedia('(pointer: coarse)').matches;
    video.classList.toggle('mirror', isFront);
    await video.play().catch(() => {});
    $('#btn-shutter').disabled = false;
    updateFlipButton();
  } catch (err) {
    if (token !== cap.token) return;
    const msg = {
      NotAllowedError: 'Camera access is blocked. Allow it in your browser’s site settings, or use the phone camera app.',
      SecurityError: 'The camera only works when the app is opened over HTTPS.',
      NotFoundError: 'No camera was found on this device.',
      NotReadableError: 'Another app is using the camera. Close it and try again.',
      OverconstrainedError: 'This camera isn’t available. Try the other camera or the phone camera app.',
    }[err.name] || `The camera couldn’t start (${err.message || err.name}).`;
    showViewerMessage(msg, [['Try again', () => startCamera()], ...nativeOnly]);
  }
}

function stopCamera() {
  cap.token++;
  if (cap.stream) cap.stream.getTracks().forEach((t) => t.stop());
  cap.stream = null;
  video.srcObject = null;
}

async function updateFlipButton() {
  const btn = $('#btn-flip');
  let count = 0;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    count = devices.filter((d) => d.kind === 'videoinput').length;
  } catch { /* ignore */ }
  btn.hidden = count < 2;
  const next = cap.facingKnown ? (cap.facing === 'user' ? 'back' : 'front') : 'next';
  btn.setAttribute('aria-label', `Switch to ${next} camera`);
  btn.title = `Switch to ${next} camera`;
}

async function flipCamera() {
  if (cap.facingKnown) {
    // Phones: switch between the front (selfie) and back cameras
    cap.facing = cap.facing === 'user' ? 'environment' : 'user';
    cap.deviceId = null;
  } else {
    // Desktops: cycle through cameras by id
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const i = cams.findIndex((d) => d.deviceId === cap.deviceId);
    cap.deviceId = cams[(i + 1) % cams.length]?.deviceId || null;
  }
  startCamera();
}

async function takePhoto() {
  if (!video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  // Saved photo is not mirrored, so text and signs in the shot read correctly.
  canvas.getContext('2d').drawImage(video, 0, 0);
  const flash = $('#flash');
  flash.classList.remove('go');
  void flash.offsetWidth;
  flash.classList.add('go');
  navigator.vibrate?.(30);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  stopCamera();
  setStill(blob, { from: 'camera', takenAt: Date.now() });
}

function openNativeCamera() {
  const input = $('#file-native');
  input.setAttribute('capture', cap.facing === 'user' ? 'user' : 'environment');
  input.click();
}

/* ---------- Still image ---------- */

function setStill(blob, info) {
  clearStill();
  cap.image = blob;
  cap.imageInfo = info;
  cap.stillUrl = URL.createObjectURL(blob);
  video.hidden = true;
  hideViewerMessage();
  still.hidden = false;
  still.onerror = () => {
    still.hidden = true;
    showViewerMessage('No preview for this photo format, but it will still be saved.', []);
  };
  still.src = cap.stillUrl;
  $('#cam-controls').hidden = true;
  $('#still-controls').hidden = false;
  $('#btn-retake').textContent = info.from === 'gallery' ? 'Choose another' : 'Retake';
  renderLocCard();
  renderSaveState();
}

function clearStill() {
  if (cap.stillUrl) URL.revokeObjectURL(cap.stillUrl);
  cap.stillUrl = null;
  cap.image = null;
  cap.imageInfo = null;
  still.removeAttribute('src');
  still.hidden = true;
  if (cap.locMode === 'exif') cap.locMode = pin && !followGps ? 'pin' : 'live';
}

function retake() {
  if (cap.imageInfo?.from === 'gallery') {
    $('#file-gallery').click();
  } else {
    clearStill();
    startCamera();
    renderSaveState();
  }
}

async function useGalleryFile(file) {
  setStill(file, { from: 'gallery', takenAt: file.lastModified || Date.now() });
  cap.locMode = pin && !followGps ? 'pin' : 'live';
  try {
    await loadScript('vendor/exifr-lite.umd.js');
    const [gpsData, meta] = await Promise.all([
      window.exifr.gps(file).catch(() => null),
      window.exifr.parse(file, ['DateTimeOriginal']).catch(() => null),
    ]);
    if (cap.image !== file) return; // user moved on
    if (meta?.DateTimeOriginal instanceof Date) cap.imageInfo.takenAt = meta.DateTimeOriginal.getTime();
    if (gpsData && isNum(gpsData.latitude) && isNum(gpsData.longitude)) {
      cap.imageInfo.exif = { lat: gpsData.latitude, lng: gpsData.longitude };
      cap.locMode = 'exif';
    }
  } catch (err) {
    console.warn('EXIF read failed', err);
  }
  renderLocCard();
  renderSaveState();
}

function loadNextFromInbox() {
  const file = cap.inbox.shift();
  renderInboxNote();
  if (file) useGalleryFile(file);
}

function renderInboxNote() {
  const note = $('#inbox-note');
  note.hidden = !cap.inbox.length;
  note.textContent = cap.inbox.length === 1 ? '1 more photo after this one.' : `${cap.inbox.length} more photos after this one.`;
}

/* ---------- Location for the capture ---------- */

function captureLocation() {
  if (cap.locMode === 'exif' && cap.imageInfo?.exif) {
    return { ...cap.imageInfo.exif, accuracy: null, source: 'exif', timestamp: cap.imageInfo.takenAt };
  }
  if (cap.locMode === 'pin' && pin) return { ...pin };
  if (gps.last) return { ...gps.last, source: 'gps' };
  return null;
}

function renderLocCard() {
  const card = $('#loc-card');
  const title = $('#loc-title');
  const sub = $('#loc-sub');
  const actions = [];
  const hasManualPin = pin && pin.source !== 'gps';
  const hasExif = !!cap.imageInfo?.exif;

  if (cap.locMode === 'exif' && hasExif) {
    const e = cap.imageInfo.exif;
    card.dataset.state = 'good';
    title.textContent = 'Location from the photo';
    sub.textContent = `${fmtCoords(e.lat, e.lng)} · taken ${fmtDateTime(cap.imageInfo.takenAt)}`;
    actions.push(['Use live GPS', () => setLocMode('live')]);
    if (hasManualPin) actions.push(['Use map pin', () => setLocMode('pin')]);
  } else if (cap.locMode === 'pin' && pin) {
    card.dataset.state = 'manual';
    title.textContent = pin.source === 'search' ? 'Search result' : pin.source === 'gps' ? 'GPS position' : 'Map pin';
    sub.textContent = fmtCoords(pin.lat, pin.lng);
    actions.push(['Use live GPS', () => setLocMode('live')]);
    if (hasExif) actions.push(['Use photo location', () => setLocMode('exif')]);
  } else if (gps.last) {
    const acc = gps.last.accuracy;
    const ok = acc <= accuracyLimit() || cap.override;
    card.dataset.state = ok ? 'good' : 'fair';
    title.textContent = ok ? `GPS ±${acc} m` : `Improving GPS: ±${acc} m`;
    sub.textContent = ok ? fmtCoords(gps.last.lat, gps.last.lng) : `Waiting for ±${settings.accuracy} m or better`;
    if (!ok) actions.push(['Use anyway', () => { cap.override = true; renderLocCard(); renderSaveState(); }]);
    if (hasManualPin) actions.push(['Use map pin', () => setLocMode('pin')]);
    if (hasExif) actions.push(['Use photo location', () => setLocMode('exif')]);
  } else {
    const blocked = gps.error && gps.error.code !== 3;
    card.dataset.state = blocked ? 'error' : 'wait';
    title.textContent = blocked ? 'No GPS' : 'Waiting for GPS…';
    sub.textContent = blocked ? gpsErrorText(gps.error) : 'Stand in the open for a faster fix.';
    if (hasManualPin) actions.push(['Use map pin', () => setLocMode('pin')]);
    else if (blocked) sub.textContent += ' Or close this and tap the map to place a pin.';
    if (hasExif) actions.push(['Use photo location', () => setLocMode('exif')]);
  }

  $('#loc-actions').replaceChildren(
    ...actions.map(([label, fn]) => h('button', { type: 'button', text: label, onclick: fn })),
  );
  renderSaveState();
}

function setLocMode(mode) {
  cap.locMode = mode;
  cap.override = false;
  renderLocCard();
}

function saveBlocker() {
  if (!cap.image) return cap.mode === 'camera' ? 'Take a photo to save' : 'Choose a photo to save';
  const loc = captureLocation();
  if (!loc) return 'Waiting for location…';
  if (loc.source === 'gps' && cap.locMode === 'live' && loc.accuracy > accuracyLimit() && !cap.override) {
    return `Waiting for GPS (±${loc.accuracy} m)`;
  }
  return '';
}

let saving = false;
function renderSaveState() {
  const btn = $('#btn-save');
  if (saving) return;
  const reason = saveBlocker();
  btn.disabled = !!reason;
  btn.textContent = reason || 'Save capture';
}

async function saveCapture() {
  if (saveBlocker() || saving) return;
  saving = true;
  const btn = $('#btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const loc = captureLocation();
  const createdAt = Date.now();
  const takenAt = cap.imageInfo?.takenAt || createdAt;
  const phone = $('#f-phone').value.trim();
  const desc = $('#f-desc').value.trim();
  const original = cap.image;

  try {
    let blob = original;
    let thumb = null;
    let width = null;
    let height = null;
    try {
      const out = await processImage(original, { loc, takenAt, desc });
      ({ blob, thumb, width, height } = out);
    } catch (err) {
      // e.g. HEIC on browsers that can't decode it: keep the original file untouched
      console.warn('Image processing skipped:', err);
    }

    const record = {
      id: uuid(),
      lat: loc.lat,
      lng: loc.lng,
      accuracy: isNum(loc.accuracy) ? loc.accuracy : null,
      source: loc.source,
      phone,
      desc,
      createdAt,
      takenAt,
      mime: blob.type || original.type || 'image/jpeg',
      width,
      height,
      thumb,
      exportedAt: null,
    };
    await store.add(record, blob);

    const first = !localStorage.getItem('geotag.saved');
    try { localStorage.setItem('geotag.saved', '1'); } catch { /* ignore */ }
    if (first) requestPersistence();

    toast('Capture saved');
    $('#f-desc').value = '';
    clearStill();
    await refreshCaptures();

    if (cap.inbox.length) {
      loadNextFromInbox();
    } else {
      captureSheet.close();
    }
  } catch (err) {
    console.error(err);
    if (err?.name === 'QuotaExceededError') toastError('Storage is full. Export and clear some captures, then try again.');
    else toastError(`Couldn’t save the capture: ${err?.message || err}`);
  } finally {
    saving = false;
    renderSaveState();
  }
}

/* =========================================================================
   Image processing: resize, stamp, EXIF GPS, thumbnail
   ========================================================================= */

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type, quality);
  });
}

async function decodeImage(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function processImage(file, { loc, takenAt, desc }) {
  const src = await decodeImage(file);
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  const limit = settings.maxSize > 0 ? settings.maxSize : Infinity;
  const scale = Math.min(1, limit / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const hgt = Math.round(sh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, hgt);
  if (settings.watermark) drawStamp(ctx, w, hgt, { loc, takenAt, desc });

  let blob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
  try { blob = await writeExif(blob, { loc, takenAt, desc }); } catch (err) { console.warn('EXIF write failed', err); }

  const thumb = await makeThumb(src, sw, sh);
  src.close?.();
  return { blob, thumb, width: w, height: hgt };
}

async function makeThumb(src, sw, sh, size = 192) {
  const s = size / Math.min(sw, sh);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const dw = sw * s;
  const dh = sh * s;
  ctx.drawImage(src, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return canvasToBlob(canvas, 'image/jpeg', 0.75);
}

function drawStamp(ctx, w, hgt, { loc, takenAt, desc }) {
  const fs = Math.max(14, Math.round(Math.min(w, hgt) * 0.032));
  const pad = Math.round(fs * 0.7);
  const lineH = Math.round(fs * 1.35);
  const maxW = w - pad * 2;
  const fit = (text, font) => {
    ctx.font = font;
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  };

  const bold = `700 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const regular = `400 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const acc = isNum(loc.accuracy) ? `  ±${loc.accuracy} m` : '';
  const lines = [
    [fit(`${fmtCoords(loc.lat, loc.lng)}${acc}`, bold), bold],
    [fit(`${fmtDateTime(takenAt)}  ·  ${SOURCE_LABELS[loc.source] || ''}`, regular), regular],
  ];
  if (desc) lines.push([fit(desc.split('\n')[0], regular), regular]);

  const boxH = pad * 2 + lineH * lines.length;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
  ctx.fillRect(0, hgt - boxH, w, boxH);
  ctx.fillStyle = '#facc15';
  ctx.fillRect(0, hgt - boxH, Math.max(4, Math.round(fs * 0.25)), boxH);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  lines.forEach(([text, font], i) => {
    ctx.font = font;
    ctx.fillText(text, pad, hgt - boxH + pad + i * lineH + (lineH - fs) / 2);
  });
}

function blobToBinaryString(blob) {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return out;
  });
}

function binaryStringToBlob(str, type) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function writeExif(jpegBlob, { loc, takenAt, desc }) {
  await loadScript('vendor/piexif.min.js');
  const P = window.piexif;
  const toDMS = (v) => {
    v = Math.abs(v);
    const d = Math.floor(v);
    const mFloat = (v - d) * 60;
    const m = Math.floor(mFloat);
    const s = Math.round((mFloat - m) * 60 * 10000);
    return [[d, 1], [m, 1], [s, 10000]];
  };
  const p2 = (n) => String(n).padStart(2, '0');
  const t = new Date(takenAt);
  const local = `${t.getFullYear()}:${p2(t.getMonth() + 1)}:${p2(t.getDate())} ${p2(t.getHours())}:${p2(t.getMinutes())}:${p2(t.getSeconds())}`;
  const utcDate = `${t.getUTCFullYear()}:${p2(t.getUTCMonth() + 1)}:${p2(t.getUTCDate())}`;

  const zeroth = {
    [P.ImageIFD.Software]: `GeoTag ${APP_VERSION}`,
    [P.ImageIFD.DateTime]: local,
  };
  // EXIF ASCII fields can't hold other scripts; non-ASCII notes stay in the CSV/GeoJSON/KML instead.
  if (desc && /^[\x20-\x7E\r\n\t]*$/.test(desc)) zeroth[P.ImageIFD.ImageDescription] = desc.slice(0, 1000);

  const gpsIfd = {
    [P.GPSIFD.GPSVersionID]: [2, 3, 0, 0],
    [P.GPSIFD.GPSLatitudeRef]: loc.lat >= 0 ? 'N' : 'S',
    [P.GPSIFD.GPSLatitude]: toDMS(loc.lat),
    [P.GPSIFD.GPSLongitudeRef]: loc.lng >= 0 ? 'E' : 'W',
    [P.GPSIFD.GPSLongitude]: toDMS(loc.lng),
    [P.GPSIFD.GPSMapDatum]: 'WGS-84',
    [P.GPSIFD.GPSDateStamp]: utcDate,
    [P.GPSIFD.GPSTimeStamp]: [[t.getUTCHours(), 1], [t.getUTCMinutes(), 1], [t.getUTCSeconds(), 1]],
  };
  if (isNum(loc.accuracy)) gpsIfd[P.GPSIFD.GPSHPositioningError] = [Math.round(loc.accuracy * 100), 100];

  const exifBytes = P.dump({
    '0th': zeroth,
    Exif: { [P.ExifIFD.DateTimeOriginal]: local, [P.ExifIFD.DateTimeDigitized]: local },
    GPS: gpsIfd,
  });
  const out = P.insert(exifBytes, await blobToBinaryString(jpegBlob));
  return binaryStringToBlob(out, 'image/jpeg');
}

/** Captures saved by v1 have no thumbnail; build them once in the background. */
async function backfillThumbs(records) {
  const todo = records.filter((r) => r.needsThumb);
  if (!todo.length) return;
  for (const r of todo) {
    try {
      const blob = await store.image(r.id);
      if (blob) {
        const src = await decodeImage(blob);
        r.thumb = await makeThumb(src, src.width || src.naturalWidth, src.height || src.naturalHeight);
        src.close?.();
      }
    } catch (err) { console.warn('Thumbnail failed for', r.id, err); }
    delete r.needsThumb;
  }
  await store.putMany(todo);
  refreshCaptures();
}

/* =========================================================================
   Captures list
   ========================================================================= */

const queueSheet = $('#queue-sheet');
let records = [];
let thumbUrls = [];

async function refreshCaptures() {
  try {
    records = await store.all();
  } catch (err) {
    console.error(err);
    toastError('Couldn’t read saved captures. Your browser may be blocking storage.');
    return;
  }
  const pending = records.filter((r) => !r.exportedAt).length;
  const badge = $('#queue-badge');
  badge.hidden = pending === 0;
  badge.textContent = pending > 99 ? '99+' : String(pending);
  $('#btn-queue').setAttribute('aria-label', `Captures, ${pending} not exported`);
  if (map) renderSavedMarkers(records);
  if (queueSheet.open) renderQueueList();
}

function renderQueueList() {
  thumbUrls.forEach((u) => URL.revokeObjectURL(u));
  thumbUrls = [];
  const list = $('#queue-list');
  const pending = records.filter((r) => !r.exportedAt).length;
  const exported = records.length - pending;

  $('#queue-summary').textContent = records.length
    ? `${pending} not exported${exported ? `, ${exported} exported` : ''}`
    : '';
  $('#queue-toolbar').hidden = records.length === 0;
  $('#btn-export').textContent = pending ? `Export ${pending} capture${pending === 1 ? '' : 's'}` : 'Export again';
  $('#btn-clear-exported').hidden = exported === 0;

  if (!records.length) {
    list.replaceChildren(h('li', { class: 'empty' },
      h('p', { text: 'No captures yet. Take a photo and it will be kept here, even offline, until you export it.' }),
      h('button', { class: 'primary-btn', type: 'button', text: 'New capture', onclick: () => { queueSheet.close(); openCapture('camera'); } }),
    ));
    return;
  }

  list.replaceChildren(...records.map((r) => {
    let thumb;
    if (r.thumb) {
      const url = URL.createObjectURL(r.thumb);
      thumbUrls.push(url);
      thumb = h('img', { class: 'queue-thumb', src: url, alt: '', loading: 'lazy' });
    } else {
      thumb = h('div', { class: 'queue-thumb queue-thumb--empty' }, icon('image'));
    }
    const coords = isNum(r.lat)
      ? `${fmtCoords(r.lat, r.lng)}${isNum(r.accuracy) ? ` ±${r.accuracy} m` : ''} · ${SOURCE_LABELS[r.source] || ''}`
      : 'No location';
    const canShare = supportsFileShare();

    return h('li', { class: 'queue-item' },
      thumb,
      h('div', { class: 'qi-body' },
        h('div', { class: 'qi-top' },
          h('span', { class: 'qi-time', text: fmtDateTime(r.takenAt || r.createdAt) }),
          h('span', { class: `qi-tag${r.exportedAt ? ' qi-tag--done' : ''}`, text: r.exportedAt ? 'Exported' : 'Not exported' }),
        ),
        h('span', { class: 'qi-coords', text: coords }),
        r.phone ? h('span', { class: 'qi-coords', text: r.phone }) : null,
        r.desc ? h('p', { class: 'qi-desc', text: r.desc }) : null,
        h('div', { class: 'qi-actions' },
          h('button', { type: 'button', 'aria-label': 'Show on map', onclick: () => showOnMap(r.id) }, icon('pin'), 'Map'),
          h('button', { type: 'button', onclick: () => exportSingle(r) }, icon(canShare ? 'share' : 'download'), canShare ? 'Share' : 'Download'),
          h('button', { type: 'button', class: 'danger', onclick: () => deleteCaptures([r.id]) }, icon('trash'), 'Delete'),
        ),
      ),
    );
  }));
}

function showOnMap(id) {
  const m = savedMarkers.get(id);
  queueSheet.close();
  if (!m) return;
  map.setView(m.getLatLng(), Math.max(map.getZoom(), 17));
  setTimeout(() => m.openPopup(), 250);
}

async function deleteCaptures(ids, message) {
  try {
    const removed = await store.remove(ids);
    await refreshCaptures();
    toast(message || (removed.length === 1 ? 'Capture deleted' : `${removed.length} captures deleted`), {
      action: 'Undo',
      duration: 7000,
      onAction: async () => {
        await store.restore(removed);
        await refreshCaptures();
        toast('Restored');
      },
    });
  } catch (err) {
    toastError(`Couldn’t delete: ${err.message || err}`);
  }
}

/* =========================================================================
   Export: folder (desktop Chromium), ZIP (everywhere), share sheet (phones)
   ========================================================================= */

const exportSheet = $('#export-sheet');

function supportsFileShare() {
  try {
    return !!navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.jpg', { type: 'image/jpeg' })] });
  } catch { return false; }
}

function fileNameFor(r) {
  return `GT_${stamp(r.takenAt || r.createdAt)}_${r.id.slice(0, 6)}.${extFor(r.mime)}`;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const xml = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

function buildManifests(recs) {
  const header = ['id', 'file', 'taken_at', 'saved_at', 'latitude', 'longitude', 'accuracy_m', 'location_source', 'phone', 'description'];
  const rows = recs.map((r) => [
    r.id, `images/${fileNameFor(r)}`, new Date(r.takenAt || r.createdAt).toISOString(), new Date(r.createdAt).toISOString(),
    isNum(r.lat) ? fmtCoord(r.lat) : '', isNum(r.lng) ? fmtCoord(r.lng) : '', r.accuracy ?? '', r.source, r.phone, r.desc,
  ]);
  // BOM so Excel opens UTF-8 (Assamese, Hindi, Bengali notes) correctly
  const csv = '\ufeff' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');

  const geojson = JSON.stringify({
    type: 'FeatureCollection',
    features: recs.filter((r) => isNum(r.lat)).map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [+fmtCoord(r.lng), +fmtCoord(r.lat)] },
      properties: {
        id: r.id, file: `images/${fileNameFor(r)}`, taken_at: new Date(r.takenAt || r.createdAt).toISOString(),
        accuracy_m: r.accuracy, location_source: r.source, phone: r.phone, description: r.desc,
      },
    })),
  }, null, 2);

  const placemarks = recs.filter((r) => isNum(r.lat)).map((r) => `  <Placemark>
    <name>${xml(fmtDateTime(r.takenAt || r.createdAt))}</name>
    <description><![CDATA[<img src="images/${fileNameFor(r)}" width="400"><br>${xml(r.desc)}<br>${xml(r.phone)}]]></description>
    <TimeStamp><when>${new Date(r.takenAt || r.createdAt).toISOString()}</when></TimeStamp>
    <Point><coordinates>${fmtCoord(r.lng)},${fmtCoord(r.lat)},0</coordinates></Point>
  </Placemark>`).join('\n');
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>GeoTag export</name>
${placemarks}
</Document>
</kml>
`;
  return [
    { path: 'captures.csv', blob: new Blob([csv], { type: 'text/csv' }) },
    { path: 'captures.geojson', blob: new Blob([geojson], { type: 'application/geo+json' }) },
    { path: 'captures.kml', blob: new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }) },
  ];
}

async function collectFiles(recs, progress) {
  const files = [];
  for (let i = 0; i < recs.length; i++) {
    progress?.(`Reading photos ${i + 1} of ${recs.length}…`);
    const blob = await store.image(recs[i].id);
    if (blob) files.push({ path: `images/${fileNameFor(recs[i])}`, blob, record: recs[i] });
  }
  return [...files, ...buildManifests(recs)];
}

function exportScope() {
  const scope = exportSheet.querySelector('input[name="scope"]:checked')?.value;
  return scope === 'all' ? records : records.filter((r) => !r.exportedAt);
}

async function markExported(recs) {
  const now = Date.now();
  recs.forEach((r) => { r.exportedAt = now; });
  await store.putMany(recs);
  await refreshCaptures();
}

function openExport() {
  const pending = records.filter((r) => !r.exportedAt).length;
  $('#scope-pending').textContent = `Not yet exported (${pending})`;
  $('#scope-all').textContent = `All captures (${records.length})`;
  exportSheet.querySelector(`input[value="${pending ? 'pending' : 'all'}"]`).checked = true;
  $('#exp-folder').hidden = !('showDirectoryPicker' in window);
  $('#exp-share').hidden = !supportsFileShare();
  resetShareButton();
  openSheet(exportSheet);
}

function exportBase() {
  return `GeoTag_${stamp(Date.now())}`;
}

async function exportToFolder() {
  const recs = exportScope();
  if (!recs.length) { toast('Nothing to export.'); return; }
  let root;
  try {
    root = await window.showDirectoryPicker({ id: 'geotag-export', mode: 'readwrite', startIn: 'downloads' });
  } catch (err) {
    if (err.name !== 'AbortError') toastError(`Couldn’t open the folder: ${err.message}`);
    return;
  }
  const t = toast('Preparing export…', { duration: 0 });
  try {
    const files = await collectFiles(recs, t.update);
    const base = await root.getDirectoryHandle(exportBase(), { create: true });
    const imagesDir = await base.getDirectoryHandle('images', { create: true });
    let n = 0;
    for (const f of files) {
      t.update(`Writing ${++n} of ${files.length}…`);
      const [dirName, fileName] = f.path.includes('/') ? f.path.split('/') : [null, f.path];
      const dir = dirName ? imagesDir : base;
      const handle = await dir.getFileHandle(fileName, { create: true });
      const writer = await handle.createWritable();
      await writer.write(f.blob);
      await writer.close();
    }
    t.close();
    await markExported(recs);
    exportSheet.close();
    toast(`Exported ${recs.length} capture${recs.length === 1 ? '' : 's'} to “${root.name}”`);
  } catch (err) {
    t.close();
    console.error(err);
    toastError(`Export stopped: ${err.message || err}. Nothing was marked as exported.`);
  }
}

async function exportZip() {
  const recs = exportScope();
  if (!recs.length) { toast('Nothing to export.'); return; }
  const t = toast('Preparing ZIP…', { duration: 0 });
  try {
    await loadScript('vendor/jszip.min.js');
    const files = await collectFiles(recs, t.update);
    const base = exportBase();
    const zip = new window.JSZip();
    const folder = zip.folder(base);
    files.forEach((f) => {
      const already = /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(f.path);
      folder.file(f.path, f.blob, { compression: already ? 'STORE' : 'DEFLATE' });
    });
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (meta) => {
      t.update(`Building ZIP… ${Math.round(meta.percent)}%`);
    });
    t.close();
    downloadBlob(blob, `${base}.zip`);
    await markExported(recs);
    exportSheet.close();
    toast(`Downloaded ${base}.zip (${fmtBytes(blob.size)})`);
  } catch (err) {
    t.close();
    console.error(err);
    toastError(`Couldn’t build the ZIP: ${err.message || err}`);
  }
}

/* Sharing needs a fresh tap: reading photos can take longer than the browser allows
   between a tap and navigator.share(), so we prepare first, then ask for one more tap. */
let preparedShare = null;

function resetShareButton() {
  preparedShare = null;
  const btn = $('#exp-share');
  btn.classList.remove('ready');
  btn.querySelector('strong').textContent = 'Share';
  btn.querySelector('small').textContent = 'Send photos and CSV to WhatsApp, Drive, email…';
}

async function exportShare() {
  if (preparedShare) {
    const { files, recs } = preparedShare;
    try {
      await navigator.share({ files, title: 'GeoTag captures' });
      await markExported(recs);
      exportSheet.close();
      toast(`Shared ${recs.length} capture${recs.length === 1 ? '' : 's'}`);
    } catch (err) {
      if (err.name !== 'AbortError') toastError(`Sharing failed: ${err.message}. Try “Download ZIP” instead.`);
    }
    resetShareButton();
    return;
  }

  const recs = exportScope();
  if (!recs.length) { toast('Nothing to export.'); return; }
  const btn = $('#exp-share');
  btn.querySelector('small').textContent = 'Preparing…';
  try {
    const collected = await collectFiles(recs);
    const all = collected.map((f) => new File([f.blob], f.path.split('/').pop(), { type: f.blob.type || 'application/octet-stream' }));
    const photosOnly = all.filter((f) => f.type.startsWith('image/'));
    const photosAndCsv = all.filter((f) => f.type.startsWith('image/') || f.name.endsWith('.csv'));
    const files = [all, photosAndCsv, photosOnly].find((set) => {
      try { return navigator.canShare({ files: set }); } catch { return false; }
    });
    if (!files) {
      resetShareButton();
      toastError('These files are too large to share from here. Use “Download ZIP” instead.');
      return;
    }
    preparedShare = { files, recs };
    btn.classList.add('ready');
    btn.querySelector('strong').textContent = `Share ${files.length} file${files.length === 1 ? '' : 's'} now`;
    btn.querySelector('small').textContent = files === all
      ? 'Photos, CSV, GeoJSON and KML are ready'
      : files === photosAndCsv ? 'Photos and CSV are ready. Use ZIP to include GeoJSON and KML.' : 'Photos are ready. Use ZIP to include the CSV.';
    btn.focus();
  } catch (err) {
    resetShareButton();
    toastError(`Couldn’t prepare files: ${err.message || err}`);
  }
}

async function exportSingle(r) {
  try {
    const blob = await store.image(r.id);
    if (!blob) { toastError('This capture’s photo is missing.'); return; }
    const file = new File([blob], fileNameFor(r), { type: blob.type || r.mime || 'image/jpeg' });
    const text = [
      isNum(r.lat) ? `${fmtCoords(r.lat, r.lng)}${isNum(r.accuracy) ? ` (±${r.accuracy} m)` : ''}` : '',
      isNum(r.lat) ? `https://www.google.com/maps?q=${r.lat},${r.lng}` : '',
      r.desc, r.phone,
    ].filter(Boolean).join('\n');

    if (supportsFileShare() && navigator.canShare({ files: [file] })) {
      const share = () => navigator.share({ files: [file], text });
      try {
        await share();
      } catch (err) {
        if (err.name !== 'NotAllowedError') throw err;
        // The tap "expired" while we read the photo: ask for one more tap
        await new Promise((resolve, reject) => {
          toast('Photo ready.', {
            action: 'Share',
            duration: 10000,
            onAction: () => share().then(resolve, reject),
            onTimeout: () => reject(new DOMException('Share timed out', 'AbortError')),
          });
        });
      }
    } else {
      downloadBlob(file, file.name);
    }
    await markExported([r]);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    toastError(`Couldn’t share: ${err.message || err}`);
  }
}

/* =========================================================================
   Settings sheet
   ========================================================================= */

const settingsSheet = $('#settings-sheet');

async function openSettings() {
  $('#s-accuracy').value = String(settings.accuracy);
  $('#s-camera').value = settings.camera;
  $('#s-size').value = String(settings.maxSize);
  $('#s-watermark').checked = settings.watermark;
  $('#version').textContent = `GeoTag ${APP_VERSION}`;
  openSheet(settingsSheet);
  renderStorageInfo();
}

async function renderStorageInfo() {
  const info = $('#storage-info');
  const btn = $('#btn-persist');
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    const used = est ? `${fmtBytes(est.usage)} used of about ${fmtBytes(est.quota)} available.` : '';
    info.textContent = `${records.length} capture${records.length === 1 ? '' : 's'} saved. ${used} ${persisted
      ? 'Captures are protected from automatic cleanup.'
      : 'The browser may clear captures if the device runs low on space.'}`;
    btn.hidden = !!persisted || !navigator.storage?.persist;
  } catch {
    info.textContent = `${records.length} captures saved.`;
    btn.hidden = true;
  }
}

function wireSettings() {
  $('#s-accuracy').addEventListener('change', (e) => { settings.accuracy = +e.target.value; saveSettings(); renderStatus(); });
  $('#s-camera').addEventListener('change', (e) => { settings.camera = e.target.value; cap.facing = settings.camera; cap.deviceId = null; saveSettings(); });
  $('#s-size').addEventListener('change', (e) => { settings.maxSize = +e.target.value; saveSettings(); });
  $('#s-watermark').addEventListener('change', (e) => { settings.watermark = e.target.checked; saveSettings(); });
  $('#btn-persist').addEventListener('click', async () => {
    const ok = await requestPersistence();
    toast(ok ? 'Captures are now protected from automatic cleanup.' : 'The browser declined. Installing GeoTag to your home screen usually allows it.');
    renderStorageInfo();
  });
}

/* =========================================================================
   Service worker + updates
   ========================================================================= */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  const promptUpdate = (worker) => {
    toast('A new version of GeoTag is ready.', {
      action: 'Reload',
      duration: 0,
      onAction: () => worker.postMessage({ type: 'SKIP_WAITING' }),
    });
  };

  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting && hadController) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(worker);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((err) => console.warn('Service worker registration failed', err));
}

/** Photos shared into GeoTag from the gallery arrive via the service worker (manifest share_target). */
async function takeSharedFiles() {
  if (!('caches' in window)) return [];
  const cache = await caches.open('geotag-share-inbox');
  const keys = await cache.keys();
  const files = [];
  for (const req of keys) {
    const res = await cache.match(req);
    if (res) {
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('X-Filename') || 'shared.jpg');
      files.push(new File([blob], name, { type: blob.type, lastModified: Date.now() }));
    }
    await cache.delete(req);
  }
  return files;
}

/* =========================================================================
   Startup
   ========================================================================= */

function wireUi() {
  hydrateIcons();
  [captureSheet, queueSheet, exportSheet, settingsSheet].forEach(wireSheet);

  $('#status').addEventListener('click', copyCoords);
  $('#btn-capture').addEventListener('click', () => openCapture('camera'));
  $('#btn-queue').addEventListener('click', () => { openSheet(queueSheet); renderQueueList(); });
  $('#btn-settings').addEventListener('click', openSettings);

  $('#tab-camera').addEventListener('click', () => { if (cap.mode !== 'camera') setCaptureMode('camera'); });
  $('#tab-gallery').addEventListener('click', () => { if (cap.mode !== 'gallery') setCaptureMode('gallery'); });
  $('#btn-shutter').addEventListener('click', takePhoto);
  $('#btn-flip').addEventListener('click', flipCamera);
  $('#btn-native').addEventListener('click', openNativeCamera);
  $('#btn-retake').addEventListener('click', retake);
  $('#btn-save').addEventListener('click', saveCapture);

  $('#file-native').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    stopCamera();
    setStill(file, { from: 'native', takenAt: Date.now() });
  });
  $('#file-gallery').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    cap.inbox = files;
    if (cap.mode !== 'gallery') setCaptureMode('gallery');
    else loadNextFromInbox();
  });

  captureSheet.addEventListener('close', () => {
    stopCamera();
    clearStill();
    gps.stop('capture');
    cap.inbox = [];
    renderInboxNote();
  });
  queueSheet.addEventListener('close', () => { thumbUrls.forEach((u) => URL.revokeObjectURL(u)); thumbUrls = []; });
  exportSheet.addEventListener('close', resetShareButton);

  $('#btn-export').addEventListener('click', openExport);
  $('#btn-clear-exported').addEventListener('click', () => {
    const ids = records.filter((r) => r.exportedAt).map((r) => r.id);
    if (ids.length) deleteCaptures(ids, `Cleared ${ids.length} exported capture${ids.length === 1 ? '' : 's'}`);
  });
  $('#exp-folder').addEventListener('click', exportToFolder);
  $('#exp-zip').addEventListener('click', exportZip);
  $('#exp-share').addEventListener('click', exportShare);
  exportSheet.querySelectorAll('input[name="scope"]').forEach((i) => i.addEventListener('change', resetShareButton));

  wireSettings();

  window.addEventListener('offline', () => toast('You’re offline. Captures still save, and the map shows areas you’ve already viewed.', { duration: 5000 }));
  window.addEventListener('online', () => toast('Back online.'));
}

async function handleLaunchParams() {
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  const shared = params.has('share');
  if (action || shared) history.replaceState(null, '', location.pathname);

  if (shared) {
    const files = await takeSharedFiles().catch(() => []);
    if (files.length) {
      cap.inbox = files;
      openCapture('gallery');
    } else {
      toast('No photos were received.');
    }
  } else if (action === 'capture') {
    openCapture('camera');
  } else if (action === 'captures') {
    openSheet(queueSheet);
    renderQueueList();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  wireUi();
  try {
    initMap();
  } catch (err) {
    console.error(err);
    toastError('The map couldn’t load. You can still take captures.');
  }
  renderStatus();
  gps.start('startup');
  setTimeout(() => gps.stop('startup'), 90_000);

  await refreshCaptures();
  backfillThumbs(records);
  registerServiceWorker();
  handleLaunchParams();
});
