const BASEMAPS = {
  'osm':          { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '© OpenStreetMap contributors' },
  'carto-dark':   { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attr: '© OpenStreetMap, © CARTO' },
  'carto-light':  { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attr: '© OpenStreetMap, © CARTO' },
  'esri-topo':    { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attr: '© Esri' },
  'esri-imagery': { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '© Esri' },
  'google-terrain':{ url: 'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', attr: '© GoogleTerrain, Google' },
  'cycle':        { url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', attr: '© OpenStreetMap, CyclOSM' },
  'google-street':{ url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', attr: '© GoogleStreet, Google' },
  'google-hybrid':{ url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', attr: '© GoogleHybrid, Google' },
  'blank': null
};

const map = L.map('map', { zoomControl: true }).setView([20, 0], 2);

let currentBaseTile = null;
function setBasemap(key) {
  if (currentBaseTile) { map.removeLayer(currentBaseTile); currentBaseTile = null; }
  map.getContainer().style.background = key === 'blank' ? '#e8e8e8' : '#0a131c';
  if (key === 'blank') return;
  const bm = BASEMAPS[key] || BASEMAPS['carto-dark'];
  currentBaseTile = L.tileLayer(bm.url, { attribution: bm.attr, maxZoom: 19 }).addTo(map);
}
setBasemap('carto-dark');
document.getElementById('basemap-select').addEventListener('change', e => setBasemap(e.target.value));

const LAYER_COLORS = ['#00e5c0','#ff6b35','#9b59b6','#f1c40f','#e74c3c','#3498db','#2ecc71','#e67e22','#1abc9c','#e91e63'];
let layerIndex = 0;

const loadedLayers = {};
const layerOrder = []; 

function defaultStyle(color) {
  return {
    strokeColor: color, fillColor: color, weight: 2, opacity: 0.9, fillOpacity: 0.2, radius: 7,
    pointShape: 'circle',
    labelAttr: '',
    labelSize: 11,
    labelColor: '#ffffff',
    labelHaloColor: '#000000',
    labelHalo: 2,
    labelBold: false,
    labelOffset: 8,
  };
}

function buildLeafletStyle(s) {
  return { color: s.strokeColor, weight: s.weight, opacity: s.opacity, fillColor: s.fillColor, fillOpacity: s.fillOpacity };
}

function makePointIcon(shape, fillColor, strokeColor, weight, size) {
  const r = size;
  const svgSize = r * 2 + weight * 2 + 4;
  const c = svgSize / 2;
  let inner = '';
  const sw = weight;
  const sf = strokeColor;
  const ff = fillColor;

  switch (shape) {
    case 'square':
      inner = `<rect x="${sw+2}" y="${sw+2}" width="${svgSize-sw*2-4}" height="${svgSize-sw*2-4}" rx="2" fill="${ff}" stroke="${sf}" stroke-width="${sw}"/>`;
      break;
    case 'triangle': {
      const m = svgSize / 2, t = sw + 2, b = svgSize - sw - 2;
      inner = `<polygon points="${m},${t} ${svgSize-sw-2},${b} ${sw+2},${b}" fill="${ff}" stroke="${sf}" stroke-width="${sw}"/>`;
      break;
    }
    case 'diamond': {
      const m2 = svgSize / 2;
      inner = `<polygon points="${m2},${sw+2} ${svgSize-sw-2},${m2} ${m2},${svgSize-sw-2} ${sw+2},${m2}" fill="${ff}" stroke="${sf}" stroke-width="${sw}"/>`;
      break;
    }
    case 'star': {
      const cx = c, cy = c, ro = r - sw/2, ri = ro * 0.45;
      let pts = '';
      for (let i = 0; i < 10; i++) {
        const ang = (Math.PI / 5) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? ro : ri;
        pts += `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)} `;
      }
      inner = `<polygon points="${pts.trim()}" fill="${ff}" stroke="${sf}" stroke-width="${sw}"/>`;
      break;
    }
    case 'pin': {
      const px = c, py = sw + 2, pr = r * 0.65;
      const pBase = py + pr * 2;
      inner = `<circle cx="${px}" cy="${py + pr}" r="${pr}" fill="${ff}" stroke="${sf}" stroke-width="${sw}"/>
               <line x1="${px}" y1="${pBase}" x2="${px}" y2="${svgSize - sw - 1}" stroke="${sf}" stroke-width="${Math.max(sw,1.5)}"/>`;
      break;
    }
    default: 
      inner = `<circle cx="${c}" cy="${c}" r="${r}" fill="${ff}" stroke="${sf}" stroke-width="${sw}"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}">${inner}</svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize:   [svgSize, svgSize],
    iconAnchor: shape === 'pin' ? [svgSize/2, svgSize - sw - 1] : [svgSize/2, svgSize/2],
    popupAnchor:[0, -svgSize/2]
  });
}

const labelGroups = {};

function buildLabels(name) {
  const entry = loadedLayers[name];
  if (!entry) return;
  if (labelGroups[name]) { map.removeLayer(labelGroups[name]); delete labelGroups[name]; }
  const s = entry.style;
  if (!s.labelAttr || !entry.visible) return;

  const lg = L.layerGroup().addTo(map);
  entry.layer.eachLayer(fl => {
    const props = (fl.feature && fl.feature.properties) || {};
    const val = props[s.labelAttr];
    if (val === undefined || val === null || val === '') return;
    const text = String(val);

    let latlng;
    try {
      if (fl.getLatLng) latlng = fl.getLatLng();
      else if (fl.getBounds) latlng = fl.getBounds().getCenter();
    } catch(e) { return; }
    if (!latlng) return;

    const halo = s.labelHalo > 0
      ? `text-shadow:0 0 ${s.labelHalo}px ${s.labelHaloColor},0 0 ${s.labelHalo*2}px ${s.labelHaloColor}`
      : '';
    const fw = s.labelBold ? 'bold' : 'normal';
    const labelHtml = `<div class="geo-label-inner" style="font-size:${s.labelSize}px;color:${s.labelColor};font-weight:${fw};${halo};margin-top:${-s.labelOffset}px;">${escapeHtml(text)}</div>`;

    const marker = L.marker(latlng, {
      icon: L.divIcon({ html: labelHtml, className: 'geo-label', iconAnchor: [0, s.labelOffset] }),
      interactive: false
    });
    lg.addLayer(marker);
  });
  labelGroups[name] = lg;
}

function addGeoJSONLayer(name, geojson) {
  let finalName = name;
  let n = 1;
  while (loadedLayers[finalName]) { finalName = `${name} (${++n})`; }

  const color = LAYER_COLORS[layerIndex % LAYER_COLORS.length];
  layerIndex++;
  const style = defaultStyle(color);

  const attrKeys = new Set();
  if (geojson.features) {
    geojson.features.forEach(f => { if (f.properties) Object.keys(f.properties).forEach(k => attrKeys.add(k)); });
  }

  const layer = L.geoJSON(geojson, {
    style: () => buildLeafletStyle(style),
    pointToLayer: (feature, latlng) => {
      if (style.pointShape === 'circle') {
        return L.circleMarker(latlng, { radius: style.radius, ...buildLeafletStyle(style) });
      }
      return L.marker(latlng, { icon: makePointIcon(style.pointShape, style.fillColor, style.strokeColor, style.weight, style.radius) });
    },
    onEachFeature: (feature, fl) => {
      fl.on('click', () => {
        showFeatureInfo(feature, color, finalName);
        switchTab('info');
      });
      fl.on('mouseover', () => { if (fl.setStyle) fl.setStyle({ weight: style.weight + 2, fillOpacity: Math.min(style.fillOpacity + 0.2, 1) }); });
      fl.on('mouseout', () => { layer.resetStyle(fl); });
    }
  }).addTo(map);

  loadedLayers[finalName] = { layer, style, visible: true, geojson, attrKeys: [...attrKeys] };
  layerOrder.push(finalName);

  try {
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
  } catch(e) {}

  renderLayerList();
  updateLayerCount();
}

function removeLayer(name) {
  if (!loadedLayers[name]) return;
  map.removeLayer(loadedLayers[name].layer);
  if (labelGroups[name]) { map.removeLayer(labelGroups[name]); delete labelGroups[name]; }
  delete loadedLayers[name];
  const i = layerOrder.indexOf(name);
  if (i !== -1) layerOrder.splice(i, 1);
  renderLayerList();
  updateLayerCount();
}

function toggleVisibility(name) {
  const entry = loadedLayers[name];
  if (!entry) return;
  entry.visible = !entry.visible;
  if (entry.visible) {
    entry.layer.addTo(map);
    buildLabels(name);
  } else {
    map.removeLayer(entry.layer);
    if (labelGroups[name]) { map.removeLayer(labelGroups[name]); delete labelGroups[name]; }
  }
  renderLayerList();
}

function moveLayer(name, dir) {
  const i = layerOrder.indexOf(name);
  const j = i + dir;
  if (j < 0 || j >= layerOrder.length) return;
  [layerOrder[i], layerOrder[j]] = [layerOrder[j], layerOrder[i]];
  layerOrder.forEach(n => {
    const e = loadedLayers[n];
    if (e && e.visible) { map.removeLayer(e.layer); e.layer.addTo(map); }
  });
  renderLayerList();
}

function applyStyle(name) {
  const entry = loadedLayers[name];
  if (!entry) return;
  const s = entry.style;

  map.removeLayer(entry.layer);

  const layer = L.geoJSON(entry.geojson, {
    style: () => buildLeafletStyle(s),
    pointToLayer: (feature, latlng) => {
      if (s.pointShape === 'circle') {
        return L.circleMarker(latlng, { radius: s.radius, ...buildLeafletStyle(s) });
      }
      return L.marker(latlng, { icon: makePointIcon(s.pointShape, s.fillColor, s.strokeColor, s.weight, s.radius) });
    },
    onEachFeature: (feature, fl) => {
      fl.on('click', () => {
        showFeatureInfo(feature, s.fillColor, name);
        switchTab('info');
      });
      fl.on('mouseover', () => { if (fl.setStyle) fl.setStyle({ weight: s.weight + 2, fillOpacity: Math.min(s.fillOpacity + 0.2, 1) }); });
      fl.on('mouseout', () => { layer.resetStyle(fl); });
    }
  });

  if (entry.visible) layer.addTo(map);
  entry.layer = layer;

  buildLabels(name);
  renderLayerList();
}

let openStyleEditor = null; 

function renderLayerList() {
  const container = document.getElementById('layer-list');
  if (layerOrder.length === 0) {
    container.innerHTML = `<div class="layer-list-empty"><div class="empty-icon">🗂️</div><p>No layers loaded yet.<br>Load a GeoJSON file to get started.</p></div>`;
    return;
  }

  container.innerHTML = '';
  [...layerOrder].reverse().forEach((name, revIdx) => {
    const realIdx = layerOrder.length - 1 - revIdx;
    const entry = loadedLayers[name];
    if (!entry) return;
    const s = entry.style;
    const isOpen = openStyleEditor === name;

    const item = document.createElement('div');
    item.className = 'layer-item';
    item.dataset.name = name;

    item.innerHTML = `
      <div class="layer-item-header">
        <div class="layer-color-swatch" style="background:${s.fillColor}" title="Click to open styles" data-action="toggle-style"></div>
        <span class="layer-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <div class="layer-actions">
          <div class="order-btns">
            <button class="icon-btn" title="Move up (bring forward)" data-action="up" ${realIdx === layerOrder.length-1 ? 'disabled style="opacity:.3"' : ''}>↑</button>
            <button class="icon-btn" title="Move down (send back)" data-action="down" ${realIdx === 0 ? 'disabled style="opacity:.3"' : ''}>↓</button>
          </div>
          <button class="icon-btn vis-btn ${entry.visible ? '' : 'hidden-layer'}" title="${entry.visible ? 'Hide layer' : 'Show layer'}" data-action="toggle-vis">${entry.visible ? '👁' : '🚫'}</button>
          <button class="icon-btn danger" title="Remove layer" data-action="remove">✕</button>
          <button class="icon-btn expand-btn ${isOpen ? 'open' : ''}" title="Edit style" data-action="toggle-style">›</button>
        </div>
      </div>
      <div class="style-editor ${isOpen ? 'open' : ''}">

        <div class="style-section-title">Colors</div>
        <div class="style-row-color">
          <span class="style-label">Stroke</span>
          <input type="color" data-prop="strokeColor" value="${s.strokeColor}" />
        </div>
        <div class="style-row-color">
          <span class="style-label">Fill</span>
          <input type="color" data-prop="fillColor" value="${s.fillColor}" />
        </div>

        <div class="style-section-title">Lines & Fill</div>
        <div class="style-row">
          <span class="style-label">Stroke Width</span>
          <input type="range" data-prop="weight" min="0.5" max="10" step="0.5" value="${s.weight}" />
          <span class="style-val" data-val="weight">${s.weight}</span>
        </div>
        <div class="style-row">
          <span class="style-label">Stroke Opacity</span>
          <input type="range" data-prop="opacity" min="0" max="1" step="0.05" value="${s.opacity}" />
          <span class="style-val" data-val="opacity">${s.opacity}</span>
        </div>
        <div class="style-row">
          <span class="style-label">Fill Opacity</span>
          <input type="range" data-prop="fillOpacity" min="0" max="1" step="0.05" value="${s.fillOpacity}" />
          <span class="style-val" data-val="fillOpacity">${s.fillOpacity}</span>
        </div>

        <div class="style-section-title">Points</div>
        <div class="style-row">
          <span class="style-label">Size (px)</span>
          <input type="range" data-prop="radius" min="2" max="30" step="1" value="${s.radius}" />
          <span class="style-val" data-val="radius">${s.radius}</span>
        </div>
        <div style="margin-top:2px;">
          <div class="style-label" style="margin-bottom:6px;">Point Shape</div>
          <div class="icon-picker" data-icon-picker>
            ${[
              {id:'circle',  svg:`<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="currentColor" stroke="none"/></svg>`},
              {id:'square',  svg:`<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor"/></svg>`},
              {id:'triangle',svg:`<svg viewBox="0 0 16 16"><polygon points="8,2 14,14 2,14" fill="currentColor"/></svg>`},
              {id:'diamond', svg:`<svg viewBox="0 0 16 16"><polygon points="8,1 15,8 8,15 1,8" fill="currentColor"/></svg>`},
              {id:'star',    svg:`<svg viewBox="0 0 16 16"><polygon points="8,1 9.8,6.2 15,6.2 10.7,9.5 12.4,14.8 8,11.5 3.6,14.8 5.3,9.5 1,6.2 6.2,6.2" fill="currentColor"/></svg>`},
              {id:'pin',     svg:`<svg viewBox="0 0 16 16"><circle cx="8" cy="6" r="4" fill="currentColor"/><line x1="8" y1="10" x2="8" y2="15" stroke="currentColor" stroke-width="2"/></svg>`},
            ].map(opt => `<div class="icon-opt${s.pointShape===opt.id?' selected':''}" data-shape="${opt.id}" title="${opt.id}">${opt.svg}</div>`).join('')}
          </div>
        </div>

        <div class="style-section-title" style="margin-top:4px;">Labels</div>
        <div style="margin-bottom:6px;">
          <div class="style-label" style="margin-bottom:5px;">Label Attribute</div>
          <select class="label-attr-select" data-prop="labelAttr">
            <option value="">— off —</option>
            ${(entry.attrKeys||[]).map(k=>`<option value="${escapeHtml(k)}"${s.labelAttr===k?' selected':''}>${escapeHtml(k)}</option>`).join('')}
          </select>
        </div>
        <div class="style-row">
          <span class="style-label">Font Size</span>
          <input type="range" data-prop="labelSize" min="8" max="24" step="1" value="${s.labelSize}" />
          <span class="style-val" data-val="labelSize">${s.labelSize}</span>
        </div>
        <div class="style-row-color">
          <span class="style-label">Text Color</span>
          <input type="color" data-prop="labelColor" value="${s.labelColor}" />
        </div>
        <div class="style-row-color">
          <span class="style-label">Halo Color</span>
          <input type="color" data-prop="labelHaloColor" value="${s.labelHaloColor}" />
        </div>
        <div class="style-row">
          <span class="style-label">Halo Size</span>
          <input type="range" data-prop="labelHalo" min="0" max="6" step="0.5" value="${s.labelHalo}" />
          <span class="style-val" data-val="labelHalo">${s.labelHalo}</span>
        </div>
        <div class="style-row">
          <span class="style-label">Offset (px)</span>
          <input type="range" data-prop="labelOffset" min="0" max="30" step="1" value="${s.labelOffset}" />
          <span class="style-val" data-val="labelOffset">${s.labelOffset}</span>
        </div>
        <div class="style-row-color" style="align-items:center;">
          <span class="style-label">Bold</span>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" data-prop="labelBold" ${s.labelBold?'checked':''} style="accent-color:var(--accent);width:14px;height:14px;" />
            <span style="font-size:0.65rem;color:var(--muted);">Bold text</span>
          </label>
        </div>

        <button class="apply-style-btn" data-action="apply-style">Apply Style</button>
      </div>
    `;

    item.querySelectorAll('[data-action]').forEach(el => {
      const action = el.dataset.action;
      el.addEventListener('click', e => {
        e.stopPropagation();
        if (action === 'remove') removeLayer(name);
        else if (action === 'toggle-vis') toggleVisibility(name);
        else if (action === 'up') moveLayer(name, 1);
        else if (action === 'down') moveLayer(name, -1);
        else if (action === 'toggle-style') {
          openStyleEditor = (openStyleEditor === name) ? null : name;
          renderLayerList();
        }
        else if (action === 'apply-style') {
          applyStyle(name);
        }
      });
    });

    item.querySelectorAll('[data-shape]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        entry.style.pointShape = btn.dataset.shape;
        item.querySelectorAll('[data-shape]').forEach(b => b.classList.toggle('selected', b.dataset.shape === btn.dataset.shape));
      });
    });

    item.querySelectorAll('input[type=range]').forEach(input => {
      const prop = input.dataset.prop;
      input.addEventListener('input', () => {
        entry.style[prop] = parseFloat(input.value);
        const valEl = item.querySelector(`[data-val="${prop}"]`);
        if (valEl) valEl.textContent = input.value;
      });
    });

    item.querySelectorAll('input[type=color]').forEach(input => {
      const prop = input.dataset.prop;
      input.addEventListener('input', () => {
        entry.style[prop] = input.value;
        if (prop === 'fillColor') {
          const swatch = item.querySelector('.layer-color-swatch');
          if (swatch) swatch.style.background = entry.style.fillColor;
        }
      });
    });

    item.querySelectorAll('input[type=checkbox]').forEach(input => {
      const prop = input.dataset.prop;
      input.addEventListener('change', () => { entry.style[prop] = input.checked; });
    });

    const labelSelect = item.querySelector('.label-attr-select');
    if (labelSelect) {
      labelSelect.addEventListener('change', () => { entry.style.labelAttr = labelSelect.value; });
    }

    container.appendChild(item);
  });
}

function updateLayerCount() {
  const el = document.getElementById('layer-count');
  if (el) el.textContent = layerOrder.length;
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
}
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('toggle-panel').addEventListener('click', () => {
  document.getElementById('panel').classList.toggle('collapsed');
});

function showFeatureInfo(feature, color, layerName) {
  const props = feature.properties || {};
  const hasDesc = props.description && String(props.description).trim().length > 0;
  let html = `<div class="feature-content">`;
  html += `<div style="font-size:.6rem;color:var(--muted);margin-bottom:12px;padding:4px 8px;background:var(--bg);border-radius:4px;display:inline-flex;align-items:center;gap:6px;">
    <span style="width:8px;height:8px;border-radius:2px;background:${color};display:inline-block"></span>${escapeHtml(layerName)}</div>`;

  if (hasDesc) {
    html += `<div class="desc-html">${props.description}</div>`;
  } else {
    html += `<div class="no-desc">No <code>description</code> field. Showing raw properties:</div>`;
    html += `<div class="props-grid">`;
    const entries = Object.entries(props);
    if (entries.length === 0) {
      html += `<div style="color:var(--muted);font-size:.72rem;">No properties.</div>`;
    } else {
      for (const [k, v] of entries) {
        const display = (v === null || v === undefined) ? '—' : String(v);
        html += `<div class="prop-row"><div class="prop-key">${escapeHtml(k)}</div><div class="prop-val">${escapeHtml(display)}</div></div>`;
      }
    }
    html += `</div>`;
  }
  html += `</div>`;
  document.getElementById('panel-body').innerHTML = html;

  if (document.getElementById('panel').classList.contains('collapsed')) {
    document.getElementById('panel').classList.remove('collapsed');
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

document.getElementById('file-input').addEventListener('change', function () {
  [...this.files].forEach(loadFile); this.value = '';
});

function loadFile(file) {
  const name = file.name.replace(/\.(geo)?json$/i, '');
  const reader = new FileReader();
  reader.onload = e => {
    try {
      addGeoJSONLayer(name, JSON.parse(e.target.result));
    } catch {
      alert(`Could not parse "${file.name}" as GeoJSON.`);
    }
  };
  reader.readAsText(file);
}

const dropOverlay = document.getElementById('drop-overlay');
document.addEventListener('dragover', e => { e.preventDefault(); if(dropOverlay) dropOverlay.classList.add('active'); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget && dropOverlay) dropOverlay.classList.remove('active'); });
document.addEventListener('drop', e => {
  e.preventDefault(); if(dropOverlay) dropOverlay.classList.remove('active');
  [...e.dataTransfer.files].filter(f => /\.(geo)?json$/i.test(f.name)).forEach(loadFile);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}