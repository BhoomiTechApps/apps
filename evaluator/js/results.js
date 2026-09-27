/* Evaluator: results.js
 *
 * Running an analysis (busy state), results with colour-coded sources,
 * copy / print / Word export, and recent results.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/* =====================================================================
 * UI: running an analysis
 * ===================================================================== */
const MODE_LABEL = { support: 'Case in support', contest: 'Case against', balanced: 'Evaluation', check: 'Correctness check' };
const MODE_SHORT = { support: 'Support', contest: 'Challenge', balanced: 'Evaluate', check: 'Verify' };
const LEANING_TEXT = {
  'well supported': 'Well supported', 'leans towards support': 'Leans towards support', 'evenly balanced': 'Evenly balanced',
  'leans against': 'Leans against', 'not supported': 'Not supported', 'insufficient evidence': 'Not enough evidence',
};
const CHECK_TEXT = { true: 'True', 'mostly true': 'Mostly true', mixed: 'Mixed', 'mostly false': 'Mostly false', false: 'False', unverified: 'Unverified' };
const CHECK_TONE = { true: 'good', 'mostly true': 'good', mixed: 'mid', 'mostly false': 'bad', false: 'bad', unverified: 'none' };

function setStatus(html, isError = false) {
  const el = $('#status');
  el.classList.toggle('error', isError);
  el.innerHTML = html;
}

/* ---------- Busy state: top bar, spinner panel, timer, button, tab title ---------- */
const busy = { timer: null, started: 0, title: '' };

function setBusy(on, mode) {
  const panel = $('#busy-panel');
  $('#busy-bar').hidden = !on;
  panel.hidden = !on;
  $('#trace-form').setAttribute('aria-busy', on ? 'true' : 'false');
  document.body.classList.toggle('is-busy', on);
  document.querySelectorAll('.act').forEach((b) => {
    b.disabled = on;
    b.classList.toggle('running', on && b.value === mode);
  });
  $('#topic-select').disabled = on;
  $('#statement').readOnly = on;
  clearInterval(busy.timer);
  if (on) {
    busy.started = Date.now();
    busy.title = document.title;
    $('#busy-title').textContent = `${MODE_LABEL[mode]} in progress`;
    $('#busy-time').textContent = '0:00';
    busy.timer = setInterval(() => {
      const s = Math.floor((Date.now() - busy.started) / 1000);
      const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      $('#busy-time').textContent = t;
      document.title = `(${t}) Working… ${busy.title}`;
    }, 1000);
  } else if (busy.title) {
    document.title = busy.title;
  }
}

window.addEventListener('beforeunload', (e) => {
  if (ui.controller) { e.preventDefault(); e.returnValue = ''; }
});

