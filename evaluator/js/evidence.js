/* Evaluator: evidence.js
 *
 * Evidence gathering: Tavily searches, local-file search, the evidence
 * cache, and the models' own restricted web search (Claude, OpenAI).
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/* =====================================================================
 * Evidence gathering
 * ===================================================================== */
/** One Tavily search, sent straight to Tavily with the key in the settings file. */
async function tavilySearch(query, domains, signal) {
  const data = await tavilyApi(query, domains, signal);
  meter.searchCredits += Number(data.credits) || 1;
  return Array.isArray(data.results) ? data.results : [];
}

/** Local passages as evidence pages. */
async function localPages(scope, queries, limit, progress) {
  if (!scope.local.length) return [];
  if (progress) progress('Searching your local files…');
  const hits = await TracerLocal.search(scope.local, queries, limit);
  return hits.map((c) => ({
    url: `local://${encodeURIComponent(c.libraryId)}/${encodeURIComponent(c.file)}#${encodeURIComponent(c.loc)}`,
    title: `${c.file}, ${c.loc}`, content: c.text.slice(0, EXCERPT_CHARS), local: true, score: c.score,
  }));
}

/* ---------- Evidence packs: gathered once per statement and scope, reused for a few hours ---------- */
const PACK_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PASSAGES = 15;
const EXCERPT_CHARS = 1000;

function packKey(statement, scope, cfg, intent) {
  const norm = statement.toLowerCase().replace(/\s+/g, ' ').replace(/[.?!\s]+$/, '').trim();
  const web = scope.web.map((s) => s.domain).sort().join(',');
  const local = scope.local.map((l) => `${l.id}@${l.updatedAt}`).sort().join(',');
  return [intent, norm, scope.topic ? scope.topic.id : '*', web, local, cfg.maxSearches].join('|');
}

function hydratePack(stored) {
  const pages = stored.pages;
  return {
    pages, searches: stored.searches, queries: stored.queries, createdAt: stored.createdAt,
    ids: new Map(pages.map((p, i) => [`S${i + 1}`, p])),
    found: new Map(pages.map((p) => [normaliseUrl(p.url), p])),
  };
}

async function cachedPack(key) {
  try {
    const row = await TracerLocal.store.getPack(key);
    if (row && Date.now() - row.savedAt < PACK_TTL_MS) return { ...hydratePack(row.pack), reused: true, intent: key.split('|')[0] };
  } catch { /* storage unavailable: no cache */ }
  return null;
}

function savePack(key, pack) {
  const { pages, searches, queries, createdAt } = pack;
  TracerLocal.store.putPack(key, { pages, searches, queries, createdAt }, PACK_TTL_MS).catch(() => {});
}

/**
 * "Evaluate" can reuse evidence from earlier Support and Challenge runs:
 * when both one-sided packs are cached, they are merged (alternating, so
 * neither side dominates) instead of searching again.
 */
async function mergedOwnSidePacks(statement, scope, cfg) {
  const [a, b] = await Promise.all([cachedPack(packKey(statement, scope, cfg, 'support')), cachedPack(packKey(statement, scope, cfg, 'contest'))]);
  if (!a || !b) return null;
  const seen = new Set();
  const pages = [];
  for (let i = 0; pages.length < MAX_PASSAGES && (i < a.pages.length || i < b.pages.length); i++) {
    [a.pages[i], b.pages[i]].forEach((p) => {
      if (!p || pages.length >= MAX_PASSAGES) return;
      const k = normaliseUrl(p.url);
      if (seen.has(k)) return;
      seen.add(k); pages.push(p);
    });
  }
  const older = a.createdAt < b.createdAt ? a.createdAt : b.createdAt;
  return { ...hydratePack({ pages, searches: 0, queries: [...a.queries, ...b.queries], createdAt: older }), reused: true, intent: 'merged' };
}

/** Runs async jobs with at most `limit` in flight. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Drops passages that say nearly the same thing as one already kept. */
function dedupePassages(pages) {
  const kept = [];
  const sets = [];
  for (const p of pages) {
    const set = new Set(TracerLocal.tokens(p.content));
    const dup = sets.some((o) => {
      if (!set.size || !o.size) return false;
      let inter = 0;
      set.forEach((t) => { if (o.has(t)) inter++; });
      return inter / (set.size + o.size - inter) >= 0.8;
    });
    if (!dup) { kept.push(p); sets.push(set); }
  }
  return kept;
}

/**
 * Evidence for a statement: plans queries (with the fast helper model),
 * searches the trusted websites and local folders at the same time, drops
 * near-duplicates and keeps the most relevant passages. Reuses a pack
 * gathered for the same statement and scope within the last few hours.
 */
