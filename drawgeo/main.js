/* main.js
   Full mapping logic:
   - separate layers for lines, polygons, points
   - Leaflet Draw integration
   - resume/stop polyline
   - save/load/export (localStorage)
   - on-map project control (buttons)
   - defensive binding & helpful console logs
*/

let map;

// geometry layers
let lineLayer, polygonLayer, pointLayer;

// group used by Leaflet.Draw edit toolbar (contains all features)
let editGroup;

let drawControl;
let currentPolyline = null; // last created polyline (L.Polyline) -- used for resume
let activeDrawHandler = null; // L.Draw.Polyline when starting programmatically

// localStorage key
const STORAGE_KEY = "poly_project_v1";

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initLayers();
  initDrawControl();
  createProjectControl(); // on-map project/save control
  setupHelpPanel();
  updateStatus("Map ready.");
});

// ----------------------
// Initialize map + base layers
// ----------------------
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

  // geocoder (search)
  L.Control.geocoder({ defaultMarkGeocode: true }).addTo(map);

  // move zoom control to bottom-right
  map.removeControl(map.zoomControl);
  L.control.zoom({ position: "bottomright" }).addTo(map);
}

// ----------------------
// create feature layers and editGroup
// ----------------------
function initLayers() {
  lineLayer = new L.FeatureGroup();
  polygonLayer = new L.FeatureGroup();
  pointLayer = new L.FeatureGroup();

  editGroup = new L.FeatureGroup(); // Leaflet.Draw edit target

  map.addLayer(lineLayer);
  map.addLayer(polygonLayer);
  map.addLayer(pointLayer);
  map.addLayer(editGroup);
}

// ----------------------
// Leaflet Draw integration
// ----------------------
function initDrawControl() {
  // small point icon
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
        // use our tiny div icon for markers
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

  // handle created features
  map.on(L.Draw.Event.CREATED, e => {
    const layer = e.layer;
    const type = e.layerType;

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
      // ensure marker uses small point icon when re-created from GeoJSON
      pointLayer.addLayer(layer);
      editGroup.addLayer(layer);
    } else {
      // other types if any
      editGroup.addLayer(layer);
    }

    // if a programmatic draw handler was active, disable it
    if (activeDrawHandler) {
      try { activeDrawHandler.disable(); } catch (err) {}
      activeDrawHandler = null;
    }

    map.off("click", continuePolyline); // stop any resume handlers
    updateStatus("Feature added.");
  });

  // When editing is started / stopped, ensure resume click handlers are handled correctly
  map.on(L.Draw.Event.EDITSTART, () => {
    map.off("click", continuePolyline);
  });
  map.on(L.Draw.Event.EDITSTOP, () => {
    map.off("click", continuePolyline);
  });
}

// ----------------------
// Resume / continue polyline logic
// ----------------------
function resumeLastPolyline() {
  if (!currentPolyline) {
    window.alert("No existing polyline to resume.");
    return;
  }
  // ensure any active draw handlers are off
  stopEditing();

  // allow user to click on map to add vertices to currentPolyline
  map.on("click", continuePolyline);
  updateStatus("Click map to add points to the last polyline. Double-click or use Finish on Draw toolbar to finish.");
}

function continuePolyline(e) {
  if (!currentPolyline) return;
  currentPolyline.addLatLng(e.latlng);
  currentPolyline.setStyle({ color: "#8B0000" });
}

// Stop editing: disable programmatic draw handler and click handlers
function stopEditing() {
  map.off("click", continuePolyline);
  if (activeDrawHandler) {
    try { activeDrawHandler.disable(); } catch (err) {}
    activeDrawHandler = null;
  }
  if (currentPolyline) currentPolyline.setStyle({ color: "#8B0000" });
  updateStatus("Editing stopped.");
}

