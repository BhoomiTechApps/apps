let pdfDoc = null;
let currentZoom = 1.0;
let currentFile = null;
let currentPage = 1;
let totalPages = 0;

// --- Perspective Correction State ---
let perspectiveMode = false;
let corners = [];
let draggingCorner = -1;
let originalImageSnapshot = null;

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
});

async function handleFileSelect(input) {
  currentFile = input.files[0];
  updateFileName(input);
  if (!currentFile) return;
  exitPerspectiveMode(false);
  if (currentFile.type === "application/pdf") {
    await loadPDF(currentFile);
  } else {
    document.querySelector('.pagination-controls').style.display = 'none';
    await processImage(currentFile);
  }
}

async function startOCR() {
  if (!currentFile) {
    alert("Please select a file first.");
    return;
  }
  if (perspectiveMode) {
    alert("Please apply or cancel perspective correction first.");
    return;
  }
  await runTesseract();
}

async function loadPDF(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  pdfDoc = await pdfjsLib.getDocument({ data }).promise;
  totalPages = pdfDoc.numPages;
  currentPage = 1;
  document.getElementById("pageCount").innerText = totalPages;
  document.getElementById("pageJump").value = currentPage;
  document.querySelector('.pagination-controls').style.display = 'flex';
  updatePaginationButtons();
  await renderPage(currentPage);
}

async function renderPage(num) {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(num);
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const viewport = page.getViewport({ scale: currentZoom * 2 });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
}

async function changePage(delta) {
  const newPage = currentPage + delta;
  if (newPage >= 1 && newPage <= totalPages) {
    currentPage = newPage;
    document.getElementById("pageJump").value = currentPage;
    updatePaginationButtons();
    await renderPage(currentPage);
  }
}

async function jumpToPage() {
  const jumpInput = document.getElementById("pageJump");
  let val = parseInt(jumpInput.value);
  if (val >= 1 && val <= totalPages) {
    currentPage = val;
    updatePaginationButtons();
    await renderPage(currentPage);
  } else {
    jumpInput.value = currentPage;
  }
}

function updatePaginationButtons() {
  document.getElementById("prevPage").disabled = (currentPage <= 1);
  document.getElementById("nextPage").disabled = (currentPage >= totalPages);
}

async function processImage(file) {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await new Promise((resolve) => {
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      resolve();
    };
  });
}

async function runTesseract() {
  const canvas = document.getElementById("canvas");
  const lang = document.getElementById("lang").value;
  const progressBar = document.getElementById("ocrProgress");
  const progressText = document.getElementById("progressText");
  progressBar.style.display = "inline-block";
  progressText.style.display = "inline-block";
  const result = await Tesseract.recognize(canvas, lang, {
    logger: m => {
      if (m.status === 'recognizing text') {
        const percentage = Math.round(m.progress * 100);
        progressBar.value = percentage;
        progressText.innerText = percentage + "%";
      }
    }
  });
  document.getElementById("output").value = result.data.text;
  progressBar.value = 100;
  progressText.innerText = "Done!";
  setTimeout(() => {
    progressBar.style.display = "none";
    progressText.style.display = "none";
  }, 2000);
}

async function changeZoom(delta) {
  let newZoom = parseFloat((currentZoom + delta).toFixed(1));
  currentZoom = Math.max(0.5, Math.min(3, newZoom));
  document.getElementById("zoomLevel").innerText = Math.round(currentZoom * 100) + "%";
  const wrapper = document.getElementById('canvasWrapper');
  if (currentZoom > 1.0) {
    wrapper.classList.add('zoomed');
  } else {
    wrapper.classList.remove('zoomed');
  }
  if (perspectiveMode) {
    drawCornersOverlay();
  } else if (pdfDoc) {
    await renderPage(currentPage);
  } else if (currentFile) {
    await processImage(currentFile);
  }
}

function copyText() {
  const text = document.getElementById("output").value;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copyBtn");
    if (btn) {
      btn.innerHTML = '<i data-lucide="check"></i>';
      lucide.createIcons();
      setTimeout(() => {
        btn.innerHTML = '<i data-lucide="copy"></i>';
        lucide.createIcons();
      }, 2000);
    }
  });
}

function updateFileName(input) {
  const display = document.getElementById('fileNameDisplay');
  display.innerText = input.files[0] ? input.files[0].name : "No file chosen";
}

// ============================================================
//  DESKEW
// ============================================================

