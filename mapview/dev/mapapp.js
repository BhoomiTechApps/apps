// ================================
// Map App – Plain JS + Leaflet
// Supports: Basemaps, KMZ/KML/GeoJSON import, per-layer styling, labeling, clustering, heatmaps, routing, search
// ================================

// --- Map initialization ---
const map = L.map('map', {
    center: [20.5937, 78.9629],
    zoom: 5,
    zoomControl: false
});
L.control.zoom({ position: 'bottomright' }).addTo(map);

// --- Base layers ---
const baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(map);
const baseEsri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
const baseCarto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png');
const baseGstreet = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}');
const baseGhybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}');
L.control.layers({ 'OSM': baseOSM, 'Esri Imagery': baseEsri, 'Carto Light': baseCarto, 'Google Street': baseGstreet, 'Google Hybrid': baseGhybrid }).addTo(map);

// Prevent default right-click menu
map.getContainer().addEventListener('contextmenu', ev => ev.preventDefault());

// --- Globals ---
let layers = [];
let styleModalState = { layerId: null };

// --- Helpers ---
function uid(prefix = 'L') { return prefix + '_' + Math.random().toString(36).slice(2, 10); }
function randomColor() { return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'); }
function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ============================
// Map Controls
// ============================
L.control.locate({ position: 'topright', flyTo: true, keepCurrentZoomLevel: false, showPopup: true, drawCircle: true, strings: { title: "Show my location", popup: "You are here" } }).addTo(map);
L.control.fullscreen({ position: 'topright' }).addTo(map);

// ============================
// Leaflet-style "Fit All Data" button with FontAwesome
// ============================
L.Control.FitAll = L.Control.extend({
  options: { position: 'topright' }, // same as locate/fullscreen

  onAdd: function(map) {
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
    const link = L.DomUtil.create('a', '', container);

    // Use FontAwesome icon (e.g., fa-expand-arrows-alt)
    link.innerHTML = '<i class="fas fa-expand-arrows-alt fa-lg"></i>';
    link.href = '#';
    link.title = 'Fit all loaded data';

    // Prevent map dragging when clicking the button
    L.DomEvent.disableClickPropagation(container);

    L.DomEvent.on(link, 'click', function(e) {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);

      if (!layers || layers.length === 0) return;

      // Collect all visible layers
      const visibleLayers = layers
        .filter(r => r.settings.visible && r.leafletLayer)
        .map(r => r.leafletLayer);

      if (!visibleLayers.length) return;

      const group = L.featureGroup(visibleLayers);
      const bounds = group.getBounds();

      if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
    });

    return container;
  }
});

// Add the button to the map
map.addControl(new L.Control.FitAll());

// ================================
// FILE UPLOAD HANDLING
// ================================
const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', async (e) => {
  for (const f of e.target.files) {
    try { await loadFileToLayer(f); } 
    catch (err) { alert('Error loading ' + f.name + ': ' + err.message); }
  }
  fileInput.value = '';
});

async function loadFileToLayer(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.geojson') || name.endsWith('.json')) {
    createLayerFromGeoJSON(file.name, JSON.parse(await file.text()));
  } else if (name.endsWith('.kml') || name.endsWith('.kmz')) {
    const gj = await parseKmlOrKmz(file);
    createLayerFromGeoJSON(file.name, gj);
  } else throw new Error('Unsupported format');
}

async function parseKmlOrKmz(file) {
  const name = file.name.toLowerCase();
  let xmlText;
  if (name.endsWith('.kmz')) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlFile = Object.keys(zip.files).find(f => f.toLowerCase().endsWith('.kml'));
    if (!kmlFile) throw new Error('No KML inside KMZ');
    xmlText = await zip.file(kmlFile).async('string');
  } else xmlText = await file.text();
  const dom = new DOMParser().parseFromString(xmlText, 'text/xml');
  const gj = toGeoJSON.kml(dom);
  (gj.features || []).forEach(f => {
    if (f.properties) Object.keys(f.properties).forEach(k => {
      const v = f.properties[k];
      if (v && typeof v === 'object' && 'value' in v) f.properties[k] = v.value;
    });
  });
  return gj;
}

