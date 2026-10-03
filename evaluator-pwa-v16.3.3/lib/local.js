/* Local files: folders of PDF, DOCX, TXT and MD files on this device.
 *
 * Text is extracted in the browser, split into passages and stored in
 * IndexedDB ("tracer-local"). Nothing is uploaded: only the passages a trace
 * chooses as evidence are sent to the AI provider, like web excerpts.
 *
 * Stores:
 *   libraries  { id, name, enabled, topics[], files[], passageCount, canRescan, addedAt, updatedAt }
 *   chunks     { id, libraryId, file, loc, text }   (index: libraryId)
 *   handles    { id, handle }   FileSystemDirectoryHandle, for rescanning (Chrome/Edge)
 *   packs      { key, savedAt, pack }   evidence gathered for a statement, reused for a few hours
 */
(function (root) {
  'use strict';

  const DB_NAME = 'tracer-local';
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const CHUNK_CHARS = 1100;
  const SUPPORTED = /\.(pdf|docx|txt|md|markdown)$/i;
  const OLD_WORD = /\.doc$/i;

  /* ---------------- IndexedDB ---------------- */
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('libraries')) d.createObjectStore('libraries', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks', { keyPath: 'id' }).createIndex('libraryId', 'libraryId');
          if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('packs')) d.createObjectStore('packs', { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error('This browser blocked local storage for files. Check that site storage is allowed.'));
      });
    }
    return dbPromise;
  }
  function tx(stores, mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      let result;
      Promise.resolve(fn(t)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error || new Error('Storage error.'));
      t.onabort = () => reject(t.error || new Error('Storage was interrupted. The device may be low on space.'));
    }));
  }
  const reqP = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

  const store = {
    allLibraries: () => tx(['libraries'], 'readonly', (t) => reqP(t.objectStore('libraries').getAll())),
    putLibrary: (lib) => tx(['libraries'], 'readwrite', (t) => { t.objectStore('libraries').put(lib); }),
    putHandle: (id, handle) => tx(['handles'], 'readwrite', (t) => { t.objectStore('handles').put({ id, handle }); }),
    getHandle: (id) => tx(['handles'], 'readonly', (t) => reqP(t.objectStore('handles').get(id))).then((r) => (r ? r.handle : null)),
    chunksFor: (libraryId) => tx(['chunks'], 'readonly', (t) => reqP(t.objectStore('chunks').index('libraryId').getAll(libraryId))),
    async replaceChunks(libraryId, chunks) {
      await this.deleteChunks(libraryId);
      for (let i = 0; i < chunks.length; i += 500) {
        const part = chunks.slice(i, i + 500);
        await tx(['chunks'], 'readwrite', (t) => { const os = t.objectStore('chunks'); part.forEach((c) => os.put(c)); });
      }
    },
    deleteChunks: (libraryId) => tx(['chunks'], 'readwrite', (t) => new Promise((resolve) => {
      const req = t.objectStore('chunks').index('libraryId').openKeyCursor(IDBKeyRange.only(libraryId));
      req.onsuccess = () => { const c = req.result; if (c) { t.objectStore('chunks').delete(c.primaryKey); c.continue(); } else resolve(); };
    })),
    getPack: (key) => tx(['packs'], 'readonly', (t) => reqP(t.objectStore('packs').get(key))),
    /** Saves a pack and prunes old ones: keeps the newest 30 saved within `maxAgeMs`. */
    putPack: (key, pack, maxAgeMs) => tx(['packs'], 'readwrite', (t) => new Promise((resolve) => {
      const os = t.objectStore('packs');
      os.put({ key, savedAt: Date.now(), pack });
      const req = os.getAll();
      req.onsuccess = () => {
        const rows = req.result.sort((a, b) => b.savedAt - a.savedAt);
        rows.forEach((r, i) => { if (i >= 30 || Date.now() - r.savedAt > maxAgeMs) os.delete(r.key); });
        resolve();
      };
    })),
    clearPacks: () => tx(['packs'], 'readwrite', (t) => { t.objectStore('packs').clear(); }),
    async removeLibrary(id) {
      forget(id);
      await this.deleteChunks(id);
      await tx(['libraries', 'handles'], 'readwrite', (t) => { t.objectStore('libraries').delete(id); t.objectStore('handles').delete(id); });
    },
  };

  /* ---------------- Vendor libraries (loaded only when needed) ---------------- */
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve;
        s.onerror = () => reject(new Error(`Couldn't load ${src}. Check your connection and try again.`));
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }
  // In WordPress the bundled readers live in the plugin folder, not next to the page.
  const vendorUrl = (file) => `${(root.EVALUATOR && root.EVALUATOR.assetBase) || ''}vendor/${file}`;
  async function pdfjs() {
    await loadScript(vendorUrl('pdf.min.js'));
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = vendorUrl('pdf.worker.min.js');
    return root.pdfjsLib;
  }
  async function mammoth() { await loadScript(vendorUrl('mammoth.browser.min.js')); return root.mammoth; }

  /* ---------------- Text extraction ---------------- */
  const clean = (s) => String(s).replace(/\u0000/g, '').replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  /** Splits text into passages of about CHUNK_CHARS, preferring paragraph and sentence breaks. */
  function chunkText(text, max = CHUNK_CHARS) {
    const out = [];
    const paras = clean(text).split(/\n{2,}|\n(?=[A-Z0-9•\-–])/);
    let buf = '';
    const push = () => { const t = buf.trim(); if (t.length >= 40) out.push(t); buf = ''; };
    for (const p of paras) {
      if (p.length > max) {
        push();
        const sentences = p.match(/[^.!?]+(?:[.!?]+["')\]]*\s*|$)/g) || [p];
        for (const s of sentences) {
          if ((buf + s).length > max && buf) push();
          if (s.length > max) { for (let i = 0; i < s.length; i += max) { buf = s.slice(i, i + max); push(); } }
          else buf += s;
        }
        push();
      } else {
        if ((buf + '\n' + p).length > max && buf) push();
        buf += (buf ? '\n' : '') + p;
      }
    }
    push();
    return out;
  }

  /** Returns [{ loc, text }] passages for one file, or throws with a user-facing reason. */
  async function extract(file) {
    const name = file.name;
    if (file.size > MAX_FILE_BYTES) throw new Error('larger than 50 MB, skipped');
    if (/\.pdf$/i.test(name)) {
      const lib = await pdfjs();
      const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
      const passages = [];
      let chars = 0;
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const text = content.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join('');
        chars += text.trim().length;
        chunkText(text).forEach((t, i, all) => passages.push({ loc: all.length > 1 ? `page ${p}, part ${i + 1}` : `page ${p}`, text: t }));
        page.cleanup();
      }
      await doc.destroy();
      if (chars < 30 * Math.max(1, doc.numPages) && !passages.length) throw new Error('no text found; it may be a scanned PDF');
      return passages;
    }
    if (/\.docx$/i.test(name)) {
      const m = await mammoth();
      const r = await m.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return chunkText(r.value).map((t, i) => ({ loc: `section ${i + 1}`, text: t }));
    }
    if (/\.(txt|md|markdown)$/i.test(name)) {
      return chunkText(await file.text()).map((t, i) => ({ loc: `section ${i + 1}`, text: t }));
    }
    throw new Error('unsupported type');
  }

  /* ---------------- Folders ---------------- */
  async function walkDirectory(dirHandle, prefix = '') {
    const files = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (name.startsWith('.')) continue;
      if (handle.kind === 'directory') files.push(...await walkDirectory(handle, `${prefix}${name}/`));
      else files.push({ path: `${prefix}${name}`, getFile: () => handle.getFile() });
    }
    return files;
  }

  /**
   * Reads files and stores their passages for a library.
   * `entries` is [{ path, getFile() }]. `progress(done, total, path)` reports as it goes.
   */
  async function indexFiles(lib, entries, progress) {
    const files = [];
    const chunks = [];
    let skippedOther = 0;
    const wanted = entries.filter((e) => {
      if (SUPPORTED.test(e.path)) return true;
      if (OLD_WORD.test(e.path)) { files.push({ path: e.path, status: 'unsupported', message: 'old Word format: save it as .docx or PDF', passages: 0 }); return false; }
      skippedOther++;
      return false;
    });
    for (let i = 0; i < wanted.length; i++) {
      const e = wanted[i];
      progress && progress(i + 1, wanted.length, e.path);
      try {
        const file = await e.getFile();
        const passages = await extract(file);
        passages.forEach((p) => chunks.push({ id: `${lib.id}:${chunks.length}`, libraryId: lib.id, file: e.path, loc: p.loc, text: p.text }));
        files.push({ path: e.path, size: file.size, lastModified: file.lastModified, status: passages.length ? 'ok' : 'empty', message: passages.length ? '' : 'no readable text', passages: passages.length });
      } catch (err) {
        files.push({ path: e.path, status: 'error', message: err.message || 'could not be read', passages: 0 });
      }
    }
    await store.replaceChunks(lib.id, chunks);
    files.sort((a, b) => a.path.localeCompare(b.path));
    const updated = { ...lib, files, skippedOther, passageCount: chunks.length, updatedAt: new Date().toISOString() };
    await store.putLibrary(updated);
    return updated;
  }

  const canPickFolder = () => typeof root.showDirectoryPicker === 'function';

  /** Chrome/Edge: pick a folder once; it can be rescanned later without picking again. */
  async function addFolderWithPicker(progress) {
    const handle = await root.showDirectoryPicker({ mode: 'read' });
    const lib = newLibrary(handle.name, true);
    await store.putHandle(lib.id, handle);
    return indexFiles(lib, await walkDirectory(handle), progress);
  }

  /** Other browsers: files from <input type="file" webkitdirectory> or a multi-file picker. */
  async function addFromFileList(fileList, progress, fallbackName) {
    const list = [...fileList];
    if (!list.length) return null;
    const first = list[0].webkitRelativePath || '';
    const name = first.includes('/') ? first.split('/')[0] : (fallbackName || 'Selected files');
    const lib = newLibrary(name, false);
    const entries = list.map((f) => ({
      path: f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name,
      getFile: async () => f,
    }));
    return indexFiles(lib, entries, progress);
  }

  async function rescan(lib, progress) {
    const handle = await store.getHandle(lib.id);
    if (!handle) throw new Error('This folder was added by selecting files, so it can\'t be rescanned. Remove it and add it again.');
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') throw new Error('Permission to read the folder was not given.');
    return indexFiles(lib, await walkDirectory(handle), progress);
  }

  function newLibrary(name, canRescan) {
    const now = new Date().toISOString();
    const id = `lib-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return { id, name: String(name || 'Local folder').slice(0, 80), enabled: true, topics: [], files: [], passageCount: 0, canRescan, addedAt: now, updatedAt: now };
  }

  /* ---------------- Search (BM25) ---------------- */
  const STOP = new Set(('a an and are as at be been but by for from had has have he her his how i if in into is it its of on or '
    + 'our she so than that the their them then there these they this those to was we were what when where which who whom why '
    + 'will with would you your not no do does did can could should may might also about after before between during over under '
    + 'more most such only other some any each very').split(' '));

  function tokens(text) {
    return String(text).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .split(/[^\p{L}\p{N}]+/u).filter((w) => w && (w.length > 1 || /\d/.test(w)) && !STOP.has(w));
  }

  function toDoc(c) {
    const toks = tokens(`${c.file} ${c.text}`);
    const tf = new Map();
    toks.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    return { c, tf, len: toks.length };
  }

  /** Ranks passages against several queries; returns the best `limit` distinct passages with a `score`. */
  function rank(chunksOrDocs, queries, limit = 8, perQuery = 3) {
    if (!chunksOrDocs.length) return [];
    const docs = chunksOrDocs[0].tf ? chunksOrDocs : chunksOrDocs.map(toDoc);
    const N = docs.length;
    const avg = docs.reduce((s, d) => s + d.len, 0) / N || 1;
    const df = new Map();
    docs.forEach((d) => d.tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
    const k1 = 1.2, b = 0.75;
    const picked = new Map();
    const total = new Map();
    for (const q of queries) {
      const qt = [...new Set(tokens(q))];
      if (!qt.length) continue;
      const scored = docs.map((d) => {
        let s = 0;
        for (const t of qt) {
          const f = d.tf.get(t);
          if (!f) continue;
          const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
          s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg));
        }
        return { d, s };
      }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
      scored.forEach((x) => total.set(x.d.c.id, (total.get(x.d.c.id) || 0) + x.s));
      scored.slice(0, perQuery).forEach((x) => picked.set(x.d.c.id, x.d.c));
    }
    return [...picked.values()].sort((a, b2) => (total.get(b2.id) || 0) - (total.get(a.id) || 0)).slice(0, limit)
      .map((c) => ({ ...c, score: total.get(c.id) || 0 }));
  }

  /* Tokenised passages are kept in memory per folder, so repeat searches skip
     reading and re-tokenising everything. A rescan changes updatedAt, which
     invalidates that folder's entry. */
  const indexCache = new Map();
  function forget(libraryId) { indexCache.delete(libraryId); }

  async function docsFor(lib) {
    const hit = indexCache.get(lib.id);
    if (hit && hit.updatedAt === lib.updatedAt) return hit.docs;
    const docs = (await store.chunksFor(lib.id)).map(toDoc);
    indexCache.set(lib.id, { updatedAt: lib.updatedAt, docs });
    return docs;
  }

  async function search(libraries, queries, limit = 8) {
    const all = (await Promise.all(libraries.map(docsFor))).flat();
    return rank(all, queries, limit);
  }

  const api = { store, canPickFolder, addFolderWithPicker, addFromFileList, rescan, search, rank, chunkText, tokens, forget };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TracerLocal = api;
})(typeof window !== 'undefined' ? window : globalThis);
