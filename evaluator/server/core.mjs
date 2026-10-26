/* Evaluator organisation server: the request handler.
 *
 * A small relay that lets a school, college or group give its members
 * Evaluator without each person getting their own keys. It holds the
 * organisation's AI and Tavily keys, and passes on only what Evaluator needs:
 *
 *   GET  /v1/info               name, models, limits (and, with a code, what is left today)
 *   GET  /v1/models             the models members may use
 *   POST /v1/chat/completions   OpenAI-style chat, sent to the configured AI service
 *   POST /tavily/search         Tavily search, restricted to the trusted domains sent
 *   POST /tavily/extract        Tavily extract (the claim finder's "Web link")
 *
 * Members are told apart by access codes (one per class or group), each with
 * a daily allowance. Requests are checked and rebuilt field by field: nothing
 * else reaches the AI service or Tavily, and the keys never leave the server.
 *
 * Written against the standard Fetch API (Request/Response), so the same code
 * runs on Node.js 18+ (node.mjs) and Cloudflare Workers (worker.mjs).
 * Configuration comes from environment variables; see README.md.
 */

const GEMINI_OPENAI = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const TAVILY = 'https://api.tavily.com';
const DAY = 86400;

/** Reads and checks the configuration once. */
export function loadConfig(env = {}) {
  const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
  const codes = new Map();
  let open = false;
  for (const item of list(env.ACCESS_CODES)) {
    if (item === '*') { open = true; continue; }
    const [code, ...label] = item.split(':');
    if (code.length >= 6) codes.set(code, label.join(':').trim() || code.slice(0, 3) + '…');
  }
  const models = list(env.MODELS || 'gemini-2.5-flash,gemini-2.5-flash-lite');
  return {
    name: String(env.NAME || 'Evaluator server').slice(0, 80),
    note: String(env.NOTE || '').slice(0, 300),
    upstream: env.UPSTREAM_CHAT_URL || GEMINI_OPENAI,
    upstreamKey: env.UPSTREAM_KEY || '',
    upstreamJson: String(env.UPSTREAM_JSON || 'true') !== 'false',
    images: String(env.IMAGES || 'true') !== 'false',
    models,
    tavilyKey: env.TAVILY_KEY || '',
    tavily: (env.TAVILY_URL || TAVILY).replace(/\/+$/, ''),
    codes, open,
    dailyCalls: int(env.DAILY_CALLS, 300),
    dailySearches: int(env.DAILY_SEARCHES, 120),
    dailyTotal: int(env.DAILY_TOTAL_CALLS, 6000),
    origins: list(env.ALLOWED_ORIGINS),
    maxTokens: int(env.MAX_TOKENS, 8000),
  };
}

/** Problems that would stop the server working, for the start-up log. */
export function configProblems(c) {
  const p = [];
  if (!c.upstreamKey) p.push('UPSTREAM_KEY is not set: chat requests will fail.');
  if (!c.tavilyKey) p.push('TAVILY_KEY is not set: searches will fail.');
  if (!c.open && !c.codes.size) p.push('ACCESS_CODES has no codes (each at least 6 characters), so nobody can use the server. Use "*" for an open server.');
  if (!c.origins.length) p.push('ALLOWED_ORIGINS is empty: browsers on other sites will be refused. Set it to the address the app is served from.');
  if (c.origins.includes('*')) p.push('ALLOWED_ORIGINS is "*": any website can use this server with a valid code.');
  return p;
}

/** In-memory counters (one process). The Worker can pass a KV-backed store instead. */
export function memoryStore() {
  const m = new Map();
  return {
    async incr(key, by, ttl) {
      const now = Date.now();
      const e = m.get(key);
      const v = (e && e.exp > now ? e.v : 0) + by;
      m.set(key, { v, exp: e && e.exp > now ? e.exp : now + ttl * 1000 });
      if (m.size > 50000) for (const [k, x] of m) if (x.exp <= now) m.delete(k);
      return v;
    },
    async get(key) { const e = m.get(key); return e && e.exp > Date.now() ? e.v : 0; },
  };
}

const today = () => new Date().toISOString().slice(0, 10);

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
const fail = (status, message, headers) => json(status, { error: { message } }, headers);

