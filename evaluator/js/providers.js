/* Evaluator: providers.js
 *
 * AI providers and Tavily, called directly from this device with the keys
 * in the settings file (js/settingsfile.js). This is the browser port of the
 * WordPress plugin's server-side code (class-evaluator-providers.php): same
 * endpoints, same requests, same answers, minus the proxy.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

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
  gemini: { name: 'Google Gemini', cost: 'free tier', defaultModel: 'gemini-2.5-flash', builtinSearch: false },
  groq: { name: 'Groq', cost: 'free tier', defaultModel: 'openai/gpt-oss-120b', builtinSearch: false, chat: 'https://api.groq.com/openai/v1/chat/completions', models: 'https://api.groq.com/openai/v1/models', json: true },
  openrouter: { name: 'OpenRouter', cost: 'free models', defaultModel: '', builtinSearch: false, chat: 'https://openrouter.ai/api/v1/chat/completions', models: 'https://openrouter.ai/api/v1/models', json: false },
  mistral: { name: 'Mistral', cost: 'free tier', defaultModel: 'mistral-small-latest', builtinSearch: false, chat: 'https://api.mistral.ai/v1/chat/completions', models: 'https://api.mistral.ai/v1/models', json: true },
  openai: { name: 'OpenAI (ChatGPT)', cost: 'paid', defaultModel: 'gpt-5-mini', builtinSearch: true, chat: 'https://api.openai.com/v1/chat/completions', models: 'https://api.openai.com/v1/models', json: true },
  anthropic: { name: 'Anthropic Claude', cost: 'paid', defaultModel: 'claude-sonnet-5', builtinSearch: true },
  // A model running on this computer (Ollama, LM Studio or any OpenAI-compatible server). No key needed.
  local: {
    name: 'On this computer (Ollama, LM Studio)', cost: 'free, runs on your computer', defaultModel: '', builtinSearch: false, json: false, local: true,
    get chat() { return `${localBase()}/chat/completions`; },
    get models() { return `${localBase()}/models`; },
  },
  // An organisation's Evaluator server (server/): its keys, members' access codes.
  org: {
    get name() { return orgInfo().name || tr('Organisation server'); }, cost: 'provided by your organisation', builtinSearch: false, org: true,
    get defaultModel() { return orgInfo().defaultModel || ''; },
    get json() { return orgInfo().json !== false; },
    get chat() { return `${orgBase()}/v1/chat/completions`; },
    get models() { return `${orgBase()}/v1/models`; },
  },
};
/** The organisation server's settings ({ url, name, models, ... }) and address. */
const orgInfo = () => (SettingsFile.data && SettingsFile.data.org) || {};
const orgBase = () => String(orgInfo().url || '').replace(/\/+$/, '');
/** Searches go through the organisation's server when it is the AI provider (it holds the Tavily key too). */
const orgSearchActive = () => Boolean(SettingsFile.data && SettingsFile.data.provider === 'org' && orgBase());
/** Where Tavily requests go: Tavily itself with your key, or your organisation's server with your access code. */
function searchAccess() {
  if (orgSearchActive()) {
    const code = SettingsFile.key('org');
    if (!code && !orgInfo().open) throw new ProviderError(tr('No access code yet for {name}. Add it in Settings › AI model and search.', { name: PROVIDERS.org.name }), 400);
    return { name: PROVIDERS.org.name, base: `${orgBase()}/tavily`, headers: code ? { Authorization: `Bearer ${code}` } : {} };
  }
  return { name: 'Tavily', base: 'https://api.tavily.com', headers: { Authorization: `Bearer ${keyOrError('tavily')}` } };
}
/** The local server's OpenAI-compatible address, for example http://localhost:11434/v1 (Ollama). */
const LOCAL_DEFAULT_URL = 'http://localhost:11434/v1';
const LOCAL_PRESETS = { ollama: 'http://localhost:11434/v1', lmstudio: 'http://localhost:1234/v1' };
function localBase() {
  const raw = (SettingsFile.data && SettingsFile.data.localUrl) || LOCAL_DEFAULT_URL;
  return raw.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}
