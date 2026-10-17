/* Street Journey Lite — basemaps, local JSON points, motorcycle ride animation. */
(function () {
  'use strict';

  /* ───────────── Settings & storage ───────────── */
  const KEY = 'sjl.';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(KEY + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(KEY + k); } catch (e) { /* ignore */ } }
  };

  const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const BASEMAPS = {
    carto_voyager: { name: 'CARTO Voyager', url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', sub: 'abcd', attr: OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>', max: 20 },
    carto_light: { name: 'CARTO Positron (light)', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', sub: 'abcd', attr: OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>', max: 20 },
    carto_dark: { name: 'CARTO Dark Matter', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', sub: 'abcd', attr: OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>', max: 20 },
    osm: { name: 'OpenStreetMap — Standard', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: OSM, max: 19 },
    google_street: { name: 'Google Street Map', url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', sub: '0123', attr: 'Map data &copy; Google', max: 20 },
    google_hybrid: { name: 'Google Hybrid Map', url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', sub: '0123', attr: 'Imagery &copy; Google', max: 20 },
    esri_world: { name: 'Esri World Street Map', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles &copy; Esri', max: 19 },
    esri_imagery: { name: 'Esri Satellite Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles &copy; Esri, Maxar, Earthstar Geographics', max: 19 },
    esri_topo: { name: 'Esri Topographic', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles &copy; Esri', max: 19 },
    stadia_smooth: { name: 'Stadia Alidade Smooth', url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', attr: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; OpenMapTiles ' + OSM, max: 20 },
    stadia_dark: { name: 'Stadia Alidade Dark', url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', attr: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; OpenMapTiles ' + OSM, max: 20 },
    topo_osm: { name: 'OpenTopoMap', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', sub: 'abc', attr: OSM + ', SRTM | Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)', max: 17 }
  };

  /* Speed levels as multiples of 60 km/h (16.67 m/s). */
  const SPEEDS = [1, 2, 4, 8, 15, 25, 40, 60, 100, 160, 250];
  const BASE_MPS = 60 / 3.6;
  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const OSRM_CHUNK = 25;

  const $ = (id) => document.getElementById(id);
  const ui = {
    app: $('app'), panel: $('panel'), panelBtn: $('panelBtn'),
    play: $('playBtn'), restart: $('restartBtn'), follow: $('followBtn'),
    speed: $('speed'), speedOut: $('speedOut'), install: $('installBtn'),
    basemap: $('basemap'), setSelect: $('setSelect'), deleteSet: $('deleteSetBtn'), file: $('fileInput'), setHint: $('setHint'),
    search: $('search'), plist: $('plist'), stopCount: $('stopCount'), all: $('allBtn'), clear: $('clearBtn'), listHint: $('listHint'),
    roads: $('roads'), pause: $('pause'),
    card: $('card'), cardImg: $('cardImg'), cardN: $('cardN'), cardL: $('cardL'),
    progress: $('progress'), seek: $('seek'), done: $('done'), left: $('left'),
    empty: $('empty'), sample: $('sampleBtn'), toast: $('toast')
  };

  const state = {
    points: [],          // normalised points of the current file
    sel: [],             // indices into points, in ride order
    setId: null,
    follow: store.get('follow', true),
    speedLvl: store.get('speed', 5),
    route: null,         // built ride: {path, cum, total, stops}
    dirty: true
  };

  /* ───────────── Map ───────────── */
  const map = L.map('map', { zoomControl: true, preferCanvas: true, worldCopyJump: true }).setView([22.5, 80], 4);
  let tiles = null;
  function setBasemap(key) {
    const b = BASEMAPS[key] || BASEMAPS.carto_voyager;
    if (tiles) map.removeLayer(tiles);
    tiles = L.tileLayer(b.url, { subdomains: b.sub || 'abc', attribution: b.attr, maxZoom: b.max, maxNativeZoom: b.max, detectRetina: false, crossOrigin: true }).addTo(map);
    map.setMaxZoom(b.max);
    store.set('basemap', key);
  }
  Object.entries(BASEMAPS).forEach(([k, b]) => ui.basemap.add(new Option(b.name, k)));
  const bmKey = BASEMAPS[store.get('basemap')] ? store.get('basemap') : 'carto_voyager';
  ui.basemap.value = bmKey;
  setBasemap(bmKey);
  ui.basemap.addEventListener('change', () => setBasemap(ui.basemap.value));

  const dotLayer = L.layerGroup().addTo(map);
  const stopLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  let routeLine = null, doneLine = null, moto = null, motoRot = null;

  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  /* ───────────── Helpers ───────────── */
  const R = 6371008.8, rad = Math.PI / 180;
  function hav(a, b) {
    const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function fmtKm(m) { return m >= 10000 ? (m / 1000).toFixed(0) + ' km' : m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }
  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  }
  let toastT = 0;
  function toast(msg, ms) {
    ui.toast.textContent = msg; ui.toast.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => ui.toast.classList.remove('show'), ms || 3200);
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ───────────── JSON parsing ───────────── */
  const pick = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
  function normalise(data) {
    let list = null;
    if (Array.isArray(data)) list = data;
    else if (data && typeof data === 'object') {
      if (data.type === 'FeatureCollection' || Array.isArray(data.features)) list = data.features;
      else list = data.points || data.data || data.items || data.locations || data.markers || null;
    }
    if (!Array.isArray(list)) throw new Error('No list of points found in this file.');
    const out = [];
    list.forEach((it, i) => {
      if (!it || typeof it !== 'object') return;
      let lat, lng, p = it;
      if (it.type === 'Feature') {
        p = it.properties || {};
        const g = it.geometry;
        if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return;
        lng = +g.coordinates[0]; lat = +g.coordinates[1];
      } else if (Array.isArray(it) && it.length >= 2) {
        lat = +it[0]; lng = +it[1]; p = {};
      } else {
        lat = +pick(it, ['lat', 'latitude', 'Lat', 'LAT', 'y']);
        lng = +pick(it, ['lng', 'lon', 'long', 'longitude', 'Lng', 'Lon', 'LNG', 'x']);
        if ((isNaN(lat) || isNaN(lng)) && Array.isArray(it.coordinates)) { lng = +it.coordinates[0]; lat = +it.coordinates[1]; }
      }
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      const img = pick(p, ['img', 'image', 'imageUrl', 'image_url', 'photo', 'src']);
      const thumb = pick(p, ['thumb', 'thumbnail', 'thumbUrl']);
      const label = pick(p, ['label', 'name', 'title']);
      out.push({ lat, lng, label: label ? String(label) : 'Point ' + (i + 1), img: img ? String(img) : '', thumb: thumb ? String(thumb) : '' });
    });
    if (!out.length) throw new Error('The file has no points with valid lat / lng.');
    return out;
  }

  /* ───────────── Saved point files (this browser) ───────────── */
  function sets() { return store.get('sets', []); }
  function renderSets() {
    const list = sets();
    ui.setSelect.innerHTML = '';
    if (!list.length) ui.setSelect.add(new Option('No files yet', ''));
    list.forEach((s) => ui.setSelect.add(new Option(`${s.name} (${s.count})`, s.id)));
    ui.setSelect.value = state.setId || '';
    ui.setSelect.disabled = !list.length;
    ui.deleteSet.disabled = !state.setId;
  }
  function saveSet(name, points) {
    const id = 's' + Date.now().toString(36);
    if (!store.set('set.' + id, points)) { toast('Opened, but this file is too big to keep in the browser.', 5000); return null; }
    const list = sets(); list.unshift({ id, name, count: points.length, added: Date.now() });
    store.set('sets', list);
    return id;
  }
  function openSet(id) {
    const pts = store.get('set.' + id, null);
    if (!pts) { toast('That file is no longer stored.'); return; }
    state.setId = id; store.set('lastSet', id);
    usePoints(pts, store.get('sel.' + id, []));
    renderSets();
  }
  ui.setSelect.addEventListener('change', () => { if (ui.setSelect.value) openSet(ui.setSelect.value); });
  ui.deleteSet.addEventListener('click', () => {
    if (!state.setId) return;
    const list = sets(), s = list.find((x) => x.id === state.setId);
    if (!confirm(`Remove “${s ? s.name : 'this file'}” from the app? The file on your device is not touched.`)) return;
    store.del('set.' + state.setId); store.del('sel.' + state.setId);
    store.set('sets', list.filter((x) => x.id !== state.setId));
    state.setId = null; store.del('lastSet');
    const rest = sets();
    if (rest.length) openSet(rest[0].id); else { usePoints([], []); renderSets(); }
  });

  function loadJsonText(text, fallbackName) {
    let data;
    try { data = JSON.parse(text); } catch (e) { toast('That file is not valid JSON.'); return; }
    let pts;
    try { pts = normalise(data); } catch (e) { toast(e.message, 4500); return; }
    const name = (data && !Array.isArray(data) && (data.route || data.routeName || data.name)) || fallbackName.replace(/\.(geo)?json$/i, '');
    const id = saveSet(String(name).slice(0, 60), pts);
    state.setId = id;
    if (id) store.set('lastSet', id);
    usePoints(pts, []);
    renderSets();
    toast(`Loaded ${pts.length} point${pts.length > 1 ? 's' : ''}. Pick your stops.`);
    openPanel(true);
  }
  ui.file.addEventListener('change', () => {
    const f = ui.file.files && ui.file.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => loadJsonText(String(r.result), f.name);
    r.onerror = () => toast('Could not read that file.');
    r.readAsText(f);
    ui.file.value = '';
  });
  ui.sample.addEventListener('click', () => {
    fetch('sample-points.json').then((r) => r.text()).then((t) => loadJsonText(t, 'Sample')).catch(() => toast('Sample not available offline yet.'));
  });

  /* ───────────── Points, selection, list ───────────── */
  function usePoints(pts, sel) {
    stopRide(true);
    state.points = pts;
    state.sel = (sel || []).filter((i) => i >= 0 && i < pts.length);
    ui.search.value = '';
    const has = pts.length > 0;
    ui.empty.hidden = has;
    ui.search.disabled = !has; ui.all.disabled = !has;
    drawDots();
    selectionChanged(false);
    if (has) {
      const b = L.latLngBounds(pts.map((p) => [p.lat, p.lng]));
      map.fitBounds(b.pad(0.15), { maxZoom: 15 });
    }
  }

  function drawDots() {
    dotLayer.clearLayers();
    const on = new Set(state.sel);
    state.points.forEach((p, i) => {
      if (on.has(i)) return;
      const m = L.circleMarker([p.lat, p.lng], { radius: 5.5, weight: 1.5, color: '#000', fillColor: p.img ? '#f5b700' : '#ffffff', fillOpacity: 0.9 });
      m.bindTooltip(esc(p.label), { direction: 'top', offset: [0, -4] });
      m.on('click', () => toggle(i));
      m.addTo(dotLayer);
    });
  }
  function drawStops() {
    stopLayer.clearLayers();
    state.sel.forEach((i, n) => {
      const p = state.points[i];
      const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="stop-pin">${n + 1}</div>`, iconSize: [0, 0] }), zIndexOffset: 500, keyboard: false });
      m.bindTooltip(esc(p.label), { direction: 'top', offset: [0, -12] });
      m.on('click', () => toggle(i));
      m.addTo(stopLayer);
    });
  }

  function toggle(i) {
    const at = state.sel.indexOf(i);
    if (at >= 0) state.sel.splice(at, 1); else state.sel.push(i);
    selectionChanged(true);
  }
  function selectionChanged(user) {
    if (user) { stopRide(true); if (state.setId) store.set('sel.' + state.setId, state.sel); }
    state.dirty = true;
    drawDots(); drawStops(); renderList();
    const n = state.sel.length;
    ui.stopCount.textContent = n ? `· ${n}` : '';
    ui.clear.disabled = !n;
    ui.play.disabled = n < 2;
    ui.play.title = n < 2 ? 'Pick at least two stops' : 'Play';
    ui.listHint.hidden = n >= 2 || !state.points.length;
  }

  const LIST_MAX = 400;
  function renderList() {
    const q = ui.search.value.trim().toLowerCase();
    const order = new Map(state.sel.map((i, n) => [i, n + 1]));
    const rows = [];
    let shown = 0, matched = 0;
    /* Selected stops first (in ride order), then the rest in file order. */
    const idx = state.sel.concat(state.points.map((_, i) => i).filter((i) => !order.has(i)));
    for (const i of idx) {
      const p = state.points[i];
      if (q && !p.label.toLowerCase().includes(q) && String(i + 1) !== q.replace('#', '')) continue;
      matched++;
      if (shown >= LIST_MAX) continue;
      shown++;
      const n = order.get(i);
      rows.push(`<li data-i="${i}" class="${n ? 'on' : ''}" role="button" tabindex="0" aria-pressed="${!!n}"><span class="n">${n || ''}</span><span class="t"><b>${esc(p.label)}</b><small>#${i + 1} · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</small></span>${p.img ? '<span class="ph" title="Has a photo"></span>' : ''}</li>`);
    }
    if (matched > shown) rows.push(`<li class="more">Showing ${shown} of ${matched} — search to narrow</li>`);
    if (state.points.length && !matched) rows.push('<li class="more">No points match</li>');
    ui.plist.innerHTML = rows.join('');
  }
  ui.plist.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) toggle(+li.dataset.i); });
  ui.plist.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.i) { e.preventDefault(); toggle(+e.target.dataset.i); } });
  let searchT = 0;
  ui.search.addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(renderList, 120); });
  ui.all.addEventListener('click', () => { state.sel = state.points.map((_, i) => i); selectionChanged(true); });
  ui.clear.addEventListener('click', () => { state.sel = []; selectionChanged(true); });

  /* ───────────── Route building ───────────── */
  async function roadPath(ll) {
    const path = [], legEnds = [0];
    for (let s = 0; s < ll.length - 1; s += OSRM_CHUNK - 1) {
      const chunk = ll.slice(s, s + OSRM_CHUNK);
      const url = OSRM + chunk.map((p) => p[1].toFixed(6) + ',' + p[0].toFixed(6)).join(';') + '?overview=full&geometries=geojson&steps=false';
      const r = await fetch(url);
      if (!r.ok) throw new Error('Routing server said ' + r.status);
      const j = await r.json();
      if (j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error(j.message || 'No road route found');
      const coords = j.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
      const base = path.length ? path.length - 1 : 0;
      if (path.length) coords.shift();
      path.push(...coords);
      /* Distance along this chunk, to place each stop by OSRM's leg lengths. */
      const cum = [0];
      for (let v = base + 1; v < path.length; v++) cum.push(cum[cum.length - 1] + hav(path[v - 1], path[v]));
      const snapped = j.waypoints.map((w) => [w.location[1], w.location[0]]);
      const legs = j.routes[0].legs;
      let want = 0, from = 0;
      for (let k = 1; k < snapped.length; k++) {
        if (k === snapped.length - 1) { legEnds.push(path.length - 1); break; }
        want += legs[k - 1].distance;
        const win = Math.max(80, legs[k - 1].distance * 0.08);
        let best = from, bd = Infinity;
        for (let v = from; v < cum.length; v++) {
          if (cum[v] < want - win) continue;
          if (cum[v] > want + win) break;
          const d = hav(path[base + v], snapped[k]);
          if (d < bd) { bd = d; best = v; }
        }
        if (bd === Infinity) { best = from; while (best < cum.length - 1 && cum[best] < want) best++; }
        legEnds.push(base + best); from = best;
      }
    }
    return { path, legEnds };
  }

  async function buildRoute() {
    const ll = state.sel.map((i) => [state.points[i].lat, state.points[i].lng]);
    let path, legEnds, viaRoads = false;
    if (ui.roads.checked) {
      if (!navigator.onLine) toast('Offline — riding in straight lines.');
      else {
        try { ({ path, legEnds } = await roadPath(ll)); viaRoads = true; }
        catch (e) { toast('Road route unavailable (' + e.message + ') — using straight lines.', 4500); }
      }
    }
    if (!viaRoads) { path = ll.slice(); legEnds = ll.map((_, i) => i); }
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + hav(path[i - 1], path[i]));
    const stops = legEnds.map((v, n) => ({ d: cum[v], n, p: state.points[state.sel[n]] }));
    return { path, cum, total: cum[cum.length - 1], stops };
  }

  function drawRoute(r) {
    routeLayer.clearLayers();
    routeLine = L.polyline(r.path, { color: css('--route'), weight: 4, opacity: 0.55, interactive: false }).addTo(routeLayer);
    doneLine = L.polyline([r.path[0]], { color: '#000', weight: 7, opacity: 0.9, interactive: false }).addTo(routeLayer);
    doneLine.gold = L.polyline([r.path[0]], { color: '#f5b700', weight: 4.5, opacity: 1, interactive: false }).addTo(routeLayer);
    const icon = L.divIcon({ className: 'moto', html: '<div class="rot"><img src="icons/motorcycle.svg" alt=""></div>', iconSize: [0, 0] });
    moto = L.marker(r.path[0], { icon, zIndexOffset: 1000, interactive: false, keyboard: false }).addTo(routeLayer);
    motoRot = moto.getElement().firstChild;
  }

  /* ───────────── Animation ───────────── */
  const anim = { playing: false, d: 0, v: 0, next: 0, hold: 0, last: 0, heading: 0, seg: 0, trailSeg: -1, raf: 0 };

  function posAt(r, d) {
    const c = r.cum;
    let lo = 0, hi = c.length - 1;
    if (d <= 0) return { ll: r.path[0], seg: 0 };
    if (d >= r.total) return { ll: r.path[hi], seg: Math.max(0, hi - 1) };
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
    const t = (d - c[lo]) / ((c[hi] - c[lo]) || 1), a = r.path[lo], b = r.path[hi];
    return { ll: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], seg: lo };
  }

  function render(dt) {
    const r = state.route;
    const { ll, seg } = posAt(r, anim.d);
    moto.setLatLng(ll);

    /* Heading: look a few screen pixels ahead so rotation matches what you see. */
    const mpp = 40075016.686 * Math.cos(ll[0] * rad) / Math.pow(2, map.getZoom() + 8);
    const look = Math.max(1, mpp * 14);
    const nearEnd = anim.d + look > r.total;
    const p0 = map.project(nearEnd ? posAt(r, Math.max(0, r.total - look)).ll : ll);
    const p1 = map.project(nearEnd ? r.path[r.path.length - 1] : posAt(r, anim.d + look).ll);
    if (p1.distanceTo(p0) > 0.5) {
      const target = Math.atan2(p1.x - p0.x, p0.y - p1.y) / rad;
      let diff = ((target - anim.heading + 540) % 360) - 180;
      anim.heading += dt == null ? diff : diff * Math.min(1, dt * 9);
    }
    motoRot.style.transform = `rotate(${anim.heading.toFixed(1)}deg)`;

    /* Travelled trail */
    if (seg !== anim.trailSeg) { anim.trailPts = r.path.slice(0, seg + 1); anim.trailSeg = seg; anim.trailPts.push(ll); }
    else anim.trailPts[anim.trailPts.length - 1] = ll;
    doneLine.setLatLngs(anim.trailPts); doneLine.gold.setLatLngs(anim.trailPts);

    if (state.follow) map.panTo(ll, { animate: false });
    updateReadout();
  }

  function updateReadout() {
    const r = state.route; if (!r) return;
    if (!seeking) ui.seek.value = Math.round((anim.d / (r.total || 1)) * 1000);
    ui.done.textContent = `${fmtKm(anim.d)} of ${fmtKm(r.total)}`;
    const mps = BASE_MPS * SPEEDS[state.speedLvl];
    ui.left.textContent = fmtTime((r.total - anim.d) / mps) + ' left';
  }

  function tick(t) {
    if (!anim.playing) return;
    anim.raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (t - anim.last) / 1000); anim.last = t;
    const r = state.route;
    if (anim.hold) {
      if (t < anim.hold) return;
      anim.hold = 0;
      if (anim.d >= r.total) { finish(); return; }
    }
    const target = BASE_MPS * SPEEDS[state.speedLvl];
    const pauseMs = +ui.pause.value;
    const next = r.stops[anim.next];
    let vt = target;
    if (next && pauseMs > 0) {
      const prev = r.stops[anim.next - 1], leg = next.d - (prev ? prev.d : 0);
      const rem = next.d - anim.d, brake = Math.max(12, Math.min(target * 0.9, leg * 0.3));
      if (rem < brake) vt = target * Math.max(0.1, Math.sqrt(rem / brake));
    }
    anim.v += (vt - anim.v) * Math.min(1, dt * 2.5);
    anim.v = Math.max(anim.v, target * 0.04);
    let nd = anim.d + anim.v * dt;
    let arrived = null;
    if (next && nd >= next.d) { nd = next.d; arrived = next; anim.next++; }
    if (nd >= r.total) nd = r.total;
    anim.d = nd;
    render(dt);
    if (arrived) arrive(arrived, pauseMs, t);
    if (anim.d >= r.total && !anim.hold) finish();
  }

  let cardT = 0;
  function arrive(stop, pauseMs, t) {
    showCard(stop, Math.max(pauseMs, 1600));
    const pin = stopLayer.getLayers()[stop.n];
    if (pin && pin.getElement()) pin.getElement().firstChild.classList.add('hit');
    if (pauseMs > 0) { anim.hold = t + pauseMs; anim.v = 0; }
  }
  function showCard(stop, ms) {
    const p = stop.p, src = p.thumb || p.img;
    ui.cardN.textContent = `Stop ${stop.n + 1} of ${state.route.stops.length}`;
    ui.cardL.textContent = p.label;
    if (src) { ui.cardImg.hidden = false; ui.cardImg.src = src; ui.cardImg.onerror = () => { ui.cardImg.hidden = true; }; }
    else { ui.cardImg.hidden = true; ui.cardImg.removeAttribute('src'); }
    ui.card.hidden = false;
    ui.card.style.animation = 'none'; void ui.card.offsetWidth; ui.card.style.animation = '';
    clearTimeout(cardT); cardT = setTimeout(() => { ui.card.hidden = true; }, ms);
  }

  function setPlaying(on) {
    anim.playing = on;
    ui.play.classList.toggle('playing', on);
    ui.play.title = on ? 'Pause' : 'Play';
    ui.play.setAttribute('aria-label', ui.play.title);
    if (on) { anim.last = performance.now(); anim.raf = requestAnimationFrame(tick); requestWakeLock(); }
    else { cancelAnimationFrame(anim.raf); releaseWakeLock(); }
  }
  function finish() {
    setPlaying(false);
    toast('Ride finished. Press play to ride again.');
  }
  function resetRide() {
    Object.assign(anim, { d: 0, v: 0, next: 0, hold: 0, trailSeg: -1 });
    stopLayer.getLayers().forEach((m) => { const el = m.getElement(); if (el) el.firstChild.classList.remove('hit'); });
    ui.card.hidden = true;
    if (state.route) render(null);
  }
  function stopRide(clearRoute) {
    setPlaying(false);
    if (clearRoute) {
      state.route = null; state.dirty = true;
      routeLayer.clearLayers(); moto = null;
      ui.progress.hidden = true; ui.restart.disabled = true; ui.card.hidden = true;
    }
  }

  let building = false;
  ui.play.addEventListener('click', async () => {
    if (building) return;
    if (anim.playing) { setPlaying(false); return; }
    if (state.dirty || !state.route) {
      building = true; ui.play.classList.add('busy'); ui.play.disabled = true;
      try {
        state.route = await buildRoute();
      } finally { building = false; ui.play.classList.remove('busy'); ui.play.disabled = state.sel.length < 2; }
      if (!state.route || state.route.total <= 0) { toast('Those stops are all in the same place.'); state.route = null; return; }
      state.dirty = false;
      drawRoute(state.route);
      resetRide();
      ui.progress.hidden = false; ui.restart.disabled = false;
      if (!state.follow) map.fitBounds(L.latLngBounds(state.route.path).pad(0.1));
      else map.setView(state.route.path[0], Math.max(map.getZoom(), 15), { animate: false });
      openPanel(false);
    } else if (anim.d >= state.route.total) resetRide();
    setPlaying(true);
  });
  ui.restart.addEventListener('click', () => { setPlaying(false); resetRide(); });

  /* Seek */
  let seeking = false, wasPlaying = false;
  ui.seek.addEventListener('pointerdown', () => { seeking = true; wasPlaying = anim.playing; setPlaying(false); });
  ui.seek.addEventListener('input', () => {
    const r = state.route; if (!r) return;
    if (!seeking) { wasPlaying = anim.playing; setPlaying(false); }
    anim.d = (ui.seek.value / 1000) * r.total; anim.v = 0; anim.hold = 0; anim.trailSeg = -1;
    anim.next = r.stops.findIndex((s) => s.d > anim.d + 0.01); if (anim.next < 0) anim.next = r.stops.length;
    stopLayer.getLayers().forEach((m, n) => { const el = m.getElement(); if (el) el.firstChild.classList.toggle('hit', n < anim.next); });
    render(null);
  });
  const endSeek = () => { if (!seeking) return; seeking = false; if (wasPlaying && anim.d < state.route.total) setPlaying(true); };
  ui.seek.addEventListener('pointerup', endSeek);
  ui.seek.addEventListener('pointercancel', endSeek);
  ui.seek.addEventListener('change', endSeek);

  /* Follow */
  function setFollow(on, quiet) {
    state.follow = on; store.set('follow', on);
    ui.follow.setAttribute('aria-pressed', String(on));
    ui.follow.title = on ? 'Stop following the motorcycle' : 'Follow the motorcycle';
    if (on && moto) map.panTo(moto.getLatLng(), { animate: !anim.playing });
    if (!quiet) toast(on ? 'Following the motorcycle' : 'Stopped following', 1400);
  }
  ui.follow.addEventListener('click', () => setFollow(!state.follow));
  map.on('dragstart', () => { if (state.follow && anim.playing) setFollow(false); });
  setFollow(state.follow, true);

  /* Speed */
  function setSpeed(l) {
    state.speedLvl = Math.max(0, Math.min(SPEEDS.length - 1, l | 0));
    ui.speed.value = state.speedLvl;
    ui.speedOut.textContent = SPEEDS[state.speedLvl] + '×';
    ui.speed.title = `Speed ${SPEEDS[state.speedLvl]}× (1× = 60 km/h)`;
    store.set('speed', state.speedLvl);
    updateReadout();
  }
  ui.speed.max = SPEEDS.length - 1;
  ui.speed.addEventListener('input', () => setSpeed(+ui.speed.value));
  setSpeed(state.speedLvl);

  /* Ride options */
  ui.roads.checked = store.get('roads', true);
  ui.roads.addEventListener('change', () => { store.set('roads', ui.roads.checked); stopRide(true); state.dirty = true; });
  ui.pause.value = String(store.get('pause', 2000));
  if (!ui.pause.value) ui.pause.value = '2000';
  ui.pause.addEventListener('change', () => store.set('pause', +ui.pause.value));

  /* Keyboard: space = play/pause, F = follow, +/- = speed */
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type=search], select, input[type=range]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && !ui.play.disabled && !e.target.closest('li,button,label')) { e.preventDefault(); ui.play.click(); }
    else if (e.key === 'f' || e.key === 'F') setFollow(!state.follow);
    else if (e.key === '+' || e.key === '=') setSpeed(state.speedLvl + 1);
    else if (e.key === '-') setSpeed(state.speedLvl - 1);
  });

  /* ───────────── Drawer (narrow screens) ───────────── */
  const narrow = window.matchMedia('(max-width:760px)');
  function openPanel(on) {
    if (!narrow.matches) on = false;
    ui.panel.classList.toggle('open', on);
    ui.app.classList.toggle('drawer', on);
    ui.panelBtn.setAttribute('aria-expanded', String(on));
  }
  ui.panelBtn.addEventListener('click', () => openPanel(!ui.panel.classList.contains('open')));
  ui.app.addEventListener('click', (e) => {
    if (!ui.app.classList.contains('drawer')) return;
    const path = e.composedPath(); /* fixed at dispatch, so list re-renders don't fool it */
    if (!path.includes(ui.panel) && !path.includes(ui.panelBtn)) openPanel(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openPanel(false); });
  narrow.addEventListener('change', () => { openPanel(false); map.invalidateSize(); });

  /* ───────────── PWA bits ───────────── */
  let wakeLock = null;
  async function requestWakeLock() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* not allowed */ } }
  function releaseWakeLock() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && anim.playing) { anim.last = performance.now(); requestWakeLock(); } });

  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; ui.install.hidden = false; });
  ui.install.addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; ui.install.hidden = true; });
  window.addEventListener('appinstalled', () => { ui.install.hidden = true; });

  /* Installed app on desktop Chrome/Edge: "Open with… Street Journey Lite" on a .json file. */
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      const h = params.files && params.files[0];
      if (!h) return;
      try { const f = await h.getFile(); loadJsonText(await f.text(), f.name); } catch (e) { toast('Could not open that file.'); }
    });
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  /* ───────────── Start ───────────── */
  renderSets();
  const last = store.get('lastSet', null);
  if (last && sets().some((s) => s.id === last)) openSet(last);
  else selectionChanged(false);
})();