function cors(c, origin) {
  if (!origin) return {};
  const ok = c.origins.includes('*') || c.origins.includes(origin);
  if (!ok) return null;
  return {
    'access-control-allow-origin': c.origins.includes('*') ? '*' : origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

/** Who is asking: { id, label } or null. Open servers count by network address. */
function who(c, request, clientIp) {
  const auth = request.headers.get('authorization') || '';
  const code = auth.replace(/^Bearer\s+/i, '').trim();
  if (code && c.codes.has(code)) return { id: `c:${code}`, label: c.codes.get(code) };
  if (code && !c.codes.has(code) && !c.open) return null;
  if (c.open) return { id: `ip:${clientIp || 'unknown'}`, label: '' };
  return null;
}

async function readJson(request, max) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > max) throw Object.assign(new Error('Request too large.'), { status: 413 });
  const text = await request.text();
  if (text.length > max) throw Object.assign(new Error('Request too large.'), { status: 413 });
  try { const v = JSON.parse(text); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* below */ }
  throw Object.assign(new Error('The request body must be a JSON object.'), { status: 400 });
}

const DOMAIN_RE = /^[a-z0-9.-]{1,253}(\/[A-Za-z0-9._~%\-/]*)?$/;

/** Only text and (if allowed) image parts, in the two roles Evaluator uses. */
function cleanMessages(c, messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 4) throw Object.assign(new Error('messages must be a short list.'), { status: 400 });
  return messages.map((m) => {
    const role = m && (m.role === 'system' || m.role === 'user' || m.role === 'assistant') ? m.role : null;
    if (!role) throw Object.assign(new Error('Unknown message role.'), { status: 400 });
    if (typeof m.content === 'string') return { role, content: m.content.slice(0, 160000) };
    if (!Array.isArray(m.content)) throw Object.assign(new Error('Message content must be text.'), { status: 400 });
    const parts = m.content.slice(0, 4).map((p) => {
      if (p && p.type === 'text') return { type: 'text', text: String(p.text || '').slice(0, 160000) };
      if (p && p.type === 'image_url' && c.images) {
        const url = String((p.image_url && p.image_url.url) || '');
        if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url) || url.length > 4_000_000) throw Object.assign(new Error('Images must be PNG, JPEG, WebP or GIF, under 3 MB.'), { status: 400 });
        return { type: 'image_url', image_url: { url } };
      }
      throw Object.assign(new Error(c.images ? 'Unsupported message part.' : 'This server does not accept pictures.'), { status: 400 });
    });
    return { role, content: parts };
  });
}

async function upstream(url, key, body, signal) {
  const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: { message: `The service returned something unexpected (${res.status}).` } }; }
  return { status: res.status, data };
}

/**
 * Handles one request. `store` keeps the daily counts; `clientIp` is used
 * only to count requests on open servers.
 */
