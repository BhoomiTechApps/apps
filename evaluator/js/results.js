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
const MODE_LABEL = { support: tr('Case in support'), contest: tr('Case against'), balanced: tr('Evaluation'), check: tr('Correctness check') };
const MODE_SHORT = { support: tr('Support'), contest: tr('Challenge'), balanced: tr('Evaluate'), check: tr('Verify') };
const LEANING_TEXT = {
  'well supported': tr('Well supported'), 'leans towards support': tr('Leans towards support'), 'evenly balanced': tr('Evenly balanced'),
  'leans against': tr('Leans against'), 'not supported': tr('Not supported'), 'insufficient evidence': tr('Not enough evidence'),
};
const CHECK_TEXT = { true: tr('True'), 'mostly true': tr('Mostly true'), mixed: tr('Mixed'), 'mostly false': tr('Mostly false'), false: tr('False'), unverified: tr('Unverified') };
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
  if (on) panel.scrollIntoView({ block: 'nearest' });
  if (on) {
    busy.started = Date.now();
    busy.title = document.title;
    $('#busy-title').textContent = tr('{mode} in progress', { mode: MODE_LABEL[mode] });
    $('#busy-time').textContent = '0:00';
    busy.timer = setInterval(() => {
      const s = Math.floor((Date.now() - busy.started) / 1000);
      const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      $('#busy-time').textContent = t;
      document.title = `(${t}) ${tr('Working…')} ${busy.title}`;
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
  progress(tr('Starting with {scope}…', { scope: scopeText(scope) || tr('your sources') }));
  try {
    const result = await runAnalysis({ mode, statement, signal: ui.controller.signal, progress, fresh });
    saveToHistory(result);
    showResult(result);
  } catch (err) {
    if (err.name === 'AbortError') setStatus('Stopped.');
    else setStatus(`${esc(err.message)}${/Settings/.test(err.message) || err.message.includes(tr('Settings')) ? ` <a href="#settings">${tr('Open Settings')}</a>` : ''}`, true);
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
  return `<button type="button" class="ref c${colorOf(r, n)}" translate="no" data-ref="${n}" title="${esc(`${p.title}, ${s.label}`)}" aria-label="Source ${n}: ${esc(p.title)}">${n}</button>`;
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
    return `<li><span class="swatch c${s.color}" aria-hidden="true"></span><span translate="no">${esc(s.label)}</span> <span class="muted">(${s.category === 'local' ? `${tr('local file in {folder}', { folder: `<span translate="no">${esc(s.folder || '')}</span>` })}, ` : ''}${trn(nums.length, 'source {list}', 'sources {list}', { list: nums.join(', ') })})</span></li>`;
  }).join('');
  return `<div class="legend" aria-label="Colour key">
    <p class="legend-title">Colour key</p>
    <ul>${items}<li><span class="swatch plain" aria-hidden="true"></span>No colour: the model's own connecting reasoning</li></ul>
  </div>`;
}

function pageLink(p) {
  return p.local ? `<span class="local-title" translate="no">${esc(p.title)}</span>` : `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener" translate="no">${esc(p.title)}</a>`;
}

function sourcesListHtml(r) {
  if (!r.pages.length) return '';
  return `<h3>Sources</h3><ol class="source-refs">${r.pages.map((p) => {
    const s = r.sites[p.site];
    return `<li id="src-${p.n}" class="c${s.color}">
      <span class="ref c${s.color}" aria-hidden="true">${p.n}</span>
      <div>${pageLink(p)}
      <div class="meta-row"><span>${s.category === 'local' ? esc(tr('Folder: {name}', { name: s.folder || '' })) : `<span translate="no">${esc(s.label)}</span>`}</span><span class="tag">${esc(CATEGORY_NAMES[s.category] || s.category)}</span></div>
      ${p.local && p.passage ? `<details class="passage"><summary>${tr('Show passage')}</summary><p translate="no">${esc(p.passage)}</p></details>` : ''}</div>
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
    <p class="excerpt" translate="no">${esc(ev.excerpt)}</p>
    <div class="meta-row"><span>${s.category === 'local' ? esc(tr('Folder: {name}', { name: s.folder || '' })) : `<span translate="no">${esc(s.label)}</span>`}</span>${extraTags}${ev.sourceType && ev.sourceType !== 'unknown' ? `<span class="tag">${ev.sourceType === 'primary' ? tr('Primary') : tr('Secondary')}</span>` : ''}</div></div>
  </li>`;
}

const listHtml = (items, r) => `<ul class="plain-list"${NO_TR}>${items.map((t) => `<li>${markedHtml(t, r)}</li>`).join('')}</ul>`;
const NO_TR = ' translate="no"'; // the model's own writing: never run through the interface translation

/* =====================================================================
 * UI: result views
 * ===================================================================== */
function sideSummaryHtml(side, r) {
  return `<ul class="plain-list">${side.arguments.map((a) => {
    const ns = [...new Set(a.evidence.map((ev) => ev.n))];
    return `<li><span translate="no">${esc(a.point)}</span> ${ns.map((n) => refChip(r, n)).join('')}</li>`;
  }).join('') || `<li>${tr('No point could be backed by the sources.')}</li>`}</ul>`;
}

function sideDetailHtml(side, r) {
  let h = '';
  if (side.claims && side.claims.length) h += `<h4>${tr('Claims tested')}</h4><ul class="plain-list" translate="no">${side.claims.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`;
  h += side.arguments.length ? side.arguments.map((a) => `
    <div class="argument">
      <p class="argument-point" translate="no">${esc(a.point)}</p>
      <p class="argument-reasoning" translate="no">${markedHtml(a.reasoning, r)}</p>
      <ul class="evidence">${a.evidence.map((ev) => evidenceItem(r, ev)).join('')}</ul>
    </div>`).join('') : `<p class="empty">${tr('No argument could be backed by the sources.')}</p>`;
  if (side.counterConsiderations.length) h += `<h4>${tr('Other side')}</h4>${listHtml(side.counterConsiderations, r)}`;
  if (side.gaps) h += `<h4>${tr('Gaps in the sources')}</h4><p class="prose-small" translate="no">${esc(side.gaps)}</p>`;
  return h;
}

function argumentView(r, detailed) {
  let h = `<div class="prose" translate="no"><p>${markedHtml(r.summary, r)}</p></div>`;
  if (!detailed) return `${h}<h3>${tr('Key points')}</h3>${sideSummaryHtml(r, r)}`;
  return `${h}<h3>${tr('Arguments')}</h3>${sideDetailHtml(r, r).replace(/<h4>/g, '<h3>').replace(/<\/h4>/g, '</h3>')}`;
}

function balancedView(r, detailed) {
  const j = r.judgment;
  let h = `<div class="prose" translate="no"><p>${markedHtml(j.assessment, r)}</p></div>
    <div class="two-col">
      <section class="col for"><h3>${tr('Strongest points for')}</h3>${j.strongestFor.length ? listHtml(j.strongestFor, r) : `<p class="empty">${tr('None stood up to the evidence.')}</p>`}</section>
      <section class="col against"><h3>${tr('Strongest points against')}</h3>${j.strongestAgainst.length ? listHtml(j.strongestAgainst, r) : `<p class="empty">${tr('None stood up to the evidence.')}</p>`}</section>
    </div>`;
  if (j.conflicts.length) {
    h += `<h3>${tr('Where the sides disagree')}</h3><div class="conflicts">${j.conflicts.map((c) => `
      <div class="conflict">
        <p class="conflict-issue"><span translate="no">${esc(c.issue)}</span> <span class="tag favours-${c.favours}">${c.favours === 'for' ? tr('Evidence favours: for') : c.favours === 'against' ? tr('Evidence favours: against') : tr('Unresolved')}</span></p>
        ${detailed ? `<p translate="no">${markedHtml(c.assessment, r)}</p>` : ''}
      </div>`).join('')}</div>`;
  }
  if (!detailed) return h;
  if (j.agreements.length) h += `<h3>${tr('Where the evidence agrees')}</h3>${listHtml(j.agreements, r)}`;
  if (j.gaps) h += `<h3>${tr('Gaps')}</h3><p class="prose-small" translate="no">${esc(j.gaps)}</p>`;
  h += `<details class="case" open><summary>${tr('Full case in support')} <span class="verdict small">${esc(VERDICT_TEXT[r.support.verdict])}</span></summary>
      <div class="case-body"><p translate="no">${markedHtml(r.support.summary, r)}</p>${sideDetailHtml(r.support, r)}</div></details>
    <details class="case"><summary>${tr('Full case against')} <span class="verdict small">${esc(VERDICT_TEXT[r.contest.verdict])}</span></summary>
      <div class="case-body"><p translate="no">${markedHtml(r.contest.summary, r)}</p>${sideDetailHtml(r.contest, r)}</div></details>`;
  return h;
}

function appChecksHtml(checks) {
  let h = '';
  const l = checks.logic;
  if (l && l.ok) {
    const vars = Object.entries(l.variables || {});
    h += `<div class="app-check ${l.valid ? 'good' : 'bad'}">
      <p class="app-check-title">${tr('Logical validity:')} <strong>${l.valid ? tr('Valid') : tr('Invalid')}</strong> <span class="tag">${tr('Checked by the app, {n} truth-table rows', { n: l.rows })}</span></p>
      <table class="logic-table"><tbody>
        ${l.premises.map((p, i) => `<tr><th scope="row">${tr('Premise {n}', { n: i + 1 })}</th><td translate="no">${esc(p.text)}</td><td><code>${esc(p.formula)}</code></td></tr>`).join('')}
        <tr><th scope="row">${tr('Conclusion')}</th><td translate="no">${esc(l.conclusion.text)}</td><td><code>${esc(l.conclusion.formula)}</code></td></tr>
      </tbody></table>
      ${vars.length ? `<p class="muted small">${tr('Where {list}.', { list: vars.map(([k, v]) => tr('{var} means “{meaning}”', { var: `<code>${esc(k)}</code>`, meaning: `<span translate="no">${esc(v)}</span>` })).join('; ') })}</p>` : ''}
      ${!l.valid ? `<p>${tr('Counterexample: every premise is true but the conclusion is false when {list}.', { list: Object.entries(l.counterexample).map(([k, v]) => `${tr(v ? '{var} is true' : '{var} is false', { var: `<code>${esc(k)}</code>` })}${l.variables && l.variables[k] ? ` (<span translate="no">${esc(l.variables[k])}</span>)` : ''}`).join(', ') })}</p>` : ''}
      ${!l.premisesConsistent ? '<p>The premises contradict each other, so the argument is only valid in an empty sense: anything follows from contradictory premises.</p>' : ''}
      <p class="muted small">Validity means the conclusion must be true if the premises are. Whether the premises are true is graded separately below.</p>
    </div>`;
  } else if (l && l.notFormalizable) {
    h += `<div class="app-check none"><p class="app-check-title">Logical validity: judged by the model, not the app</p><p class="muted small" translate="no">${esc(l.reason)}</p></div>`;
  } else if (l && !l.ok) {
    h += `<div class="app-check none"><p class="app-check-title">Logical validity: the app couldn't parse the formulas</p><p class="muted small">${esc(l.error)}</p></div>`;
  }
  if (checks.calculations.length) {
    h += `<div class="app-check"><p class="app-check-title">Calculations <span class="tag">Recomputed by the app</span></p>
      <div class="table-wrap"><table class="calc-table"><thead><tr><th>What</th><th>Expression</th><th>Claimed</th><th>Computed</th><th>Result</th></tr></thead><tbody>
      ${checks.calculations.map((c) => `<tr>
        <td translate="no">${esc(c.description)}</td><td><code>${esc(c.expression)}</code></td><td>${esc(c.claimed || '–')}</td>
        <td>${c.ok ? esc(formatNumber(c.computed)) : '–'}</td>
        <td>${!c.ok ? `<span class="tone none">Couldn't compute</span> <span class="muted small" translate="no">${esc(c.error)}</span>` : !c.comparable ? '<span class="tone none">No claimed value</span>' : c.matches ? (c.exact ? '<span class="tone good">Correct</span>' : '<span class="tone good">Correct when rounded</span>') : c.looseMatch ? '<span class="tone mid">Correct as a percentage</span>' : '<span class="tone bad">Wrong</span>'}</td>
      </tr>`).join('')}</tbody></table></div></div>`;
  }
  return h;
}

function formatDuration(ms) {
  if (ms < 1000) return tr('under a second');
  const s = Math.round(ms / 1000);
  return s < 60 ? trn(s, '{n} second', '{n} seconds') : tr('{m} min {s} s', { m: Math.floor(s / 60), s: s % 60 });
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return tr('just now');
  if (mins < 60) return trn(mins, '{n} minute ago', '{n} minutes ago');
  const h = Math.round(mins / 60);
  return trn(h, '{n} hour ago', '{n} hours ago');
}

function formatNumber(x) {
  if (!Number.isFinite(x)) return String(x);
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return x.toLocaleString();
  return Number(x.toPrecision(10)).toString();
}

function checkView(r, detailed) {
  let h = '';
  if (r.type === 'other') h += `<p class="notice">${tr('This looks like a historical, political or opinion statement rather than a scientific or logical one. "Evaluate" usually suits those better.')}</p>`;
  h += `<div class="prose" translate="no"><p>${markedHtml(r.summary, r)}</p></div>`;
  const exact = appChecksHtml(r.checks);
  if (exact) h += `<h3>${tr('Exact checks')}</h3>${exact}`;
  h += `<h3>${tr('Claims')}</h3>`;
  if (!detailed) {
    h += `<ul class="claim-list">${r.claims.map((c) => `<li><span class="tone ${CHECK_TONE[c.verdict]}">${esc(CHECK_TEXT[c.verdict])}</span> <span translate="no">${esc(c.text)}</span> ${[...new Set(c.evidence.map((ev) => ev.n))].map((n) => refChip(r, n)).join('')}</li>`).join('')}</ul>`;
    return h;
  }
  h += r.claims.map((c) => `
    <div class="claim">
      <p class="claim-head"><span class="tone ${CHECK_TONE[c.verdict]}">${esc(CHECK_TEXT[c.verdict])}</span> <span class="claim-text" translate="no">${esc(c.text)}</span></p>
      <p class="muted small">${esc(tr('{kind} claim, {confidence} confidence', { kind: tr(c.kind[0].toUpperCase() + c.kind.slice(1)), confidence: tr(c.confidence) }))}</p>
      ${c.explanation ? `<p class="argument-reasoning" translate="no">${markedHtml(c.explanation, r)}</p>` : ''}
      ${c.scopeNotes ? `<p class="scope-note"><strong>${tr('Limits:')}</strong> <span translate="no">${esc(c.scopeNotes)}</span></p>` : ''}
      ${c.evidence.length ? `<ul class="evidence">${c.evidence.map((ev) => evidenceItem(r, ev, `<span class="tag stance-${ev.stance}">${ev.stance === 'supports' ? tr('Supports') : ev.stance === 'contradicts' ? tr('Contradicts') : tr('Context')}</span><span class="tag">${esc(tr(ev.studyType))}</span>`)).join('')}</ul>` : ''}
    </div>`).join('');
  if (r.gaps) h += `<h3>${tr('Gaps in the sources')}</h3><p class="prose-small" translate="no">${esc(r.gaps)}</p>`;
  return h;
}

function verdictBadge(r) {
  if (r.mode === 'balanced') return `<span class="verdict">${esc(LEANING_TEXT[r.verdict] || r.verdict)}</span>${r.judgment.leaningReason ? `<p class="verdict-line" translate="no">${esc(r.judgment.leaningReason)}</p>` : ''}`;
  if (r.mode === 'check') return `<span class="verdict tone ${CHECK_TONE[r.verdict]}">${esc(CHECK_TEXT[r.verdict] || r.verdict)}</span>${r.verdictReason ? `<p class="verdict-line" translate="no">${esc(r.verdictReason)}</p>` : ''}`;
  return `<span class="verdict">${esc(VERDICT_TEXT[r.verdict] || r.verdict)}</span>${r.verdictReason ? `<p class="verdict-line" translate="no">${esc(r.verdictReason)}</p>` : ''}`;
}

function showResult(result) {
  stopSpeaking();
  ui.result = upgradeResult(result);
  const el = $('#result');
  el.className = `result mode-${ui.result.mode}`;
  el.hidden = false;
  el.setAttribute('tabindex', '-1');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', tr('Result'));
  renderResult();
  // Screen readers: say the result is ready, and move focus to it so it is read next.
  const r = ui.result;
  const verdict = r.mode === 'balanced' ? LEANING_TEXT[r.verdict] : r.mode === 'check' ? CHECK_TEXT[r.verdict] : VERDICT_TEXT[r.verdict];
  announce(tr('Result ready: {mode}, {verdict}.', { mode: MODE_LABEL[r.mode], verdict: verdict || r.verdict }));
  el.focus({ preventScroll: true });
  // Side by side, the result pane scrolls on its own: start it at the top.
  // Stacked (narrow screens), bring the result into view instead.
  const pane = $('#output-pane');
  if (pane && pane.scrollHeight > pane.clientHeight + 1 && getComputedStyle(pane).overflowY !== 'visible') pane.scrollTo({ top: 0 });
  else el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** The small print under a result, sentence by sentence so each one can be translated. */
function footnoteHtml(r, m, dropped) {
  const bits = [];
  const scope = [];
  if (m.sourcesSearched) scope.push(trn(m.sourcesSearched, '{n} website', '{n} websites'));
  if (m.foldersSearched) scope.push(trn(m.foldersSearched, '{n} local folder', '{n} local folders'));
  if (m.topic) bits.push(scope.length ? tr('Topic: {topic} ({scope}).', { topic: esc(tr(m.topic)), scope: scope.join(tr(' and ')) }) : tr('Topic: {topic}.', { topic: esc(tr(m.topic)) }));
  bits.push(`${trn(m.searches ?? 0, '{n} web search', '{n} web searches')}, ${trn(m.pagesRead ?? 0, '{n} passage read.', '{n} passages read.')}`);
  bits.push(dropped
    ? trn(dropped, '1 citation was removed because it didn\'t match a trusted page or passage the search returned.', '{n} citations were removed because they didn\'t match a trusted page or passage the search returned.')
    : tr('Every citation matches a trusted page or passage the search returned.'));
  if (m.provider) bits.push(tr('Model: {provider} {model}. Search: {search}.', { provider: esc(m.provider), model: esc(m.model), search: esc(tr(m.search)) }));
  if (m.usage && (m.usage.input || m.usage.output)) {
    bits.push(tr('Used {input} input and {output} output tokens in {calls}.', { input: m.usage.input.toLocaleString('en-IN'), output: m.usage.output.toLocaleString('en-IN'), calls: trn(m.usage.calls, '{n} model call', '{n} model calls') })
      + (m.usage.searchCredits ? ` ${trn(m.usage.searchCredits, 'Search used {n} Tavily credit.', 'Search used {n} Tavily credits.')}` : ''));
  }
  if (m.helperModel) bits.push(tr('Searches planned with {model}.', { model: esc(m.helperModel) }));
  if (m.searchFocus === 'support') bits.push(tr('Searched for supporting evidence only.'));
  else if (m.searchFocus === 'contest') bits.push(tr('Searched for challenging evidence only.'));
  if (m.reusedEvidence) bits.push(tr('<strong>Reused the evidence gathered {when}</strong> for this statement, so no new searches were needed.', { when: esc(timeAgo(m.reusedEvidence)) }));
  if (m.language && m.language !== 'en') bits.push(tr('Written in {language}.', { language: LANGS[m.language] ? LANGS[m.language].native : m.language }));
  if (m.durationMs) bits.push(tr('Took {time}.', { time: formatDuration(m.durationMs) }));
  bits.push(tr('Created {when}.', { when: fmtDateTime(r.createdAt) }));
  return bits.join(' ');
}

function renderResult() {
  const r = ui.result;
  const el = $('#result');
  const detailed = ui.mode === 'detailed';
  const simple = ui.mode === 'simple';
  const toggle = `<div class="segmented no-print" role="group" aria-label="Detail level">
    <button type="button" data-mode="simple" aria-pressed="${simple}" title="Plain words, for anyone">Simple</button>
    <button type="button" data-mode="summary" aria-pressed="${ui.mode === 'summary'}">Summary</button>
    <button type="button" data-mode="detailed" aria-pressed="${detailed}">Detailed</button></div>`;
  const back = ui.batchBack && ui.batchBack === r.createdAt && ui.batch ? `<p class="no-print batch-back"><button type="button" class="linkish" id="batch-back">${tr('← Back to the scorecard')}</button></p>` : '';
  let body = `${back}${r.sample ? sampleBannerHtml(r) : ''}${r.shared ? sharedBannerHtml(r) : ''}<div class="result-head"><p class="result-kind">${icon(MODE_ICON[r.mode])}<span>${MODE_LABEL[r.mode]}</span></p>${toggle}</div>
    <p class="result-statement" translate="no">${esc(r.statement)}</p>
    ${verdictBadge(r)}
    ${legendHtml(r)}`;
  if (simple) body += plainView(r);
  else if (r.mode === 'balanced') body += balancedView(r, detailed);
  else if (r.mode === 'check') body += checkView(r, detailed);
  else body += argumentView(r, detailed);
  if (!simple) body += qualityHtml(r);
  body += secondHtml(r);
  body += sourcesListHtml(r);

  const m = r.meta || {};
  const dropped = m.dropped ? (m.dropped.evidence || 0) + (m.dropped.markers || 0) : 0;
  body += `<p class="footnote" translate="no">${r.sample ? esc(tr(r.sampleNote || '')) : footnoteHtml(r, m, dropped)}</p>`;
  body += `
    <div class="result-actions no-print">
      ${r.sample ? `<button type="button" class="btn primary" id="sample-run">${icon(MODE_ICON[r.mode])}<span>Run this claim myself</span></button>` : ''}
      ${'speechSynthesis' in window ? `<button type="button" class="btn quiet" id="speak-btn" aria-pressed="false">${icon('speaker')}<span>${tr('Listen')}</span></button>` : ''}
      <button type="button" class="btn quiet" id="copy-btn">${icon('copy')}<span>Copy as text</span></button>
      <button type="button" class="btn quiet" id="print-btn">${icon('print')}<span>Print or save as PDF</span></button>
      <button type="button" class="btn quiet" id="word-btn">${icon('download')}<span>Download for Word</span></button>
      ${m.reusedEvidence ? `<button type="button" class="btn quiet" id="fresh-btn">${icon('refresh')}<span>Search again</span></button>` : ''}
      <button type="button" class="btn ghost" id="clear-result">${icon('close')}<span>Clear</span></button>
    </div>
    <div class="result-actions result-actions-2 no-print">
      <button type="button" class="btn quiet" id="share-btn">${icon('share')}<span>${tr('Share link')}</span></button>
      <button type="button" class="btn quiet" id="html-btn">${icon('download')}<span>${tr('Save as web page')}</span></button>
      ${r.pages.length ? `<button type="button" class="btn quiet" id="cite-btn">${icon('quote')}<span>${tr('Cite sources')}</span></button>` : ''}
      ${!r.sample && !r.shared ? `<button type="button" class="btn quiet" id="second-btn">${icon('compare')}<span>${tr('Second opinion')}</span></button>` : ''}
    </div>`;

  el.innerHTML = body;
  el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { ui.mode = b.dataset.mode; local.set(KEYS.view, ui.mode); renderResult(); }));
  bindPlainView(el);
  // The model's writing keeps its own language, so screen readers pronounce it properly.
  el.querySelectorAll('[translate=no]').forEach((n) => { if (!n.lang) { const l = guessLang(n.textContent); if (l) n.lang = l; } });
  bindResultTools(el, r);
  bindSecond(el, r);
  const backBtn = $('#batch-back', el);
  if (backBtn) backBtn.addEventListener('click', () => { ui.batchBack = null; showBatch(ui.batch); });
  const speak = $('#speak-btn', el);
  if (speak) speak.addEventListener('click', () => toggleSpeaking(r));
  const sampleRun = $('#sample-run', el);
  if (sampleRun) sampleRun.addEventListener('click', () => runSampleYourself(r));
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
  if (simple && !plainFor(r)) ensurePlain(r);
}