async function gatherPack({ cfg, statement, queries, scope, signal, progress, fresh, intent = 'both' }) {
  const key = packKey(statement, scope, cfg, intent);
  if (!fresh) {
    const hit = await cachedPack(key);
    if (hit) { progress(`Reusing the ${intent === 'both' ? '' : `${intent === 'support' ? 'supporting' : 'challenging'} `}evidence gathered for this statement earlier…`); return hit; }
  }
  if (!queries || !queries.length) {
    progress('Planning searches…');
    const planText = await chat({
      ...cfg, model: cfg.helperModel || cfg.model, light: true, system: QUERY_SYSTEM, json: true, signal,
      user: `Write ${cfg.maxSearches} short web search queries (under 10 words each) ${INTENTS[intent]}. Cover its distinct claims (people, places, dates, events, measurements) and include one query on the scholarly or scientific debate.\n\nStatement: """${statement}"""`,
    });
    const plan = extractJson(planText, 'queries');
    queries = plan && Array.isArray(plan.queries) ? plan.queries.map(String).filter(Boolean) : [];
  }
  if (!queries.length) queries = [statement];
  queries = [...new Set(queries)].slice(0, cfg.maxSearches);

  let done = 0;
  const webJob = scope.web.length ? (async () => {
    const domains = [...new Set(scope.web.map((s) => s.domain.split('/')[0]))];
    progress(`Searching your trusted websites (${queries.length} searches at once)…`);
    const lists = await pool(queries, 4, async (q) => {
      const r = await tavilySearch(q, domains, signal);
      done++;
      progress(`Searching your trusted websites (${done} of ${queries.length} done)…`);
      return r;
    });
    const best = new Map();
    lists.flat().forEach((r) => {
      const k = r.url && normaliseUrl(r.url);
      if (!k || !matchTrustedSource(r.url, scope.web)) return;
      const score = Number(r.score) || 0;
      const prev = best.get(k);
      if (!prev || score > prev.score) best.set(k, { url: r.url, title: r.title || r.url, content: String(r.content || '').slice(0, EXCERPT_CHARS), score });
    });
    return [...best.values()].sort((a, b) => b.score - a.score);
  })() : Promise.resolve([]);
  const localJob = localPages(scope, [statement, ...queries], 10, null);
  const [webAll, localAll] = await Promise.all([webJob, localJob]);

  // Keep the most relevant passages, sharing the budget between web and local.
  const web = dedupePassages(webAll);
  const localKept = dedupePassages(localAll);
  const localQuota = Math.min(localKept.length, web.length ? 4 : MAX_PASSAGES);
  const webQuota = Math.min(web.length, MAX_PASSAGES - localQuota);
  const pages = [...web.slice(0, webQuota), ...localKept.slice(0, Math.min(localKept.length, MAX_PASSAGES - webQuota))]
    .map(({ score, ...p }) => p);

  const pack = { ...hydratePack({ pages, searches: scope.web.length ? queries.length : 0, queries, createdAt: new Date().toISOString() }), reused: false, intent };
  if (pages.length) savePack(key, pack);
  return pack;
}

function packListing(pack, match) {
  return pack.pages.map((p, i) => {
    const t = match(p.url);
    return `[S${i + 1}] ${p.title}\n${p.local ? 'Local file' : `URL: ${p.url}`}\nSource: ${t ? `${t.label} (${t.category})` : 'unknown'}\nExcerpt: ${p.content}`;
  }).join('\n\n');
}

function packResolver(pack) {
  return (r) => (typeof r === 'string' ? pack.ids.get(r) || null : (r && r.url ? pack.found.get(normaliseUrl(r.url)) || null : null));
}

/** One call to Claude's or OpenAI's own restricted web search, sent straight to the provider. */
async function builtinSearchCall({ cfg, system, user, scope, signal }) {
  const data = await builtinSearchApi({
    provider: cfg.provider, model: cfg.model, system, user, maxSearches: cfg.maxSearches, domains: scope.web.map((s) => s.domain), signal,
  });
  meter.record(data);
  const retrieved = new Map();
  (data.retrieved || []).forEach((r) => {
    if (r && r.url && !retrieved.has(normaliseUrl(r.url))) retrieved.set(normaliseUrl(r.url), { url: r.url, title: r.title || r.url });
  });
  return { text: String(data.text || ''), retrieved, searches: Number(data.searches) || 0, searchError: data.searchError || null };
}

function localBlock(pages) {
  if (!pages.length) return '';
  return `\n\nPassages from the user's own files (cite these as [L1], [L2], ...):\n\n${pages.map((p, i) => `[L${i + 1}] ${p.title}\nExcerpt: ${p.content}`).join('\n\n')}`;
}

/** Resolver for built-in search: ids declared in "sources" (checked against what the search returned) plus local L ids. */
function builtinResolver(parsed, retrieved, local) {
  const declared = new Map();
  (Array.isArray(parsed.sources) ? parsed.sources : []).forEach((s) => {
    if (s && s.id && s.url) declared.set(String(s.id).trim().toUpperCase(), String(s.url));
  });
  const localIds = new Map(local.map((p, i) => [`L${i + 1}`, p]));
  const localUrls = new Map(local.map((p) => [normaliseUrl(p.url), p]));
  return (r) => {
    if (typeof r === 'string') {
      if (localIds.has(r)) return localIds.get(r);
      const url = declared.get(r);
      return url ? retrieved.get(normaliseUrl(url)) || null : null;
    }
    if (r && r.url) return retrieved.get(normaliseUrl(r.url)) || localUrls.get(normaliseUrl(r.url)) || null;
    return null;
  };
}

function builtinFailure(out) {
  if (out.searchError) return new ProviderError(`The web search failed (${out.searchError}). Check that web search is enabled for your account with the provider.`);
  return null;
}