/** True for addresses on this computer or the home network (Chrome asks permission for these). */
const isLocalAddress = (url) => { try { const h = new URL(url).hostname; return /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith('.local'); } catch { return false; } };
const isLoopback = (url) => { try { return /^(localhost|127\.|\[?::1\]?$)/.test(new URL(url).hostname); } catch { return false; } };
/** Where to get each key (Settings › API keys and Help). */
const KEY_LINKS = {
  gemini: 'https://aistudio.google.com/apikey',
  groq: 'https://console.groq.com/keys',
  openrouter: 'https://openrouter.ai/keys',
  mistral: 'https://console.mistral.ai/api-keys',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://platform.claude.com',
  tavily: 'https://app.tavily.com',
  local: 'https://ollama.com/download',
  org: '#help',
};
/** Providers you have added a key for. */
const configuredProviders = () => Object.keys(PROVIDERS).filter((id) => providerReady(id));
/** A provider can be used: it has a key, or (on this computer) an address. */
function providerReady(id) {
  if (id === 'local') return Boolean(localBase());
  if (id === 'org') return Boolean(orgBase() && (SettingsFile.key('org') || orgInfo().open));
  return Boolean(SettingsFile.key(id));
}
const BUILTIN_DOMAIN_LIMIT = { anthropic: 64, openai: 100 };
const REQUEST_TIMEOUT_MS = 180000;

class ProviderError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/** Tallies what one analysis used: tokens reported by the model provider and Tavily credits. */
const meter = {
  reset() { this.input = 0; this.output = 0; this.calls = 0; this.searchCredits = 0; },
  record(data) {
    if (!data) return;
    let i = 0, o = 0;
    if (data.usage) {
      const u = data.usage;
      i = (u.input_tokens ?? u.prompt_tokens ?? 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      o = u.output_tokens ?? u.completion_tokens ?? 0;
    } else if (data.usageMetadata) {
      i = data.usageMetadata.promptTokenCount || 0;
      o = (data.usageMetadata.candidatesTokenCount || 0) + (data.usageMetadata.thoughtsTokenCount || 0);
    }
    this.input += i; this.output += o; this.calls++;
  },
  snapshot() { return { input: this.input, output: this.output, calls: this.calls, searchCredits: this.searchCredits }; },
};
meter.reset();

/* =====================================================================
 * HTTP
 * ===================================================================== */
const providerName = (id) => (PROVIDERS[id] ? PROVIDERS[id].name : id);

function explainError(name, status, data) {
  let detail = '';
  if (data && typeof data === 'object') {
    if (data.error && data.error.message) detail = data.error.message;
    else if (typeof data.error === 'string') detail = data.error;
    else if (data.message) detail = data.message;
    else if (data.detail) detail = data.detail;
  }
  if (detail && typeof detail !== 'string') detail = JSON.stringify(detail);
  const tail = detail ? ` (${detail})` : '';
  if (status === 401 || status === 403) return `${tr('{name} rejected your API key. Check it in Settings › AI model and search.', { name })}${tail}`;
  if (status === 429) return `${tr('{name} says you\'ve hit a rate or usage limit. Wait a little and try again.', { name })}${tail}`;
  return detail ? tr('{name} returned an error ({status}): {detail}', { name, status, detail }) : tr('{name} returned an error ({status}).', { name, status });
}

/**
 * One request to a provider. Gives up after three minutes, and stops at
 * once when the user presses Stop (the AbortError is passed on unchanged).
 */
async function apiRequest(name, method, url, headers = {}, body = null, signal = null) {
  const ctl = new AbortController();
  let timedOut = false;
  const local = isLocalAddress(url);
  // Models on this computer can be much slower than cloud services, so they get longer.
  const limit = local ? REQUEST_TIMEOUT_MS * 4 : REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, limit);
  const onAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const fail = (err) => {
    if (timedOut) return new ProviderError(local ? tr('{name} took too long to answer (over 12 minutes). Try a smaller model, or lower "Searches per trace".', { name }) : tr('{name} took too long to answer (over 3 minutes). Try again, lower "Searches per trace", or choose a faster model.', { name }));
    if (err && err.name === 'AbortError') return err;
    if (local) return new ProviderError(tr('Couldn\'t reach the model server on this computer at {url}. Check that Ollama or LM Studio is running, and that it allows this app (see Help › Using a model on your own computer). If the browser asked about access to devices on your network, allow it.', { url: new URL(url).origin }));
    return new ProviderError(tr('Couldn\'t reach {name}. Check your connection and try again. If it keeps happening, {name} may not accept requests made directly from a browser.', { name }));
  };
  let res, text;
  try {
    res = await fetch(url, {
      method, signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      // Chrome's Local Network Access: marks the request as going to this computer so it can ask permission.
      // (Chrome refuses a request whose stated space doesn't match: 'loopback' for this computer, 'local' for the home network.)
      ...(local ? { targetAddressSpace: isLoopback(url) ? 'loopback' : 'local' } : {}),
      headers: { ...headers, ...(body !== null ? { 'content-type': 'application/json' } : {}) },
      body: body !== null ? JSON.stringify(body) : undefined,
    });
    text = await res.text();
  } catch (err) {
    throw fail(err);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!data || typeof data !== 'object') data = {};
  if (!res.ok) {
    const e = new ProviderError(explainError(name, res.status, data), res.status);
    e.httpStatus = res.status;
    throw e;
  }
  return data;
}