/* =====================================================================
 * UI: Simple view (plain-language version of a result)
 *
 * Written on request by the model from the finished result only, then kept
 * with the result in Recent results so it is made once.
 * ===================================================================== */
const plainJobs = new Map(); // createdAt -> { state: 'working' | 'error', message }

function plainKey(r) { return `${r.createdAt}|${r.statement}`; }

/** Turns [S2] / [2] markers into the result's [^2] references, keeping only numbers the result has. */
function markPlain(text, r) {
  return String(text || '').replace(/\[\s*S?(\d+(?:\s*[,;]\s*S?\d+)*)\s*\]/gi, (m0, ids) => {
    const ns = [...new Set(ids.split(/[,;]/).map((x) => Number(x.trim().replace(/^S/i, ''))).filter((n) => r.pages[n - 1]))];
    return ns.length ? `[^${ns.join(',')}]` : '';
  }).replace(/\s+([.,;:])/g, '$1').trim();
}

/** The Simple version in the current results language, if there is one. Examples carry one per language. */
function plainFor(r) {
  const lang = resultLang();
  if (r.plainByLang) return r.plainByLang[lang] || r.plainByLang.en || null;
  if (!r.plain) return null;
  return (r.plain.lang || 'en') === lang ? r.plain : null;
}

/** The plain-language prompt, asking for the results language. */
function plainSystem(lang) {
  return PLAIN_SYSTEM.replace('- Write in English.', `- Write in ${LANGS[lang] ? LANGS[lang].english : 'English'}${lang === 'as' ? ', using Assamese spelling (with ৰ and ৱ)' : ''}. Keep names of people, places and sources recognisable.`);
}

