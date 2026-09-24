let map;
let lineLayer, polygonLayer, pointLayer;
let editGroup;
let drawControl;
let currentPolyline = null;
let activeDrawHandler = null;
const STORAGE_KEY = "poly_project_v1";
let featureCounter = 1;

function generateFeatureId() {
  return "FC" + String(featureCounter++).padStart(6, "0");
}

function isNameUnique(name) {
  let exists = false;
  editGroup.eachLayer(layer => {
    const n = layer.feature?.properties?.name;
    if (n && n.toLowerCase() === name.toLowerCase()) {
      exists = true;
    }
  });
  return !exists;
}

function syncFeatureCounter() {
  let max = 0;
  editGroup.eachLayer(layer => {
    const id = layer.feature?.properties?.id;
    if (id && id.startsWith("FC")) {
      const n = parseInt(id.slice(2), 10);
      if (!isNaN(n)) max = Math.max(max, n);
    }
  });
  featureCounter = max + 1;
}

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initLayers();
  initDrawControl();
  createProjectControl();
  initPenTip();
  setupHelpPanel();
  updateStatus("Map ready.");
});

function initMap() {
  const osmStreets = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors"
  }
);
const esriSat = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 20,
    attribution: "Tiles &copy; Esri"
  }
);	
  const street = L.tileLayer(
    "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
    { maxZoom: 20, attribution: "Street © Google" }
  );
  const satellite = L.tileLayer(
    "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    { maxZoom: 20, attribution: "Hybrid © Google" }
  );
  map = L.map("map", {
    center: [20.5937, 78.9629],
    zoom: 5,
    layers: [osmStreets]
  });
  L.control.layers({ OSM: osmStreets, Esri: esriSat, Google: street, Hybrid: satellite }, null, { position: "topright" }).addTo(map);
  L.Control.geocoder({ defaultMarkGeocode: true }).addTo(map);
  map.removeControl(map.zoomControl);
  L.control.zoom({ position: "bottomright" }).addTo(map);
}

function initLayers() {
  lineLayer = new L.FeatureGroup();
  polygonLayer = new L.FeatureGroup();
  pointLayer = new L.FeatureGroup();
  editGroup = new L.FeatureGroup();
  map.addLayer(lineLayer);
  map.addLayer(polygonLayer);
  map.addLayer(pointLayer);
  map.addLayer(editGroup);
}

function initDrawControl() {
  const smallPointIcon = L.divIcon({
    className: "small-point",
    iconSize: [8, 8],
    iconAnchor: [4, 4]
  });
  drawControl = new L.Control.Draw({
    draw: {
      polyline: {
        shapeOptions: { color: "#8B0000", weight: 4 } // dark red
      },
      polygon: {
        allowIntersection: false,
        showArea: true,
        shapeOptions: { color: "#005500", weight: 3 }
      },
      rectangle: false,
      circle: false,
      circlemarker: false,
      marker: {
        icon: smallPointIcon
      }
    },
    edit: {
      featureGroup: editGroup,
      edit: true,
      remove: true
    }
  });
  map.addControl(drawControl);
   map.on(L.Draw.Event.CREATED, e => {
    const layer = e.layer;
    const type = e.layerType;
    let name = prompt("Enter a UNIQUE name for this feature:");
    if (!name || !name.trim()) {
      updateStatus("Feature discarded.");
      return;
    }
    name = name.trim();
    if (!isNameUnique(name)) {
      alert("That name already exists.\nFeature discarded.");
      updateStatus("Duplicate name rejected.");
      return;
    }
    layer.feature = layer.feature || {
      type: "Feature",
      properties: {}
    };
    layer.feature.properties.id = generateFeatureId();
    layer.feature.properties.name = name;
    if (type === "polyline") {
      layer.setStyle({ color: "#8B0000" });
      lineLayer.addLayer(layer);
      editGroup.addLayer(layer);
      currentPolyline = layer;
    } else if (type === "polygon") {
      layer.setStyle({ color: "#005500" });
      polygonLayer.addLayer(layer);
      editGroup.addLayer(layer);
    } else if (type === "marker") {
       pointLayer.addLayer(layer);
      editGroup.addLayer(layer);
    } else {
      editGroup.addLayer(layer);
    }
     if (activeDrawHandler) {
      try { activeDrawHandler.disable(); } catch (err) {}
      activeDrawHandler = null;
    }
    map.off("click", continuePolyline);
    updateStatus("Feature added.");
  });
  map.on(L.Draw.Event.EDITSTART, () => {
    map.off("click", continuePolyline);
  });
  map.on(L.Draw.Event.EDITSTOP, () => {
    map.off("click", continuePolyline);
  });
}

