'use strict';
/*
 * GeoCam — record video + GPS track, store on-device, export as video + GeoJSON.
 *
 * Storage design: everything is written to IndexedDB *incrementally* while recording
 * (1-second video chunks + each GPS fix), so a long recording never has to fit in RAM
 * and a crash / tab kill loses at most the last second. On export the chunks are
 * concatenated into a single video file and the points into a GeoJSON file.
 */

// ---------- Config ----------
const CHUNK_MS = 1000;                       // MediaRecorder timeslice
const VIDEO_BITRATE = 5_000_000;             // ~5 Mbps (≈37 MB/min)
const MIME_CANDIDATES = [                    // first supported wins; mp4 plays everywhere
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
// No timeout: without mobile data there's no assisted-GPS, so a cold first fix can take
// several minutes. A finite timeout would just spam errors while satellites are acquired.
const GEO_OPTS = { enableHighAccuracy: true, maximumAge: 0, timeout: Infinity };
const FIX_STALE_MS = 10_000;                 // no new fix for this long → show "signal lost"

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const preview = $('preview'), timerEl = $('timer'), recDot = $('recDot'), gpsInfo = $('gpsInfo');
const cameraSelect = $('cameraSelect'), startCamBtn = $('startCam'), recordBtn = $('recordBtn');
const statusEl = $('status'), listEl = $('list'), storageEl = $('storage');
const setStatus = (msg, warn = false) => { statusEl.textContent = msg; statusEl.className = warn ? 'warn' : ''; };

// ---------- IndexedDB ----------
let dbPromise;
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open('geocam', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('recordings', { keyPath: 'id' });
        d.createObjectStore('chunks', { autoIncrement: true }).createIndex('recId', 'recId');
        d.createObjectStore('points', { autoIncrement: true }).createIndex('recId', 'recId');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });

async function dbPut(store, value) {
  const t = (await openDB()).transaction(store, 'readwrite');
  t.objectStore(store).put(value);
  return txDone(t);
}
async function dbGetAll(store) {
  return reqP((await openDB()).transaction(store).objectStore(store).getAll());
}
async function dbGetByRec(store, recId) {
  return reqP((await openDB()).transaction(store).objectStore(store).index('recId').getAll(recId));
}
async function dbDeleteRecording(id) {
  const t = (await openDB()).transaction(['recordings', 'chunks', 'points'], 'readwrite');
  t.objectStore('recordings').delete(id);
  for (const s of ['chunks', 'points']) {
    const store = t.objectStore(s);
    const cur = store.index('recId').openKeyCursor(IDBKeyRange.only(id));
    cur.onsuccess = () => { const c = cur.result; if (c) { store.delete(c.primaryKey); c.continue(); } };
  }
  return txDone(t);
}

// ---------- State ----------
let stream = null;        // camera MediaStream
let recorder = null;      // MediaRecorder
let current = null;       // active recording session (null when not recording)
let geoWatch = null;
let lastFixTs = 0;
let timerInt = null;
let wakeLock = null;
let dirHandle = null;     // folder chosen via File System Access API (desktop Chromium)

// ---------- Camera ----------
/*
 * Opening the camera: try the best settings first, then progressively simpler ones, so a
 * laptop webcam (no "back camera", lower max resolution, mic missing/blocked/busy) still works.
 * cameraSelect value: "" = automatic (back camera on phones), otherwise a real deviceId.
 */
async function openStream() {
  const sel = cameraSelect.value;
  const pick = sel ? { deviceId: { exact: sel } } : { facingMode: { ideal: 'environment' } };
  const hd = { ...pick, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
  const basic = sel ? { deviceId: { exact: sel } } : true;
  const attempts = [
    { video: hd, audio: { echoCancellation: false, noiseSuppression: false } },
    { video: basic, audio: true },
    { video: hd, audio: false },        // mic missing / blocked / busy → record video without sound
    { video: basic, audio: false },
  ];
  let lastErr;
  for (const a of attempts) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(a);
      return { stream: s, noAudio: a.audio === false };
    } catch (e) {
      lastErr = e;
      // A chosen camera that vanished (unplugged): fall back to automatic and retry once.
      if (sel && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        cameraSelect.value = '';
        return openStream();
      }
    }
  }
  throw lastErr;
}