function plainView(r) {
  const p = plainFor(r);
  if (p) {
    return `<div class="plain-view">
      <p class="plain-headline" translate="no">${esc(p.headline)}</p>
      <div class="prose" translate="no"><p>${p.explanation.map((t) => markedHtml(t, r)).join(' ')}</p></div>
      ${p.watchOut ? `<p class="notice"><strong>${tr('The catch:')}</strong> <span translate="no">${markedHtml(p.watchOut, r)}</span></p>` : ''}
      ${p.checkNext.length ? `<h3>${tr('What to check next')}</h3>${listHtml(p.checkNext, r)}` : ''}
      <p class="muted small plain-note">${r.sample ? tr('A simplified version of the full result.') : tr('Written by the model from the full result, in simpler words. It adds nothing new.')} ${tr('Switch to <strong>Summary</strong> or <strong>Detailed</strong> to see the evidence behind each point.')}</p>
    </div>`;
  }
  const job = plainJobs.get(plainKey(r));
  if (job && job.state === 'error') {
    return `<div class="plain-view"><p class="status error">${esc(job.message)}</p>
      <div class="form-actions"><button type="button" class="btn quiet" data-plain-retry>${icon('refresh')}<span>${tr('Try again')}</span></button>
      ${/key|কী/i.test(job.message) ? `<button type="button" class="btn primary" data-open-setup>${tr('Set up a key')}</button>` : ''}</div></div>`;
  }
  return `<div class="plain-view plain-working" role="status"><span class="spinner" aria-hidden="true"></span><p>${tr('Writing a simple version of this result…')}</p></div>`;
}