function resumeLastPolyline() {
  if (!currentPolyline) {
    window.alert("No existing polyline to resume.");
    return;
  }
  stopEditing();
  map.on("click", continuePolyline);
  updateStatus("Click map to add points to the last polyline. Double-click or use Finish on Draw toolbar to finish.");
}

function continuePolyline(e) {
  if (!currentPolyline) return;
  currentPolyline.addLatLng(e.latlng);
  currentPolyline.setStyle({ color: "#8B0000" });
}

function stopEditing() {
  map.off("click", continuePolyline);
  if (activeDrawHandler) {
    try { activeDrawHandler.disable(); } catch (err) {}
    activeDrawHandler = null;
  }
  if (currentPolyline) currentPolyline.setStyle({ color: "#8B0000" });
  updateStatus("Editing stopped.");
}

function saveProject() {
  const project = {
    lines: lineLayer.toGeoJSON(),
    polygons: polygonLayer.toGeoJSON(),
    points: pointLayer.toGeoJSON()
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    updateStatus("Project saved locally.");
  } catch (err) {
    console.error("saveProject:", err);
    updateStatus("Failed to save project.");
  }
}

function loadProject() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    updateStatus("No saved project found.");
    return;
  }
  try {
    const data = JSON.parse(stored);
    lineLayer.clearLayers();
    polygonLayer.clearLayers();
    pointLayer.clearLayers();
    editGroup.clearLayers();
    if (data.lines) {
      L.geoJSON(data.lines, {
        onEachFeature: (feature, layer) => {
          lineLayer.addLayer(layer);
          editGroup.addLayer(layer);
        }
      });
    }
    if (data.polygons) {
      L.geoJSON(data.polygons, {
        onEachFeature: (feature, layer) => {
          polygonLayer.addLayer(layer);
          editGroup.addLayer(layer);
        }
      });
    }
    if (data.points) {
      L.geoJSON(data.points, {
        pointToLayer: (feature, latlng) => {
          const marker = L.marker(latlng, {
            icon: L.divIcon({ className: "small-point", iconSize: [8, 8], iconAnchor: [4, 4] })
          });
		  marker.feature = feature;
          pointLayer.addLayer(marker);
          editGroup.addLayer(marker);
          return marker;
        }
      });
    }
    const lines = lineLayer.getLayers();
    currentPolyline = lines.length ? lines[lines.length - 1] : null;
	syncFeatureCounter();
    zoomToData();
    updateStatus("Project loaded.");
  } catch (err) {
    console.error("loadProject error:", err);
    updateStatus("Failed to load project.");
  }
}

function newProject() {
  if (!confirm("Start a new project? This will clear current map contents.")) return;
  localStorage.removeItem(STORAGE_KEY);
  lineLayer.clearLayers();
  polygonLayer.clearLayers();
  pointLayer.clearLayers();
  editGroup.clearLayers();
  currentPolyline = null;
  stopEditing();
  updateStatus("New project started.");
}

function zoomToData() {
  const all = L.featureGroup([lineLayer, polygonLayer, pointLayer]);
  if (!all || all.getLayers().length === 0) {
    updateStatus("No data to zoom to.");
    return;
  }
  map.fitBounds(all.getBounds(), { padding: [20, 20] });
  updateStatus("Zoomed to data.");
}

