/* History Tracer: static PWA. Everything runs in the browser.
 *
 * Storage (this browser only):
 *   tracer.sources.v1   topics + trusted sources (same JSON shape as trusted-sources.json)
 *   tracer.settings.v1  { provider, keys: {provider: key}, models, search, maxSearches }
 *   tracer.history.v1   last 20 traces
 *
 * To move sources to a server or WordPress later, replace the SourceStore
 * object below with one that calls your API; the rest of the app is unchanged.
 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const KEYS = { sources: 'tracer.sources.v1', settings: 'tracer.settings.v1', history: 'tracer.history.v1', modelLists: 'tracer.modellists.v1', topic: 'tracer.topic.v1', accordions: 'tracer.accordions.v1' };
  const MAX_ALLOWED_DOMAINS = 64;
  const CATEGORIES = ['primary', 'academic', 'reference', 'archive', 'journalism', 'other'];
  const CATEGORY_NAMES = {
    primary: 'Primary sources', academic: 'Academic journal', reference: 'Reference work',
    archive: 'Archive or library', journalism: 'Journalism', other: 'Other',
  };
  const VERDICT_TEXT = {
    strong: 'Strong evidence', moderate: 'Moderate evidence',
    weak: 'Weak evidence', insufficient: 'Not enough evidence',
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  const local = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

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
        if (saved.version !== 2) await this.adoptDefaultTopics();
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
    /** For lists saved before topics existed: add the default topics and map matching sites. */
    async adoptDefaultTopics() {
      try {
        const res = await fetch('trusted-sources.json', { cache: 'no-cache' });
        const d = await res.json();
        (d.topics || []).forEach((t) => { if (!this.topics.some((x) => x.id === t.id)) this.topics.push(buildTopic(t)); });
        const byDomain = new Map((d.sources || []).map((s) => [s.domain, s.topics || []]));
        this.list = this.list.map((s) => (byDomain.has(s.domain) && !s.topics.length ? { ...s, topics: byDomain.get(s.domain) } : s));
      } catch { /* offline: carry on without default topics */ }
      this.save();
    },
    save() {
      if (!local.set(KEYS.sources, { version: 2, topics: this.topics, sources: this.list })) {
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
    exportData() { return { version: 2, topics: this.topics, sources: this.list }; },
  };

  /* =====================================================================
   * Providers
   *
   * A trace has two parts:
   *   search  - finds pages, restricted to the trusted domains
   *   model   - reads those pages and builds the argument
   * "builtin" search uses the model's own restricted web search (Claude, OpenAI).
   * "tavily" search works with every model.
   * ===================================================================== */
  const PROVIDERS = {
    gemini: {
      name: 'Google Gemini', cost: 'free tier', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza...',
      defaultModel: 'gemini-2.5-flash', builtinSearch: false,
    },
    groq: {
      name: 'Groq', cost: 'free tier', keyUrl: 'https://console.groq.com/keys', keyHint: 'gsk_...',
      defaultModel: 'openai/gpt-oss-120b', builtinSearch: false,
      chatUrl: 'https://api.groq.com/openai/v1/chat/completions', modelsUrl: 'https://api.groq.com/openai/v1/models', jsonMode: true,
    },
    openrouter: {
      name: 'OpenRouter', cost: 'free models', keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-...',
      defaultModel: '', builtinSearch: false,
      chatUrl: 'https://openrouter.ai/api/v1/chat/completions', modelsUrl: 'https://openrouter.ai/api/v1/models', jsonMode: false,
    },
    mistral: {
      name: 'Mistral', cost: 'free tier', keyUrl: 'https://console.mistral.ai/api-keys', keyHint: '',
      defaultModel: 'mistral-small-latest', builtinSearch: false,
      chatUrl: 'https://api.mistral.ai/v1/chat/completions', modelsUrl: 'https://api.mistral.ai/v1/models', jsonMode: true,
    },
    openai: {
      name: 'OpenAI (ChatGPT)', cost: 'paid', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-...',
      defaultModel: 'gpt-5-mini', builtinSearch: true,
      chatUrl: 'https://api.openai.com/v1/chat/completions', modelsUrl: 'https://api.openai.com/v1/models', jsonMode: true,
    },
    anthropic: {
      name: 'Anthropic Claude', cost: 'paid', keyUrl: 'https://platform.claude.com', keyHint: 'sk-ant-...',
      defaultModel: 'claude-sonnet-5', builtinSearch: true,
    },
  };
  const BUILTIN_DOMAIN_LIMIT = { anthropic: 64, openai: 100 };

  class ProviderError extends Error {}

  function explainHttp(providerName, status, data) {
    const detail = (data && (data.error && (data.error.message || data.error)) || data.message || data.detail) || '';
    const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
    if (status === 401 || status === 403) return `${providerName} rejected the API key. Check it in Settings.${text ? ` (${text})` : ''}`;
    if (status === 429) return `${providerName} says you've hit a rate or usage limit. Wait a little, or switch to another provider in Settings.${text ? ` (${text})` : ''}`;
    return `${providerName} returned an error (${status})${text ? `: ${text}` : '.'}`;
  }

  async function postJson(providerName, url, headers, body, signal) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new ProviderError(`The browser couldn't reach ${providerName}. Check your connection. If it keeps happening, ${providerName} may not accept requests straight from a browser; try another provider.`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(explainHttp(providerName, res.status, data));
    return data;
  }

  async function getJson(providerName, url, headers) {
    let res;
    try { res = await fetch(url, { headers }); } catch { throw new ProviderError(`The browser couldn't reach ${providerName}.`); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(explainHttp(providerName, res.status, data));
    return data;
  }

  const anthropicHeaders = (key) => ({
    'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
  });

  /** One plain model call: system + user in, text out. */
  async function chat({ provider, key, model, system, user, json, signal }) {
    const p = PROVIDERS[provider];
    if (provider === 'anthropic') {
      const data = await postJson(p.name, 'https://api.anthropic.com/v1/messages', anthropicHeaders(key),
        { model, max_tokens: 8000, system, messages: [{ role: 'user', content: user }] }, signal);
      return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    }
    if (provider === 'gemini') {
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: json ? { responseMimeType: 'application/json' } : {},
      };
      const data = await postJson(p.name, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': key }, body, signal);
      const cand = data.candidates && data.candidates[0];
      if (!cand || !cand.content) throw new ProviderError(`Gemini returned no answer${cand && cand.finishReason ? ` (${cand.finishReason})` : ''}. Try again or pick another model.`);
      return cand.content.parts.map((x) => x.text || '').join('');
    }
    // OpenAI-compatible chat completions: OpenAI, Groq, OpenRouter, Mistral
    const headers = { Authorization: `Bearer ${key}` };
    if (provider === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'History Tracer'; }
    const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    if (json && p.jsonMode) body.response_format = { type: 'json_object' };
    const data = await postJson(p.name, p.chatUrl, headers, body, signal);
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg || !msg.content) throw new ProviderError(`${p.name} returned an empty answer. Try again or pick another model.`);
    return Array.isArray(msg.content) ? msg.content.map((x) => x.text || '').join('') : msg.content;
  }

  /** Lists model ids a key can use, for the model picker. */
  async function listModels(provider, key) {
    const p = PROVIDERS[provider];
    if (provider === 'anthropic') {
      const d = await getJson(p.name, 'https://api.anthropic.com/v1/models?limit=100', anthropicHeaders(key));
      return d.data.map((m) => m.id);
    }
    if (provider === 'gemini') {
      const d = await getJson(p.name, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': key });
      return (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, '')).filter((id) => /gemini/.test(id));
    }
    const d = await getJson(p.name, p.modelsUrl, key ? { Authorization: `Bearer ${key}` } : {});
    let ids = (d.data || []).map((m) => m.id);
    if (provider === 'openrouter') ids = ids.filter((id) => id.endsWith(':free') || id === 'openrouter/free');
    if (provider === 'openai') ids = ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|image|transcribe|tts|search/.test(id));
    return ids.sort();
  }

  /* =====================================================================
   * Prompts and parsing
   * ===================================================================== */
  const RESULT_SCHEMA = `{
SOURCES_FIELD  "summary": "3-5 sentence overview of the case for the requested side, with source markers",
  "verdict": "strong" | "moderate" | "weak" | "insufficient",
  "verdictReason": "one sentence explaining the verdict",
  "claims": ["the underlying claims you tested"],
  "arguments": [
    {
      "point": "one-sentence premise",
      "reasoning": "2-4 sentences connecting the evidence to the premise, with source markers",
      "evidence": [ { "source": "S1", "excerpt": "paraphrase of what the source says", "sourceType": "primary" | "secondary" | "unknown" } ]
    }
  ],
  "counterConsiderations": ["strongest points on the other side found in the sources, with source markers"],
  "gaps": "what the sources did not cover"
}`;

  const SHARED_RULES = `- Source markers: in "summary", "reasoning" and "counterConsiderations", put a marker such as [S2] or [S1, S4] straight after every sentence that draws on a source. Leave sentences that are only your own connecting reasoning unmarked. Never mark a sentence with a source that doesn't support it.
- Write excerpts as faithful paraphrases. If a direct quotation is essential, keep it under 25 words.
- Be honest about strength. If the sources mostly point the other way, or say little, reflect that in "verdict", "counterConsiderations" and "gaps". Never invent or stretch evidence to fill the requested side.
- Where you can tell, note whether evidence is a primary source or secondary scholarship.

Respond with ONE JSON object and nothing else: no preamble, no markdown fences.`;

  const BUILTIN_SYSTEM = `You are a research assistant for students and scholars.
You build a structured argument either SUPPORTING or CONTESTING a statement, using only evidence you find with your web search tool. The tool is restricted to a curated list of trusted sources chosen by the user.

Rules:
- Search before answering. Break the statement into its underlying claims and run several focused searches (people, places, dates, events, and the scholarly debate around them).
- Give every page you cite an id (S1, S2, ...) and list it in "sources" with the exact URL of a search result you actually retrieved. Never cite from memory.
${SHARED_RULES}
Schema:
${RESULT_SCHEMA.replace('SOURCES_FIELD', '  "sources": [ { "id": "S1", "url": "exact result URL", "title": "page title" } ],\n')}`;

  const SOURCES_SYSTEM = `You are a research assistant for students and scholars.
You build a structured argument either SUPPORTING or CONTESTING a statement, using ONLY the numbered source excerpts provided. They come from a curated list of trusted sources chosen by the user.

Rules:
- Cite sources only by their id, such as "S3". Use only ids that appear in the list.
- Every point must rest on what the excerpts actually say. Do not add facts from your own memory, even if you believe them to be true.
${SHARED_RULES}
Schema:
${RESULT_SCHEMA.replace('SOURCES_FIELD', '')}`;

  const QUERY_SYSTEM = `You plan web searches for a research tool. Reply with only a JSON object of the form {"queries": ["...", "..."]}.`;

  const direction = (stance) => (stance === 'support' ? 'IN SUPPORT OF' : 'CONTESTING');

  function builtinUserPrompt(statement, stance, sources) {
    const list = sources.map((s) => `- ${s.label} (${s.domain}) [${s.category}]`).join('\n');
    return `Statement:\n"""${statement}"""\n\nTask: build the strongest evidence-based case ${direction(stance)} this statement.\n\nTrusted sources you can search:\n${list}`;
  }

  function normaliseUrl(raw) {
    try {
      const u = new URL(raw);
      u.hash = '';
      [...u.searchParams.keys()].forEach((k) => { if (/^utm_|^fbclid$|^gclid$/i.test(k)) u.searchParams.delete(k); });
      return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`;
    } catch { return null; }
  }

  function matchTrustedSource(url, sources) {
    let u;
    try { u = new URL(url); } catch { return null; }
    const host = u.hostname.toLowerCase();
    const full = `${host}${u.pathname}`.replace(/\/+$/, '');
    return [...sources].sort((a, b) => b.domain.length - a.domain.length).find((s) => {
      const [dHost, ...dPath] = s.domain.split('/');
      const bare = dHost.replace(/^www\./, '');
      if (!(host === dHost || host === bare || host.endsWith(`.${bare}`))) return false;
      if (!dPath.length) return true;
      const prefix = `${host}/${dPath.join('/')}`;
      return full === prefix || full.startsWith(`${prefix}/`);
    }) || null;
  }

  function extractJson(text, requiredKey = 'summary') {
    const candidates = [];
    for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
      let depth = 0, inStr = false, escp = false;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inStr) { if (escp) escp = false; else if (c === '\\') escp = true; else if (c === '"') inStr = false; }
        else if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) { candidates.push(text.slice(start, i + 1)); break; }
      }
    }
    for (const c of candidates.sort((a, b) => b.length - a.length)) {
      try { const p = JSON.parse(c); if (p && p[requiredKey] !== undefined) return p; } catch { /* next */ }
    }
    return null;
  }

  const MARKER_RE = /\[\s*(S\d+(?:\s*[,;]\s*S?\d+)*)\s*\]/gi;
  const REF_RE = /\[\^(\d+(?:,\d+)*)\]/g;

  /**
   * Turns the model's JSON into a result.
   * `resolve(id)` returns {url, title} for a page the search really returned, or null.
   * Every cited page gets a number; every trusted site gets a colour. Markers
   * like [S2] in the text become [^n] references; ones that don't resolve to a
   * page on the trusted list are removed, and their text is left unattributed.
   */
  function finalise({ parsed, resolve, statement, stance, sources, meta }) {
    const pages = [];   // { n, url, title, site }
    const sites = [];   // { domain, label, category, color }
    const byId = new Map();
    const byUrl = new Map();
    let droppedEvidence = 0, droppedArguments = 0, droppedMarkers = 0;

    const lookup = (ref) => {
      if (!ref) return null;
      if (typeof ref === 'object') {
        const id = String(ref.source || ref.id || '').trim().replace(/^\[|\]$/g, '').toUpperCase();
        return lookup(id) || (ref.url ? lookupUrl(ref.url) : null);
      }
      let id = String(ref).trim().toUpperCase();
      if (/^\d+$/.test(id)) id = `S${id}`;
      const hit = resolve(id);
      return hit ? { key: normaliseUrl(hit.url), hit } : null;
    };
    const lookupUrl = (url) => {
      const hit = resolve({ url });
      return hit ? { key: normaliseUrl(hit.url), hit } : null;
    };
    const pageNumber = (found) => {
      if (!found) return null;
      const trusted = matchTrustedSource(found.hit.url, sources);
      if (!trusted) return null;
      if (byUrl.has(found.key)) return byUrl.get(found.key);
      let site = sites.findIndex((s) => s.domain === trusted.domain);
      if (site === -1) {
        site = sites.length;
        sites.push({ domain: trusted.domain, label: trusted.label, category: trusted.category, color: site % 8 });
      }
      const n = pages.length + 1;
      pages.push({ n, url: found.hit.url, title: found.hit.title || found.hit.url, site });
      byUrl.set(found.key, n);
      return n;
    };
    const refFor = (ref) => {
      const key = typeof ref === 'string' ? ref.trim().toUpperCase() : null;
      if (key && byId.has(key)) return byId.get(key);
      const n = pageNumber(lookup(ref));
      if (key) byId.set(key, n);
      return n;
    };
    const mark = (text) => String(text || '').replace(MARKER_RE, (m, ids) => {
      const ns = [...new Set(ids.split(/[,;]/).map((x) => refFor(x.trim().replace(/^(\d)/, 'S$1'))).filter(Boolean))];
      if (!ns.length) { droppedMarkers++; return ''; }
      return `[^${ns.join(',')}]`;
    }).replace(/\s+([.,;:])/g, '$1');

    // The summary is numbered first so reference numbers read in order.
    const summary = mark(parsed.summary);

    const args = [];
    (Array.isArray(parsed.arguments) ? parsed.arguments : []).forEach((a) => {
      const usable = (Array.isArray(a.evidence) ? a.evidence : []).filter((ev) => {
        const found = ev && lookup(ev);
        const ok = found && matchTrustedSource(found.hit.url, sources);
        if (!ok) droppedEvidence++;
        return ok;
      });
      if (!usable.length) { droppedArguments++; return; }
      const reasoning = mark(a.reasoning);
      const evidence = usable.map((ev) => {
        const n = pageNumber(lookup(ev));
        return {
          n, excerpt: String(ev.excerpt || ''),
          sourceType: ['primary', 'secondary'].includes(ev.sourceType) ? ev.sourceType : 'unknown',
        };
      });
      args.push({ point: String(a.point || ''), reasoning, evidence });
    });
    const counterConsiderations = (Array.isArray(parsed.counterConsiderations) ? parsed.counterConsiderations : []).map((c) => mark(c));

    const verdicts = ['strong', 'moderate', 'weak', 'insufficient'];
    return {
      version: 2,
      statement, stance, createdAt: new Date().toISOString(),
      summary,
      verdict: args.length ? (verdicts.includes(parsed.verdict) ? parsed.verdict : 'moderate') : 'insufficient',
      verdictReason: String(parsed.verdictReason || ''),
      claims: Array.isArray(parsed.claims) ? parsed.claims.map(String) : [],
      arguments: args,
      counterConsiderations,
      gaps: String(parsed.gaps || '').replace(MARKER_RE, '').replace(/\s+([.,;:])/g, '$1').trim(),
      pages, sites,
      meta: { ...meta, droppedEvidence, droppedArguments, droppedMarkers },
    };
  }

  /** Older saved traces (before colour coding) are converted on the fly. */
  function upgradeResult(r) {
    if (r.version === 2) return r;
    const pages = [], sites = [], byUrl = new Map();
    const args = (r.arguments || []).map((a) => ({
      point: a.point, reasoning: a.reasoning,
      evidence: (a.evidence || []).map((ev) => {
        const key = normaliseUrl(ev.url);
        if (!byUrl.has(key)) {
          const src = ev.source || { domain: new URL(ev.url).hostname, label: new URL(ev.url).hostname, category: 'other' };
          let site = sites.findIndex((s) => s.domain === src.domain);
          if (site === -1) { site = sites.length; sites.push({ ...src, color: site % 8 }); }
          pages.push({ n: pages.length + 1, url: ev.url, title: ev.title, site });
          byUrl.set(key, pages.length);
        }
        return { n: byUrl.get(key), excerpt: ev.excerpt, sourceType: ev.sourceType };
      }),
    }));
    return { ...r, version: 2, arguments: args, pages, sites };
  }

  /* =====================================================================
   * Search routes
   * ===================================================================== */

  /** Claude with its own web search, restricted by allowed_domains. */
  async function traceWithClaudeSearch({ statement, stance, sources, cfg, signal, progress }) {
    progress('Claude is searching your trusted sources. This usually takes 30 to 90 seconds.');
    const messages = [{ role: 'user', content: builtinUserPrompt(statement, stance, sources) }];
    const blocks = [];
    let text = '';
    for (let round = 0; round < 4; round++) {
      const data = await postJson('Anthropic Claude', 'https://api.anthropic.com/v1/messages', anthropicHeaders(cfg.key), {
        model: cfg.model, max_tokens: 8000, system: BUILTIN_SYSTEM, messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: cfg.maxSearches, allowed_domains: sources.map((s) => s.domain) }],
      }, signal);
      blocks.push(...data.content);
      text += data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (data.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: data.content });
    }
    const retrieved = new Map();
    let searches = 0;
    let searchError = null;
    for (const b of blocks) {
      if (b.type === 'server_tool_use' && b.name === 'web_search') searches++;
      if (b.type === 'web_search_tool_result') {
        if (Array.isArray(b.content)) b.content.forEach((r) => { if (r.url) retrieved.set(normaliseUrl(r.url), { url: r.url, title: r.title || r.url }); });
        else if (b.content && b.content.error_code) searchError = b.content.error_code;
      }
      if (b.type === 'text' && Array.isArray(b.citations)) {
        b.citations.forEach((c) => { if (c.url && !retrieved.has(normaliseUrl(c.url))) retrieved.set(normaliseUrl(c.url), { url: c.url, title: c.title || c.url }); });
      }
    }
    const parsed = extractJson(text);
    if (!parsed) {
      if (searchError) throw new ProviderError(`Claude's web search failed (${searchError}). Check that web search is enabled for your Anthropic organization.`);
      throw new ProviderError('The answer couldn\'t be read as a structured argument. Run the trace again.');
    }
    return { parsed, resolve: declaredResolver(parsed, retrieved), searches, pages: retrieved.size };
  }

  /** For built-in search: ids the model declared in "sources", checked against what the search returned. */
  function declaredResolver(parsed, retrieved) {
    const declared = new Map();
    (Array.isArray(parsed.sources) ? parsed.sources : []).forEach((s) => {
      if (s && s.id && s.url) declared.set(String(s.id).trim().toUpperCase(), String(s.url));
    });
    return (ref) => {
      const url = typeof ref === 'string' ? declared.get(ref) : ref && ref.url;
      return url ? retrieved.get(normaliseUrl(url)) || null : null;
    };
  }

  /** OpenAI Responses API with web_search, restricted by filters.allowed_domains. */
  async function traceWithOpenAISearch({ statement, stance, sources, cfg, signal, progress }) {
    progress('OpenAI is searching your trusted sources. This usually takes 30 to 90 seconds.');
    // OpenAI takes bare hostnames (subdomains included); paths are enforced afterwards by matchTrustedSource.
    const hosts = [...new Set(sources.map((s) => s.domain.split('/')[0]))];
    const data = await postJson('OpenAI', 'https://api.openai.com/v1/responses', { Authorization: `Bearer ${cfg.key}` }, {
      model: cfg.model, instructions: BUILTIN_SYSTEM, input: builtinUserPrompt(statement, stance, sources),
      tools: [{ type: 'web_search', filters: { allowed_domains: hosts } }],
      include: ['web_search_call.action.sources'],
    }, signal);
    const retrieved = new Map();
    let searches = 0;
    let text = '';
    for (const item of data.output || []) {
      if (item.type === 'web_search_call') {
        searches++;
        ((item.action && item.action.sources) || []).forEach((s) => { if (s.url) retrieved.set(normaliseUrl(s.url), { url: s.url, title: s.title || s.url }); });
      }
      if (item.type === 'message') {
        (item.content || []).forEach((c) => {
          if (c.type === 'output_text') {
            text += c.text;
            (c.annotations || []).forEach((a) => { if (a.url && !retrieved.has(normaliseUrl(a.url))) retrieved.set(normaliseUrl(a.url), { url: a.url, title: a.title || a.url }); });
          }
        });
      }
    }
    const parsed = extractJson(text);
    if (!parsed) throw new ProviderError('The answer couldn\'t be read as a structured argument. Run the trace again.');
    return { parsed, resolve: declaredResolver(parsed, retrieved), searches, pages: retrieved.size };
  }

  async function tavilySearch(key, query, domains, signal) {
    const data = await postJson('Tavily', 'https://api.tavily.com/search', { Authorization: `Bearer ${key}` }, {
      query, search_depth: 'basic', max_results: 6, include_domains: domains, include_answer: false, include_raw_content: false,
    }, signal);
    return Array.isArray(data.results) ? data.results : [];
  }

  /** Tavily search restricted to the trusted list, then any model reads the excerpts. */
  async function traceWithTavily({ statement, stance, sources, cfg, signal, progress }) {
    progress('Planning searches…');
    let queries = [];
    try {
      const planText = await chat({
        ...cfg, system: QUERY_SYSTEM, json: true, signal,
        user: `Write ${cfg.maxSearches} short web search queries (under 10 words each) to find evidence ${direction(stance)} this statement. Cover its distinct claims (people, places, dates, events) and include one query on the scholarly debate.\n\nStatement: """${statement}"""`,
      });
      const plan = extractJson(planText, 'queries');
      if (plan && Array.isArray(plan.queries)) queries = plan.queries.map(String).filter(Boolean);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw err; // the model is unusable; surface its error now rather than after searching
    }
    if (!queries.length) queries = [statement];
    queries = [...new Set(queries)].slice(0, cfg.maxSearches);

    const domains = sources.map((s) => s.domain.split('/')[0]);
    const found = new Map();
    for (let i = 0; i < queries.length; i++) {
      progress(`Searching your trusted sources (${i + 1} of ${queries.length})…`);
      const results = await tavilySearch(cfg.tavilyKey, queries[i], domains, signal);
      results.forEach((r) => {
        const key = r.url && normaliseUrl(r.url);
        if (!key || found.has(key) || !matchTrustedSource(r.url, sources)) return;
        found.set(key, { url: r.url, title: r.title || r.url, content: String(r.content || '').slice(0, 1400) });
      });
    }
    const pages = [...found.values()].slice(0, 24);
    if (!pages.length) {
      return {
        parsed: {
          summary: 'None of the trusted sources searched returned pages for this statement. Try rephrasing it, choosing another topic, or adding sources to this topic.',
          verdict: 'insufficient', verdictReason: 'The search found nothing to work with.', claims: [], arguments: [], counterConsiderations: [], gaps: `Searched for: ${queries.join('; ')}`,
        },
        resolve: () => null, searches: queries.length, pages: 0,
      };
    }

    progress(`Reading ${pages.length} pages and building the argument…`);
    const ids = new Map(pages.map((p, i) => [`S${i + 1}`, p]));
    const listing = pages.map((p, i) => {
      const t = matchTrustedSource(p.url, sources);
      return `[S${i + 1}] ${p.title}\nURL: ${p.url}\nSource: ${t.label} (${t.category})\nExcerpt: ${p.content}`;
    }).join('\n\n');
    const text = await chat({
      ...cfg, system: SOURCES_SYSTEM, json: true, signal,
      user: `Statement:\n"""${statement}"""\n\nTask: build the strongest evidence-based case ${direction(stance)} this statement, using only these sources.\n\n${listing}`,
    });
    const parsed = extractJson(text);
    if (!parsed) throw new ProviderError('The model\'s answer couldn\'t be read as a structured argument. Run the trace again, or pick a larger model.');
    const resolve = (ref) => (typeof ref === 'string' ? ids.get(ref) || null : (ref && ref.url ? found.get(normaliseUrl(ref.url)) || null : null));
    return { parsed, resolve, searches: queries.length, pages: pages.length };
  }

  async function traceStatement({ statement, stance, signal, progress }) {
    const settings = getSettings();
    const provider = settings.provider;
    const p = PROVIDERS[provider];
    const key = settings.keys[provider] || '';
    const model = (settings.models[provider] || p.defaultModel || '').trim();
    if (!key) throw new ProviderError(`Add your ${p.name} API key in Settings to run traces.`);
    if (!model) throw new ProviderError(`Choose a ${p.name} model in Settings. Use "Load models" to see the ones your key can use.`);
    const search = effectiveSearch(settings);
    if (search === 'tavily' && !settings.keys.tavily) throw new ProviderError('Add your free Tavily API key in Settings. It powers the search restricted to your trusted sources.');

    const topicId = selectedTopicId();
    const topic = SourceStore.topic(topicId);
    const sources = SourceStore.forTopic(topicId);
    if (!sources.length) {
      throw new ProviderError(topic
        ? `The topic "${topic.name}" has no sources switched on. Add or switch on sources for it in Settings, or choose another topic.`
        : 'No trusted sources are switched on. Enable at least one in Settings.');
    }
    const limit = search === 'builtin' ? BUILTIN_DOMAIN_LIMIT[provider] : 300;
    if (sources.length > limit) throw new ProviderError(`${sources.length} sources are switched on, but this search can use at most ${limit}. Turn some off in Settings.`);

    const cfg = { provider, key, model, maxSearches: settings.maxSearches, tavilyKey: settings.keys.tavily };
    const args = { statement, stance, sources, cfg, signal, progress };
    let out;
    if (search === 'builtin' && provider === 'anthropic') out = await traceWithClaudeSearch(args);
    else if (search === 'builtin' && provider === 'openai') out = await traceWithOpenAISearch(args);
    else out = await traceWithTavily(args);

    return finalise({
      parsed: out.parsed, resolve: out.resolve, statement, stance, sources,
      meta: {
        provider: p.name, model, search: search === 'tavily' ? 'Tavily' : `${p.name} web search`,
        topic: topic ? topic.name : 'All sources', sourcesSearched: sources.length,
        searches: out.searches, pagesRead: out.pages,
      },
    });
  }

  /* =====================================================================
   * Settings
   * ===================================================================== */
  function getSettings() {
    const s = local.get(KEYS.settings, {});
    const keys = { ...(s.keys || {}) };
    const models = { ...(s.models || {}) };
    if (typeof s.apiKey === 'string' && s.apiKey && !keys.anthropic) keys.anthropic = s.apiKey; // v1 migration
    if (typeof s.model === 'string' && s.model && !models.anthropic) models.anthropic = s.model;
    const provider = PROVIDERS[s.provider] ? s.provider : (keys.anthropic ? 'anthropic' : 'gemini');
    return {
      provider, keys, models,
      search: s.search === 'builtin' || (s.search === undefined && typeof s.apiKey === 'string' && s.apiKey) ? 'builtin' : 'tavily',
      maxSearches: [3, 4, 6, 8].includes(Number(s.maxSearches)) ? Number(s.maxSearches) : 4,
    };
  }

  function effectiveSearch(settings) {
    return settings.search === 'builtin' && PROVIDERS[settings.provider].builtinSearch ? 'builtin' : 'tavily';
  }

  function saveSettings(patch) {
    const s = getSettings();
    return local.set(KEYS.settings, { ...s, ...patch, keys: { ...s.keys, ...(patch.keys || {}) }, models: { ...s.models, ...(patch.models || {}) } });
  }

  function missingItems() {
    const s = getSettings();
    const p = PROVIDERS[s.provider];
    const missing = [];
    if (!s.keys[s.provider]) missing.push(`${p.name} API key`);
    if (!(s.models[s.provider] || p.defaultModel)) missing.push(`${p.name} model`);
    if (effectiveSearch(s) === 'tavily' && !s.keys.tavily) missing.push('Tavily API key');
    return missing;
  }
  const isReady = () => missingItems().length === 0;

  function renderProviderFields() {
    const f = $('#key-form');
    const s = getSettings();
    const provider = f.provider.value;
    const p = PROVIDERS[provider];
    f.apiKey.value = s.keys[provider] || '';
    f.apiKey.placeholder = p.keyHint || 'Paste your key';
    renderModelSelect(provider, s.models[provider] || p.defaultModel);
    $('#key-label-text').textContent = `${p.name} API key`;
    $('#key-link').href = p.keyUrl;
    $('#key-link').textContent = `Get an API key from ${p.name}`;
    $('#models-msg').textContent = '';
    const builtinRadio = $('#search-builtin');
    builtinRadio.disabled = !p.builtinSearch;
    $('#search-builtin-label').classList.toggle('disabled', !p.builtinSearch);
    $('#search-builtin-name').textContent = p.builtinSearch ? `${p.name}'s own web search` : 'The model\'s own web search';
    $('#search-builtin-note').textContent = p.builtinSearch
      ? `One step, billed by ${p.name}. Restricted to your trusted domains.`
      : `Not available for ${p.name}: its search can't be limited to your trusted sources.`;
    if (!p.builtinSearch) $('#search-tavily').checked = true;
    else if (s.search === 'builtin') builtinRadio.checked = true;
    $('#tavily-fields').hidden = !$('#search-tavily').checked;
  }

  function fillKeyForm() {
    const s = getSettings();
    const f = $('#key-form');
    f.provider.value = s.provider;
    f.maxSearches.value = String(s.maxSearches);
    f.tavilyKey.value = s.keys.tavily || '';
    if (s.search === 'builtin') $('#search-builtin').checked = true; else $('#search-tavily').checked = true;
    renderProviderFields();
  }

  function storeForm() {
    const f = $('#key-form');
    const provider = f.provider.value;
    saveSettings({
      provider,
      search: $('#search-builtin').checked && !$('#search-builtin').disabled ? 'builtin' : 'tavily',
      maxSearches: Number(f.maxSearches.value),
      keys: { [provider]: f.apiKey.value.trim(), tavily: f.tavilyKey.value.trim() },
      models: { [provider]: currentModelChoice() },
    });
    renderScope();
    renderAccMeta();
    showSaveState();
  }

  function showSaveState() {
    const msg = $('#key-msg');
    const s = getSettings();
    const p = PROVIDERS[s.provider];
    const missing = missingItems();
    msg.className = missing.length ? 'form-error' : 'form-error ok';
    msg.textContent = missing.length
      ? `Saved. Traces will use ${p.name} once you add: ${missing.join(', ')}.`
      : `Saved. Traces will use ${p.name} (${s.models[s.provider] || p.defaultModel}) with ${effectiveSearch(s) === 'tavily' ? 'Tavily search' : `${p.name}'s web search`}.`;
  }

  function saveKeyForm(e) {
    e.preventDefault();
    storeForm();
  }

  function switchProvider() {
    // Switching takes effect at once; the new provider's saved key and model are loaded into the form.
    saveSettings({ provider: $('#key-form').provider.value });
    renderProviderFields();
    storeForm();
  }

  function forgetKey() {
    const f = $('#key-form');
    const provider = f.provider.value;
    saveSettings({ keys: { [provider]: '' } });
    f.apiKey.value = '';
    $('#key-msg').className = 'form-error ok';
    $('#key-msg').textContent = `${PROVIDERS[provider].name} key removed from this browser.`;
    renderScope();
  }

  const CUSTOM = '__custom__';

  /** The model the form currently points at. */
  function currentModelChoice() {
    const sel = $('#model-select');
    return (sel.value === CUSTOM ? $('#model-custom').value : sel.value).trim();
  }

  /** Always-visible model dropdown: remembered list + current model + "type a name". */
  function renderModelSelect(provider, current) {
    const p = PROVIDERS[provider];
    const lists = local.get(KEYS.modelLists, {});
    const ids = lists[provider] && lists[provider].length ? [...lists[provider]] : (p.defaultModel ? [p.defaultModel] : []);
    if (current && !ids.includes(current)) ids.unshift(current);
    const sel = $('#model-select');
    sel.innerHTML = (ids.length ? '' : '<option value="">Click "Load models" to see your models</option>')
      + ids.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join('')
      + `<option value="${CUSTOM}">Type another model name…</option>`;
    sel.value = current && ids.includes(current) ? current : (ids[0] || '');
    $('#model-custom').hidden = true;
    $('#model-custom').value = '';
  }

  function onModelSelect() {
    const custom = $('#model-select').value === CUSTOM;
    $('#model-custom').hidden = !custom;
    if (custom) { $('#model-custom').focus(); return; }
    storeForm();
  }

  async function loadModels() {
    const f = $('#key-form');
    const provider = f.provider.value;
    const key = f.apiKey.value.trim();
    const msg = $('#models-msg');
    if (!key && provider !== 'openrouter') { msg.textContent = 'Paste the API key first.'; return; }
    msg.textContent = 'Loading models…';
    try {
      const ids = await listModels(provider, key);
      if (f.provider.value !== provider) return; // provider changed while loading
      const lists = local.get(KEYS.modelLists, {});
      lists[provider] = ids;
      local.set(KEYS.modelLists, lists);
      const current = currentModelChoice();
      renderModelSelect(provider, ids.includes(current) ? current : (ids[0] || current));
      storeForm();
      msg.textContent = ids.length
        ? `${ids.length} model${ids.length === 1 ? '' : 's'} available${provider === 'openrouter' ? ' for free' : ''}. Pick one from the Model list.${current && !ids.includes(current) ? ` "${current}" wasn't available, so ${ids[0]} is selected.` : ''}`
        : 'No suitable models were found for this key.';
    } catch (err) {
      msg.textContent = err.message;
    }
  }


  /* =====================================================================
   * UI: routing and scope
   * ===================================================================== */
  const ui = { result: null, mode: 'summary', editingId: null, editingTopicId: null, controller: null, sourceFilter: '' };

  function route() {
    const view = location.hash === '#settings' ? 'settings' : 'trace';
    $('#view-trace').hidden = view !== 'trace';
    $('#view-settings').hidden = view !== 'settings';
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function selectedTopicId() {
    const id = local.get(KEYS.topic, '');
    return SourceStore.topic(id) ? id : '';
  }

  function renderTopicPicker() {
    const sel = $('#topic-select');
    const current = selectedTopicId();
    const on = SourceStore.enabled().length;
    sel.innerHTML = `<option value="">All trusted sources (${on} on)</option>` + SourceStore.topics
      .map((t) => {
        const n = SourceStore.forTopic(t.id).length;
        return `<option value="${esc(t.id)}">${esc(t.name)} (${n} on)</option>`;
      }).join('');
    sel.value = current;
    const t = SourceStore.topic(current);
    $('#topic-note').textContent = t && t.description ? t.description : '';
  }

  function renderScope() {
    const s = getSettings();
    const topic = SourceStore.topic(selectedTopicId());
    const n = SourceStore.forTopic(topic ? topic.id : '').length;
    let html = n
      ? `Searches ${n} trusted source${n === 1 ? '' : 's'}${topic ? ` in ${esc(topic.name)}` : ''}. <a href="#settings">Edit sources and topics</a>`
      : (topic ? `No sources in ${esc(topic.name)} are switched on. <a href="#settings">Add sources to this topic</a>.` : 'No sources are switched on. <a href="#settings">Choose sources</a> before tracing.');
    const p = PROVIDERS[s.provider];
    const model = s.models[s.provider] || p.defaultModel;
    html += `<br>Model: ${esc(p.name)}${model ? ` (${esc(model)})` : ''}. Search: ${effectiveSearch(s) === 'tavily' ? 'Tavily' : `${esc(p.name)}'s web search`}.`;
    if (!isReady()) html += ` Add ${esc(missingItems().join(', '))} in <a href="#settings">Settings</a> to start.`;
    $('#scope-line').innerHTML = html;
  }

  function refreshAll() {
    renderTopics(); renderSources(); renderTopicPicker(); renderScope(); renderAccMeta();
  }

  /* ---------- Accordions: remember which are open ---------- */
  function openAcc(id) {
    const d = document.getElementById(id);
    if (d && !d.open) d.open = true;
  }

  function initAccordions() {
    const saved = local.get(KEYS.accordions, null);
    document.querySelectorAll('details.acc').forEach((d) => {
      const key = d.dataset.acc;
      // First visit: open only the model group, and only if setup isn't finished.
      d.open = saved && key in saved ? Boolean(saved[key]) : (key === 'model' && !isReady());
      d.addEventListener('toggle', () => {
        const state = local.get(KEYS.accordions, {});
        state[key] = d.open;
        local.set(KEYS.accordions, state);
      });
    });
    // Cancelling an edit also folds the form away.
    $('#topic-cancel').addEventListener('click', () => { $('#topic-form-wrap').open = false; });
    $('#source-cancel').addEventListener('click', () => { $('#source-form-wrap').open = false; });
  }

  function renderAccMeta() {
    const s = getSettings();
    const p = PROVIDERS[s.provider];
    const missing = missingItems();
    $('#meta-model').textContent = missing.length
      ? `Needs ${missing.join(', ')}`
      : `${p.name}, ${s.models[s.provider] || p.defaultModel}, ${effectiveSearch(s) === 'tavily' ? 'Tavily search' : 'built-in search'}`;
    $('#meta-model').classList.toggle('warn', missing.length > 0);
    const t = SourceStore.topics.length;
    $('#meta-topics').textContent = `${t} topic${t === 1 ? '' : 's'}`;
    $('#meta-sources').textContent = `${SourceStore.enabled().length} of ${SourceStore.list.length} switched on`;
  }

  /* =====================================================================
   * UI: topics
   * ===================================================================== */
  function sourceChecklist(container, checkedIds) {
    const checked = new Set(checkedIds);
    container.innerHTML = SourceStore.list.length
      ? [...SourceStore.list].sort((a, b) => a.label.localeCompare(b.label)).map((s) => `
        <label class="check"><input type="checkbox" value="${esc(s.id)}"${checked.has(s.id) ? ' checked' : ''}>
          <span>${esc(s.label)} <span class="muted">${esc(s.domain)}${s.enabled ? '' : ', switched off'}</span></span></label>`).join('')
      : '<p class="muted">Add sources below first, then map them to this topic.</p>';
  }

  function topicChecklist(container, checkedIds) {
    const checked = new Set(checkedIds);
    container.innerHTML = SourceStore.topics.length
      ? SourceStore.topics.map((t) => `
        <label class="check"><input type="checkbox" value="${esc(t.id)}"${checked.has(t.id) ? ' checked' : ''}><span>${esc(t.name)}</span></label>`).join('')
      : '<p class="muted">No topics yet. Create one in Topics above.</p>';
  }

  const checkedValues = (container) => [...container.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value);

  function renderTopics() {
    const list = $('#topic-list');
    const openIds = new Set([...list.querySelectorAll('details[open]')].map((d) => d.dataset.topic));
    if (!SourceStore.topics.length) {
      list.innerHTML = '<li class="empty">No topics yet. Use "Add a topic" to group your sources by subject.</li>';
    } else {
      list.innerHTML = SourceStore.topics.map((t) => {
        const members = [...SourceStore.inTopic(t.id)].sort((x, y) => x.label.localeCompare(y.label));
        const on = members.filter((m) => m.enabled).length;
        return `<li><details class="topic-item" data-topic="${esc(t.id)}"${openIds.has(t.id) ? ' open' : ''}>
          <summary>
            <span class="topic-name">${esc(t.name)}</span>
            <span class="acc-meta">${members.length} source${members.length === 1 ? '' : 's'}, ${on} on</span>
          </summary>
          <div class="topic-body">
            ${t.description ? `<p class="source-notes">${esc(t.description)}</p>` : ''}
            ${members.length
              ? `<ul class="member-list">${members.map((m) => `<li class="${m.enabled ? '' : 'off'}">${esc(m.label)} <span class="muted">${esc(m.domain)}${m.enabled ? '' : ', switched off'}</span></li>`).join('')}</ul>`
              : '<p class="muted">No sources mapped yet. Edit the topic to add some.</p>'}
            <div class="row-actions">
              <button type="button" class="btn quiet" data-edit-topic="${esc(t.id)}">Edit</button>
              <button type="button" class="btn quiet danger" data-delete-topic="${esc(t.id)}">Delete</button>
            </div>
          </div>
        </details></li>`;
      }).join('');
    }
    list.querySelectorAll('[data-edit-topic]').forEach((b) => b.addEventListener('click', () => startTopicEdit(b.dataset.editTopic)));
    list.querySelectorAll('[data-delete-topic]').forEach((b) => b.addEventListener('click', () => {
      const t = SourceStore.topic(b.dataset.deleteTopic);
      if (!t || !confirm(`Delete the topic "${t.name}"? Its sources stay in your list.`)) return;
      SourceStore.removeTopic(t.id);
      if (ui.editingTopicId === t.id) resetTopicForm();
      refreshAll();
    }));
    if (!ui.editingTopicId) sourceChecklist($('#topic-source-checks'), checkedValues($('#topic-source-checks')));
    topicChecklist($('#source-topic-checks'), checkedValues($('#source-topic-checks')));
    const filter = $('#source-filter');
    filter.innerHTML = '<option value="">All sources</option>' + SourceStore.topics.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    filter.value = SourceStore.topic(ui.sourceFilter) ? ui.sourceFilter : '';
  }

  function startTopicEdit(id) {
    const t = SourceStore.topic(id);
    if (!t) return;
    const f = $('#topic-form');
    ui.editingTopicId = id;
    f.topicName.value = t.name;
    f.topicDescription.value = t.description;
    sourceChecklist($('#topic-source-checks'), SourceStore.inTopic(id).map((s) => s.id));
    f.classList.add('editing');
    openAcc('acc-topics'); $('#topic-form-wrap').open = true;
    $('#topic-form-title').textContent = `Edit ${t.name}`;
    $('#topic-submit').textContent = 'Save topic';
    $('#topic-cancel').hidden = false;
    $('#topic-error').textContent = '';
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetTopicForm() {
    const f = $('#topic-form');
    f.reset();
    ui.editingTopicId = null;
    f.classList.remove('editing');
    sourceChecklist($('#topic-source-checks'), []);
    $('#topic-form-title').textContent = 'Add a topic';
    $('#topic-submit').textContent = 'Add topic';
    $('#topic-cancel').hidden = true;
    $('#topic-error').textContent = '';
  }

  function submitTopic(e) {
    e.preventDefault();
    const f = e.target;
    const payload = { name: f.topicName.value, description: f.topicDescription.value };
    const ids = checkedValues($('#topic-source-checks'));
    try {
      const wasEditing = Boolean(ui.editingTopicId);
      if (wasEditing) SourceStore.updateTopic(ui.editingTopicId, payload, ids);
      else SourceStore.addTopic(payload, ids);
      resetTopicForm(); refreshAll();
      if (wasEditing) $('#topic-form-wrap').open = false;
    } catch (err) {
      $('#topic-error').textContent = err.message;
    }
  }

  /* =====================================================================
   * UI: sources
   * ===================================================================== */
  function renderSources() {
    const list = $('#source-list');
    list.innerHTML = '';
    const on = SourceStore.enabled().length;
    const count = $('#source-count');
    count.textContent = `${on} of ${SourceStore.list.length} switched on`;
    const filterTopic = SourceStore.topic(ui.sourceFilter);
    const shown = filterTopic ? SourceStore.inTopic(filterTopic.id) : SourceStore.list;
    if (!shown.length) {
      list.innerHTML = filterTopic
        ? `<li class="empty">No sources are mapped to ${esc(filterTopic.name)} yet. Edit the topic, or tick it when adding a source.</li>`
        : '<li class="empty">Your list is empty. Add the first site you trust above, or restore the default list.</li>';
      return;
    }
    const tpl = $('#source-row');
    [...shown].sort((a, b) => a.label.localeCompare(b.label)).forEach((s) => {
      const row = tpl.content.firstElementChild.cloneNode(true);
      row.classList.toggle('off', !s.enabled);
      $('.toggle', row).checked = s.enabled;
      $('.toggle-label', row).textContent = `Search ${s.label}`;
      $('.source-label', row).textContent = s.label;
      $('.source-domain', row).textContent = s.domain;
      $('.source-notes', row).textContent = s.notes;
      const names = s.topics.map((id) => SourceStore.topic(id)).filter(Boolean).map((t) => t.name);
      $('.source-topics', row).textContent = names.length ? `Topics: ${names.join(', ')}` : 'No topic';
      $('.tag', row).textContent = CATEGORY_NAMES[s.category] || s.category;
      $('.toggle', row).addEventListener('change', (e) => {
        try { SourceStore.update(s.id, { enabled: e.target.checked }); } catch (err) { alert(err.message); }
        refreshAll();
      });
      $('.edit', row).addEventListener('click', () => startEdit(s));
      $('.delete', row).addEventListener('click', () => {
        if (!confirm(`Delete ${s.label} from your trusted sources?`)) return;
        SourceStore.remove(s.id);
        if (ui.editingId === s.id) resetSourceForm();
        refreshAll();
      });
      list.appendChild(row);
    });
  }

  function startEdit(s) {
    const f = $('#source-form');
    ui.editingId = s.id;
    f.domain.value = s.domain; f.label.value = s.label; f.category.value = s.category; f.notes.value = s.notes;
    topicChecklist($('#source-topic-checks'), s.topics);
    f.classList.add('editing');
    openAcc('acc-sources'); $('#source-form-wrap').open = true;
    $('#source-form-title').textContent = `Edit ${s.label}`;
    $('#source-submit').textContent = 'Save changes';
    $('#source-cancel').hidden = false;
    $('#source-error').textContent = '';
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    f.domain.focus({ preventScroll: true });
  }

  function resetSourceForm() {
    const f = $('#source-form');
    f.reset();
    ui.editingId = null;
    f.classList.remove('editing');
    topicChecklist($('#source-topic-checks'), ui.sourceFilter ? [ui.sourceFilter] : []);
    $('#source-form-title').textContent = 'Add a source';
    $('#source-submit').textContent = 'Add source';
    $('#source-cancel').hidden = true;
    $('#source-error').textContent = '';
  }

  function submitSource(e) {
    e.preventDefault();
    const f = e.target;
    const payload = {
      domain: f.domain.value, label: f.label.value, category: f.category.value, notes: f.notes.value,
      topics: checkedValues($('#source-topic-checks')),
    };
    try {
      const wasEditing = Boolean(ui.editingId);
      if (wasEditing) SourceStore.update(ui.editingId, payload); else SourceStore.add(payload);
      resetSourceForm(); refreshAll();
      if (wasEditing) $('#source-form-wrap').open = false;
    } catch (err) {
      $('#source-error').textContent = err.message;
    }
  }

  function exportSources() {
    const blob = new Blob([JSON.stringify(SourceStore.exportData(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'trusted-sources.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importSources(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { alert('That file isn\'t valid JSON.'); return; }
    const n = (Array.isArray(parsed) ? parsed : parsed.sources || []).length;
    const t = Array.isArray(parsed.topics) ? parsed.topics.length : 0;
    if (!confirm(`Replace your sources and topics with the ${n} sources and ${t} topics in this file?`)) return;
    try { SourceStore.replaceAll(parsed); } catch (err) { alert(`Import failed. ${err.message}`); return; }
    resetSourceForm(); resetTopicForm(); refreshAll();
  }

  async function restoreDefaults() {
    if (!confirm('Replace your sources and topics with the default list?')) return;
    await SourceStore.restoreDefaults();
    resetSourceForm(); resetTopicForm(); refreshAll();
  }

  /* =====================================================================
   * UI: tracing
   * ===================================================================== */
  function setStatus(html, isError = false) {
    const el = $('#status');
    el.classList.toggle('error', isError);
    el.innerHTML = html;
  }

  async function runTrace(stance) {
    const statement = $('#statement').value.trim();
    if (statement.length < 10) { setStatus('Write a statement or question of at least 10 characters.', true); $('#statement').focus(); return; }
    if (!navigator.onLine) { setStatus('You\'re offline. Connect to the internet to run a new trace.', true); return; }

    const controls = document.querySelectorAll('.ledger-btn, #topic-select');
    controls.forEach((b) => { b.disabled = true; });
    $('#result').hidden = true;
    ui.controller = new AbortController();
    $('#stop-btn').hidden = false;
    const progress = (text) => setStatus(`<span class="pulse" aria-hidden="true"></span>${esc(text)}`);
    progress(`Starting a trace for ${stance === 'support' ? 'supporting' : 'challenging'} evidence…`);
    try {
      const result = await traceStatement({ statement, stance, signal: ui.controller.signal, progress });
      setStatus('');
      saveToHistory(result);
      showResult(result);
    } catch (err) {
      if (err.name === 'AbortError') setStatus('Trace stopped.');
      else setStatus(`${esc(err.message)}${/Settings/.test(err.message) ? ' <a href="#settings">Open Settings</a>' : ''}`, true);
    } finally {
      controls.forEach((b) => { b.disabled = false; });
      $('#stop-btn').hidden = true;
      ui.controller = null;
    }
  }

  /** Clearing always ends in a fresh page, as if the app had just been opened. */
  function refreshPage() {
    try { sessionStorage.setItem('tracer.cleared', '1'); } catch { /* ignore */ }
    if (location.hash !== '#trace') history.replaceState(null, '', '#trace');
    location.reload();
  }

  function clearResult() {
    $('#statement').value = '';
    $('#result').hidden = true;
    ui.result = null;
    refreshPage();
  }

  /* =====================================================================
   * UI: results with colour-coded sources
   * ===================================================================== */
  function siteOf(r, n) { const p = r.pages[n - 1]; return p ? r.sites[p.site] : null; }
  function colorOf(r, n) { const s = siteOf(r, n); return s ? s.color : 7; }

  function refChip(r, n) {
    const p = r.pages[n - 1];
    const s = siteOf(r, n);
    return `<button type="button" class="ref c${colorOf(r, n)}" data-ref="${n}" title="${esc(`${p.title}, ${s.label}`)}" aria-label="Source ${n}: ${esc(p.title)}">${n}</button>`;
  }

  /** Index where the sentence that ends `seg` starts. */
  function lastSentenceStart(seg) {
    const re = /[.!?]["'\u201d\u2019)\]]*\s+(?=\S)/g;
    let idx = 0, m;
    while ((m = re.exec(seg))) idx = m.index + m[0].length;
    return idx;
  }

  /** Renders text with [^n] references: the sentence before each reference is tinted in its source's colour. */
  function markedHtml(text, r) {
    let out = '', last = 0, m;
    const re = new RegExp(REF_RE.source, 'g');
    while ((m = re.exec(text))) {
      const seg = text.slice(last, m.index);
      const ns = m[1].split(',').map(Number).filter((n) => r.pages[n - 1]);
      if (ns.length) {
        const cut = lastSentenceStart(seg);
        const head = seg.slice(0, cut), body = seg.slice(cut).replace(/\s+$/, '');
        out += esc(head) + (body.trim() ? `<mark class="hl c${colorOf(r, ns[0])}">${esc(body)}</mark>` : esc(body)) + ns.map((n) => refChip(r, n)).join('');
      } else {
        out += esc(seg);
      }
      last = re.lastIndex;
    }
    return out + esc(text.slice(last));
  }

  const plainText = (text) => String(text || '').replace(new RegExp(REF_RE.source, 'g'), (m0, ns) => ns.split(',').map((n) => `[${n}]`).join(''));

  function legendHtml(r) {
    if (!r.sites.length) return '';
    const items = r.sites.map((s, i) => {
      const nums = r.pages.filter((p) => p.site === i).map((p) => p.n);
      return `<li><span class="swatch c${s.color}" aria-hidden="true"></span>${esc(s.label)} <span class="muted">(source${nums.length === 1 ? '' : 's'} ${nums.join(', ')})</span></li>`;
    }).join('');
    return `<div class="legend" aria-label="Colour key">
      <p class="legend-title">Colour key</p>
      <ul>${items}<li><span class="swatch plain" aria-hidden="true"></span>No colour: the model's own connecting reasoning</li></ul>
    </div>`;
  }

  function sourcesListHtml(r) {
    if (!r.pages.length) return '';
    return `<h3>Sources</h3><ol class="source-refs">${r.pages.map((p) => {
      const s = r.sites[p.site];
      return `<li id="src-${p.n}" class="c${s.color}">
        <span class="ref c${s.color}" aria-hidden="true">${p.n}</span>
        <div><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(p.title)}</a>
        <div class="meta-row"><span>${esc(s.label)}</span><span class="tag">${esc(CATEGORY_NAMES[s.category] || s.category)}</span></div></div>
      </li>`;
    }).join('')}</ol>`;
  }

  function showResult(result) {
    ui.result = upgradeResult(result);
    const el = $('#result');
    el.className = `result ${result.stance}`;
    el.hidden = false;
    renderResult();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderResult() {
    const r = ui.result;
    const el = $('#result');
    const kind = r.stance === 'support' ? 'Case in support' : 'Case against';
    const toggle = `<div class="segmented" role="group" aria-label="Detail level">
      <button type="button" data-mode="summary" aria-pressed="${ui.mode === 'summary'}">Summary</button>
      <button type="button" data-mode="detailed" aria-pressed="${ui.mode === 'detailed'}">Detailed</button></div>`;

    let body = `<div class="result-head"><p class="result-kind">${kind}</p>${toggle}</div>
      <p class="result-statement">${esc(r.statement)}</p>
      <span class="verdict">${esc(VERDICT_TEXT[r.verdict] || r.verdict)}</span>
      ${r.verdictReason ? `<p class="verdict-line">${esc(r.verdictReason)}</p>` : ''}
      ${legendHtml(r)}
      <div class="prose"><p>${markedHtml(r.summary, r)}</p></div>`;

    if (ui.mode === 'summary') {
      body += `<h3>Key points</h3><ul class="plain-list">${r.arguments.map((a) => {
        const ns = [...new Set(a.evidence.map((ev) => ev.n))];
        return `<li>${esc(a.point)} ${ns.map((n) => refChip(r, n)).join('')}</li>`;
      }).join('') || '<li>No point could be backed by the trusted sources.</li>'}</ul>`;
    } else {
      if (r.claims.length) body += `<h3>Claims tested</h3><ul class="plain-list">${r.claims.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`;
      body += '<h3>Arguments</h3>';
      body += r.arguments.length ? r.arguments.map((a) => `
        <div class="argument">
          <p class="argument-point">${esc(a.point)}</p>
          <p class="argument-reasoning">${markedHtml(a.reasoning, r)}</p>
          <ul class="evidence">${a.evidence.map((ev) => {
            const p = r.pages[ev.n - 1];
            return `<li class="c${colorOf(r, ev.n)}">
              ${refChip(r, ev.n)}
              <div><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(p.title)}</a>
              <p class="excerpt">${esc(ev.excerpt)}</p>
              <div class="meta-row"><span>${esc(siteOf(r, ev.n).label)}</span>${ev.sourceType && ev.sourceType !== 'unknown' ? `<span class="tag">${ev.sourceType === 'primary' ? 'Primary' : 'Secondary'}</span>` : ''}</div></div>
            </li>`;
          }).join('')}
          </ul>
        </div>`).join('') : '<p class="empty">No argument could be backed by the trusted sources.</p>';
      if (r.counterConsiderations.length) body += `<h3>Other side</h3><ul class="plain-list">${r.counterConsiderations.map((c) => `<li>${markedHtml(c, r)}</li>`).join('')}</ul>`;
      if (r.gaps) body += `<h3>Gaps in the sources</h3><div class="prose"><p>${esc(r.gaps)}</p></div>`;
    }
    body += sourcesListHtml(r);

    const m = r.meta || {};
    const d = (m.droppedEvidence || 0) + (m.droppedMarkers || 0);
    body += `<p class="footnote">${m.topic ? `Topic: ${esc(m.topic)} (${m.sourcesSearched} source${m.sourcesSearched === 1 ? '' : 's'} searched). ` : ''}${m.searches ?? 0} search${m.searches === 1 ? '' : 'es'}, ${m.pagesRead ?? 0} page${m.pagesRead === 1 ? '' : 's'} found.
      ${d ? `${d === 1 ? '1 citation was' : `${d} citations were`} removed because ${d === 1 ? 'it' : 'they'} didn't match a trusted page the search returned.` : 'Every citation matches a trusted page the search returned.'}
      ${m.provider ? `Model: ${esc(m.provider)} ${esc(m.model)}. Search: ${esc(m.search)}.` : ''}
      Traced ${new Date(r.createdAt).toLocaleString()}.</p>
      <div class="result-actions">
        <button type="button" class="btn quiet" id="copy-btn">Copy as text</button>
        <button type="button" class="btn quiet" id="clear-result">Clear</button>
      </div>`;

    el.innerHTML = body;
    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { ui.mode = b.dataset.mode; renderResult(); }));
    el.querySelectorAll('button.ref[data-ref]').forEach((b) => b.addEventListener('click', () => {
      const target = document.getElementById(`src-${b.dataset.ref}`);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
    }));
    $('#copy-btn', el).addEventListener('click', copyResult);
    $('#clear-result', el).addEventListener('click', clearResult);
  }

  function copyResult() {
    const r = ui.result;
    const lines = [
      `${r.stance === 'support' ? 'Case in support of' : 'Case against'}: ${r.statement}`,
      `Evidence: ${VERDICT_TEXT[r.verdict]}. ${r.verdictReason}`, '', plainText(r.summary), '',
    ];
    r.arguments.forEach((a, i) => {
      lines.push(`${i + 1}. ${a.point}`, `   ${plainText(a.reasoning)}`);
      a.evidence.forEach((ev) => lines.push(`   - [${ev.n}] ${ev.excerpt}`));
      lines.push('');
    });
    if (r.counterConsiderations.length) lines.push('Other side:', ...r.counterConsiderations.map((c) => `- ${plainText(c)}`), '');
    if (r.gaps) lines.push(`Gaps: ${r.gaps}`, '');
    if (r.pages.length) lines.push('Sources:', ...r.pages.map((p) => `[${p.n}] ${p.title}, ${r.sites[p.site].label}. ${p.url}`));
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => { const b = $('#copy-btn'); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy as text'; }, 1500); },
      () => alert('This browser didn\'t allow copying.')
    );
  }

  /* =====================================================================
   * UI: history (this device)
   * ===================================================================== */
  const readHistory = () => local.get(KEYS.history, []);
  function saveToHistory(result) {
    local.set(KEYS.history, [result, ...readHistory()].slice(0, 20));
    renderHistory();
  }
  function renderHistory() {
    const items = readHistory();
    $('#history').hidden = !items.length;
    $('#history-list').innerHTML = items.map((r, i) => `
      <li>
        <button type="button" class="h-open" data-i="${i}">
          <span class="h-dir ${esc(r.stance)}">${r.stance === 'support' ? 'For' : 'Against'}</span>
          <span class="h-text">${esc(r.statement)}</span>
        </button>
        <button type="button" class="h-remove" data-remove="${i}" aria-label="Remove this trace">Remove</button>
      </li>`).join('');
    $('#history-list').querySelectorAll('.h-open').forEach((b) => b.addEventListener('click', () => {
      const r = readHistory()[Number(b.dataset.i)];
      if (r) { $('#statement').value = r.statement; showResult(r); }
    }));
    $('#history-list').querySelectorAll('.h-remove').forEach((b) => b.addEventListener('click', () => {
      const items2 = readHistory();
      items2.splice(Number(b.dataset.remove), 1);
      local.set(KEYS.history, items2);
      refreshPage();
    }));
  }

  /* =====================================================================
   * Boot
   * ===================================================================== */
  function updateOnline() { $('#offline-banner').hidden = navigator.onLine; }

  document.addEventListener('DOMContentLoaded', async () => {
    route();
    window.addEventListener('hashchange', route);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    updateOnline();

    try {
      if (sessionStorage.getItem('tracer.cleared')) {
        sessionStorage.removeItem('tracer.cleared');
        $('#statement').value = '';
        window.scrollTo(0, 0);
      }
    } catch { /* ignore */ }

    $('#trace-form').addEventListener('submit', (e) => { e.preventDefault(); runTrace(e.submitter ? e.submitter.value : 'support'); });
    $('#stop-btn').addEventListener('click', () => ui.controller && ui.controller.abort());
    $('#clear-history').addEventListener('click', () => { if (confirm('Clear all recent traces from this device?')) { local.remove(KEYS.history); refreshPage(); } });
    $('#topic-select').addEventListener('change', (e) => { local.set(KEYS.topic, e.target.value); renderTopicPicker(); renderScope(); });
    $('#key-form').addEventListener('submit', saveKeyForm);
    $('#forget-key').addEventListener('click', forgetKey);
    $('#provider-select').addEventListener('change', switchProvider);
    $('#model-select').addEventListener('change', onModelSelect);
    $('#model-custom').addEventListener('change', storeForm);
    ['apiKey', 'tavilyKey', 'maxSearches'].forEach((n) => $('#key-form')[n].addEventListener('change', storeForm));
    $('#load-models').addEventListener('click', loadModels);
    document.querySelectorAll('input[name=search]').forEach((r) => r.addEventListener('change', () => { $('#tavily-fields').hidden = !$('#search-tavily').checked; storeForm(); }));
    $('#topic-form').addEventListener('submit', submitTopic);
    $('#topic-cancel').addEventListener('click', resetTopicForm);
    $('#source-form').addEventListener('submit', submitSource);
    $('#source-cancel').addEventListener('click', resetSourceForm);
    $('#source-filter').addEventListener('change', (e) => { ui.sourceFilter = e.target.value; renderSources(); if (!ui.editingId) resetSourceForm(); });
    $('#export-btn').addEventListener('click', exportSources);
    $('#import-input').addEventListener('change', importSources);
    $('#reset-btn').addEventListener('click', restoreDefaults);

    fillKeyForm();
    renderHistory();
    await SourceStore.init();
    initAccordions();
    refreshAll();
    resetTopicForm();
    resetSourceForm();

    if ('serviceWorker' in navigator) {
      const hadController = Boolean(navigator.serviceWorker.controller);
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && !reloaded && !ui.controller) { reloaded = true; location.reload(); }
      });
      navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch(() => {});
    }
  });
})();