function explainCameraError(e) {
  switch (e && e.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access is blocked. Click the camera/lock icon in the address bar, set Camera (and Microphone) to Allow, then press Start camera. '
        + 'On Windows also check Settings → Privacy & security → Camera → "Let desktop apps / browsers access your camera". '
        + 'On macOS: System Settings → Privacy & Security → Camera → enable your browser.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is busy or blocked by the system. Close other apps using it (Zoom, Teams, Meet, the Camera app, other browser tabs), '
        + 'check any physical privacy shutter or keyboard camera key (often F8/F10), then press Start camera.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. Check it is connected and enabled in Device Manager / System Settings.';
    case 'OverconstrainedError':
      return 'This camera does not support the requested settings. Choose "Automatic" in the camera list and try again.';
    case 'NotSupportedError':
      return 'The browser could not ask for camera permission here. Open the app in a normal Chrome, Edge or Firefox window (not an embedded viewer), then press Start camera.';
    case 'AbortError':
      return 'The camera failed to start (hardware or driver issue). Try again, or restart the browser.';
    default:
      return `Camera unavailable: ${(e && e.message) || e}`;
  }
}

async function refreshCameraList(activeId) {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const keep = activeId ?? cameraSelect.value;
  cameraSelect.replaceChildren(new Option('Automatic (back camera on phones)', ''));
  cams.forEach((d, i) => cameraSelect.add(new Option(d.label || `Camera ${i + 1}`, d.deviceId)));
  cameraSelect.value = cams.some((d) => d.deviceId === keep) ? keep : '';
}

async function startCamera() {
  stopCamera();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus(insecureMessage(), true);
    return;
  }
  setStatus('Starting camera… (allow access if your browser asks)');
  let result;
  try {
    result = await openStream();
  } catch (e) {
    console.error('getUserMedia failed', e);
    setStatus(explainCameraError(e), true);
    return;
  }
  stream = result.stream;
  preview.srcObject = stream;
  preview.play().catch(() => {});
  recordBtn.disabled = false;
  startCamBtn.textContent = 'Restart camera';
  const track = stream.getVideoTracks()[0];
  const s = track.getSettings();
  await refreshCameraList(s.deviceId).catch(() => {});
  setStatus(`Camera ready: ${track.label || 'camera'} (${s.width}×${s.height})`
    + (result.noAudio ? ' — no microphone, video will record without sound.' : '.') + ' Waiting for GPS fix…', result.noAudio);
  startGps();
}

function insecureMessage() {
  if (location.protocol === 'file:') {
    return 'You opened the file directly. Camera and GPS need the app served from a web address: run "python -m http.server 8080" in the geocam folder and open http://localhost:8080';
  }
  if (!window.isSecureContext) {
    return `Camera and GPS are blocked on ${location.origin} because it is not secure. Use http://localhost on this computer, or an https:// address (GitHub Pages, Netlify) from other devices.`;
  }
  return 'This browser does not support camera access. Use a current Chrome, Edge, Firefox or Safari.';
}
function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

// ---------- Location: GPS + optional mobile-network fallback ----------
/*
 * Browsers cannot read cell-tower data directly. What they *can* do is ask the phone's OS
 * for a low-power fix (enableHighAccuracy: false), which Android/iOS compute from cell
 * towers and Wi-Fi instead of satellites. We run that as a second watch when the user
 * enables the fallback, and record its fixes only when GPS is missing or weak.
 * Each recorded point is tagged with `source` ('gps' | 'network') = which request produced it.
 */