function createProjectControl() {
  const control = L.Control.extend({
    onAdd: function () {
      const container = L.DomUtil.create("div", "map-project-control");
      const btnNew = createButton("New Project", "newProjectBtn");
      const btnLoad = createButton("Load Project", "loadProjectBtn");
      const btnSave = createButton("Save Project", "saveProjectBtn");
      const btnExport = createButton("Save GeoJSON", "exportBtn");
      const btnResume = createButton("Resume Line", "resumeBtn");
      const btnStop = createButton("Stop Editing", "stopBtn");
      const btnZoom = createButton("Zoom to Data", "zoomBtn");
      const btnHelp = createButton("Help", "helpBtn");
      [
        btnNew, btnLoad, btnSave, btnExport,
        btnResume, btnStop, btnZoom, btnHelp
      ].forEach(b => container.appendChild(b));
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      btnNew.addEventListener("click", newProject);
      btnLoad.addEventListener("click", loadProject);
      btnSave.addEventListener("click", saveProject);
      btnExport.addEventListener("click", exportGeoJSON);
      btnResume.addEventListener("click", resumeLastPolyline);
      btnStop.addEventListener("click", stopEditing);
      btnZoom.addEventListener("click", zoomToData);
      btnHelp.addEventListener("click", () => {
        const p = document.getElementById("helpPanel");
        p.style.display = "block";
        p.setAttribute("aria-hidden", "false");
      });
      return container;
    }
  });
  const instance = new control({ position: "topleft" });
    map.addControl(instance);
  const toolbar = document.querySelector(".map-project-control");
    document.body.appendChild(toolbar);
    toolbar.style.display = "none";
  const toggleBtn = document.createElement("button");
    toggleBtn.className = "toolbar-toggle-btn";
    toggleBtn.innerText = "☰ Menu";
    toggleBtn.onclick = function () {
    if (toolbar.style.display === "none") {
      toolbar.style.display = "flex";
    } else {
      toolbar.style.display = "none";
    }
  };
document.body.appendChild(toggleBtn);
}

function createButton(text, id) {
  const b = document.createElement("button");
  b.id = id;
  b.type = "button";
  b.innerText = text;
  return b;
}

function setupHelpPanel() {
  const hp = document.getElementById("helpPanel");
  const close = document.getElementById("helpClose");
  if (!hp || !close) return;
  close.addEventListener("click", () => {
    hp.style.display = "none";
    hp.setAttribute("aria-hidden", "true");
  });
}

function updateStatus(msg) {
    const bar = document.getElementById("statusBar");
    bar.textContent = msg ? msg : "";
}

function exportGeoJSON() {
  document.getElementById("exportModal").style.display = "block";
}

document.getElementById("exportCancelBtn").onclick = function () {
  document.getElementById("exportModal").style.display = "none";
};