async function deskewCanvas() {
  const canvas = document.getElementById("canvas");
  if (canvas.width === 0) return;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const angle = detectSkewAngle(imageData);

  if (Math.abs(angle) < 0.2) {
    showToast("No significant skew detected.");
    return;
  }

  const rad = angle * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = Math.floor(canvas.width * cos + canvas.height * sin);
  const newH = Math.floor(canvas.height * cos + canvas.width * sin);

  const temp = document.createElement("canvas");
  temp.width = newW;
  temp.height = newH;
  const tCtx = temp.getContext("2d");
  tCtx.fillStyle = "white";
  tCtx.fillRect(0, 0, newW, newH);
  tCtx.translate(newW / 2, newH / 2);
  tCtx.rotate(-rad);
  tCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

  canvas.width = newW;
  canvas.height = newH;
  ctx.drawImage(temp, 0, 0);
  showToast(`Deskewed ${angle.toFixed(1)}\u00b0`);
}

function detectSkewAngle(imageData) {
  const { data, width, height } = imageData;
  let bestAngle = 0;
  let bestScore = -Infinity;

  const binary = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    binary[i] = (0.299 * r + 0.587 * g + 0.114 * b) < 128 ? 1 : 0;
  }

  for (let angleTenth = -100; angleTenth <= 100; angleTenth += 5) {
    const angle = angleTenth / 10;
    const rad = angle * Math.PI / 180;
    const projections = new Array(height).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (binary[y * width + x]) {
          const newY = Math.round(y * Math.cos(rad) - x * Math.sin(rad));
          if (newY >= 0 && newY < height) projections[newY]++;
        }
      }
    }
    const mean = projections.reduce((a, b) => a + b, 0) / projections.length;
    const variance = projections.reduce((s, v) => s + (v - mean) ** 2, 0);
    if (variance > bestScore) {
      bestScore = variance;
      bestAngle = angle;
    }
  }
  return bestAngle;
}

// ============================================================
//  PERSPECTIVE CORRECTION
// ============================================================

function enterPerspectiveMode() {
  const canvas = document.getElementById("canvas");
  if (canvas.width === 0) { alert("Please load an image first."); return; }

  perspectiveMode = true;

  const snap = document.createElement("canvas");
  snap.width = canvas.width;
  snap.height = canvas.height;
  snap.getContext("2d").drawImage(canvas, 0, 0);
  originalImageSnapshot = snap;

  const w = canvas.width, h = canvas.height;
  const pad = Math.min(w, h) * 0.05;
  corners = [
    { x: pad,     y: pad },
    { x: w - pad, y: pad },
    { x: w - pad, y: h - pad },
    { x: pad,     y: h - pad },
  ];

  document.getElementById("perspectiveToolbar").style.display = "flex";
  document.getElementById("normalToolbar").style.display = "none";

  drawCornersOverlay();
  attachCanvasListeners();
}

function exitPerspectiveMode(restore = true) {
  perspectiveMode = false;
  detachCanvasListeners();
  document.getElementById("perspectiveToolbar").style.display = "none";
  document.getElementById("normalToolbar").style.display = "flex";

  if (restore && originalImageSnapshot) {
    const canvas = document.getElementById("canvas");
    canvas.width = originalImageSnapshot.width;
    canvas.height = originalImageSnapshot.height;
    canvas.getContext("2d").drawImage(originalImageSnapshot, 0, 0);
  }
  originalImageSnapshot = null;
  corners = [];
}

function applyPerspectiveCorrection() {
  if (corners.length !== 4) return;

  const src    = corners;
  const width  = Math.round(Math.max(dist(src[0], src[1]), dist(src[3], src[2])));
  const height = Math.round(Math.max(dist(src[0], src[3]), dist(src[1], src[2])));

  const dst = [
    { x: 0,     y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0,     y: height },
  ];

  const H        = computeHomography(src, dst);
  const srcCanvas = originalImageSnapshot;
  const dstCanvas = document.getElementById("canvas");
  dstCanvas.width  = width;
  dstCanvas.height = height;
  const dstCtx   = dstCanvas.getContext("2d");
  const srcCtx   = srcCanvas.getContext("2d");
  const srcData  = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const dstData  = dstCtx.createImageData(width, height);
  const Hinv     = invertHomography(H);

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const { x: sx, y: sy } = applyHomography(Hinv, dx, dy);
      const sxi = Math.round(sx), syi = Math.round(sy);
      const di  = (dy * width + dx) * 4;
      if (sxi >= 0 && sxi < srcCanvas.width && syi >= 0 && syi < srcCanvas.height) {
        const si = (syi * srcCanvas.width + sxi) * 4;
        dstData.data[di]     = srcData.data[si];
        dstData.data[di + 1] = srcData.data[si + 1];
        dstData.data[di + 2] = srcData.data[si + 2];
        dstData.data[di + 3] = srcData.data[si + 3];
      } else {
        dstData.data[di + 3] = 255;
      }
    }
  }
  dstCtx.putImageData(dstData, 0, 0);
  exitPerspectiveMode(false);
  showToast("Perspective corrected!");
}

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function computeHomography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([ sx, sy, 1,  0,  0,  0, -dx * sx, -dx * sy ]);
    b.push(dx);
    A.push([  0,  0,  0, sx, sy, 1, -dy * sx, -dy * sy ]);
    b.push(dy);
  }
  const h = gaussianElimination(A, b);
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1   ],
  ];
}