async function runTrace(mode, fresh = false) {
  const statement = $('#statement').value.trim();
  if (statement.length < 10) { setStatus('Write a statement or question of at least 10 characters.', true); $('#statement').focus(); return; }
  if (!navigator.onLine) { setStatus('You\'re offline. Connect to the internet to run a new analysis.', true); return; }
  const scope = currentScope();

  setStatus('');
  $('#result').hidden = true;
  ui.controller = new AbortController();
  setBusy(true, mode);
  const progress = (text) => { $('#busy-msg').textContent = text; };
  progress(`Starting with ${scopeText(scope) || 'your sources'}…`);
  try {
    const result = await runAnalysis({ mode, statement, signal: ui.controller.signal, progress, fresh });
    saveToHistory(result);
    showResult(result);
  } catch (err) {
    if (err.name === 'AbortError') setStatus('Stopped.');
    else setStatus(`${esc(err.message)}${/Settings/.test(err.message) ? ' <a href="#settings">Open Settings</a>' : ''}`, true);
  } finally {
    setBusy(false);
    ui.controller = null;
    renderBalances(true);
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
 * UI: colour-coded text
 * ===================================================================== */
function siteOf(r, n) { const p = r.pages[n - 1]; return p ? r.sites[p.site] : null; }
function colorOf(r, n) { const s = siteOf(r, n); return s ? s.color : 7; }

function refChip(r, n) {
  const p = r.pages[n - 1];
  if (!p) return '';
  const s = siteOf(r, n);
  return `<button type="button" class="ref c${colorOf(r, n)}" data-ref="${n}" title="${esc(`${p.title}, ${s.label}`)}" aria-label="Source ${n}: ${esc(p.title)}">${n}</button>`;
}

function lastSentenceStart(seg) {
  const re = /[.!?]["'\u201d\u2019)\]]*\s+(?=\S)/g;
  let idx = 0, m;
  while ((m = re.exec(seg))) idx = m.index + m[0].length;
  return idx;
}

/** Text with [^n] references: the sentence before each reference is tinted in its source's colour. */
function markedHtml(text, r) {
  const src = String(text || '');
  let out = '', last = 0, m;
  const re = new RegExp(REF_RE.source, 'g');
  while ((m = re.exec(src))) {
    const seg = src.slice(last, m.index);
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
  return out + esc(src.slice(last));
}

const plainText = (text) => String(text || '').replace(new RegExp(REF_RE.source, 'g'), (m0, ns) => ns.split(',').map((n) => `[${n}]`).join(''));

function legendHtml(r) {
  if (!r.sites.length) return '';
  const items = r.sites.map((s, i) => {
    const nums = r.pages.filter((p) => p.site === i).map((p) => p.n);
    return `<li><span class="swatch c${s.color}" aria-hidden="true"></span>${esc(s.label)} <span class="muted">(${s.category === 'local' ? `local file in ${esc(s.folder || 'a folder')}, ` : ''}source${nums.length === 1 ? '' : 's'} ${nums.join(', ')})</span></li>`;
  }).join('');
  return `<div class="legend" aria-label="Colour key">
    <p class="legend-title">Colour key</p>
    <ul>${items}<li><span class="swatch plain" aria-hidden="true"></span>No colour: the model's own connecting reasoning</li></ul>
  </div>`;
}

function pageLink(p) {
  return p.local ? `<span class="local-title">${esc(p.title)}</span>` : `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(p.title)}</a>`;
}

function sourcesListHtml(r) {
  if (!r.pages.length) return '';
  return `<h3>Sources</h3><ol class="source-refs">${r.pages.map((p) => {
    const s = r.sites[p.site];
    return `<li id="src-${p.n}" class="c${s.color}">
      <span class="ref c${s.color}" aria-hidden="true">${p.n}</span>
      <div>${pageLink(p)}
      <div class="meta-row"><span>${esc(s.category === 'local' ? `Folder: ${s.folder || ''}` : s.label)}</span><span class="tag">${esc(CATEGORY_NAMES[s.category] || s.category)}</span></div>
      ${p.local && p.passage ? `<details class="passage"><summary>Show passage</summary><p>${esc(p.passage)}</p></details>` : ''}</div>
    </li>`;
  }).join('')}</ol>`;
}

function evidenceItem(r, ev, extraTags = '') {
  const p = r.pages[ev.n - 1];
  if (!p) return '';
  const s = siteOf(r, ev.n);
  return `<li class="c${colorOf(r, ev.n)}">
    ${refChip(r, ev.n)}
    <div>${pageLink(p)}
    <p class="excerpt">${esc(ev.excerpt)}</p>
    <div class="meta-row"><span>${esc(s.category === 'local' ? `Folder: ${s.folder || ''}` : s.label)}</span>${extraTags}${ev.sourceType && ev.sourceType !== 'unknown' ? `<span class="tag">${ev.sourceType === 'primary' ? 'Primary' : 'Secondary'}</span>` : ''}</div></div>
  </li>`;
}

const listHtml = (items, r) => `<ul class="plain-list">${items.map((t) => `<li>${markedHtml(t, r)}</li>`).join('')}</ul>`;

/* =====================================================================
 * UI: result views
 * ===================================================================== */
function sideSummaryHtml(side, r) {
  return `<ul class="plain-list">${side.arguments.map((a) => {
    const ns = [...new Set(a.evidence.map((ev) => ev.n))];
    return `<li>${esc(a.point)} ${ns.map((n) => refChip(r, n)).join('')}</li>`;
  }).join('') || '<li>No point could be backed by the sources.</li>'}</ul>`;
}

function sideDetailHtml(side, r) {
  let h = '';
  if (side.claims && side.claims.length) h += `<h4>Claims tested</h4><ul class="plain-list">${side.claims.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`;
  h += side.arguments.length ? side.arguments.map((a) => `
    <div class="argument">
      <p class="argument-point">${esc(a.point)}</p>
      <p class="argument-reasoning">${markedHtml(a.reasoning, r)}</p>
      <ul class="evidence">${a.evidence.map((ev) => evidenceItem(r, ev)).join('')}</ul>
    </div>`).join('') : '<p class="empty">No argument could be backed by the sources.</p>';
  if (side.counterConsiderations.length) h += `<h4>Other side</h4>${listHtml(side.counterConsiderations, r)}`;
  if (side.gaps) h += `<h4>Gaps in the sources</h4><p class="prose-small">${esc(side.gaps)}</p>`;
  return h;
}

function argumentView(r, detailed) {
  let h = `<div class="prose"><p>${markedHtml(r.summary, r)}</p></div>`;
  if (!detailed) return `${h}<h3>Key points</h3>${sideSummaryHtml(r, r)}`;
  return `${h}<h3>Arguments</h3>${sideDetailHtml(r, r).replace(/<h4>/g, '<h3>').replace(/<\/h4>/g, '</h3>')}`;
}

function balancedView(r, detailed) {
  const j = r.judgment;
  let h = `<div class="prose"><p>${markedHtml(j.assessment, r)}</p></div>
    <div class="two-col">
      <section class="col for"><h3>Strongest points for</h3>${j.strongestFor.length ? listHtml(j.strongestFor, r) : '<p class="empty">None stood up to the evidence.</p>'}</section>
      <section class="col against"><h3>Strongest points against</h3>${j.strongestAgainst.length ? listHtml(j.strongestAgainst, r) : '<p class="empty">None stood up to the evidence.</p>'}</section>
    </div>`;
  if (j.conflicts.length) {
    h += `<h3>Where the sides disagree</h3><div class="conflicts">${j.conflicts.map((c) => `
      <div class="conflict">
        <p class="conflict-issue">${esc(c.issue)} <span class="tag favours-${c.favours}">${c.favours === 'for' ? 'Evidence favours: for' : c.favours === 'against' ? 'Evidence favours: against' : 'Unresolved'}</span></p>
        ${detailed ? `<p>${markedHtml(c.assessment, r)}</p>` : ''}
      </div>`).join('')}</div>`;
  }
  if (!detailed) return h;
  if (j.agreements.length) h += `<h3>Where the evidence agrees</h3>${listHtml(j.agreements, r)}`;
  if (j.gaps) h += `<h3>Gaps</h3><p class="prose-small">${esc(j.gaps)}</p>`;
  h += `<details class="case" open><summary>Full case in support <span class="verdict small">${esc(VERDICT_TEXT[r.support.verdict])}</span></summary>
      <div class="case-body"><p>${markedHtml(r.support.summary, r)}</p>${sideDetailHtml(r.support, r)}</div></details>
    <details class="case"><summary>Full case against <span class="verdict small">${esc(VERDICT_TEXT[r.contest.verdict])}</span></summary>
      <div class="case-body"><p>${markedHtml(r.contest.summary, r)}</p>${sideDetailHtml(r.contest, r)}</div></details>`;
  return h;
}

function appChecksHtml(checks) {
  let h = '';
  const l = checks.logic;
  if (l && l.ok) {
    const vars = Object.entries(l.variables || {});
    h += `<div class="app-check ${l.valid ? 'good' : 'bad'}">
      <p class="app-check-title">Logical validity: <strong>${l.valid ? 'Valid' : 'Invalid'}</strong> <span class="tag">Checked by the app, ${l.rows} truth-table rows</span></p>
      <table class="logic-table"><tbody>
        ${l.premises.map((p, i) => `<tr><th scope="row">Premise ${i + 1}</th><td>${esc(p.text)}</td><td><code>${esc(p.formula)}</code></td></tr>`).join('')}
        <tr><th scope="row">Conclusion</th><td>${esc(l.conclusion.text)}</td><td><code>${esc(l.conclusion.formula)}</code></td></tr>
      </tbody></table>
      ${vars.length ? `<p class="muted small">Where ${vars.map(([k, v]) => `<code>${esc(k)}</code> means “${esc(v)}”`).join('; ')}.</p>` : ''}
      ${!l.valid ? `<p>Counterexample: every premise is true but the conclusion is false when ${Object.entries(l.counterexample).map(([k, v]) => `<code>${esc(k)}</code> is ${v ? 'true' : 'false'}${l.variables && l.variables[k] ? ` (${esc(l.variables[k])})` : ''}`).join(', ')}.</p>` : ''}
      ${!l.premisesConsistent ? '<p>The premises contradict each other, so the argument is only valid in an empty sense: anything follows from contradictory premises.</p>' : ''}
      <p class="muted small">Validity means the conclusion must be true if the premises are. Whether the premises are true is graded separately below.</p>
    </div>`;
  } else if (l && l.notFormalizable) {
    h += `<div class="app-check none"><p class="app-check-title">Logical validity: judged by the model, not the app</p><p class="muted small">${esc(l.reason)}</p></div>`;
  } else if (l && !l.ok) {
    h += `<div class="app-check none"><p class="app-check-title">Logical validity: the app couldn't parse the formulas</p><p class="muted small">${esc(l.error)}</p></div>`;
  }
  if (checks.calculations.length) {
    h += `<div class="app-check"><p class="app-check-title">Calculations <span class="tag">Recomputed by the app</span></p>
      <div class="table-wrap"><table class="calc-table"><thead><tr><th>What</th><th>Expression</th><th>Claimed</th><th>Computed</th><th>Result</th></tr></thead><tbody>
      ${checks.calculations.map((c) => `<tr>
        <td>${esc(c.description)}</td><td><code>${esc(c.expression)}</code></td><td>${esc(c.claimed || '–')}</td>
        <td>${c.ok ? esc(formatNumber(c.computed)) : '–'}</td>
        <td>${!c.ok ? `<span class="tone none">Couldn't compute</span> <span class="muted small">${esc(c.error)}</span>` : !c.comparable ? '<span class="tone none">No claimed value</span>' : c.matches ? (c.exact ? '<span class="tone good">Correct</span>' : '<span class="tone good">Correct when rounded</span>') : c.looseMatch ? '<span class="tone mid">Correct as a percentage</span>' : '<span class="tone bad">Wrong</span>'}</td>
      </tr>`).join('')}</tbody></table></div></div>`;
  }
  return h;
}

function formatDuration(ms) {
  if (ms < 1000) return 'under a second';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} second${s === 1 ? '' : 's'}` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const h = Math.round(mins / 60);
  return `${h} hour${h === 1 ? '' : 's'} ago`;
}

function formatNumber(x) {
  if (!Number.isFinite(x)) return String(x);
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return x.toLocaleString();
  return Number(x.toPrecision(10)).toString();
}

function checkView(r, detailed) {
  let h = '';
  if (r.type === 'other') h += '<p class="notice">This looks like a historical, political or opinion statement rather than a scientific or logical one. "Evaluate" usually suits those better.</p>';
  h += `<div class="prose"><p>${markedHtml(r.summary, r)}</p></div>`;
  const exact = appChecksHtml(r.checks);
  if (exact) h += `<h3>Exact checks</h3>${exact}`;
  h += '<h3>Claims</h3>';
  if (!detailed) {
    h += `<ul class="claim-list">${r.claims.map((c) => `<li><span class="tone ${CHECK_TONE[c.verdict]}">${esc(CHECK_TEXT[c.verdict])}</span> ${esc(c.text)} ${[...new Set(c.evidence.map((ev) => ev.n))].map((n) => refChip(r, n)).join('')}</li>`).join('')}</ul>`;
    return h;
  }
  h += r.claims.map((c) => `
    <div class="claim">
      <p class="claim-head"><span class="tone ${CHECK_TONE[c.verdict]}">${esc(CHECK_TEXT[c.verdict])}</span> <span class="claim-text">${esc(c.text)}</span></p>
      <p class="muted small">${esc(c.kind[0].toUpperCase() + c.kind.slice(1))} claim, ${esc(c.confidence)} confidence</p>
      ${c.explanation ? `<p class="argument-reasoning">${markedHtml(c.explanation, r)}</p>` : ''}
      ${c.scopeNotes ? `<p class="scope-note"><strong>Limits:</strong> ${esc(c.scopeNotes)}</p>` : ''}
      ${c.evidence.length ? `<ul class="evidence">${c.evidence.map((ev) => evidenceItem(r, ev, `<span class="tag stance-${ev.stance}">${ev.stance === 'supports' ? 'Supports' : ev.stance === 'contradicts' ? 'Contradicts' : 'Context'}</span><span class="tag">${esc(ev.studyType)}</span>`)).join('')}</ul>` : ''}
    </div>`).join('');
  if (r.gaps) h += `<h3>Gaps in the sources</h3><p class="prose-small">${esc(r.gaps)}</p>`;
  return h;
}

function verdictBadge(r) {
  if (r.mode === 'balanced') return `<span class="verdict">${esc(LEANING_TEXT[r.verdict] || r.verdict)}</span>${r.judgment.leaningReason ? `<p class="verdict-line">${esc(r.judgment.leaningReason)}</p>` : ''}`;
  if (r.mode === 'check') return `<span class="verdict tone ${CHECK_TONE[r.verdict]}">${esc(CHECK_TEXT[r.verdict] || r.verdict)}</span>${r.verdictReason ? `<p class="verdict-line">${esc(r.verdictReason)}</p>` : ''}`;
  return `<span class="verdict">${esc(VERDICT_TEXT[r.verdict] || r.verdict)}</span>${r.verdictReason ? `<p class="verdict-line">${esc(r.verdictReason)}</p>` : ''}`;
}

function showResult(result) {
  ui.result = upgradeResult(result);
  const el = $('#result');
  el.className = `result mode-${ui.result.mode}`;
  el.hidden = false;
  renderResult();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderResult() {
  const r = ui.result;
  const el = $('#result');
  const detailed = ui.mode === 'detailed';
  const toggle = `<div class="segmented no-print" role="group" aria-label="Detail level">
    <button type="button" data-mode="summary" aria-pressed="${!detailed}">Summary</button>
    <button type="button" data-mode="detailed" aria-pressed="${detailed}">Detailed</button></div>`;
  let body = `<div class="result-head"><p class="result-kind">${MODE_LABEL[r.mode]}</p>${toggle}</div>
    <p class="result-statement">${esc(r.statement)}</p>
    ${verdictBadge(r)}
    ${legendHtml(r)}`;
  if (r.mode === 'balanced') body += balancedView(r, detailed);
  else if (r.mode === 'check') body += checkView(r, detailed);
  else body += argumentView(r, detailed);
  body += sourcesListHtml(r);

  const m = r.meta || {};
  const dropped = m.dropped ? (m.dropped.evidence || 0) + (m.dropped.markers || 0) : 0;
  const scopeBits = [];
  if (m.sourcesSearched) scopeBits.push(`${m.sourcesSearched} website${m.sourcesSearched === 1 ? '' : 's'}`);
  if (m.foldersSearched) scopeBits.push(`${m.foldersSearched} local folder${m.foldersSearched === 1 ? '' : 's'}`);
  body += `<p class="footnote">${m.topic ? `Topic: ${esc(m.topic)}${scopeBits.length ? ` (${scopeBits.join(' and ')})` : ''}. ` : ''}${m.searches ?? 0} web search${m.searches === 1 ? '' : 'es'}, ${m.pagesRead ?? 0} passage${m.pagesRead === 1 ? '' : 's'} read.
    ${dropped ? `${dropped === 1 ? '1 citation was' : `${dropped} citations were`} removed because ${dropped === 1 ? 'it' : 'they'} didn't match a trusted page or passage the search returned.` : 'Every citation matches a trusted page or passage the search returned.'}
    ${m.provider ? `Model: ${esc(m.provider)} ${esc(m.model)}. Search: ${esc(m.search)}.` : ''}
    ${m.usage && (m.usage.input || m.usage.output) ? `Used ${m.usage.input.toLocaleString()} input and ${m.usage.output.toLocaleString()} output tokens in ${m.usage.calls} model call${m.usage.calls === 1 ? '' : 's'}${m.usage.searchCredits ? ` and ${m.usage.searchCredits} Tavily credit${m.usage.searchCredits === 1 ? '' : 's'}` : ''}.` : ''}
    ${m.helperModel ? `Searches planned with ${esc(m.helperModel)}.` : ''}
    ${m.searchFocus === 'support' ? 'Searched for supporting evidence only.' : m.searchFocus === 'contest' ? 'Searched for challenging evidence only.' : ''}
    ${m.reusedEvidence ? `<strong>Reused the evidence gathered ${esc(timeAgo(m.reusedEvidence))}</strong> for this statement, so no new searches were needed.` : ''}
    ${m.durationMs ? `Took ${formatDuration(m.durationMs)}.` : ''}
    Created ${new Date(r.createdAt).toLocaleString()}.</p>
    <div class="result-actions no-print">
      <button type="button" class="btn quiet" id="copy-btn">Copy as text</button>
      <button type="button" class="btn quiet" id="print-btn">Print or save as PDF</button>
      <button type="button" class="btn quiet" id="word-btn">Download for Word</button>
      ${m.reusedEvidence ? '<button type="button" class="btn quiet" id="fresh-btn">Search again</button>' : ''}
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
  $('#print-btn', el).addEventListener('click', printResult);
  $('#word-btn', el).addEventListener('click', downloadWord);
  $('#clear-result', el).addEventListener('click', clearResult);
  const freshBtn = $('#fresh-btn', el);
  if (freshBtn) freshBtn.addEventListener('click', () => { $('#statement').value = r.statement; runTrace(r.mode, true); });
}

/* =====================================================================
 * UI: copy, print, Word
 * ===================================================================== */
function sideText(side, lines, indent = '') {
  side.arguments.forEach((a, i) => {
    lines.push(`${indent}${i + 1}. ${a.point}`, `${indent}   ${plainText(a.reasoning)}`);
    a.evidence.forEach((ev) => lines.push(`${indent}   - [${ev.n}] ${ev.excerpt}`));
  });
  if (side.counterConsiderations.length) lines.push(`${indent}Other side:`, ...side.counterConsiderations.map((c) => `${indent}- ${plainText(c)}`));
  if (side.gaps) lines.push(`${indent}Gaps: ${side.gaps}`);
}

function resultText(r) {
  const lines = [`${MODE_LABEL[r.mode]}: ${r.statement}`, ''];
  if (r.mode === 'balanced') {
    const j = r.judgment;
    lines.push(`Overall: ${LEANING_TEXT[r.verdict]}. ${j.leaningReason}`, '', plainText(j.assessment), '');
    lines.push('Strongest points for:', ...j.strongestFor.map((t) => `- ${plainText(t)}`), '');
    lines.push('Strongest points against:', ...j.strongestAgainst.map((t) => `- ${plainText(t)}`), '');
    if (j.conflicts.length) lines.push('Where the sides disagree:', ...j.conflicts.map((c) => `- ${c.issue} (favours: ${c.favours}): ${plainText(c.assessment)}`), '');
    if (j.agreements.length) lines.push('Where the evidence agrees:', ...j.agreements.map((t) => `- ${plainText(t)}`), '');
    if (j.gaps) lines.push(`Gaps: ${j.gaps}`, '');
    lines.push('CASE IN SUPPORT', plainText(r.support.summary)); sideText(r.support, lines); lines.push('');
    lines.push('CASE AGAINST', plainText(r.contest.summary)); sideText(r.contest, lines); lines.push('');
  } else if (r.mode === 'check') {
    lines.push(`Verdict: ${CHECK_TEXT[r.verdict]}. ${r.verdictReason}`, '', plainText(r.summary), '');
    const l = r.checks.logic;
    if (l && l.ok) lines.push(`Logical validity (checked by the app): ${l.valid ? 'VALID' : 'INVALID'}`, ...l.premises.map((p, i) => `  Premise ${i + 1}: ${p.text}  [${p.formula}]`), `  Conclusion: ${l.conclusion.text}  [${l.conclusion.formula}]`, '');
    r.checks.calculations.forEach((c) => lines.push(`Calculation: ${c.description}: ${c.expression} = ${c.ok ? formatNumber(c.computed) : 'n/a'}; claimed ${c.claimed || 'n/a'}; ${!c.ok ? 'could not compute' : !c.comparable ? 'no claimed value' : c.matches ? (c.exact ? 'correct' : 'correct when rounded') : 'wrong'}`));
    if (r.checks.calculations.length) lines.push('');
    r.claims.forEach((c) => {
      lines.push(`${c.id} [${CHECK_TEXT[c.verdict]}, ${c.confidence} confidence] ${c.text}`, `   ${plainText(c.explanation)}`);
      if (c.scopeNotes) lines.push(`   Limits: ${c.scopeNotes}`);
      c.evidence.forEach((ev) => lines.push(`   - [${ev.n}] ${ev.stance}, ${ev.studyType}: ${ev.excerpt}`));
    });
    if (r.gaps) lines.push('', `Gaps: ${r.gaps}`);
    lines.push('');
  } else {
    lines.push(`Evidence: ${VERDICT_TEXT[r.verdict]}. ${r.verdictReason}`, '', plainText(r.summary), '');
    sideText(r, lines); lines.push('');
  }
  if (r.pages.length) lines.push('Sources:', ...r.pages.map((p) => `[${p.n}] ${p.title}, ${r.sites[p.site].label}.${p.local ? ' (local file)' : ` ${p.url}`}`));
  return lines.join('\n');
}

function copyResult() {
  navigator.clipboard.writeText(resultText(ui.result)).then(
    () => { const b = $('#copy-btn'); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy as text'; }, 1500); },
    () => alert('This browser didn\'t allow copying.')
  );
}

function printResult() {
  const prev = ui.mode;
  if (prev !== 'detailed') { ui.mode = 'detailed'; renderResult(); }
  document.querySelectorAll('#result details').forEach((d) => { d.dataset.wasOpen = d.open ? '1' : ''; d.open = true; });
  const restore = () => {
    window.removeEventListener('afterprint', restore);
    if (prev !== 'detailed') { ui.mode = prev; renderResult(); }
    else document.querySelectorAll('#result details').forEach((d) => { d.open = Boolean(d.dataset.wasOpen); });
  };
  window.addEventListener('afterprint', restore);
  window.print();
}

/** Word opens HTML saved as .doc, keeping headings, colours and links. */
function downloadWord() {
  const r = ui.result;
  const prev = ui.mode;
  ui.mode = 'detailed'; renderResult();
  const clone = $('#result').cloneNode(true);
  ui.mode = prev; renderResult();
  clone.querySelectorAll('.no-print').forEach((n) => n.remove());
  clone.querySelectorAll('details').forEach((d) => {
    const div = document.createElement('div');
    const sum = d.querySelector(':scope > summary');
    if (sum) { const h = document.createElement('h3'); h.innerHTML = sum.innerHTML; div.appendChild(h); sum.remove(); }
    while (d.firstChild) div.appendChild(d.firstChild);
    d.replaceWith(div);
  });
  const colors = ['#D55E00', '#0072B2', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#8C6D31', '#7A7A7A'];
  clone.querySelectorAll('button.ref, span.ref').forEach((b) => {
    const sup = document.createElement('sup');
    const c = [...b.classList].find((x) => /^c\d$/.test(x));
    sup.textContent = `[${b.textContent}]`;
    sup.setAttribute('style', `color:${colors[c ? Number(c.slice(1)) : 7]};font-weight:bold`);
    b.replaceWith(sup);
  });
  clone.querySelectorAll('mark.hl').forEach((m) => {
    const c = [...m.classList].find((x) => /^c\d$/.test(x));
    const col = colors[c ? Number(c.slice(1)) : 7];
    m.setAttribute('style', `background:${col}33;border-bottom:2px solid ${col};color:inherit`);
  });
  clone.querySelectorAll('.swatch').forEach((s) => {
    const c = [...s.classList].find((x) => /^c\d$/.test(x));
    s.outerHTML = c ? `<span style="color:${colors[Number(c.slice(1))]}">&#9632;</span> ` : '<span style="color:#999">&#9633;</span> ';
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(MODE_LABEL[r.mode])}</title>
    <style>body{font-family:Georgia,serif;font-size:11pt;line-height:1.5;color:#1C2530}h3,h4{font-family:Arial,sans-serif}
    .tag,.verdict,.tone{font-family:Arial,sans-serif;font-size:9pt;border:1px solid #bbb;padding:1px 4px}
    table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px;font-size:10pt;vertical-align:top}
    .footnote,.muted{color:#56626C;font-size:9pt}</style></head><body>${clone.innerHTML}</body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const slug = r.statement.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'report';
  a.download = `${MODE_LABEL[r.mode].toLowerCase().replace(/ /g, '-')}-${slug}.doc`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* =====================================================================
 * UI: history (this device)
 * ===================================================================== */
const readHistory = () => local.get(KEYS.history, []);
function saveToHistory(result) {
  const items = [result, ...readHistory()].slice(0, 20);
  // If storage is full, drop the oldest results until the new one fits.
  while (!local.set(KEYS.history, items) && items.length > 1) items.pop();
  renderHistory();
}
function renderHistory() {
  const items = readHistory();
  $('#history').hidden = !items.length;
  $('#history-list').innerHTML = items.map((r, i) => {
    const mode = r.mode || r.stance;
    return `
    <li>
      <button type="button" class="h-open" data-i="${i}">
        <span class="h-dir ${esc(mode)}">${MODE_SHORT[mode] || ''}</span>
        <span class="h-text">${esc(r.statement)}</span>
      </button>
      <button type="button" class="h-remove" data-remove="${i}" aria-label="Remove this result">Remove</button>
    </li>`;
  }).join('');
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
