'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Service Worker registration
// ─────────────────────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => {
      console.warn('Service worker registration failed:', e);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  snippets: [],
  forward_map: {},
  reverse_map: {},
  php_settings: {},
  js_settings: {},
  direction: 'forward',
  selected_snip: null,   // key in snippets panel
  dirty_snippets: false,

  // Debug storage: last run results
  last_debug: {
    js:  null,   // { input, direction, output, log, snippets_used, ms }
    php: null,
  },

  // Maps tab state
  maps_tab_view: 'forward',   // 'forward' | 'reverse'
  maps_tab_dirty: {},          // { section: bool }
  maps_tab_pending: {},        // { section: [{id,from,to}] } — working copy while dirty
};

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────
async function api(action, body = {}) {
  const r = await fetch('api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2800);
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const data = await api('load');
    S.snippets    = data.snippets    || [];
    S.forward_map = data.forward_map || {};
    S.reverse_map = data.reverse_map || {};
    S.php_settings = data.php_settings || {};
    S.js_settings  = data.js_settings  || {};
    renderSnippetList();
    renderSnippetsPanelList();
    renderMapsTab();
  } catch(e) {
    toast('Failed to load data: ' + e.message, 'err');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'snippets') renderSnippetsPanelList();
    if (btn.dataset.tab === 'debug') renderDebugPanel();
    if (btn.dataset.tab === 'engines') renderEnginesPanel();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Direction toggle
// ─────────────────────────────────────────────────────────────────────────────
document.querySelectorAll('.dir-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dir-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.direction = btn.dataset.dir;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Snippet list (test panel left column — active snippets only)
// ─────────────────────────────────────────────────────────────────────────────
function tagHtml(stage, direction) {
  const stageTag = `<span class="tag tag-${stage}">${stage}</span>`;
  const dirTag   = `<span class="tag tag-${direction}">${direction}</span>`;
  return stageTag + dirTag;
}

function renderSnippetList() {
  const list   = document.getElementById('snippet-list');
  const active = S.snippets.filter(s => s.is_active).length;
  document.getElementById('snip-count').textContent = `${active}/${S.snippets.length}`;

  list.innerHTML = S.snippets.map((s, i) => `
    <div class="snip-item" data-idx="${i}">
      <label class="snip-toggle" title="${s.is_active ? 'Disable' : 'Enable'}">
        <input type="checkbox" ${s.is_active ? 'checked' : ''} data-toggle="${i}">
        <span class="snip-toggle-track"></span>
        <span class="snip-toggle-thumb"></span>
      </label>
      <div class="snip-meta">
        <div class="snip-name" title="${s.snippet_key || ''}">${s.label || s.snippet_key || 'Unnamed'}</div>
        <div class="snip-tags">${tagHtml(s.hook_stage, s.direction)}</div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-toggle]').forEach(chk => {
    chk.addEventListener('change', () => {
      const idx = +chk.dataset.toggle;
      S.snippets[idx].is_active = chk.checked ? 1 : 0;
      S.dirty_snippets = true;
      renderSnippetList();
      autoSaveSnippets();
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Snippets Panel — two-line list + side editor
// ─────────────────────────────────────────────────────────────────────────────
const selectedSnippets = new Set();

function updateSelectionBar() {
  const bar    = document.getElementById('sel-action-bar');
  const label  = document.getElementById('sel-count-label');
  const n      = selectedSnippets.size;
  bar.classList.toggle('visible', n > 0);
  label.textContent = n + ' selected';
}

function renderSnippetsPanelList() {
  const body = document.getElementById('snip-panel-list-body');
  document.getElementById('snip-count2').textContent = S.snippets.length;

  body.innerHTML = S.snippets.map((s, i) => `
    <div class="snip-row ${S.selected_snip === i ? 'selected' : ''}" data-idx="${i}">
      <!-- Line 1: checkbox, key, label, position, sort order -->
      <div class="snip-row-line1">
        <input type="checkbox" class="sel-check" data-sel="${i}" ${selectedSnippets.has(i) ? 'checked' : ''}>
        <span class="snip-row-key">${escHtml(s.snippet_key || '')}</span>
        <span class="snip-row-label" title="${escHtml(s.label||'')}">${escHtml(s.label || 'Unnamed')}</span>
        <span class="tag tag-${s.hook_stage}">${s.hook_stage}</span>
        <span class="snip-row-order">#${s.sort_order ?? 0}</span>
      </div>
      <!-- Line 2: direction, toggle, export, edit, delete -->
      <div class="snip-row-line2">
        <span class="tag tag-${s.direction}">${s.direction}</span>
        <button class="snip-row-dir-btn ${s.is_active ? 'on' : ''}" data-snip-toggle="${i}" title="${s.is_active ? 'Enabled — click to disable' : 'Disabled — click to enable'}">
          ${s.is_active ? '● On' : '○ Off'}
        </button>
        <button class="snip-row-action" data-snip-export="${i}" title="Export this snippet">📤 Export</button>
        <button class="snip-row-action" data-snip-edit="${i}" title="Edit this snippet">✏️ Edit</button>
        <button class="snip-row-action del" data-snip-del="${i}" title="Delete this snippet">🗑 Delete</button>
      </div>
    </div>
  `).join('');

  // Selection checkboxes
  body.querySelectorAll('[data-sel]').forEach(chk => {
    chk.addEventListener('change', () => {
      const i = +chk.dataset.sel;
      if (chk.checked) selectedSnippets.add(i);
      else             selectedSnippets.delete(i);
      chk.closest('.snip-row').classList.toggle('selected', chk.checked && S.selected_snip !== i);
      updateSelectionBar();
    });
    chk.addEventListener('click', e => e.stopPropagation());
  });

  // Toggle buttons
  body.querySelectorAll('[data-snip-toggle]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const i = +btn.dataset.snipToggle;
      S.snippets[i].is_active = S.snippets[i].is_active ? 0 : 1;
      autoSaveSnippets();
      renderSnippetList();
      renderSnippetsPanelList();
    });
  });

  // Export
  body.querySelectorAll('[data-snip-export]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      exportSnippet(+btn.dataset.snipExport);
    });
  });

  // Edit
  body.querySelectorAll('[data-snip-edit]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const i = +btn.dataset.snipEdit;
      S.selected_snip = i;
      renderSnippetsPanelList();
      renderSnippetPanelEditor(i);
    });
  });

  // Delete
  body.querySelectorAll('[data-snip-del]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const i = +btn.dataset.snipDel;
      if (!confirm(`Delete snippet "${S.snippets[i].label || S.snippets[i].snippet_key}"?\nThis cannot be undone.`)) return;
      selectedSnippets.delete(i);
      const shifted = new Set();
      selectedSnippets.forEach(idx => shifted.add(idx > i ? idx - 1 : idx));
      selectedSnippets.clear();
      shifted.forEach(idx => selectedSnippets.add(idx));
      S.snippets.splice(i, 1);
      if (S.selected_snip === i) {
        S.selected_snip = null;
        document.getElementById('snip-panel-editor-inner').innerHTML = '<div class="empty-state">Snippet deleted.</div>';
      } else if (S.selected_snip > i) {
        S.selected_snip--;
      }
      autoSaveSnippets();
      renderSnippetList();
      renderSnippetsPanelList();
      toast('Snippet deleted');
    });
  });

  updateSelectionBar();
}

// ── Snippet editor in Snippets panel ─────────────────────────────────────────
function renderSnippetPanelEditor(idx) {
  const s = S.snippets[idx];
  if (!s) return;
  const inner = document.getElementById('snip-panel-editor-inner');
  inner.innerHTML = `
    <div class="editor-field">
      <div class="editor-label">Key</div>
      <input class="editor-input" id="ped-key" value="${escHtml(s.snippet_key || '')}" placeholder="unique_key">
    </div>
    <div class="editor-field">
      <div class="editor-label">Label</div>
      <input class="editor-input" id="ped-label" value="${escHtml(s.label || '')}" placeholder="Human-readable label">
    </div>
    <div style="display:flex;gap:8px;">
      <div class="editor-field" style="flex:1">
        <div class="editor-label">Hook Stage</div>
        <select class="editor-input" id="ped-stage">
          ${['pre','loop','post'].map(v => `<option value="${v}" ${s.hook_stage===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="editor-field" style="flex:1">
        <div class="editor-label">Direction</div>
        <select class="editor-input" id="ped-dir">
          ${['forward','reverse','both'].map(v => `<option value="${v}" ${s.direction===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="editor-field" style="width:70px">
        <div class="editor-label">Order</div>
        <input type="number" class="editor-input" id="ped-order" value="${s.sort_order ?? 0}" min="0">
      </div>
    </div>
    <div class="editor-field" style="flex:1;display:flex;flex-direction:column;">
      <div class="editor-label">
        JS Body <span style="color:var(--muted);font-weight:400;">(function body, browser)</span>
        <span class="valid-badge" id="ped-js-badge"></span>
      </div>
      <textarea class="code-editor" id="ped-js" style="flex:1;min-height:130px;" spellcheck="false">${escHtml(s.js_body || '')}</textarea>
      <div style="font-size:10px;color:var(--muted);margin-top:2px;" id="ped-js-err"></div>
    </div>
    <div class="editor-field" style="flex:1;display:flex;flex-direction:column;">
      <div class="editor-label">
        PHP Body <span style="color:var(--muted);font-weight:400;">(JSON rules array, server)</span>
        <span class="valid-badge" id="ped-php-badge"></span>
      </div>
      <textarea class="code-editor" id="ped-php" style="flex:1;min-height:130px;" spellcheck="false">${escHtml(s.php_body || '')}</textarea>
      <div style="font-size:10px;color:var(--muted);margin-top:2px;" id="ped-php-err"></div>
    </div>
    <div class="editor-field">
      <div class="editor-label">Description</div>
      <textarea class="editor-input" id="ped-desc" rows="2" style="resize:vertical;">${escHtml(s.logic_description || '')}</textarea>
    </div>
    <div class="btn-row">
      <button class="btn btn-sm" id="ped-dup">⧉ Duplicate</button>
      <button class="btn btn-sm" id="ped-export">📤 Export</button>
    </div>
  `;

  // Live validation
  validateSnippetField('ped-js',  'ped-js-badge',  'ped-js-err',  'js');
  validateSnippetField('ped-php', 'ped-php-badge', 'ped-php-err', 'php');
  document.getElementById('ped-js').addEventListener('input',  () => validateSnippetField('ped-js',  'ped-js-badge',  'ped-js-err',  'js'));
  document.getElementById('ped-php').addEventListener('input', () => validateSnippetField('ped-php', 'ped-php-badge', 'ped-php-err', 'php'));

  document.getElementById('btn-save-snippet-panel').onclick = () => {
    if (!validateBeforeSave('ped-js', 'js') || !validateBeforeSave('ped-php', 'php')) return;
    S.snippets[idx] = {
      ...S.snippets[idx],
      snippet_key: document.getElementById('ped-key').value.trim(),
      label:       document.getElementById('ped-label').value.trim(),
      hook_stage:  document.getElementById('ped-stage').value,
      direction:   document.getElementById('ped-dir').value,
      sort_order:  +document.getElementById('ped-order').value,
      js_body:     document.getElementById('ped-js').value,
      php_body:    document.getElementById('ped-php').value,
      logic_description: document.getElementById('ped-desc').value,
    };
    autoSaveSnippets();
    renderSnippetList();
    renderSnippetsPanelList();
    toast('Snippet saved ✓');
  };

  document.getElementById('ped-dup').onclick = () => {
    const clone = { ...S.snippets[idx], snippet_key: S.snippets[idx].snippet_key + '_copy' };
    S.snippets.splice(idx + 1, 0, clone);
    S.selected_snip = idx + 1;
    autoSaveSnippets();
    renderSnippetList();
    renderSnippetsPanelList();
    renderSnippetPanelEditor(idx + 1);
    toast('Snippet duplicated');
  };

  document.getElementById('ped-export').onclick = () => exportSnippet(idx);
}

// ── Snippet validation helpers ────────────────────────────────────────────────
function validateSnippetField(textareaId, badgeId, errId, type) {
  const ta    = document.getElementById(textareaId);
  const badge = document.getElementById(badgeId);
  const errEl = document.getElementById(errId);
  if (!ta || !badge) return true;
  const val = ta.value.trim();
  if (!val) {
    ta.classList.remove('valid','invalid');
    badge.textContent = '';
    badge.className = 'valid-badge';
    errEl.textContent = '';
    return true;
  }
  let ok = true, msg = '';
  if (type === 'js') {
    try {
      new Function('return (' + val + ')')();
    } catch(e) {
      try { new Function(val); } catch(e2) { ok = false; msg = e2.message; }
    }
  } else if (type === 'php') {
    try {
      JSON.parse(val);
    } catch(e) {
      ok = false;
      msg = 'Invalid JSON: ' + e.message;
    }
  }
  ta.classList.toggle('valid', ok);
  ta.classList.toggle('invalid', !ok);
  badge.textContent = ok ? '✓ valid' : '✗ error';
  badge.className   = 'valid-badge ' + (ok ? 'ok' : 'err');
  errEl.textContent  = ok ? '' : msg;
  return ok;
}

function validateBeforeSave(textareaId, type) {
  const ta  = document.getElementById(textareaId);
  if (!ta) return true;
  const val = ta.value.trim();
  if (!val) return true;
  let ok = true;
  if (type === 'js') {
    try { new Function('return (' + val + ')')(); }
    catch(e) {
      try { new Function(val); }
      catch(e2) { ok = false; }
    }
  } else if (type === 'php') {
    try { JSON.parse(val); }
    catch(e) { ok = false; }
  }
  if (!ok) {
    toast(`Fix ${type.toUpperCase()} syntax errors before saving`, 'err');
    ta.focus();
  }
  return ok;
}

// + New button in snippets panel
document.getElementById('btn-add-snippet2').addEventListener('click', () => {
  const s = newSnippetTemplate();
  S.snippets.push(s);
  S.selected_snip = S.snippets.length - 1;
  autoSaveSnippets();
  renderSnippetList();
  renderSnippetsPanelList();
  renderSnippetPanelEditor(S.selected_snip);
});

// Save all button (we keep save inline per snippet; this also does a full save)
document.getElementById('btn-save-snippet-panel').addEventListener('click', () => {
  // This is re-wired per editor render; handled in renderSnippetPanelEditor
});

// Export selected
document.getElementById('btn-export-selected').addEventListener('click', () => {
  if (selectedSnippets.size === 0) return;
  const chosen = [...selectedSnippets].sort((a,b) => a-b).map(i => S.snippets[i]);
  if (chosen.length === 1) {
    downloadJson(chosen[0], (chosen[0].snippet_key || 'snippet') + '.json');
    toast('Exported: ' + (chosen[0].snippet_key || 'snippet'));
  } else {
    downloadJson(chosen, 'snippets_selection.json');
    toast('Exported ' + chosen.length + ' snippets');
  }
});

document.getElementById('btn-sel-clear').addEventListener('click', () => {
  selectedSnippets.clear();
  renderSnippetsPanelList();
});

// ─────────────────────────────────────────────────────────────────────────────
// Snippet template
// ─────────────────────────────────────────────────────────────────────────────
function newSnippetTemplate() {
  return {
    snippet_key: 'new_snippet_' + Date.now(),
    label: 'New Snippet',
    hook_stage: 'pre',
    direction: 'forward',
    sort_order: 99,
    is_active: 0,
    source: 'custom',
    js_body: '',
    php_body: '',
    logic_description: '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Maps Tab — table view with per-section ordering
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_ORDER = ['special','consonants','matras','independent_vowels','digits','punctuation'];

// v3 map format: { section: [[id, from, to], ...] }
// Extract plain [from, to] pairs for engine consumption (backward compat)
function mapForEngine(map) {
  const out = {};
  for (const [sec, entries] of Object.entries(map)) {
    out[sec] = entries.map(e => Array.isArray(e) && e.length === 3 ? [e[1], e[2]] : e);
  }
  return out;
}

function countMapEntries(map) {
  let n = 0;
  for (const k of Object.keys(map)) {
    if (k === '_meta') continue;
    const v = map[k];
    if (Array.isArray(v)) n += v.length;
    else if (typeof v === 'object') n += Object.keys(v).length;
  }
  return n;
}

function getActiveMapRaw() {
  return S.maps_tab_view === 'forward' ? S.forward_map : S.reverse_map;
}

// Flatten map for the test-panel character grid (keep backward compat)
function flattenMapEntries(map) {
  const entries = [];
  for (const section of SECTION_ORDER) {
    const raw = map[section];
    if (!raw) continue;
    if (Array.isArray(raw) && raw.length > 0) {
      for (const pair of raw) {
        if (Array.isArray(pair) && pair.length === 3) {
          entries.push({ section, from: pair[1], to: pair[2] });
        } else if (Array.isArray(pair) && pair.length === 2) {
          entries.push({ section, from: pair[0], to: pair[1] });
        }
      }
    } else if (typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k,v] of Object.entries(raw)) {
        entries.push({ section, from: k, to: v });
      }
    }
  }
  return entries;
}

// ── Render full Maps Tab ──────────────────────────────────────────────────────
function renderMapsTab() {
  const map     = getActiveMapRaw();
  const filter  = (document.getElementById('maps-tab-search').value || '').toLowerCase();
  const body    = document.getElementById('maps-tab-body');
  const total   = countMapEntries(map);

  document.getElementById('maps-tab-total').textContent = `${total} entries`;

  // JSON preview — always shows the committed (saved) state, v2 format
  const jsonEl = document.getElementById('maps-tab-json');
  const jsonOut = {};
  for (const [sec, entries] of Object.entries(map)) {
    jsonOut[sec] = normaliseEntries(entries).map(e => [e.from, e.to]);
  }
  jsonEl.value = JSON.stringify(jsonOut, null, 2);

  const sections = SECTION_ORDER.filter(s => map[s] && map[s].length > 0);
  // Also include any sections not in SECTION_ORDER
  for (const s of Object.keys(map)) {
    if (s !== '_meta' && !sections.includes(s) && map[s] && map[s].length > 0) sections.push(s);
  }

  if (sections.length === 0) {
    body.innerHTML = '<div class="map-no-results">No map entries found.</div>';
    return;
  }

  body.innerHTML = sections.map(section => renderMapSection(section, map[section] || [], filter)).join('');

  // Bind buttons
  body.querySelectorAll('.map-row-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action  = btn.dataset.action;
      const section = btn.dataset.section;
      const idx     = parseInt(btn.dataset.idx, 10);
      handleMapRowMove(section, idx, action === 'up' ? -1 : 1);
    });
  });

  body.querySelectorAll('.btn-map-section-save').forEach(btn => {
    btn.addEventListener('click', () => saveMapSection(btn.dataset.section));
  });

  body.querySelectorAll('.btn-map-section-cancel').forEach(btn => {
    btn.addEventListener('click', () => cancelMapSection(btn.dataset.section));
  });
}

function renderMapSection(section, rawEntries, filter) {
  // Working copy: use pending if dirty, else from live map
  const isDirty   = !!(S.maps_tab_dirty[section]);
  const entries   = isDirty ? S.maps_tab_pending[section] : normaliseEntries(rawEntries);

  const filtered  = filter
    ? entries.filter(e => e.from.toLowerCase().includes(filter) || e.to.toLowerCase().includes(filter))
    : entries;

  const label = section.replace(/_/g, ' ');
  const dirtyBadgeClass = isDirty ? 'map-section-dirty-badge visible' : 'map-section-dirty-badge';

  const rows = filtered.map((e, visIdx) => {
    // real index in full (possibly pending) entries array
    const realIdx = isDirty
      ? S.maps_tab_pending[section].findIndex(x => x.id === e.id)
      : entries.indexOf(e);
    const isFirst = realIdx === 0;
    const isLast  = realIdx === entries.length - 1;
    const isMoved = isDirty && isEntryMoved(section, e.id);
    return `
      <tr class="map-row${isMoved ? ' moved' : ''}" data-id="${e.id}" data-section="${section}">
        <td class="col-rank">${realIdx + 1}</td>
        <td class="col-from">${escHtml(e.from)}</td>
        <td class="col-to">${escHtml(e.to)}</td>
        <td class="col-ctrl">
          <button class="map-row-btn" data-action="up" data-section="${section}" data-idx="${realIdx}"
            ${isFirst ? 'disabled' : ''} title="Move up">▲</button>
          <button class="map-row-btn" data-action="down" data-section="${section}" data-idx="${realIdx}"
            ${isLast ? 'disabled' : ''} title="Move down">▼</button>
        </td>
      </tr>`;
  }).join('');

  const noMatch = filtered.length === 0 && filter
    ? `<tr><td colspan="4" class="map-no-results">No matches in this section.</td></tr>`
    : '';

  return `
    <div class="map-section-block">
      <div class="map-section-hd">
        <span class="map-section-title">${escHtml(label)}</span>
        <span class="map-section-count">${entries.length}</span>
        <span class="${dirtyBadgeClass}">● unsaved</span>
        <div class="map-section-actions">
          <button class="btn btn-sm btn-map-section-cancel" data-section="${section}"
            ${isDirty ? '' : 'disabled'}>Cancel</button>
          <button class="btn btn-sm btn-primary btn-map-section-save" data-section="${section}"
            ${isDirty ? '' : 'disabled'}>💾 Save order</button>
        </div>
      </div>
      <table class="map-section-table">
        <thead>
          <tr>
            <th class="col-rank">#</th>
            <th class="col-from">From</th>
            <th class="col-to">To</th>
            <th class="col-ctrl">Order</th>
          </tr>
        </thead>
        <tbody>${rows}${noMatch}</tbody>
      </table>
    </div>`;
}

// Convert raw map entries (v3: [id,from,to] or v2: [from,to]) to {id,from,to}
function normaliseEntries(rawEntries) {
  return rawEntries.map((pair, i) => {
    if (Array.isArray(pair) && pair.length === 3) return { id: pair[0], from: pair[1], to: pair[2] };
    if (Array.isArray(pair) && pair.length === 2) return { id: i,       from: pair[0], to: pair[1] };
    return { id: i, from: String(pair), to: '' };
  });
}

function isEntryMoved(section, id) {
  if (!S.maps_tab_dirty[section]) return false;
  const map = getActiveMapRaw();
  const original = normaliseEntries(map[section] || []);
  const origIdx  = original.findIndex(e => e.id === id);
  const pendIdx  = S.maps_tab_pending[section].findIndex(e => e.id === id);
  return origIdx !== pendIdx;
}

function handleMapRowMove(section, idx, delta) {
  // Initialise pending from live map if not already dirty
  if (!S.maps_tab_dirty[section]) {
    const map = getActiveMapRaw();
    S.maps_tab_pending[section] = normaliseEntries(map[section] || []);
  }

  const arr    = S.maps_tab_pending[section];
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= arr.length) return;

  // Swap
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];

  S.maps_tab_dirty[section] = true;
  renderMapsTab();
}

async function saveMapSection(section) {
  if (!S.maps_tab_dirty[section]) return;

  const ids = S.maps_tab_pending[section].map(e => e.id);
  const type = S.maps_tab_view;

  try {
    await api('reorder_map_section', { type, section, ids });

    // Commit pending order into the live map
    const map = getActiveMapRaw();
    // Rebuild as v3 triples in new order
    const oldEntries = normaliseEntries(map[section] || []);
    const idToEntry  = Object.fromEntries(oldEntries.map(e => [e.id, e]));
    map[section]     = ids.map((id, i) => [id, idToEntry[id].from, idToEntry[id].to]);

    delete S.maps_tab_dirty[section];
    delete S.maps_tab_pending[section];

    toast(`${section.replace(/_/g,' ')} order saved`);
    renderMapsTab();
  } catch(e) {
    toast('Save failed: ' + e.message, 'err');
  }
}

function cancelMapSection(section) {
  delete S.maps_tab_dirty[section];
  delete S.maps_tab_pending[section];
  renderMapsTab();
}

// ── Maps Tab toolbar listeners ────────────────────────────────────────────────
document.getElementById('maps-tab-view-select').addEventListener('change', function() {
  // Warn if there are unsaved changes
  if (Object.keys(S.maps_tab_dirty).length > 0) {
    if (!confirm('You have unsaved ordering changes. Switch anyway and discard them?')) return;
  }
  S.maps_tab_view   = this.value;
  S.maps_tab_dirty  = {};
  S.maps_tab_pending = {};
  renderMapsTab();
});

document.getElementById('maps-tab-search').addEventListener('input', () => renderMapsTab());

document.getElementById('btn-maps-tab-export').addEventListener('click', () => {
  const map  = getActiveMapRaw();
  const type = S.maps_tab_view;
  // Export as v2 [from,to] pairs (engine-compatible)
  const out  = {};
  for (const [sec, entries] of Object.entries(map)) {
    out[sec] = normaliseEntries(entries).map(e => [e.from, e.to]);
  }
  const ts = new Date().toISOString().slice(0,19).replace(/:/g,'-');
  downloadJson(out, `${type}Map_${ts}.json`);
  toast(`${type === 'forward' ? 'Forward' : 'Reverse'} map exported`);
});

// Keep the test-panel map grid working (map-view-select lives there)
document.getElementById('map-view-select').addEventListener('change', function() {
  S.maps_tab_view = this.value;
  S.maps_tab_dirty  = {};
  S.maps_tab_pending = {};
  renderMapGrid();
});

document.getElementById('map-search').addEventListener('input', () => renderMapGrid());

// ── Test-panel map grid (character grid, unchanged logic) ─────────────────────
function getActiveMap() {
  return S.maps_tab_view === 'forward' ? S.forward_map : S.reverse_map;
}

function renderMapGrid() {
  const grid    = document.getElementById('map-grid');
  const selectEl = document.getElementById('map-view-select');
  // If no map selected, show placeholder and clear grid
  if (!selectEl.value) {
    grid.innerHTML = '<div id="map-no-lexicon-msg" class="map-no-lexicon-msg">No Lexicon Map loaded. Select one to load.</div>';
    document.getElementById('map-viewer-count').textContent = '—';
    document.getElementById('map-dirty-badge').style.display = 'none';
    return;
  }
  const filter  = (document.getElementById('map-search').value || '').toLowerCase();
  const map     = getActiveMap();
  const entries = flattenMapEntries(map);
  const dirty   = Object.keys(S.maps_tab_dirty).length > 0;

  document.getElementById('map-dirty-badge').style.display = dirty ? 'inline-block' : 'none';

  const displayEntries = entries;

  const filtered = filter
    ? displayEntries.filter(e => e.from.toLowerCase().includes(filter) || e.to.toLowerCase().includes(filter) || e.section.toLowerCase().includes(filter))
    : displayEntries;

  document.getElementById('map-viewer-count').textContent = `${filtered.length} entries shown (${entries.length} total)`;

  grid.innerHTML = filtered.map(e => `
    <div class="map-entry"
         data-from="${escHtml(e.from)}" data-to="${escHtml(e.to)}" data-section="${e.section}"
         title="${e.section}: ${escHtml(e.from)} \u2192 ${escHtml(e.to)} (click to edit)">
      <span class="map-entry-from">${escHtml(e.from)}</span>
      <span class="map-entry-arrow">\u2192</span>
      <span class="map-entry-to">${escHtml(e.to)}</span>
    </div>
  `).join('');

  grid.querySelectorAll('.map-entry').forEach(el => {
    el.addEventListener('click', e => {
      openMapEditModal(el.dataset.from, el.dataset.to, el.dataset.section, false);
    });
  });
}

// ── Map edit modal (test-panel character grid) ────────────────────────────────
let _mapEditOriginalFrom    = null;
let _mapEditOriginalSection = null;
let _mapEditIsNew           = false;

function openMapEditModal(from, to, section, isNew) {
  _mapEditOriginalFrom    = from;
  _mapEditOriginalSection = section;
  _mapEditIsNew           = isNew;
  document.getElementById('map-edit-modal-title').textContent = isNew ? 'Add Map Entry' : 'Edit Map Entry';
  document.getElementById('map-edit-from').value    = from    || '';
  document.getElementById('map-edit-to').value      = to      || '';
  document.getElementById('map-edit-section').value = section || 'consonants';
  document.getElementById('btn-map-edit-delete').style.display = isNew ? 'none' : '';
  document.getElementById('map-edit-modal-backdrop').classList.add('open');
}

document.getElementById('btn-map-edit-cancel').addEventListener('click', () => {
  document.getElementById('map-edit-modal-backdrop').classList.remove('open');
});
document.getElementById('map-edit-modal-backdrop').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});

document.getElementById('btn-map-edit-ok').addEventListener('click', async () => {
  const from    = document.getElementById('map-edit-from').value.trim();
  const to      = document.getElementById('map-edit-to').value.trim();
  const section = document.getElementById('map-edit-section').value;
  if (!from || !to) { toast('Both FROM and TO fields are required', 'err'); return; }

  const map = getActiveMap();
  if (!map[section]) map[section] = [];
  const raw = map[section];

  if (_mapEditIsNew) {
    // Append as v3 triple with id=0 (server will assign real id on next load)
    raw.push([0, from, to]);
  } else {
    const idx = raw.findIndex(p =>
      (Array.isArray(p) && p.length === 3 && p[1] === _mapEditOriginalFrom) ||
      (Array.isArray(p) && p.length === 2 && p[0] === _mapEditOriginalFrom)
    );
    if (idx >= 0) {
      const id = raw[idx].length === 3 ? raw[idx][0] : 0;
      raw[idx] = [id, from, to];
    }
  }

  document.getElementById('map-edit-modal-backdrop').classList.remove('open');

  const type = S.maps_tab_view;
  try {
    await api('save_map', { type, data: mapForEngine(map) });
    // Reload to get real ids
    const data = await api('load');
    S.forward_map = data.forward_map || {};
    S.reverse_map = data.reverse_map || {};
    renderMapsTab();
    renderMapGrid();
    toast(_mapEditIsNew ? 'Entry added' : 'Entry updated');
  } catch(e) {
    toast('Save failed: ' + e.message, 'err');
  }
});

document.getElementById('btn-map-edit-delete').addEventListener('click', () => {
  const from    = _mapEditOriginalFrom;
  const section = _mapEditOriginalSection;
  document.getElementById('confirm-delete-text').textContent =
    `Are you sure you want to delete the entry "${from}" from the ${section} section? This action cannot be undone after saving.`;
  document.getElementById('confirm-delete-modal-backdrop').classList.add('open');
});

document.getElementById('btn-confirm-delete-cancel').addEventListener('click', () => {
  document.getElementById('confirm-delete-modal-backdrop').classList.remove('open');
});
document.getElementById('confirm-delete-modal-backdrop').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});

document.getElementById('btn-confirm-delete-ok').addEventListener('click', async () => {
  const from    = _mapEditOriginalFrom;
  const section = _mapEditOriginalSection;
  const map     = getActiveMap();
  if (map[section]) {
    map[section] = map[section].filter(p =>
      !((Array.isArray(p) && p.length === 3 && p[1] === from) ||
        (Array.isArray(p) && p.length === 2 && p[0] === from))
    );
  }
  document.getElementById('confirm-delete-modal-backdrop').classList.remove('open');
  document.getElementById('map-edit-modal-backdrop').classList.remove('open');

  const type = S.maps_tab_view;
  try {
    await api('save_map', { type, data: mapForEngine(map) });
    const data = await api('load');
    S.forward_map = data.forward_map || {};
    S.reverse_map = data.reverse_map || {};
    renderMapsTab();
    renderMapGrid();
    toast('Map entry deleted');
  } catch(e) {
    toast('Delete failed: ' + e.message, 'err');
  }
});

document.getElementById('btn-map-add-entry').addEventListener('click', () => {
  openMapEditModal('', '', 'consonants', true);
});

document.getElementById('btn-map-save-changes').addEventListener('click', async () => {
  // This button now just triggers a full map save (test-panel grid has no pending edits concept)
  const map  = getActiveMap();
  const type = S.maps_tab_view;
  try {
    await api('save_map', { type, data: mapForEngine(map) });
    const data = await api('load');
    S.forward_map = data.forward_map || {};
    S.reverse_map = data.reverse_map || {};
    S.maps_tab_dirty   = {};
    S.maps_tab_pending = {};
    renderMapsTab();
    renderMapGrid();
    document.getElementById('map-dirty-badge').style.display = 'none';
    toast(`${type === 'forward' ? 'Forward' : 'Reverse'} map saved`);
  } catch(e) {
    toast('Save failed: ' + e.message, 'err');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Run engines
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('btn-run').addEventListener('click', runEngines);
document.getElementById('input-text').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runEngines();
});

async function runEngines() {
  const input = document.getElementById('input-text').value;
  const dir   = S.direction;
  const activeSnippets = S.snippets.filter(s => s.is_active);

  // JS engine
  const t0js   = performance.now();
  const jsResult = runJsEngine(input, dir, activeSnippets);
  const jsMs   = (performance.now() - t0js).toFixed(1);
  renderEngineResult('js', jsResult, jsMs);

  // Store debug
  S.last_debug.js = {
    input, direction: dir,
    output: jsResult.output,
    log: jsResult.log || [],
    snippets_used: activeSnippets.map(s => ({ key: s.snippet_key, label: s.label, stage: s.hook_stage })),
    maps: { forward_entries: countMapEntries(S.forward_map), reverse_entries: countMapEntries(S.reverse_map) },
    ms: jsMs,
    timestamp: new Date().toISOString(),
  };

  // PHP engine
  const t0php = performance.now();
  try {
    const phpResult = await api('run_php', {
      input, direction: dir,
      snippets: activeSnippets,
      forward_map: mapForEngine(S.forward_map),
      reverse_map: mapForEngine(S.reverse_map),
      php_settings: S.php_settings,
    });
    const phpMs = (performance.now() - t0php).toFixed(1);
    renderEngineResult('php', phpResult, phpMs);
    compareOutputs(jsResult.output, phpResult.output);

    S.last_debug.php = {
      input, direction: dir,
      output: phpResult.output,
      log: phpResult.log || [],
      snippets_used: activeSnippets.map(s => ({ key: s.snippet_key, label: s.label, stage: s.hook_stage })),
      maps: { forward_entries: countMapEntries(S.forward_map), reverse_entries: countMapEntries(S.reverse_map) },
      ms: phpMs,
      timestamp: new Date().toISOString(),
    };
  } catch(e) {
    document.getElementById('php-output').textContent = 'Error: ' + e.message;
    document.getElementById('php-status').textContent = 'error';
    S.last_debug.php = { error: e.message, timestamp: new Date().toISOString() };
  }

  // Auto-refresh debug panel if open
  const debugPanel = document.getElementById('panel-debug');
  if (debugPanel.classList.contains('active')) renderDebugPanel();
}

// ── JS engine runner ──────────────────────────────────────────────────────────
function runJsEngine(input, direction, snippets) {
  if (!window.CPLAI_ENGINE) return { output: '[engine.js not loaded]', log: [] };
  const maps = { forward: mapForEngine(S.forward_map), reverse: mapForEngine(S.reverse_map) };
  const preHooks = [], loopHooks = [], postHooks = [];

  for (const s of snippets) {
    const stage = s.hook_stage;
    const dir   = s.direction;
    if (dir !== direction && dir !== 'both') continue;
    if (!s.js_body || s.js_body.trim() === '') continue;
    try {
      const fn = new Function('return (' + s.js_body + ')')();
      if (typeof fn === 'function') {
        if (stage === 'pre')  preHooks.push(fn);
        if (stage === 'loop') loopHooks.push(fn);
        if (stage === 'post') postHooks.push(fn);
      }
    } catch(e) {
      console.warn('Snippet JS error:', s.snippet_key, e);
    }
  }

  try {
    return CPLAI_ENGINE.bpmTransliterate(input, direction, maps, preHooks, loopHooks, postHooks, null, S.js_settings);
  } catch(e) {
    return { output: '[Engine error: ' + e.message + ']', log: ['[ERROR] ' + e.message] };
  }
}

// ── Render engine result ──────────────────────────────────────────────────────
function renderEngineResult(engine, result, ms) {
  const outEl  = document.getElementById(engine + '-output');
  const logEl  = document.getElementById(engine + '-log');
  const statEl = document.getElementById(engine + '-status');
  outEl.textContent  = result.output || '';
  statEl.textContent = `${ms}ms`;
  logEl.innerHTML = (result.log || []).map(entry => {
    let cls = 'log-entry log-pass';
    if (entry.includes('[MATCH]'))          cls = 'log-entry log-match';
    if (entry.includes('[PRE'))             cls = 'log-entry log-pre';
    if (entry.includes('[LOOP]'))           cls = 'log-entry log-loop';
    if (entry.includes('[VIRAMA]'))         cls = 'log-entry log-virama';
    if (entry.includes('[INHERIT'))         cls = 'log-entry log-inherit';
    if (entry.includes('[ERROR]'))          cls = 'log-entry log-error';
    if (entry.includes('[SNIPPET ERROR]'))  cls = 'log-entry log-error';
    return `<div class="${cls}">${escHtml(entry)}</div>`;
  }).join('');
}

// ── Compare outputs ───────────────────────────────────────────────────────────
function compareOutputs(jsOut, phpOut) {
  document.querySelectorAll('.compare-badge').forEach(e => e.remove());
  if (jsOut === phpOut) {
    document.getElementById('js-status').insertAdjacentHTML('afterend', `<span class="compare-badge match">✓ match</span>`);
  } else {
    document.getElementById('js-status').insertAdjacentHTML('afterend', `<span class="compare-badge diff">≠ diff</span>`);
    document.getElementById('js-output').innerHTML  = diffHtml(jsOut, phpOut);
    document.getElementById('php-output').innerHTML = diffHtml(phpOut, jsOut);
  }
}

function diffHtml(a, b) {
  const aChars = [...a];
  const bChars = [...b];
  let html = '';
  for (let i = 0; i < aChars.length; i++) {
    const ch = escHtml(aChars[i]);
    if (i >= bChars.length || aChars[i] !== bChars[i]) html += `<span class="diff-mark">${ch}</span>`;
    else html += ch;
  }
  return html;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug Panel
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Engines panel (read-only source viewer)
// ─────────────────────────────────────────────────────────────────────────────
let _enginesLoaded = false;

function buildWatermarkOverlay(overlayEl, contentHeight) {
  overlayEl.innerHTML = '';
  overlayEl.style.height = Math.max(contentHeight, overlayEl.parentElement.clientHeight) + 'px';
  const tileH = 140;
  const rows = Math.ceil(parseInt(overlayEl.style.height, 10) / tileH) + 1;
  for (let i = 0; i < rows * 2; i++) {
    const div = document.createElement('div');
    div.className = 'engine-code-watermark';
    div.textContent = 'BhoomiTech Heritage and Development Foundation';
    overlayEl.appendChild(div);
  }
}

async function renderEnginesPanel() {
  renderEngineSettingsUI();
  const jsEl  = document.getElementById('engine-code-js');
  const phpEl = document.getElementById('engine-code-php');
  if (!phpEl) return;
  if (!_enginesLoaded) {
    if (jsEl) jsEl.textContent = 'Loading…';
    phpEl.textContent = 'Loading…';
    try {
      const data = await api('get_engine_source');
      if (jsEl) jsEl.textContent = data.js  || '// engine.js not found';
      phpEl.textContent = data.php || '// engine.php not found';
      _enginesLoaded = true;
    } catch (e) {
      if (jsEl) jsEl.textContent = '// Failed to load engine.js: ' + e.message;
      phpEl.textContent = '// Failed to load engine.php: ' + e.message;
    }
  }
  // Use setTimeout so the panel is visible and has real dimensions before measuring.
  setTimeout(() => {
    const jsWm  = document.getElementById('engine-watermark-js');
    const phpWm = document.getElementById('engine-watermark-php');
    if (jsEl && jsWm)  buildWatermarkOverlay(jsWm,  jsEl.scrollHeight);
    const jsImgWrap = document.getElementById('engine-img-wrap-js');
    if (!jsEl && jsImgWrap && jsWm) buildWatermarkOverlay(jsWm, jsImgWrap.scrollHeight);
    if (phpWm) buildWatermarkOverlay(phpWm, phpEl.scrollHeight);
  }, 50);
}


function renderDebugPanel() {
  renderDebugHalf('js',  document.getElementById('debug-js-content'));
  renderDebugHalf('php', document.getElementById('debug-php-content'));
}

function renderDebugHalf(engine, container) {
  const d = S.last_debug[engine];
  if (!d) {
    container.innerHTML = '<div class="debug-empty">Run a transliteration in the Test tab to see debug output here.</div>';
    return;
  }
  if (d.error) {
    container.innerHTML = `<div class="debug-section"><div class="debug-section-title">Error</div><div class="debug-line debug-error">${escHtml(d.error)}</div></div>`;
    return;
  }

  const logLines = (d.log || []).map(entry => {
    let cls = 'debug-line';
    if (entry.includes('[MATCH]'))  cls += ' debug-match';
    else if (entry.includes('[PRE')) cls += ' debug-pre';
    else if (entry.includes('[LOOP')) cls += ' debug-loop';
    else if (entry.includes('[ERROR')) cls += ' debug-error';
    else if (entry.includes('[VIRAMA]') || entry.includes('[INHERIT')) cls += ' debug-meta';
    return `<div class="${cls}">${escHtml(entry)}</div>`;
  }).join('') || '<div class="debug-line" style="color:var(--muted);">No log entries.</div>';

  const snippetsHtml = (d.snippets_used || []).map(s =>
    `<div class="debug-line debug-info">• [${s.stage}] ${escHtml(s.key)} — ${escHtml(s.label || '')}</div>`
  ).join('') || '<div class="debug-line" style="color:var(--muted);">None active.</div>';

  container.innerHTML = `
    <div class="debug-section">
      <div class="debug-section-title">Run Info</div>
      <div class="debug-line debug-info">Timestamp: ${escHtml(d.timestamp || '')}</div>
      <div class="debug-line debug-info">Direction: ${escHtml(d.direction || '')}</div>
      <div class="debug-line debug-info">Duration: ${escHtml(String(d.ms || '?'))}ms</div>
      <div class="debug-line debug-info">Map entries: fwd=${d.maps?.forward_entries ?? '?'}, rev=${d.maps?.reverse_entries ?? '?'}</div>
    </div>
    <div class="debug-section">
      <div class="debug-section-title">Input</div>
      <div class="debug-line debug-info" style="font-size:14px;word-break:break-all;">${escHtml(d.input || '')}</div>
    </div>
    <div class="debug-section">
      <div class="debug-section-title">Output</div>
      <div class="debug-line debug-match" style="font-size:16px;word-break:break-all;" dir="auto">${escHtml(d.output || '')}</div>
    </div>
    <div class="debug-section">
      <div class="debug-section-title">Active Snippets (${(d.snippets_used||[]).length})</div>
      ${snippetsHtml}
    </div>
    <div class="debug-section">
      <div class="debug-section-title">Processing Log (${(d.log||[]).length} entries)</div>
      ${logLines}
    </div>
  `;
}

// Export debug as zip bundle
async function exportDebugZip(engine) {
  const d = S.last_debug[engine];
  if (!d) { toast('No debug data — run a transliteration first', 'err'); return; }

  const ts        = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const label     = engine === 'js' ? 'JSE Debug' : 'PHP Debug';
  const zipName   = `${label} ${ts}.zip`;

  const zip = new JSZip();

  // ── 1. Active snippets only ───────────────────────────────────────────────
  const activeSnippets = S.snippets.filter(s => s.is_active);
  zip.file('active_snippets.json', JSON.stringify(activeSnippets, null, 2));

  // ── 2. Engine file ────────────────────────────────────────────────────────
  const engineFilename = engine === 'js' ? 'engine.js' : 'engine.php';
  try {
    const resp = await fetch(engineFilename);
    if (resp.ok) {
      zip.file(engineFilename, await resp.text());
    } else {
      zip.file(engineFilename + '.error.txt', `Could not fetch ${engineFilename}: HTTP ${resp.status}`);
    }
  } catch (e) {
    zip.file(engineFilename + '.error.txt', `Could not fetch ${engineFilename}: ${e.message}`);
  }
  
  // ── 2b. Engine settings file ──────────────────────────────────────────────
  const settingsFilename = engine === 'js' ? 'data/js-engine-settings.json' : 'data/php-engine-settings.json';
  const settingsData     = engine === 'js' ? S.js_settings : S.php_settings;
  zip.file(settingsFilename.split('/').pop(), JSON.stringify(settingsData, null, 2));
   
  // ── 3. Map file (direction-appropriate) ──────────────────────────────────
  const mapData     = d.direction === 'reverse' ? S.reverse_map : S.forward_map;
  const mapFilename = d.direction === 'reverse' ? 'reverseMap.json' : 'forwardMap.json';
  zip.file(mapFilename, JSON.stringify(mapData, null, 2));

  // ── 4. Markdown report ────────────────────────────────────────────────────
  const snippetRows = activeSnippets.length
    ? activeSnippets.map(s => `| \`${s.snippet_key}\` | ${s.label || ''} | ${s.hook_stage || ''} |`).join('\n')
    : '| — | No active snippets | — |';

  const logLines = (d.log || []).length
    ? (d.log).map(l => `    ${l}`).join('\n')
    : '    (no log entries)';

  const md = [
    `# TranslitLab Debug Report — ${engine === 'js' ? 'JS Engine' : 'PHP Engine'}`,
    ``,
    `**Exported:** ${ts}  `,
    `**Direction:** ${d.direction || '—'}  `,
    `**Duration:** ${d.ms || '?'} ms  `,
    `**Map entries:** fwd=${d.maps?.forward_entries ?? '?'}, rev=${d.maps?.reverse_entries ?? '?'}`,
    ``,
    `---`,
    ``,
    `## Input`,
    ``,
    `\`\`\``,
    d.input || '',
    `\`\`\``,
    ``,
    `## Output`,
    ``,
    `\`\`\``,
    d.output || '',
    `\`\`\``,
    ``,
    `## Active Snippets`,
    ``,
    `| Key | Label | Stage |`,
    `|-----|-------|-------|`,
    snippetRows,
    ``,
    `## Processing Log`,
    ``,
    `\`\`\``,
    logLines,
    `\`\`\``,
  ].join('\n');

  zip.file('debug_report.md', md);

  // ── 5. Pack and trigger download ──────────────────────────────────────────
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const a = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(blob),
    download: zipName,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  toast(`Debug zip exported: ${zipName}`);
}

document.getElementById('btn-export-debug-js').addEventListener('click',  () => exportDebugZip('js'));
document.getElementById('btn-export-debug-php').addEventListener('click', () => exportDebugZip('php'));

// ─────────────────────────────────────────────────────────────────────────────
// Auto-save
// ─────────────────────────────────────────────────────────────────────────────
let saveTimer;
function autoSaveSnippets() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSnippets, 600);
}

async function saveSnippets() {
  try {
    const res = await api('save_snippets', { snippets: S.snippets });
    S.dirty_snippets = false;
    if (res && Array.isArray(res.corrections) && res.corrections.length) {
      toast('Sort order conflicts auto-fixed: ' + res.corrections.length + ' (see console)', 'err');
      console.warn('Snippet sort_order corrections:', res.corrections);
      // Reload so the UI reflects the renumbered sort_order values.
      await init();
    }
  } catch(e) {
    toast('Save failed: ' + e.message, 'err');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset defaults
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('btn-reset-defaults').addEventListener('click', async () => {
  if (!confirm('Reset snippets and maps to plugin defaults? This will overwrite all changes.')) return;
  await api('reset_defaults', { which: 'all' });
  const data = await api('load');
  S.snippets    = data.snippets    || [];
  S.forward_map = data.forward_map || {};
  S.reverse_map = data.reverse_map || {};
  S.php_settings = data.php_settings || {};
  S.js_settings  = data.js_settings  || {};
  S.maps_tab_dirty   = {};
  S.maps_tab_pending = {};
  renderSnippetList();
  renderSnippetsPanelList();
  renderMapsTab();
  renderMapGrid();
  renderEngineSettingsUI();
  toast('Reset to defaults');
});

// ─────────────────────────────────────────────────────────────────────────────
// Export / Import
// ─────────────────────────────────────────────────────────────────────────────
function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a    = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(blob),
    download: filename,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function exportSnippet(idx) {
  const s = S.snippets[idx];
  if (!s) return;
  downloadJson(s, (s.snippet_key || 'snippet') + '.json');
  toast('Exported: ' + (s.snippet_key || 'snippet'));
}

function exportAllSnippets() {
  downloadJson(S.snippets, 'snippets.json');
  toast('Exported ' + S.snippets.length + ' snippets');
}

document.getElementById('btn-export-all-snippets').addEventListener('click', exportAllSnippets);
document.getElementById('btn-import-snippets').addEventListener('click', openImportModal);

// ── Import modal ──────────────────────────────────────────────────────────────
let _importParsed = null;

function openImportModal() {
  _importParsed = null;
  document.getElementById('import-preview').textContent = 'No file selected.';
  document.getElementById('btn-import-confirm').disabled = true;
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-modal-backdrop').classList.add('open');
}

function closeImportModal() {
  document.getElementById('import-modal-backdrop').classList.remove('open');
  _importParsed = null;
}

function handleImportFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed)) parsed = [parsed];
      const valid = parsed.filter(s => s && typeof s === 'object' && s.snippet_key);
      if (valid.length === 0) throw new Error('No valid snippet objects found (missing snippet_key)');
      _importParsed = valid;
      const keys     = valid.map(s => s.snippet_key);
      const existing = keys.filter(k => S.snippets.some(s => s.snippet_key === k));
      const fresh    = keys.filter(k => !S.snippets.some(s => s.snippet_key === k));
      let preview = `Found ${valid.length} snippet(s):\n`;
      if (fresh.length)    preview += `  + ${fresh.length} new: ${fresh.join(', ')}\n`;
      if (existing.length) preview += `  ↺ ${existing.length} update: ${existing.join(', ')}`;
      document.getElementById('import-preview').textContent = preview.trim();
      document.getElementById('btn-import-confirm').disabled = false;
    } catch(err) {
      _importParsed = null;
      document.getElementById('import-preview').textContent = '✗ ' + err.message;
      document.getElementById('btn-import-confirm').disabled = true;
    }
  };
  reader.readAsText(file);
}