// ================================
// LAYER CREATION + RENDERING
// ================================
function createLayerFromGeoJSON(name, gj) {
  const id = uid('layer');
  const color = randomColor();

  const defaultSettings = {
    styleType: 'auto',
    color,
    opacity: 0.9,
    weight: 2,
    awesomeIcon: 'info',
    awesomeColor: 'blue',
    iconUrl: '',
    label: { enabled: false, field: null, size: 12, color: '#000000', halo: false },
    clustering: false,
    heatmap: false,
    visible: true
  };

  const rec = {
    id,
    name,
    data: gj,
    settings: defaultSettings,
    leafletLayer: null,
    labelLayer: null,
    clusterGroup: null,
    heatLayer: null
  };

  // ✅ Create GeoJSON layer with popup binding
  const geoLayer = L.geoJSON(gj, {
    style: {
      color: color,
      weight: 2,
      opacity: 0.9
    },
    onEachFeature: bindGeoJSONPopup
  });

  rec.leafletLayer = geoLayer;
  layers.push(rec);

  // Add to map before fitting bounds (so popups attach properly)
  geoLayer.addTo(map);

  // Add UI/list references
  addLayerListItem(rec);
  renderLayer(rec);

  // ✅ Safe delayed fitBounds to prevent first-click popup issue
  setTimeout(() => {
    try {
      const bounds = geoLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    } catch (e) {
      console.warn('Could not fit bounds for layer', name, e);
    }
  }, 100); // You can adjust delay: 50–150 ms works well

  // Optional UI sync
  if (typeof updateVectorRouteDropdown === 'function') updateVectorRouteDropdown();

  return rec;
}

function renderLayer(rec) {
  // Remove previous layers
  if (rec.leafletLayer) map.removeLayer(rec.leafletLayer);
  if (rec.labelLayer) map.removeLayer(rec.labelLayer);
  if (rec.clusterGroup) map.removeLayer(rec.clusterGroup);
  if (rec.heatLayer) map.removeLayer(rec.heatLayer);

  const style = {
    color: rec.settings.color,
    opacity: rec.settings.opacity,
    weight: rec.settings.weight,
    fillOpacity: rec.settings.opacity * 0.6
  };

  // Create GeoJSON layer
  const gjLayer = L.geoJSON(rec.data, {
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 6, ...style }),
    style: style,
    onEachFeature: (feature, layer) => {
      layer.on('click', () => bindGeoJSONPopup(feature, layer));
    }
  });

  // --- Clustering ---
  if (rec.settings.clustering) {
    rec.clusterGroup = L.markerClusterGroup();
    gjLayer.eachLayer(l => rec.clusterGroup.addLayer(l));
    rec.leafletLayer = rec.clusterGroup.addTo(map);
  }
  // --- Heatmap ---
  else if (rec.settings.heatmap) {
    const pts = [];
    gjLayer.eachLayer(l => {
      if (l.getLatLng) {
        const c = l.getLatLng();
        pts.push([c.lat, c.lng, 0.5]);
      }
    });
    rec.heatLayer = L.heatLayer(pts, { radius: 25, blur: 15, maxZoom: 12 }).addTo(map);
    rec.leafletLayer = rec.heatLayer;
  }
  // --- Normal vector layer ---
  else {
    rec.leafletLayer = gjLayer.addTo(map);
  }

  // --- Labels ---
  updateLabels(rec);
}

