/* Strata — Backup Splitter
   Splits a consolidated map backup into:
     - settings.json   (kiosk config + per-layer styling, each layer pointing at its own file)
     - <layer>.geojson (one FeatureCollection per layer — polygons/lines for shape layers, points for pin layers)
*/

(() => {
  'use strict';

  // ---------- state ----------
  let rawBackup = null;
  let parsedLayers = [];   // [{id, groupName, kind:'shape'|'point'|'empty', featureCount, fileSlug, shapeStyle, active, order, createdAt, updatedAt}]
  let generatedFiles = []; // [{name, content, kind}]
  let currentFileName = '';

  // ---------- dom ----------
  const dropzone      = document.getElementById('dropzone');
  const fileInput      = document.getElementById('fileInput');
  const filenameTag    = document.getElementById('filenameTag');
  const filenameText    = document.getElementById('filenameText');
  const clearFileBtn   = document.getElementById('clearFile');
  const errBox         = document.getElementById('errBox');

  const layersSection  = document.getElementById('layersSection');
  const statsRow       = document.getElementById('statsRow');
  const layerList      = document.getElementById('layerList');

  const splitPanel     = document.getElementById('splitPanel');
  const splitBtn       = document.getElementById('splitBtn');
  const resetBtn       = document.getElementById('resetBtn');
  const resetBtn2       = document.getElementById('resetBtn2');

  const outputSection  = document.getElementById('outputSection');
  const fileList       = document.getElementById('fileList');
  const downloadAllBtn = document.getElementById('downloadAllBtn');

  // ---------- helpers ----------
  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.add('show');
  }
  function clearError() {
    errBox.textContent = '';
    errBox.classList.remove('show');
  }

  function slugify(name, fallback) {
    const base = (name || fallback || 'layer').toString().trim().toLowerCase();
    const slug = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return slug || fallback || 'layer';
  }

  function uniqueSlug(slug, used) {
    let candidate = slug;
    let i = 2;
    while (used.has(candidate)) {
      candidate = `${slug}_${i++}`;
    }
    used.add(candidate);
    return candidate;
  }

  function prettyBytes(jsonString) {
    const bytes = new Blob([jsonString]).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function colorSwatch(shapeStyle) {
    return (shapeStyle && (shapeStyle.fillColor || shapeStyle.lineColor)) || '#999999';
  }

  // ---------- core transform ----------

  /**
   * Convert a single point entry (lat/lng/place_name/etc.) into a GeoJSON Point Feature.
   */
  function pointToFeature(point) {
    const { lat, lng, ...rest } = point;
    return {
      type: 'Feature',
      properties: { ...rest },
      geometry: {
        type: 'Point',
        coordinates: [lng, lat]
      }
    };
  }

  /**
   * Determine what kind of layer this is based on populated arrays.
   */
  function classifyLayer(layer) {
    const dataLen = Array.isArray(layer.data) ? layer.data.length : 0;
    const shapesLen = Array.isArray(layer.shapes) ? layer.shapes.length : 0;
    if (shapesLen > 0 && dataLen === 0) return 'shape';
    if (dataLen > 0 && shapesLen === 0) return 'point';
    if (shapesLen > 0 && dataLen > 0) return 'mixed';
    return 'empty';
  }

  /**
   * Build the GeoJSON FeatureCollection for a layer, based on its kind.
   */
  function buildFeatureCollection(layer, kind) {
    let features = [];
    if (kind === 'shape' || kind === 'mixed') {
      features = features.concat(layer.shapes || []);
    }
    if (kind === 'point' || kind === 'mixed') {
      features = features.concat((layer.data || []).map(pointToFeature));
    }
    return {
      type: 'FeatureCollection',
      features
    };
  }

  /**
   * Parse the uploaded backup object into a normalized layer summary list.
   */
  function parseBackup(backup) {
    if (!backup || typeof backup !== 'object') {
      throw new Error('That file is not a valid JSON object.');
    }
    if (!Array.isArray(backup.layers)) {
      throw new Error('No "layers" array found — this doesn\'t look like a recognized backup file.');
    }

    const used = new Set();
    return backup.layers.map((layer, idx) => {
      const kind = classifyLayer(layer);
      const dataLen = Array.isArray(layer.data) ? layer.data.length : 0;
      const shapesLen = Array.isArray(layer.shapes) ? layer.shapes.length : 0;
      const slugBase = slugify(layer.groupName, `layer_${layer.id ?? idx}`);
      const fileSlug = uniqueSlug(slugBase, used);

      return {
        id: layer.id,
        groupName: layer.groupName || `Layer ${idx + 1}`,
        kind,
        dataCount: dataLen,
        shapesCount: shapesLen,
        featureCount: dataLen + shapesLen,
        fileSlug,
        active: layer.active,
        order: layer.order,
        shapeStyle: layer.shapeStyle || {},
        createdAt: layer.createdAt,
        updatedAt: layer.updatedAt,
        _raw: layer
      };
    });
  }

  /**
   * Build the combined settings.json: kiosk config + one entry per layer,
   * each entry carrying its own styling/meta and a pointer to its own geojson file.
   */
  function buildSettingsFile(backup, layers) {
    return {
      backupFormatVersion: backup.backupFormatVersion ?? 1,
      exportedAt: backup.exportedAt || new Date().toISOString(),
      kiosk: backup.settings || {},
      layers: layers.map(l => ({
        file: `${l.fileSlug}.geojson`,
        name: l.groupName,
        type: l.kind === 'point' ? 'point' : (l.kind === 'mixed' ? 'mixed' : 'shape'),
        enabled: !!l.active,
        order: l.order,
        featureCount: l.featureCount,
        shapeStyle: l.shapeStyle,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt
      }))
    };
  }

  // ---------- rendering ----------

  function renderLayers(layers) {
    const shapeCount = layers.filter(l => l.kind === 'shape' || l.kind === 'mixed').length;
    const pointCount = layers.filter(l => l.kind === 'point' || l.kind === 'mixed').length;
    const totalFeatures = layers.reduce((sum, l) => sum + l.featureCount, 0);

    statsRow.innerHTML = `
      <div class="stat"><div class="num">${layers.length}</div><div class="lbl">Layers found</div></div>
      <div class="stat"><div class="num">${totalFeatures}</div><div class="lbl">Total features</div></div>
      <div class="stat"><div class="num">${shapeCount} / ${pointCount}</div><div class="lbl">Shape / Point layers</div></div>
    `;

    layerList.innerHTML = layers.map(l => {
      let badge;
      if (l.kind === 'shape') badge = '<span class="badge shape">Shape layer</span>';
      else if (l.kind === 'point') badge = '<span class="badge point">Pin layer</span>';
      else if (l.kind === 'mixed') badge = '<span class="badge shape">Shape + Pin</span>';
      else badge = '<span class="badge empty">Empty</span>';

      return `
        <div class="layer-row">
          <div class="layer-swatch" style="background:${colorSwatch(l.shapeStyle)}"></div>
          <div class="layer-info">
            <div class="name">${escapeHtml(l.groupName)}</div>
            <div class="meta">${l.fileSlug}.geojson${l.active === false ? ' · disabled' : ''}</div>
          </div>
          ${badge}
          <div class="feat-count">${l.featureCount} feature${l.featureCount === 1 ? '' : 's'}</div>
        </div>
      `;
    }).join('');

    layersSection.style.display = 'block';
    splitPanel.style.display = 'block';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fileIcon(kind) {
    return kind === 'settings' ? 'SET' : 'GEO';
  }

  function renderOutputFiles(files) {
    fileList.innerHTML = files.map((f, i) => {
      const json = f.content;
      return `
        <div class="file-card">
          <div class="ficon ${f.kind}">${fileIcon(f.kind)}</div>
          <div class="fname">${escapeHtml(f.name)}</div>
          <div class="fsize">${prettyBytes(json)}</div>
          <a class="fdl" href="#" data-idx="${i}">Download</a>
        </div>
      `;
    }).join('');

    fileList.querySelectorAll('.fdl').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = Number(a.dataset.idx);
        downloadSingle(files[idx]);
      });
    });

    outputSection.style.display = 'block';
    outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- downloads ----------

  function downloadSingle(file) {
    const blob = new Blob([file.content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadAllAsZip(files) {
    downloadAllBtn.disabled = true;
    const originalLabel = downloadAllBtn.textContent;
    downloadAllBtn.innerHTML = '<span class="spin"></span>Zipping…';
    try {
      const zip = new JSZip();
      files.forEach(f => zip.file(f.name, f.content));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const baseName = currentFileName.replace(/\.json$/i, '') || 'backup';
      a.href = url;
      a.download = `${baseName}_split.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      showError('Could not create the zip archive: ' + e.message);
    } finally {
      downloadAllBtn.disabled = false;
      downloadAllBtn.textContent = originalLabel;
    }
  }

  // ---------- file loading ----------

  function handleFile(file) {
    clearError();
    if (!file) return;
    if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
      showError('Please choose a .json file.');
      return;
    }

    currentFileName = file.name;
    filenameText.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
    filenameTag.classList.add('show');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        rawBackup = JSON.parse(e.target.result);
        parsedLayers = parseBackup(rawBackup);
        renderLayers(parsedLayers);
        outputSection.style.display = 'none';
        generatedFiles = [];
      } catch (err) {
        showError(err.message || 'Could not parse that file as JSON.');
        layersSection.style.display = 'none';
        splitPanel.style.display = 'none';
      }
    };
    reader.onerror = () => showError('Could not read that file from disk.');
    reader.readAsText(file);
  }

  function resetAll() {
    rawBackup = null;
    parsedLayers = [];
    generatedFiles = [];
    currentFileName = '';
    fileInput.value = '';
    filenameTag.classList.remove('show');
    clearError();
    layersSection.style.display = 'none';
    splitPanel.style.display = 'none';
    outputSection.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- split action ----------

  function performSplit() {
    if (!rawBackup || parsedLayers.length === 0) return;

    splitBtn.disabled = true;
    const originalLabel = splitBtn.textContent;
    splitBtn.innerHTML = '<span class="spin"></span>Splitting…';

    // Defer to next tick so the spinner paints before heavy JSON.stringify work on large files
    setTimeout(() => {
      try {
        const files = [];

        const settingsObj = buildSettingsFile(rawBackup, parsedLayers);
        files.push({
          name: 'settings.json',
          content: JSON.stringify(settingsObj, null, 2),
          kind: 'settings'
        });

        parsedLayers.forEach(l => {
          const fc = buildFeatureCollection(l._raw, l.kind);
          files.push({
            name: `${l.fileSlug}.geojson`,
            content: JSON.stringify(fc, null, 2),
            kind: 'geojson'
          });
        });

        generatedFiles = files;
        renderOutputFiles(files);
      } catch (err) {
        showError('Splitting failed: ' + err.message);
      } finally {
        splitBtn.disabled = false;
        splitBtn.textContent = originalLabel;
      }
    }, 30);
  }

  // ---------- wiring ----------

  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

  ['dragenter', 'dragover'].forEach(evt =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach(evt =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  clearFileBtn.addEventListener('click', (e) => {
    e.preventDefault();
    resetAll();
  });

  splitBtn.addEventListener('click', performSplit);
  resetBtn.addEventListener('click', resetAll);
  resetBtn2.addEventListener('click', resetAll);
  downloadAllBtn.addEventListener('click', () => downloadAllAsZip(generatedFiles));

  // ---------- service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is best-effort */ });
    });
  }
})();
