/* Evaluator: store.js
 *
 * Trusted sources, topics and local folders.
 *
 * SourceStore holds the trusted websites, topics and the mapping between
 * them, saved on this device (localStorage). Export JSON keeps a copy.
 *
 * LibraryStore keeps local folders; their text lives in IndexedDB on the
 * device (lib/local.js), because the files themselves are on the device.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/* =====================================================================
 * Sources, topics and the store
 *
 * Saved as { version: 2, topics: [...], sources: [...] }.
 * A topic is { id, name, description }. A source lists the topic ids it
 * belongs to in `topics`, so one site can serve several topics.
 * ===================================================================== */
function normalizeDomain(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(tr('Enter a domain, such as britannica.com.'));
  const d = raw.trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[?#]/)[0]
    .replace(/\/+$/, '');
  const host = d.split('/')[0];
  const ok = /^[a-z0-9.-]+$/.test(host) && host.includes('.') && !host.startsWith('.') && !host.endsWith('.') && !host.includes('..');
  if (!ok) throw new Error(tr('"{raw}" isn\'t a valid domain. Use a form like britannica.com or archive.org/details.', { raw }));
  if (/^\d+(\.\d+){3}$/.test(host)) throw new Error(tr('IP addresses can\'t be trusted sources. Use the site\'s domain name.'));
  if (d.length > 255) throw new Error(tr('Domains must be 255 characters or fewer.'));
  return d;
}

const cleanText = (v, max, fb) => (v === undefined || v === null ? fb : String(v).trim().slice(0, max));

function buildSource(input, existing, topicIds) {
  const now = new Date().toISOString();
  const domain = input.domain !== undefined ? normalizeDomain(input.domain) : existing.domain;
  const category = input.category !== undefined ? String(input.category) : (existing ? existing.category : 'other');
  if (!CATEGORIES.includes(category)) throw new Error(tr('Type must be one of: {list}.', { list: CATEGORIES.join(', ') }));
  const rawTopics = Array.isArray(input.topics) ? input.topics : (existing ? existing.topics || [] : []);
  return {
    id: existing ? existing.id : (typeof input.id === 'string' && /^[\w-]{4,64}$/.test(input.id) ? input.id : uid()),
    domain,
    label: cleanText(input.label, 120, existing ? existing.label : '') || domain,
    category,
    notes: cleanText(input.notes, 500, existing ? existing.notes : ''),
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : (existing ? existing.enabled : true),
    topics: [...new Set(rawTopics.map(String))].filter((t) => topicIds.has(t)),
    addedAt: existing ? existing.addedAt : (input.addedAt || now),
    updatedAt: now,
  };
}

function buildTopic(input, existing) {
  const name = cleanText(input.name, 60, existing ? existing.name : '');
  if (!name) throw new Error(tr('Give the topic a name.'));
  return {
    id: existing ? existing.id : (typeof input.id === 'string' && /^[\w-]{2,64}$/.test(input.id) ? input.id : `t-${uid()}`),
    name,
    description: cleanText(input.description, 200, existing ? existing.description : ''),
  };
}

/* =====================================================================
 * Where the list is saved
 *
 * The WordPress plugin saved each logged-in user's list in the site's
 * database. This app has no account: the list is saved on this device only.
 * Sync keeps the same shape so the rest of the app needs no special cases.
 * ===================================================================== */
const Sync = { enabled: false, dirty: false, busy: false, state: 'local', snapshots: [], push() {} };

const SourceStore = {
  list: [],
  topics: [],
  /** Puts a stored list in memory (already validated by the server or by replaceAll). */
  load(data) {
    this.topics = (Array.isArray(data.topics) ? data.topics : []).map((t) => ({ id: t.id, name: t.name, description: t.description || '' }));
    this.list = (Array.isArray(data.sources) ? data.sources : []).map((s) => ({ ...s, topics: Array.isArray(s.topics) ? s.topics : [] }));
  },
  async init() {
    let saved = local.get(KEYS.sources, null);
    if (saved && saved.sync) delete saved.sync; // copied from a WordPress account cache: keep the list itself
    if (saved && Array.isArray(saved.sources)) {
      this.topics = Array.isArray(saved.topics) ? saved.topics : [];
      this.list = saved.sources.map((s) => ({ ...s, topics: Array.isArray(s.topics) ? s.topics : [] }));
      if (!(saved.version >= 3)) await this.upgradeDefaults(saved.version || 1);
      return;
    }
    await this.restoreDefaults();
  },
  /** The default list bundled with the app. */
  async fetchDefaults() {
    const res = await fetch(assetUrl('trusted-sources.json'), { cache: 'no-cache' });
    return res.json();
  },
  async restoreDefaults({ quiet = false } = {}) {
    try {
      this.replaceAll(await this.fetchDefaults(), quiet ? null : 'default');
    } catch {
      this.list = []; this.topics = [];
      this.save(quiet ? null : 'default');
    }
  },
  /**
   * Brings older saved lists up to date without removing anything:
   * adds default topics the user doesn't have, maps matching sites to them,
   * and (for lists that already used topics) adds the default sites that
   * belong only to the new topics, such as the "Science and logic" set.
   */
  async upgradeDefaults(fromVersion) {
    try {
      const res = await fetch(assetUrl('trusted-sources.json'), { cache: 'no-cache' });
      const d = await res.json();
      const newIds = new Set();
      // Lists that already had topics only get what this version introduced; older lists get every default topic.
      const offered = fromVersion >= 2 ? (d.topics || []).filter((t) => TOPICS_ADDED_IN_V3.includes(t.id)) : (d.topics || []);
      offered.forEach((t) => {
        if (!this.topics.some((x) => x.id === t.id || x.name.toLowerCase() === String(t.name).toLowerCase())) {
          this.topics.push(buildTopic(t)); newIds.add(t.id);
        }
      });
      const have = new Set(this.list.map((s) => s.domain));
      (d.sources || []).forEach((ds) => {
        const add = (ds.topics || []).filter((t) => newIds.has(t));
        if (!add.length) return;
        const existing = this.list.find((s) => s.domain === ds.domain);
        if (existing) existing.topics = [...new Set([...existing.topics, ...add])];
        else if (fromVersion >= 2 && (ds.topics || []).every((t) => newIds.has(t)) && !have.has(ds.domain)) {
          this.list.push(buildSource({ ...ds, id: undefined }, null, this.topicIds()));
        }
      });
    } catch { /* offline: carry on; the upgrade runs again next time */ return; }
    this.save();
  },
  /** Saves after every change, on this device. (`reason` is kept for the same calls as the WordPress version.) */
  save(reason = 'edit') { // eslint-disable-line no-unused-vars
    if (!local.set(KEYS.sources, { version: 3, topics: this.topics, sources: this.list })) {
      throw new Error(tr('This browser blocked saving. Check that site storage is allowed (private windows often block it).'));
    }
  },
  topicIds() { return new Set(this.topics.map((t) => t.id)); },
  topic(id) { return this.topics.find((t) => t.id === id) || null; },
  enabled() { return this.list.filter((s) => s.enabled); },
  /** Sources a trace may search: switched on, and in the topic when one is chosen. */
  forTopic(topicId) {
    const on = this.enabled();
    return topicId && this.topic(topicId) ? on.filter((s) => s.topics.includes(topicId)) : on;
  },
  inTopic(topicId) { return this.list.filter((s) => s.topics.includes(topicId)); },

  add(input) {
    const s = buildSource(input, null, this.topicIds());
    if (this.list.some((x) => x.domain === s.domain)) throw new Error(tr('{domain} is already in your trusted sources.', { domain: s.domain }));
    this.list.push(s); this.save(); return s;
  },
  update(id, patch) {
    const i = this.list.findIndex((x) => x.id === id);
    if (i === -1) throw new Error(tr('That source no longer exists.'));
    const s = buildSource(patch, this.list[i], this.topicIds());
    if (this.list.some((x) => x.id !== id && x.domain === s.domain)) throw new Error(tr('{domain} is already in your trusted sources.', { domain: s.domain }));
    this.list[i] = s; this.save(); return s;
  },
  remove(id) { this.list = this.list.filter((x) => x.id !== id); this.save(); },

  addTopic(input, sourceIds = []) {
    const t = buildTopic(input);
    const clash = this.topics.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    if (clash) throw new Error(tr('There\'s already a topic called "{name}".', { name: clash.name }));
    this.topics.push(t);
    this.setTopicSources(t.id, sourceIds);
    return t;
  },
  updateTopic(id, patch, sourceIds) {
    const i = this.topics.findIndex((x) => x.id === id);
    if (i === -1) throw new Error(tr('That topic no longer exists.'));
    const t = buildTopic(patch, this.topics[i]);
    const clash = this.topics.find((x) => x.id !== id && x.name.toLowerCase() === t.name.toLowerCase());
    if (clash) throw new Error(tr('There\'s already a topic called "{name}".', { name: clash.name }));
    this.topics[i] = t;
    if (sourceIds) this.setTopicSources(id, sourceIds); else this.save();
    return t;
  },
  removeTopic(id) {
    this.topics = this.topics.filter((t) => t.id !== id);
    this.list = this.list.map((s) => ({ ...s, topics: s.topics.filter((t) => t !== id) }));
    this.save();
  },
  /** Maps exactly these sources to the topic (and unmaps the rest). */
  setTopicSources(topicId, sourceIds) {
    const want = new Set(sourceIds);
    this.list = this.list.map((s) => {
      const has = s.topics.includes(topicId);
      if (want.has(s.id) && !has) return { ...s, topics: [...s.topics, topicId] };
      if (!want.has(s.id) && has) return { ...s, topics: s.topics.filter((t) => t !== topicId) };
      return s;
    });
    this.save();
  },

  replaceAll(data, reason = 'import') {
    const items = Array.isArray(data) ? data : data && data.sources;
    if (!Array.isArray(items)) throw new Error(tr('The file must contain a "sources" array.'));
    const topics = [];
    (data && Array.isArray(data.topics) ? data.topics : []).forEach((t, i) => {
      let topic;
      try { topic = buildTopic(t || {}); } catch (err) { throw new Error(tr('Topic {n}: {message}', { n: i + 1, message: err.message })); }
      if (!topics.some((x) => x.id === topic.id || x.name.toLowerCase() === topic.name.toLowerCase())) topics.push(topic);
    });
    const ids = new Set(topics.map((t) => t.id));
    const seen = new Set();
    const next = [];
    items.forEach((item, i) => {
      let s;
      try { s = buildSource(item || {}, null, ids); } catch (err) { throw new Error(tr('Source {n}: {message}', { n: i + 1, message: err.message })); }
      if (!seen.has(s.domain)) { seen.add(s.domain); next.push(s); }
    });
    this.topics = topics; this.list = next; this.save(reason);
  },
  exportData() { return { version: 3, topics: this.topics, sources: this.list }; },

  /* ---------- Starter packs (packs.json) ---------- */
  /** The topic a pack uses: its own id, or an existing topic with the same name. */
  packTopic(pack) {
    return this.topics.find((t) => t.id === pack.topic.id || t.name.toLowerCase() === String(pack.topic.name).toLowerCase()) || null;
  },
  /** 'none' | 'partial' | 'added': whether every site in the pack is mapped to its topic. */
  packState(pack) {
    const topic = this.packTopic(pack);
    if (!topic) return 'none';
    const mapped = pack.sources.filter((ps) => {
      let d; try { d = normalizeDomain(ps.domain); } catch { return true; }
      const s = this.list.find((x) => x.domain === d);
      return s && s.topics.includes(topic.id);
    }).length;
    return mapped === pack.sources.length ? 'added' : 'partial';
  },
  /**
   * Adds a pack: creates its topic (or reuses one with the same name), adds
   * the sites you don't have, and maps the ones you do. Nothing is removed,
   * and a site you switched off stays off.
   */
  installPack(pack) {
    let topic = this.packTopic(pack);
    if (!topic) { topic = buildTopic(pack.topic); this.topics.push(topic); }
    const ids = this.topicIds();
    let added = 0, linked = 0, off = 0;
    pack.sources.forEach((ps) => {
      const domain = normalizeDomain(ps.domain);
      const i = this.list.findIndex((s) => s.domain === domain);
      if (i === -1) {
        this.list.push(buildSource({ ...ps, id: undefined, enabled: true, topics: [topic.id] }, null, ids));
        added++;
      } else if (!this.list[i].topics.includes(topic.id)) {
        this.list[i] = { ...this.list[i], topics: [...this.list[i].topics, topic.id] };
        linked++;
        if (!this.list[i].enabled) off++;
      }
    });
    this.save('pack');
    return { topic, added, linked, off };
  },
};

const Packs = {
  list: null,
  async load() {
    if (this.list) return this.list;
    const res = await fetch(assetUrl('packs.json'), { cache: 'no-cache' });
    const d = await res.json();
    this.list = Array.isArray(d.packs) ? d.packs : [];
    return this.list;
  },
  get(id) { return (this.list || []).find((p) => p.id === id) || null; },
};

/* =====================================================================
 * Local folders (text lives in IndexedDB via lib/local.js)
 * ===================================================================== */
const LibraryStore = {
  list: [],
  available: true,
  async init() {
    try { this.list = await TracerLocal.store.allLibraries(); } catch { this.list = []; this.available = false; }
    this.list.forEach((l) => { l.topics = Array.isArray(l.topics) ? l.topics : []; });
    this.list.sort((a, b) => a.name.localeCompare(b.name));
  },
  get(id) { return this.list.find((l) => l.id === id) || null; },
  enabled() { return this.list.filter((l) => l.enabled); },
  forTopic(topicId) {
    const on = this.enabled();
    return topicId && SourceStore.topic(topicId) ? on.filter((l) => l.topics.includes(topicId)) : on;
  },
  inTopic(topicId) { return this.list.filter((l) => l.topics.includes(topicId)); },
  async put(lib) {
    lib.topics = (lib.topics || []).filter((t) => SourceStore.topic(t));
    await TracerLocal.store.putLibrary(lib);
    const i = this.list.findIndex((l) => l.id === lib.id);
    if (i === -1) this.list.push(lib); else this.list[i] = lib;
    this.list.sort((a, b) => a.name.localeCompare(b.name));
    return lib;
  },
  update(id, patch) { const l = this.get(id); return l ? this.put({ ...l, ...patch, updatedAt: new Date().toISOString() }) : null; },
  async remove(id) { await TracerLocal.store.removeLibrary(id); this.list = this.list.filter((l) => l.id !== id); },
  async setTopicLibraries(topicId, ids) {
    const want = new Set(ids);
    for (const l of [...this.list]) {
      const has = l.topics.includes(topicId);
      if (want.has(l.id) && !has) await this.put({ ...l, topics: [...l.topics, topicId] });
      else if (!want.has(l.id) && has) await this.put({ ...l, topics: l.topics.filter((t) => t !== topicId) });
    }
  },
  async removeTopic(topicId) { await this.setTopicLibraries(topicId, []); },
};