// ================================
// LABELS HELPER FUNCTION
// ================================
function updateLabels(rec) {
  if (!rec.settings.label.enabled || !rec.settings.label.field) {
    if (rec.labelLayer) {
      map.removeLayer(rec.labelLayer);
      rec.labelLayer = null;
    }
    return;
  }

  // Skip labeling when zoomed out
  if (map.getZoom() < 6) {
    if (rec.labelLayer) {
      map.removeLayer(rec.labelLayer);
      rec.labelLayer = null;
    }
    return;
  }

  if (!rec.labelLayer) rec.labelLayer = L.layerGroup();
  rec.labelLayer.clearLayers();

  const cellSize = 50; // fixed grid cell for overlap prevention
  const usedCells = {};

  const gjLayer = rec.leafletLayer;
  if (!gjLayer) return;

  gjLayer.eachLayer(l => {
    let center;
    if (l.getBounds) center = l.getBounds().getCenter();
    else if (l.getLatLng) center = l.getLatLng();
    if (!center) return;

    const point = map.latLngToLayerPoint(center);
    const cellX = Math.floor(point.x / cellSize);
    const cellY = Math.floor(point.y / cellSize);
    const cellKey = `${cellX}_${cellY}`;
    if (usedCells[cellKey]) return; // skip overlapping label
    usedCells[cellKey] = true;

    const val = l.feature?.properties?.[rec.settings.label.field];
    if (!val) return;

    const html = `<div style="
      font-size:${rec.settings.label.size}px;
      color:${rec.settings.label.color};
      text-shadow:${rec.settings.label.halo ? '1px 1px 2px #fff' : 'none'};
      white-space: nowrap;
    ">
      ${escapeHtml(val)}
    </div>`;

    const icon = L.divIcon({ html, className: 'map-label', iconSize: null });
    L.marker(center, { icon, interactive: false }).addTo(rec.labelLayer);
  });

  rec.labelLayer.addTo(map);
}

// Re-render labels on zoom
map.on('zoomend', () => {
  layers.forEach(rec => updateLabels(rec));
});

// ================================
// LAYER LIST UI
// ================================
function addLayerListItem(rec) {
  const list = document.getElementById('layerList');
  const div = document.createElement('div');
  div.className = 'layer-item';
  div.id = 'li_' + rec.id;
  div.innerHTML = `
    <strong>${rec.name}</strong>
    <i class="fa-solid fa-trash icon-clickable" title="Remove" onclick="removeLayer('${rec.id}')"></i>
    <br>
    <div style="display:flex;gap:6px;align-items:left;">
      <label style="display:inline-flex;align-items:center;gap:4px;">
        <input type="checkbox" checked onchange="toggleLayerVisibility('${rec.id}',this.checked)">Show/Hide
      </label>
      <i class="fa-solid fa-paint-brush icon-clickable" title="Style" onclick="openStyleModal('${rec.id}')"></i>
      <i class="fa-solid fa-arrow-up icon-clickable" title="Move Up" onclick="moveLayer('${rec.id}',-1)"></i>
      <i class="fa-solid fa-arrow-down icon-clickable" title="Move Down" onclick="moveLayer('${rec.id}',1)"></i>
    </div>
  `;
  list.prepend(div);
}

window.removeLayer = function (id) {
  const i = layers.findIndex(l => l.id === id);
  if (i < 0) return;

  const r = layers[i];

  // Remove all associated layers from the map
  [r.leafletLayer, r.labelLayer, r.clusterGroup, r.heatLayer].forEach(Ly => {
    if (Ly) map.removeLayer(Ly);
  });

  // Remove the corresponding HTML list item
  document.getElementById('li_' + id)?.remove();

  // Remove from layers array
  layers.splice(i, 1);

  // ✅ Update the vector route dropdown after layer removal
  if (typeof updateVectorRouteDropdown === 'function') {
    updateVectorRouteDropdown();
  }
};

window.toggleLayerVisibility = function (id, show) {
  const r = layers.find(l => l.id === id);
  if (!r) return;
  r.settings.visible = show;
  if (r.leafletLayer) (show ? map.addLayer(r.leafletLayer) : map.removeLayer(r.leafletLayer));
  if (r.labelLayer) (show ? map.addLayer(r.labelLayer) : map.removeLayer(r.labelLayer));
};

window.toggleQuickLabel = function (id, ch) {
  const r = layers.find(l => l.id === id);
  if (!r) return;
  r.settings.label.enabled = ch;
  if (ch) {
    const props = r.data.features[0]?.properties || {};
    r.settings.label.field = Object.keys(props)[0] || null;
  }
  renderLayer(r);
};