document.getElementById("exportConfirmBtn").onclick = async function () {
  const includeLines = document.getElementById("chkLines").checked;
  const includePolygons = document.getElementById("chkPolygons").checked;
  const includePoints = document.getElementById("chkPoints").checked;
  document.getElementById("exportModal").style.display = "none";
  const combined = {
    type: "FeatureCollection",
    features: []
  };
  if (includeLines) {
    lineLayer.eachLayer(layer =>
      combined.features.push(layer.toGeoJSON())
    );
  }
  if (includePolygons) {
    polygonLayer.eachLayer(layer =>
      combined.features.push(layer.toGeoJSON())
    );
  }
  if (includePoints) {
    pointLayer.eachLayer(layer =>
      combined.features.push(layer.toGeoJSON())
    );
  }
  const geojsonStr = JSON.stringify(combined, null, 2);
  if (window.showSaveFilePicker) {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: "map_export.geojson",
        types: [{
          description: "GeoJSON",
          accept: { "application/geo+json": [".geojson"] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(geojsonStr);
      await writable.close();
      updateStatus("GeoJSON exported.");
      return;
    } catch (err) {
      console.warn("Native Save As canceled or failed, falling back to Blob.", err);
    }
  }
  const blob = new Blob([geojsonStr], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "map_export.geojson";
  a.click();
  URL.revokeObjectURL(url);
  updateStatus("GeoJSON exported."); // ← Status here
};

/* ==========================================================================
   PEN TIP  —  precise marking on touchscreens
   --------------------------------------------------------------------------
   A fingertip hides the spot you're aiming at. With the pen tip on, touching
   the map shows a small ballpoint/pencil whose point sits above-left of your
   finger. Slide to aim, lift to mark. Two fingers still pan and zoom.
   Works with the Polyline, Polygon and Marker tools and with "Resume Line".
   ========================================================================== */
const TIP_DX = -24;            // tip offset from finger, px (negative = left)
const TIP_DY = -64;            // negative = above the finger
const TIP_SNAP_PX = 18;        // lift near first/last vertex to finish the shape
const TIP_STORE_KEY = "drawgeo_pentip_v1";

const tip = {
  style: null,                 // null (off) | "pen" | "pencil"
  touchId: null,               // finger currently aiming
  latlng: null,
  point: null,                 // container point of the tip
  drawType: null,              // active Leaflet.draw tool: polyline | polygon | marker
  el: null,
  btn: null
};

const TIP_GRAPHICS = {
  pen:
    '<svg width="20" height="62" viewBox="0 0 20 62">' +
      '<path d="M10 0L13.5 11h-7z" fill="#c9c9c9" stroke="#555" stroke-width=".8"/>' +
      '<circle cx="10" cy="1.3" r="1.3" fill="#1b2f7a"/>' +
      '<rect x="5.5" y="11" width="9" height="50" rx="2" fill="#1f4fd1" stroke="#0d2a73" stroke-width=".8"/>' +
      '<rect x="7" y="14" width="1.6" height="44" fill="#fff" opacity=".35"/>' +
    '</svg>',
  pencil:
    '<svg width="20" height="62" viewBox="0 0 20 62">' +
      '<path d="M10 0L14.5 15h-9z" fill="#e9c38f" stroke="#8a6a3c" stroke-width=".8"/>' +
      '<path d="M10 0l1.7 5.5h-3.4z" fill="#2b2b2b"/>' +
      '<rect x="5.5" y="15" width="9" height="40" fill="#f2b705" stroke="#9a7400" stroke-width=".8"/>' +
      '<path d="M8.5 15v40M11.5 15v40" stroke="#c99600" stroke-width=".7"/>' +
      '<rect x="5.5" y="55" width="9" height="6.5" rx="1.5" fill="#f19aa6" stroke="#9a5a63" stroke-width=".8"/>' +
    '</svg>'
};

const TIP_BUTTON_ICONS = {
  off:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M8 3v8"/><path d="M4 7h8"/><path d="M13 21l1-4 6-6 3 3-6 6z" opacity=".55"/></svg>',
  pen:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M17 3.5a2.1 2.1 0 0 1 3 3L8.5 18 5 19l1-3.5z"/><path d="M15 5.5l3 3"/>' +
      '<circle cx="4" cy="20.5" r="1" fill="currentColor" stroke="none"/></svg>',
  pencil:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 20l1.2-4.8L16 4.4a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.8 18.8z"/>' +
      '<path d="M5.2 15.2l3.6 3.6"/><path d="M4 20l.7-2.6 1.9 1.9z" fill="currentColor"/></svg>'
};

function initPenTip() {
  try {
    const saved = localStorage.getItem(TIP_STORE_KEY);
    if (saved === "pen" || saved === "pencil") tip.style = saved;
  } catch (err) {}

  const c = map.getContainer();
  tip.el = L.DomUtil.create("div", "pentip", c);
  tip.el.innerHTML = '<div class="pentip-ring"></div><div class="pentip-body"></div>';

  // Capture phase: we see the finger before Leaflet / Leaflet.draw do
  c.addEventListener("touchstart", tipTouchStart, { capture: true, passive: false });
  c.addEventListener("touchmove", tipTouchMove, { capture: true, passive: false });
  c.addEventListener("touchend", tipTouchEnd, { capture: true, passive: false });
  c.addEventListener("touchcancel", tipCancel, { capture: true, passive: false });

  map.on(L.Draw.Event.DRAWSTART, e => {
    tip.drawType = e.layerType;
    tipSyncDrawTouch();
    if (tip.style) {
      updateStatus("Pen tip: touch and slide to aim, lift to mark. Two fingers pan/zoom.");
    }
  });
  map.on(L.Draw.Event.DRAWSTOP, () => {
    tip.drawType = null;
    tipCancel();
  });

  createPenTipControl();
}

/* ---------- when is the tip in charge of the finger? ---------- */
function tipIsAiming() {
  if (!tip.style) return false;
  if (tip.drawType) return true;
  return map.listens("click", continuePolyline);    // "Resume Line" mode
}

function tipActiveHandler() {
  try { return drawControl._toolbars.draw._modes[tip.drawType].handler; } catch (err) { return null; }
}

// Leaflet.draw's own polyline/polygon adds a vertex on every touchstart, which
// would fire when a second finger lands for pinch-zoom. Mute it while the tip is on.
function tipSyncDrawTouch() {
  const h = tipActiveHandler();
  if (!h || !h._onTouch || (tip.drawType !== "polyline" && tip.drawType !== "polygon")) return;
  map.off("touchstart", h._onTouch, h);
  if (!tip.style) map.on("touchstart", h._onTouch, h);
}

/* ---------- touch handling ---------- */
function tipTouchStart(e) {
  if (tip.touchId !== null) {
    // A second finger landed → the user wants to pan/zoom. Drop the tip and
    // let this event through so Leaflet's pinch-zoom starts.
    tipCancel();
    return;
  }
  if (!tipIsAiming() || e.touches.length !== 1) return;
  if (e.target.closest && e.target.closest(".leaflet-control")) return;

  e.preventDefault();          // no drag, no synthetic mouse events, no click
  e.stopPropagation();
  const t = e.changedTouches[0];
  tip.touchId = t.identifier;
  tipMoveTo(t);
  tip.el.style.display = "block";
}

function tipTouchMove(e) {
  if (tip.touchId === null) return;
  const t = tipFindTouch(e.changedTouches);
  e.preventDefault();
  e.stopPropagation();
  if (t) tipMoveTo(t);
}

function tipTouchEnd(e) {
  if (tip.touchId === null) return;
  const t = tipFindTouch(e.changedTouches);
  e.preventDefault();
  e.stopPropagation();
  if (!t) return;
  tipMoveTo(t);
  const latlng = tip.latlng;
  const point = tip.point;
  const overControl = tipIsOverControl(point);
  tipCancel();
  if (overControl) {
    updateStatus("Pen tip was over a button — nothing marked.");
    return;
  }
  tipPlace(latlng, point);
}

function tipCancel() {
  tip.touchId = null;
  if (tip.el) tip.el.style.display = "none";
}

function tipFindTouch(list) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].identifier === tip.touchId) return list[i];
  }
  return null;
}

