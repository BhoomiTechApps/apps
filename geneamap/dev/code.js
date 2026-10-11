/* ════════════════════════════════════════════════════════════
   GENEAMAP — family tree builder (PWA)
   Everything lives inside one closure: nothing is exposed on window,
   so the app's state and functions can't be reached from the console.
   ════════════════════════════════════════════════════════════ */
(() => {
'use strict';

// ── CONSTANTS ──────────────────────────────────────────────
const APP_VERSION = '3.0.0';
const SVGNS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'geneamap:autosave:v1';
const VIEW_KEY = 'geneamap:view:v1';
const PREFS_KEY = 'geneamap:prefs:v1';
const ACC_KEY = 'geneamap:accordion:v1';
const frameEl = document.getElementById('gm-frame');
const SCRIPT_SRC = document.currentScript?.src || '';
const HISTORY_LIMIT = 120;
const MIN_SCALE = 0.1, MAX_SCALE = 3;
const GRID = 40;
const DEFAULT_SIZE = { w: 150, h: 60 };
const CONN_TYPES = ['parent', 'spouse', 'sibling', 'other'];
/* Export (PNG) always uses the light "Stone" palette — printer friendly */
const EXPORT_PAL = {
  bg: '#e8e6e0', text: '#23221f', muted: '#5b5953', card: '#f2f1ec', border: 'rgba(0,0,0,.09)', imported: '#e4ebf1',
  conn: { parent: '#4a4842', spouse: '#c0561a', sibling: '#1f8a66', other: '#8f8c84' },
  g: { male: '#3d6f9e', female: '#a8507f', neutral: '#8a877f' },
  tint: { male: '#e9ebec', female: '#efe7e9', neutral: '#ecebe6' },
};
const EXPORT_FONT = "'Onest GM', system-ui, sans-serif";
/* Live palette for canvas drawing (minimap), read from the CSS theme tokens */
let PAL = null;
function palette() {
  if (PAL) return PAL;
  const cs = getComputedStyle(frameEl), v = n => cs.getPropertyValue('--gm-' + n).trim();
  return (PAL = {
    conn: { parent: v('conn-parent'), spouse: v('conn-spouse'), sibling: v('conn-sibling'), other: v('conn-other') },
    g: { male: v('male'), female: v('female'), neutral: v('neutral') },
    sel: v('accent'), imported: v('info'),
  });
}
const CONN_DASH = { parent: [], spouse: [8, 4], sibling: [4, 4], other: [2, 5] };
const CONN_LABEL = { spouse: '\u2665\uFE0E', sibling: '≡', other: '~' };   // U+FE0E: text glyph, never an emoji
const GENDERS = ['male', 'female', 'neutral'];
const NARROW_MQ = window.matchMedia('(max-width: 860px)');

// ── ICONS: one table of 24-unit line icons, used by HTML (data-icon) and JS ──
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  userPlus: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M19 8v6M16 11h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  fileNew: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  saveAs: '<path d="M11 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v3"/><path d="M7 3v5h8M7 21v-6h4M18.5 13.5l2 2-5.5 5.5H13v-2z"/>',
  merge: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 9c0 2.5 2.5 3 5 3h5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  layout: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>',
  rings: '<circle cx="9" cy="14" r="5"/><circle cx="15" cy="10" r="5"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  selectAll: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="m8 12 3 3 5-6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  install: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 7v7M9 11l3 3 3-3M10 18h4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  male: '<circle cx="10" cy="14" r="5"/><path d="M13.5 10.5 20 4M15 4h5v5"/>',
  female: '<circle cx="12" cy="9" r="5"/><path d="M12 14v7M9 18h6"/>',
  neutral: '<circle cx="12" cy="12" r="5"/><path d="M12 3v4M12 17v4"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  alert: '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  stop: '<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z"/><path d="M12 8v4M12 16h.01"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  paste: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  sides: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-4M4 4v3h3M4 13a8 8 0 0 0 14.9 4M20 20v-3h-3"/>',
  flip: '<path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13v-4M9 7h6M9 11h4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
};
const icon = name => ICONS[name]
  ? `<svg class="gm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`
  : '';
function fillIcons(root = document) {
  for (const el of root.querySelectorAll('i[data-icon]:empty')) el.innerHTML = icon(el.dataset.icon);
}

// ── STATE ──────────────────────────────────────────────────
const emptyState = () => ({ title: 'Family Tree', nodes: {}, connections: {} });
let state = emptyState();
const view = { x: 60, y: 60, scale: 1 };
const sel = { nodes: new Set(), primary: null, conn: null };
let connectMode = false;
let connectSource = null;
let pendingConn = null;            // { from, to } awaiting type choice
let editingNodeId = null;
let pendingAddPos = null;          // world position chosen via double-tap / menu
let selectedGender = 'neutral';
let counters = { n: 0, c: 0 };
const CARD_DEFAULTS = { photo: true, place: true, notes: true, other: false, clan: false, occupation: false };
let prefs = { minimap: true, theme: 'light', card: { ...CARD_DEFAULTS }, autoFile: true };
// Optional details kept with each person (saved in files and GEDCOM; shown on cards only if chosen under View)
const EXTRA_FIELDS = ['other', 'clan', 'title', 'occupation', 'residence', 'deathPlace', 'birthOrder', 'source'];
let formPhoto = null;   // photo id chosen in the person form
const effectiveTheme = () => (prefs.theme === 'dark' ? 'dark' : 'light');

// ── DOM ────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const canvasWrap = $('canvas-wrap');
const canvasTx   = $('canvas-transform');
const svgLayer   = $('svg-layer');
const nodesLayer = $('nodes-layer');
const gridLayer  = $('grid-layer');
const linkPreview = $('link-preview');

// DOM caches / indexes — avoid querySelectorAll and layout reads in hot paths
const nodeEls   = new Map();   // nodeId → element
const nodeSize  = new Map();   // nodeId → { w, h }
const connEls   = new Map();   // connId → { g, hit, line, label }
const adjacency = new Map();   // nodeId → Set<connId>
let wrapRect = canvasWrap.getBoundingClientRect();

// ── HELPERS ────────────────────────────────────────────────
const uid  = () => `n${++counters.n}_${Date.now().toString(36)}`;
const cuid = () => `c${++counters.c}_${Date.now().toString(36)}`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sizeOf = id => nodeSize.get(id) || DEFAULT_SIZE;
const isTypingTarget = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => HTML_ESC[c]);
const displayName = n => (n && n.name) || 'Unknown';
const lifeSpan = n => [n.birth, n.death].filter(Boolean).join(' – ');

function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoking synchronously cancels the download in some browsers
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fileSafe = s => (s || 'Family_Tree').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_');

// ── TOAST / STATUS ─────────────────────────────────────────
let toastTimer = 0;
/** Messages may start with ⛔ / ⚠ — that becomes the toast's coloured stripe instead of an emoji */
function splitLevel(msg) {
  const m = /^\s*(⛔|⚠️?|✓)\s*/u.exec(String(msg ?? ''));
  if (!m) return { text: String(msg ?? ''), kind: '' };
  return { text: String(msg).slice(m[0].length), kind: m[1] === '⛔' ? 'error' : m[1] === '✓' ? 'ok' : 'warn' };
}
function toast(msg, opts = {}) {
  const el = $('toast'), btn = $('toast-action');
  const { text, kind } = splitLevel(msg);
  $('toast-msg').textContent = text;
  el.classList.remove('ok', 'error', 'warn');
  if (opts.kind || kind) el.classList.add(opts.kind || kind);
  if (opts.action) {
    btn.textContent = opts.action.label;
    btn.hidden = false;
    btn.onclick = () => { el.classList.remove('show'); opts.action.fn(); };
  } else {
    btn.hidden = true; btn.onclick = null;
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), opts.duration || (opts.action ? 6000 : 2200));
}
const DEFAULT_STATUS = 'Tap a person to select · drag to move · long-press or right-click for options';
function setStatus(msg) {
  const { text, kind } = splitLevel(msg || DEFAULT_STATUS);
  const bar = $('statusbar');
  bar.textContent = text;
  bar.classList.toggle('is-bad', kind === 'error');
}

function updateStats() {
  const n = Object.keys(state.nodes).length;
  $('stat-nodes').textContent = n;
  $('stat-conns').textContent = Object.keys(state.connections).length;
  $('map-meta').textContent = n;
  $('map-meta').title = `${n} ${n === 1 ? 'person' : 'people'}`;
  $('empty-hint').hidden = n > 0;
  scheduleAudit();
}

// ════════════════════════════════════════════════════════════
//  RENDER SCHEDULER — batch all DOM writes into one frame
// ════════════════════════════════════════════════════════════
const dirty = { transform: false, conns: new Set(), allConns: false, minimap: false, viewport: false };
let frameReq = 0;
function schedule() { if (!frameReq) frameReq = requestAnimationFrame(flushFrame); }
function flushFrame() {
  frameReq = 0;
  if (dirty.transform) { dirty.transform = false; writeTransform(); dirty.viewport = true; }
  if (dirty.allConns) {
    dirty.allConns = false; dirty.conns.clear();
    for (const id of connEls.keys()) updateConnPath(id);
  } else if (dirty.conns.size) {
    for (const id of dirty.conns) updateConnPath(id);
    dirty.conns.clear();
  }
  if (dirty.minimap) { dirty.minimap = false; dirty.viewport = true; drawMinimap(); }
  if (dirty.viewport) { dirty.viewport = false; drawMinimapViewport(); }
}
function requestTransform() { dirty.transform = true; markMoving(); schedule(); }
function markNodeMoved(id) {
  const set = adjacency.get(id);
  if (set) for (const cid of set) {
    dirty.conns.add(cid);
    // family lines start between partners, so a partner's parent links move too
    const c = state.connections[cid];
    if (c && c.type === 'spouse') {
      const other = c.from === id ? c.to : c.from;
      for (const oc of adjacency.get(other) || []) dirty.conns.add(oc);
    }
  }
  dirty.minimap = true;
  schedule();
}
function markAllConns() { dirty.allConns = true; dirty.minimap = true; schedule(); }

// "moving" class promotes the transform layer only while the view is changing
let movingTimer = 0;
function markMoving() {
  canvasWrap.classList.add('moving');
  clearTimeout(movingTimer);
  movingTimer = setTimeout(() => canvasWrap.classList.remove('moving'), 180);
}