function applyHomography(H, x, y) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return {
    x: (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
    y: (H[1][0] * x + H[1][1] * y + H[1][2]) / w,
  };
}

function invertHomography(H) {
  const m = H.map(r => [...r]);
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  return [
    [
      (m[1][1]*m[2][2] - m[1][2]*m[2][1]) / det,
      (m[0][2]*m[2][1] - m[0][1]*m[2][2]) / det,
      (m[0][1]*m[1][2] - m[0][2]*m[1][1]) / det,
    ],
    [
      (m[1][2]*m[2][0] - m[1][0]*m[2][2]) / det,
      (m[0][0]*m[2][2] - m[0][2]*m[2][0]) / det,
      (m[0][2]*m[1][0] - m[0][0]*m[1][2]) / det,
    ],
    [
      (m[1][0]*m[2][1] - m[1][1]*m[2][0]) / det,
      (m[0][1]*m[2][0] - m[0][0]*m[2][1]) / det,
      (m[0][0]*m[1][1] - m[0][1]*m[1][0]) / det,
    ],
  ];
}

function gaussianElimination(A, b) {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];
    [b[col], b[maxRow]] = [b[maxRow], b[col]];
    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / A[col][col];
      for (let k = col; k < n; k++) A[row][k] -= factor * A[col][k];
      b[row] -= factor * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = b[i] / A[i][i];
    for (let k = i - 1; k >= 0; k--) b[k] -= A[k][i] * x[i];
  }
  return x;
}

