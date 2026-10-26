/* Evaluator: share.js
 *
 * Sharing without a server. A result, a class assignment or a submission is
 * packed into the link itself: JSON, compressed (deflate) and written as
 * base64url after "#report=", "#class=" or "#submission=". Nothing is
 * uploaded anywhere; whoever has the link has the data. Links can also be
 * saved as files.
 *
 * Anything that arrives this way is untrusted: sanitizeResult() rebuilds a
 * result field by field, so only expected values (and escaped text) reach
 * the page.
 *
 * Also here: the tool dialog shared by Share, Cite and Second opinion, and
 * "Save as web page".
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/* =====================================================================
 * Packing data into links
 * ===================================================================== */
const b64url = {
  enc(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(text) {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

async function streamBytes(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** Object -> "1.<deflated base64url>" (or "0.<plain base64url>" where the browser can't compress). */
async function packData(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    try { return `1.${b64url.enc(await streamBytes(raw, new CompressionStream('deflate-raw')))}`; } catch { /* fall through */ }
  }
  return `0.${b64url.enc(raw)}`;
}

async function unpackData(code) {
  const m = /^([01])\.([A-Za-z0-9_-]+)$/.exec(String(code || '').trim());
  if (!m) throw new Error(tr('This link is damaged or incomplete. Ask for it to be sent again.'));
  if (m[1] === '1' && typeof DecompressionStream !== 'function') throw new Error(tr('This browser is too old to open shared links. Update it, or ask for the file instead.'));
  try {
    let bytes = b64url.dec(m[2]);
    if (m[1] === '1') bytes = await streamBytes(bytes, new DecompressionStream('deflate-raw'));
    if (bytes.length > 5e6) throw new Error('too large');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(tr('This link is damaged or incomplete. Ask for it to be sent again.'));
  }
}

const appLink = (kind, code) => `${location.origin}${location.pathname}#${kind}=${code}`;

/* =====================================================================
 * Cleaning results that come from outside (links, files, submissions)
 * ===================================================================== */
const S = (v, max = 4000) => (v === null || v === undefined ? '' : String(v)).slice(0, max);
const N = (v, lo = 0, hi = 1e6) => { const x = Math.floor(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo; };
const E = (v, allowed, fb) => (allowed.includes(v) ? v : fb);
const A = (v, max = 50) => (Array.isArray(v) ? v.slice(0, max) : []);
const SIDE_VERDICTS = ['strong', 'moderate', 'weak', 'insufficient'];
const LEANINGS = ['well supported', 'leans towards support', 'evenly balanced', 'leans against', 'not supported', 'insufficient evidence'];
const CHECK_VERDICTS = ['true', 'mostly true', 'mixed', 'mostly false', 'false', 'unverified'];
const MODES = ['support', 'contest', 'balanced', 'check'];

function cleanSide(s) {
  s = s || {};
  return {
    summary: S(s.summary), verdict: E(s.verdict, SIDE_VERDICTS, 'insufficient'), verdictReason: S(s.verdictReason, 600),
    claims: A(s.claims, 12).map((c) => S(c, 600)),
    arguments: A(s.arguments, 20).map((a) => ({
      point: S(a && a.point, 600), reasoning: S(a && a.reasoning),
      evidence: A(a && a.evidence, 12).map((e) => ({ n: N(e && e.n, 1, 500), excerpt: S(e && e.excerpt, 1500), sourceType: E(e && e.sourceType, ['primary', 'secondary', 'unknown'], 'unknown') })),
    })),
    counterConsiderations: A(s.counterConsiderations, 12).map((c) => S(c, 1500)),
    gaps: S(s.gaps, 1500),
  };
}

function cleanPlain(p) {
  if (!p || typeof p !== 'object') return null;
  return { headline: S(p.headline, 200), explanation: A(p.explanation, 8).map((t) => S(t, 800)), watchOut: S(p.watchOut, 800), checkNext: A(p.checkNext, 6).map((t) => S(t, 600)), lang: E(p.lang, ['en', 'as', 'bn'], 'en') };
}

/** Rebuilds a result from untrusted data, keeping only expected fields and values. */
function sanitizeResult(raw) {
  const r = upgradeResult(raw && typeof raw === 'object' ? raw : {});
  const mode = E(r.mode, MODES, null);
  if (!mode) throw new Error(tr('This doesn\'t look like an Evaluator result.'));
  const sites = A(r.sites, 60).map((s, i) => ({ domain: S(s && s.domain, 255), label: S(s && s.label, 200), category: E(s && s.category, [...CATEGORIES, 'local'], 'other'), folder: S(s && s.folder, 200), color: N(s && s.color, 0, 7) || (i % 8) }));
  const pages = A(r.pages, 200).map((p, i) => {
    const url = S(p && p.url, 2000);
    const local = Boolean(p && p.local) || /^local:/.test(url);
    return { n: i + 1, url: local ? '' : safeUrl(url), title: S(p && p.title, 400), site: Math.min(N(p && p.site, 0, 999), Math.max(0, sites.length - 1)), ...(local ? { local: true, passage: S(p && p.passage, 1500) } : {}) };
  });
  const m = r.meta || {};
  const out = {
    version: 3, mode, statement: S(r.statement, 2000), createdAt: Number.isFinite(Date.parse(r.createdAt)) ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    pages, sites,
    meta: {
      topic: S(m.topic, 120), provider: S(m.provider, 80), model: S(m.model, 200), search: S(m.search, 120),
      searches: N(m.searches, 0, 1000), pagesRead: N(m.pagesRead, 0, 1000), sourcesSearched: N(m.sourcesSearched, 0, 10000), foldersSearched: N(m.foldersSearched, 0, 1000),
      dropped: { evidence: N(m.dropped && m.dropped.evidence, 0, 1000), markers: N(m.dropped && m.dropped.markers, 0, 1000) },
      language: E(m.language, ['en', 'as', 'bn'], 'en'), durationMs: N(m.durationMs, 0, 1e8),
    },
  };
  if (mode === 'balanced') {
    const j = r.judgment || {};
    Object.assign(out, {
      support: cleanSide(r.support), contest: cleanSide(r.contest), verdict: E(r.verdict, LEANINGS, 'evenly balanced'),
      judgment: {
        assessment: S(j.assessment), leaning: E(j.leaning, LEANINGS, 'evenly balanced'), leaningReason: S(j.leaningReason, 600),
        strongestFor: A(j.strongestFor, 12).map((t) => S(t, 1500)), strongestAgainst: A(j.strongestAgainst, 12).map((t) => S(t, 1500)),
        conflicts: A(j.conflicts, 12).map((c) => ({ issue: S(c && c.issue, 600), assessment: S(c && c.assessment, 1500), favours: E(c && c.favours, ['for', 'against', 'neither'], 'neither') })),
        agreements: A(j.agreements, 12).map((t) => S(t, 1500)), gaps: S(j.gaps, 1500),
      },
    });
  } else if (mode === 'check') {
    const ch = r.checks || {};
    const l = ch.logic;
    const formula = (f) => ({ text: S(f && f.text, 600), formula: S(f && f.formula, 300) });
    Object.assign(out, {
      type: S(r.type, 20), verdict: E(r.verdict, CHECK_VERDICTS, 'unverified'), verdictReason: S(r.verdictReason, 600), summary: S(r.summary), gaps: S(r.gaps, 1500),
      claims: A(r.claims, 20).map((c, i) => ({
        id: S((c && c.id) || `C${i + 1}`, 10), text: S(c && c.text, 800), kind: E(c && c.kind, ['empirical', 'logical', 'mathematical', 'definitional'], 'empirical'),
        verdict: E(c && c.verdict, CHECK_VERDICTS, 'unverified'), confidence: E(c && c.confidence, ['high', 'medium', 'low'], 'low'),
        explanation: S(c && c.explanation), scopeNotes: S(c && c.scopeNotes, 1000),
        evidence: A(c && c.evidence, 12).map((e) => ({ n: N(e && e.n, 1, 500), stance: E(e && e.stance, ['supports', 'contradicts', 'context'], 'context'), studyType: S(e && e.studyType, 80), excerpt: S(e && e.excerpt, 1500) })),
      })),
      checks: {
        logic: !l || typeof l !== 'object' ? null : (l.ok ? {
          ok: true, valid: Boolean(l.valid), premisesConsistent: l.premisesConsistent !== false, rows: N(l.rows, 0, 1e6),
          counterexample: Object.fromEntries(Object.entries(l.counterexample || {}).slice(0, 12).map(([k, v]) => [S(k, 20), Boolean(v)])),
          variables: Object.fromEntries(Object.entries(l.variables || {}).slice(0, 12).map(([k, v]) => [S(k, 20), S(v, 300)])),
          premises: A(l.premises, 12).map(formula), conclusion: formula(l.conclusion),
        } : { ok: false, notFormalizable: Boolean(l.notFormalizable), reason: S(l.reason, 600), error: S(l.error, 300), premises: A(l.premises, 12).map(formula), conclusion: formula(l.conclusion) }),
        calculations: A(ch.calculations, 20).map((c) => ({
          description: S(c && c.description, 300), expression: S(c && c.expression, 300), claimed: S(c && c.claimed, 60),
          computed: Number.isFinite(Number(c && c.computed)) ? Number(c.computed) : NaN, ok: Boolean(c && c.ok), error: S(c && c.error, 300),
          comparable: Boolean(c && c.comparable), matches: Boolean(c && c.matches), exact: Boolean(c && c.exact), looseMatch: Boolean(c && c.looseMatch),
        })),
      },
    });
  } else {
    Object.assign(out, cleanSide(r));
  }
  // Source numbers in text that point past the list are harmless (markedHtml skips them); evidence numbers are clamped here.
  const maxN = pages.length || 1;
  const clampEv = (list) => list.forEach((e) => { e.n = Math.min(e.n, maxN); });
  if (out.arguments) out.arguments.forEach((a) => clampEv(a.evidence));
  if (out.support) [out.support, out.contest].forEach((s) => s.arguments.forEach((a) => clampEv(a.evidence)));
  if (out.claims && mode === 'check') out.claims.forEach((c) => clampEv(c.evidence));
  if (r.plainByLang && typeof r.plainByLang === 'object') {
    out.plainByLang = {};
    ['en', 'as', 'bn'].forEach((l) => { const p = cleanPlain(r.plainByLang[l]); if (p) out.plainByLang[l] = p; });
  } else if (r.plain) out.plain = cleanPlain(r.plain);
  if (r.second && typeof r.second === 'object') out.second = cleanSecond(r.second);
  return out;
}

/** A result, smaller for a link: the user's own notes and timings are left out. */
function compactResult(r) {
  const c = JSON.parse(JSON.stringify(r));
  delete c.sample; delete c.sampleId; delete c.sampleNote; delete c.shared; delete c.sharedAt;
  if (c.meta) { delete c.meta.usage; delete c.meta.helperModel; delete c.meta.reusedEvidence; delete c.meta.searchFocus; }
  return c;
}

/* =====================================================================
 * Tool dialog (Share, Cite, Second opinion, Class)
 * ===================================================================== */
function toolDialog(title, html, bind) {
  let d = document.getElementById('tool-dialog');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'tool-dialog';
    d.className = 'setup-dialog tool-dialog';
    d.setAttribute('aria-labelledby', 'tool-title');
    d.innerHTML = `<div class="setup-inner"><button type="button" class="setup-close" aria-label="${esc(tr('Close'))}">${icon('close')}</button><div id="tool-body"></div></div>`;
    $('#ev-frame').appendChild(d);
    d.querySelector('.setup-close').addEventListener('click', () => d.close());
  }
  $('#tool-body').innerHTML = `<h2 id="tool-title">${esc(title)}</h2>${html}`;
  if (bind) bind($('#tool-body'), d);
  if (!d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
  const first = d.querySelector('[data-autofocus]') || d.querySelector('h2');
  if (first) { if (first.tagName === 'H2') first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); }
  return d;
}

/** Copy text, with a short "Copied" on the button. */
function copyWithFeedback(btn, text) {
  const label = btn.querySelector('span') || btn;
  const before = label.textContent;
  const done = (ok) => { label.textContent = ok ? tr('Copied') : tr('This browser didn\'t allow copying.'); setTimeout(() => { label.textContent = before; }, 1600); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
  else done(false);
}

function downloadText(name, text, type) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** File names stay in plain ASCII: some browsers drop a name in other scripts and save it as "download". */
const fileSlug = (s, fb = 'evaluator') => (String(s || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || fb);
const MODE_FILE = { support: 'support', contest: 'challenge', balanced: 'evaluation', check: 'verification' };

/* =====================================================================
 * Share a result
 * ===================================================================== */
const LINK_SOFT_LIMIT = 60000; // longer links may be cut off by some messaging apps

async function shareResult(r) {
  const code = await packData(compactResult(r));
  const link = appLink('report', code);
  const long = link.length > LINK_SOFT_LIMIT;
  toolDialog(tr('Share this result'), `
    <p>${tr('Anyone with this link can open the result, read only, without a key. The whole result is inside the link: nothing is uploaded.')}</p>
    <label class="field-label" for="share-link">${tr('Link')}</label>
    <textarea id="share-link" class="share-link" rows="3" readonly translate="no">${esc(link)}</textarea>
    <p class="hint">${tr('{n} characters.', { n: link.length.toLocaleString('en-IN') })} ${long ? tr('This is long: some messaging apps may cut it. Use Save as web page instead, and send the file.') : ''}</p>
    <div class="setup-actions">
      <button type="button" class="btn primary" data-copy data-autofocus>${icon('copy')}<span>${tr('Copy link')}</span></button>
      ${navigator.share ? `<button type="button" class="btn quiet" data-native>${icon('share')}<span>${tr('Share…')}</span></button>` : ''}
      <button type="button" class="btn quiet" data-html>${icon('download')}<span>${tr('Save as web page')}</span></button>
    </div>`, (body) => {
    body.querySelector('[data-copy]').addEventListener('click', (e) => copyWithFeedback(e.currentTarget, link));
    const nat = body.querySelector('[data-native]');
    if (nat) nat.addEventListener('click', () => navigator.share({ title: `Evaluator: ${r.statement.slice(0, 80)}`, url: link }).catch(() => {}));
    body.querySelector('[data-html]').addEventListener('click', () => downloadHtml(r));
    body.querySelector('#share-link').addEventListener('focus', (e) => e.target.select());
  });
}

/** Opens a result shared by link, read only. */
async function openSharedReport(code) {
  try {
    const r = sanitizeResult(await unpackData(code));
    location.hash = '#trace';
    showResult({ ...r, shared: true });
  } catch (err) {
    location.hash = '#trace';
    setStatus(esc(err.message || tr('This link is damaged or incomplete. Ask for it to be sent again.')), true);
  }
}

function sharedBannerHtml(r) {
  if (r.sharedBy) {
    return `<div class="sample-banner shared-banner no-print" role="note"><p><strong>${tr('Work from {student}, read only.', { student: `<span translate="no">${esc(r.sharedBy)}</span>` })}</strong> ${tr('Made on {date} with {model}.', { date: esc(fmtDateTime(r.createdAt)), model: esc(`${r.meta.provider || '?'} ${r.meta.model || ''}`.trim()) })}</p>
      ${r.studentNote ? `<p><strong>${tr('Their conclusion:')}</strong> <span translate="no">${esc(r.studentNote)}</span></p>` : `<p class="muted">${tr('They wrote no conclusion for this claim.')}</p>`}
      <div class="form-actions"><a class="btn quiet" href="#class">${tr('Back to Class')}</a></div></div>`;
  }
  return `<div class="sample-banner shared-banner no-print" role="note"><p><strong>${tr('Shared result, read only.')}</strong> ${tr('Made on {date} with {model}. The citations were checked when it was made; open the sources to check them yourself.', { date: esc(fmtDateTime(r.createdAt)), model: esc(`${r.meta.provider || '?'} ${r.meta.model || ''}`.trim()) })}</p>
    <div class="form-actions"><button type="button" class="btn quiet" id="shared-save">${tr('Save to my recent results')}</button></div></div>`;
}

/* ---------- Save as web page ---------- */
const EXPORT_COLORS = ['#D55E00', '#0072B2', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#8C6D31', '#7A7A7A'];

/** The result as a self-contained HTML document (detailed view), for Word or a browser. */
function exportHtml(r, { forWord = false } = {}) {
  const prev = ui.mode;
  ui.mode = 'detailed'; renderResult();
  const clone = $('#result').cloneNode(true);
  ui.mode = prev; renderResult();
  clone.querySelectorAll('.no-print, svg.ev-icon').forEach((n) => n.remove());
  clone.querySelectorAll('details').forEach((d) => {
    const div = document.createElement('div');
    const sum = d.querySelector(':scope > summary');
    if (sum) { const h = document.createElement('h3'); h.innerHTML = sum.innerHTML; div.appendChild(h); sum.remove(); }
    while (d.firstChild) div.appendChild(d.firstChild);
    d.replaceWith(div);
  });
  clone.querySelectorAll('button.ref, span.ref').forEach((b) => {
    const sup = document.createElement('sup');
    const c = [...b.classList].find((x) => /^c\d$/.test(x));
    sup.textContent = `[${b.textContent}]`;
    sup.setAttribute('style', `color:${EXPORT_COLORS[c ? Number(c.slice(1)) : 7]};font-weight:bold`);
    b.replaceWith(sup);
  });
  clone.querySelectorAll('mark.hl').forEach((m) => {
    const c = [...m.classList].find((x) => /^c\d$/.test(x));
    const col = EXPORT_COLORS[c ? Number(c.slice(1)) : 7];
    m.setAttribute('style', `background:${col}33;border-bottom:2px solid ${col};color:inherit`);
  });
  clone.querySelectorAll('.swatch').forEach((s) => {
    const c = [...s.classList].find((x) => /^c\d$/.test(x));
    s.outerHTML = c ? `<span style="color:${EXPORT_COLORS[Number(c.slice(1))]}">&#9632;</span> ` : '<span style="color:#999">&#9633;</span> ';
  });
  clone.querySelectorAll('[id]').forEach((n) => { if (!/^src-\d+$/.test(n.id)) n.removeAttribute('id'); });
  clone.querySelectorAll('[tabindex]').forEach((n) => n.removeAttribute('tabindex'));
  const css = `body{font-family:${forWord ? 'Georgia,serif' : "'Noto Sans','Noto Sans Bengali',system-ui,sans-serif"};font-size:11pt;line-height:1.55;color:#1C2530;${forWord ? '' : 'max-width:46rem;margin:2rem auto;padding:0 1rem;'}}
    h3,h4{font-family:Arial,sans-serif}a{color:#0b5cad}
    .tag,.verdict,.tone{font-family:Arial,sans-serif;font-size:9pt;border:1px solid #bbb;padding:1px 4px;border-radius:2px}
    table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px;font-size:10pt;vertical-align:top;text-align:left}
    ul{padding-left:1.2rem}.footnote,.muted{color:#56626C;font-size:9pt}
    .legend,.quality,.second,.notice,.app-check{border:1px solid #ddd;border-radius:4px;padding:8px 10px;margin:10px 0}
    .source-refs li{margin-bottom:6px}.export-note{color:#56626C;font-size:9pt;border-top:1px solid #ddd;margin-top:2rem;padding-top:.5rem}`;
  const note = forWord ? '' : `<p class="export-note">${esc(tr('Made with Evaluator on {date}. Every point links to the page or passage it came from; open them to check.', { date: fmtDateTime(r.createdAt) }))}</p>`;
  return `<!doctype html><html lang="${esc(I18N.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(MODE_LABEL[r.mode])}: ${esc(r.statement.slice(0, 80))}</title>
    <style>${css}</style></head><body>${clone.innerHTML}${note}</body></html>`;
}

function downloadHtml(r) {
  downloadText(`${MODE_FILE[r.mode] || 'result'}-${fileSlug(r.statement, 'result')}.html`, exportHtml(r), 'text/html');
}

/* ---------- Result tool buttons ---------- */
function bindResultTools(el, r) {
  const on = (id, fn) => { const b = $(`#${id}`, el); if (b) b.addEventListener('click', fn); };
  on('share-btn', () => shareResult(r));
  on('html-btn', () => downloadHtml(r));
  on('cite-btn', () => openCite(r));
  on('second-btn', () => openSecondOpinion(r));
  on('shared-save', () => {
    const copy = { ...r }; delete copy.shared;
    saveToHistory(copy);
    const b = $('#shared-save', el); b.disabled = true; b.textContent = tr('Saved to Recent results');
  });
}

/** Links that open something: #report=, #class=, #submission=. */
async function handleIncomingLink() {
  const m = /^#(report|class|submission)=(.+)$/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, '', `${location.pathname}${location.search}#${m[1] === 'report' ? 'trace' : 'class'}`);
  if (m[1] === 'report') await openSharedReport(m[2]);
  else if (m[1] === 'class') await receiveAssignment(m[2]);
  else await receiveSubmission(m[2]);
  route();
  return true;
}
