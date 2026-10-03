/* Evaluator: citations.js
 *
 * Reading model answers, and the citation system: every cited page gets a
 * number and every site or local file a colour; citations that don't match
 * a retrieved trusted page are removed.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/* =====================================================================
 * Parsing helpers
 * ===================================================================== */
function normaliseUrl(raw) {
  if (typeof raw === 'string' && raw.startsWith('local://')) return raw;
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

/** Accepts a page if it is on a trusted site in scope, or from a local folder in scope. */
function scopeMatcher(scope) {
  return (url) => {
    if (typeof url === 'string' && url.startsWith('local://')) {
      const [idPart, filePart = ''] = url.slice(8).split('#')[0].split('/');
      const id = decodeURIComponent(idPart);
      const file = decodeURIComponent(filePart);
      const lib = scope.local.find((l) => l.id === id);
      // Each local file is its own source, so it gets its own colour.
      return lib ? { label: file.split('/').pop() || lib.name, domain: `local:${lib.id}/${file}`, category: 'local', folder: lib.name } : null;
    }
    return matchTrustedSource(url, scope.web);
  };
}

function extractJson(text, requiredKey) {
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

function parseOrThrow(text, key, what) {
  const parsed = extractJson(text, key);
  if (!parsed) throw new ProviderError(`The model's ${what} couldn't be read. Run it again, or pick a larger model in Settings.`);
  return parsed;
}

/* =====================================================================
 * Citations: one numbering and colour scheme shared by a whole result
 * ===================================================================== */
const MARKER_RE = /\[\s*((?:S|L)\d+(?:\s*[,;]\s*(?:S|L)?\d+)*)\s*\]/gi;
const REF_RE = /\[\^(\d+(?:,\d+)*)\]/g;

/**
 * `resolve(ref)` (supplied per model call) turns an id like "S3" or {url}
 * into { url, title, content?, local? } for a page the search returned, or null.
 * Pages outside the scope are refused. Accepted pages get a number; each
 * site or local folder gets a colour.
 */
function makeCitations(match) {
  const pages = [], sites = [], byUrl = new Map(), idCache = new WeakMap();
  const dropped = { evidence: 0, markers: 0, arguments: 0 };

  function lookup(resolve, ref) {
    if (!ref) return null;
    if (typeof ref === 'object') {
      const id = String(ref.source || ref.id || '').trim().replace(/^\[|\]$/g, '').toUpperCase();
      return (id && resolve(id)) || (ref.url ? resolve({ url: ref.url }) : null);
    }
    let id = String(ref).trim().toUpperCase();
    if (/^\d+$/.test(id)) id = `S${id}`;
    return resolve(id);
  }
  function number(hit) {
    if (!hit) return null;
    const trusted = match(hit.url);
    if (!trusted) return null;
    const key = normaliseUrl(hit.url);
    if (byUrl.has(key)) return byUrl.get(key);
    let site = sites.findIndex((s) => s.domain === trusted.domain);
    if (site === -1) {
      site = sites.length;
      sites.push({ domain: trusted.domain, label: trusted.label, category: trusted.category, folder: trusted.folder, color: site % 8 });
    }
    const n = pages.length + 1;
    const page = { n, url: hit.url, title: hit.title || hit.url, site };
    if (hit.local) { page.local = true; page.passage = String(hit.content || '').slice(0, 1400); }
    pages.push(page);
    byUrl.set(key, n);
    return n;
  }
  function ref(resolve, r) {
    if (!idCache.has(resolve)) idCache.set(resolve, new Map());
    const cache = idCache.get(resolve);
    const key = typeof r === 'string' ? r.trim().toUpperCase() : null;
    if (key && cache.has(key)) return cache.get(key);
    const n = number(lookup(resolve, r));
    if (key) cache.set(key, n);
    return n;
  }
  function mark(text, resolve) {
    return String(text || '').replace(MARKER_RE, (m, ids) => {
      let prefix = 'S';
      const ns = [...new Set(ids.split(/[,;]/).map((x) => {
        let id = x.trim().toUpperCase();
        if (/^[SL]/.test(id)) prefix = id[0]; else id = `${prefix}${id}`;
        return ref(resolve, id);
      }).filter(Boolean))];
      if (!ns.length) { dropped.markers++; return ''; }
      return `[^${ns.join(',')}]`;
    }).replace(/\s+([.,;:])/g, '$1');
  }
  const unmark = (text) => String(text || '').replace(MARKER_RE, '').replace(/\s+([.,;:])/g, '$1').trim();
  function usable(resolve, ev) {
    const hit = ev && lookup(resolve, ev);
    const ok = Boolean(hit && match(hit.url));
    if (!ok) dropped.evidence++;
    return ok;
  }

  /** A support or contest case. */
  function argumentSide(parsed, resolve) {
    const summary = mark(parsed.summary, resolve);
    const args = [];
    (Array.isArray(parsed.arguments) ? parsed.arguments : []).forEach((a) => {
      const evs = (Array.isArray(a.evidence) ? a.evidence : []).filter((ev) => usable(resolve, ev));
      if (!evs.length) { dropped.arguments++; return; }
      const reasoning = mark(a.reasoning, resolve);
      args.push({
        point: String(a.point || ''), reasoning,
        evidence: evs.map((ev) => ({
          n: number(lookup(resolve, ev)), excerpt: String(ev.excerpt || ''),
          sourceType: ['primary', 'secondary'].includes(ev.sourceType) ? ev.sourceType : 'unknown',
        })),
      });
    });
    const verdicts = ['strong', 'moderate', 'weak', 'insufficient'];
    return {
      summary,
      verdict: args.length ? (verdicts.includes(parsed.verdict) ? parsed.verdict : 'moderate') : 'insufficient',
      verdictReason: String(parsed.verdictReason || ''),
      claims: Array.isArray(parsed.claims) ? parsed.claims.map(String) : [],
      arguments: args,
      counterConsiderations: (Array.isArray(parsed.counterConsiderations) ? parsed.counterConsiderations : []).map((c) => mark(c, resolve)),
      gaps: unmark(parsed.gaps),
    };
  }

  return { pages, sites, dropped, mark, unmark, usable, lookup, number, argumentSide };
}

/** Lets the judge cite the numbers already in the report as S1, S2, ... */
function numberResolver(cites) {
  return (r) => {
    if (typeof r !== 'string') return null;
    const n = Number(r.replace(/^S/, ''));
    const p = cites.pages[n - 1];
    return p ? { url: p.url, title: p.title, local: p.local, content: p.passage } : null;
  };
}
