let geojsonData = null;
let visibleColumns = {};
let filteredFeatures = [];
let selectedRowIndex = null;

document.getElementById('fileInput').addEventListener('change', handleFile);
document.getElementById('fontSizeSelect').addEventListener('change', e => {
  document.documentElement.style.setProperty('--font-size', e.target.value);
});

document.getElementById('toggleColumnsBtn').addEventListener('click', () => {
  const list = document.getElementById('columnList');
  list.style.display = list.style.display === 'block' ? 'none' : 'block';
});

document.getElementById('searchInput').addEventListener('input', handleSearch);
document.getElementById('toggleMapBtn').addEventListener('click', toggleMap);

document.getElementById('exportExcelBtn').addEventListener('click', () => {
  if (!geojsonData) return alert("No data to export.");
  const features = filteredFeatures || geojsonData.features;
  const keys = Object.keys(features[0].properties).filter(k => visibleColumns[k]);
  const data = features.map(f => {
    const obj = {};
    keys.forEach(k => obj[k] = f.properties[k] ?? '');
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Attributes");
  XLSX.writeFile(wb, "geojson_attributes.xlsx");
});

const MapPreview = (() => {
  let map, layer, highlightLayer, clickCallback;
  
  function initMap() {
  if (map) return;
  map = L.map('map').setView([20, 80], 4);
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  });
  const googleStreet = L.tileLayer(
    'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',{
      attribution: 'Tiles &copy; Google'
    }
  );
  const googleHybrid = L.tileLayer(
    'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{
      attribution: 'Tiles &copy; Google Hybrid'
    }
  );
  osm.addTo(map);
  const baseLayers = {
    "OpenStreetMap": osm,
    "Google Street": googleStreet,
    "Google Hybrid": googleHybrid
  };
  L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
}

  function loadGeoJSON(data, onClick) {
    if (!map) initMap();
    if (!data) return;
    if (layer) layer.remove();
    clickCallback = onClick;
    layer = L.geoJSON(data, {
      style: { color: '#0078d4', weight: 2, fillOpacity: 0.2 },
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 5, color: '#0078d4' }),
      onEachFeature: (feature, lyr) => {
        lyr.on('click', () => {
          highlightFeature(feature);
          if (typeof clickCallback === 'function') clickCallback(feature);
        });
      }
    }).addTo(map);
    setTimeout(() => {
      try {
        const bounds = layer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds);
      } catch {
        map.setView([20, 80], 4);
      }
    }, 200);
  }

  function highlightFeature(feature) {
    if (!map) return;
    if (highlightLayer) highlightLayer.remove();
    highlightLayer = L.geoJSON(feature, {
      style: { color: 'red', weight: 3, fillOpacity: 0.3 },
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, { radius: 6, color: 'red', weight: 3 })
    }).addTo(map);

    setTimeout(() => {
      try {
        map.fitBounds(highlightLayer.getBounds(), { maxZoom: 12 });
      } catch (e) {
        const coords = feature.geometry.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          map.setView([coords[1], coords[0]], 10);
        }
      }
    }, 150);
  }

  function refresh() {
    if (map) map.invalidateSize();
  }
  return { loadGeoJSON, highlightFeature, refresh, initMap };
})();

async function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  geojsonData = JSON.parse(text);
  const feats = geojsonData.features;
  if (!feats?.length) return alert('No features found in GeoJSON.');
  const keys = Object.keys(feats[0].properties);
  visibleColumns = Object.fromEntries(keys.map(k => [k, true]));
  filteredFeatures = feats;
  renderColumnList(keys);
  renderTable();
  MapPreview.loadGeoJSON(geojsonData, handleMapFeatureClick);
  document.getElementById('saveBtn').style.display = 'inline-block';
  document.getElementById('exportExcelBtn').style.display = 'inline-block';
}

function renderColumnList(keys) {
  const list = document.getElementById('columnList');
  list.innerHTML = '';
  keys.forEach(k => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" checked data-key="${k}"><span>${k}</span>`;
    list.appendChild(label);
  });
  list.addEventListener('change', e => {
    if (e.target.matches('input[type=checkbox]')) {
      const key = e.target.dataset.key;
      visibleColumns[key] = e.target.checked;
      renderTable();
    }
  });
}

function handleSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  if (!q) filteredFeatures = geojsonData.features;
  else {
    filteredFeatures = geojsonData.features.filter(f =>
      Object.entries(f.properties).some(
        ([k, v]) => visibleColumns[k] && String(v ?? '').toLowerCase().includes(q)
      )
    );
  }
  renderTable();
}

function renderTable() {
  const feats = filteredFeatures;
  const tableContainer = document.getElementById('tableContainer');
  if (!feats.length) {
    tableContainer.innerHTML = "<p style='padding:10px;'>No matching records.</p>";
    return;
  }
  const keys = Object.keys(feats[0].properties).filter(k => visibleColumns[k]);
  let html = '<table><thead><tr>';
  keys.forEach(k => (html += `<th class="resizable">${k}<div class="resize-handle"></div></th>`));
  html += '</tr></thead><tbody>';
  feats.forEach((f, i) => {
    html += `<tr data-row="${i}">`;
    keys.forEach(k => {
      html += `<td contenteditable="true" data-row="${i}" data-key="${k}">${f.properties[k] ?? ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  tableContainer.innerHTML = html;
  if (typeof fltr_build === 'function') fltr_build();
    enableResizing();
    enableRowSelection();
}

function enableRowSelection() {
  document.querySelectorAll('tbody tr').forEach(row => {
    row.addEventListener('click', e => {
      document.querySelectorAll('tbody tr').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      selectedRowIndex = +row.dataset.row;
      const feature = filteredFeatures[selectedRowIndex];
      MapPreview.highlightFeature(feature);
    });
  });
}

document.addEventListener('input', e => {
  if (e.target.matches('td[contenteditable="true"]')) {
    const row = +e.target.dataset.row;
    const key = e.target.dataset.key;
    const feature = filteredFeatures[row];
    if (feature) feature.properties[key] = e.target.innerText.trim();
  }
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const jsonString = JSON.stringify(geojsonData, null, 2);
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'edited.geojson',
        types: [{ description: 'GeoJSON', accept: { 'application/geo+json': ['.geojson'], 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(jsonString);
      await writable.close();
      alert('File saved!');
      return;
    } catch (err) { console.warn(err); }
  }
  const blob = new Blob([jsonString], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'edited.geojson';
  a.click();
  URL.revokeObjectURL(a.href);
});

function enableResizing() {
  const ths = document.querySelectorAll('th.resizable');
  ths.forEach(th => {
    const handle = th.querySelector('.resize-handle');
    let startX, startWidth;
    handle.addEventListener('mousedown', e => {
      startX = e.pageX;
      startWidth = th.offsetWidth;
      document.body.style.cursor = 'col-resize';
      const move = ev => {
        const newW = Math.max(40, startWidth + (ev.pageX - startX));
        th.style.width = newW + 'px';
      };
      const up = () => {
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  });
}

function toggleMap() {
  const panel = document.getElementById('mapPanel');
  const isExpanded = panel.classList.toggle('expanded');
  const tableWrapper = document.getElementById('tableWrapper');

  if (isExpanded) {
    tableWrapper.style.maxHeight = "32vh";
    tableWrapper.style.height = "";
    
    setTimeout(() => {
      MapPreview.refresh();
      if (geojsonData) {
        MapPreview.loadGeoJSON(geojsonData, handleMapFeatureClick);
      }
    }, 300);
  } 
  else {
    tableWrapper.style.maxHeight = "520px"; 
    tableWrapper.style.height = "520px";
  }
}

function handleMapFeatureClick(feature) {
  const feats = filteredFeatures;
  const rowIndex = feats.indexOf(feature);
  if (rowIndex === -1) return;
  const tableWrapper = document.getElementById('tableWrapper');
  const rows = tableWrapper.querySelectorAll('tbody tr');
  rows.forEach(r => r.classList.remove('selected'));
  const row = rows[rowIndex];
  if (row) {
    row.classList.add('selected');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

document.addEventListener("DOMContentLoaded", () => {
    MapPreview.initMap();
    MapPreview.refresh();
});