function keyOrError(slot) {
  if (slot === 'local') return SettingsFile.key('local'); // optional for local servers
  if (slot === 'org') {
    if (!orgBase()) throw new ProviderError(tr('No organisation server is set up. Add its address and your access code in Settings › AI model and search.'), 400);
    if (!SettingsFile.key('org') && !orgInfo().open) throw new ProviderError(tr('No access code yet for {name}. Add it in Settings › AI model and search.', { name: PROVIDERS.org.name }), 400);
    return SettingsFile.key('org');
  }
  const key = SettingsFile.key(slot);
  if (!key) throw new ProviderError(tr('No {name} API key yet. Add it in Settings › AI model and search.', { name: slot === 'tavily' ? 'Tavily' : providerName(slot) }), 400);
  return key;
}

const anthropicHeaders = (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });

/** Token counts in one shape: { input_tokens, output_tokens }. */
function usageOf(data) {
  let i = 0, o = 0;
  if (data && data.usage && typeof data.usage === 'object') {
    const u = data.usage;
    i = Number(u.input_tokens ?? u.prompt_tokens ?? 0) + Number(u.cache_read_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0);
    o = Number(u.output_tokens ?? u.completion_tokens ?? 0);
  } else if (data && data.usageMetadata) {
    const m = data.usageMetadata;
    i = Number(m.promptTokenCount || 0);
    o = Number(m.candidatesTokenCount || 0) + Number(m.thoughtsTokenCount || 0);
  }
  return { input_tokens: i, output_tokens: o };
}

const validModel = (m) => typeof m === 'string' && /^[A-Za-z0-9._:/@+-]{1,200}$/.test(m);

/* =====================================================================
 * Chat
 * ===================================================================== */
/** Hints that make small steps faster (less "thinking"). */
function lightHints(provider, model) {
  const m = String(model).toLowerCase();
  if (provider === 'gemini') {
    if (/gemini-2\.5-pro/.test(m)) return { thinkingConfig: { thinkingBudget: 128 } };
    if (/gemini-2\.5/.test(m)) return { thinkingConfig: { thinkingBudget: 0 } };
    if (/gemini-3/.test(m)) return { thinkingConfig: { thinkingLevel: 'low' } };
    return null;
  }
  if (provider === 'openai' && /^(o\d|gpt-5)/.test(m)) return { reasoning_effort: 'low' };
  if (provider === 'groq' && /gpt-oss|qwen3/.test(m)) return { reasoning_effort: 'low' };
  return null;
}

