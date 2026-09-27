/* Evaluator: providers.js
 *
 * AI providers: the provider list, HTTP helpers and errors, the token and
 * credit meter, chat() for one model call, and listModels().
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
  if (!res.ok) throw new ProviderError(explainHttp(providerName, res.status, data), res.status);
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

/**
 * Hints that make small steps faster: less "thinking" on models that think
 * before answering. Models that don't accept a hint get a 400, and the call
 * is retried without it (and the model is remembered for the session).
 */
const noHint = new Set();
function lightHints(provider, model) {
  if (noHint.has(`${provider}|${model}`)) return null;
  const m = model.toLowerCase();
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

/** One plain model call: system + user in, text out. `light` asks for a quick answer. */
async function chat({ provider, key, model, system, user, json, signal, light }) {
  const hints = light ? lightHints(provider, model) : null;
  try {
    return await chatOnce({ provider, key, model, system, user, json, signal, hints });
  } catch (err) {
    if (hints && err.status === 400) {
      noHint.add(`${provider}|${model}`);
      return chatOnce({ provider, key, model, system, user, json, signal, hints: null });
    }
    throw err;
  }
}

async function chatOnce({ provider, key, model, system, user, json, signal, hints }) {
  const p = PROVIDERS[provider];
  if (provider === 'anthropic') {
    const data = await postJson(p.name, 'https://api.anthropic.com/v1/messages', anthropicHeaders(key),
      { model, max_tokens: 8000, system, messages: [{ role: 'user', content: user }] }, signal);
    meter.record(data);
    return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }
  if (provider === 'gemini') {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { ...(json ? { responseMimeType: 'application/json' } : {}), ...(hints || {}) },
    };
    const data = await postJson(p.name, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': key }, body, signal);
    meter.record(data);
    const cand = data.candidates && data.candidates[0];
    if (!cand || !cand.content) throw new ProviderError(`Gemini returned no answer${cand && cand.finishReason ? ` (${cand.finishReason})` : ''}. Try again or pick another model.`);
    return cand.content.parts.filter((x) => !x.thought).map((x) => x.text || '').join('');
  }
  // OpenAI-compatible chat completions: OpenAI, Groq, OpenRouter, Mistral
  const headers = { Authorization: `Bearer ${key}` };
  if (provider === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'Evaluator'; }
  const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...(hints || {}) };
  if (json && p.jsonMode) body.response_format = { type: 'json_object' };
  const data = await postJson(p.name, p.chatUrl, headers, body, signal);
  meter.record(data);
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