const NET_OPTS = { enableHighAccuracy: false, maximumAge: 15_000, timeout: Infinity };

const settings = (() => {
  const defaults = { netFallback: false, weakAcc: 50 };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('geocam-settings') || '{}') }; }
  catch (_) { return defaults; }
})();
function saveSettings() { try { localStorage.setItem('geocam-settings', JSON.stringify(settings)); } catch (_) {} }

let gpsStartedAt = 0, lastFixAt = 0, lastCoords = null, gpsError = null;   // GPS (high-accuracy) state
let netWatch = null, netFixAt = 0, netCoords = null, netError = null;      // network (low-power) state
let lastGpsTs = 0;

const fresh = (at) => at && Date.now() - at <= FIX_STALE_MS;
// GPS is "weak" when it has no recent fix, or its accuracy is worse than the user's threshold.
const gpsWeak = () => !fresh(lastFixAt) || lastCoords.accuracy > settings.weakAcc;

function startGps() {
  if (geoWatch !== null) return;
  if (!('geolocation' in navigator)) { gpsInfo.textContent = 'GPS: not supported'; return; }
  gpsStartedAt = Date.now();
  geoWatch = navigator.geolocation.watchPosition(onGpsPosition, onGpsError, GEO_OPTS);
  if (settings.netFallback) startNet();
  setInterval(updateGpsInfo, 1000);
}
function startNet() {
  if (netWatch !== null || !('geolocation' in navigator)) return;
  netError = null;
  netWatch = navigator.geolocation.watchPosition(onNetPosition, onNetError, NET_OPTS);
}
function stopNet() {
  if (netWatch !== null) navigator.geolocation.clearWatch(netWatch);
  netWatch = null; netFixAt = 0; netCoords = null; netError = null;
  updateGpsInfo();
}

function updateGpsInfo() {
  const now = Date.now();
  const fmt = (c, src) => `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)} ±${Math.round(c.accuracy)} m · ${src}`;
  let gpsText;
  if (gpsError) gpsText = `GPS: ${gpsError}`;
  else if (!lastFixAt) gpsText = `GPS: acquiring satellites… ${fmtDuration(now - gpsStartedAt)}`;
  else if (!fresh(lastFixAt)) gpsText = `GPS: signal lost ${fmtDuration(now - lastFixAt)} ago`;
  else gpsText = null;

  if (!gpsWeak()) { gpsInfo.textContent = fmt(lastCoords, 'GPS'); return; }
  // GPS weak or missing: show the network fix if we have a usable one.
  if (settings.netFallback && fresh(netFixAt) && (!fresh(lastFixAt) || netCoords.accuracy < lastCoords.accuracy)) {
    gpsInfo.textContent = fmt(netCoords, 'network');
    return;
  }
  if (gpsText) {
    const netNote = settings.netFallback ? (netError ? ` · network: ${netError}` : ' · network: searching') : '';
    gpsInfo.textContent = gpsText + netNote;
  } else {
    gpsInfo.textContent = `${fmt(lastCoords, 'GPS')} (weak)`;
  }
}

function recordPoint(pos, source) {
  const c = pos.coords;
  const offset = pos.timestamp - current.startedAt;
  if (offset < -2000) return;                     // stale/cached fix from before recording
  lastFixTs = Math.max(lastFixTs, pos.timestamp);
  const pt = {
    recId: current.id, t: pos.timestamp, offset, source,
    lon: c.longitude, lat: c.latitude, alt: c.altitude, acc: c.accuracy,
    altAcc: c.altitudeAccuracy, speed: c.speed, heading: c.heading,
  };
  current.pointCount++;
  if (source === 'network') current.netPointCount++;
  dbPut('points', pt).catch((e) => console.error('point write failed', e));
}