function confirmImport() {
  if (!_importParsed) return;
  _importParsed.forEach(function(s) {
    const idx = S.snippets.findIndex(x => x.snippet_key === s.snippet_key);
    if (idx >= 0) S.snippets[idx] = s;
    else          S.snippets.push(s);
  });
  renderSnippetList();
  renderSnippetsPanelList();
  autoSaveSnippets();
  toast('Imported ' + _importParsed.length + ' snippet(s)');
  closeImportModal();
}

document.getElementById('btn-import-cancel').addEventListener('click', closeImportModal);
document.getElementById('btn-import-confirm').addEventListener('click', confirmImport);
document.getElementById('import-modal-backdrop').addEventListener('click', function(e) {
  if (e.target === this) closeImportModal();
});

const dropZone  = document.getElementById('import-drop-zone');
const fileInput = document.getElementById('import-file-input');
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => handleImportFile(fileInput.files[0]));
dropZone.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', function() { this.classList.remove('drag-over'); });
dropZone.addEventListener('drop', function(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  handleImportFile(e.dataTransfer.files[0]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Util
// ─────────────────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine Settings (Engines tab)
// ─────────────────────────────────────────────────────────────────────────────
const ENGINE_SETTINGS_FIELDS = [
  { key: 'virama',         label: 'Virama (halanta)',     type: 'char' },
  { key: 'zwj',            label: 'ZWJ',                  type: 'char' },
  { key: 'zwnj',           label: 'ZWNJ',                 type: 'char' },
  { key: 'inherent_vowel', label: 'Inherent vowel',       type: 'text' },
  { key: 'non_linking_consonants', label: 'Non-linking consonants', type: 'list' },
  { key: 'section_order',  label: 'Map section order',    type: 'list' },
  { key: 'hardcode_independent_vowel', label: 'Step 1 — Independent vowel at word start', type: 'bool' },
  { key: 'hardcode_explicit_zwnj',     label: 'Step 2 — Explicit ZWNJ (apostrophe)',       type: 'bool' },
  { key: 'hardcode_consonant_matra',   label: 'Step 3 — Consonant + matra pairing',        type: 'bool' },
  { key: 'hardcode_consonant_cluster', label: 'Step 4 — Consonant cluster + halanta',      type: 'bool' },
];

function charToCodeLabel(ch) {
  if (!ch) return '';
  const cp = ch.codePointAt(0);
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}

function renderEngineSettingsBlock(engine, settings) {
  const rows = ENGINE_SETTINGS_FIELDS.map(f => {
    const id  = `eset-${engine}-${f.key}`;
    const val = settings[f.key];
    let inputHtml = '';

    if (f.type === 'bool') {
      inputHtml = `<input type="checkbox" id="${id}" ${val ? 'checked' : ''} data-engine="${engine}" data-key="${f.key}" data-type="bool">`;
    } else if (f.type === 'char') {
      const display = val === undefined || val === null ? '' : val;
      inputHtml = `
        <input type="text" id="${id}" value="${escHtml(display)}" maxlength="4" style="width:60px;text-align:center;"
               data-engine="${engine}" data-key="${f.key}" data-type="char">
        <span class="eset-codepoint">${escHtml(charToCodeLabel(display))}</span>`;
    } else if (f.type === 'list') {
      const display = Array.isArray(val) ? val.join(', ') : '';
      inputHtml = `<input type="text" id="${id}" value="${escHtml(display)}" placeholder="comma, separated, values"
               data-engine="${engine}" data-key="${f.key}" data-type="list">`;
    } else {
      const display = val === undefined || val === null ? '' : val;
      inputHtml = `<input type="text" id="${id}" value="${escHtml(display)}" data-engine="${engine}" data-key="${f.key}" data-type="text">`;
    }

    const rowCls = f.type === 'bool' ? 'eset-row eset-row-bool' : 'eset-row';
    const labelHtml = f.type === 'bool'
      ? `<label for="${id}">${escHtml(f.label)}</label>`
      : `<label for="${id}">${escHtml(f.label)}</label>`;

    return f.type === 'bool'
      ? `<div class="${rowCls}">${inputHtml}${labelHtml}</div>`
      : `<div class="${rowCls}">${labelHtml}<div class="eset-input">${inputHtml}</div></div>`;
  }).join('');

  return `
    <div class="engine-settings-block" data-engine="${engine}">
      <div class="eset-fields">${rows}</div>
      <div class="eset-actions">
        <button class="btn-small eset-save" data-engine="${engine}">💾 Save ${engine.toUpperCase()} settings</button>
        <button class="btn-small eset-reset" data-engine="${engine}">↺ Restore ${engine.toUpperCase()} defaults</button>
        <span class="eset-status" id="eset-status-${engine}"></span>
      </div>
    </div>`;
}

function renderEngineSettingsUI() {
  const phpEl = document.getElementById('engine-settings-php');
  const jsEl  = document.getElementById('engine-settings-js');
  if (!phpEl || !jsEl) return;
  phpEl.innerHTML = renderEngineSettingsBlock('php', S.php_settings || {});
  jsEl.innerHTML  = renderEngineSettingsBlock('js',  S.js_settings  || {});
  bindEngineSettingsHandlers();
}

function readEngineSettingsFromUI(engine) {
  const out = {};
  ENGINE_SETTINGS_FIELDS.forEach(f => {
    const el = document.getElementById(`eset-${engine}-${f.key}`);
    if (!el) return;
    if (f.type === 'bool') {
      out[f.key] = el.checked;
    } else if (f.type === 'list') {
      out[f.key] = el.value.split(',').map(s => s.trim()).filter(s => s !== '');
    } else {
      out[f.key] = el.value;
    }
  });
  return out;
}

function bindEngineSettingsHandlers() {
  document.querySelectorAll('.eset-save').forEach(btn => {
    btn.onclick = async () => {
      const engine = btn.dataset.engine;
      const data = readEngineSettingsFromUI(engine);
      const statusEl = document.getElementById(`eset-status-${engine}`);
      try {
        await api('save_engine_settings', { engine, data });
        if (engine === 'php') S.php_settings = data;
        else S.js_settings = data;
        statusEl.textContent = 'Saved ✓';
        statusEl.className = 'eset-status ok';
        toast(`${engine.toUpperCase()} engine settings saved`);
      } catch (e) {
        statusEl.textContent = 'Save failed';
        statusEl.className = 'eset-status err';
        toast('Save failed: ' + e.message, 'err');
      }
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
    };
  });

  document.querySelectorAll('.eset-reset').forEach(btn => {
    btn.onclick = async () => {
      const engine = btn.dataset.engine;
      if (!confirm(`Restore default ${engine.toUpperCase()} engine settings? This overwrites the current ${engine}-engine-settings.json.`)) return;
      try {
        const which = engine === 'php' ? 'php_settings' : 'js_settings';
        const res = await api('reset_defaults', { which });
        const data = res.data || {};
        if (engine === 'php') S.php_settings = data;
        else S.js_settings = data;
        renderEngineSettingsUI();
        toast(`${engine.toUpperCase()} engine settings restored to defaults`);
      } catch (e) {
        toast('Reset failed: ' + e.message, 'err');
      }
    };
  });

  // char input live codepoint label
  document.querySelectorAll('input[data-type="char"]').forEach(el => {
    el.oninput = () => {
      const span = el.nextElementSibling;
      if (span && span.classList.contains('eset-codepoint')) {
        span.textContent = charToCodeLabel(el.value);
      }
    };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────
init();
