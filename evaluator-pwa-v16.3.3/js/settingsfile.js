/* Evaluator: settingsfile.js
 *
 * The settings file: API keys, provider, models, search and appearance,
 * kept in ONE JSON file on this device:
 *
 *   Evaluator/evaluator-settings.json
 *
 * Where the "Evaluator" folder lives:
 *   - app      the app's own private folder (Origin Private File System).
 *              Always available, needs no permission. The default.
 *   - folder   a folder the user picked (File System Access API: Chrome and
 *              Edge on a computer). The app makes an "Evaluator" folder
 *              inside it, so the file can be opened, backed up and edited
 *              outside the app. The app folder keeps a mirror copy so the
 *              app still starts when the browser asks for permission again.
 *   - browser  last resort when the browser offers no file storage at all
 *              (some private windows): localStorage.
 *
 * The file is read every time the app opens. Every change is written back
 * straight away (debounced a little so typing doesn't write on each key).
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

const SETTINGS_DIR = 'Evaluator';
const SETTINGS_FILE = 'evaluator-settings.json';
const SETTINGS_FORMAT = 1;
const KEY_SLOTS = ['gemini', 'groq', 'openrouter', 'mistral', 'openai', 'anthropic', 'tavily'];
const PROVIDER_IDS = ['gemini', 'groq', 'openrouter', 'mistral', 'openai', 'anthropic'];
const BROWSER_COPY = 'evaluator.settingsfile.v1';
const MODEL_RE = /^[A-Za-z0-9._:/@+-]{1,200}$/;

/* ---------- Tiny IndexedDB store for the chosen folder's handle ---------- */
const HandleStore = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('evaluator-settings', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', mode);
      const req = fn(tx.objectStore('handles'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  },
  get(key) { return this.run('readonly', (s) => s.get(key)).catch(() => null); },
  set(key, value) { return this.run('readwrite', (s) => s.put(value, key)); },
  remove(key) { return this.run('readwrite', (s) => s.delete(key)).catch(() => {}); },
};

/* ---------- File helpers ---------- */
async function readTextFile(dir, name) {
  try {
    const fh = await dir.getFileHandle(name);
    return await (await fh.getFile()).text();
  } catch (err) {
    if (err && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')) return null;
    throw err;
  }
}

/**
 * Safari's private folder has no createWritable() on the main thread, only
 * createSyncAccessHandle() inside a worker, so writes fall back to a small
 * worker there.
 */
let opfsWorker = null;
function opfsWorkerWrite(dirName, fileName, text) {
  if (!opfsWorker) {
    const code = `onmessage = async (e) => {
      const { id, dirName, fileName, text } = e.data;
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(dirName, { create: true });
        const fh = await dir.getFileHandle(fileName, { create: true });
        const h = await fh.createSyncAccessHandle();
        const bytes = new TextEncoder().encode(text);
        h.truncate(0); h.write(bytes, { at: 0 }); h.flush(); h.close();
        postMessage({ id, ok: true });
      } catch (err) { postMessage({ id, ok: false, message: String(err && err.message || err) }); }
    };`;
    opfsWorker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    opfsWorker.pending = new Map();
    opfsWorker.onmessage = (e) => {
      const p = opfsWorker.pending.get(e.data.id);
      if (!p) return;
      opfsWorker.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(); else p.reject(new Error(e.data.message));
    };
  }
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random()}`;
    opfsWorker.pending.set(id, { resolve, reject });
    opfsWorker.postMessage({ id, dirName, fileName, text });
  });
}

async function writeTextFile(dir, name, text, { opfs = false } = {}) {
  const fh = await dir.getFileHandle(name, { create: true });
  if (typeof fh.createWritable === 'function') {
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    return;
  }
  if (opfs) { await opfsWorkerWrite(SETTINGS_DIR, name, text); return; }
  throw new Error('This browser can\'t write to that folder.');
}

/* =====================================================================
 * The settings
 * ===================================================================== */
const SettingsFile = {
  data: null,         // the settings in use (always valid)
  where: 'app',       // 'app' | 'folder' | 'browser'
  appDir: null,       // Evaluator folder in the app's private storage
  folder: null,       // Evaluator folder inside the folder the user picked
  folderLabel: '',    // "Documents/Evaluator" style label for the UI
  needsPermission: false,
  broken: null,       // { text, error } when the file on disk isn't valid JSON
  state: 'loading',   // loading | saved | saving | error | permission | broken
  message: '',
  lastSavedAt: '',
  listeners: [],
  timer: null,
  queue: Promise.resolve(),

  /* ---------- Shape of the file ---------- */
  defaults() {
    return {
      keys: Object.fromEntries(KEY_SLOTS.map((k) => [k, ''])),
      provider: 'gemini',
      models: {},
      helperModels: {},
      search: 'tavily',
      maxSearches: 4,
      searchFocus: 'own',
      theme: 'light',
      appHeight: 0,
    };
  },

  /**
   * Checks and cleans settings read from a file or typed in the editor.
   * Wrong types are replaced by defaults; a list of what was changed is
   * returned so the editor can say so.
   */
  normalize(raw) {
    const d = this.defaults();
    const notes = [];
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
    if (!r) throw new Error('The settings file must contain one JSON object, starting with { and ending with }.');
    const str = (v) => (typeof v === 'string' ? v.trim() : '');

    if (r.keys !== undefined && (typeof r.keys !== 'object' || r.keys === null || Array.isArray(r.keys))) notes.push('"keys" must be an object; it was ignored');
    const keys = r.keys && typeof r.keys === 'object' && !Array.isArray(r.keys) ? r.keys : {};
    KEY_SLOTS.forEach((k) => {
      const v = keys[k];
      if (v !== undefined && typeof v !== 'string') notes.push(`keys.${k} must be text`);
      d.keys[k] = str(v).slice(0, 500);
    });
    Object.keys(keys).filter((k) => !KEY_SLOTS.includes(k)).forEach((k) => notes.push(`unknown key "${k}" removed (use: ${KEY_SLOTS.join(', ')})`));

    if (r.provider !== undefined) {
      if (PROVIDER_IDS.includes(r.provider)) d.provider = r.provider;
      else notes.push(`provider must be one of ${PROVIDER_IDS.join(', ')}`);
    }
    ['models', 'helperModels'].forEach((field) => {
      const m = r[field];
      if (m === undefined) return;
      if (!m || typeof m !== 'object' || Array.isArray(m)) { notes.push(`"${field}" must be an object`); return; }
      Object.entries(m).forEach(([p, v]) => {
        if (!PROVIDER_IDS.includes(p)) { notes.push(`${field}.${p}: unknown provider`); return; }
        const name = str(v);
        if (name && !MODEL_RE.test(name)) { notes.push(`${field}.${p}: "${name}" isn't a valid model name`); return; }
        if (name) d[field][p] = name;
      });
    });
    if (r.search !== undefined) {
      if (r.search === 'tavily' || r.search === 'builtin') d.search = r.search;
      else notes.push('search must be "tavily" or "builtin"');
    }
    if (r.maxSearches !== undefined) {
      if ([3, 4, 6, 8].includes(Number(r.maxSearches))) d.maxSearches = Number(r.maxSearches);
      else notes.push('maxSearches must be 3, 4, 6 or 8');
    }
    if (r.searchFocus !== undefined) {
      if (r.searchFocus === 'own' || r.searchFocus === 'shared') d.searchFocus = r.searchFocus;
      else notes.push('searchFocus must be "own" or "shared"');
    }
    if (r.theme !== undefined) {
      if (r.theme === 'dark' || r.theme === 'light') d.theme = r.theme;
      else notes.push('theme must be "dark" or "light"');
    }
    if (r.appHeight !== undefined) {
      const h = Math.abs(parseInt(r.appHeight, 10)) || 0;
      d.appHeight = h ? Math.max(600, Math.min(4000, h)) : 0;
      if (Number(r.appHeight) !== d.appHeight) notes.push(`appHeight set to ${d.appHeight} (0, or 600 to 4000)`);
    }
    const known = new Set(['_about', 'format', 'savedAt', 'keys', 'provider', 'models', 'helperModels', 'search', 'maxSearches', 'searchFocus', 'theme', 'appHeight']);
    Object.keys(r).filter((k) => !known.has(k)).forEach((k) => notes.push(`unknown setting "${k}" removed`));
    return { data: d, notes };
  },

  /** The text written to disk. Keys first, so they are easy to find and edit. */
  serialize(data = this.data) {
    return `${JSON.stringify({
      _about: 'Evaluator settings. The app reads this file every time it opens. It holds your API keys: keep it private.',
      format: SETTINGS_FORMAT,
      savedAt: new Date().toISOString(),
      ...data,
    }, null, 2)}\n`;
  },

  parse(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (err) { throw new Error(`The settings file isn't valid JSON: ${err.message}`); }
    return this.normalize(raw);
  },

  /* ---------- Reading ---------- */
  async init() {
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* best effort */ }
    try {
      const root = await navigator.storage.getDirectory();
      this.appDir = await root.getDirectoryHandle(SETTINGS_DIR, { create: true });
    } catch { this.appDir = null; }

    // 1. The app folder's copy (or the browser copy when there's no file storage).
    let data = null;
    let found = false;
    let text = null;
    try {
      text = this.appDir ? await readTextFile(this.appDir, SETTINGS_FILE) : local.get(BROWSER_COPY, null);
      if (text) { data = this.parse(text).data; found = true; }
    } catch (err) {
      this.broken = { text: typeof text === 'string' ? text : '', error: err.message };
    }
    this.where = this.appDir ? 'app' : 'browser';

    // 2. A folder the user chose wins: it may have been edited outside the app.
    const handle = await HandleStore.get('settingsFolder');
    if (handle && typeof handle.queryPermission === 'function') {
      this.folder = handle;
      this.folderLabel = (await HandleStore.get('settingsFolderLabel')) || handle.name;
      this.where = 'folder';
      let perm = 'prompt';
      try { perm = await handle.queryPermission({ mode: 'readwrite' }); } catch { /* treat as prompt */ }
      if (perm === 'granted') {
        const fromFolder = await this.readFolder();
        if (fromFolder) { data = fromFolder; found = true; }
      } else {
        this.needsPermission = true;
      }
    }

    // 3. Nothing anywhere yet: start from the defaults, plus anything an earlier version left in this browser.
    if (!data) {
      data = this.normalize(this.migrateFromBrowser()).data;
    }
    this.data = data;
    this.cleanUpBrowser();

    if (this.broken) this.setState('broken', this.broken.error);
    else if (this.needsPermission) this.setState('permission', `The settings folder “${this.folderLabel}” needs your permission again. Using the copy in the app's folder until then.`);
    else this.setState('saved', '');
    if (!found && !this.broken) await this.save();       // creates the file on first run
    else if (found && this.where === 'folder' && !this.needsPermission) this.mirrorToApp();
    return this.data;
  },

  /** Reads the chosen folder's file. Returns the settings, or null if absent/broken (this.broken is set). */
  async readFolder() {
    let text = null;
    try {
      text = await readTextFile(this.folder, SETTINGS_FILE);
    } catch (err) {
      this.setState('error', `Couldn't read the settings folder “${this.folderLabel}”: ${err.message}`);
      return null;
    }
    if (text === null) return null;
    try {
      const out = this.parse(text).data;
      this.broken = null;
      return out;
    } catch (err) {
      this.broken = { text, error: err.message };
      return null;
    }
  },

  /** Settings an earlier version of the app kept in this browser (models, search; and keys from the stand-alone v16). */
  migrateFromBrowser() {
    const old = local.get(KEYS.settings, null) || {};
    const out = { ...old };
    delete out.keys; delete out.apiKey;
    if (old.keys && typeof old.keys === 'object') {
      out.keys = {};
      KEY_SLOTS.forEach((k) => { if (typeof old.keys[k] === 'string') out.keys[k] = old.keys[k]; });
    }
    const known = ['keys', 'provider', 'models', 'helperModels', 'search', 'maxSearches', 'searchFocus'];
    Object.keys(out).forEach((k) => { if (!known.includes(k)) delete out[k]; });
    return out;
  },

  /** Settings now live in the file only, so the old browser copy (which may hold keys) is removed. */
  cleanUpBrowser() {
    local.remove(KEYS.settings);
  },

  /* ---------- Writing ---------- */
  setState(state, message) {
    this.state = state;
    this.message = message || '';
    this.emit('status');
  },
  on(fn) { this.listeners.push(fn); },
  emit(kind) { this.listeners.forEach((fn) => { try { fn(kind); } catch (err) { console.error(err); } }); },

  /** Writes the settings now, to every place they belong. Calls are queued so writes never overlap. */
  save() {
    clearTimeout(this.timer);
    this.timer = null;
    const text = this.serialize();
    this.queue = this.queue.then(() => this.write(text)).catch(() => {});
    return this.queue;
  },

  async write(text) {
    this.setState('saving', 'Saving…');
    const problems = [];
    if (this.appDir) {
      try {
        await writeTextFile(this.appDir, SETTINGS_FILE, text, { opfs: true });
        if (this.where !== 'folder') this.broken = null;
      } catch (err) { problems.push(`the app's folder (${err.message})`); }
    } else if (!local.set(BROWSER_COPY, text)) {
      problems.push('this browser (storage is blocked)');
    } else {
      this.broken = null;
    }
    if (this.where === 'folder' && this.folder && !this.needsPermission) {
      if (this.broken) {
        this.setState('broken', `${this.broken.error} Your changes are kept in the app's folder; the file in “${this.folderLabel}” is left as it is until you fix it or press Save to file in the editor.`);
        return;
      }
      try { await writeTextFile(this.folder, SETTINGS_FILE, text); } catch (err) {
        if (err && err.name === 'NotAllowedError') {
          this.needsPermission = true;
          this.setState('permission', `The settings folder “${this.folderLabel}” needs your permission again. Your changes are kept in the app's folder and will be written there when you reconnect.`);
          return;
        }
        problems.push(`“${this.folderLabel}” (${err.message})`);
      }
    }
    if (problems.length) { this.setState('error', `Couldn't save to ${problems.join(' or ')}.`); return; }
    this.lastSavedAt = new Date().toISOString();
    if (this.needsPermission) {
      this.setState('permission', `Saved in the app's folder. The settings folder “${this.folderLabel}” needs your permission again before it can be updated.`);
    } else {
      this.setState('saved', '');
    }
  },

  mirrorToApp() {
    if (!this.appDir) return;
    const text = this.serialize();
    this.queue = this.queue.then(() => writeTextFile(this.appDir, SETTINGS_FILE, text, { opfs: true })).catch(() => {});
  },

  /** Merges a change in and saves it shortly. models and helperModels merge per provider. */
  update(patch) {
    const next = {
      ...this.data, ...patch,
      keys: { ...this.data.keys, ...(patch.keys || {}) },
      models: { ...this.data.models, ...(patch.models || {}) },
      helperModels: { ...this.data.helperModels, ...(patch.helperModels || {}) },
    };
    // Empty model choices are removed rather than stored as "".
    ['models', 'helperModels'].forEach((f) => Object.keys(next[f]).forEach((p) => { if (!next[f][p]) delete next[f][p]; }));
    this.data = this.normalize(next).data;
    this.emit('change'); // a change made in the Settings forms ('data' is for changes from elsewhere)
    clearTimeout(this.timer);
    this.setState('saving', 'Saving…');
    this.timer = setTimeout(() => this.save(), 300);
    return this.data;
  },

  /** Replaces every setting (editor, imported file, reset). Throws with a readable message when invalid. */
  async replace(text, { overwriteBroken = true } = {}) {
    const { data, notes } = this.parse(text);
    this.data = data;
    if (overwriteBroken) this.broken = null;
    this.emit('data');
    await this.save();
    return notes;
  },

  async reset() {
    this.data = this.defaults();
    this.broken = null;
    this.emit('data');
    await this.save();
  },

  /** Reads the file again (after it was edited outside the app). */
  async reload() {
    if (this.where === 'folder' && this.folder) {
      if (this.needsPermission && !(await this.reconnect({ reload: false }))) return false;
      const fromFolder = await this.readFolder();
      if (this.broken) { this.setState('broken', this.broken.error); this.emit('data'); return false; }
      if (fromFolder) { this.data = fromFolder; this.mirrorToApp(); this.emit('data'); this.setState('saved', 'Reloaded from the file.'); return true; }
      await this.save();
      return true;
    }
    try {
      const text = this.appDir ? await readTextFile(this.appDir, SETTINGS_FILE) : local.get(BROWSER_COPY, null);
      if (!text) { await this.save(); return true; }
      this.data = this.parse(text).data;
      this.broken = null;
      this.emit('data');
      this.setState('saved', 'Reloaded from the file.');
      return true;
    } catch (err) {
      this.broken = { text: '', error: err.message };
      this.setState('broken', err.message);
      return false;
    }
  },

  /* ---------- A folder the user picks ---------- */
  canPickFolder() { return typeof window.showDirectoryPicker === 'function'; },

  /** Asks for the folder again (needs a click). Then reads the file there, which may have changed. */
  async reconnect({ reload = true } = {}) {
    if (!this.folder) return false;
    let perm = 'denied';
    try { perm = await this.folder.requestPermission({ mode: 'readwrite' }); } catch { /* denied */ }
    if (perm !== 'granted') {
      this.setState('permission', `Permission for “${this.folderLabel}” wasn't given. The app keeps using the copy in its own folder.`);
      return false;
    }
    this.needsPermission = false;
    if (!reload) return true;
    const fromFolder = await this.readFolder();
    if (this.broken) { this.setState('broken', this.broken.error); this.emit('data'); return true; }
    if (fromFolder) { this.data = fromFolder; this.mirrorToApp(); this.emit('data'); this.setState('saved', 'Reconnected. Settings loaded from the folder.'); }
    else await this.save();
    return true;
  },

  async chooseFolder() {
    const picked = await window.showDirectoryPicker({ id: 'evaluator-settings', mode: 'readwrite', startIn: 'documents' });
    // Picking a folder already called "Evaluator" uses it as is; otherwise one is made inside.
    const dir = picked.name === SETTINGS_DIR ? picked : await picked.getDirectoryHandle(SETTINGS_DIR, { create: true });
    const label = picked.name === SETTINGS_DIR ? picked.name : `${picked.name}/${SETTINGS_DIR}`;
    const existing = await readTextFile(dir, SETTINGS_FILE);
    let useExisting = false;
    if (existing !== null) {
      useExisting = confirm(`“${label}” already has a settings file.\n\nOK: load the settings and keys from that file.\nCancel: replace it with the settings you have now.`);
    }
    this.folder = dir;
    this.folderLabel = label;
    this.where = 'folder';
    this.needsPermission = false;
    this.broken = null;
    await HandleStore.set('settingsFolder', dir);
    await HandleStore.set('settingsFolderLabel', label);
    if (useExisting) {
      try {
        this.data = this.parse(existing).data;
        this.emit('data');
        this.mirrorToApp();
        this.setState('saved', `Now using the settings file in “${label}”.`);
        return;
      } catch (err) {
        this.broken = { text: existing, error: err.message };
        this.emit('data');
        this.setState('broken', err.message);
        return;
      }
    }
    await this.save();
    this.setState('saved', `The settings file is now kept in “${label}”.`);
  },

  /** Stops using the chosen folder. Its file is left there; the app folder's copy is used from now on. */
  async unlinkFolder() {
    await HandleStore.remove('settingsFolder');
    await HandleStore.remove('settingsFolderLabel');
    this.folder = null; this.folderLabel = ''; this.needsPermission = false; this.broken = null;
    this.where = this.appDir ? 'app' : 'browser';
    await this.save();
    this.setState('saved', 'The settings file is now kept in the app\'s own folder.');
  },

  /* ---------- Small helpers for the rest of the app ---------- */
  key(slot) { return (this.data && this.data.keys[slot]) || ''; },
  locationText() {
    if (this.where === 'folder') return `${this.folderLabel}/${SETTINGS_FILE}`;
    if (this.where === 'app') return `app folder › ${SETTINGS_DIR}/${SETTINGS_FILE}`;
    return 'this browser\'s storage (no file storage is available here)';
  },
};