function onGpsPosition(pos) {
  gpsError = null;
  lastFixAt = Date.now();
  lastCoords = pos.coords;
  updateGpsInfo();
  if (!current || pos.timestamp === lastGpsTs) return;   // not recording, or duplicate fix
  lastGpsTs = pos.timestamp;
  recordPoint(pos, 'gps');                               // GPS fixes are always kept; `acc` tells quality
}
function onGpsError(err) {
  if (err.code === 3) return;                 // timeout: keep waiting, the watch keeps running
  gpsError = { 1: 'permission denied', 2: 'unavailable — is Location turned on?' }[err.code] || err.message;
  updateGpsInfo();
  if (err.code === 1) setStatus('Location permission denied — video will record without a track.', true);
  if (err.code === 2) setStatus('Location unavailable. Turn on Location (GPS) in phone settings; it works without internet.', true);
}

function onNetPosition(pos) {
  netError = null;
  netFixAt = Date.now();
  netCoords = pos.coords;
  updateGpsInfo();
  if (!current || !settings.netFallback) return;
  if (pos.timestamp <= lastFixTs || pos.timestamp === lastGpsTs) return;   // old, cached, or same as a GPS fix
  if (!gpsWeak()) return;                                                  // GPS is good: ignore network
  // GPS weak-but-present: only use the network fix if it's actually more accurate.
  if (fresh(lastFixAt) && pos.coords.accuracy >= lastCoords.accuracy) return;
  recordPoint(pos, 'network');
}
function onNetError(err) {
  if (err.code === 3) return;
  netError = err.code === 1 ? 'permission denied' : 'unavailable (no signal/data?)';
  updateGpsInfo();
}

// ---------- Recording ----------
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}
const extFor = (mime) => (mime.includes('mp4') ? 'mp4' : 'webm');

async function startRecording() {
  if (!stream) return;
  const mime = pickMime();
  if (mime === null) { setStatus('MediaRecorder is not supported in this browser.', true); return; }

  // Ask the browser not to evict our data under storage pressure.
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  const id = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE } : {});
  } catch (e) {
    recorder = new MediaRecorder(stream);   // fall back to browser defaults
  }
  const mimeType = recorder.mimeType || mime || 'video/webm';
  const rec = {
    id, startedAt: Date.now(), endedAt: null, mimeType, ext: extFor(mimeType),
    chunkCount: 0, bytes: 0, pointCount: 0, netPointCount: 0, pending: Promise.resolve(),
  };
  const meta = () => ({
    id: rec.id, startedAt: rec.startedAt, endedAt: rec.endedAt, mimeType: rec.mimeType,
    ext: rec.ext, chunkCount: rec.chunkCount, bytes: rec.bytes, pointCount: rec.pointCount,
    netPointCount: rec.netPointCount, netFallback: settings.netFallback, weakAcc: settings.weakAcc,
  });

  recorder.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    const seq = rec.chunkCount++;
    rec.bytes += e.data.size;
    // Chain writes so chunks land in order and we can await them all on stop.
    rec.pending = rec.pending
      .then(() => dbPut('chunks', { recId: rec.id, seq, blob: e.data }))
      .then(() => { if (seq % 10 === 0) return dbPut('recordings', meta()); })
      .catch((err) => { console.error(err); setStatus(`Storage write failed: ${err.message}`, true); });
  };
  recorder.onstart = () => {
    rec.startedAt = Date.now();         // align GPS offsets with first video frame
    dbPut('recordings', meta());
  };
  recorder.onerror = (e) => setStatus(`Recorder error: ${e.error?.message || e}`, true);
  recorder.onstop = async () => {
    rec.endedAt = Date.now();
    await rec.pending;
    await dbPut('recordings', meta());
    setStatus(`Saved ${fmtDuration(rec.endedAt - rec.startedAt)} · ${fmtBytes(rec.bytes)} · ${rec.pointCount} GPS points`);
    renderList();
  };

  current = rec;
  lastFixTs = 0;
  lastGpsTs = 0;
  recorder.start(CHUNK_MS);

  recordBtn.textContent = 'Stop';
  recordBtn.classList.add('stop');
  cameraSelect.disabled = startCamBtn.disabled = true;
  recDot.classList.add('on');
  timerInt = setInterval(() => { timerEl.textContent = fmtDuration(Date.now() - rec.startedAt); }, 250);
  acquireWakeLock();
  const hasFix = fresh(lastFixAt) || (settings.netFallback && fresh(netFixAt));
  setStatus(hasFix
    ? `Recording (${rec.ext.toUpperCase()})…`
    : 'Recording — no location fix yet. The track will start as soon as one is found.', !hasFix);
}