function moveLayer(layerId, direction) {
  const index = layers.findIndex(l => l.id === layerId);
  if (index === -1) return;

  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= layers.length) return; // cannot move out of bounds

  // Swap layers
  [layers[index], layers[newIndex]] = [layers[newIndex], layers[index]];

  // Update z-order on map (depends on your map library)
  redrawLayers();

  // Optional: move the DOM element in the layer list for visual feedback
  const list = document.getElementById('layerList');
  const item = document.getElementById('li_' + layerId);
  if (direction === -1 && item.previousElementSibling) {
    list.insertBefore(item, item.previousElementSibling);
  } else if (direction === 1 && item.nextElementSibling) {
    list.insertBefore(item.nextElementSibling, item);
  }

  markDirty(); // mark project as modified
}

function redrawLayers() {
  // Remove all layers first
  layers.forEach(l => {
    if (l.leafletLayer) map.removeLayer(l.leafletLayer);
    if (l.labelLayer) map.removeLayer(l.labelLayer);
    if (l.clusterGroup) map.removeLayer(l.clusterGroup);
    if (l.heatLayer) map.removeLayer(l.heatLayer);
  });

  // Re-add layers in correct order
  layers.forEach(l => {
    if (l.leafletLayer) map.addLayer(l.leafletLayer);
    if (l.labelLayer) map.addLayer(l.labelLayer);
    if (l.clusterGroup) map.addLayer(l.clusterGroup);
    if (l.heatLayer) map.addLayer(l.heatLayer);
  });
}

// ================================
// STYLE MODAL
// ================================
function openStyleModal(id) {
  const r = layers.find(l => l.id === id);
  if (!r) return;

  styleModalState.layerId = id;

  // Modal title
  document.getElementById('modalTitle').innerText = 'Style: ' + r.name;

  // Basic style
  document.getElementById('modalColor').value = r.settings.color ?? '#3388ff';
  document.getElementById('modalOpacity').value = r.settings.opacity ?? 0.9;
  document.getElementById('modalWeight').value = r.settings.weight ?? 2;
  document.getElementById('modalLabelEnable').checked = r.settings.label?.enabled ?? false;
  document.getElementById('modalCluster').checked = r.settings.clustering ?? false;
  document.getElementById('modalHeat').checked = r.settings.heatmap ?? false;

  // Populate label field dropdown
  const fieldSel = document.getElementById('modalLabelField');
  fieldSel.innerHTML = '<option value="">-- none --</option>';
  const feat = r.data?.features?.find(f => f.properties);
  if (feat) {
    Object.keys(feat.properties).forEach(k => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      if (r.settings.label?.field === k) opt.selected = true;
      fieldSel.appendChild(opt);
    });
  }

  // Label appearance
  document.getElementById('modalLabelSize').value = r.settings.label?.size ?? 12;
  document.getElementById('modalLabelColor').value = r.settings.label?.color ?? '#222222';
  document.getElementById('modalLabelHalo').checked = r.settings.label?.halo ?? false;

  // --- Attribute fields list for popup ---
  const attrList = document.getElementById('modalAttributeList');
  if (attrList) {
    attrList.innerHTML = '';

    // Ensure all keys are represented in popupFields
    const attrConfig = r.settings.popupFields || [];
    const propsKeys = feat ? Object.keys(feat.properties) : [];
    const merged = propsKeys.map(k => {
      const existing = attrConfig.find(a => a.key === k);
      return existing || { key: k, visible: true };
    });
    r.settings.popupFields = merged;

    merged.forEach(a => {
      const li = document.createElement('li');
      li.className = 'attribute-item';
      li.dataset.key = a.key;
      li.style.cursor = 'grab';
      li.draggable = true;
      li.innerHTML = `
        <input type="checkbox" ${a.visible ? 'checked' : ''} style="margin-right:6px;">
        <span>${escapeHtml(a.key)}</span>
      `;
      const checkbox = li.querySelector('input[type=checkbox]');
      checkbox.onchange = () => a.visible = checkbox.checked;
      attrList.appendChild(li);
    });

    // Enable simple drag-and-drop reordering
    let dragSrcEl = null;
    attrList.querySelectorAll('li').forEach(li => {
      li.addEventListener('dragstart', e => { dragSrcEl = li; e.dataTransfer.effectAllowed = 'move'; });
      li.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      li.addEventListener('drop', e => {
        e.stopPropagation();
        if (dragSrcEl && dragSrcEl !== li) {
          const srcIndex = Array.from(attrList.children).indexOf(dragSrcEl);
          const tgtIndex = Array.from(attrList.children).indexOf(li);
          if (srcIndex < tgtIndex) li.after(dragSrcEl);
          else li.before(dragSrcEl);
          // Update order in settings
          r.settings.popupFields = Array.from(attrList.children).map(el => {
            return r.settings.popupFields.find(a => a.key === el.dataset.key);
          });
        }
      });
    });
  }

  // Show modal
  document.getElementById('styleModalBackdrop').style.display = 'flex';
}