function tipMoveTo(touch) {
  const rect = map.getContainer().getBoundingClientRect();
  const x = touch.clientX - rect.left + TIP_DX;
  const y = touch.clientY - rect.top + TIP_DY;
  tip.point = L.point(x, y);
  tip.latlng = map.containerPointToLatLng(tip.point);
  tip.el.style.transform = "translate(" + x + "px," + y + "px)";

  // Live preview: move Leaflet.draw's guide line / marker to the tip
  const h = tipActiveHandler();
  if (h && tip.drawType !== "marker" && h._onMouseMove) {
    try {
      h._onMouseMove({
        latlng: tip.latlng,
        originalEvent: { clientX: rect.left + x, clientY: rect.top + y, preventDefault() {} }
      });
    } catch (err) {}
  }
  updateStatus(tip.latlng.lat.toFixed(6) + ", " + tip.latlng.lng.toFixed(6) + "  — lift to mark");
}

function tipIsOverControl(point) {
  const rect = map.getContainer().getBoundingClientRect();
  const el = document.elementFromPoint(rect.left + point.x, rect.top + point.y);
  return !!(el && el.closest && el.closest(".leaflet-control, .map-project-control, .toolbar-toggle-btn"));
}

/* ---------- placing the mark ---------- */
function tipPlace(latlng, point) {
  if (!tip.drawType) {                               // Resume Line
    continuePolyline({ latlng: latlng });
    updateStatus("Point added to line. Keep marking, or press Stop Editing.");
    return;
  }
  const h = tipActiveHandler();
  if (!h) return;

  if (tip.drawType === "marker") {
    h._onTouch({ latlng: latlng });                  // place marker & finish
    return;
  }

  // Polyline / polygon: lifting on the last point (line) or the first point
  // (area) finishes the shape, just like tapping it with a mouse.
  const markers = h._markers || [];
  const n = markers.length;
  const near = m => map.latLngToContainerPoint(m.getLatLng()).distanceTo(point) < TIP_SNAP_PX;
  if (tip.drawType === "polyline" && n >= 2 && near(markers[n - 1])) { h.completeShape(); return; }
  if (tip.drawType === "polygon" && n >= 3 && near(markers[0])) { h.completeShape(); return; }

  h.addVertex(latlng);
  updateStatus("Point " + (n + 1) + " marked. Lift on the " +
    (tip.drawType === "polygon" ? "first" : "last") + " point or press Finish to complete.");
}