function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  current = null;                 // stop logging GPS points immediately
  recorder.stop();
  clearInterval(timerInt);
  recDot.classList.remove('on');
  recordBtn.textContent = 'Record';
  recordBtn.classList.remove('stop');
  cameraSelect.disabled = startCamBtn.disabled = false;
  releaseWakeLock();
  setStatus('Finishing…');
}

// ---------- Wake lock (keeps screen on so GPS + camera keep running) ----------
async function acquireWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
}
function releaseWakeLock() { wakeLock?.release().catch(() => {}); wakeLock = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && current) acquireWakeLock();
  if (document.visibilityState === 'hidden' && current) {
    console.warn('App hidden while recording — GPS updates may pause.');
  }
});

// ---------- Export ----------
function toGeoJSON(meta, points, videoName) {
  const has3D = points.length > 0 && points.every((p) => p.alt != null);
  const coords = points.map((p) => (has3D ? [p.lon, p.lat, p.alt] : [p.lon, p.lat]));
  let geometry = null;
  if (coords.length >= 2) geometry = { type: 'LineString', coordinates: coords };
  else if (coords.length === 1) geometry = { type: 'Point', coordinates: coords[0] };
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry,
      properties: {
        name: `GeoCam ${new Date(meta.startedAt).toLocaleString()}`,
        video: videoName,
        videoMimeType: meta.mimeType,
        startTime: new Date(meta.startedAt).toISOString(),
        endTime: meta.endedAt ? new Date(meta.endedAt).toISOString() : null,
        durationMs: meta.endedAt ? meta.endedAt - meta.startedAt : null,
        pointCount: points.length,
        networkPointCount: points.filter((p) => p.source === 'network').length,
        networkFallback: !!meta.netFallback,
        weakGpsThresholdM: meta.weakAcc ?? null,
        // Per-coordinate arrays, same order/length as geometry coordinates.
        coordTimes: points.map((p) => new Date(p.t).toISOString()),   // togeojson / Mapbox convention
        source: points.map((p) => p.source || 'gps'),                 // 'gps' | 'network' (cell/Wi-Fi)
        videoOffsetMs: points.map((p) => p.offset),                   // ms from video start → seek here
        accuracy: points.map((p) => p.acc),
        altitudeAccuracy: points.map((p) => p.altAcc),
        speed: points.map((p) => p.speed),                            // m/s, may be null
        heading: points.map((p) => p.heading),                        // degrees, may be null
      },
    }],
  };
}

async function buildFiles(meta) {
  const chunks = (await dbGetByRec('chunks', meta.id)).sort((a, b) => a.seq - b.seq);
  const points = (await dbGetByRec('points', meta.id)).sort((a, b) => a.t - b.t);
  const base = `geocam-${meta.id}`;
  const videoType = meta.mimeType.split(';')[0];
  const videoName = `${base}.${meta.ext}`;
  const video = new File(chunks.map((c) => c.blob), videoName, { type: videoType });
  const geo = new File([JSON.stringify(toGeoJSON(meta, points, videoName), null, 1)],
    `${base}.geojson`, { type: 'application/geo+json' });
  return [video, geo];
}