function bindPlainView(el) {
  const retry = el.querySelector('[data-plain-retry]');
  if (retry) retry.addEventListener('click', () => { plainJobs.delete(plainKey(ui.result)); ensurePlain(ui.result, true); renderResult(); });
}

async function ensurePlain(r, force = false) {
  const key = plainKey(r);
  const lang = resultLang();
  if (plainFor(r) || (plainJobs.has(key) && !force)) return;
  plainJobs.set(key, { state: 'working' });
  try {
    const s = getSettings();
    const p = PROVIDERS[s.provider];
    if (!siteHasKey(s.provider)) throw new ProviderError(tr('The simple version is written by your AI model, and there\'s no {name} API key yet.', { name: p.name }));
    const model = (s.models[s.provider] || p.defaultModel || '').trim();
    const helper = (s.helperModels[s.provider] || '').trim();
    const kind = r.mode === 'support' ? 'a one-sided case IN SUPPORT of the statement' : r.mode === 'contest' ? 'a one-sided case AGAINST the statement' : r.mode === 'balanced' ? 'a balanced evaluation of both sides' : 'a correctness check';
    const text = await chat({ provider: s.provider, model: helper || model, light: true, json: true, system: plainSystem(lang), user: `This result is ${kind}.\n\nResult to rewrite:\n\n${resultText(r)}` });
    const j = extractJson(text, 'headline');
    if (!j || !j.headline) throw new ProviderError(tr('The simple version couldn\'t be read. Try again.'));
    const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);
    r.plain = {
      headline: String(j.headline).slice(0, 140),
      explanation: list(j.explanation).slice(0, 6).map((t) => markPlain(t, r)),
      watchOut: markPlain(j.watchOut, r),
      checkNext: list(j.checkNext).slice(0, 4).map((t) => markPlain(t, r)),
      model: helper || model,
      lang,
    };
    plainJobs.delete(key);
    if (!r.sample) {
      const items = readHistory();
      const i = items.findIndex((x) => x.createdAt === r.createdAt && x.statement === r.statement);
      if (i !== -1) { items[i].plain = r.plain; local.set(KEYS.history, items); }
    }
  } catch (err) {
    plainJobs.set(key, { state: 'error', message: err.message || tr('The simple version couldn\'t be written.') });
  }
  if (ui.result && plainKey(ui.result) === key && ui.mode === 'simple') renderResult();
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
  if (side.gaps) lines.push(`${indent}${tr('Gaps:')} ${side.gaps}`);
}

