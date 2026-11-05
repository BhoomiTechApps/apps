// Storage for the "houserent" data folder.
//  - folder mode: a real folder on disk via the File System Access API (Chrome/Edge on desktop & ChromeOS).
//  - device mode: a private "houserent" store inside the browser (phones, Safari, Firefox).
// Both expose the same file-path API: settings.json, properties.json, invoices/<id>.json, pdf/<id>/<name>.pdf

const DB = 'houserent-app', KV = 'kv', FILES = 'files', PREFIX = 'houserent/';
let dbp;
const db = () => dbp ||= new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore(KV); r.result.createObjectStore(FILES); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function op(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const kvGet = k => op(KV, 'readonly', s => s.get(k));
const kvSet = (k, v) => op(KV, 'readwrite', s => s.put(v, k));

const split = p => p.split('/').filter(Boolean);
const notFound = e => ['NotFoundError', 'TypeMismatchError'].includes(e?.name);

const folderFs = {
  root: null,
  async dir(parts, create) { let d = this.root; for (const p of parts) d = await d.getDirectoryHandle(p, { create }); return d; },
  async read(path) {
    try { const parts = split(path), name = parts.pop(); const d = await this.dir(parts, false); return await (await d.getFileHandle(name)).getFile(); }
    catch (e) { if (notFound(e)) return null; throw e; }
  },
  async write(path, blob) {
    const parts = split(path), name = parts.pop();
    const d = await this.dir(parts, true);
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(blob); await w.close();
  },
  async list(dirPath) {
    try { const d = await this.dir(split(dirPath), false); const out = []; for await (const [n, h] of d.entries()) if (h.kind === 'file') out.push(n); return out; }
    catch (e) { if (notFound(e)) return []; throw e; }
  },
  async remove(path) {
    try { const parts = split(path), name = parts.pop(); await (await this.dir(parts, false)).removeEntry(name); } catch (e) { if (!notFound(e)) throw e; }
  }
};

const deviceFs = {
  async read(path) { return (await op(FILES, 'readonly', s => s.get(PREFIX + path))) ?? null; },
  async write(path, blob) { await op(FILES, 'readwrite', s => s.put(blob, PREFIX + path)); },
  async list(dirPath) {
    const pre = PREFIX + split(dirPath).join('/') + '/';
    const keys = await op(FILES, 'readonly', s => s.getAllKeys());
    return keys.filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k => k.slice(pre.length));
  },
  async remove(path) { await op(FILES, 'readwrite', s => s.delete(PREFIX + path)); }
};

export const Store = {
  mode: null,
  folderName: '',
  savedName: '',
  fsaSupported: typeof window.showDirectoryPicker === 'function',
  _pending: null,
  b: null,

  // Returns 'ready' | 'needs-permission' | 'needs-setup'
  async init() {
    const mode = await kvGet('mode').catch(() => null);
    if (mode === 'device') { this._device(); return 'ready'; }
    if (mode === 'folder' && this.fsaSupported) {
      const h = await kvGet('root').catch(() => null);
      if (h) {
        this.savedName = (await kvGet('rootLabel')) || h.name;
        this._pending = h;
        if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') { this._folder(h); return 'ready'; }
        return 'needs-permission';
      }
    }
    return 'needs-setup';
  },
  async reconnect() {
    const h = this._pending;
    if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Folder permission was not granted.');
    this._folder(h);
  },
  async pickFolder() {
    const picked = await window.showDirectoryPicker({ id: 'houserent', mode: 'readwrite', startIn: 'documents' });
    const isIt = picked.name.toLowerCase() === 'houserent';
    const root = isIt ? picked : await picked.getDirectoryHandle('houserent', { create: true });
    this.savedName = isIt ? picked.name : `${picked.name}/houserent`;
    await kvSet('root', root); await kvSet('rootLabel', this.savedName); await kvSet('mode', 'folder');
    this._folder(root);
  },
  async useDevice() {
    await kvSet('mode', 'device');
    navigator.storage?.persist?.().catch(() => {});
    this._device();
  },
  _folder(h) { folderFs.root = h; this.b = folderFs; this.mode = 'folder'; this.folderName = this.savedName || h.name; },
  _device() { this.b = deviceFs; this.mode = 'device'; this.folderName = 'houserent (on this device)'; },
  label() { return this.mode === 'folder' ? this.folderName : 'houserent · on this device'; },

  async readText(p) { const f = await this.b.read(p); return f ? await f.text() : null; },
  async readJSON(p, fallback = null) {
    const t = await this.readText(p);
    if (t == null || !t.trim()) return fallback;
    try { return JSON.parse(t); } catch (e) { throw new Error(`${p} is not valid JSON (${e.message})`); }
  },
  writeJSON(p, o) { return this.b.write(p, new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' })); },
  writeBlob(p, blob) { return this.b.write(p, blob); },
  readBlob(p) { return this.b.read(p); },
  list(d) { return this.b.list(d); },
  remove(p) { return this.b.remove(p); },
  async exists(p) { return (await this.b.read(p)) != null; }
};