/**
 * `image` (optional) is { mime, data } with base64 data: a screenshot sent with the text,
 * for models that can read images.
 */
async function chatOnce(provider, model, system, user, json, hints, signal, image = null) {
  const key = keyOrError(provider);
  const p = PROVIDERS[provider];

  if (provider === 'anthropic') {
    const content = image ? [{ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } }, { type: 'text', text: user }] : user;
    const data = await apiRequest(p.name, 'POST', 'https://api.anthropic.com/v1/messages', anthropicHeaders(key), {
      model, max_tokens: 8000, system, messages: [{ role: 'user', content }],
    }, signal);
    const text = (data.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
    return { text, usage: usageOf(data) };
  }

  if (provider === 'gemini') {
    const gen = {};
    if (json) gen.responseMimeType = 'application/json';
    if (hints) Object.assign(gen, hints);
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: image ? [{ inlineData: { mimeType: image.mime, data: image.data } }, { text: user }] : [{ text: user }] }],
    };
    if (Object.keys(gen).length) body.generationConfig = gen;
    const data = await apiRequest(p.name, 'POST', `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, body, signal);
    const cand = data.candidates && data.candidates[0];
    if (!cand || !cand.content) {
      throw new ProviderError(tr('Gemini returned no answer{reason}. Try again or pick another model.', { reason: cand && cand.finishReason ? ` (${cand.finishReason})` : '' }), 502);
    }
    const text = (cand.content.parts || []).filter((part) => !part.thought).map((part) => part.text || '').join('');
    return { text, usage: usageOf(data) };
  }

  // OpenAI-compatible: OpenAI, Groq, OpenRouter, Mistral, and servers on this computer.
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  if (provider === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'Evaluator'; }
  const userContent = image ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } }] : user;
  const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }] };
  if (hints) Object.assign(body, hints);
  if (json && p.json) body.response_format = { type: 'json_object' };
  const data = await apiRequest(p.name, 'POST', p.chat, headers, body, signal);
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  if (!msg || !msg.content) throw new ProviderError(tr('{name} returned an empty answer. Try again or pick another model.', { name: p.name }), 502);
  const text = Array.isArray(msg.content) ? msg.content.map((x) => (x && x.text) || '').join('') : String(msg.content);
  return { text, usage: usageOf(data) };
}

/**
 * One plain model call: system + user in, text out. `light` asks for a quick
 * answer (less "thinking"); if the model doesn't accept that hint, the call
 * is repeated without it.
 */
async function chat({ provider, model, system, user, json, signal, light, image }) {
  if (!PROVIDERS[provider]) throw new ProviderError(tr('Unknown AI provider.'), 400);
  const m = model || PROVIDERS[provider].defaultModel;
  if (!validModel(m)) throw new ProviderError(tr('No model is chosen, or the model name is not valid.'), 400);
  const hints = light ? lightHints(provider, m) : null;
  let out;
  try {
    out = await chatOnce(provider, m, String(system || '').slice(0, 60000), String(user || '').slice(0, 150000), Boolean(json), hints, signal, image || null);
  } catch (err) {
    if (!(hints && err instanceof ProviderError && err.status === 400)) throw err;
    out = await chatOnce(provider, m, String(system || '').slice(0, 60000), String(user || '').slice(0, 150000), Boolean(json), null, signal, image || null);
  }
  // Some local models (Qwen 3, DeepSeek R1) write their reasoning in <think> tags first.
  out.text = String(out.text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  meter.record(out);
  return String(out.text || '');
}

/* =====================================================================
 * Model lists
 * ===================================================================== */
/** Lists model ids your key can use, for the model picker. */
async function listModels(provider) {
  const p = PROVIDERS[provider];
  if (!p) throw new ProviderError(tr('Unknown AI provider.'), 400);
  const key = SettingsFile.key(provider);
  if (!key && provider !== 'openrouter' && provider !== 'local') keyOrError(provider);
  if (provider === 'org') return orgInfo().models && orgInfo().models.length ? orgInfo().models.slice() : (await orgConnect(orgBase(), key)).models;
  if (provider === 'anthropic') {
    const d = await apiRequest(p.name, 'GET', 'https://api.anthropic.com/v1/models?limit=100', anthropicHeaders(key));
    return (d.data || []).map((m) => m.id).filter(Boolean);
  }
  if (provider === 'gemini') {
    const d = await apiRequest(p.name, 'GET', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': key });
    return (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter((id) => id.includes('gemini'));
  }
  const d = await apiRequest(p.name, 'GET', p.models, key ? { Authorization: `Bearer ${key}` } : {});
  let ids = (d.data || []).map((m) => String((m && m.id) || ''));
  if (provider === 'openrouter') ids = ids.filter((id) => id.endsWith(':free') || id === 'openrouter/free');
  if (provider === 'openai') ids = ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|image|transcribe|tts|search/.test(id));
  return [...new Set(ids.filter(Boolean))].sort();
}

/* =====================================================================
 * Tavily
 * ===================================================================== */
const cleanDomains = (domains, max) => [...new Set((domains || [])
  .map((d) => String(d).trim().toLowerCase())
  .filter((d) => /^[a-z0-9.-]{1,253}(\/[A-Za-z0-9._~%\-/]*)?$/.test(d)))].slice(0, max);

/** One Tavily search. Returns { results, credits }. */
async function tavilyApi(query, domains, signal) {
  const acc = searchAccess();
  const q = String(query || '').trim().slice(0, 400);
  const list = cleanDomains(domains, 300);
  if (!q || !list.length) throw new ProviderError(tr('A search needs a query and at least one trusted domain.'), 400);
  const data = await apiRequest(acc.name, 'POST', `${acc.base}/search`, acc.headers, {
    query: q, search_depth: 'basic', max_results: 6, include_domains: list, include_answer: false, include_raw_content: false,
  }, signal);
  const results = (data.results || []).map((r) => ({
    url: String(r.url || ''), title: String(r.title || ''), content: String(r.content || ''), score: Number(r.score) || 0,
  }));
  const credits = data.usage && data.usage.credits != null ? Number(data.usage.credits) : 1;
  return { results, credits: credits || 1 };
}

/* =====================================================================
 * The models' own restricted web search (Claude, OpenAI)
 * Returns { text, retrieved: [{url,title}], searches, searchError, usage }.
 * ===================================================================== */
async function builtinSearchApi({ provider, model, system, user, domains, maxSearches, signal }) {
  const p = PROVIDERS[provider];
  if (!p || !p.builtinSearch) throw new ProviderError(tr('{name}\'s own search isn\'t available here. Use Tavily search.', { name: providerName(provider) }), 400);
  const key = keyOrError(provider);
  const m = model || p.defaultModel;
  if (!validModel(m)) throw new ProviderError(tr('No model is chosen, or the model name is not valid.'), 400);
  const list = cleanDomains(domains, BUILTIN_DOMAIN_LIMIT[provider]);
  if (!list.length) throw new ProviderError(tr('No trusted domains were given.'), 400);
  const max = Math.max(1, Math.min(8, Number(maxSearches) || 4));
  const sys = String(system || '').slice(0, 60000);
  const usr = String(user || '').slice(0, 150000);

  const retrieved = new Map();
  const add = (url, title) => { if (url && !retrieved.has(url)) retrieved.set(url, { url, title: title || url }); };
  let searches = 0, text = '', error = null;
  const usage = { input_tokens: 0, output_tokens: 0 };
  const tally = (data) => { const u = usageOf(data); usage.input_tokens += u.input_tokens; usage.output_tokens += u.output_tokens; };

  if (provider === 'anthropic') {
    const messages = [{ role: 'user', content: usr }];
    for (let round = 0; round < 4; round++) {
      const data = await apiRequest('Anthropic Claude', 'POST', 'https://api.anthropic.com/v1/messages', anthropicHeaders(key), {
        model: m, max_tokens: 8000, system: sys, messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: max, allowed_domains: list }],
      }, signal);
      tally(data);
      (data.content || []).forEach((b) => {
        const type = b && b.type;
        if (type === 'server_tool_use' && b.name === 'web_search') searches++;
        if (type === 'web_search_tool_result') {
          if (Array.isArray(b.content)) b.content.forEach((r) => add(r.url || '', r.title || ''));
          else if (b.content && b.content.error_code) error = b.content.error_code;
        }
        if (type === 'text') {
          text += b.text;
          (b.citations || []).forEach((c) => add(c.url || '', c.title || ''));
        }
      });
      if (data.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: data.content });
    }
  } else {
    const hosts = [...new Set(list.map((d) => d.split('/')[0]))];
    const data = await apiRequest('OpenAI', 'POST', 'https://api.openai.com/v1/responses', { Authorization: `Bearer ${key}` }, {
      model: m, instructions: sys, input: usr,
      tools: [{ type: 'web_search', filters: { allowed_domains: hosts } }],
      include: ['web_search_call.action.sources'],
    }, signal);
    tally(data);
    (data.output || []).forEach((item) => {
      if (item.type === 'web_search_call') {
        searches++;
        ((item.action && item.action.sources) || []).forEach((s) => add(s.url || '', s.title || ''));
      }
      if (item.type === 'message') {
        (item.content || []).forEach((c) => {
          if (c.type !== 'output_text') return;
          text += c.text;
          (c.annotations || []).forEach((a) => add(a.url || '', a.title || ''));
        });
      }
    });
  }
  return { text, retrieved: [...retrieved.values()], searches, searchError: error, usage };
}

/* =====================================================================
 * Balances (read with your keys where the service allows it)
 * ===================================================================== */
async function balancesApi(provider, needsTavily) {
  const billing = {
    gemini: 'https://aistudio.google.com', groq: 'https://console.groq.com', mistral: 'https://console.mistral.ai',
    openai: 'https://platform.openai.com', anthropic: 'https://platform.claude.com', openrouter: 'https://openrouter.ai/settings/credits',
  };
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const items = [];
  const name = providerName(provider);
  const key = SettingsFile.key(provider);

  if (provider === 'org') {
    try {
      const info = await orgConnect(orgBase(), key, { save: false });
      const u = info.usage;
      if (u) {
        const left = Math.max(0, u.calls.limit - u.calls.used), sl = Math.max(0, u.searches.limit - u.searches.used);
        items.push({ name, text: tr('{label}: {left} of {limit} model calls and {sleft} of {slimit} searches left today.', { label: esc(info.label || tr('Your code')), left: num(left), limit: num(u.calls.limit), sleft: num(sl), slimit: num(u.searches.limit) }), pct: u.calls.limit ? Math.min(left / u.calls.limit, u.searches.limit ? sl / u.searches.limit : 1) : null });
      } else items.push({ name, text: tr('Connected. This server doesn\'t report usage.'), tone: 'none' });
    } catch (err) {
      items.push({ name, text: tr('Couldn\'t read usage: {message}', { message: err.message }), tone: 'bad' });
    }
    return items;
  }
  if (!key) {
    items.push({ name, text: tr('No API key yet for this provider.'), tone: 'none' });
  } else if (provider === 'openrouter') {
    try {
      const d = (await apiRequest('OpenRouter', 'GET', 'https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${key}` })).data || {};
      const bits = [];
      let pct = null;
      if (d.limit_remaining != null && d.limit != null) {
        bits.push(d.limit_reset ? tr('{left} of {limit} left on this key (resets {reset})', { left: money(d.limit_remaining), limit: money(d.limit), reset: d.limit_reset }) : tr('{left} of {limit} left on this key', { left: money(d.limit_remaining), limit: money(d.limit) }));
        pct = d.limit ? d.limit_remaining / d.limit : null;
      } else {
        bits.push(d.usage_monthly != null ? tr('{used} used by this key, {month} this month; no spending limit set', { used: money(d.usage), month: money(d.usage_monthly) }) : tr('{used} used by this key; no spending limit set', { used: money(d.usage) }));
      }
      if (d.is_free_tier) bits.push(tr('free tier'));
      items.push({ name: 'OpenRouter', text: bits.join('; '), pct, link: billing.openrouter });
    } catch (err) {
      items.push({ name: 'OpenRouter', text: tr('Couldn\'t read usage: {message}', { message: err.message }), tone: 'bad', link: billing.openrouter });
    }
  } else {
    items.push({ name, text: tr('{name} doesn\'t let apps read the balance. Check it on their site; each result here shows the tokens it used.', { name }), tone: 'none', link: billing[provider] || '' });
  }

  if (needsTavily) {
    const tk = SettingsFile.key('tavily');
    if (!tk) {
      items.push({ name: 'Tavily', text: tr('No Tavily key yet.'), tone: 'none' });
    } else {
      try {
        const d = await apiRequest('Tavily', 'GET', 'https://api.tavily.com/usage', { Authorization: `Bearer ${tk}` });
        const acc = d.account || {};
        const k = d.key || {};
        const limit = acc.plan_limit ?? k.limit ?? null;
        const used = acc.plan_usage ?? k.usage ?? 0;
        if (limit != null) {
          const left = Math.max(0, limit - used);
          items.push({ name: 'Tavily', text: acc.current_plan ? tr('{left} of {limit} search credits left this month ({plan} plan)', { left: num(left), limit: num(limit), plan: acc.current_plan }) : tr('{left} of {limit} search credits left this month', { left: num(left), limit: num(limit) }), pct: limit ? left / limit : null, link: 'https://app.tavily.com' });
        } else {
          items.push({ name: 'Tavily', text: tr('{used} credits used this month; no limit reported', { used: num(used) }), link: 'https://app.tavily.com' });
        }
      } catch (err) {
        items.push({ name: 'Tavily', text: tr('Couldn\'t read usage: {message}', { message: err.message }), tone: 'bad', link: 'https://app.tavily.com' });
      }
    }
  }
  return items;
}

