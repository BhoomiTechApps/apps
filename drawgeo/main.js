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