/* ---------- toolbar button: Off → Pen → Pencil ---------- */
function createPenTipControl() {
  const Ctl = L.Control.extend({
    onAdd: function () {
      const bar = L.DomUtil.create("div", "leaflet-bar pentip-control");
      const a = L.DomUtil.create("a", "", bar);
      a.href = "#";
      a.setAttribute("role", "button");
      L.DomEvent.on(a, "click", ev => { L.DomEvent.preventDefault(ev); cyclePenTip(); });
      L.DomEvent.disableClickPropagation(bar);
      tip.btn = a;
      return bar;
    }
  });
  map.addControl(new Ctl({ position: "topleft" }));
  refreshPenTipUI();
}

function cyclePenTip() {
  tip.style = tip.style === null ? "pen" : tip.style === "pen" ? "pencil" : null;
  try {
    if (tip.style) localStorage.setItem(TIP_STORE_KEY, tip.style);
    else localStorage.removeItem(TIP_STORE_KEY);
  } catch (err) {}
  tipCancel();
  tipSyncDrawTouch();
  refreshPenTipUI();
  updateStatus(tip.style
    ? (tip.style === "pen" ? "Ballpoint" : "Pencil") + " tip on — pick a draw tool, then touch and slide to aim."
    : "Pen tip off — fingers tap directly.");
}

function refreshPenTipUI() {
  const s = tip.style || "off";
  tip.btn.innerHTML = TIP_BUTTON_ICONS[s];
  tip.btn.classList.toggle("pentip-on", !!tip.style);
  const label = tip.style
    ? "Pen tip: " + (tip.style === "pen" ? "ballpoint" : "pencil") + " (tap to change)"
    : "Pen tip: off (tap to turn on)";
  tip.btn.title = label;
  tip.btn.setAttribute("aria-label", label);
  tip.el.querySelector(".pentip-body").innerHTML = TIP_GRAPHICS[tip.style || "pen"];
}