/* =====================================================================
 * An organisation's Evaluator server
 * ===================================================================== */
/**
 * Checks a server address and access code (GET /v1/info) and, unless
 * `save` is false, stores what the server offers in the settings file.
 * Returns the server's answer.
 */
async function orgConnect(url, code, { save = true } = {}) {
  const base = String(url || '').trim().replace(/\/+$/, '').replace(/\/v1(\/info)?$/, '');
  if (!/^https:\/\/[^\s]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?$/i.test(base)) throw new ProviderError(tr('Enter the server\'s address, starting with https://.'), 400);
  const name = (() => { try { return new URL(base).host; } catch { return base; } })();
  let info;
  try {
    info = await apiRequest(name, 'GET', `${base}/v1/info`, code ? { Authorization: `Bearer ${code}` } : {});
  } catch (err) {
    if (err.httpStatus === 401) throw new ProviderError(tr('That access code isn\'t valid. Check it with whoever gave it to you.'), 401);
    if (err.httpStatus === 403) throw new ProviderError(tr('That server doesn\'t accept this copy of Evaluator ({origin}). Ask whoever runs it to allow this address.', { origin: location.origin }), 403);
    throw err;
  }
  if (!info || info.service !== 'evaluator-server') throw new ProviderError(tr('That address doesn\'t look like an Evaluator server.'), 400);
  if (!info.open && !code) throw new ProviderError(tr('This server needs an access code. Ask whoever runs it for one.'), 401);
  if (save) {
    SettingsFile.update({
      org: { url: base, name: String(info.name || ''), note: String(info.note || ''), models: Array.isArray(info.models) ? info.models : [], defaultModel: String(info.defaultModel || ''), json: info.json !== false, images: info.images !== false, open: Boolean(info.open) },
      keys: { org: code || '' }, provider: 'org', search: 'tavily',
      models: { org: String(info.defaultModel || '') },
    });
  }
  return info;
}