async function saveRecording(meta) {
  setStatus('Preparing files…');
  const files = await buildFiles(meta);

  // Desktop Chromium: write both files straight into a folder the user picks.
  if ('showDirectoryPicker' in window) {
    try {
      if (!dirHandle) dirHandle = await window.showDirectoryPicker({ id: 'geocam', mode: 'readwrite', startIn: 'videos' });
      if ((await dirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted' &&
          (await dirHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Folder permission denied');
      for (const f of files) {
        const fh = await dirHandle.getFileHandle(f.name, { create: true });
        const w = await fh.createWritable();
        await w.write(f);
        await w.close();
      }
      setStatus(`Saved to folder “${dirHandle.name}”: ${files.map((f) => f.name).join(', ')}`);
      return;
    } catch (e) {
      if (e.name === 'AbortError') { setStatus('Save cancelled.'); return; }
      console.warn('Folder save failed, falling back to download', e);
      dirHandle = null;
    }
  }
  // Everywhere else: regular downloads (Android → Downloads folder, iOS → Files prompt).
  for (const f of files) {
    downloadFile(f);
    await new Promise((r) => setTimeout(r, 400));   // avoid browsers collapsing back-to-back downloads
  }
  setStatus(`Downloaded ${files.map((f) => f.name).join(' + ')}`);
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function shareRecording(meta) {
  setStatus('Preparing files…');
  const [video, geo] = await buildFiles(meta);
  try {
    if (navigator.canShare?.({ files: [video, geo] })) {
      await navigator.share({ files: [video, geo], title: video.name });
    } else if (navigator.canShare?.({ files: [video] })) {
      // Some share targets reject .geojson — share the video and download the track.
      downloadFile(geo);
      await navigator.share({ files: [video], title: video.name });
    } else {
      setStatus('Sharing files is not supported here — use Save.', true);
      return;
    }
    setStatus('Shared.');
  } catch (e) {
    setStatus(e.name === 'AbortError' ? 'Share cancelled.' : `Share failed: ${e.message}`, e.name !== 'AbortError');
  }
}

async function playRecording(meta) {
  if (current) return;
  const [video] = await buildFiles(meta);
  stopCamera();
  recordBtn.disabled = true;
  startCamBtn.textContent = 'Back to camera';
  preview.srcObject = null;
  if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
  preview.dataset.url = URL.createObjectURL(video);
  preview.src = preview.dataset.url;
  preview.muted = false;
  preview.controls = true;
  preview.play().catch(() => {});
  setStatus(`Playing ${video.name}`);
}
function resetPreview() {
  preview.pause();
  preview.removeAttribute('src');
  preview.controls = false;
  preview.muted = true;
  if (preview.dataset.url) { URL.revokeObjectURL(preview.dataset.url); delete preview.dataset.url; }
}

// ---------- Recordings list ----------
async function renderList() {
  const recs = (await dbGetAll('recordings')).sort((a, b) => b.startedAt - a.startedAt);
  listEl.replaceChildren();
  if (!recs.length) {
    listEl.innerHTML = '<li class="muted">No recordings yet.</li>';
  }
  for (const r of recs) {
    const li = document.createElement('li');
    const interrupted = !r.endedAt && (!current || current.id !== r.id);
    const live = current && current.id === r.id;
    li.innerHTML = `
      <div class="title">${new Date(r.startedAt).toLocaleString()}</div>
      <div class="meta">
        ${live ? 'Recording…' : r.endedAt ? fmtDuration(r.endedAt - r.startedAt) : '<span class="warn">interrupted — recoverable</span>'}
        · ${fmtBytes(r.bytes)} · ${r.pointCount} pts${r.netPointCount ? ` (${r.netPointCount} network)` : ''} · ${r.ext.toUpperCase()}
      </div>
      <div class="actions"></div>`;
    if (!live) {
      const actions = li.querySelector('.actions');
      const btn = (label, fn, cls) => {
        const b = Object.assign(document.createElement('button'), { textContent: label });
        if (cls) b.className = cls;
        b.onclick = () => fn().catch((e) => setStatus(e.message, true));
        actions.append(b);
      };
      btn('Play', () => playRecording(r));
      btn('Save', () => saveRecording(r));
      if (navigator.canShare) btn('Share', () => shareRecording(r));
      btn('Delete', async () => {
        if (!confirm('Delete this recording from the app?')) return;
        await dbDeleteRecording(r.id);
        renderList();
      }, 'danger');
      if (interrupted) {
        // Patch metadata for a crashed session so exports have a sane end time.
        r.endedAt = r.startedAt + r.chunkCount * CHUNK_MS;
      }
    }
    listEl.append(li);
  }
  updateStorage();
}

async function updateStorage() {
  if (!navigator.storage?.estimate) return;
  const { usage, quota } = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  storageEl.textContent = `${fmtBytes(usage)} used of ${fmtBytes(quota)}${persisted ? ' · persistent' : ''}`;
}

// ---------- Utils ----------
function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return h ? `${h}:${mmss}` : mmss;
}
function fmtBytes(b = 0) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
}

// ---------- Settings UI ----------
const netFallbackEl = $('netFallback'), weakAccEl = $('weakAcc');
netFallbackEl.checked = settings.netFallback;
weakAccEl.value = String(settings.weakAcc);
netFallbackEl.onchange = () => {
  settings.netFallback = netFallbackEl.checked;
  saveSettings();
  if (settings.netFallback && geoWatch !== null) startNet();
  if (!settings.netFallback) stopNet();
};
weakAccEl.onchange = () => { settings.weakAcc = Number(weakAccEl.value); saveSettings(); updateGpsInfo(); };

// ---------- Wire up ----------
startCamBtn.onclick = () => { resetPreview(); startCamera(); };
cameraSelect.onchange = () => { if (stream) startCamera(); };
recordBtn.onclick = () => (current ? stopRecording() : startRecording());
window.addEventListener('beforeunload', (e) => { if (current) { e.preventDefault(); e.returnValue = ''; } });

if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
  setStatus(insecureMessage(), true);
} else {
  // Start the camera automatically if the user already allowed it earlier;
  // otherwise wait for the "Start camera" tap (browsers prompt more reliably on a click).
  navigator.permissions?.query({ name: 'camera' })
    .then((p) => { if (p.state === 'granted') startCamera(); else setStatus('Tap "Start camera" to begin.'); })
    .catch(() => setStatus('Tap "Start camera" to begin.'));
  navigator.mediaDevices.addEventListener?.('devicechange', () => { if (!current) refreshCameraList().catch(() => {}); });
}

// ---------- Offline readiness ----------
const offlineBadge = $('offlineBadge');
function setBadge(text, cls) { offlineBadge.textContent = text; offlineBadge.className = `badge ${cls || ''}`; }
function checkOffline() {
  const ctrl = navigator.serviceWorker?.controller;
  if (!ctrl) {
    setBadge(navigator.onLine
      ? 'Preparing offline mode… reload once to finish.'
      : 'Not available offline yet — open the app once with internet.', 'bad');
    return;
  }
  ctrl.postMessage('offline-status');
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'offline-status') return;
    const net = navigator.onLine ? 'online' : 'offline';
    if (e.data.ready) setBadge(`✓ Ready to use without internet (currently ${net})`, 'ok');
    else setBadge(`Offline files incomplete (missing ${e.data.missing.join(', ')}). Reload with internet.`, 'bad');
  });
  navigator.serviceWorker.addEventListener('controllerchange', checkOffline);
  navigator.serviceWorker.ready.then(checkOffline);
  window.addEventListener('online', checkOffline);
  window.addEventListener('offline', checkOffline);
  checkOffline();
} else {
  setBadge('This browser cannot run the app offline.', 'bad');
}

renderList();