function closeStyleModal() {
  document.getElementById('styleModalBackdrop').style.display = 'none';
  styleModalState.layerId = null;
}

// ================================
// APPLY STYLE MODAL
// ================================
function applyStyleModal(closeAfter = false) {
  const id = styleModalState.layerId;
  if (!id) return;

  const r = layers.find(l => l.id === id);
  if (!r) return;

  // --- Save updated style values ---
  r.settings.color = document.getElementById('modalColor').value ?? '#3388ff';
  r.settings.opacity = parseFloat(document.getElementById('modalOpacity').value) || 0.9;
  r.settings.weight = parseFloat(document.getElementById('modalWeight').value) || 2;

  r.settings.label = r.settings.label || {};
  r.settings.label.enabled = document.getElementById('modalLabelEnable').checked ?? false;
  r.settings.label.field = document.getElementById('modalLabelField').value || '';
  r.settings.label.size = parseInt(document.getElementById('modalLabelSize').value) || 12;
  r.settings.label.color = document.getElementById('modalLabelColor').value || '#222222';
  r.settings.label.halo = document.getElementById('modalLabelHalo').checked ?? false;

  r.settings.clustering = document.getElementById('modalCluster').checked ?? false;
  r.settings.heatmap = document.getElementById('modalHeat').checked ?? false;

  // --- Update popupFields from the modal's attribute list ---
  const attrList = document.getElementById('modalAttributeList');
  if (attrList) {
    const updatedFields = Array.from(attrList.children).map(li => {
      const key = li.dataset.key;
      const visible = li.querySelector('input[type=checkbox]').checked;
      return { key, visible };
    });
    r.settings.popupFields = updatedFields;
  }

  // --- Re-render the layer ---
  renderLayer(r);

  // Rebind popup with updated fields
  if (r.leafletLayer instanceof L.LayerGroup) {
    r.leafletLayer.eachLayer(l => {
      if (l.feature) bindGeoJSONPopup(l.feature, l);
    });
  } else if (r.leafletLayer) {
    // For single heat or non-group layer
    r.leafletLayer.eachLayer?.(l => {
      if (l.feature) bindGeoJSONPopup(l.feature, l);
    });
  }

  if (closeAfter) closeStyleModal();
}

// ================================
// BIND GEOJSON POPUP
// ================================
function bindGeoJSONPopup(feature, layer) {
  if (!feature.properties) return;

  // Find the corresponding layer record
  const layerRec = layers.find(l =>
    l.leafletLayer === layer ||
    (l.data?.features && l.data.features.includes(feature))
  );

  const fields = layerRec?.settings.popupFields || [];
  if (!fields.length) return;

  let html = `<div class="popup-content" style="max-width:380px; font-family:Arial,sans-serif; font-size:14px;">`;

  fields.forEach(f => {
    if (!f.visible) return;

    const key = f.key;
    const val = feature.properties[key];
    if (val === undefined || val === null) return;

    // Handle media fields separately
    if (['video_url','image_url','audio_url'].includes(key.toLowerCase())) {
      html += renderMedia(val);
    } else {
      html += `<div><strong>${escapeHtml(key)}:</strong> ${escapeHtml(val)}</div>`;
    }
  });

  html += `</div>`;

  layer.bindPopup(html, { maxWidth: 400, minWidth: 300 });
}