function resultText(r, { withPlain = false } = {}) {
  const lines = [`${MODE_LABEL[r.mode]}: ${r.statement}`, ''];
  const pl = withPlain ? plainFor(r) : null;
  if (pl) {
    lines.push(`${tr('In plain words:')} ${pl.headline}`, ...pl.explanation.map(plainText), '');
    if (pl.watchOut) lines.push(`${tr('The catch:')} ${plainText(pl.watchOut)}`, '');
    if (pl.checkNext.length) lines.push(tr('What to check next:'), ...pl.checkNext.map((t) => `- ${plainText(t)}`), '');
  }
  if (r.mode === 'balanced') {
    const j = r.judgment;
    lines.push(`${tr('Overall:')} ${LEANING_TEXT[r.verdict]}. ${j.leaningReason}`, '', plainText(j.assessment), '');
    lines.push(tr('Strongest points for:'), ...j.strongestFor.map((t) => `- ${plainText(t)}`), '');
    lines.push(tr('Strongest points against:'), ...j.strongestAgainst.map((t) => `- ${plainText(t)}`), '');
    if (j.conflicts.length) lines.push(tr('Where the sides disagree:'), ...j.conflicts.map((c) => `- ${c.issue} (favours: ${c.favours}): ${plainText(c.assessment)}`), '');
    if (j.agreements.length) lines.push(tr('Where the evidence agrees:'), ...j.agreements.map((t) => `- ${plainText(t)}`), '');
    if (j.gaps) lines.push(`${tr('Gaps:')} ${j.gaps}`, '');
    lines.push(tr('Full case in support').toUpperCase(), plainText(r.support.summary)); sideText(r.support, lines); lines.push('');
    lines.push(tr('Full case against').toUpperCase(), plainText(r.contest.summary)); sideText(r.contest, lines); lines.push('');
  } else if (r.mode === 'check') {
    lines.push(`${tr('Verdict:')} ${CHECK_TEXT[r.verdict]}. ${r.verdictReason}`, '', plainText(r.summary), '');
    const l = r.checks.logic;
    if (l && l.ok) lines.push(`Logical validity (checked by the app): ${l.valid ? 'VALID' : 'INVALID'}`, ...l.premises.map((p, i) => `  Premise ${i + 1}: ${p.text}  [${p.formula}]`), `  Conclusion: ${l.conclusion.text}  [${l.conclusion.formula}]`, '');
    r.checks.calculations.forEach((c) => lines.push(`Calculation: ${c.description}: ${c.expression} = ${c.ok ? formatNumber(c.computed) : 'n/a'}; claimed ${c.claimed || 'n/a'}; ${!c.ok ? 'could not compute' : !c.comparable ? 'no claimed value' : c.matches ? (c.exact ? 'correct' : 'correct when rounded') : 'wrong'}`));
    if (r.checks.calculations.length) lines.push('');
    r.claims.forEach((c) => {
      lines.push(`${c.id} [${CHECK_TEXT[c.verdict]}, ${c.confidence} confidence] ${c.text}`, `   ${plainText(c.explanation)}`);
      if (c.scopeNotes) lines.push(`   Limits: ${c.scopeNotes}`);
      c.evidence.forEach((ev) => lines.push(`   - [${ev.n}] ${ev.stance}, ${ev.studyType}: ${ev.excerpt}`));
    });
    if (r.gaps) lines.push('', `${tr('Gaps:')} ${r.gaps}`);
    lines.push('');
  } else {
    lines.push(`${tr('Evidence:')} ${VERDICT_TEXT[r.verdict]}. ${r.verdictReason}`, '', plainText(r.summary), '');
    sideText(r, lines); lines.push('');
  }
  if (r.pages.length) lines.push(tr('Sources:'), ...r.pages.map((p) => `[${p.n}] ${p.title}, ${r.sites[p.site].label}.${p.local ? ' (local file)' : ` ${p.url}`}`));
  return lines.join('\n');
}