function drawCornersOverlay() {
  const canvas = document.getElementById("canvas");
  const ctx    = canvas.getContext("2d");
  ctx.drawImage(originalImageSnapshot, 0, 0);

  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.strokeStyle = "rgba(37,99,235,0.85)";
  ctx.lineWidth   = Math.max(2, canvas.width / 300);
  ctx.setLineDash([10, 6]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 3; i >= 1; i--) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill("evenodd");
  ctx.restore();

  const r      = Math.max(12, canvas.width / 50);
  const labels = ["TL", "TR", "BR", "BL"];
  const colors = ["#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];
  corners.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = colors[i];
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "white";
    ctx.font = `bold ${Math.max(10, r * 0.8)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(labels[i], c.x, c.y);
  });
}

function getCanvasPos(e) {
  const canvas = document.getElementById("canvas");
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top)  * scaleY,
  };
}

function findNearestCorner(pos) {
  const canvas    = document.getElementById("canvas");
  const threshold = Math.max(30, canvas.width / 25);
  let best = -1, bestD = Infinity;
  corners.forEach((c, i) => {
    const d = dist(c, pos);
    if (d < threshold && d < bestD) { best = i; bestD = d; }
  });
  return best;
}

function onMouseDown(e) {
  if (!perspectiveMode) return;
  e.preventDefault();
  draggingCorner = findNearestCorner(getCanvasPos(e));
}

function onMouseMove(e) {
  if (!perspectiveMode || draggingCorner === -1) return;
  e.preventDefault();
  corners[draggingCorner] = getCanvasPos(e);
  drawCornersOverlay();
}

function onMouseUp() { draggingCorner = -1; }

function attachCanvasListeners() {
  const canvas = document.getElementById("canvas");
  canvas.addEventListener("mousedown",  onMouseDown);
  canvas.addEventListener("mousemove",  onMouseMove);
  canvas.addEventListener("mouseup",    onMouseUp);
  canvas.addEventListener("touchstart", onMouseDown, { passive: false });
  canvas.addEventListener("touchmove",  onMouseMove, { passive: false });
  canvas.addEventListener("touchend",   onMouseUp);
}

function detachCanvasListeners() {
  const canvas = document.getElementById("canvas");
  canvas.removeEventListener("mousedown",  onMouseDown);
  canvas.removeEventListener("mousemove",  onMouseMove);
  canvas.removeEventListener("mouseup",    onMouseUp);
  canvas.removeEventListener("touchstart", onMouseDown);
  canvas.removeEventListener("touchmove",  onMouseMove);
  canvas.removeEventListener("touchend",   onMouseUp);
}

// ============================================================
//  WAV RECORDER  (Web Audio API — raw PCM, no extra libraries)
// ============================================================

let audioCtx        = null;
let micStream       = null;
let scriptProcessor = null;
let pcmBuffers      = [];     // Float32Array chunks collected during recording
let isRecording     = false;
let recTimerID      = null;
let recSeconds      = 0;

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4096;

async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    showToast("Microphone access denied.");
    return;
  }

  audioCtx        = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
  const source    = audioCtx.createMediaStreamSource(micStream);
  scriptProcessor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
  pcmBuffers      = [];

  scriptProcessor.onaudioprocess = (e) => {
    // Clone the buffer — it is recycled by the browser after the callback returns
    pcmBuffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };

  source.connect(scriptProcessor);
  scriptProcessor.connect(audioCtx.destination); // must be connected to run in all browsers

  isRecording = true;
  recSeconds  = 0;
  updateRecordBtn();
  recTimerID  = setInterval(() => { recSeconds++; updateRecordBtn(); }, 1000);
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  clearInterval(recTimerID);

  scriptProcessor.disconnect();
  scriptProcessor.onaudioprocess = null;
  micStream.getTracks().forEach(t => t.stop());
  audioCtx.close();

  updateRecordBtn();
  exportWav();
}

function updateRecordBtn() {
  const btn   = document.getElementById("recordBtn");
  const label = document.getElementById("recordLabel");
  const timer = document.getElementById("recordTimer");
  if (!btn) return;

  if (isRecording) {
    btn.classList.add("recording");
    label.textContent = "Stop";
    const m = String(Math.floor(recSeconds / 60)).padStart(2, "0");
    const s = String(recSeconds % 60).padStart(2, "0");
    timer.textContent  = `${m}:${s}`;
    timer.style.display = "inline";
  } else {
    btn.classList.remove("recording");
    label.textContent   = "Record";
    timer.style.display = "none";
  }
  lucide.createIcons();
}

// Merge PCM chunks → convert to int16 → pack WAV header → download
function exportWav() {
  if (pcmBuffers.length === 0) return;

  const totalSamples = pcmBuffers.reduce((n, b) => n + b.length, 0);
  const merged = new Float32Array(totalSamples);
  let offset = 0;
  for (const buf of pcmBuffers) { merged.set(buf, offset); offset += buf.length; }

  // Float32 [-1, 1]  →  Int16 PCM
  const pcm16 = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const s   = Math.max(-1, Math.min(1, merged[i]));
    pcm16[i]  = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  const wavBuf = buildWavBuffer(pcm16, SAMPLE_RATE, 1);
  const blob   = new Blob([wavBuf], { type: "audio/wav" });
  const url    = URL.createObjectURL(blob);
  const base   = currentFile ? currentFile.name.replace(/\.[^.]+$/, "") : "recording";
  const a      = document.createElement("a");
  a.href       = url;
  a.download   = `${base}_narration.wav`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("WAV saved!");
}

// Build a valid RIFF/WAV ArrayBuffer from 16-bit PCM samples
function buildWavBuffer(pcm16, sampleRate, numChannels) {
  const bitsPerSample  = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataBytes      = pcm16.length * bytesPerSample;
  const buffer         = new ArrayBuffer(44 + dataBytes);
  const view           = new DataView(buffer);

  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  str(0,  "RIFF");
  view.setUint32( 4, 36 + dataBytes,                         true); // ChunkSize
  str(8,  "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16,                                     true); // Subchunk1Size (PCM)
  view.setUint16(20, 1,                                      true); // AudioFormat   (PCM = 1)
  view.setUint16(22, numChannels,                            true);
  view.setUint32(24, sampleRate,                             true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // ByteRate
  view.setUint16(32, numChannels * bytesPerSample,           true); // BlockAlign
  view.setUint16(34, bitsPerSample,                          true);
  str(36, "data");
  view.setUint32(40, dataBytes,                              true);

  // Write PCM samples starting at byte 44
  new Int16Array(buffer, 44).set(pcm16);

  return buffer;
}

// ============================================================
//  TOAST
// ============================================================
function showToast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2500);
}