// --------------------------------------------------
// 2. MEDIA RENDERER – 16:9 wrapper for every type
// --------------------------------------------------
function renderMedia(url) {
  if (!url || typeof url !== "string") return "";
  const u = url.trim();
  if (!u) return "";

  // 16:9 container (relative + padding-top trick)
  const wrapper = `
    <div style="position:relative; width:100%; height:0; padding-top:56.25%; margin-top:8px; border-radius:8px; overflow:hidden;">
      <div style="position:absolute; top:0; left:0; width:100%; height:100%;">`;

  const wrapperClose = `</div></div>`;

  // ---- YouTube -------------------------------------------------
  const yt = u.match(/(?:youtube\.com\/.*v=|youtu\.be\/)([A-Za-z0-9_-]+)/i);
  if (yt) {
    return wrapper + `
      <iframe
        src="https://www.youtube.com/embed/${yt[1]}"
        frameborder="0"
        allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowfullscreen
        style="border:none; width:100%; height:100%;"></iframe>` + wrapperClose;
  }

  // ---- Vimeo ---------------------------------------------------
  const vimeo = u.match(/vimeo\.com\/(\d+)/i);
  if (vimeo) {
    return wrapper + `
      <iframe
        src="https://player.vimeo.com/video/${vimeo[1]}"
        frameborder="0"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        style="border:none; width:100%; height:100%;"></iframe>` + wrapperClose;
  }

  // ---- Direct video (mp4, webm, ogg) ---------------------------
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(u)) {
    return wrapper + `
      <video controls playsinline preload="metadata"
             style="width:100%; height:100%; object-fit:contain; border-radius:8px;">
        <source src="${escapeHtml(u)}" type="video/${u.split('.').pop().toLowerCase()}">
        Your browser does not support the video tag.
      </video>` + wrapperClose;
  }

  // ---- Facebook Video -------------------------------------------------
  const fb = u.match(/facebook\.com\/watch\/\?v=(\d+)/i);
  if (fb) {
    const fbHref = encodeURIComponent(u);  // Escape the full URL for the href param
    return wrapper + `
      <iframe
        src="https://www.facebook.com/plugins/video.php?href=${fbHref}&show_text=0&width=560"
        width="560"
        height="315"
        style="border:none; overflow:hidden; width:100%; height:100%; position:absolute; top:0; left:0;"
        scrolling="no"
        frameborder="0"
        allowfullscreen="true"
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        allowFullscreen="true">
      </iframe>` + wrapperClose;
  }
  // ---- Direct audio --------------------------------------------
  if (/\.(mp3|wav|ogg)(\?.*)?$/i.test(u)) {
    // Audio does not need 16:9 – keep it compact but still inside wrapper
    return `
      <div style="margin-top:8px;">
        <audio controls preload="metadata" style="width:100%; border-radius:6px;">
          <source src="${escapeHtml(u)}" type="audio/${u.split('.').pop().toLowerCase()}">
          Your browser does not support the audio tag.
        </audio>
      </div>`;
  }

  // ---- IMAGE – works with ANY image URL (extension optional, query strings allowed) ----
  if (/(\.jpg|\.jpeg|\.png|\.gif|\.bmp|\.webp|\.svg)(\?.*)?$/i.test(u) ||
    /^(https?:\/\/[^?]+\.(jpg|jpeg|png|gif|bmp|webp|svg))(\?.*)?$/i.test(u) ||
    /^(https?:\/\/[^?]+\/[^?]+\.(jpg|jpeg|png|gif|bmp|webp|svg))(\?.*)?$/i.test(u) ||
    /\/images\?q=tbn:/i.test(u)) {          // <-- catches Google encrypted URLs

  return wrapper + `
    <img src="${escapeHtml(u)}" alt="Feature image"
         style="width:100%; height:100%; object-fit:contain; border-radius:8px;">` + wrapperClose;
}

  // ---- Fallback link --------------------------------------------
  return `
    <div style="margin-top:8px;">
      <a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml(u)}
      </a>
    </div>`;
}

// --------------------------------------------------
// 3. Safe HTML escape (unchanged)
// --------------------------------------------------
function escapeHtml(str) {
  return str ? String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    : '';
}
// ================================
// ENHANCED SEARCH TOOL
// ================================
let activeSearchHighlights = [];
let activeSearchMarkers = [];