export async function handle(request, c, store, clientIp = '') {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const ch = cors(c, request.headers.get('origin'));
  if (ch === null) return fail(403, 'This website is not allowed to use this server.');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });
  const reply = (status, body) => json(status, body, ch);
  const err = (status, message) => fail(status, message, ch);

  if (path === '/' && request.method === 'GET') return reply(200, { service: 'evaluator-server', name: c.name, info: '/v1/info' });

  const user = who(c, request, clientIp);
  const day = today();
  const usage = async (u) => ({
    calls: { used: await store.get(`calls:${day}:${u.id}`), limit: c.dailyCalls },
    searches: { used: await store.get(`search:${day}:${u.id}`), limit: c.dailySearches },
  });

  if (path === '/v1/info' && request.method === 'GET') {
    const hasCode = Boolean(request.headers.get('authorization'));
    if (hasCode && !user) return err(401, 'That access code isn\'t valid. Check it with whoever gave it to you.');
    return reply(200, {
      service: 'evaluator-server', version: 1, name: c.name, note: c.note, open: c.open,
      models: c.models, defaultModel: c.models[0] || '', json: c.upstreamJson, images: c.images, search: Boolean(c.tavilyKey),
      ...(user ? { label: user.label, usage: await usage(user), resets: `${day}T23:59:59Z` } : {}),
    });
  }

  if (!user) return err(401, c.open ? 'That access code isn\'t valid.' : 'This server needs an access code. Ask whoever runs it for one.');

  if (path === '/v1/models' && request.method === 'GET') return reply(200, { object: 'list', data: c.models.map((id) => ({ id, object: 'model' })) });

  try {
    if (path === '/v1/chat/completions' && request.method === 'POST') {
      const body = await readJson(request, 6_000_000);
      const model = body.model ? String(body.model) : c.models[0];
      if (!c.models.includes(model)) return err(400, `Model "${model.slice(0, 80)}" isn't offered here. Use one of: ${c.models.join(', ')}.`);
      const messages = cleanMessages(c, body.messages);
      if (await store.get(`calls:${day}:${user.id}`) >= c.dailyCalls) return err(429, `Today's allowance for this code (${c.dailyCalls} model calls) is used up. It resets at midnight UTC.`);
      if (await store.get(`calls:${day}:all`) >= c.dailyTotal) return err(429, 'The server has reached its limit for today. Try again tomorrow.');
      await store.incr(`calls:${day}:${user.id}`, 1, DAY + 3600);
      await store.incr(`calls:${day}:all`, 1, DAY + 3600);
      const out = { model, messages, max_tokens: Math.min(Number(body.max_tokens) || c.maxTokens, c.maxTokens) };
      if (c.upstreamJson && body.response_format && body.response_format.type === 'json_object') out.response_format = { type: 'json_object' };
      if (['none', 'low', 'medium', 'high'].includes(body.reasoning_effort)) out.reasoning_effort = body.reasoning_effort;
      const r = await upstream(c.upstream, c.upstreamKey, out, request.signal);
      if (r.status >= 400) return reply(r.status === 401 || r.status === 403 ? 502 : r.status, { error: { message: `The AI service returned an error (${r.status})${r.data && r.data.error && r.data.error.message ? `: ${String(r.data.error.message).slice(0, 300)}` : '.'}` } });
      const d = r.data || {};
      return reply(200, { id: d.id, object: 'chat.completion', model, choices: (d.choices || []).slice(0, 1).map((x) => ({ index: 0, message: { role: 'assistant', content: x && x.message ? x.message.content : '' }, finish_reason: x && x.finish_reason })), usage: d.usage });
    }

    if ((path === '/tavily/search' || path === '/tavily/extract') && request.method === 'POST') {
      const body = await readJson(request, 50_000);
      if (await store.get(`search:${day}:${user.id}`) >= c.dailySearches) return err(429, `Today's search allowance for this code (${c.dailySearches}) is used up. It resets at midnight UTC.`);
      let out;
      if (path === '/tavily/search') {
        const query = String(body.query || '').trim().slice(0, 400);
        const domains = (Array.isArray(body.include_domains) ? body.include_domains : []).map((d) => String(d).trim().toLowerCase()).filter((d) => DOMAIN_RE.test(d)).slice(0, 300);
        // Searches are only allowed within trusted domains: this is not a general web search.
        if (!query || !domains.length) return err(400, 'A search needs a query and at least one trusted domain.');
        out = { query, include_domains: domains, search_depth: 'basic', max_results: Math.min(Number(body.max_results) || 6, 10), include_answer: false, include_raw_content: false };
      } else {
        const urls = (Array.isArray(body.urls) ? body.urls : []).map(String).filter((u) => /^https?:\/\/[^\s]{3,2000}$/.test(u)).slice(0, 5);
        if (!urls.length) return err(400, 'Give at least one web address to read.');
        out = { urls, extract_depth: 'basic' };
      }
      await store.incr(`search:${day}:${user.id}`, 1, DAY + 3600);
      const res = await fetch(`${c.tavily}${path.replace('/tavily', '')}`, { method: 'POST', headers: { authorization: `Bearer ${c.tavilyKey}`, 'content-type': 'application/json' }, body: JSON.stringify(out), signal: request.signal });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = {}; }
      if (!res.ok) return reply(res.status === 401 || res.status === 403 ? 502 : res.status, { error: { message: `The search service returned an error (${res.status}).` } });
      return reply(200, path === '/tavily/search'
        ? { results: (data.results || []).map((x) => ({ url: x.url, title: x.title, content: x.content, score: x.score })), usage: { credits: 1 } }
        : { results: (data.results || []).map((x) => ({ url: x.url, raw_content: String(x.raw_content || '').slice(0, 60000) })), failed_results: data.failed_results || [] });
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return err(499, 'Cancelled.');
    return err(e && e.status ? e.status : 502, e && e.status ? e.message : 'The server couldn\'t reach the service. Try again.');
  }

  return err(404, 'Not found.');
}