function copyResult() {
  navigator.clipboard.writeText(resultText(ui.result, { withPlain: true })).then(
    () => { const b = $('#copy-btn span'); b.textContent = tr('Copied'); setTimeout(() => { b.textContent = tr('Copy as text'); }, 1500); },
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
  const blob = new Blob(['\ufeff', exportHtml(r, { forWord: true })], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${MODE_FILE[r.mode] || 'result'}-${fileSlug(r.statement, 'result')}.doc`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* =====================================================================
 * UI: history (this device)
 * ===================================================================== */
const readHistory = () => local.get(KEYS.history, []);
const HISTORY_MAX = 40;
function saveToHistory(result) {
  const items = [result, ...readHistory()].slice(0, HISTORY_MAX);
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
        <span class="h-dir ${esc(mode)}">${icon(MODE_ICON[mode])}${MODE_SHORT[mode] || ''}</span>
        <span class="h-text" translate="no">${esc(r.statement)}</span>
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

/* =====================================================================
 * Accessibility: announcements and reading a result aloud
 * ===================================================================== */
function announce(text) {
  const box = document.getElementById('sr-announce');
  if (!box) return;
  box.textContent = '';
  setTimeout(() => { box.textContent = text; }, 60);
}

const speech = { on: false };
const SPEECH_LOCALE = { en: 'en-IN', bn: 'bn-IN', as: 'as-IN', hi: 'hi-IN' };

/** The voice for a language; Assamese falls back to a Bengali voice (same script), then nothing. */
function voiceFor(lang) {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  const pick = (code) => voices.find((v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(code));
  return pick(`${lang}-in`) || pick(lang) || (lang === 'as' ? pick('bn-in') || pick('bn') : null);
}

/** What is read: the verdict, then the Simple version if shown (or there), else the summary. */
function speechParts(r) {
  const verdict = r.mode === 'balanced' ? LEANING_TEXT[r.verdict] : r.mode === 'check' ? CHECK_TEXT[r.verdict] : VERDICT_TEXT[r.verdict];
  const clean = (t) => plainText(t).replace(/\[\d+(?:,\d+)*\]/g, '').replace(/\s+/g, ' ').trim();
  const parts = [`${MODE_LABEL[r.mode]}.`, r.statement, `${verdict}.`];
  const p = plainFor(r);
  if (p && ui.mode === 'simple') {
    parts.push(p.headline, ...p.explanation.map(clean));
    if (p.watchOut) parts.push(`${tr('The catch:')} ${clean(p.watchOut)}`);
  } else {
    const reason = r.mode === 'balanced' ? r.judgment.leaningReason : r.verdictReason;
    if (reason) parts.push(reason);
    parts.push(clean(r.mode === 'balanced' ? r.judgment.assessment : r.summary));
  }
  return parts.filter(Boolean);
}

function stopSpeaking() {
  if (window.speechSynthesis) speechSynthesis.cancel();
  speech.on = false;
  const b = document.getElementById('speak-btn');
  if (b) { b.setAttribute('aria-pressed', 'false'); b.querySelector('span').textContent = tr('Listen'); }
}

function toggleSpeaking(r) {
  if (speech.on) { stopSpeaking(); return; }
  const parts = speechParts(r);
  const missing = new Set();
  speech.on = true;
  const b = document.getElementById('speak-btn');
  b.setAttribute('aria-pressed', 'true');
  b.querySelector('span').textContent = tr('Stop reading');
  parts.forEach((text, i) => {
    const lang = guessLang(text) || I18N.lang;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LOCALE[lang] || 'en-IN';
    const v = voiceFor(lang);
    if (v) u.voice = v; else if (lang !== 'en') missing.add(lang);
    if (i === parts.length - 1) u.onend = () => stopSpeaking();
    speechSynthesis.speak(u);
  });
  if (missing.size) {
    setStatus(tr('This device has no voice for {languages}, so that part may be read badly or skipped. You can add one in your system’s speech or language settings.', { languages: [...missing].map((l) => (LANGS[l] ? LANGS[l].native : l)).join(', ') }));
  }
}
if (window.speechSynthesis) speechSynthesis.getVoices(); // starts loading the voice list