async function doSearch() {
  const query = document.getElementById('searchText').value.trim();
  const resultsDiv = document.getElementById('searchResults');
  resultsDiv.innerHTML = '';
  if (!query) return;

  // Clear previous highlights and markers
  clearSearch(false);

  const source = document.getElementById('searchSource')?.value || 'layers';

  // --- Nominatim Search via proxy ---
  if (source === 'nominatim') {
    try {
      const res = await fetch(`nominatim_proxy.php?q=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (!data.length) {
        resultsDiv.innerHTML = 'No matches found.';
        return;
      }

      data.slice(0, 10).forEach(item => {
        const div = document.createElement('div');
        div.textContent = item.display_name; // show full display name
        div.style.cursor = 'pointer';
        div.onclick = () => {
          const lat = parseFloat(item.lat);
          const lon = parseFloat(item.lon);

          // Add marker
          const marker = L.marker([lat, lon]).addTo(map)
            .bindPopup(item.display_name)
            .openPopup();
          activeSearchMarkers.push(marker);

          // Zoom to result
          map.setView([lat, lon], 15);
        };
        resultsDiv.appendChild(div);
      });
    } catch (e) {
      resultsDiv.innerHTML = 'Error: ' + e.message;
    }
  }

  // --- Google Geocoding Search ---
  else if (source === 'google') {
    if (typeof google === 'undefined' || !window.geocoder) {
      resultsDiv.innerHTML = 'Google Maps API not loaded or geocoder unavailable.';
      return;
    }

    geocoder.geocode({ address: query }, (results, status) => {
      if (status === 'OK') {
        results.slice(0, 10).forEach(r => {
          const div = document.createElement('div');
          div.textContent = r.formatted_address;
          div.style.cursor = 'pointer';
          div.onclick = () => {
            const loc = r.geometry.location;
            const marker = L.marker([loc.lat(), loc.lng()]).addTo(map)
              .bindPopup(r.formatted_address)
              .openPopup();
            activeSearchMarkers.push(marker);
            map.setView([loc.lat(), loc.lng()], 15);
          };
          resultsDiv.appendChild(div);
        });
      } else {
        resultsDiv.innerHTML = 'No results found or error: ' + status;
      }
    });
  }

  // --- Search in Loaded Layers ---
  else if (source === 'layers') {
    const found = [];

    layers.forEach(rec => {
      if (!rec.data?.features) return;

      rec.data.features.forEach(f => {
        const props = f.properties || {};
        const text = Object.values(props).join(' ').toLowerCase();
        if (text.includes(query.toLowerCase())) {
          let latlng = null;
          if (f.geometry) {
            if (f.geometry.type === 'Point') {
              latlng = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
            } else if (f.geometry.type === 'LineString' || f.geometry.type === 'Polygon') {
              const centroid = turf.center(f);
              latlng = centroid.geometry.coordinates.reverse();
            }
          }
          if (latlng) found.push({ feature: f, latlng });
        }
      });
    });

    if (found.length === 0) {
      resultsDiv.innerHTML = 'No matches found in loaded layers.';
      return;
    }

    found.slice(0, 15).forEach(match => {
      const props = match.feature.properties || {};
      // Pick a meaningful display value (first non-empty property)
      const displayVal = props.name || props.Name || Object.values(props).find(v => v) || 'Unnamed feature';

      const div = document.createElement('div');
      div.textContent = displayVal;
      div.style.cursor = 'pointer';
      div.onclick = () => {
        map.setView(match.latlng, 15);

        // Full popup with all properties
        const html = Object.entries(props)
          .map(([k, v]) => `<b>${k}:</b> ${v}`)
          .join('<br>');

        L.popup().setLatLng(match.latlng).setContent(html).openOn(map);

        // Highlight feature briefly
        highlightFeature(null, match.feature);
      };
      resultsDiv.appendChild(div);
    });
  }
}

// Highlight with yellow glow
function highlightFeature(layerRec, feature) {
  if (!feature || !layerRec) return;

  const gj = L.geoJSON(feature, {
    style: {
      color: 'yellow',
      weight: 5,
      opacity: 0.9,
      fillOpacity: 0.3
    }
  }).addTo(map);

  activeSearchHighlights.push(gj);
  setTimeout(() => {
    map.removeLayer(gj);
    activeSearchHighlights = activeSearchHighlights.filter(h => h !== gj);
  }, 5000);
}

// Clear all search artifacts
function clearSearch(clearText = true) {
  const resultsDiv = document.getElementById('searchResults');
  resultsDiv.innerHTML = '';

  if (clearText) {
    const input = document.getElementById('searchText');
    if (input) input.value = '';
  }

  // Remove highlight layers
  activeSearchHighlights.forEach(h => {
    try { map.removeLayer(h); } catch {}
  });
  activeSearchHighlights = [];

  // Remove search markers
  activeSearchMarkers.forEach(m => {
    try { map.removeLayer(m); } catch {}
  });
  activeSearchMarkers = [];

  // Close open popups
  map.closePopup();
}

function zoomTo(lat, lon) {
  map.setView([lat, lon], 15);
}

// Expose modal functions globally
window.openStyleModal = openStyleModal;
window.closeStyleModal = closeStyleModal;
window.applyStyleModal = applyStyleModal;

// ================================
// PROJECT SAVE, LOAD
// ================================
let lastSavedFileHandle = null;
let isDirty = false;

// Call this whenever layers or map are modified
function markDirty() {
  isDirty = true;
}

// Example: attach to map events
map.on('moveend', markDirty);
map.on('zoomend', markDirty);

// And when layers are modified:
function addLayer(l) {
  layers.push(l);
  markDirty();
}
function removeLayer(id) {
  layers = layers.filter(l => l.id !== id);
  markDirty();
}
function toggleLayerVisibility(id, visible) {
  const layer = layers.find(l => l.id === id);
  if (layer) {
    layer.settings.visible = visible;
    markDirty();
  }
}
function updateLayerStyle(id, newStyle) {
  const layer = layers.find(l => l.id === id);
  if (layer) {
    layer.settings.style = newStyle;
    markDirty();
  }
}

async function saveProject() {
  if (!layers || layers.length === 0) {
    alert("⚠️ No layers to save!");
    return;
  }

  if (!isDirty) {
    alert("✅ No changes to save.");
    return;
  }

  try {
    let fileHandle = lastSavedFileHandle;

    // If no previous file handle, ask user to choose save location
    if (!fileHandle) {
      const options = {
        suggestedName: "my-map-project.mapproj",
        types: [
          {
            description: "Map Project",
            accept: { "application/json": [".mapproj"] },
          },
        ],
      };
      fileHandle = await window.showSaveFilePicker(options);
      lastSavedFileHandle = fileHandle;
    }

    // Prepare project data
    const mapState = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      layers: layers.map(l => ({
        id: l.id,
        name: l.name,
        data: l.data,
        settings: l.settings,
      })),
    };

    // Write to file
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(mapState, null, 2));
    await writable.close();

    isDirty = false; // mark as saved
    alert("✅ Project saved successfully!");

  } catch (err) {
    if (err.name === "AbortError") {
      console.log("Save cancelled by user.");
    } else {
      console.error(err);
      alert("❌ Error saving project. See console for details.");
    }
  }
}

async function loadProject(file) {
  try {
    const text = await file.text();
    const project = JSON.parse(text);

    // --- Validate format
    if (!project.layers || !Array.isArray(project.layers)) {
      alert("❌ Invalid project file: no layers found.");
      return;
    }

    // --- Clear current layers
    layers.forEach(r => {
      [r.leafletLayer, r.labelLayer, r.clusterGroup, r.heatLayer].forEach(Ly => {
        if (Ly) map.removeLayer(Ly);
      });
    });
    layers = [];

    // --- Restore map center and zoom
    if (project.center && project.center.lat && project.center.lng && project.zoom !== undefined) {
      map.setView([project.center.lat, project.center.lng], project.zoom);
    }

    // --- Recreate all layers from saved data
    project.layers.forEach(l => {
      const rec = {
        id: l.id || uid("layer"),
        name: l.name || "Untitled Layer",
        data: l.data,
        settings: l.settings,
        leafletLayer: null,
        labelLayer: null,
        clusterGroup: null,
        heatLayer: null
      };
      layers.push(rec);
      addLayerListItem(rec);
      renderLayer(rec);
    });

    alert(`✅ Project "${file.name}" loaded successfully!`);
  } catch (err) {
    console.error("❌ Error loading project:", err);
    alert("Failed to load project file. Check the console for details.");
  }
}
