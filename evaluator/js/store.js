/* Evaluator: store.js
 *
 * Trusted sources, topics and local folders. SourceStore keeps sources
 * and topics in localStorage; LibraryStore keeps local folders (their text
 * lives in IndexedDB via lib/local.js). To move to a server or WordPress,
 * replace these two objects with versions that call your API.
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
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Enter a domain, such as britannica.com.');
  const d = raw.trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[?#]/)[0]
    .replace(/\/+$/, '');
  const host = d.split('/')[0];
  const ok = /^[a-z0-9.-]+$/.test(host) && host.includes('.') && !host.startsWith('.') && !host.endsWith('.') && !host.includes('..');
  if (!ok) throw new Error(`"${raw}" isn't a valid domain. Use a form like britannica.com or archive.org/details.`);
  if (/^\d+(\.\d+){3}$/.test(host)) throw new Error('IP addresses can\'t be trusted sources. Use the site\'s domain name.');
  if (d.length > 255) throw new Error('Domains must be 255 characters or fewer.');
  return d;
}

const cleanText = (v, max, fb) => (v === undefined || v === null ? fb : String(v).trim().slice(0, max));

function buildSource(input, existing, topicIds) {
  const now = new Date().toISOString();
  const domain = input.domain !== undefined ? normalizeDomain(input.domain) : existing.domain;
  const category = input.category !== undefined ? String(input.category) : (existing ? existing.category : 'other');
  if (!CATEGORIES.includes(category)) throw new Error(`Type must be one of: ${CATEGORIES.join(', ')}.`);
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
  if (!name) throw new Error('Give the topic a name.');
  return {
    id: existing ? existing.id : (typeof input.id === 'string' && /^[\w-]{2,64}$/.test(input.id) ? input.id : `t-${uid()}`),
    name,
    description: cleanText(input.description, 200, existing ? existing.description : ''),
  };
}

const SourceStore = {
  list: [],
  topics: [],
  async init() {
    const saved = local.get(KEYS.sources, null);
    if (saved && Array.isArray(saved.sources)) {
      this.topics = Array.isArray(saved.topics) ? saved.topics : [];
      this.list = saved.sources.map((s) => ({ ...s, topics: Array.isArray(s.topics) ? s.topics : [] }));
      if (!(saved.version >= 3)) await this.upgradeDefaults(saved.version || 1);
      return;
    }
    await this.restoreDefaults();
  },
  async restoreDefaults() {
    try {
      const res = await fetch('trusted-sources.json', { cache: 'no-cache' });
      this.replaceAll(await res.json());
    } catch {
      this.list = []; this.topics = [];
      this.save();
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
      const res = await fetch('trusted-sources.json', { cache: 'no-cache' });
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
  save() {
    if (!local.set(KEYS.sources, { version: 3, topics: this.topics, sources: this.list })) {
      throw new Error('This browser blocked saving. Check that site storage is allowed.');
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
    if (this.list.some((x) => x.domain === s.domain)) throw new Error(`${s.domain} is already in your trusted sources.`);
    this.list.push(s); this.save(); return s;
  },
  update(id, patch) {
    const i = this.list.findIndex((x) => x.id === id);
    if (i === -1) throw new Error('That source no longer exists.');
    const s = buildSource(patch, this.list[i], this.topicIds());
    if (this.list.some((x) => x.id !== id && x.domain === s.domain)) throw new Error(`${s.domain} is already in your trusted sources.`);
    this.list[i] = s; this.save(); return s;
  },
  remove(id) { this.list = this.list.filter((x) => x.id !== id); this.save(); },

  addTopic(input, sourceIds = []) {
    const t = buildTopic(input);
    const clash = this.topics.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    if (clash) throw new Error(`There's already a topic called "${clash.name}".`);
    this.topics.push(t);
    this.setTopicSources(t.id, sourceIds);
    return t;
  },
  updateTopic(id, patch, sourceIds) {
    const i = this.topics.findIndex((x) => x.id === id);
    if (i === -1) throw new Error('That topic no longer exists.');
    const t = buildTopic(patch, this.topics[i]);
    const clash = this.topics.find((x) => x.id !== id && x.name.toLowerCase() === t.name.toLowerCase());
    if (clash) throw new Error(`There's already a topic called "${clash.name}".`);
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

  replaceAll(data) {
    const items = Array.isArray(data) ? data : data && data.sources;
    if (!Array.isArray(items)) throw new Error('The file must contain a "sources" array.');
    const topics = [];
    (data && Array.isArray(data.topics) ? data.topics : []).forEach((t, i) => {
      let topic;
      try { topic = buildTopic(t || {}); } catch (err) { throw new Error(`Topic ${i + 1}: ${err.message}`); }
      if (!topics.some((x) => x.id === topic.id || x.name.toLowerCase() === topic.name.toLowerCase())) topics.push(topic);
    });
    const ids = new Set(topics.map((t) => t.id));
    const seen = new Set();
    const next = [];
    items.forEach((item, i) => {
      let s;
      try { s = buildSource(item || {}, null, ids); } catch (err) { throw new Error(`Source ${i + 1}: ${err.message}`); }
      if (!seen.has(s.domain)) { seen.add(s.domain); next.push(s); }
    });
    this.topics = topics; this.list = next; this.save();
  },
  exportData() { return { version: 3, topics: this.topics, sources: this.list }; },
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