// ── VIEW TRANSFORM ─────────────────────────────────────────
function writeTransform() {
  canvasTx.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`;
  let step = GRID * view.scale;
  while (step < 14) step *= 2;
  gridLayer.style.backgroundSize = `${step}px ${step}px`;
  gridLayer.style.backgroundPosition = `${view.x}px ${view.y}px`;
  $('zoom-level').textContent = Math.round(view.scale * 100) + '%';
  saveViewSoon();   // view only — never re-serialises the whole tree
}
function screenToCanvas(sx, sy) {
  return { x: (sx - wrapRect.left - view.x) / view.scale, y: (sy - wrapRect.top - view.y) / view.scale };
}
function zoomAt(cx, cy, factor) {
  const wx = cx - wrapRect.left, wy = cy - wrapRect.top;
  const s = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  view.x = wx - (wx - view.x) * (s / view.scale);
  view.y = wy - (wy - view.y) * (s / view.scale);
  view.scale = s;
  requestTransform();
}
function zoomCenter(factor) { zoomAt(wrapRect.left + wrapRect.width / 2, wrapRect.top + wrapRect.height / 2, factor); }

let viewAnim = 0;
function animateView(tx, ty, ts, dur = 420) {
  cancelAnimationFrame(viewAnim);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { Object.assign(view, { x: tx, y: ty, scale: ts }); requestTransform(); return Promise.resolve(); }
  const sx = view.x, sy = view.y, ss = view.scale, t0 = performance.now();
  const ease = t => (t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
  return new Promise(res => {
    const step = now => {
      const p = Math.min(1, (now - t0) / dur), e = ease(p);
      view.x = sx + (tx - sx) * e; view.y = sy + (ty - sy) * e; view.scale = ss + (ts - ss) * e;
      requestTransform();
      if (p < 1) viewAnim = requestAnimationFrame(step); else res();
    };
    viewAnim = requestAnimationFrame(step);
  });
}

function boundsOf(ids) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const n = state.nodes[id]; if (!n) continue;
    const s = sizeOf(id);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + s.w); maxY = Math.max(maxY, n.y + s.h);
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
function fitToIds(ids, { animate = true, maxScale = 1.5 } = {}) {
  const b = boundsOf(ids);
  if (!b) { if (!animate) requestTransform(); return; }
  const pad = wrapRect.width < 600 ? 28 : 60;
  const w = Math.max(1, wrapRect.width - pad * 2), h = Math.max(1, wrapRect.height - pad * 2);
  const s = clamp(Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY)), MIN_SCALE, maxScale);
  const tx = wrapRect.width / 2 - ((b.minX + b.maxX) / 2) * s;
  const ty = wrapRect.height / 2 - ((b.minY + b.maxY) / 2) * s;
  if (animate) animateView(tx, ty, s);
  else { Object.assign(view, { x: tx, y: ty, scale: s }); requestTransform(); }
}
function fitView(animate = true) { fitToIds(Object.keys(state.nodes), { animate }); }

function focusNode(id) {
  const node = state.nodes[id]; if (!node) return;
  setSelection([id]);
  const s = sizeOf(id);
  const ts = clamp(view.scale, 0.7, 1.4);
  const tx = wrapRect.width / 2 - (node.x + s.w / 2) * ts;
  const ty = wrapRect.height / 2 - (node.y + s.h / 2) * ts;
  animateView(tx, ty, ts).then(() => {
    const el = nodeEls.get(id); if (!el) return;
    el.classList.remove('search-highlight');
    void el.offsetWidth; // restart animation
    el.classList.add('search-highlight');
    setTimeout(() => el.classList.remove('search-highlight'), 2100);
  });
}

// ════════════════════════════════════════════════════════════
//  NODES
// ════════════════════════════════════════════════════════════
// Re-measure nodes when their content/font changes size
const nodeRO = new ResizeObserver(entries => {
  for (const e of entries) {
    const id = e.target.dataset.id;
    if (!state.nodes[id]) continue;
    const w = e.target.offsetWidth, h = e.target.offsetHeight;
    const old = nodeSize.get(id);
    if (!old || old.w !== w || old.h !== h) { nodeSize.set(id, { w, h }); markNodeMoved(id); }
  }
});

function nodeInner(node) {
  const dates = lifeSpan(node), cp = prefs.card, ph = cp.photo && node.photo && photos.get(node.photo);
  const kl = kinLabels.get(node.id);
  return (ph ? `<img class="node-photo" src="${ph}" alt="" draggable="false">` : '')
    + `<div class="node-actions">`
    + `<button type="button" class="node-action-btn edit-btn" data-action="edit" title="Edit" aria-label="Edit ${escHtml(displayName(node))}">${icon('edit')}</button>`
    + `<button type="button" class="node-action-btn" data-action="delete" title="Delete" aria-label="Delete ${escHtml(displayName(node))}">${icon('x')}</button>`
    + `</div>`
    + `<div class="node-name">${escHtml(displayName(node))}</div>`
    + (dates ? `<div class="node-dates">${escHtml(dates)}</div>` : '')
    + (cp.other && node.other ? `<div class="node-other">${escHtml(node.other)}</div>` : '')
    + (cp.place && node.place ? `<div class="node-dates">${icon('pin')}<span>${escHtml(node.place)}</span></div>` : '')
    + (cp.clan && node.clan ? `<div class="node-dates">${icon('users')}<span>${escHtml(node.clan)}</span></div>` : '')
    + (cp.occupation && node.occupation ? `<div class="node-dates">${icon('edit')}<span>${escHtml(node.occupation)}</span></div>` : '')
    + (cp.notes && node.notes ? `<div class="node-notes">${escHtml(node.notes)}</div>` : '')
    + (kl ? `<div class="node-kin${kl.local ? ' local' : ''}${kl.ego ? ' ego' : ''}${kl.unsure ? ' unsure' : ''}">${escHtml(kl.text)}</div>` : '')
    + (node.group ? `<div class="node-group-badge">${escHtml(node.group)}</div>` : '')
    + `<div class="node-handle" title="Drag to connect" aria-hidden="true"></div>`;
}
function nodeClass(node) {
  const g = GENDERS.includes(node.gender) ? node.gender : 'neutral';
  let c = `person-node ${g}`;
  if (node.group) c += ' imported';
  if (prefs.card.photo && node.photo && photos.has(node.photo)) c += ' has-photo';
  if (sel.nodes.has(node.id)) c += sel.nodes.size > 1 ? ' multi-selected' : ' selected';
  if (connectSource === node.id) c += ' connecting-source';
  if (pathHighlight.nodes.has(node.id)) c += ' path-hl';
  const iss = audit.node.get(node.id);
  if (iss === 'error' || iss === 'warn') c += ' issue-' + iss;
  return c;
}
function positionNode(el, node) { el.style.transform = `translate3d(${node.x}px, ${node.y}px, 0)`; }

/** Create/update a node element. `measure` forces an immediate size read. */
function renderNode(node, measure = true) {
  let el = nodeEls.get(node.id);
  if (!el) {
    el = document.createElement('div');
    el.dataset.id = node.id;
    el.setAttribute('role', 'button');
    nodeEls.set(node.id, el);
    nodesLayer.appendChild(el);
    nodeRO.observe(el);
  }
  el.className = nodeClass(node);
  el.innerHTML = nodeInner(node);
  el.setAttribute('aria-label', `${displayName(node)}${lifeSpan(node) ? ', ' + lifeSpan(node) : ''}`);
  positionNode(el, node);
  if (measure) { nodeSize.set(node.id, { w: el.offsetWidth, h: el.offsetHeight }); markNodeMoved(node.id); }
  return el;
}
function removeNodeEl(id) {
  const el = nodeEls.get(id);
  if (el) { nodeRO.unobserve(el); el.remove(); }
  nodeEls.delete(id); nodeSize.delete(id);
}
function refreshNodeClasses() {
  for (const [id, el] of nodeEls) { const n = state.nodes[id]; if (n) el.className = nodeClass(n); }
}

// ════════════════════════════════════════════════════════════
//  CONNECTIONS
// ════════════════════════════════════════════════════════════
function indexConn(c) {
  for (const id of [c.from, c.to]) {
    if (!adjacency.has(id)) adjacency.set(id, new Set());
    adjacency.get(id).add(c.id);
  }
}
function unindexConn(c) {
  adjacency.get(c.from)?.delete(c.id);
  adjacency.get(c.to)?.delete(c.id);
}

/** Geometry shared by the SVG renderer, PNG export and minimap */
function connGeometry(c) {
  const a = state.nodes[c.from], b = state.nodes[c.to];
  if (!a || !b) return null;
  const sa = sizeOf(c.from), sb = sizeOf(c.to);
  if (c.type === 'parent') {
    // When the child's two parents are partners, draw one family line from the middle of the couple
    const partner = coParentPartner(c);
    if (partner) {
      const p = state.nodes[partner], sp = sizeOf(partner);
      const fx = (a.x + sa.w / 2 + p.x + sp.w / 2) / 2;
      const fy = (a.y + sa.h / 2 + p.y + sp.h / 2) / 2;
      const tx = b.x + sb.w / 2, ty = b.y < fy ? b.y + sb.h : b.y;
      const my = (fy + ty) / 2;
      return { d: `M${fx},${fy} C${fx},${my} ${tx},${my} ${tx},${ty}`, mx: (fx + tx) / 2, my };
    }
    // parent → child: vertical curve from the parent's bottom edge to the child's top edge
    let fx = a.x + sa.w / 2, fy = a.y + sa.h, tx = b.x + sb.w / 2, ty = b.y;
    if (ty < fy) { fy = a.y; ty = b.y + sb.h; } // child placed above parent
    const my = (fy + ty) / 2;
    return { d: `M${fx},${fy} C${fx},${my} ${tx},${my} ${tx},${ty}`, mx: (fx + tx) / 2, my };
  }
  const fx = a.x + sa.w / 2, fy = a.y + sa.h / 2, tx = b.x + sb.w / 2, ty = b.y + sb.h / 2;
  const cx = fx + (tx - fx) / 2;
  return { d: `M${fx},${fy} C${cx},${fy} ${cx},${ty} ${tx},${ty}`, mx: (fx + tx) / 2, my: (fy + ty) / 2 };
}

/** For a parent link, return the child's other parent if the two parents are partners */
function coParentPartner(c) {
  const kids = adjacency.get(c.to);
  if (!kids) return null;
  for (const cid of kids) {
    const o = state.connections[cid];
    if (!o || o.id === c.id || o.type !== 'parent' || o.to !== c.to) continue;
    for (const sid of adjacency.get(c.from) || []) {
      const sc = state.connections[sid];
      if (sc && sc.type === 'spouse' && (sc.from === o.from || sc.to === o.from)) return o.from;
    }
  }
  return null;
}

function ensureConnEl(c) {
  let r = connEls.get(c.id);
  if (r && r.type === c.type) return r;
  if (r) r.g.remove();
  const g = document.createElementNS(SVGNS, 'g');
  g.dataset.id = c.id;
  const hit = document.createElementNS(SVGNS, 'path');
  hit.setAttribute('class', 'conn-hit');
  const line = document.createElementNS(SVGNS, 'path');
  line.setAttribute('class', 'conn-line');
  g.append(hit, line);
  let label = null;
  if (CONN_LABEL[c.type]) {
    label = document.createElementNS(SVGNS, 'text');
    label.setAttribute('class', 'conn-label');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = CONN_LABEL[c.type];
    g.appendChild(label);
  }
  svgLayer.insertBefore(g, linkPreview);
  r = { g, hit, line, label, type: c.type };
  connEls.set(c.id, r);
  updateConnClass(c.id);
  return r;
}
function updateConnClass(id) {
  const r = connEls.get(id), c = state.connections[id];
  if (!r || !c) return;
  let cls = `conn ${c.type}`;
  if (sel.conn === id) cls += ' selected';
  if (pathHighlight.conns.has(id)) cls += ' path-hl';
  const iss = audit.conn.get(id);
  if (iss === 'error' || iss === 'warn') cls += ' issue-' + iss;
  r.g.setAttribute('class', cls);
}
function updateConnPath(id) {
  const c = state.connections[id], r = connEls.get(id);
  if (!c || !r) return;
  const geo = connGeometry(c);
  if (!geo) return;
  r.hit.setAttribute('d', geo.d);
  r.line.setAttribute('d', geo.d);
  if (r.label) { r.label.setAttribute('x', geo.mx); r.label.setAttribute('y', geo.my - 5); }
}
function removeConnEl(id) {
  connEls.get(id)?.g.remove();
  connEls.delete(id);
}

// ── Full rebuild (load / undo / redo) ─────────────────────
function rebuildAll() {
  for (const el of nodeEls.values()) nodeRO.unobserve(el);
  nodesLayer.textContent = '';
  for (const r of connEls.values()) r.g.remove();
  nodeEls.clear(); nodeSize.clear(); connEls.clear(); adjacency.clear();

  const frag = document.createDocumentFragment();
  const nodes = Object.values(state.nodes);
  for (const n of nodes) {
    const el = document.createElement('div');
    el.dataset.id = n.id; el.setAttribute('role', 'button');
    el.className = nodeClass(n); el.innerHTML = nodeInner(n);
    el.setAttribute('aria-label', `${displayName(n)}${lifeSpan(n) ? ', ' + lifeSpan(n) : ''}`);
    positionNode(el, n);
    nodeEls.set(n.id, el);
    frag.appendChild(el);
  }
  nodesLayer.appendChild(frag);
  // one layout pass for all measurements
  for (const n of nodes) {
    const el = nodeEls.get(n.id);
    nodeSize.set(n.id, { w: el.offsetWidth, h: el.offsetHeight });
    nodeRO.observe(el);
  }
  for (const c of Object.values(state.connections)) { indexConn(c); ensureConnEl(c); }
  markAllConns();
  updateStats();
}

// ════════════════════════════════════════════════════════════
//  SELECTION
// ════════════════════════════════════════════════════════════
function setSelection(ids, primary) {
  const prevConn = sel.conn;
  sel.nodes = new Set(ids.filter(id => state.nodes[id]));
  sel.primary = primary && sel.nodes.has(primary) ? primary : [...sel.nodes].pop() || null;
  sel.conn = null;
  if (prevConn) updateConnClass(prevConn);
  refreshNodeClasses();
  onSelectionChanged();
}
function toggleSelected(id) {
  const ids = new Set(sel.nodes);
  if (ids.has(id)) ids.delete(id); else ids.add(id);
  setSelection([...ids], ids.has(id) ? id : undefined);
}
function selectConn(id) {
  const prev = sel.conn;
  sel.nodes.clear(); sel.primary = null; sel.conn = id;
  refreshNodeClasses();
  if (prev) updateConnClass(prev);
  updateConnClass(id);
  const c = state.connections[id];
  if (c) setStatus(`${connDescription(c)} — press Delete or long-press to remove`);
}
function clearSelection() {
  if (!sel.nodes.size && !sel.conn) return;
  setSelection([]);
}
function onSelectionChanged() {
  dirty.minimap = true; schedule();
  const count = sel.nodes.size;
  if (count === 1) {
    const node = state.nodes[sel.primary];
    populateForm(node);
    setStatus('Selected: ' + displayName(node));
  } else if (count > 1) {
    if (editingNodeId) clearForm();
    setStatus(`${count} people selected — drag to move together, Delete to remove`);
  } else {
    if (editingNodeId) clearForm();
    setStatus();
  }
}
function connDescription(c) {
  const a = displayName(state.nodes[c.from]), b = displayName(state.nodes[c.to]);
  switch (c.type) {
    case 'parent': return `${a} is parent of ${b}`;
    case 'spouse': return `${a} and ${b} are partners`;
    case 'sibling': return `${a} and ${b} are siblings`;
    default: return `${a} is linked to ${b}`;
  }
}

// Highlighted relationship path (from the Relationship Finder)
const pathHighlight = { nodes: new Set(), conns: new Set() };
function setPathHighlight(nodeIds, connIds) {
  const old = [...pathHighlight.conns];
  pathHighlight.nodes = new Set(nodeIds);
  pathHighlight.conns = new Set(connIds);
  refreshNodeClasses();
  for (const id of new Set([...old, ...connIds])) updateConnClass(id);
}
function clearPathHighlight() {
  if (pathHighlight.nodes.size || pathHighlight.conns.size) setPathHighlight([], []);
}

// ════════════════════════════════════════════════════════════
//  HISTORY (undo / redo) + AUTOSAVE
// ════════════════════════════════════════════════════════════
const hist = { stack: [], index: -1 };
const snapshot = () => JSON.stringify({ title: state.title, nodes: state.nodes, connections: state.connections });

function resetHistory() {
  hist.stack = [snapshot()];
  hist.index = 0;
  updateUndoButtons();
}
/** Record the current state as an undo step (call after every user mutation) */
function commit() {
  const s = snapshot();
  if (hist.stack[hist.index] === s) return;
  hist.stack.length = hist.index + 1;
  hist.stack.push(s);
  if (hist.stack.length > HISTORY_LIMIT) hist.stack.shift();
  hist.index = hist.stack.length - 1;
  updateUndoButtons();
  updateStats();
  autosave();
  if (hist.stack.length > 1) countChange();
  if (kinView.ego) refreshKinViewSoon();
}
function restoreSnapshot(s) {
  const d = JSON.parse(s);
  state = { title: d.title, nodes: d.nodes, connections: d.connections };
  $('f-map-title').value = state.title === 'Family Tree' ? '' : state.title;
  const keep = [...sel.nodes].filter(id => state.nodes[id]);
  sel.conn = null;
  if (editingNodeId && !state.nodes[editingNodeId]) clearForm();
  clearPathHighlight();
  cancelConnect();
  rebuildAll();
  setSelection(keep, sel.primary);
  if (editingNodeId && state.nodes[editingNodeId]) populateForm(state.nodes[editingNodeId]);
  autosave();
  countChange();
  if (kinView.ego) refreshKinViewSoon();
}
function undo() {
  if (hist.index <= 0) { toast('Nothing to undo'); return; }
  hist.index--;
  restoreSnapshot(hist.stack[hist.index]);
  updateUndoButtons();
  toast('Undone');
}
function redo() {
  if (hist.index >= hist.stack.length - 1) { toast('Nothing to redo'); return; }
  hist.index++;
  restoreSnapshot(hist.stack[hist.index]);
  updateUndoButtons();
  toast('Redone');
}
function updateUndoButtons() {
  $('btn-undo').disabled = hist.index <= 0;
  $('btn-redo').disabled = hist.index >= hist.stack.length - 1;
}

let lastSavedAt = 0;
async function writeAutosave() {
  const payload = { v: 4, state, savedAt: Date.now() };
  let ok = false;
  try { await flushPhotos(); await kvSet('autosave', payload); ok = true; } catch { /* IndexedDB unavailable */ }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); ok = true; } catch { /* full, or blocked */ }
  backup.mode = ok ? 'idb' : 'full';
  writeView();
  if (ok) lastSavedAt = Date.now();
  renderStorageStatus();
}
function writeView() {
  // the canvas size is stored too, so a view saved in one container size is not reused in a very different one
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ x: view.x, y: view.y, scale: view.scale, w: Math.round(wrapRect.width), h: Math.round(wrapRect.height) })); } catch { /* ignore */ }
}
function readView() {
  try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); return v && Number.isFinite(v.scale) ? v : null; } catch { return null; }
}
const autosave = debounce(writeAutosave, 400);
const saveViewSoon = debounce(writeView, 800);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosave.flush(); });
window.addEventListener('pagehide', () => { autosave.flush(); saveViewSoon.flush(); });

async function readAutosave() {
  let a = null, b = null;
  try { a = await kvGet('autosave'); } catch { /* ignore */ }
  try { b = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* ignore */ }
  if (a && b) return (b.savedAt || 0) > (a.savedAt || 0) ? b : a;
  return a || b;
}
function loadPrefs() {
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* ignore */ }
  if (prefs.theme !== 'dark') prefs.theme = 'light';   // older "auto" choice → the light default
  prefs.card = { ...CARD_DEFAULTS, ...(prefs.card && typeof prefs.card === 'object' ? prefs.card : {}) };
  delete prefs.legend;                                  // the legend now lives in the side panel
}
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }

// ════════════════════════════════════════════════════════════
//  PERSON FORM
// ════════════════════════════════════════════════════════════
const GENDER_CLASS = { male: 'active-m', female: 'active-f', neutral: 'active-n' };
function setGender(g) {
  queueMicrotask(updateFormIssuesSoon);
  selectedGender = GENDERS.includes(g) ? g : 'neutral';
  document.querySelectorAll('.gender-btn').forEach(btn => {
    const on = btn.dataset.g === selectedGender;
    btn.className = 'gender-btn' + (on ? ' ' + GENDER_CLASS[selectedGender] : '');
    btn.setAttribute('aria-checked', on);
  });
}
document.querySelectorAll('.gender-btn').forEach(btn => btn.addEventListener('click', () => setGender(btn.dataset.g)));

function populateForm(node) {
  if (!node) return;
  $('f-name').value  = node.name  || '';
  $('f-birth').value = node.birth || '';
  $('f-death').value = node.death || '';
  $('f-place').value = node.place || '';
  $('f-notes').value = node.notes || '';
  for (const k of EXTRA_FIELDS) $('f-' + k).value = node[k] || '';
  setFormPhoto(node.photo || null);
  updateMoreCount();
  setGender(node.gender || 'neutral');
  editingNodeId = node.id;
  pendingAddPos = null; pendingRelative = null;
  $('btn-save-person').textContent = 'Update person';
  $('form-title').textContent = 'Edit person';
  $('person-meta').innerHTML = '<span class="gm-pill accent">Editing</span>';
  updateFormIssues();
}
function clearForm() {
  ['f-name', 'f-birth', 'f-death', 'f-place', 'f-notes', ...EXTRA_FIELDS.map(k => 'f-' + k)].forEach(id => { $(id).value = ''; });
  setFormPhoto(null);
  updateMoreCount();
  setGender('neutral');
  editingNodeId = null;
  $('btn-save-person').textContent = 'Add to map';
  $('form-title').textContent = 'Add a person';
  $('person-meta').innerHTML = '';
  updateFormIssues();
}

/**
 * Live rule check for the form's current (unsaved) values.
 * Returns { issues, blocking } — blocking errors are ones this save would introduce.
 */
function formIssues() {
  const d = readForm();
  const self = { name: d.name || 'This person', gender: d.gender, birth: d.birth, death: d.death };
  const issues = personIssues(self);
  let blocking = issues.filter(i => i.level === 'error');
  if (editingNodeId && state.nodes[editingNodeId]) {
    const id = editingNodeId, people = { [id]: self };
    const had = personIssues(state.nodes[id]).filter(i => i.level === 'error').length;
    if (had) blocking = [];                                   // already broken before this edit — don't trap the user
    for (const c of linksOf(id)) {
      if (c.type === 'other') continue;
      const now = validateLink(c.from, c.to, c.type, { ignore: c.id, people }).issues.filter(i => i.kind === 'date' && i.level !== 'info');
      const before = validateLink(c.from, c.to, c.type, { ignore: c.id }).issues.filter(i => i.kind === 'date' && i.level === 'error').length;
      issues.push(...now);
      if (now.filter(i => i.level === 'error').length > before) blocking.push(...now.filter(i => i.level === 'error'));
    }
  } else if (pendingRelative && state.nodes[pendingRelative.id]) {
    const r = pendingRelative, people = { __new: self };
    const [f, t, type] = r.rel === 'parent' ? ['__new', r.id, 'parent'] : r.rel === 'child' ? [r.id, '__new', 'parent'] : [r.id, '__new', r.rel];
    const v = validateLink(f, t, type, { people });
    const list = v.issues.filter(i => i.level !== 'info');
    issues.push(...list);
    blocking.push(...list.filter(i => i.level === 'error'));
  }
  return { issues, blocking };
}
function updateFormIssues() {
  const box = $('form-issues'); if (!box) return;
  const { issues, blocking } = formIssues();
  box.hidden = !issues.length;
  box.innerHTML = issues.map(i => `<div class="form-issue ${i.level}">${icon(i.level === 'error' ? 'stop' : 'alert')}<span>${escHtml(i.msg)}</span></div>`).join('');
  $('btn-save-person').classList.toggle('blocked', blocking.length > 0);
  return { issues, blocking };
}
const updateFormIssuesSoon = debounce(updateFormIssues, 150);
for (const f of ['f-name', 'f-birth', 'f-death']) $(f).addEventListener('input', updateFormIssuesSoon);
const readForm = () => ({
  name: $('f-name').value.trim(), gender: selectedGender,
  birth: $('f-birth').value.trim(), death: $('f-death').value.trim(),
  place: $('f-place').value.trim(), notes: $('f-notes').value.trim(),
  ...Object.fromEntries(EXTRA_FIELDS.map(k => [k, $('f-' + k).value.trim()])),
  photo: formPhoto
});
function setFormPhoto(id) {
  formPhoto = id && photos.has(id) ? id : null;
  const th = $('f-photo-thumb');
  th.innerHTML = formPhoto ? `<img src="${photos.get(formPhoto)}" alt="">` : icon('user');
  th.classList.toggle('has', !!formPhoto);
  $('btn-photo-remove').hidden = !formPhoto;
  $('photo-add-lbl').textContent = formPhoto ? 'Change photo' : 'Add photo';
}
function updateMoreCount() {
  const n = EXTRA_FIELDS.filter(k => $('f-' + k).value.trim()).length;
  $('more-count').textContent = n ? `${n} filled in` : 'optional';
}
EXTRA_FIELDS.forEach(k => $('f-' + k).addEventListener('input', updateMoreCount));
$('btn-photo-add').addEventListener('click', () => $('f-photo-input').click());
$('btn-photo-remove').addEventListener('click', () => setFormPhoto(null));
$('f-photo-input').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const id = addPhoto(await photoFromFile(f));
    if (!id) throw new Error('That picture could not be used.');
    setFormPhoto(id);
    toast(editingNodeId ? 'Photo ready. Press Update person to keep it.' : 'Photo ready. It is added with the person.');
  } catch (err) { toast(err.message || 'That picture could not be used.'); }
});

$('btn-clear-form').addEventListener('click', () => { clearForm(); pendingAddPos = null; pendingRelative = null; clearSelection(); });
$('person-form').addEventListener('submit', e => {
  e.preventDefault();
  const data = readForm();
  if (!data.name) { toast('Enter a name first'); $('f-name').focus(); return; }
  const check = updateFormIssues();
  if (check.blocking.length) {
    toast('⛔ ' + check.blocking[0].msg, { duration: 5000 });
    $('form-issues').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  if (editingNodeId && state.nodes[editingNodeId]) {
    const n = state.nodes[editingNodeId];
    Object.assign(n, data);
    renderNode(n);
    commit();
    toast('Person updated', { kind: 'ok' });
  } else {
    const rel = pendingRelative && state.nodes[pendingRelative.id] ? pendingRelative : null;
    const id = addNode(data, pendingAddPos, { silent: true });
    if (rel) {
      const cid = rel.rel === 'parent' ? addConnection(id, rel.id, 'parent', { silent: true })
        : rel.rel === 'child' ? addConnection(rel.id, id, 'parent', { silent: true })
          : addConnection(rel.id, id, rel.rel, { silent: true });
      if (!cid) {   // rules changed since the form opened — undo the half-made addition
        removeNode(id);
        toast(`⛔ ${displayName(state.nodes[rel.id])} can’t get this ${rel.rel} — check the details`, { duration: 5000 });
        return;
      }
    }
    commit();
    toast(rel ? `Added ${data.name} as ${rel.rel} of ${displayName(state.nodes[rel.id])}` : `Added ${data.name}`);
    pendingAddPos = null; pendingRelative = null;
    setSelection([id]);
    clearForm(); // keep the form ready for the next new person
  }
});

function startAddPerson(worldPos) {
  pendingRelative = null;
  clearSelection();
  clearForm();
  pendingAddPos = worldPos || null;
  revealSection('person');
  $('f-name').focus({ preventScroll: true });
  setStatus(worldPos ? 'Fill in the details — the person will be placed where you chose' : 'Fill in the details, then Add to Map');
}

// ════════════════════════════════════════════════════════════
//  MUTATIONS
// ════════════════════════════════════════════════════════════
/** Find a free spot near (cx, cy) so new people don't land on top of others */
function findFreeSpot(cx, cy, w = 160, h = 80) {
  const hits = (x, y) => Object.values(state.nodes).some(n => {
    const s = sizeOf(n.id);
    return x < n.x + s.w + 20 && x + w + 20 > n.x && y < n.y + s.h + 20 && y + h + 20 > n.y;
  });
  if (!hits(cx, cy)) return { x: cx, y: cy };
  for (let r = 1; r < 30; r++) {
    for (let k = 0; k < 8 * r; k++) {
      const a = (k / (8 * r)) * Math.PI * 2;
      const x = cx + Math.cos(a) * r * 90, y = cy + Math.sin(a) * r * 60;
      if (!hits(x, y)) return { x, y };
    }
  }
  return { x: cx, y: cy };
}

function addNode(data, pos, { silent = false } = {}) {
  const id = uid();
  let p = pos;
  if (!p) {
    const c = screenToCanvas(wrapRect.left + wrapRect.width / 2, wrapRect.top + wrapRect.height / 2);
    p = findFreeSpot(c.x - 75, c.y - 35);
  }
  const node = {
    id, name: data.name || '', gender: data.gender || 'neutral',
    birth: data.birth || '', death: data.death || '', place: data.place || '', notes: data.notes || '',
    ...Object.fromEntries(EXTRA_FIELDS.map(k => [k, data[k] || ''])), photo: data.photo || null,
    x: Math.round(p.x), y: Math.round(p.y), group: data.group || null
  };
  state.nodes[id] = node;
  renderNode(node);
  if (!silent) { commit(); toast(`Added ${displayName(node)}`); }
  return id;
}

function editNode(id) {
  const node = state.nodes[id]; if (!node) return;
  setSelection([id]);
  populateForm(node);
  revealSection('person');
  $('f-name').focus({ preventScroll: true });
}

function removeNode(id) {
  const set = adjacency.get(id);
  if (set) for (const cid of [...set]) removeConnection(cid);
  adjacency.delete(id);
  delete state.nodes[id];
  removeNodeEl(id);
  sel.nodes.delete(id);
  if (sel.primary === id) sel.primary = null;
  if (editingNodeId === id) clearForm();
  if (connectSource === id) cancelConnect();
}
function removeConnection(cid) {
  const c = state.connections[cid]; if (!c) return;
  unindexConn(c);
  delete state.connections[cid];
  removeConnEl(cid);
  markNodeMoved(c.from); markNodeMoved(c.to);
  if (sel.conn === cid) sel.conn = null;
  pathHighlight.conns.delete(cid);
}

function deleteNodes(ids) {
  const list = ids.filter(id => state.nodes[id]);
  if (!list.length) return;
  const name = list.length === 1 ? displayName(state.nodes[list[0]]) : `${list.length} people`;
  for (const id of list) removeNode(id);
  setSelection([...sel.nodes]);
  dirty.minimap = true; schedule();
  commit();
  toast(`Deleted ${name}`, { action: { label: 'Undo', fn: undo } });
}
function confirmDeleteNodes(ids) {
  const list = ids.filter(id => state.nodes[id]);
  if (!list.length) return;
  const title = list.length === 1 ? `Delete ${displayName(state.nodes[list[0]])}?` : `Delete ${list.length} people?`;
  showModal(title, 'Their connections will be removed too. You can undo this.', () => deleteNodes(list), { danger: true, confirmText: 'Delete' });
}
function deleteConn(cid) {
  if (!state.connections[cid]) return;
  removeConnection(cid);
  dirty.minimap = true; schedule();
  commit();
  setStatus();
  toast('Connection removed', { action: { label: 'Undo', fn: undo } });
}
function deleteSelection() {
  if (sel.conn) deleteConn(sel.conn);
  else if (sel.nodes.size) confirmDeleteNodes([...sel.nodes]);
  else toast('Select a person or connection first');
}

/** Create a link. Blocked if it breaks a relationship rule, unless `force` (imports keep their data; the audit flags it). */
function addConnection(from, to, type, { silent = false, force = false } = {}) {
  if (!state.nodes[from] || !state.nodes[to] || from === to) return null;
  let v = null;
  if (force) {
    if (linkBetween(from, to)) return null;          // never duplicate a pair
  } else {
    v = validateLink(from, to, type);
    if (!v.ok) { if (!silent) toast('⛔ ' + verdictMsg(v, ['error']), { duration: 5000 }); return null; }
  }
  const id = cuid();
  const c = { id, from, to, type: CONN_TYPES.includes(type) ? type : 'other' };
  state.connections[id] = c;
  indexConn(c);
  ensureConnEl(c);
  updateConnPath(id);
  markNodeMoved(from); markNodeMoved(to);
  if (!silent) {
    commit();
    const w = v && verdictMsg(v, ['warn']);
    toast(w ? `⚠ ${connDescription(c)} — ${w}` : connDescription(c), w ? { duration: 5000 } : {});
  }
  return id;
}
function setConnType(cid, type) {
  const c = state.connections[cid]; if (!c || c.type === type) return;
  const v = validateLink(c.from, c.to, type, { ignore: cid });
  if (!v.ok) { toast('⛔ ' + verdictMsg(v, ['error']), { duration: 5000 }); return; }
  c.type = type;
  ensureConnEl(c); updateConnPath(cid); updateConnClass(cid);
  markNodeMoved(c.from); markNodeMoved(c.to);
  commit();
  const w = verdictMsg(v, ['warn']);
  toast(w ? `⚠ ${connDescription(c)} — ${w}` : connDescription(c));
}
function reverseConn(cid) {
  const c = state.connections[cid]; if (!c) return;
  const v = validateLink(c.to, c.from, c.type, { ignore: cid });
  if (!v.ok) { toast('⛔ ' + verdictMsg(v, ['error']), { duration: 5000 }); return; }
  [c.from, c.to] = [c.to, c.from];
  markNodeMoved(c.from); markNodeMoved(c.to);
  commit();
  toast(connDescription(c));
}

function moveNodesBy(ids, dx, dy) {
  for (const id of ids) {
    const n = state.nodes[id]; if (!n) continue;
    n.x += dx; n.y += dy;
    positionNode(nodeEls.get(id), n);
    markNodeMoved(id);
  }
}

// ════════════════════════════════════════════════════════════
//  RELATIONSHIP RULES — validate links against the live tree
//  Levels: error = impossible (blocked) · warn = unusual (allowed,
//  flagged) · info = worth knowing (shown only while connecting)
// ════════════════════════════════════════════════════════════
/** Year from free-form dates: "1889", "12 Mar 1889", "c. 1889", "1889-03-12", "abt 450 BC" */
function yearOf(s) {
  const t = String(s || '');
  const m = t.match(/(?:^|\D)(\d{4})(?!\d)/) || t.match(/(?:^|\D)(\d{3})(?!\d)/);
  if (!m) return null;
  return /\bB\.?C/i.test(t) ? -+m[1] : +m[1];
}
function linksOf(id, ig) {
  const out = [];
  for (const cid of adjacency.get(id) || []) {
    if (cid === ig) continue;
    const c = state.connections[cid]; if (c) out.push(c);
  }
  return out;
}
const parentsOf  = (id, ig) => linksOf(id, ig).filter(c => c.type === 'parent' && c.to === id).map(c => c.from);
const childrenOf = (id, ig) => linksOf(id, ig).filter(c => c.type === 'parent' && c.from === id).map(c => c.to);
const partnersOf = (id, ig) => linksOf(id, ig).filter(c => c.type === 'spouse').map(c => (c.from === id ? c.to : c.from));
const sibLinksOf = (id, ig) => linksOf(id, ig).filter(c => c.type === 'sibling').map(c => (c.from === id ? c.to : c.from));
const linkBetween = (a, b, ig) => linksOf(a, ig).find(c => c.from === b || c.to === b) || null;

/** A sibling link means "same parents": a person inherits the recorded parents of their linked siblings */
function effectiveParents(id, ig) {
  const out = new Set(parentsOf(id, ig));
  for (const s of sibLinksOf(id, ig)) for (const p of parentsOf(s, ig)) out.add(p);
  return out;
}
/** Ancestors with generation depth (self = 0), plus siblings along that line (for trees with unrecorded parents) */
function ancestry(id, ig) {
  const up = new Map([[id, 0]]), q = [id];
  for (let i = 0; i < q.length; i++) {
    const cur = q[i], d = up.get(cur);
    if (d >= 60) continue;
    for (const p of effectiveParents(cur, ig)) if (!up.has(p)) { up.set(p, d + 1); q.push(p); }
  }
  const side = new Map();
  for (const [x, d] of up) for (const s of sibLinksOf(x, ig)) if (!up.has(s) && !(side.get(s) <= d)) side.set(s, d);
  return { up, side };
}
/** Closest blood tie from A to B: a = generations up from A to the common ancestor, b = generations down to B */
function bloodRelation(A, B, ig) {
  if (!state.nodes[A] || !state.nodes[B]) return null;
  const ra = ancestry(A, ig), rb = ancestry(B, ig);
  let best = null;
  const consider = (a, b) => { if (!best || a + b < best.a + best.b || (a + b === best.a + best.b && Math.abs(a - b) < Math.abs(best.a - best.b))) best = { a, b }; };
  for (const [x, da] of ra.up) if (rb.up.has(x)) consider(da, rb.up.get(x));
  for (const [s, da] of ra.side) if (rb.up.has(s)) consider(da + 1, rb.up.get(s) + 1);
  for (const [s, db] of rb.side) if (ra.up.has(s)) consider(ra.up.get(s) + 1, db + 1);
  return best;
}
const TYPE_TEXT = { parent: 'parent', child: 'child', spouse: 'spouse / partner', sibling: 'sibling', other: 'other' };

/**
 * Check a proposed link. type: parent (from is parent of to) | child | spouse | sibling | other.
 * opts.ignore  — connection id to leave out (the link being changed/audited)
 * opts.people  — { id: {birth, death, gender, name} } overrides, e.g. unsaved form values or a new person
 */
function validateLink(from, to, type, opts = {}) {
  if (type === 'child') return validateLink(to, from, 'parent', opts);
  const { ignore = null, people = null } = opts;
  const issues = [];
  const add = (level, msg, kind = 'rel') => issues.push({ level, msg, kind });
  const P = id => (people && people[id] ? { ...(state.nodes[id] || {}), ...people[id] } : state.nodes[id]);
  const A = P(from), B = P(to);
  const nm = id => displayName(P(id));
  const done = () => {
    const level = issues.some(i => i.level === 'error') ? 'error' : issues.some(i => i.level === 'warn') ? 'warn' : issues.length ? 'info' : 'ok';
    return { level, ok: level !== 'error', issues };
  };
  if (!A || !B) { add('error', 'That person no longer exists'); return done(); }
  if (from === to) { add('error', 'A person can’t be linked to themselves'); return done(); }

  const existing = linkBetween(from, to, ignore);
  if (existing) add('error', `Already linked: ${connDescription(existing)}. Change that link instead.`);
  if (type === 'other') return done();

  const rel = bloodRelation(from, to, ignore);            // what B is to A
  const relTo = (_, r, g) => bloodTerm(r.a, r.b, g);     // what B is to A
  const yA = yearOf(A.birth), yB = yearOf(B.birth), dA = yearOf(A.death), dB = yearOf(B.death);

  if (type === 'parent') {
    if (rel) {
      if (rel.b === 0) add('error', `${nm(to)} is ${nm(from)}’s ${relTo(0, rel, B.gender)} — this would make someone their own ancestor.`);
      else if (rel.a === 0 && rel.b === 1) add('info', `${nm(from)} is already ${nm(to)}’s parent through a sibling link.`);
      else if (rel.a === 0) add('error', `${nm(from)} is already ${nm(to)}’s ${bloodTerm(rel.b, 0, A.gender)} — a person can’t be both.`);
      else if (rel.a === 1 && rel.b === 1) add('error', `${nm(from)} and ${nm(to)} are siblings — a sibling can’t also be a parent.`);
      else if (rel.b - rel.a !== 1) add('error', `${nm(to)} is ${nm(from)}’s ${relTo(0, rel, B.gender)} — the generations don’t fit a parent link.`);
      else add('warn', `${nm(to)} is already ${nm(from)}’s ${relTo(0, rel, B.gender)} by blood.`);
    }
    const others = parentsOf(to, ignore).filter(p => p !== from);
    if (others.length >= 2) add('error', `${nm(to)} already has two parents (${others.map(nm).join(' and ')}). Use “Other” for step- or adoptive parents.`);
    if (others.length === 1 && partnersOf(from, ignore).length && !partnersOf(from, ignore).includes(others[0]))
      add('info', `${nm(to)}’s other parent, ${nm(others[0])}, isn’t linked as ${nm(from)}’s partner.`);
    if (yA != null && yB != null) {
      const age = yB - yA;
      if (age <= 0) add('error', `${nm(from)} (born ${yA}) isn’t older than ${nm(to)} (born ${yB}).`, 'date');
      else if (age < 10) add('error', `${nm(from)} would have been only ${age} when ${nm(to)} was born.`, 'date');
      else if (age < 14) add('warn', `${nm(from)} would have been ${age} when ${nm(to)} was born.`, 'date');
      else if (age > (A.gender === 'female' ? 55 : 75)) add('warn', `${nm(from)} would have been ${age} when ${nm(to)} was born.`, 'date');
    }
    if (dA != null && yB != null) {
      // a father can die up to ~9 months before the birth; a mother can't die before it
      if (A.gender === 'female' ? dA < yB : dA < yB - 1) add('error', `${nm(from)} died in ${dA}, before ${nm(to)} was born (${yB}).`, 'date');
    }
  }

  if (type === 'spouse') {
    if (rel) {
      const t = relTo(0, rel, B.gender);
      if (rel.a === 0 || rel.b === 0) add('error', `${nm(to)} is ${nm(from)}’s ${t} — direct ancestors and descendants can’t be partners.`);
      else if (rel.a === 1 && rel.b === 1) add('error', `${nm(from)} and ${nm(to)} are siblings — they can’t be linked as partners.`);
      else if (rel.a + rel.b <= 3) add('error', `${nm(to)} is ${nm(from)}’s ${t} — too closely related to be partners.`);
      else if (rel.a + rel.b === 4) add('warn', `${nm(to)} is ${nm(from)}’s ${t} (close blood relatives).`);
    }
    const stepA = partnersOf(from, ignore).flatMap(p => childrenOf(p, ignore));
    const stepB = partnersOf(to, ignore).flatMap(p => childrenOf(p, ignore));
    if (stepA.includes(to)) add('warn', `${nm(to)} is a child of ${nm(from)}’s partner.`);
    else if (stepB.includes(from)) add('warn', `${nm(from)} is a child of ${nm(to)}’s partner.`);
    const cur = partnersOf(from, ignore);
    if (cur.length) add('info', `${nm(from)} already has a partner (${cur.map(nm).join(', ')}).`);
    if (dA != null && yB != null && dA < yB) add('error', `${nm(from)} died (${dA}) before ${nm(to)} was born (${yB}).`, 'date');
    else if (dB != null && yA != null && dB < yA) add('error', `${nm(to)} died (${dB}) before ${nm(from)} was born (${yA}).`, 'date');
  }

  if (type === 'sibling') {
    if (rel) {
      const t = relTo(0, rel, B.gender);
      if (rel.a === 0 || rel.b === 0 || rel.a !== rel.b) add('error', `${nm(to)} is ${nm(from)}’s ${t} — siblings must be the same generation.`);
      else if (rel.a === 1) add('info', `They already share a parent, so they’re siblings anyway — this link is optional.`);
      else add('warn', `${nm(to)} is ${nm(from)}’s ${t} — siblings would normally share parents.`);
    }
    if (partnersOf(from, ignore).includes(to)) add('error', `${nm(from)} and ${nm(to)} are partners.`);
    const stepParent = partnersOf(from, ignore).find(p => parentsOf(to, ignore).includes(p)) ? from
      : partnersOf(to, ignore).find(p => parentsOf(from, ignore).includes(p)) ? to : null;
    if (stepParent) add('warn', `${nm(stepParent)} is the partner of ${nm(stepParent === from ? to : from)}’s parent — a step-parent, not a sibling.`);
    const pa = parentsOf(from, ignore), pb = parentsOf(to, ignore);
    if (pa.length && pb.length && !pa.some(p => pb.includes(p)))
      add('warn', `They have no recorded parents in common — use “Other” for step-siblings.`);
    if (pa.length + pb.length > 2 && new Set([...pa, ...pb]).size > 3)
      add('warn', `Together they’d have more than two different parents.`);
    if (yA != null && yB != null && Math.abs(yA - yB) > 35) add('warn', `Born ${Math.abs(yA - yB)} years apart.`, 'date');
  }
  return done();
}
/** What the connect picker can offer for a pair: verdict per choice */
function pairVerdicts(from, to) {
  const out = {};
  for (const t of ['parent', 'child', 'spouse', 'sibling', 'other']) out[t] = validateLink(from, to, t);
  return out;
}
/** Short headline for a verdict (first message of the most severe level) */
function verdictMsg(v, levels = ['error', 'warn', 'info']) {
  for (const l of levels) { const i = v.issues.find(x => x.level === l); if (i) return i.msg; }
  return '';
}
/** Problems with a single person's own dates */
function personIssues(n) {
  const out = [], b = yearOf(n.birth), d = yearOf(n.death);
  if (b != null && d != null) {
    if (d < b) out.push({ level: 'error', msg: `${displayName(n)} died (${d}) before being born (${b}).`, kind: 'date' });
    else if (d - b > 120) out.push({ level: 'warn', msg: `${displayName(n)} would have lived ${d - b} years.`, kind: 'date' });
  }
  return out;
}

// ── Whole-tree audit (runs after every change) ──────────────
const audit = { list: [], node: new Map(), conn: new Map(), errors: 0, warns: 0 };
const LEVEL_RANK = { info: 0, warn: 1, error: 2 };
function runAudit() {
  const list = [], node = new Map(), conn = new Map();
  const mark = (map, id, level) => { if (!(LEVEL_RANK[map.get(id)] >= LEVEL_RANK[level])) map.set(id, level); };
  for (const n of Object.values(state.nodes)) {
    for (const i of personIssues(n)) { list.push({ ...i, nodes: [n.id] }); mark(node, n.id, i.level); }
  }
  for (const c of Object.values(state.connections)) {
    const v = validateLink(c.from, c.to, c.type, { ignore: c.id });
    for (const i of v.issues) {
      if (i.level === 'info') continue;
      list.push({ ...i, cid: c.id, nodes: [c.from, c.to] });
      mark(conn, c.id, i.level); mark(node, c.from, i.level); mark(node, c.to, i.level);
    }
  }
  // the same problem is found from both ends of a pair — keep one copy
  const seen = new Set();
  audit.list = list.filter(i => { const k = i.msg; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  audit.node = node; audit.conn = conn;
  audit.errors = audit.list.filter(i => i.level === 'error').length;
  audit.warns = audit.list.length - audit.errors;
  refreshNodeClasses();
  for (const id of connEls.keys()) updateConnClass(id);
  renderIssuesChip();
  if ($('check-panel').classList.contains('open')) renderCheckPanel();
}
const scheduleAudit = debounce(runAudit, 120);

function renderIssuesChip() {
  const chip = $('issues-chip'), n = audit.list.length, meta = $('tools-meta');
  chip.hidden = !n;
  meta.innerHTML = !n ? '' : audit.errors
    ? `<span class="gm-pill bad">${audit.errors} problem${audit.errors > 1 ? 's' : ''}</span>`
    : `<span class="gm-pill warn">${audit.warns} warning${audit.warns > 1 ? 's' : ''}</span>`;
  if (!n) return;
  chip.classList.toggle('has-errors', audit.errors > 0);
  chip.querySelector('.txt').textContent = audit.errors
    ? `${audit.errors} problem${audit.errors > 1 ? 's' : ''}${audit.warns ? ` · ${audit.warns} warning${audit.warns > 1 ? 's' : ''}` : ''}`
    : `${audit.warns} warning${audit.warns > 1 ? 's' : ''}`;
}
function renderCheckPanel() {
  const body = $('check-list');
  if (!audit.list.length) {
    body.innerHTML = `<div class="check-empty">${icon('check')}No problems found — every link fits the family logic.</div>`;
    return;
  }
  body.innerHTML = audit.list.map((i, k) => `
    <div class="check-item ${i.level}">
      <span class="check-ico" aria-hidden="true">${icon(i.level === 'error' ? 'stop' : 'alert')}</span>
      <div class="check-msg">${escHtml(i.msg)}</div>
      <div class="check-actions">
        <button class="mini-btn" data-show="${k}">Show</button>
        ${i.cid ? `<button class="mini-btn danger" data-unlink="${k}">Remove link</button>` : `<button class="mini-btn" data-editp="${k}">Edit</button>`}
      </div>
    </div>`).join('');
}
function openCheckPanel() { runAudit(); renderCheckPanel(); openPanel('check-panel'); }
$('check-list').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const i = audit.list[b.dataset.show ?? b.dataset.unlink ?? b.dataset.editp]; if (!i) return;
  if (b.dataset.show != null) {
    closePanel('check-panel');
    setPathHighlight(i.nodes, i.cid ? [i.cid] : []);
    fitToIds(i.nodes, { maxScale: 1.2 });
    if (i.cid) selectConn(i.cid); else setSelection(i.nodes);
  } else if (b.dataset.unlink != null) {
    deleteConn(i.cid);
  } else {
    closePanel('check-panel'); editNode(i.nodes[0]);
  }
});
$('issues-chip').addEventListener('click', openCheckPanel);

// ════════════════════════════════════════════════════════════
//  CONNECT MODE
// ════════════════════════════════════════════════════════════
function setConnectMode(on) {
  connectMode = on;
  const btn = $('btn-connect');
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', on);
  canvasWrap.classList.toggle('connecting', on);
  if (!on) cancelConnect();
  setStatus(on ? 'Connect mode: tap the first person' : '');
}
function startConnect(id) {
  connectSource = id;
  refreshNodeClasses();
  setStatus(`Now tap the person to connect with ${displayName(state.nodes[id])} (Esc to cancel)`);
}
function cancelConnect() {
  clearConnectHover(tapHover); tapHover = null;
  if (!connectSource && !pendingConn) return;
  connectSource = null; pendingConn = null;
  closeConnPicker();
  refreshNodeClasses();
}
/** Show the type picker for a new link between two people */
function finishConnect(from, to, sx, sy) {
  if (!from || !to || from === to) { cancelConnect(); return; }
  const verdicts = pairVerdicts(from, to);
  if (Object.values(verdicts).every(v => !v.ok)) {
    toast('⛔ ' + verdictMsg(verdicts.other, ['error']), { duration: 5000 });
    cancelConnect(); return;
  }
  pendingConn = { from, to, verdicts };
  const a = escHtml(displayName(state.nodes[from])), b = escHtml(displayName(state.nodes[to]));
  $('conn-picker-title').innerHTML = `How is <b>${a}</b> related to <b>${b}</b>?`;
  document.querySelector('[data-lbl="parent"]').textContent = 'Parent of ' + displayName(state.nodes[to]);
  document.querySelector('[data-lbl="child"]').textContent = 'Child of ' + displayName(state.nodes[to]);
  const picker = $('conn-picker');
  for (const btn of picker.querySelectorAll('.conn-type-btn')) {
    const v = verdicts[btn.dataset.type];
    btn.classList.toggle('is-error', !v.ok);
    btn.classList.toggle('is-warn', v.level === 'warn');
    btn.classList.toggle('is-info', v.level === 'info');
    btn.setAttribute('aria-disabled', !v.ok);
    const why = btn.querySelector('.why');
    const msg = verdictMsg(v);
    why.textContent = msg; why.hidden = !msg;
    btn.title = msg;
  }
  picker.classList.add('open');
  placeFloating(picker, sx + 6, sy + 6);
  (picker.querySelector('.conn-type-btn:not(.is-error)') || picker.querySelector('button')).focus({ preventScroll: true });
}
function closeConnPicker() { $('conn-picker').classList.remove('open'); }

$('conn-picker').addEventListener('click', e => {
  const btn = e.target.closest('.conn-type-btn');
  if (!btn || !pendingConn) return;
  if (btn.classList.contains('is-error')) {
    // explain, but keep the picker open so another type can be chosen
    toast('⛔ ' + btn.querySelector('.why').textContent, { duration: 5000 });
    return;
  }
  let { from, to } = pendingConn;
  let type = btn.dataset.type;
  if (type === 'child') { [from, to] = [to, from]; type = 'parent'; }
  pendingConn = null;
  closeConnPicker();
  addConnection(from, to, type);
  connectSource = null;
  refreshNodeClasses();
  setStatus(connectMode ? 'Connect mode: tap the next person, or press Connect again to finish' : '');
});

/** Handle a tap on a person while connecting */
function handleConnectTap(id, sx, sy) {
  if (!connectSource) { startConnect(id); return; }
  if (connectSource === id) { cancelConnect(); setStatus(connectMode ? 'Connect mode: tap the first person' : ''); return; }
  finishConnect(connectSource, id, sx, sy);
}

/** Keep popups inside the viewport */
function placeFloating(el, x, y) {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  el.style.left = clamp(x, 8, Math.max(8, vw - r.width - 8)) + 'px';
  el.style.top  = clamp(y, 8, Math.max(8, vh - r.height - 8)) + 'px';
}

// ════════════════════════════════════════════════════════════
//  POINTER INTERACTION  (mouse, pen and touch — one code path)
// ════════════════════════════════════════════════════════════
const pointers = new Map();          // pointerId → { x, y }
let gesture = null;
let lastPointerType = 'mouse';
let longPressTimer = 0;
let lastTap = { t: 0, key: '', x: 0, y: 0 };
let suppressClickUntil = 0;

const slopFor = type => (type === 'touch' ? 9 : 4);
function nodeIdFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  return el?.closest?.('.person-node')?.dataset.id || null;
}

canvasWrap.addEventListener('pointerdown', e => {
  lastPointerType = e.pointerType;
  if (e.button === 2) return;                    // context menu handles right-click
  hideCtxMenu();
  if (!e.target.closest('#conn-picker') && $('conn-picker').classList.contains('open')) cancelConnect();
  if (e.target.closest('#zoom-controls, #minimap, #empty-hint button')) return;

  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { startPinch(); return; }
  if (pointers.size > 2) return;

  const start = { x: e.clientX, y: e.clientY };
  const base = { pointerId: e.pointerId, start, moved: false, type: e.pointerType };

  if (e.button === 1) { e.preventDefault(); gesture = { ...base, kind: 'pan', vx: view.x, vy: view.y }; return; }
  if (e.target.closest('[data-action]')) return; // node buttons use click

  const handle = e.target.closest('.node-handle');
  const nodeEl = e.target.closest('.person-node');
  const connG  = e.target.closest('.conn');

  if (handle && nodeEl) {
    e.preventDefault();
    gesture = { ...base, kind: 'link', from: nodeEl.dataset.id, hover: null };
    return;
  }
  if (nodeEl) {
    const id = nodeEl.dataset.id;
    if (connectMode || connectSource) {
      gesture = { ...base, kind: 'tapnode', id };
    } else {
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (additive) toggleSelected(id);
      else if (!sel.nodes.has(id)) setSelection([id]);
      else { sel.primary = id; }
      if (!sel.nodes.has(id)) { gesture = null; return; }
      const orig = new Map();
      for (const nid of sel.nodes) { const n = state.nodes[nid]; if (n) orig.set(nid, { x: n.x, y: n.y }); }
      gesture = { ...base, kind: 'drag', id, orig, el: nodeEl, additive };
    }
    armLongPress(e, () => openNodeMenu(id, start.x, start.y));
    return;
  }
  if (connG) {
    gesture = { ...base, kind: 'tapconn', id: connG.dataset.id };
    armLongPress(e, () => { selectConn(connG.dataset.id); openConnMenu(connG.dataset.id, start.x, start.y); });
    return;
  }
  // empty canvas
  if (e.shiftKey && e.pointerType === 'mouse') {
    gesture = { ...base, kind: 'marquee', additive: e.ctrlKey || e.metaKey };
    return;
  }
  gesture = { ...base, kind: 'pan', vx: view.x, vy: view.y };
  armLongPress(e, () => openCanvasMenu(start.x, start.y));
});

function armLongPress(e, fn) {
  clearTimeout(longPressTimer);
  if (e.pointerType === 'mouse') return;
  const g = gesture;
  longPressTimer = setTimeout(() => {
    if (gesture !== g || g.moved || pointers.size !== 1) return;
    gesture = null;
    suppressClickUntil = performance.now() + 600;
    navigator.vibrate?.(12);
    fn();
  }, 520);
}

function startPinch() {
  clearTimeout(longPressTimer);
  // finish any drag cleanly before switching to pinch
  if (gesture?.kind === 'drag' && gesture.moved) { gesture.el.classList.remove('dragging'); commit(); }
  const [a, b] = [...pointers.values()];
  gesture = {
    kind: 'pinch', moved: true,
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    view: { ...view }
  };
  hideLinkPreview();
}

window.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const g = gesture; if (!g) return;

  if (g.kind === 'pinch') {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const s = clamp(g.view.scale * dist / g.dist, MIN_SCALE, MAX_SCALE);
    // keep the world point under the starting midpoint under the current midpoint
    const wx = (g.mid.x - wrapRect.left - g.view.x) / g.view.scale;
    const wy = (g.mid.y - wrapRect.top - g.view.y) / g.view.scale;
    view.scale = s;
    view.x = mid.x - wrapRect.left - wx * s;
    view.y = mid.y - wrapRect.top - wy * s;
    requestTransform();
    return;
  }
  if (e.pointerId !== g.pointerId) return;
  const dxs = e.clientX - g.start.x, dys = e.clientY - g.start.y;
  if (!g.moved) {
    if (Math.abs(dxs) + Math.abs(dys) < slopFor(g.type)) return;
    g.moved = true;
    clearTimeout(longPressTimer);
    if (g.kind === 'tapnode' || g.kind === 'tapconn') { Object.assign(g, { kind: 'pan', vx: view.x, vy: view.y }); }
    if (g.kind === 'drag') g.el.classList.add('dragging');
    if (g.kind === 'pan') canvasWrap.classList.add('panning');
  }
  switch (g.kind) {
    case 'pan':
      view.x = g.vx + dxs; view.y = g.vy + dys;
      requestTransform();
      break;
    case 'drag': {
      const dx = dxs / view.scale, dy = dys / view.scale;
      for (const [nid, o] of g.orig) {
        const n = state.nodes[nid]; if (!n) continue;
        n.x = Math.round(o.x + dx); n.y = Math.round(o.y + dy);
        positionNode(nodeEls.get(nid), n);
        markNodeMoved(nid);
      }
      break;
    }
    case 'marquee': {
      const m = $('marquee');
      const x = Math.min(g.start.x, e.clientX) - wrapRect.left, y = Math.min(g.start.y, e.clientY) - wrapRect.top;
      Object.assign(m.style, { display: 'block', left: x + 'px', top: y + 'px', width: Math.abs(dxs) + 'px', height: Math.abs(dys) + 'px' });
      break;
    }
    case 'link': {
      const from = state.nodes[g.from], s = sizeOf(g.from);
      const p = screenToCanvas(e.clientX, e.clientY);
      const fx = from.x + s.w / 2, fy = from.y + s.h / 2;
      linkPreview.setAttribute('d', `M${fx},${fy} L${p.x},${p.y}`);
      const hover = nodeIdFromPoint(e.clientX, e.clientY);
      if (hover !== g.hover) {
        clearConnectHover(g.hover);
        g.hover = hover && hover !== g.from ? hover : null;
        showConnectHover(g.from, g.hover);
      }
      break;
    }
  }
}, { passive: true });

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  clearTimeout(longPressTimer);
  const g = gesture;
  if (!g) return;

  if (g.kind === 'pinch') {
    if (pointers.size === 1) {
      // continue as a one-finger pan with the remaining pointer
      const [[pid, p]] = [...pointers.entries()];
      gesture = { kind: 'pan', pointerId: pid, start: { ...p }, moved: true, type: 'touch', vx: view.x, vy: view.y };
    } else if (!pointers.size) gesture = null;
    return;
  }
  if (e.pointerId !== g.pointerId) return;
  gesture = null;
  canvasWrap.classList.remove('panning');
  const cancelled = e.type === 'pointercancel';

  switch (g.kind) {
    case 'pan':
      if (!g.moved && !cancelled) {
        if (isDoubleTap('canvas', e)) { startAddPerson(snapPos(screenToCanvas(e.clientX, e.clientY))); break; }
        clearSelection(); clearPathHighlight();
        if (connectSource) { cancelConnect(); setStatus(connectMode ? 'Connect mode: tap the first person' : ''); }
      }
      break;
    case 'drag':
      g.el.classList.remove('dragging');
      if (g.moved) commit();
      else if (!cancelled) {
        if (isDoubleTap(g.id, e)) editNode(g.id);
        else if (!g.additive && sel.nodes.size > 1) setSelection([g.id]);
      }
      break;
    case 'tapnode':
      if (!cancelled) handleConnectTap(g.id, e.clientX, e.clientY);
      break;
    case 'tapconn':
      if (!cancelled) selectConn(g.id);
      break;
    case 'marquee': {
      $('marquee').style.display = 'none';
      if (!g.moved) break;
      const a = screenToCanvas(g.start.x, g.start.y), b = screenToCanvas(e.clientX, e.clientY);
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      const hit = Object.values(state.nodes).filter(n => {
        const s = sizeOf(n.id);
        return n.x < x2 && n.x + s.w > x1 && n.y < y2 && n.y + s.h > y1;
      }).map(n => n.id);
      setSelection(g.additive ? [...sel.nodes, ...hit] : hit);
      break;
    }
    case 'link': {
      hideLinkPreview();
      clearConnectHover(g.hover);
      if (cancelled) break;
      if (!g.moved) { startConnect(g.from); break; }   // tap on the dot = start tap-to-connect
      const target = nodeIdFromPoint(e.clientX, e.clientY);
      if (target && target !== g.from) finishConnect(g.from, target, e.clientX, e.clientY);
      break;
    }
  }
}
window.addEventListener('pointerup', endPointer);
canvasWrap.addEventListener('pointerdown', e => {
  if (gesture && gesture.pointerId === e.pointerId && e.pointerType === 'mouse') {
    try { canvasWrap.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
});
window.addEventListener('pointercancel', endPointer);

function hideLinkPreview() { linkPreview.setAttribute('d', ''); linkPreview.removeAttribute('class'); }

/** Live feedback while pointing at a possible link target: which link types the rules allow */
function showConnectHover(from, to) {
  if (!to) { linkPreview.removeAttribute('class'); setStatus(connectStatus()); return; }
  const v = pairVerdicts(from, to), el = nodeEls.get(to);
  const allowed = ['parent', 'child', 'spouse', 'sibling'].filter(t => v[t].ok);
  const blocked = !allowed.length && !v.other.ok;
  el?.classList.add(blocked ? 'connect-blocked' : 'connect-hover');
  linkPreview.setAttribute('class', blocked ? 'blocked' : '');
  const a = displayName(state.nodes[from]), b = displayName(state.nodes[to]);
  setStatus(blocked ? `⛔ ${verdictMsg(v.other, ['error'])}`
    : allowed.length ? `${b} can be ${a}’s ${allowed.map(t => ({ parent: 'child', child: 'parent', spouse: 'partner', sibling: 'sibling' })[t]).join(' / ')}`
      : `Only an “Other” link fits between ${a} and ${b}`);
}
function clearConnectHover(id) {
  if (id) nodeEls.get(id)?.classList.remove('connect-hover', 'connect-blocked');
}
const connectStatus = () => (connectSource ? `Now tap the person to connect with ${displayName(state.nodes[connectSource])} (Esc to cancel)` : '');
// tap-to-connect with a mouse: show the same feedback when hovering people
let tapHover = null;
nodesLayer.addEventListener('pointerover', e => {
  if (!connectSource || gesture || e.pointerType !== 'mouse') return;
  const id = e.target.closest('.person-node')?.dataset.id;
  if (id === tapHover) return;
  clearConnectHover(tapHover);
  tapHover = id && id !== connectSource ? id : null;
  showConnectHover(connectSource, tapHover);
});
nodesLayer.addEventListener('pointerleave', () => { clearConnectHover(tapHover); tapHover = null; if (connectSource) setStatus(connectStatus()); });
function snapPos(p) { return { x: Math.round(p.x - 75), y: Math.round(p.y - 30) }; }

function isDoubleTap(key, e) {
  const now = performance.now();
  const hit = lastTap.key === key && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
  lastTap = hit ? { t: 0, key: '', x: 0, y: 0 } : { t: now, key, x: e.clientX, y: e.clientY };
  return hit;
}

// Node action buttons (edit / delete)
nodesLayer.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.stopPropagation();
  const id = btn.closest('.person-node')?.dataset.id;
  if (!id) return;
  if (btn.dataset.action === 'edit') editNode(id);
  else if (btn.dataset.action === 'delete') confirmDeleteNodes(sel.nodes.has(id) && sel.nodes.size > 1 ? [...sel.nodes] : [id]);
});

// Wheel: zoom around the cursor (smooth for trackpads, stepped for mice)
canvasWrap.addEventListener('wheel', e => {
  e.preventDefault();
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= wrapRect.height;
  const k = e.ctrlKey ? 0.01 : 0.0022;
  zoomAt(e.clientX, e.clientY, Math.exp(-clamp(dy, -120, 120) * k));
}, { passive: false });

// Right-click menus (mouse). Touch uses the long-press timer instead.
canvasWrap.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (lastPointerType === 'touch' || performance.now() < suppressClickUntil) return;
  const nodeEl = e.target.closest('.person-node');
  const connG = e.target.closest('.conn');
  if (nodeEl) openNodeMenu(nodeEl.dataset.id, e.clientX, e.clientY);
  else if (connG) { selectConn(connG.dataset.id); openConnMenu(connG.dataset.id, e.clientX, e.clientY); }
  else openCanvasMenu(e.clientX, e.clientY);
});

// ════════════════════════════════════════════════════════════
//  CONTEXT MENU
// ════════════════════════════════════════════════════════════
const ctxMenu = $('ctx-menu');
let ctxActions = {};
function openMenu(items, x, y) {
  ctxActions = {};
  ctxMenu.innerHTML = items.map((it, i) => {
    if (it === '-') return '<div class="ctx-separator"></div>';
    if (it.label && !it.fn) return `<div class="ctx-label${it.level ? ' is-' + it.level : ''}">${escHtml(it.label)}</div>`;
    if (!it.disabled) ctxActions[i] = it.fn;
    const hint = it.hint ? `<span class="ctx-hint">${escHtml(it.hint)}</span>` : '';
    return `<button class="ctx-item${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}${it.warn ? ' warn' : ''}" role="menuitem" data-i="${i}"${it.disabled ? ' aria-disabled="true"' : ''} title="${escHtml(it.hint || '')}"><span class="ico">${icon(it.icon)}</span><span class="ctx-text">${escHtml(it.text)}${hint}</span></button>`;
  }).join('');
  ctxMenu.classList.add('open');
  placeFloating(ctxMenu, x, y);
  if (lastPointerType !== 'touch') ctxMenu.querySelector('.ctx-item')?.focus({ preventScroll: true });
}
function hideCtxMenu() { ctxMenu.classList.remove('open'); }
ctxMenu.addEventListener('click', e => {
  const b = e.target.closest('.ctx-item'); if (!b) return;
  e.stopPropagation();
  if (b.classList.contains('disabled')) return;
  const fn = ctxActions[b.dataset.i];
  hideCtxMenu();
  fn && fn();
});
ctxMenu.addEventListener('keydown', e => {
  const items = [...ctxMenu.querySelectorAll('.ctx-item')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
});
document.addEventListener('pointerdown', e => {
  if (!ctxMenu.contains(e.target)) hideCtxMenu();
  if (!$('conn-picker').contains(e.target) && !e.target.closest('#canvas-wrap') && pendingConn) cancelConnect();
});

function openNodeMenu(id, x, y) {
  const n = state.nodes[id]; if (!n) return;
  if (!sel.nodes.has(id)) setSelection([id]);
  const multi = sel.nodes.size > 1;
  const items = [{ label: multi ? `${sel.nodes.size} people selected` : displayName(n) }];
  if (!multi) {
    items.push(
      { icon: 'edit', text: 'Edit details', fn: () => editNode(id) },
      { icon: 'link', text: 'Connect to…', fn: () => startConnect(id) },
      (() => {
        const ps = parentsOf(id);
        return ps.length >= 2
          ? { icon: 'up', text: 'Add parent', disabled: true, hint: `Already has two parents (${ps.map(p => displayName(state.nodes[p])).join(' and ')})` }
          : { icon: 'up', text: 'Add parent', fn: () => quickAddRelative(id, 'parent') };
      })(),
      { icon: 'down', text: 'Add child', fn: () => quickAddRelative(id, 'child') },
      { icon: 'heart', text: 'Add spouse or partner', fn: () => quickAddRelative(id, 'spouse') },
      { icon: 'sides', text: 'Add sibling', fn: () => quickAddRelative(id, 'sibling') },
      '-',
      { icon: 'rings', text: 'Find relationship to…', fn: () => openRelFinder(id) },
      kinView.ego === id ? { icon: 'book', text: 'Hide kinship terms', fn: () => setKinEgo(null) } : { icon: 'book', text: 'Kinship terms from this person', fn: () => setKinEgo(id) },
      { icon: 'users', text: 'Select family branch', fn: () => selectBranch(id) }
    );
  } else {
    items.push(
      { icon: 'layout', text: 'Tidy these people', fn: () => tidyLayout([...sel.nodes]) },
      { icon: 'target', text: 'Zoom to selection', fn: () => fitToIds([...sel.nodes]) }
    );
    if (sel.nodes.size === 2) {
      const [a, b] = [...sel.nodes];
      items.push({ icon: 'rings', text: 'Find their relationship', fn: () => openRelFinder(a, b) });
    }
  }
  items.push('-', { icon: 'trash', text: multi ? `Delete ${sel.nodes.size} people` : 'Delete person', danger: true, fn: () => confirmDeleteNodes([...sel.nodes]) });
  openMenu(items, x, y);
}
function openConnMenu(cid, x, y) {
  const c = state.connections[cid]; if (!c) return;
  const items = [{ label: connDescription(c) }];
  for (const t of CONN_TYPES) if (t !== c.type) {
    const v = validateLink(c.from, c.to, t, { ignore: cid });
    items.push({ icon: v.ok ? (v.level === 'warn' ? 'alert' : 'refresh') : 'stop', text: `Change to ${t === 'parent' ? 'parent and child' : t}`,
      disabled: !v.ok, warn: v.level === 'warn', hint: verdictMsg(v, ['error', 'warn']), fn: () => setConnType(cid, t) });
  }
  if (c.type === 'parent') {
    const v = validateLink(c.to, c.from, 'parent', { ignore: cid });
    items.push({ icon: v.ok ? 'flip' : 'stop', text: 'Swap parent and child', disabled: !v.ok, warn: v.level === 'warn', hint: verdictMsg(v, ['error', 'warn']), fn: () => reverseConn(cid) });
  }
  const own = audit.list.filter(i => i.cid === cid && i.level !== 'info');
  if (own.length) items.splice(1, 0, { label: own[0].msg, level: own[0].level === 'error' ? 'bad' : 'warn' });
  items.push('-', { icon: 'trash', text: 'Delete connection', danger: true, fn: () => deleteConn(cid) });
  openMenu(items, x, y);
}
function openCanvasMenu(x, y) {
  const p = snapPos(screenToCanvas(x, y));
  const items = [
    { icon: 'userPlus', text: 'Add person here', fn: () => startAddPerson(p) },
    { icon: 'fit', text: 'Fit everyone in view', fn: () => fitView() },
    { icon: 'layout', text: 'Tidy layout', fn: () => tidyLayout() }
  ];
  if (Object.keys(state.nodes).length) items.push({ icon: 'selectAll', text: 'Select everyone', fn: selectAll });
  if (hist.index > 0) items.push('-', { icon: 'undo', text: 'Undo', fn: undo });
  openMenu(items, x, y);
}
function selectAll() { setSelection(Object.keys(state.nodes)); }

/** Select a person and all their descendants (follows parent → child links) */
function selectBranch(id) {
  const out = new Set([id]), stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const cid of adjacency.get(cur) || []) {
      const c = state.connections[cid];
      if (!c) continue;
      const next = c.type === 'parent' && c.from === cur ? c.to : (c.type === 'spouse' && out.size === 1 ? (c.from === cur ? c.to : c.from) : null);
      if (next && !out.has(next)) { out.add(next); stack.push(next); }
    }
  }
  setSelection([...out], id);
  toast(`${out.size} people in this branch`);
}

/** Create a relative next to a person and link them in one step */
function quickAddRelative(id, rel) {
  const n = state.nodes[id]; if (!n) return;
  const s = sizeOf(id);
  const offsets = { parent: [0, -170], child: [0, 170], spouse: [s.w + 60, 0], sibling: [-(s.w + 60), 0] };
  const [ox, oy] = offsets[rel];
  const pos = findFreeSpot(n.x + ox, n.y + oy);
  startAddPerson(pos);
  pendingRelative = { id, rel };
  updateFormIssues();
  const label = { parent: 'parent', child: 'child', spouse: 'partner', sibling: 'sibling' }[rel];
  $('form-title').textContent = `Add ${label} of ${displayName(n)}`;
}
let pendingRelative = null;

// ════════════════════════════════════════════════════════════
//  MODAL & PANELS
// ════════════════════════════════════════════════════════════
let pendingModal = null;
let lastFocus = null;
function showModal(title, body, onConfirm, { danger = false, confirmText = 'Confirm' } = {}) {
  $('modal-title').textContent = title;
  $('modal-body').textContent = body;
  const btn = $('modal-confirm');
  btn.className = 'modal-btn ' + (danger ? 'danger' : 'confirm');
  btn.textContent = confirmText;
  lastFocus = document.activeElement;
  $('modal-overlay').classList.add('open');
  pendingModal = onConfirm;
  btn.focus();
}
function closeModal(confirmed) {
  const fn = pendingModal;
  pendingModal = null;
  $('modal-overlay').classList.remove('open');
  lastFocus?.focus?.({ preventScroll: true });
  if (confirmed && fn) fn();
}
$('modal-confirm').addEventListener('click', () => closeModal(true));
$('modal-cancel').addEventListener('click', () => closeModal(false));
$('modal-overlay').addEventListener('pointerdown', e => { if (e.target === $('modal-overlay')) closeModal(false); });

const PANELS = ['import-panel', 'rel-panel', 'check-panel', 'kin-panel', 'versions-panel'];
function openPanel(id) {
  lastFocus = document.activeElement;
  $(id).classList.add('open');
}
function closePanel(id) {
  $(id).classList.remove('open');
  lastFocus?.focus?.({ preventScroll: true });
}
PANELS.forEach(id => {
  const p = $(id);
  p.addEventListener('pointerdown', e => { if (e.target === p) closePanel(id); });
  p.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closePanel(id)));
});
const openOverlay = () => ($('modal-overlay').classList.contains('open') ? 'modal' : PANELS.find(id => $(id).classList.contains('open')) || null);

// ════════════════════════════════════════════════════════════
//  FILE: DATA VALIDATION
// ════════════════════════════════════════════════════════════
/** Validate & normalise any loaded map so bad files can't break the app */
function normalizeMap(data) {
  if (!data || typeof data !== 'object' || !data.nodes || typeof data.nodes !== 'object') {
    throw new Error('This file is not a GeneaMap family tree.');
  }
  const str = v => (v == null ? '' : String(v)).slice(0, 5000);
  const num = v => (Number.isFinite(+v) ? Math.round(+v) : null);
  const nodes = {}, connections = {};
  const list = Array.isArray(data.nodes) ? data.nodes : Object.entries(data.nodes).map(([k, n]) => ({ id: k, ...n }));
  let i = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const id = str(raw.id) || `n${i}_imp`;
    if (nodes[id]) continue;
    const x = num(raw.x), y = num(raw.y);
    nodes[id] = {
      id, name: str(raw.name), gender: GENDERS.includes(raw.gender) ? raw.gender : 'neutral',
      birth: str(raw.birth), death: str(raw.death), place: str(raw.place), notes: str(raw.notes),
      ...Object.fromEntries(EXTRA_FIELDS.map(k => [k, k === 'birthOrder' ? (parseInt(raw[k], 10) > 0 ? String(parseInt(raw[k], 10)) : '') : str(raw[k])])),
      photo: typeof raw.photo === 'string' && /^p[0-9a-z]{3,40}$/.test(raw.photo) ? raw.photo : null,
      x: x ?? (i % 8) * 200, y: y ?? Math.floor(i / 8) * 140, group: raw.group ? str(raw.group) : null
    };
    i++;
  }
  const clist = Array.isArray(data.connections) ? data.connections
    : Object.entries(data.connections || {}).map(([k, c]) => ({ id: k, ...c }));
  const seen = new Set();
  let j = 0;
  for (const raw of clist) {
    if (!raw || !nodes[raw.from] || !nodes[raw.to] || raw.from === raw.to) continue;
    const pair = [raw.from, raw.to].sort().join('|');
    if (seen.has(pair)) continue;
    seen.add(pair);
    const id = str(raw.id) || `c${j}_imp`;
    connections[id] = { id, from: raw.from, to: raw.to, type: CONN_TYPES.includes(raw.type) ? raw.type : 'other' };
    j++;
  }
  const out = { title: str(data.title).trim() || 'Family Tree', nodes, connections };
  // photos travel with a file as data URLs; they are checked and kept outside the tree state
  if (data.photos && typeof data.photos === 'object') {
    out.photos = {};
    for (const [pid, d] of Object.entries(data.photos)) if (typeof d === 'string' && PHOTO_RE.test(d) && d.length < 4e6) out.photos[pid] = d;
  }
  if (data.kinship && typeof data.kinship === 'object' && Array.isArray(data.kinship.rules)) out.kinship = data.kinship;
  return out;
}
/** Move photos (and a kinship list) that arrived with a file into place; re-key photos by content */
function takeFileExtras(data) {
  const remap = {};
  for (const [pid, d] of Object.entries(data.photos || {})) { const id = addPhoto(d); if (id) remap[pid] = id; }
  for (const n of Object.values(data.nodes)) if (n.photo) n.photo = remap[n.photo] || (photos.has(n.photo) ? n.photo : null);
  delete data.photos;
  const k = data.kinship; delete data.kinship;
  return k || null;
}
function resyncCounters() {
  for (const id of Object.keys(state.nodes)) { const m = /^n(\d+)_/.exec(id); if (m) counters.n = Math.max(counters.n, +m[1]); }
  for (const id of Object.keys(state.connections)) { const m = /^c(\d+)_/.exec(id); if (m) counters.c = Math.max(counters.c, +m[1]); }
}
/** Parse a file's text as GeneaMap JSON or GEDCOM */
function parseMapText(text, filename = '', media = null) {
  const t = text.replace(/^\uFEFF/, '');
  if (/\.ged$/i.test(filename) || /^\s*0\s+HEAD/.test(t)) return parseGedcom(t, media);
  let data;
  try { data = JSON.parse(t); } catch { throw new Error('The file is not valid JSON or GEDCOM.'); }
  return normalizeMap(data);
}

// ════════════════════════════════════════════════════════════
//  SAVE / LOAD
// ════════════════════════════════════════════════════════════
let currentFileHandle = null;
async function saveMap(forceNew) {
  const blob = treeBlob();
  const filename = `${fileSafe(state.title)}_genealogy.json`;

  if (currentFileHandle && !forceNew) {
    try {
      const w = await currentFileHandle.createWritable();
      await w.write(blob); await w.close();
      await setFileLink(currentFileHandle, true);
      markBackedUp();
      toast(prefs.autoFile !== false ? `Saved to ${fileLink.name}. Changes are now saved to it automatically.` : 'Saved, file updated', { kind: 'ok' });
      return;
    } catch { currentFileHandle = null; }
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'GeneaMap family tree', accept: { 'application/json': ['.json'] } }]
      });
      const w = await h.createWritable();
      await w.write(blob); await w.close();
      await setFileLink(h, true);
      markBackedUp();
      toast(prefs.autoFile !== false ? `Saved to ${h.name}. Changes are now saved to it automatically.` : 'Saved. Save again to update this file.', { kind: 'ok' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      currentFileHandle = null;
    }
  }
  downloadBlob(blob, filename);
  markBackedUp();
  toast('Downloaded ' + filename + '. Keep it somewhere safe (Drive, a pen drive or another phone).', { kind: 'ok', duration: 6000 });
}

async function openFile() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: 'Family tree', accept: { 'application/json': ['.json'], 'text/plain': ['.ged'], 'application/zip': ['.zip'] } }]
      });
      const file = await h.getFile();
      loadFromFile(file, /\.json$/i.test(file.name) ? h : null);
      return;
    } catch (err) { if (err.name === 'AbortError') return; }
  }
  $('load-file-input').click();
}
$('load-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) loadFromFile(file);
});

async function loadFromFile(file, handle = null) {
  let data;
  try { data = await readMapFile(file); }
  catch (err) { toast(err.message || 'Could not read that file'); return; }
  const n = Object.keys(data.nodes).length;
  const doLoad = async () => {
    await saveVersion(`Before opening ${file.name}`);
    loadMap(data);
    if (handle) await setFileLink(handle, false);
  };
  if (!Object.keys(state.nodes).length) doLoad();
  else showModal(`Open “${data.title}”?`, `${n} people. This replaces the current map — you can undo it.`, doLoad, { confirmText: 'Open' });
}

function loadMap(data, { keepLink = false } = {}) {
  if (!keepLink) setFileLink(null);
  const vocab = takeFileExtras(data);
  if (vocab) {
    const v = adoptVocab(vocab, data.title);
    setTimeout(() => toast(`This tree uses the kinship terms “${v.name}”. They are now in use (Tools › Kinship terms).`, { duration: 7000 }), 2500);
  }
  kinView.ego = null; kinLabels.clear(); renderKinViewStatus();
  state = data;
  $('f-map-title').value = state.title === 'Family Tree' ? '' : state.title;
  resyncCounters();
  clearForm(); cancelConnect(); clearPathHighlight();
  sel.nodes.clear(); sel.conn = null; sel.primary = null;
  rebuildAll();
  // GEDCOM imports and position-less files get a generated layout
  if (data._needsLayout) { delete state._needsLayout; applyPositions(computeLayout(Object.keys(state.nodes)), false); }
  fitView(false);
  commit();
  setStatus();
  runAudit();
  if (audit.errors) toast(`Opened ${state.title} — ${audit.errors} relationship problem${audit.errors > 1 ? 's' : ''} found`, { action: { label: 'Review', fn: openCheckPanel } });
  else toast(`Opened ${state.title}`);
}

function newMap() {
  const go = async () => {
    await saveVersion('Before starting a new map');
    setFileLink(null);
    kinView.ego = null; kinLabels.clear(); renderKinViewStatus();
    state = emptyState();
    $('f-map-title').value = '';
    clearForm(); cancelConnect(); clearPathHighlight();
    sel.nodes.clear(); sel.conn = null; sel.primary = null;
    rebuildAll();
    Object.assign(view, { x: 60, y: 60, scale: 1 }); requestTransform();
    commit();
    toast('New map started', { action: { label: 'Undo', fn: undo } });
  };
  if (!Object.keys(state.nodes).length) go();
  else showModal('Start a new map?', 'The current map will be cleared. You can undo this, but save a file first if you want to keep a copy.', go, { danger: true, confirmText: 'Start new' });
}

$('f-map-title').addEventListener('input', () => { state.title = $('f-map-title').value.trim() || 'Family Tree'; });
$('f-map-title').addEventListener('change', commit);

// Drop a file anywhere to open it
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); if (!openOverlay()) { dragDepth++; frameEl.classList.add('file-drag'); } });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; frameEl.classList.remove('file-drag'); } });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0; frameEl.classList.remove('file-drag');
  if (openOverlay()) return; // the import panel handles its own drop
  const f = e.dataTransfer.files[0];
  if (f) loadFromFile(f);
});

// Launched as a file handler (installed PWA → "Open with GeneaMap")
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async params => {
    const h = params.files?.[0]; if (!h) return;
    const f = await h.getFile();
    loadFromFile(f, /\.json$/i.test(f.name) ? h : null);
  });
}

// ════════════════════════════════════════════════════════════
//  IMPORT & MERGE
// ════════════════════════════════════════════════════════════
const dropZone = $('drop-zone');
let importData = null;
const DROP_DEFAULT = dropZone.innerHTML;
function openImport() {
  importData = null; dropZone.innerHTML = DROP_DEFAULT; dropZone.classList.remove('ready');
  openPanel('import-panel');
}
dropZone.addEventListener('click', () => $('import-file-input').click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('import-file-input').click(); } });
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); e.stopPropagation();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0]; if (f) readImportFile(f);
});
$('import-file-input').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) readImportFile(f);
});
async function readImportFile(file) {
  try {
    importData = await readMapFile(file);
    dropZone.classList.add('ready');
    dropZone.innerHTML = `<div class="drop-zone-icon">${icon('check')}</div><div><strong>${escHtml(importData.title)}</strong></div>`
      + `<div class="dim small">${Object.keys(importData.nodes).length} people, ${Object.keys(importData.connections).length} connections</div>`;
  } catch (err) { toast(err.message || 'Could not read that file'); importData = null; }
}
$('btn-do-import').addEventListener('click', () => {
  if (!importData) { toast('Choose a file first'); return; }
  mergeMap(importData);
  importData = null;
  closePanel('import-panel');
});

function mergeMap(data) {
  saveVersion('Before merging ' + (data.title || 'a tree'));
  const vocab = takeFileExtras(data);
  if (vocab && !activeVocab()) adoptVocab(vocab, data.title);
  const group = data.title || 'Imported';
  const idMap = {};
  const incoming = Object.values(data.nodes);
  if (data._needsLayout) {
    const tmp = state; // lay out in isolation
    state = data;
    const pos = computeLayout(Object.keys(data.nodes));
    state = tmp;
    incoming.forEach(n => Object.assign(n, pos[n.id]));
  }
  const cur = boundsOf(Object.keys(state.nodes));
  const inc = incoming.length ? incoming.reduce((b, n) => ({ minX: Math.min(b.minX, n.x), minY: Math.min(b.minY, n.y) }), { minX: Infinity, minY: Infinity }) : { minX: 0, minY: 0 };
  const ox = cur ? cur.maxX + 240 - inc.minX : -inc.minX;
  const oy = cur ? cur.minY - inc.minY : -inc.minY;
  for (const n of incoming) {
    const id = uid();
    idMap[n.id] = id;
    state.nodes[id] = { ...n, id, x: n.x + ox, y: n.y + oy, group };
    renderNode(state.nodes[id], false);
  }
  for (const n of incoming) { const el = nodeEls.get(idMap[n.id]); nodeSize.set(idMap[n.id], { w: el.offsetWidth, h: el.offsetHeight }); }
  for (const c of Object.values(data.connections)) {
    if (idMap[c.from] && idMap[c.to]) addConnection(idMap[c.from], idMap[c.to], c.type, { silent: true, force: true });
  }
  markAllConns();
  commit();
  fitView();
  runAudit();
  toast(`Merged ${incoming.length} people from “${group}”${audit.errors ? ` — ${audit.errors} problem${audit.errors > 1 ? 's' : ''} to review` : ''}`,
    { action: audit.errors ? { label: 'Review', fn: openCheckPanel } : { label: 'Undo', fn: undo } });
}

// ════════════════════════════════════════════════════════════
//  GEDCOM  (import + export — the standard genealogy exchange format)
// ════════════════════════════════════════════════════════════
function parseGedcom(text, media = null) {
  const recs = [];
  let rec = null;
  const stack = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const m = /^\s*(\d+)\s+(@[^@]+@\s+)?(\S+)(?:\s(.*))?$/.exec(raw);
    if (!m) continue;
    const level = +m[1], xref = m[2] ? m[2].trim() : null, tag = m[3].toUpperCase(), val = m[4] ?? '';
    const item = { tag, val, xref, kids: [] };
    if (level === 0) { rec = item; recs.push(rec); stack.length = 0; stack[0] = rec; continue; }
    const parent = stack[level - 1];
    if (!parent) continue;
    if (tag === 'CONT') { parent.val += '\n' + val; continue; }
    if (tag === 'CONC') { parent.val += val; continue; }
    parent.kids.push(item);
    stack[level] = item; stack.length = level + 1;
  }
  const kid = (it, tag) => it?.kids.find(k => k.tag === tag);
  const kval = (it, tag) => kid(it, tag)?.val?.trim() || '';
  const nodes = {}, connections = {};
  let title = 'GEDCOM import', ci = 0;
  const head = recs.find(r => r.tag === 'HEAD');
  const fileName = kval(head, 'FILE');
  if (fileName) title = fileName.replace(/\.ged$/i, '');

  for (const r of recs) {
    if (r.tag !== 'INDI' || !r.xref) continue;
    const nameRec = kid(r, 'NAME');
    let name = (nameRec?.val || '').replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
    if (!name && nameRec) name = [kval(nameRec, 'GIVN'), kval(nameRec, 'SURN')].filter(Boolean).join(' ');
    const sex = kval(r, 'SEX').toUpperCase();
    const birt = kid(r, 'BIRT') || kid(r, 'BAPM') || kid(r, 'CHR');
    const deat = kid(r, 'DEAT') || kid(r, 'BURI');
    const notes = r.kids.filter(k => k.tag === 'NOTE' && !/^@.+@$/.test(k.val)).map(k => k.val.trim());
    const gname = it => (it?.val || '').replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
    const other = r.kids.filter(k => k.tag === 'NAME' && k !== nameRec).map(gname).filter(Boolean);
    const extra = { other: other.join('; '), occupation: kval(r, 'OCCU'), title: kval(r, 'TITL'), residence: kval(kid(r, 'RESI'), 'PLAC') || kval(r, 'RESI'), deathPlace: kval(deat, 'PLAC'), clan: '', birthOrder: '', source: '' };
    for (const f of r.kids.filter(k => k.tag === 'FACT' || k.tag === 'EVEN' || k.tag === '_CLAN')) {
      const type = kval(f, 'TYPE'), val = (f.val || '').trim();
      if (f.tag === '_CLAN' || /clan|lineage|gotra|gotro|sagei|lineage|tribe|caste|kul/i.test(type)) extra.clan = extra.clan ? extra.clan + '; ' + val : val;
      else if (/birth\s*order/i.test(type) && parseInt(val, 10) > 0) extra.birthOrder = String(parseInt(val, 10));
      else if (val || type) notes.push([type, val].filter(Boolean).join(': '));
    }
    const src = r.kids.filter(k => k.tag === 'SOUR' && k.val && !/^@.+@$/.test(k.val)).map(k => k.val.trim());
    if (src.length) extra.source = src.join('; ');
    let photo = null;
    if (media) for (const o of r.kids.filter(k => k.tag === 'OBJE')) {
      const f = (kval(o, 'FILE') || '').replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
      const d = media.get(f) || media.get(f.split('/').pop()) || [...media].find(([k]) => k.endsWith('/' + f.split('/').pop()))?.[1];
      if (d) { photo = addPhoto(d); if (photo) break; }
    }
    nodes[r.xref] = {
      id: r.xref, name, gender: sex === 'M' ? 'male' : sex === 'F' ? 'female' : 'neutral',
      birth: kval(birt, 'DATE'), death: kval(deat, 'DATE') || (deat && /^Y/i.test(deat.val) ? '?' : ''),
      place: kval(birt, 'PLAC'), notes: notes.join('\n'), ...extra, photo, x: 0, y: 0, group: null
    };
  }
  const link = (from, to, type) => {
    if (!nodes[from] || !nodes[to] || from === to) return;
    const id = `c${++ci}_ged`;
    connections[id] = { id, from, to, type };
  };
  for (const r of recs) {
    if (r.tag !== 'FAM') continue;
    const parents = r.kids.filter(k => k.tag === 'HUSB' || k.tag === 'WIFE').map(k => k.val.trim());
    const kids = r.kids.filter(k => k.tag === 'CHIL').map(k => k.val.trim());
    if (parents.length === 2) link(parents[0], parents[1], 'spouse');
    for (const c of kids) for (const p of parents) link(p, c, 'parent');
    if (!parents.length) for (let i = 1; i < kids.length; i++) link(kids[i - 1], kids[i], 'sibling');
  }
  if (!Object.keys(nodes).length) throw new Error('No people found in that GEDCOM file.');
  const out = normalizeMap({ title, nodes, connections });
  out._needsLayout = true;
  for (const n of Object.values(out.nodes)) if (n.photo && !photos.has(n.photo)) n.photo = null;
  return out;
}

function exportGedcom(withPhotos = false) {
  const nodes = Object.values(state.nodes);
  if (!nodes.length) { toast('Nothing to export yet'); return; }
  const media = [];
  const xref = new Map(nodes.map((n, i) => [n.id, `@I${i + 1}@`]));
  const clean = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();
  const lines = ['0 HEAD', '1 SOUR GENEAMAP', '2 NAME GeneaMap', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8', `1 FILE ${clean(state.title)}.ged`];
  const famOf = new Map(); // key → { parents:[], kids:[] }
  const famKey = ps => ps.slice().sort().join('+');
  const parentsOf = new Map();
  const conns = Object.values(state.connections);
  for (const c of conns) if (c.type === 'parent') {
    if (!parentsOf.has(c.to)) parentsOf.set(c.to, []);
    parentsOf.get(c.to).push(c.from);
  }
  for (const [child, ps] of parentsOf) {
    const k = famKey(ps.slice(0, 2));
    if (!famOf.has(k)) famOf.set(k, { parents: ps.slice(0, 2), kids: [] });
    famOf.get(k).kids.push(child);
  }
  for (const c of conns) if (c.type === 'spouse') {
    const k = famKey([c.from, c.to]);
    if (!famOf.has(k)) famOf.set(k, { parents: [c.from, c.to], kids: [] });
  }
  // sibling groups with no recorded parents become parent-less families
  const sibParent = new Map();
  const find = x => { while (sibParent.has(x) && sibParent.get(x) !== x) x = sibParent.get(x); return x; };
  for (const c of conns) if (c.type === 'sibling' && !parentsOf.has(c.from) && !parentsOf.has(c.to)) {
    sibParent.set(c.from, find(c.from)); sibParent.set(c.to, find(c.to));
    sibParent.set(find(c.from), find(c.to));
  }
  const groups = new Map();
  for (const id of sibParent.keys()) { const r = find(id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(id); }
  for (const kids of groups.values()) famOf.set('sib:' + kids.join(), { parents: [], kids });

  const fams = [...famOf.values()].map((f, i) => ({ ...f, x: `@F${i + 1}@` }));
  const famsOfPerson = new Map(), famcOfPerson = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const f of fams) { f.parents.forEach(p => push(famsOfPerson, p, f.x)); f.kids.forEach(k => push(famcOfPerson, k, f.x)); }

  for (const n of nodes) {
    lines.push(`0 ${xref.get(n.id)} INDI`);
    const parts = clean(n.name).split(' ');
    const sur = parts.length > 1 ? parts.pop() : '';
    lines.push(`1 NAME ${parts.join(' ')}${sur ? ` /${sur}/` : ''}`);
    lines.push(`1 SEX ${n.gender === 'male' ? 'M' : n.gender === 'female' ? 'F' : 'U'}`);
    if (n.birth || n.place) { lines.push('1 BIRT'); if (n.birth) lines.push(`2 DATE ${clean(n.birth)}`); if (n.place) lines.push(`2 PLAC ${clean(n.place)}`); }
    String(n.other || '').split(/\s*;\s*|\n/).map(clean).filter(Boolean).forEach(o => lines.push(`1 NAME ${o}`, '2 TYPE aka'));
    if (n.death || n.deathPlace) { lines.push('1 DEAT' + (n.death ? '' : ' Y')); if (n.death && n.death !== '?') lines.push(`2 DATE ${clean(n.death)}`); if (n.deathPlace) lines.push(`2 PLAC ${clean(n.deathPlace)}`); }
    if (n.title) lines.push(`1 TITL ${clean(n.title)}`);
    if (n.occupation) lines.push(`1 OCCU ${clean(n.occupation)}`);
    if (n.residence) lines.push('1 RESI', `2 PLAC ${clean(n.residence)}`);
    if (n.clan) lines.push(`1 FACT ${clean(n.clan)}`, '2 TYPE Clan or lineage');
    if (n.birthOrder) lines.push(`1 FACT ${clean(n.birthOrder)}`, '2 TYPE Birth order');
    if (n.source) lines.push(`1 SOUR ${clean(n.source)}`);
    if (withPhotos && n.photo && photos.has(n.photo)) {
      const d = photos.get(n.photo), ext = /^data:image\/png/.test(d) ? 'png' : /^data:image\/webp/.test(d) ? 'webp' : 'jpg';
      const name = `photos/${xref.get(n.id).replace(/@/g, '')}.${ext}`;
      media.push({ name, d });
      lines.push('1 OBJE', `2 FILE ${name}`, `3 FORM ${ext}`, `3 TITL ${clean(n.name) || 'Photo'}`);
    }
    if (n.notes) String(n.notes).split(/\r?\n/).forEach((l, i) => lines.push(`${i ? '2 CONT' : '1 NOTE'} ${l}`));
    (famsOfPerson.get(n.id) || []).forEach(f => lines.push(`1 FAMS ${f}`));
    (famcOfPerson.get(n.id) || []).forEach(f => lines.push(`1 FAMC ${f}`));
  }
  for (const f of fams) {
    lines.push(`0 ${f.x} FAM`);
    const [a, b] = f.parents.map(id => state.nodes[id]);
    let husb = a, wife = b;
    if ((a?.gender === 'female') || (b?.gender === 'male')) [husb, wife] = [b, a];
    if (husb) lines.push(`1 HUSB ${xref.get(husb.id)}`);
    if (wife) lines.push(`1 WIFE ${xref.get(wife.id)}`);
    f.kids.forEach(k => lines.push(`1 CHIL ${xref.get(k)}`));
  }
  lines.push('0 TRLR');
  const ged = lines.join('\r\n') + '\r\n';
  if (withPhotos) {
    if (!media.length) { toast('No one in this tree has a photo yet. Exporting the plain GEDCOM file.'); exportGedcom(false); return; }
    const files = [{ name: `${fileSafe(state.title)}.ged`, data: new TextEncoder().encode(ged) }];
    for (const m of media) {
      const bin = atob(m.d.split(',')[1]); const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      files.push({ name: m.name, data: u });
    }
    downloadBlob(zipBlob(files), `${fileSafe(state.title)}_gedcom.zip`);
    toast(`Exported GEDCOM with ${media.length} photo${media.length > 1 ? 's' : ''} (.zip)`);
    return;
  }
  downloadBlob(new Blob([ged], { type: 'text/plain' }), `${fileSafe(state.title)}.ged`);
  toast('Exported GEDCOM file');
}

// ════════════════════════════════════════════════════════════
//  EXPORT PNG
// ════════════════════════════════════════════════════════════
async function exportPNG() {
  const ids = Object.keys(state.nodes);
  if (!ids.length) { toast('Nothing to export yet'); return; }
  toast('Rendering image…');
  try { await Promise.all([document.fonts?.load(`600 15px ${EXPORT_FONT}`), document.fonts?.load(`12px ${EXPORT_FONT}`)]); } catch { /* ignore */ }
  const b = boundsOf(ids), pad = 48, titleH = 56;
  const W = b.maxX - b.minX + pad * 2, H = b.maxY - b.minY + pad * 2 + titleH;
  const scale = Math.max(0.25, Math.min(2, Math.sqrt(16e6 / (W * H)), 8000 / W, 8000 / H));
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(W * scale); cv.height = Math.ceil(H * scale);
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = EXPORT_PAL.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = EXPORT_PAL.text;
  ctx.font = `640 26px ${EXPORT_FONT}`;
  ctx.fillText(state.title, pad, pad + 8);
  ctx.translate(pad - b.minX, pad + titleH - b.minY);

  ctx.lineWidth = 2.5;
  for (const c of Object.values(state.connections)) {
    const geo = connGeometry(c); if (!geo) continue;
    ctx.strokeStyle = EXPORT_PAL.conn[c.type] || EXPORT_PAL.conn.other; ctx.setLineDash(CONN_DASH[c.type]);
    ctx.stroke(new Path2D(geo.d));
    if (CONN_LABEL[c.type]) {
      ctx.setLineDash([]); ctx.fillStyle = EXPORT_PAL.text; ctx.font = `13px ${EXPORT_FONT}`; ctx.textAlign = 'center';
      ctx.fillText(CONN_LABEL[c.type], geo.mx, geo.my - 5); ctx.textAlign = 'left';
    }
  }
  ctx.setLineDash([]);
  const wrap = (text, maxW, font, maxLines) => {
    ctx.font = font;
    const words = String(text).split(/\s+/), lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
    return lines;
  };
  const GC = EXPORT_PAL.g, GT = EXPORT_PAL.tint;
  const imgs = new Map();
  if (prefs.card.photo) await Promise.all(ids.map(async id => {
    const pid = state.nodes[id].photo; if (!pid || !photos.has(pid) || imgs.has(pid)) return;
    const im = new Image(); im.src = photos.get(pid);
    try { await im.decode(); imgs.set(pid, im); } catch { /* skip */ }
  }));
  for (const id of ids) {
    const n = state.nodes[id], s = sizeOf(id);
    ctx.fillStyle = 'rgba(0,0,0,.09)';
    roundRect(ctx, n.x, n.y + 2, s.w, s.h, 4); ctx.fill();
    ctx.fillStyle = n.group ? EXPORT_PAL.imported : (GT[n.gender] || GT.neutral);
    roundRect(ctx, n.x, n.y, s.w, s.h, 4); ctx.fill();
    ctx.save(); roundRect(ctx, n.x, n.y, s.w, s.h, 4); ctx.clip();
    ctx.fillStyle = GC[n.gender] || GC.neutral; ctx.fillRect(n.x, n.y, s.w, 3);
    const im = prefs.card.photo && n.photo && imgs.get(n.photo);
    const tx = n.x + (im ? 58 : 12), maxW = s.w - (im ? 70 : 24);
    if (im) {   // square crop from the centre, like the card
      const sz = Math.min(im.naturalWidth, im.naturalHeight);
      ctx.save(); roundRect(ctx, n.x + 10, n.y + 12, 40, 40, 3); ctx.clip();
      ctx.drawImage(im, (im.naturalWidth - sz) / 2, (im.naturalHeight - sz) / 2, sz, sz, n.x + 10, n.y + 12, 40, 40);
      ctx.restore();
    }
    let y = n.y + 14;
    ctx.fillStyle = EXPORT_PAL.text;
    for (const l of wrap(displayName(n), maxW, `620 14px ${EXPORT_FONT}`, 3)) { y += 17; ctx.fillText(l, tx, y); }
    ctx.fillStyle = EXPORT_PAL.muted;
    const dates = lifeSpan(n);
    if (dates) { y += 16; ctx.font = `12px ${EXPORT_FONT}`; ctx.fillText(dates, tx, y); }
    if (prefs.card.other && n.other) { for (const l of wrap(n.other, maxW, `italic 12px ${EXPORT_FONT}`, 2)) { y += 15; ctx.fillText(l, tx, y); } }
    if (prefs.card.place && n.place) {
      wrap(n.place, maxW - 16, `12px ${EXPORT_FONT}`, 2).forEach((l, i) => {
        y += 15;
        if (!i) {   // the same line-icon pin as on screen
          ctx.save(); ctx.translate(tx - 1, y - 10); ctx.scale(0.5, 0.5);
          ctx.strokeStyle = EXPORT_PAL.muted; ctx.lineWidth = 3.4; ctx.stroke(new Path2D('M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z')); ctx.restore();
        }
        ctx.fillText(l, tx + 16, y);
      });
    }
    for (const k of ['clan', 'occupation']) if (prefs.card[k] && n[k]) { for (const l of wrap(n[k], maxW, `12px ${EXPORT_FONT}`, 2)) { y += 15; ctx.fillText(l, tx, y); } }
    if (prefs.card.notes && n.notes) { ctx.fillStyle = EXPORT_PAL.muted; for (const l of wrap(n.notes, maxW, `11.5px ${EXPORT_FONT}`, 2)) { y += 15; ctx.fillText(l, tx, y); } }
    const kl = kinLabels.get(id);
    if (kl) { ctx.fillStyle = kl.local ? '#8f600d' : EXPORT_PAL.muted; for (const l of wrap(kl.text, maxW, `620 12.5px ${EXPORT_FONT}`, 2)) { y += 16; ctx.fillText(l, tx, y); } }
    ctx.restore();
  }
  cv.toBlob(blob => {
    if (!blob) { toast('The tree is too large to export as one image'); return; }
    downloadBlob(blob, `${fileSafe(state.title)}.png`);
    toast('Image downloaded');
  }, 'image/png');
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ════════════════════════════════════════════════════════════
//  MINIMAP  (content redrawn only when people move; viewport box on pan)
// ════════════════════════════════════════════════════════════
const mmCanvas = $('minimap-canvas'), mmBox = $('minimap'), mmVp = $('minimap-viewport');
let mm = null; // { minX, minY, sc, ox, oy, W, H }
const mmSize = { W: 0, H: 0 };
new ResizeObserver(([e]) => {
  mmSize.W = Math.round(e.contentRect.width); mmSize.H = Math.round(e.contentRect.height);
  dirty.minimap = true; schedule();
}).observe(mmBox);
function drawMinimap() {
  const { W, H } = mmSize;
  if (!prefs.minimap || !W || !H) { mm = null; mmVp.style.display = 'none'; return; }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (mmCanvas.width !== W * dpr || mmCanvas.height !== H * dpr) { mmCanvas.width = W * dpr; mmCanvas.height = H * dpr; }
  const ctx = mmCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const b = boundsOf(Object.keys(state.nodes));
  if (!b) { mm = null; mmVp.style.display = 'none'; return; }
  const pad = 6, bw = b.maxX - b.minX || 1, bh = b.maxY - b.minY || 1;
  const sc = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
  const ox = (W - bw * sc) / 2, oy = (H - bh * sc) / 2;
  mm = { minX: b.minX, minY: b.minY, sc, ox, oy, W, H };
  const X = x => ox + (x - b.minX) * sc, Y = y => oy + (y - b.minY) * sc;
  const P = palette();
  ctx.lineWidth = 0.8;
  for (const c of Object.values(state.connections)) {
    const a = state.nodes[c.from], z = state.nodes[c.to]; if (!a || !z) continue;
    const sa = sizeOf(c.from), sz = sizeOf(c.to);
    ctx.strokeStyle = P.conn[c.type] || P.conn.other;
    ctx.beginPath();
    ctx.moveTo(X(a.x + sa.w / 2), Y(a.y + sa.h / 2));
    ctx.lineTo(X(z.x + sz.w / 2), Y(z.y + sz.h / 2));
    ctx.stroke();
  }
  for (const n of Object.values(state.nodes)) {
    const s = sizeOf(n.id);
    ctx.fillStyle = sel.nodes.has(n.id) ? P.sel : n.group ? P.imported : (P.g[n.gender] || P.g.neutral);
    ctx.fillRect(X(n.x), Y(n.y), Math.max(3, s.w * sc), Math.max(2, s.h * sc));
  }
}
function drawMinimapViewport() {
  if (!mm) { mmVp.style.display = 'none'; return; }
  const x0 = mm.ox + (-view.x / view.scale - mm.minX) * mm.sc;
  const y0 = mm.oy + (-view.y / view.scale - mm.minY) * mm.sc;
  const x1 = x0 + (wrapRect.width / view.scale) * mm.sc;
  const y1 = y0 + (wrapRect.height / view.scale) * mm.sc;
  const cx0 = clamp(x0, 0, mm.W), cy0 = clamp(y0, 0, mm.H), cx1 = clamp(x1, 0, mm.W), cy1 = clamp(y1, 0, mm.H);
  mmVp.style.display = cx1 - cx0 < 2 || cy1 - cy0 < 2 ? 'none' : 'block';
  mmVp.style.transform = `translate(${cx0}px, ${cy0}px)`;
  mmVp.style.width = (cx1 - cx0) + 'px';
  mmVp.style.height = (cy1 - cy0) + 'px';
}
function minimapNavigate(e) {
  if (!mm) return;
  const r = mmBox.getBoundingClientRect();
  const wx = mm.minX + (e.clientX - r.left - mm.ox) / mm.sc;
  const wy = mm.minY + (e.clientY - r.top - mm.oy) / mm.sc;
  view.x = wrapRect.width / 2 - wx * view.scale;
  view.y = wrapRect.height / 2 - wy * view.scale;
  requestTransform();
}
mmBox.addEventListener('pointerdown', e => {
  e.stopPropagation(); e.preventDefault();
  mmBox.setPointerCapture(e.pointerId);
  minimapNavigate(e);
  const move = ev => minimapNavigate(ev);
  const up = () => { mmBox.removeEventListener('pointermove', move); mmBox.removeEventListener('pointerup', up); mmBox.removeEventListener('pointercancel', up); };
  mmBox.addEventListener('pointermove', move);
  mmBox.addEventListener('pointerup', up);
  mmBox.addEventListener('pointercancel', up);
});

// ════════════════════════════════════════════════════════════
//  CHROME: side panel, accordions, theme
// ════════════════════════════════════════════════════════════
/** In the stacked (phone) layout the controls can be folded down to their toolbar */
function setSidebar(open) {
  const side = $('sidebar');
  side.classList.toggle('collapsed', !open);
  $('btn-sidebar').setAttribute('aria-expanded', open);
  if (!open && $('side-body').contains(document.activeElement)) document.activeElement.blur();
}
const toggleSidebar = () => setSidebar($('sidebar').classList.contains('collapsed'));

// Accordion sections: open state remembered per device
const accEls = new Map([...document.querySelectorAll('.gm-acc')].map(d => [d.dataset.acc, d]));
function initAccordions() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(ACC_KEY) || 'null'); } catch { /* ignore */ }
  if (saved && typeof saved === 'object') for (const [k, d] of accEls) if (k in saved) d.open = !!saved[k];
  const store = () => {
    const o = {};
    for (const [k, d] of accEls) o[k] = d.open;
    try { localStorage.setItem(ACC_KEY, JSON.stringify(o)); } catch { /* ignore */ }
  };
  for (const d of accEls.values()) d.addEventListener('toggle', store);
}
/** Open a side-panel section and bring it into view */
function revealSection(name) {
  setSidebar(true);
  const d = accEls.get(name); if (!d) return;
  d.open = true;
  requestAnimationFrame(() => {
    const body = $('side-body'), r = d.getBoundingClientRect(), b = body.getBoundingClientRect();
    if (r.top < b.top || r.top > b.bottom - 60) body.scrollTo({ top: body.scrollTop + r.top - b.top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

function applyPrefs() {
  mmBox.classList.toggle('hidden', !prefs.minimap);
  $('zoom-controls').classList.toggle('no-minimap', !prefs.minimap);
  $('btn-minimap').setAttribute('aria-checked', prefs.minimap);
  applyTheme();
  dirty.minimap = true; schedule();
}

const THEME_META = { light: '#d8d5ce', dark: '#1d1e20' };
function applyTheme() {
  const t = effectiveTheme();
  frameEl.classList.remove('gm-theme-light', 'gm-theme-dark');
  frameEl.classList.add('gm-theme-' + t);
  document.documentElement.style.background = THEME_META[t];
  const meta = document.getElementById('meta-theme'); if (meta) meta.content = THEME_META[t];
  for (const b of document.querySelectorAll('[data-theme-set]')) b.setAttribute('aria-pressed', b.dataset.themeSet === t);
  PAL = null; dirty.minimap = true; schedule();
}
function setTheme(t, announce = true) {
  prefs.theme = t === 'dark' ? 'dark' : 'light';
  savePrefs(); applyTheme();
  if (announce) toast(prefs.theme === 'dark' ? 'Dark theme (graphite)' : 'Light theme (stone)');
}
const toggleTheme = () => setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');

// Full screen: handy when the app sits in a small box on a page (iframe needs allow="fullscreen")
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
function toggleFullscreen() {
  const req = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  try {
    const p = fsEl() ? exit.call(document) : req.call(document.documentElement);
    p?.catch?.(() => toast('Full screen is not allowed here'));
  } catch { toast('Full screen is not allowed here'); }
}
function syncFullscreen() {
  const b = $('btn-fullscreen'); if (!b) return;
  const on = !!fsEl();
  b.setAttribute('aria-pressed', on);
  b.querySelector('.lbl').textContent = on ? 'Exit full screen' : 'Full screen';
  b.title = on ? 'Exit full screen (Esc)' : 'Fill the whole screen';
  refreshWrapRect();
}
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('webkitfullscreenchange', syncFullscreen);
document.addEventListener('click', e => { const b = e.target.closest('[data-theme-set]'); if (b) setTheme(b.dataset.themeSet); });

// Keep cached geometry fresh when the canvas area changes size or moves
/* When the container is resized, keep the same part of the tree in the middle of the canvas
   instead of letting it drift towards a corner (or out of sight in a smaller box). */
const refreshWrapRect = () => {
  const old = wrapRect;
  wrapRect = canvasWrap.getBoundingClientRect();
  if (old && old.width && old.height && wrapRect.width && wrapRect.height
      && (old.width !== wrapRect.width || old.height !== wrapRect.height)) {
    view.x += (wrapRect.width - old.width) / 2;
    view.y += (wrapRect.height - old.height) / 2;
    requestTransform();
  }
  dirty.minimap = true; schedule();
};
/** True if at least part of one person is inside the visible canvas */
function anyoneVisible() {
  const vx0 = -view.x / view.scale, vy0 = -view.y / view.scale;
  const vx1 = vx0 + wrapRect.width / view.scale, vy1 = vy0 + wrapRect.height / view.scale;
  return Object.values(state.nodes).some(n => { const s = sizeOf(n.id); return n.x < vx1 && n.x + s.w > vx0 && n.y < vy1 && n.y + s.h > vy0; });
}
new ResizeObserver(refreshWrapRect).observe(canvasWrap);
window.addEventListener('resize', refreshWrapRect);
NARROW_MQ.addEventListener('change', refreshWrapRect);

// ════════════════════════════════════════════════════════════
//  SEARCH
// ════════════════════════════════════════════════════════════
function searchPeople(q, limit = 12) {
  const lower = q.toLowerCase().trim();
  if (!lower) return [];
  const scored = [];
  for (const n of Object.values(state.nodes)) {
    const name = (n.name || '').toLowerCase();
    let score = -1;
    if (name.startsWith(lower)) score = 0;
    else if (name.split(/\s+/).some(w => w.startsWith(lower))) score = 1;
    else if (name.includes(lower)) score = 2;
    else if ((n.other || '').toLowerCase().includes(lower)) score = 2;
    else if ((n.place || '').toLowerCase().includes(lower) || (n.birth || '').includes(lower) || (n.clan || '').toLowerCase().includes(lower) || (n.residence || '').toLowerCase().includes(lower)) score = 3;
    if (score >= 0) scored.push([score, n]);
  }
  return scored.sort((a, b) => a[0] - b[0] || (a[1].name || '').localeCompare(b[1].name || '')).slice(0, limit).map(s => s[1]);
}
/** Highlight on raw text, then escape each part (never regex over escaped HTML) */
function highlight(str, q) {
  const i = q ? str.toLowerCase().indexOf(q.toLowerCase().trim()) : -1;
  if (i < 0) return escHtml(str);
  const len = q.trim().length;
  return escHtml(str.slice(0, i)) + '<mark>' + escHtml(str.slice(i, i + len)) + '</mark>' + escHtml(str.slice(i + len));
}

(function initSearch() {
  const inp = $('search-input'), dd = $('search-dropdown'), clr = $('search-clear');
  let results = [], active = -1;
  const close = () => { dd.classList.remove('open'); inp.setAttribute('aria-expanded', 'false'); active = -1; };
  function render() {
    const q = inp.value;
    results = searchPeople(q);
    active = -1;
    if (!q.trim()) { close(); dd.innerHTML = ''; return; }
    dd.innerHTML = results.length ? results.map((n, i) => {
      const sub = [lifeSpan(n), n.place].filter(Boolean).join(' · ');
      return `<div class="search-result" role="option" data-i="${i}"><div class="sr-name">${highlight(displayName(n), q)}</div>${sub ? `<div class="sr-sub">${escHtml(sub)}</div>` : ''}</div>`;
    }).join('') : '<div class="search-empty">No one matches that name</div>';
    dd.classList.add('open'); inp.setAttribute('aria-expanded', 'true');
  }
  function setActive(i) {
    const items = dd.querySelectorAll('.search-result');
    items.forEach(el => el.classList.remove('active'));
    if (items[i]) { items[i].classList.add('active'); items[i].scrollIntoView({ block: 'nearest' }); }
    active = i;
  }
  function choose(n) {
    if (!n) return;
    close();
    inp.blur();
    focusNode(n.id);
    setStatus('Found: ' + displayName(n));
  }
  const renderSoon = debounce(render, 60);
  inp.addEventListener('input', () => { clr.classList.toggle('show', !!inp.value); renderSoon(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    // stopPropagation: the same keystroke must not also reach the global shortcuts
    // (Enter would open the chosen person for editing, Escape would clear the selection)
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); renderSoon.flush(); choose(results[active >= 0 ? active : 0]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); inp.blur(); }
  });
  inp.addEventListener('focus', () => { if (inp.value) render(); });
  inp.addEventListener('blur', () => setTimeout(close, 150));
  dd.addEventListener('pointerdown', e => {
    const el = e.target.closest('.search-result'); if (!el) return;
    e.preventDefault();
    choose(results[+el.dataset.i]);
  });
  clr.addEventListener('click', () => { inp.value = ''; clr.classList.remove('show'); close(); inp.focus(); });
})();

// ════════════════════════════════════════════════════════════
//  RELATIONSHIP FINDER
// ════════════════════════════════════════════════════════════
const STEP_COST = { U: 1, D: 1, S: 1, M: 2.5, O: 4 };
/** Cheapest path through the tree, preferring blood links over marriage/custom links */
function findPath(fromId, toId) {
  if (fromId === toId) return [];
  const dist = new Map([[fromId, 0]]), prev = new Map();
  const heap = [[0, fromId]];
  const push = item => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  while (heap.length) {
    const [d, id] = pop();
    if (id === toId) break;
    if (d > (dist.get(id) ?? Infinity)) continue;
    for (const cid of adjacency.get(id) || []) {
      const c = state.connections[cid]; if (!c) continue;
      const next = c.from === id ? c.to : c.from;
      const step = c.type === 'parent' ? (c.from === id ? 'D' : 'U') : c.type === 'spouse' ? 'M' : c.type === 'sibling' ? 'S' : 'O';
      const nd = d + STEP_COST[step];
      if (nd < (dist.get(next) ?? Infinity)) { dist.set(next, nd); prev.set(next, { from: id, to: next, step, cid }); push([nd, next]); }
    }
  }
  if (!prev.has(toId)) return null;
  const path = [];
  for (let cur = toId; cur !== fromId;) { const s = prev.get(cur); path.unshift(s); cur = s.from; }
  return path;
}

const pick = (g, m, f, n) => (g === 'male' ? m : g === 'female' ? f : n);
function greats(n) { return n <= 0 ? '' : n === 1 ? 'great-' : n === 2 ? 'great-great-' : `${ordinal(n)} great-`; }
/** What B is to A, given generations up (a) to the common ancestor and down (b) to B */
function bloodTerm(a, b, g) {
  if (a === 0 && b === 0) return 'same person';
  if (a === 0) return b === 1 ? pick(g, 'son', 'daughter', 'child') : greats(b - 2) + pick(g, 'grandson', 'granddaughter', 'grandchild');
  if (b === 0) return a === 1 ? pick(g, 'father', 'mother', 'parent') : greats(a - 2) + pick(g, 'grandfather', 'grandmother', 'grandparent');
  if (a === 1 && b === 1) return pick(g, 'brother', 'sister', 'sibling');
  if (a === 1) return greats(b - 2) + pick(g, 'nephew', 'niece', 'nibling');
  if (b === 1) return greats(a - 2) + pick(g, 'uncle', 'aunt', 'aunt/uncle');
  const deg = Math.min(a, b) - 1, rem = Math.abs(a - b);
  const times = rem === 1 ? 'once' : rem === 2 ? 'twice' : `${rem} times`;
  return `${ordinal(deg)} cousin${rem ? ` ${times} removed` : ''}`;
}
const STEP_WORD = { U: ['father', 'mother', 'parent'], D: ['son', 'daughter', 'child'], S: ['brother', 'sister', 'sibling'], M: ['husband', 'wife', 'spouse'], O: ['relative', 'relative', 'relative'] };

function describeRelationship(path, A, B) {
  const nameA = displayName(A), nameB = displayName(B), g = B.gender;
  const chain = [];
  for (let i = 0; i < path.length; i++) {
    const s = path[i], n = state.nodes[s.to];
    // "father's son" reads better as "brother" (unless it loops back to the start person)
    if (s.step === 'U' && path[i + 1]?.step === 'D' && path[i + 1].to !== (i ? path[i - 1].to : A.id)) {
      chain.push(pick(state.nodes[path[i + 1].to]?.gender, ...STEP_WORD.S)); i++; continue;
    }
    chain.push(pick(n?.gender, ...STEP_WORD[s.step]));
  }
  const inWords = `${nameB} is ${nameA}’s ${chain.join('’s ')}.`;
  // simplify: child's sibling ≈ child, sibling's parent ≈ parent, sibling's sibling ≈ sibling
  let t = path.map(s => s.step), changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < t.length - 1; i++) {
      const p = t[i] + t[i + 1];
      if (p === 'DS' || p === 'SU' || p === 'SS') { t.splice(i, 2, p === 'DS' ? 'D' : p === 'SU' ? 'U' : 'S'); changed = true; break; }
    }
  }
  const exp = t.flatMap(s => (s === 'S' ? ['U', 'D'] : [s]));
  const blood = seq => {
    let i = 0, a = 0, b = 0;
    while (seq[i] === 'U') { a++; i++; }
    while (seq[i] === 'D') { b++; i++; }
    return i === seq.length ? { a, b } : null;
  };
  let label = null;
  const bl = blood(exp);
  if (bl) label = bloodTerm(bl.a, bl.b, g);
  else if (exp.length === 1 && exp[0] === 'M') label = pick(g, 'husband', 'wife', 'spouse / partner');
  else if (exp.length === 1 && exp[0] === 'O') label = 'related (custom link)';
  else if (exp[0] === 'M' && blood(exp.slice(1))) {
    const r = blood(exp.slice(1));
    if (r.a === 1 && r.b === 0) label = pick(g, 'father-in-law', 'mother-in-law', 'parent-in-law');
    else if (r.a === 1 && r.b === 1) label = pick(g, 'brother-in-law', 'sister-in-law', 'sibling-in-law');
    else if (r.a === 0 && r.b === 1) label = pick(g, 'stepson', 'stepdaughter', 'stepchild');
    else label = `${bloodTerm(r.a, r.b, g)} by marriage`;
  } else if (exp[exp.length - 1] === 'M' && blood(exp.slice(0, -1))) {
    const r = blood(exp.slice(0, -1));
    if (r.a === 1 && r.b === 0) label = pick(g, 'stepfather', 'stepmother', 'step-parent');
    else if (r.a === 1 && r.b === 1) label = pick(g, 'brother-in-law', 'sister-in-law', 'sibling-in-law');
    else if (r.a === 0 && r.b === 1) label = pick(g, 'son-in-law', 'daughter-in-law', 'child-in-law');
    else if (r.b === 1 && r.a >= 2) label = `${bloodTerm(r.a, r.b, g)} by marriage`;
  } else if (exp.length === 2 && exp[0] === 'D' && exp[1] === 'U') {
    label = 'co-parent';
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  if (label) return { label: cap(label), desc: `${nameB} is ${nameA}’s ${label}.`, inWords };
  return { label: path.some(s => s.step === 'M') ? 'Related by marriage' : 'Distant relative', desc: `${nameA} and ${nameB} are connected in ${path.length} steps.`, inWords };
}

const rel = { a: null, b: null, lastPath: null };
function buildRelPicker(which) {
  const inp = $(`rel-${which}-input`), dd = $(`rel-${which}-dropdown`), badge = $(`rel-${which}-badge`);
  let results = [], active = -1;
  const render = () => {
    results = searchPeople(inp.value, 10);
    active = -1;
    if (!results.length) { dd.classList.remove('open'); dd.innerHTML = ''; return; }
    dd.innerHTML = results.map((n, i) => {
      const sub = [lifeSpan(n), n.place].filter(Boolean).join(' · ');
      return `<div class="rel-dd-item" data-i="${i}">${highlight(displayName(n), inp.value)}${sub ? `<div class="rel-dd-sub">${escHtml(sub)}</div>` : ''}</div>`;
    }).join('');
    dd.classList.add('open');
  };
  const choose = n => { if (!n) return; setRel(which, n.id); dd.classList.remove('open'); };
  inp.addEventListener('input', () => { rel[which] = null; badge.textContent = ''; render(); });
  inp.addEventListener('focus', () => { if (inp.value && !rel[which]) render(); });
  inp.addEventListener('blur', () => setTimeout(() => dd.classList.remove('open'), 150));
  inp.addEventListener('keydown', e => {
    const items = dd.querySelectorAll('.rel-dd-item');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = clamp(active + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('active', i === active));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (dd.classList.contains('open')) choose(results[Math.max(0, active)]);
      else if (rel.a && rel.b) runRelFinder();
    }
  });
  dd.addEventListener('pointerdown', e => {
    const el = e.target.closest('.rel-dd-item'); if (!el) return;
    e.preventDefault(); choose(results[+el.dataset.i]);
  });
}
function setRel(which, id) {
  rel[which] = id && state.nodes[id] ? id : null;
  const n = state.nodes[rel[which]];
  $(`rel-${which}-input`).value = n ? displayName(n) : '';
  $(`rel-${which}-badge`).innerHTML = n ? icon('check') + `<span>${escHtml([displayName(n), lifeSpan(n)].filter(Boolean).join(', '))}</span>` : '';
  $('rel-result').innerHTML = '';
}
buildRelPicker('a'); buildRelPicker('b');

function openRelFinder(a, b) {
  if (a === undefined && sel.nodes.size === 2) [a, b] = [...sel.nodes];
  else if (a === undefined && sel.nodes.size === 1) a = sel.primary;
  if (!rel.a || !state.nodes[rel.a] || a) setRel('a', a || null);
  if (!rel.b || !state.nodes[rel.b] || b) setRel('b', b || null);
  $('rel-result').innerHTML = '';
  openPanel('rel-panel');
  if (rel.a && rel.b) runRelFinder();
  else (rel.a ? $('rel-b-input') : $('rel-a-input')).focus();
}
$('rel-swap').addEventListener('click', () => { const t = rel.a; setRel('a', rel.b); setRel('b', t); if (rel.a && rel.b) runRelFinder(); });
$('rel-find').addEventListener('click', runRelFinder);

function runRelFinder() {
  const A = state.nodes[rel.a], B = state.nodes[rel.b];
  if (!A || !B) { toast('Choose both people first'); return; }
  if (A.id === B.id) { toast('Choose two different people'); return; }
  const out = $('rel-result');
  const path = findPath(A.id, B.id);
  rel.lastPath = path;
  if (!path) {
    out.innerHTML = `<div class="rel-result-card not-found"><div class="rel-result-label">Result</div>
      <div class="rel-result-main none">No connection found</div>
      <div class="rel-result-desc">${escHtml(displayName(A))} and ${escHtml(displayName(B))} aren’t linked in this tree yet. Draw connections between their families to relate them.</div></div>`;
    return;
  }
  const r = describeRelationship(path, A, B);
  const ids = [A.id, ...path.map(s => s.to)];
  const chain = kinChain(path, A), vocab = activeVocab();
  let kinHtml = '';
  if (chain) {
    const code = kinCodeOf(chain), plain = chain.toks.map(t => (t.q || '') + t.k).join('');
    const k = vocab ? kinLookup(chain, vocab) : null;
    if (k) kinHtml = `<div class="rel-kin"><div class="rel-result-label">In ${escHtml(vocab.name)}</div>
        <div class="rel-kin-term${k.sure ? '' : ' unsure'}">${escHtml(k.term)}</div>
        ${k.note ? `<div class="rel-kin-note">${escHtml(k.note)}</div>` : ''}
        ${k.sure ? '' : `<div class="rel-kin-hint">${icon('alert')}<span>${escHtml(k.hint)}</span></div>`}
        <div class="rel-kin-code">Kin code <code>${escHtml(code)}</code> · ${escHtml(kinGloss(code))}</div></div>`;
    else if (vocab) kinHtml = `<div class="rel-kin missing"><div class="rel-kin-code">No term in <b>${escHtml(vocab.name)}</b> for <code>${escHtml(code)}</code> (${escHtml(kinGloss(code))}).</div>
        <button class="mini-btn" data-kin-add="${escHtml(plain)}">${icon('plus')}Add a term for ${escHtml(plain)}</button></div>`;
    else kinHtml = `<div class="rel-kin missing"><div class="rel-kin-code">Kin code <code>${escHtml(code)}</code> · ${escHtml(kinGloss(code))}</div>
        <button class="mini-btn" data-kin-open>${icon('book')}Use your community’s kinship terms</button></div>`;
  }
  const stepLabel = s => ({ U: 'child of', D: 'parent of', S: 'sibling', M: 'spouse', O: 'related' }[s.step]);
  const pathHtml = ids.map((id, i) => {
    const cls = id === A.id ? ' highlight-a' : id === B.id ? ' highlight-b' : '';
    const arrow = i < path.length ? `<span class="rel-path-arrow">→ <span class="rel-path-conn-type">${stepLabel(path[i])}</span> →</span>` : '';
    return `<button class="rel-path-node${cls}" data-nid="${escHtml(id)}">${escHtml(displayName(state.nodes[id]))}</button>${arrow}`;
  }).join('');
  out.innerHTML = `<div class="rel-result-card">
      <div class="rel-result-label">${escHtml(displayName(B))} is ${escHtml(displayName(A))}’s</div>
      <div class="rel-result-main">${escHtml(r.label)}</div>
      ${kinHtml}
      <div class="rel-result-desc">${escHtml(r.desc)}${path.length > 1 ? `<br>In words: <em>${escHtml(r.inWords)}</em>` : ''}</div>
      <div class="rel-path-title">Path (${path.length} step${path.length > 1 ? 's' : ''})</div>
      <div class="rel-path">${pathHtml}</div>
      <button class="modal-btn confirm" id="rel-show">Show path on map</button>
    </div>`;
}
$('rel-result').addEventListener('click', e => {
  const addBtn = e.target.closest('[data-kin-add]');
  if (addBtn) { closePanel('rel-panel'); openKinPanel(addBtn.dataset.kinAdd); return; }
  if (e.target.closest('[data-kin-open]')) { closePanel('rel-panel'); openKinPanel(); return; }
  const nodeBtn = e.target.closest('.rel-path-node');
  if (nodeBtn) { closePanel('rel-panel'); focusNode(nodeBtn.dataset.nid); return; }
  if (e.target.closest('#rel-show') && rel.lastPath) {
    const ids = [rel.a, ...rel.lastPath.map(s => s.to)];
    setPathHighlight(ids, rel.lastPath.map(s => s.cid));
    closePanel('rel-panel');
    clearSelection();
    fitToIds(ids, { maxScale: 1.2 });
    setStatus('Relationship path highlighted — tap the canvas to clear');
  }
});

// ════════════════════════════════════════════════════════════
//  TIDY LAYOUT  (generation rows, children under parents, spouses side by side)
// ════════════════════════════════════════════════════════════
function computeLayout(ids) {
  const set = new Set(ids);
  const conns = Object.values(state.connections).filter(c => set.has(c.from) && set.has(c.to));
  const gen = new Map(ids.map(id => [id, 0]));
  // generations: child = parent + 1, spouses & siblings share a row (bounded for cyclic data)
  for (let iter = 0; iter < ids.length + 2; iter++) {
    let changed = false;
    for (const c of conns) {
      const a = gen.get(c.from), b = gen.get(c.to);
      if (c.type === 'parent') { if (b < a + 1) { gen.set(c.to, a + 1); changed = true; } }
      else if (c.type === 'spouse' || c.type === 'sibling') { const m = Math.max(a, b); if (a !== m || b !== m) { gen.set(c.from, m); gen.set(c.to, m); changed = true; } }
    }
    if (!changed) break;
  }
  const parentsOf = new Map(), spousesOf = new Map();
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const c of conns) {
    if (c.type === 'parent') add(parentsOf, c.to, c.from);
    if (c.type === 'spouse') { add(spousesOf, c.from, c.to); add(spousesOf, c.to, c.from); }
  }
  const rows = new Map();
  for (const id of ids) add(rows, gen.get(id), id);
  const gens = [...rows.keys()].sort((a, b) => a - b);
  const oldMinX = Math.min(...ids.map(id => state.nodes[id].x));
  const cx = new Map(), pos = {};
  let y = 0;
  for (const g of gens) {
    const row = rows.get(g);
    const key = new Map();
    const parentKey = id => {
      const ps = (parentsOf.get(id) || []).filter(p => cx.has(p));
      return ps.length ? ps.reduce((s, p) => s + cx.get(p), 0) / ps.length : null;
    };
    for (const id of row) {
      let k = parentKey(id);
      if (k === null) {
        const sp = (spousesOf.get(id) || []).find(s => row.includes(s) && parentKey(s) !== null);
        k = sp ? parentKey(sp) + 1 : state.nodes[id].x - oldMinX;
      }
      key.set(id, k);
    }
    // order: by key, then pull spouses next to each other
    const sorted = row.slice().sort((a, b) => key.get(a) - key.get(b));
    const ordered = [], placed = new Set();
    for (const id of sorted) {
      if (placed.has(id)) continue;
      ordered.push(id); placed.add(id);
      for (const s of spousesOf.get(id) || []) if (!placed.has(s) && gen.get(s) === g) { ordered.push(s); placed.add(s); }
    }
    let cursor = -Infinity, rowH = 0;
    ordered.forEach((id, i) => {
      const s = sizeOf(id);
      const want = parentKey(id);
      let x = want !== null ? want - s.w / 2 : (cursor === -Infinity ? key.get(id) : cursor);
      if (cursor !== -Infinity) x = Math.max(x, cursor);
      pos[id] = { x: Math.round(x), y };
      cx.set(id, x + s.w / 2);
      const next = ordered[i + 1];
      const isSpouse = next && (spousesOf.get(id) || []).includes(next);
      cursor = x + s.w + (isSpouse ? 36 : 64);
      rowH = Math.max(rowH, s.h);
    });
    y += rowH + 110;
  }
  return pos;
}

let layoutAnim = 0;
function applyPositions(pos, animate = true) {
  const ids = Object.keys(pos);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  cancelAnimationFrame(layoutAnim);
  if (!animate || reduce || ids.length > 600) {
    for (const id of ids) { const n = state.nodes[id]; Object.assign(n, pos[id]); positionNode(nodeEls.get(id), n); markNodeMoved(id); }
    return Promise.resolve();
  }
  const from = new Map(ids.map(id => [id, { x: state.nodes[id].x, y: state.nodes[id].y }]));
  const t0 = performance.now(), dur = 450;
  return new Promise(res => {
    const step = now => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      for (const id of ids) {
        const n = state.nodes[id], f = from.get(id), t = pos[id];
        n.x = Math.round(f.x + (t.x - f.x) * e); n.y = Math.round(f.y + (t.y - f.y) * e);
        positionNode(nodeEls.get(id), n); markNodeMoved(id);
      }
      if (p < 1) layoutAnim = requestAnimationFrame(step); else res();
    };
    layoutAnim = requestAnimationFrame(step);
  });
}

async function tidyLayout(subset) {
  const ids = (subset && subset.length > 1 ? subset : Object.keys(state.nodes)).filter(id => state.nodes[id]);
  if (ids.length < 2) { toast('Add a few people first'); return; }
  const before = boundsOf(ids);
  const pos = computeLayout(ids);
  // keep the arrangement anchored where the people already were
  const minX = Math.min(...Object.values(pos).map(p => p.x));
  for (const id of ids) { pos[id].x += before.minX - minX; pos[id].y += before.minY; }
  await applyPositions(pos);
  commit();
  fitToIds(ids);
  toast('Layout tidied', { action: { label: 'Undo', fn: undo } });
}

// ════════════════════════════════════════════════════════════
//  COMMANDS (every toolbar / drawer / menu button uses data-cmd)
// ════════════════════════════════════════════════════════════
const commands = {
  new: newMap,
  save: () => saveMap(false),
  'save-as': () => saveMap(true),
  load: openFile,
  add: () => startAddPerson(),
  connect: () => setConnectMode(!connectMode),
  fit: () => fitView(),
  sidebar: toggleSidebar,
  import: openImport,
  'select-all': () => { if (Object.keys(state.nodes).length) { selectAll(); toast(`${sel.nodes.size} people selected`); } else toast('Add a few people first'); },
  'rel-finder': () => openRelFinder(),
  delete: deleteSelection,
  undo, redo,
  layout: () => tidyLayout(sel.nodes.size > 1 ? [...sel.nodes] : null),
  'export-png': exportPNG,
  'export-ged': () => exportGedcom(false),
  'export-ged-zip': () => exportGedcom(true),
  kinship: () => openKinPanel(),
  versions: openVersions,
  'kin-view': () => { if (sel.primary) setKinEgo(sel.primary); else toast('Select a person on the tree first'); },
  'kin-view-off': () => setKinEgo(null),
  autofile: () => { prefs.autoFile = prefs.autoFile === false; savePrefs(); renderStorageStatus(); if (prefs.autoFile && fileLink.ok) writeLinked(); },
  unlink: unlinkFile,
  shortcuts: () => revealSection('help'),
  'zoom-in': () => zoomCenter(1.25),
  'zoom-out': () => zoomCenter(0.8),
  'zoom-reset': () => { const c = screenToCanvas(wrapRect.left + wrapRect.width / 2, wrapRect.top + wrapRect.height / 2); animateView(wrapRect.width / 2 - c.x, wrapRect.height / 2 - c.y, 1, 250); },
  'toggle-minimap': () => { prefs.minimap = !prefs.minimap; savePrefs(); applyPrefs(); },
  theme: toggleTheme,
  fullscreen: toggleFullscreen,
  check: () => openCheckPanel(),
  install: promptInstall
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cmd]');
  if (!b || b.disabled) return;
  commands[b.dataset.cmd]?.(e);
});
$('btn-save').addEventListener('contextmenu', e => { e.preventDefault(); saveMap(true); });
$('backup-chip').addEventListener('click', () => saveMap(false));

// ════════════════════════════════════════════════════════════
//  KEYBOARD
// ════════════════════════════════════════════════════════════
const nudgeCommit = debounce(commit, 500);
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  const overlay = openOverlay();

  if (k === 'Escape') {
    if ($('conn-picker').classList.contains('open')) { cancelConnect(); return; }
    if (ctxMenu.classList.contains('open')) { hideCtxMenu(); return; }
    if (overlay === 'modal') { closeModal(false); return; }
    if (overlay) { closePanel(overlay); return; }
    if ($('text-menu').classList.contains('open')) { hideTextMenu(); return; }
    if (isTypingTarget(document.activeElement)) { document.activeElement.blur(); return; }
    if (connectSource) { cancelConnect(); setStatus(connectMode ? 'Connect mode: tap the first person' : ''); return; }
    if (connectMode) { setConnectMode(false); return; }
    clearSelection(); clearPathHighlight();
    return;
  }
  if (overlay === 'modal') {
    if (k === 'Enter' && document.activeElement !== $('modal-cancel')) { e.preventDefault(); closeModal(true); }
    return;
  }
  // Global shortcuts that also work inside inputs
  if (mod && k.toLowerCase() === 's') { e.preventDefault(); saveMap(e.shiftKey); return; }
  if (mod && k.toLowerCase() === 'o') { e.preventDefault(); openFile(); return; }
  if (mod && k.toLowerCase() === 'f') { e.preventDefault(); $('search-input').focus(); $('search-input').select(); return; }
  if (overlay || isTypingTarget(document.activeElement)) return;

  if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
  if (mod) return;

  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (k.startsWith('Arrow') && sel.nodes.size) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    moveNodesBy([...sel.nodes], k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0);
    nudgeCommit();
    return;
  }
  const ae = document.activeElement;
  if ((k === 'Enter' || k === ' ') && ae && ae !== document.body && ae !== canvasWrap) return;
  if (k === 'Enter' && sel.nodes.size === 1) { e.preventDefault(); editNode(sel.primary); return; }
  const map = { n: 'add', c: 'connect', f: 'fit', l: 'layout', t: 'theme', v: 'check', r: 'rel-finder', k: 'kinship', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset', '?': 'shortcuts' };
  const cmd = map[k.toLowerCase()];
  if (cmd) { e.preventDefault(); commands[cmd](); }
});

// ════════════════════════════════════════════════════════════
//  PWA: install prompt + service worker
// ════════════════════════════════════════════════════════════
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  $('btn-install').hidden = false;
});
window.addEventListener('appinstalled', () => { deferredPrompt = null; $('btn-install').hidden = true; toast('GeneaMap installed'); });
async function promptInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => {});
  deferredPrompt = null;
  $('btn-install').hidden = true;
}

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/\/dev\//.test(location.pathname)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version is ready', { action: { label: 'Reload', fn: () => { autosave.flush(); location.reload(); } }, duration: 12000 });
          }
        });
      });
    }).catch(() => {});
  });
}

// ════════════════════════════════════════════════════════════
//  GUARD
//  · no browser context menu anywhere (the tree keeps its own menus)
//  · text fields get a small menu with only Copy and Paste
//  · developer-tools / view-source shortcuts, or opening the developer
//    tools, send the page back to index.html
//  Skipped under /dev/ so the sources can still be debugged there.
// ════════════════════════════════════════════════════════════
const textMenu = $('text-menu');
let textTarget = null;
const isTextField = el => !!el && !el.disabled
  && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|url|tel)$/i.test(el.type)));
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function openTextMenu(el, x, y) {
  textTarget = el;
  const hasSel = el.selectionStart !== el.selectionEnd;
  const copy = textMenu.querySelector('[data-text="copy"]'), paste = textMenu.querySelector('[data-text="paste"]');
  copy.classList.toggle('disabled', !hasSel); copy.setAttribute('aria-disabled', !hasSel);
  copy.title = hasSel ? '' : 'Select some text first';
  paste.classList.toggle('disabled', el.readOnly); paste.setAttribute('aria-disabled', el.readOnly);
  hideCtxMenu();
  textMenu.classList.add('open');
  placeFloating(textMenu, x, y);
}
function hideTextMenu() { textMenu.classList.remove('open'); textTarget = null; }

async function copyFrom(el) {
  const text = el.value.slice(el.selectionStart, el.selectionEnd);
  if (!text) return;
  try { await navigator.clipboard.writeText(text); toast('Copied', { kind: 'ok' }); return; } catch { /* fall back */ }
  el.focus();
  try { if (document.execCommand('copy')) toast('Copied', { kind: 'ok' }); } catch { /* ignore */ }
}
async function pasteInto(el) {
  el.focus();
  let text = null;
  try { text = await navigator.clipboard.readText(); } catch { /* permission refused or unsupported */ }
  if (text == null) { toast(`Press ${IS_MAC ? '⌘' : 'Ctrl'}+V to paste here`); return; }
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
  el.setRangeText(text, s, e, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

document.addEventListener('contextmenu', e => {
  e.preventDefault();                       // never the browser's own menu
  const el = e.target;
  if (isTextField(el)) {
    e.stopImmediatePropagation();
    let { clientX: x, clientY: y } = e;
    if (!x && !y) { const r = el.getBoundingClientRect(); x = r.left + 12; y = r.bottom - 4; }   // keyboard menu key
    openTextMenu(el, x, y);
    return;
  }
  hideTextMenu();                           // tree menus are opened by the canvas handler
}, true);
textMenu.addEventListener('pointerdown', e => e.preventDefault());   // keep focus and selection in the field
textMenu.addEventListener('click', e => {
  const b = e.target.closest('[data-text]');
  if (!b || b.classList.contains('disabled')) return;
  const el = textTarget;
  hideTextMenu();
  if (el) (b.dataset.text === 'copy' ? copyFrom : pasteInto)(el);
});
document.addEventListener('pointerdown', e => { if (!textMenu.contains(e.target)) hideTextMenu(); });
window.addEventListener('blur', hideTextMenu);
$('side-body').addEventListener('scroll', hideTextMenu, { passive: true });

// the built file is code.min.js; the editable source (dev/index.html) loads code.js
const GUARD = !/\/code\.js(?:[?#]|$)/.test(SCRIPT_SRC);
if (GUARD) {
  const HOME = new URL('index.html', location.href).href;   // drops any query string or hash
  let leaving = false;
  const bounce = () => {
    if (leaving) return;
    leaving = true;
    try { autosave.flush(); saveViewSoon.flush(); } catch { /* ignore */ }
    location.replace(HOME);
  };
  document.addEventListener('keydown', e => {
    const c = e.code, mod = e.ctrlKey || e.metaKey;
    const blocked = c === 'F12'
      || (mod && e.shiftKey && ['KeyI', 'KeyJ', 'KeyC', 'KeyK', 'KeyE', 'KeyM'].includes(c))   // inspector, console, picker, network, device mode
      || (e.metaKey && e.altKey && ['KeyI', 'KeyJ', 'KeyC', 'KeyU'].includes(c))                // macOS variants
      || (mod && !e.shiftKey && !e.altKey && c === 'KeyU');                                     // view source
    if (blocked) { e.preventDefault(); e.stopImmediatePropagation(); bounce(); }
  }, true);
  // A debugger statement only pauses while developer tools are open; the pause shows up as elapsed time.
  // It runs as a separate anonymous script so the pause does not open on the app's own source.
  const probe = Function('debugger');
  setInterval(() => {
    const t = performance.now();
    probe();
    if (performance.now() - t > 100) bounce();
  }, 1000);
}

// ════════════════════════════════════════════════════════════
//  DEVICE STORAGE  (IndexedDB: the tree, photos, earlier versions,
//  the linked file)  — localStorage is kept as a mirror without photos
// ════════════════════════════════════════════════════════════
let idbP = null;
function idb() {
  if (idbP) return idbP;
  idbP = new Promise((res, rej) => {
    if (!('indexedDB' in window)) { rej(new Error('IndexedDB unavailable')); return; }
    const r = indexedDB.open('geneamap', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      d.createObjectStore('photos');
      d.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); idbP = null; }; res(d); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Storage blocked'));
  });
  idbP.catch(() => {});
  return idbP;
}
/** Run fn(store) in one transaction; resolves with fn's request result once committed */
async function idbDo(storeName, mode, fn) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(storeName, mode);
    const out = fn(t.objectStore(storeName));
    t.oncomplete = () => res(out && typeof out === 'object' && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Storage error'));
  });
}
const kvGet = k => idbDo('kv', 'readonly', s => s.get(k));
const kvSet = (k, v) => idbDo('kv', 'readwrite', s => s.put(v, k));
const kvDel = k => idbDo('kv', 'readwrite', s => s.delete(k));

// ── Photos: kept out of the undo history; the tree refers to them by id ──
const photos = new Map();          // id → data URL (JPEG)
const savedPhotos = new Set();     // ids already written to IndexedDB
const PHOTO_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function photoId(data) {           // content-based id: the same picture always gets the same id
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < data.length; i++) { const c = data.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); }
  return 'p' + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + data.length.toString(36);
}
function addPhoto(data) {
  if (!PHOTO_RE.test(data)) return null;
  const id = photoId(data);
  photos.set(id, data);
  return id;
}
const usedPhotoIds = (nodes = state.nodes) => new Set(Object.values(nodes).map(n => n.photo).filter(Boolean));
/** Photos referenced by a set of nodes, for a self-contained file */
function photosFor(nodes) {
  const out = {};
  for (const id of usedPhotoIds(nodes)) if (photos.has(id)) out[id] = photos.get(id);
  return out;
}
async function photoFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That file is not a picture this browser can open.'));
      i.src = url;
    });
    const max = 480, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}
async function flushPhotos() {
  const need = [...usedPhotoIds()].filter(id => photos.has(id) && !savedPhotos.has(id));
  if (!need.length) return;
  await idbDo('photos', 'readwrite', s => { for (const id of need) s.put(photos.get(id), id); });
  need.forEach(id => savedPhotos.add(id));
}
async function loadStoredPhotos(ids) {
  const want = [...ids].filter(id => !photos.has(id));
  if (!want.length) return;
  try {
    const vals = await idbDo('photos', 'readonly', s => {
      const reqs = want.map(id => s.get(id));
      return { get result() { return reqs.map(r => r.result); } };
    });
    want.forEach((id, i) => { if (typeof vals[i] === 'string') { photos.set(id, vals[i]); savedPhotos.add(id); } });
  } catch { /* storage unavailable */ }
}

// ── Backup tracking and the linked file ─────────────────────
const backup = { at: 0, changes: 0, persisted: false, mode: 'idb', remindedAt: 0 };
const fileLink = { handle: null, name: '', ok: false };
const CAN_LINK = 'showSaveFilePicker' in window;
const BACKUP_KEY = 'geneamap:backup:v1';
function loadBackupMeta() {
  try { Object.assign(backup, JSON.parse(localStorage.getItem(BACKUP_KEY) || '{}')); } catch { /* ignore */ }
}
const saveBackupMeta = debounce(() => {
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: backup.at, changes: backup.changes })); } catch { /* ignore */ }
}, 600);
function markBackedUp() {
  backup.at = Date.now(); backup.changes = 0;
  saveBackupMeta.flush();
  renderStorageStatus();
}
function countChange() {
  backup.changes++;
  saveBackupMeta();
  if (prefs.autoFile !== false && fileLink.handle && fileLink.ok) writeLinkedSoon();
  maybeRemindBackup();
}
const backupDue = () => backup.changes >= 20 || (backup.at ? backup.changes > 0 && Date.now() - backup.at > 7 * 864e5 : backup.changes >= 5);
function maybeRemindBackup() {
  renderBackupChip();
  if (!backupDue() || (fileLink.handle && fileLink.ok && prefs.autoFile !== false)) return;
  if (Date.now() - backup.remindedAt < 6 * 3600e3) return;
  backup.remindedAt = Date.now();
  toast('Save a copy of this tree as a file, so it is safe even if this browser’s data is cleared', { kind: 'warn', duration: 9000, action: { label: 'Save a copy', fn: () => saveMap(false) } });
}
function renderBackupChip() {
  const chip = $('backup-chip'); if (!chip) return;
  const linkedOk = fileLink.handle && fileLink.ok && prefs.autoFile !== false;
  chip.hidden = linkedOk || !backupDue() || !Object.keys(state.nodes).length;
}
function treeFileData() {
  state.title = $('f-map-title').value.trim() || 'Family Tree';
  const kv = activeVocab();
  return { ...state, photos: photosFor(state.nodes), kinship: kv ? cleanVocab(kv) : undefined, savedAt: new Date().toISOString(), version: 3, app: 'GeneaMap ' + APP_VERSION };
}
const treeBlob = () => new Blob([JSON.stringify(treeFileData(), null, 1)], { type: 'application/json' });
async function setFileLink(handle, ok) {
  fileLink.handle = handle || null;
  fileLink.name = handle ? handle.name : '';
  fileLink.ok = !!(handle && ok);
  currentFileHandle = fileLink.handle;
  try { if (handle) await kvSet('fileHandle', handle); else await kvDel('fileHandle'); } catch { /* handles cannot be stored in this browser */ }
  renderStorageStatus();
}
let linkedBusy = false;
async function writeLinked() {
  if (!fileLink.handle || !fileLink.ok || linkedBusy) return;
  linkedBusy = true;
  try {
    const w = await fileLink.handle.createWritable();
    await w.write(treeBlob()); await w.close();
    markBackedUp();
  } catch {
    fileLink.ok = false;
    renderStorageStatus();
  } finally { linkedBusy = false; }
}
const writeLinkedSoon = debounce(writeLinked, 2500);
async function resumeLinked() {
  if (!fileLink.handle) return;
  try {
    const p = await fileLink.handle.requestPermission({ mode: 'readwrite' });
    if (p !== 'granted') { toast('The browser did not allow writing to that file'); return; }
    fileLink.ok = true;
    await writeLinked();
    toast(`Saving to ${fileLink.name} again`, { kind: 'ok' });
  } catch { toast('That file can no longer be reached. Use Save as to choose a new one.'); await setFileLink(null); }
}
async function unlinkFile() { await setFileLink(null); toast('The tree is no longer linked to a file'); }

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' minutes ago';
  if (s < 86400) return Math.round(s / 3600) + ' hours ago';
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : d + ' days ago';
}
function renderStorageStatus() {
  const box = $('storage-status'); if (!box) return;
  const time = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const lines = [];
  if (backup.mode === 'full') lines.push(`<div class="st-line bad">${icon('alert')}<span>This browser’s storage is full. Save a file copy now.</span></div>`);
  else lines.push(`<div class="st-line">${icon('check')}<span>Saved on this device${time ? ' · ' + time : ''}${backup.persisted ? ' · protected from automatic clearing' : ''}</span></div>`);
  if (fileLink.handle) {
    lines.push(fileLink.ok && prefs.autoFile !== false
      ? `<div class="st-line ok">${icon('save')}<span>Also saving to <b>${escHtml(fileLink.name)}</b></span></div>`
      : fileLink.ok
        ? `<div class="st-line">${icon('save')}<span>Linked to <b>${escHtml(fileLink.name)}</b>. Press Save to update it.</span></div>`
        : `<div class="st-line warn">${icon('save')}<span>Linked to <b>${escHtml(fileLink.name)}</b>, paused</span><button type="button" class="mini-btn" id="btn-resume-link">Resume</button></div>`);
  }
  if (!(fileLink.handle && fileLink.ok && prefs.autoFile !== false)) {
    const when = backup.at ? `Last file copy ${ago(backup.at)}` : 'No file copy saved yet';
    const ch = backup.changes ? ` · ${backup.changes} change${backup.changes > 1 ? 's' : ''} since` : '';
    lines.push(`<div class="st-line${backupDue() ? ' warn' : ''}">${icon(backupDue() ? 'alert' : 'clock')}<span>${when}${ch}</span></div>`);
  }
  box.innerHTML = lines.join('');
  $('btn-resume-link')?.addEventListener('click', resumeLinked);
  const sw = $('btn-autofile');
  if (sw) { sw.hidden = !CAN_LINK || !fileLink.handle; sw.setAttribute('aria-checked', prefs.autoFile !== false); }
  const ul = $('btn-unlink'); if (ul) ul.hidden = !fileLink.handle;
  renderBackupChip();
}
async function checkPersisted(ask) {
  try {
    if (!navigator.storage?.persisted) return;
    backup.persisted = await navigator.storage.persisted();
    if (!backup.persisted && ask && navigator.storage.persist) backup.persisted = await navigator.storage.persist();
  } catch { /* ignore */ }
  renderStorageStatus();
}

// ── Earlier versions (automatic copies kept on the device) ──
const VERSION_KEEP = 15;
async function saveVersion(reason) {
  if (!Object.keys(state.nodes).length) return;
  const s = snapshot();
  try {
    await flushPhotos();
    const last = await idbDo('versions', 'readonly', s2 => { const c = s2.openCursor(null, 'prev'); return { get result() { return c.result?.value || null; } }; });
    if (last && last.state === s) return;   // nothing changed since the last copy
    await idbDo('versions', 'readwrite', st => st.add({ at: Date.now(), reason, title: state.title, people: Object.keys(state.nodes).length, state: s }));
    const keys = await idbDo('versions', 'readonly', st => st.getAllKeys());
    if (keys.length > VERSION_KEEP) await idbDo('versions', 'readwrite', st => keys.slice(0, keys.length - VERSION_KEEP).forEach(k => st.delete(k)));
  } catch { /* storage unavailable */ }
}
async function dailyVersion() {
  try {
    const last = await idbDo('versions', 'readonly', s => { const c = s.openCursor(null, 'prev'); return { get result() { return c.result?.value || null; } }; });
    if (!last || Date.now() - last.at > 20 * 3600e3) await saveVersion('Daily copy');
  } catch { /* ignore */ }
}
/** Drop stored photos that neither the tree nor any earlier version uses */
async function prunePhotos() {
  try {
    const used = usedPhotoIds();
    const versions = await idbDo('versions', 'readonly', s => s.getAll());
    for (const v of versions) for (const m of String(v.state).matchAll(/"photo":"(p[0-9a-z]+)"/g)) used.add(m[1]);
    const keys = await idbDo('photos', 'readonly', s => s.getAllKeys());
    const drop = keys.filter(k => !used.has(k));
    if (drop.length) await idbDo('photos', 'readwrite', s => drop.forEach(k => { s.delete(k); savedPhotos.delete(k); }));
  } catch { /* ignore */ }
}
async function openVersions() {
  const list = $('versions-list');
  let items = [];
  try { items = (await idbDo('versions', 'readonly', s => s.getAll())).reverse(); } catch { /* ignore */ }
  list.innerHTML = items.length ? items.map(v => `<div class="ver-item">
      <div class="ver-main"><b>${escHtml(new Date(v.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</b>
      <span>${escHtml(v.title || 'Family Tree')} · ${v.people} ${v.people === 1 ? 'person' : 'people'}</span><span class="dim small">${escHtml(v.reason || '')}</span></div>
      <button type="button" class="mini-btn" data-ver="${v.id}">Restore</button></div>`).join('')
    : '<div class="check-empty">No earlier versions yet. A copy is kept once a day, and before a new map, opening a file, merging or restoring.</div>';
  openPanel('versions-panel');
}
$('versions-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-ver]'); if (!b) return;
  let v = null;
  try { v = await idbDo('versions', 'readonly', s => s.get(+b.dataset.ver)); } catch { /* ignore */ }
  if (!v) return;
  showModal('Restore this version?', `${v.people} people, from ${new Date(v.at).toLocaleString()}. The current tree is kept as an earlier version first, and you can undo this.`, async () => {
    await saveVersion('Before restoring an earlier version');
    const data = normalizeMap(JSON.parse(v.state));
    await loadStoredPhotos(usedPhotoIds(data.nodes));
    closePanel('versions-panel');
    loadMap(data, { keepLink: true });
  }, { confirmText: 'Restore' });
});

// ════════════════════════════════════════════════════════════
//  ZIP  (GEDCOM with photos)  — store on write; store or deflate on read
// ════════════════════════════════════════════════════════════
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC_T[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipBlob(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const le = (n, b) => { const a = new Uint8Array(b); for (let i = 0; i < b; i++) a[i] = (n >>> (8 * i)) & 255; return a; };
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const head = [le(0x04034b50, 4), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(name.length, 2), le(0, 2), name];
    const size = head.reduce((s, a) => s + a.length, 0);
    central.push([le(0x02014b50, 4), le(20, 2), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(name.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(off, 4), name]);
    parts.push(...head, data);
    off += size + data.length;
  }
  const cdStart = off; let cdSize = 0;
  for (const c of central) for (const a of c) { parts.push(a); cdSize += a.length; }
  parts.push(le(0x06054b50, 4), le(0, 2), le(0, 2), le(files.length, 2), le(files.length, 2), le(cdSize, 4), le(cdStart, 4), le(0, 2));
  return new Blob(parts, { type: 'application/zip' });
}
async function unzip(buf) {
  const u = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder();
  let e = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('That zip file is damaged.');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = [];
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = u.subarray(ds, ds + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8 && 'DecompressionStream' in window) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else continue;
    out.push({ name, data });
  }
  return out;
}
const isZip = async file => { const h = new Uint8Array(await file.slice(0, 4).arrayBuffer()); return h[0] === 0x50 && h[1] === 0x4b && h[2] === 3 && h[3] === 4; };
/** Read a .json, .ged or .zip (GEDCOM with photos) into a normalised map */
async function readMapFile(file) {
  if (/\.zip$/i.test(file.name) || await isZip(file)) {
    const entries = await unzip(await file.arrayBuffer());
    const ged = entries.find(x => /\.ged$/i.test(x.name)), json = entries.find(x => /\.json$/i.test(x.name));
    const main = ged || json;
    if (!main) throw new Error('No .ged or .json family tree inside that zip file.');
    const text = new TextDecoder().decode(main.data);
    const media = new Map();
    for (const x of entries) {
      const m = /\.(jpe?g|png|webp)$/i.exec(x.name); if (!m) continue;
      let bin = ''; for (let i = 0; i < x.data.length; i += 0x8000) bin += String.fromCharCode.apply(null, x.data.subarray(i, i + 0x8000));
      media.set(x.name.replace(/^\.?\//, '').toLowerCase(), `data:image/${m[1].toLowerCase() === 'png' ? 'png' : m[1].toLowerCase() === 'webp' ? 'webp' : 'jpeg'};base64,${btoa(bin)}`);
    }
    return parseMapText(text, main.name, media);
  }
  return parseMapText(await file.text(), file.name);
}

// ════════════════════════════════════════════════════════════
//  KINSHIP TERMS  (community-defined vocabularies)
//
//  A term is written against a kin code: the relationship spelt out
//  step by step from the person asking (Person A) to the relative.
//    F father · M mother · P parent       S son · D daughter · C child
//    B brother · Z sister · G sibling     H husband · W wife · E spouse
//  e / y after B, Z or G: elder / younger than the person before it
//    (FeB = father's elder brother; eZ = my elder sister).
//  + / − at the end: the relative is older / younger than Person A
//    (FBS+ = father's brother's son, older than me).
//  ms: / ws: at the start: said by a man / by a woman.
//  P, C, G and E match either gender. The most specific matching
//  term wins; when ages are unknown and the list tells elder from
//  younger, both possible terms are shown.
// ════════════════════════════════════════════════════════════
const KIN_KEY = 'geneamap:kinship:v1';
const KIN_WORD = { F: 'father', M: 'mother', P: 'parent', S: 'son', D: 'daughter', C: 'child', B: 'brother', Z: 'sister', G: 'sibling', H: 'husband', W: 'wife', E: 'spouse' };
const KIN_GENERIC = { P: 'FMP', C: 'SDC', G: 'BZG', E: 'HWE' };
const KIN_RE = /^(?:(ms|ws):)?((?:[ey]?[FMPSDCBZGHWE])+)([+-])?$/;
const kinParseCache = new Map();
function parseKinCode(code) {
  const c = String(code || '').replace(/\s+/g, '').replace(/[−–]/g, '-');
  if (kinParseCache.has(c)) return kinParseCache.get(c);
  const m = KIN_RE.exec(c);
  let out = null;
  if (m) {
    const toks = [];
    let ok = true;
    for (const t of m[2].matchAll(/([ey])?([FMPSDCBZGHWE])/g)) {
      if (t[1] && !'BZG'.includes(t[2])) { ok = false; break; }
      toks.push({ k: t[2], q: t[1] || null });
    }
    if (ok) out = { sex: m[1] || null, toks, ego: m[3] || null };
  }
  kinParseCache.set(c, out);
  return out;
}
function kinGloss(code) {
  const p = typeof code === 'string' ? parseKinCode(code) : code;
  if (!p) return '';
  let s = p.toks.map(t => (t.q === 'e' ? 'elder ' : t.q === 'y' ? 'younger ' : '') + KIN_WORD[t.k]).join('’s ');
  if (p.ego) s += p.ego === '+' ? ', older than me' : ', younger than me';
  if (p.sex) s = (p.sex === 'ms' ? '(a man speaking) ' : '(a woman speaking) ') + s;
  return s;
}
const kinCodeOf = ch => ch.toks.map(t => (t.q || '') + t.k).join('') + (ch.ego || '');

/** -1: a is older than b · 1: a is younger · 0: unknown */
function ageOrder(a, b) {
  if (!a || !b) return 0;
  const ya = yearOf(a.birth), yb = yearOf(b.birth);
  if (ya != null && yb != null && ya !== yb) return ya < yb ? -1 : 1;
  const oa = parseInt(a.birthOrder, 10), ob = parseInt(b.birthOrder, 10);
  if (oa > 0 && ob > 0 && oa !== ob) {
    const pa = effectiveParents(a.id), sib = sibLinksOf(a.id).includes(b.id);
    if (sib || [...effectiveParents(b.id)].some(p => pa.has(p))) return oa < ob ? -1 : 1;
  }
  return 0;
}
/** The kin-type chain of a path from A: tokens like F, eB, S plus age to A and A's sex */
function kinChain(path, A) {
  if (!path || !path.length || path.some(s => s.step === 'O')) return null;
  const steps = path.map(s => ({ step: s.step, from: s.from, to: s.to }));
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < steps.length - 1; i++) {
      const a = steps[i], b = steps[i + 1], p = a.step + b.step;
      let rep = null;
      if (p === 'UD' && b.to !== a.from) rep = { step: 'S', from: a.from, to: b.to };       // parent's child → sibling
      else if (p === 'SS' && b.to !== a.from) rep = { step: 'S', from: a.from, to: b.to };  // sibling's sibling → sibling
      else if (p === 'SU') rep = { step: 'U', from: a.from, to: b.to };                     // sibling's parent → parent
      else if (p === 'DS') rep = { step: 'D', from: a.from, to: b.to };                     // child's sibling → child
      if (rep) { steps.splice(i, 2, rep); changed = true; break; }
    }
  }
  const L = { U: ['F', 'M', 'P'], D: ['S', 'D', 'C'], S: ['B', 'Z', 'G'], M: ['H', 'W', 'E'] };
  const toks = steps.map(s => {
    const n = state.nodes[s.to];
    const t = { k: pick(n?.gender, ...L[s.step]), q: null };
    if (s.step === 'S') { const o = ageOrder(n, state.nodes[s.from]); t.q = o < 0 ? 'e' : o > 0 ? 'y' : null; }
    return t;
  });
  const B = state.nodes[steps[steps.length - 1].to];
  const o = ageOrder(B, A);
  return { toks, ego: o < 0 ? '+' : o > 0 ? '-' : null, sex: A.gender === 'male' ? 'ms' : A.gender === 'female' ? 'ws' : null };
}
/** Best term for a chain in a vocabulary: { term, note, code, sure, hint } or null */
function kinLookup(chain, vocab) {
  if (!chain || !vocab) return null;
  let best = null;
  const unsure = [];
  for (const r of vocab.rules) {
    const p = parseKinCode(r.code);
    if (!p || !r.term || !r.term.trim() || p.toks.length !== chain.toks.length) continue;
    let score = 0, sure = true, ok = true, why = '';
    for (let i = 0; i < p.toks.length; i++) {
      const a = p.toks[i], b = chain.toks[i];
      if (a.k === b.k) score += 3; else if (KIN_GENERIC[a.k]?.includes(b.k)) score += 1; else { ok = false; break; }
      if (a.q) { if (b.q === a.q) score += 2; else if (b.q == null) { sure = false; why = 'age'; } else { ok = false; break; } }
    }
    if (!ok) continue;
    if (p.ego) { if (chain.ego === p.ego) score += 2; else if (chain.ego == null) { sure = false; why = 'age'; } else continue; }
    if (p.sex) { if (chain.sex === p.sex) score += 1; else if (chain.sex == null) { sure = false; why = why || 'sex'; } else continue; }
    const m = { r, score, why };
    if (sure) { if (!best || score > best.score) best = m; } else unsure.push(m);
  }
  const top = unsure.length ? Math.max(...unsure.map(u => u.score)) : -1;
  const alts = unsure.filter(u => u.score === top && (!best || u.score > best.score));
  if (!alts.length) return best ? { term: best.r.term.trim(), note: best.r.note || '', code: best.r.code, sure: true } : null;
  const terms = [...new Set(alts.map(a => a.r.term.trim()))];
  if (terms.length === 1) {
    if (best && best.r.term.trim() !== terms[0]) terms.unshift(best.r.term.trim());
    else return { term: terms[0], note: alts[0].r.note || '', code: alts[0].r.code, sure: true };
  }
  return {
    term: terms.join(' / '), note: '', code: alts.map(a => a.r.code).join(', '), sure: false,
    hint: alts.some(a => a.why === 'sex') ? 'Set Person A’s gender to choose between them.' : 'Add birth years, or a birth order among brothers and sisters, to choose between them.'
  };
}

// ── Vocabulary library (kept on this device; the one in use also travels inside saved tree files) ──
let kin = { active: '', lists: [], seeded: false };
function cleanVocab(v) {
  const s = (x, n) => String(x == null ? '' : x).slice(0, n);
  return {
    id: s(v.id, 60) || 'k' + Date.now().toString(36), name: s(v.name, 120).trim() || 'Kinship terms', language: s(v.language, 80), about: s(v.about, 2000),
    starter: !!v.starter,
    rules: (Array.isArray(v.rules) ? v.rules : []).slice(0, 3000).filter(r => r && typeof r === 'object')
      .map(r => ({ code: s(r.code, 40).replace(/\s+/g, ''), term: s(r.term, 120), note: s(r.note, 300) }))
  };
}
function loadKin() {
  try {
    const d = JSON.parse(localStorage.getItem(KIN_KEY) || 'null');
    if (d && Array.isArray(d.lists)) kin = { active: String(d.active || ''), lists: d.lists.map(cleanVocab), seeded: !!d.seeded };
  } catch { /* ignore */ }
  if (!kin.seeded) {
    for (const st of KIN_STARTERS) if (!kin.lists.some(l => l.id === st.id)) kin.lists.push(cleanVocab(st));
    kin.seeded = true;
    saveKin();
  }
  if (!kin.lists.some(l => l.id === kin.active)) kin.active = '';
}
const saveKin = () => { try { localStorage.setItem(KIN_KEY, JSON.stringify(kin)); } catch { /* ignore */ } };
const activeVocab = () => kin.lists.find(l => l.id === kin.active) || null;
/** A vocabulary that came inside a tree file or a kinship file: add it (or match an identical one) and use it */
function adoptVocab(raw, from) {
  const v = cleanVocab(raw);
  const same = kin.lists.find(l => l.id === v.id);
  if (same && JSON.stringify(cleanVocab(same).rules) === JSON.stringify(v.rules)) { kin.active = same.id; saveKin(); return same; }
  if (same) { v.id = 'k' + Date.now().toString(36); v.name += from ? ` (from ${from})` : ' (copy)'; }
  kin.lists.push(v); kin.active = v.id; saveKin();
  return v;
}

const KIN_STARTER_NOTE = 'A starter list to show how kinship terms work. Check every term with elders of your community and correct it: words and usage differ between regions, communities and families.';
const KIN_STARTERS = [
  {
    id: 'starter-bn', name: 'Bengali (starter)', language: 'Bengali', starter: true, about: KIN_STARTER_NOTE,
    rules: [
      ['F', 'বাবা', 'baba'], ['M', 'মা', 'ma'], ['FF', 'ঠাকুরদা', 'thakurda; also দাদু'], ['FM', 'ঠাকুমা', 'thakuma'], ['MF', 'দাদু', 'dadu; also দাদামশাই'], ['MM', 'দিদিমা', 'didima'],
      ['FB', 'কাকা / জেঠা', 'kaka / jetha'], ['FeB', 'জেঠা', 'jetha; also জেঠু'], ['FyB', 'কাকা', 'kaka'], ['FeBW', 'জেঠিমা', 'jethima'], ['FyBW', 'কাকিমা', 'kakima'],
      ['FZ', 'পিসি', 'pishi'], ['FZH', 'পিসেমশাই', 'pishemoshai'], ['MB', 'মামা', 'mama'], ['MBW', 'মামি', 'mami'], ['MZ', 'মাসি', 'mashi'], ['MZH', 'মেসোমশাই', 'meshomoshai'],
      ['eB', 'দাদা', 'dada'], ['yB', 'ভাই', 'bhai'], ['eZ', 'দিদি', 'didi'], ['yZ', 'বোন', 'bon'],
      ['S', 'ছেলে', 'chhele'], ['D', 'মেয়ে', 'meye'], ['SW', 'বউমা', 'bouma'], ['DH', 'জামাই', 'jamai'],
      ['SS', 'নাতি', 'nati'], ['DS', 'নাতি', 'nati'], ['SD', 'নাতনি', 'natni'], ['DD', 'নাতনি', 'natni'],
      ['BS', 'ভাইপো', 'bhaipo'], ['BD', 'ভাইঝি', 'bhaijhi'], ['ZS', 'ভাগ্নে', 'bhagne'], ['ZD', 'ভাগ্নি', 'bhagni'],
      ['H', 'স্বামী', 'swami'], ['W', 'স্ত্রী', 'stri'], ['EF', 'শ্বশুর', 'shoshur'], ['EM', 'শাশুড়ি', 'shashuri'],
      ['eBW', 'বউদি', 'boudi'], ['eZH', 'জামাইবাবু', 'jamaibabu'], ['yZH', 'ভগ্নিপতি', 'bhognipoti'],
      ['HeB', 'ভাসুর', 'bhashur'], ['HyB', 'দেওর', 'deor'], ['HZ', 'ননদ', 'nonod'], ['WB', 'শালা', 'shala'], ['WZ', 'শ্যালিকা', 'shyalika; also শালী'],
      ['FBS+', 'দাদা (খুড়তুতো / জেঠতুতো)', 'cousin, older'], ['FBS-', 'ভাই (খুড়তুতো / জেঠতুতো)', 'cousin, younger'],
      ['FyBS+', 'খুড়তুতো দাদা', 'khurtuto dada'], ['FyBS-', 'খুড়তুতো ভাই', 'khurtuto bhai'], ['FeBS+', 'জেঠতুতো দাদা', 'jethtuto dada'], ['FeBS-', 'জেঠতুতো ভাই', 'jethtuto bhai'],
      ['FBD+', 'দিদি (খুড়তুতো / জেঠতুতো)', ''], ['FBD-', 'বোন (খুড়তুতো / জেঠতুতো)', ''],
      ['FZS+', 'পিসতুতো দাদা', 'pishtuto dada'], ['FZS-', 'পিসতুতো ভাই', 'pishtuto bhai'], ['FZD+', 'পিসতুতো দিদি', ''], ['FZD-', 'পিসতুতো বোন', ''],
      ['MBS+', 'মামাতো দাদা', 'mamato dada'], ['MBS-', 'মামাতো ভাই', 'mamato bhai'], ['MBD+', 'মামাতো দিদি', ''], ['MBD-', 'মামাতো বোন', ''],
      ['MZS+', 'মাসতুতো দাদা', 'mashtuto dada'], ['MZS-', 'মাসতুতো ভাই', 'mashtuto bhai'], ['MZD+', 'মাসতুতো দিদি', ''], ['MZD-', 'মাসতুতো বোন', '']
    ].map(([code, term, note]) => ({ code, term, note }))
  },
  {
    id: 'starter-as', name: 'Assamese (starter)', language: 'Assamese', starter: true, about: KIN_STARTER_NOTE,
    rules: [
      ['F', 'দেউতা', 'deuta'], ['M', 'মা', 'ma; also আই'], ['PF', 'ককা', 'koka'], ['PM', 'আইতা', 'aita'],
      ['FB', 'বৰদেউতা / খুড়া', ''], ['FeB', 'বৰদেউতা', 'bordeuta'], ['FyB', 'খুড়া', 'khura; also খুড়াদেউ'], ['FeBW', 'বৰমা', 'borma'], ['FyBW', 'খুড়ী', 'khuri'],
      ['FZ', 'পেহী', 'pehi'], ['FZH', 'পেহা', 'peha'], ['MB', 'মামা', 'mama'], ['MBW', 'মামী', 'mami'], ['MZ', 'মাহী', 'mahi'], ['MZH', 'মহা', 'moha'],
      ['eB', 'ককাই', 'kokai; also দাদা'], ['yB', 'ভাই', 'bhai'], ['eZ', 'বাইদেউ', 'baideu; also বা'], ['yZ', 'ভনী', 'bhoni'],
      ['S', 'পুতেক', 'putek; also ল’ৰা'], ['D', 'জীয়েক', 'jiyek; also ছোৱালী'], ['SW', 'বোৱাৰী', 'bowari'], ['DH', 'জোঁৱাই', 'jowai'],
      ['CS', 'নাতি', 'nati'], ['CD', 'নাতিনী', 'natini'], ['BS', 'ভতিজা', 'bhotija'], ['BD', 'ভতিজী', 'bhotiji'], ['ZS', 'ভাগিন', 'bhagin'], ['ZD', 'ভাগিনী', 'bhagini'],
      ['H', 'স্বামী', 'swami; also গিৰিয়েক'], ['W', 'পত্নী', 'potni; also ঘৈণীয়েক'], ['EF', 'শহুৰ', 'xohur'], ['EM', 'শাহু', 'xahu'],
      ['eBW', 'নবৌ', 'nobou'], ['eZH', 'ভিনদেউ', 'bhindeu'], ['HeB', 'ভাছুৰ', 'bhasur'], ['HyB', 'দেওৰ', 'deor'], ['HZ', 'ননদ', 'nonod'], ['WB', 'শলা', 'xola'],
      ['PGS+', 'ককাই', 'cousin brother, older'], ['PGS-', 'ভাই', 'cousin brother, younger'], ['PGD+', 'বাইদেউ', 'cousin sister, older'], ['PGD-', 'ভনী', 'cousin sister, younger']
    ].map(([code, term, note]) => ({ code, term, note }))
  }
];

// ── Kinship view: every card labelled from one person's point of view ──
const kinView = { ego: null };
const kinLabels = new Map();   // nodeId → { text, local }
/** Single-source shortest paths (same costs as the Relationship finder) */
function pathsFrom(src) {
  const dist = new Map([[src, 0]]), prev = new Map(), heap = [[0, src]];
  while (heap.length) {
    let bi = 0; for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i;
    const [d, id] = heap.splice(bi, 1)[0];
    if (d > (dist.get(id) ?? Infinity)) continue;
    for (const cid of adjacency.get(id) || []) {
      const c = state.connections[cid]; if (!c) continue;
      const next = c.from === id ? c.to : c.from;
      const step = c.type === 'parent' ? (c.from === id ? 'D' : 'U') : c.type === 'spouse' ? 'M' : c.type === 'sibling' ? 'S' : 'O';
      const nd = d + STEP_COST[step];
      if (nd < (dist.get(next) ?? Infinity)) { dist.set(next, nd); prev.set(next, { from: id, to: next, step, cid }); heap.push([nd, next]); }
    }
  }
  return prev;
}
function refreshKinView() {
  const before = new Map(kinLabels);
  kinLabels.clear();
  const ego = kinView.ego && state.nodes[kinView.ego] ? kinView.ego : null;
  kinView.ego = ego;
  if (ego) {
    const A = state.nodes[ego], vocab = activeVocab(), prev = pathsFrom(ego);
    kinLabels.set(ego, { text: 'Self', local: false, ego: true });
    for (const id of Object.keys(state.nodes)) {
      if (id === ego || !prev.has(id)) continue;
      const path = [];
      for (let cur = id; cur !== ego;) { const s = prev.get(cur); path.unshift(s); cur = s.from; }
      const k = vocab ? kinLookup(kinChain(path, A), vocab) : null;
      if (k) kinLabels.set(id, { text: k.term, local: true, unsure: !k.sure });
      else kinLabels.set(id, { text: describeRelationship(path, A, state.nodes[id]).label, local: false });
    }
  }
  for (const id of new Set([...before.keys(), ...kinLabels.keys()])) {
    const a = before.get(id), b = kinLabels.get(id);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const n = state.nodes[id], el = nodeEls.get(id);
    if (n && el) el.innerHTML = nodeInner(n);
  }
  renderKinViewStatus();
}
const refreshKinViewSoon = debounce(refreshKinView, 120);
function setKinEgo(id) {
  kinView.ego = id && state.nodes[id] ? id : null;
  refreshKinView();
  if (kinView.ego) {
    const v = activeVocab();
    toast(`Kinship terms from ${displayName(state.nodes[kinView.ego])}’s point of view${v ? ' · ' + v.name : ' · English (choose your community’s terms under Tools › Kinship terms)'}`, { duration: 6000 });
  }
}
function renderKinViewStatus() {
  const st = $('kin-view-status'); if (!st) return;
  const ego = kinView.ego && state.nodes[kinView.ego];
  st.innerHTML = ego ? `From <b>${escHtml(displayName(ego))}</b>` : 'Off';
  $('btn-kin-view-off').hidden = !ego;
  $('btn-kin-view').textContent = ego ? 'Change to selected person' : 'Show from selected person';
}

// ── Kinship terms panel ─────────────────────────────────────
function openKinPanel(prefillCode) {
  renderKinPanel();
  openPanel('kin-panel');
  if (prefillCode) {
    let v = activeVocab();
    if (!v) { toast('Choose a list of terms, or start a new one, first'); return; }
    if (!v.rules.some(r => r.code === prefillCode)) { v.rules.push({ code: prefillCode, term: '', note: '' }); saveKin(); renderKinRows(); }
    const row = [...$('kin-rows').querySelectorAll('.kin-row')].find(r => r.querySelector('.kin-code').value === prefillCode);
    row?.scrollIntoView({ block: 'center' });
    row?.querySelector('.kin-term').focus();
  }
}
function renderKinPanel() {
  const sel = $('kin-select');
  sel.innerHTML = `<option value="">English only (built in)</option>` + kin.lists.map(l => `<option value="${escHtml(l.id)}">${escHtml(l.name)}</option>`).join('');
  sel.value = kin.active;
  const v = activeVocab();
  $('kin-editor').hidden = !v;
  $('kin-none').hidden = !!v;
  $('kin-copy').disabled = !v; $('kin-export').disabled = !v; $('kin-delete').disabled = !v;
  if (!v) return;
  $('kin-name').value = v.name; $('kin-lang').value = v.language; $('kin-about').value = v.about;
  $('kin-starter-note').hidden = !v.starter;
  renderKinRows();
}
function renderKinRows() {
  const v = activeVocab(); if (!v) return;
  $('kin-count').textContent = `${v.rules.length} term${v.rules.length === 1 ? '' : 's'}`;
  $('kin-rows').innerHTML = v.rules.map((r, i) => {
    const g = kinGloss(r.code);
    return `<div class="kin-row" data-i="${i}">
      <input class="kin-code" value="${escHtml(r.code)}" aria-label="Kin code" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="FeB">
      <input class="kin-term" value="${escHtml(r.term)}" aria-label="Term" placeholder="Term">
      <input class="kin-note" value="${escHtml(r.note)}" aria-label="Note" placeholder="Note or pronunciation">
      <button type="button" class="icon-btn kin-del" aria-label="Remove this term" title="Remove">${icon('x')}</button>
      <div class="kin-gloss${r.code && !g ? ' bad' : ''}">${r.code ? (g ? escHtml(g) : 'Not a valid code') : 'Type a code, e.g. FeB'}</div>
    </div>`;
  }).join('');
}
const kinSaveSoon = debounce(() => { saveKin(); if (kinView.ego) refreshKinView(); }, 350);
$('kin-rows').addEventListener('input', e => {
  const row = e.target.closest('.kin-row'); const v = activeVocab(); if (!row || !v) return;
  const r = v.rules[+row.dataset.i]; if (!r) return;
  if (e.target.classList.contains('kin-code')) {
    r.code = e.target.value.replace(/\s+/g, '');
    const g = kinGloss(r.code), gl = row.querySelector('.kin-gloss');
    gl.textContent = r.code ? (g || 'Not a valid code') : 'Type a code, e.g. FeB';
    gl.classList.toggle('bad', !!r.code && !g);
  } else if (e.target.classList.contains('kin-term')) r.term = e.target.value;
  else if (e.target.classList.contains('kin-note')) r.note = e.target.value;
  kinSaveSoon();
});
$('kin-rows').addEventListener('click', e => {
  const b = e.target.closest('.kin-del'); const v = activeVocab(); if (!b || !v) return;
  v.rules.splice(+b.closest('.kin-row').dataset.i, 1);
  saveKin(); renderKinRows(); if (kinView.ego) refreshKinView();
});
$('kin-add-row').addEventListener('click', () => {
  const v = activeVocab(); if (!v) return;
  v.rules.push({ code: '', term: '', note: '' });
  saveKin(); renderKinRows();
  const rows = $('kin-rows').querySelectorAll('.kin-code'); rows[rows.length - 1]?.focus();
});
$('kin-sort').addEventListener('click', () => {
  const v = activeVocab(); if (!v) return;
  const len = c => (parseKinCode(c)?.toks.length ?? 99);
  v.rules.sort((a, b) => len(a.code) - len(b.code) || a.code.localeCompare(b.code));
  saveKin(); renderKinRows();
});
$('kin-select').addEventListener('change', e => { kin.active = e.target.value; saveKin(); renderKinPanel(); if (kinView.ego) refreshKinView(); });
for (const [id, key] of [['kin-name', 'name'], ['kin-lang', 'language'], ['kin-about', 'about']]) {
  $(id).addEventListener('input', e => {
    const v = activeVocab(); if (!v) return;
    v[key] = e.target.value;
    if (key === 'name') { const o = $('kin-select').selectedOptions[0]; if (o) o.textContent = v.name || 'Kinship terms'; }
    kinSaveSoon();
  });
}
$('kin-new').addEventListener('click', () => {
  const v = cleanVocab({ id: 'k' + Date.now().toString(36), name: 'My community’s terms', rules: [] });
  kin.lists.push(v); kin.active = v.id; saveKin(); renderKinPanel();
  $('kin-name').focus(); $('kin-name').select();
});
$('kin-copy').addEventListener('click', () => {
  const cur = activeVocab(); if (!cur) return;
  const v = cleanVocab({ ...JSON.parse(JSON.stringify(cur)), id: 'k' + Date.now().toString(36), name: cur.name.replace(/ \(starter\)$/, '') + ' (my copy)', starter: false });
  kin.lists.push(v); kin.active = v.id; saveKin(); renderKinPanel();
  toast('Copied. Edit the terms to match your community.');
});
$('kin-delete').addEventListener('click', () => {
  const cur = activeVocab(); if (!cur) return;
  showModal(`Delete “${cur.name}”?`, `Its ${cur.rules.length} terms are removed from this device. Export it first if you may need it.`, () => {
    kin.lists = kin.lists.filter(l => l.id !== cur.id); kin.active = ''; saveKin(); renderKinPanel(); if (kinView.ego) refreshKinView();
  }, { danger: true, confirmText: 'Delete' });
});
$('kin-export').addEventListener('click', () => {
  const cur = activeVocab(); if (!cur) return;
  const data = { format: 'geneamap-kinship', v: 1, ...cleanVocab(cur) };
  downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `${fileSafe(cur.name)}_kinship.json`);
});
$('kin-import').addEventListener('click', () => $('kin-file').click());
$('kin-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const raw = d && d.format === 'geneamap-kinship' ? d : d && d.kinship ? d.kinship : null;
    if (!raw || !Array.isArray(raw.rules)) throw new Error();
    const v = adoptVocab(raw, f.name.replace(/\.json$/i, ''));
    renderKinPanel(); if (kinView.ego) refreshKinView();
    toast(`Added “${v.name}” (${v.rules.length} terms)`, { kind: 'ok' });
  } catch { toast('That file is not a GeneaMap kinship list'); }
});

// ── View → Show on cards ───────────────────────────────────
function applyCardPrefs() {
  for (const b of document.querySelectorAll('[data-card-pref]')) b.setAttribute('aria-checked', !!prefs.card[b.dataset.cardPref]);
}
document.querySelectorAll('[data-card-pref]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.cardPref;
  prefs.card[k] = !prefs.card[k];
  savePrefs(); applyCardPrefs();
  for (const n of Object.values(state.nodes)) { const el = nodeEls.get(n.id); if (el) { el.className = nodeClass(n); el.innerHTML = nodeInner(n); } }
}));

// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════
function loadDemo() {
  const demo = [
    { name: 'William Ashford', gender: 'male', birth: '1889', death: '1962', place: 'Yorkshire', notes: 'Farmer' },
    { name: 'Margaret Rose Ashford', gender: 'female', birth: '1892', death: '1971', place: 'Yorkshire', notes: 'née Harrington' },
    { name: 'Thomas Ashford', gender: 'male', birth: '1920', death: '1984', place: 'Leeds' },
    { name: 'Eleanor Ashford', gender: 'female', birth: '1923', death: '2001', place: 'Leeds' }
  ];
  const positions = [{ x: 200, y: 80 }, { x: 440, y: 80 }, { x: 180, y: 290 }, { x: 440, y: 290 }];
  const ids = demo.map((d, i) => addNode(d, positions[i], { silent: true }));
  addConnection(ids[0], ids[1], 'spouse', { silent: true, force: true });
  addConnection(ids[0], ids[2], 'parent', { silent: true, force: true });
  addConnection(ids[0], ids[3], 'parent', { silent: true, force: true });
  addConnection(ids[1], ids[2], 'parent', { silent: true, force: true });
  addConnection(ids[1], ids[3], 'parent', { silent: true, force: true });
  state.title = 'Ashford Family';
  $('f-map-title').value = state.title;
}

(async function init() {
  fillIcons();
  loadKin();
  loadBackupMeta();
  $('gm-ver').textContent = 'v' + APP_VERSION;
  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) $('btn-fullscreen').hidden = true;
  else syncFullscreen();
  loadPrefs();
  applyPrefs();
  applyCardPrefs();
  initAccordions();
  setGender('neutral');
  // in a small container with the controls stacked under the tree, start with them folded to their toolbar
  setSidebar(!(getComputedStyle($('app')).display === 'flex' && frameEl.clientHeight < 480));
  wrapRect = canvasWrap.getBoundingClientRect();   // measure the canvas after the fold, before fitting the tree

  const saved = await readAutosave();
  let restored = false;
  if (saved?.state) {
    try {
      const data = normalizeMap(saved.state);
      await loadStoredPhotos(usedPhotoIds(data.nodes));
      for (const n of Object.values(data.nodes)) if (n.photo && !photos.has(n.photo)) n.photo = null;
      state = data;
      $('f-map-title').value = state.title === 'Family Tree' ? '' : state.title;
      resyncCounters();
      rebuildAll();
      let sv = readView() || (saved.view && Number.isFinite(saved.view.scale) ? saved.view : null);
      // saved in a container of a clearly different size (or unknown size): fit the tree to this one instead
      const near = (a, b) => a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) < 0.15;
      if (sv && !(near(sv.w, wrapRect.width) && near(sv.h, wrapRect.height))) sv = null;
      if (sv) {
        Object.assign(view, { x: +sv.x || 0, y: +sv.y || 0, scale: clamp(+sv.scale, MIN_SCALE, MAX_SCALE) });
        if (!anyoneVisible()) fitView(false);   // saved in a bigger container: nobody would be on screen here
        requestTransform();
      } else fitView(false);
      restored = true;
    } catch { state = emptyState(); }
  }
  if (!restored) {
    loadDemo();
    fitView(false);
    writeAutosave();
  }
  updateStats();
  resetHistory();
  requestTransform();
  // the file this tree was last saved to (browsers that support it); writing needs permission again after a reload
  try {
    const h = await kvGet('fileHandle');
    if (h && restored) {
      fileLink.handle = h; fileLink.name = h.name; currentFileHandle = h;
      fileLink.ok = (await h.queryPermission?.({ mode: 'readwrite' })) === 'granted';
    }
  } catch { /* not supported */ }
  renderStorageStatus();
  renderKinViewStatus();
  checkPersisted(restored);
  if (restored) { dailyVersion().then(prunePhotos); maybeRemindBackup(); }
  setStatus(restored ? 'Welcome back — your map was restored' : 'Demo family loaded — drag people around, long-press or right-click for options');
  // PWA shortcuts: ?action=rel-finder etc.
  const action = new URLSearchParams(location.search).get('action');
  if (action && commands[action]) setTimeout(() => commands[action](), 300);
})();

})();