// ----------------------
// Save / Load project (localStorage)
// ----------------------
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

    // clear existing
    lineLayer.clearLayers();
    polygonLayer.clearLayers();
    pointLayer.clearLayers();
    editGroup.clearLayers();

    // helper to convert GeoJSON to layers while preserving marker icon
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
          // recreate marker with small icon
          const marker = L.marker(latlng, {
            icon: L.divIcon({ className: "small-point", iconSize: [8, 8], iconAnchor: [4, 4] })
          });
          pointLayer.addLayer(marker);
          editGroup.addLayer(marker);
          return marker;
        }
      });
    }

    // set currentPolyline to last line if present
    const lines = lineLayer.getLayers();
    currentPolyline = lines.length ? lines[lines.length - 1] : null;

    zoomToData();
    updateStatus("Project loaded.");
  } catch (err) {
    console.error("loadProject error:", err);
    updateStatus("Failed to load project.");
  }
}

// ----------------------
// New project (clear)
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

// ----------------------
// Zoom to all data
function zoomToData() {
  const all = L.featureGroup([lineLayer, polygonLayer, pointLayer]);
  if (!all || all.getLayers().length === 0) {
    updateStatus("No data to zoom to.");
    return;
  }
  map.fitBounds(all.getBounds(), { padding: [20, 20] });
  updateStatus("Zoomed to data.");
}

// ----------------------
// On-map project control (Leaflet control placed under draw toolbar)
// ----------------------
function createProjectControl() {
  const control = L.Control.extend({
    onAdd: function () {
      // Create container
      const container = L.DomUtil.create("div", "map-project-control");

      // Create buttons
      const btnNew = createButton("New Project", "newProjectBtn");
      const btnLoad = createButton("Load Project", "loadProjectBtn");
      const btnSave = createButton("Save Project", "saveProjectBtn");
      const btnExport = createButton("Save GeoJSON", "exportBtn");
      const btnResume = createButton("Resume Line", "resumeBtn");
      const btnStop = createButton("Stop Editing", "stopBtn");
      const btnZoom = createButton("Zoom to Data", "zoomBtn");
      const btnHelp = createButton("Help", "helpBtn");

      // Append buttons
      [
        btnNew, btnLoad, btnSave, btnExport,
        btnResume, btnStop, btnZoom, btnHelp
      ].forEach(b => container.appendChild(b));

      // Prevent map from absorbing clicks
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      // Bind actions
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

  // Create control instance
  const instance = new control({ position: "topleft" });
  map.addControl(instance);

  // Move toolbar out of Leaflet's restricted control container
  const toolbar = document.querySelector(".map-project-control");
  document.body.appendChild(toolbar);

  // Ensure it displays
  toolbar.style.display = "flex";
}

// helper to create a button element with id + text
function createButton(text, id) {
  const b = document.createElement("button");
  b.id = id;
  b.type = "button";
  b.innerText = text;
  return b;
}

// ----------------------
// Help panel setup
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

// -------------------------------------------
// Export GeoJSON – with Layer Selection Modal
// -------------------------------------------

function exportGeoJSON() {
  document.getElementById("exportModal").style.display = "block";
}

// Close modal (Cancel)
document.getElementById("exportCancelBtn").onclick = function () {
  document.getElementById("exportModal").style.display = "none";
};

// Confirm export
document.getElementById("exportConfirmBtn").onclick = async function () {

  const includeLines = document.getElementById("chkLines").checked;
  const includePolygons = document.getElementById("chkPolygons").checked;
  const includePoints = document.getElementById("chkPoints").checked;

  document.getElementById("exportModal").style.display = "none";

  // Combine only selected layers
  const combined = {
    type: "FeatureCollection",
    features: []
  };

  // Correct layer names:
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

  // ------------------------------
  // Native Save As dialog (modern browsers)
  // ------------------------------
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
      return; // stop here
    } catch (err) {
      console.warn("Native Save As canceled or failed, falling back to Blob.", err);
    }
  }

  // ------------------------------
  // Blob fallback (older browsers)
  // ------------------------------
  const blob = new Blob([geojsonStr], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "map_export.geojson";
  a.click();

  URL.revokeObjectURL(url);

  updateStatus("GeoJSON exported."); // ← Status here
};

