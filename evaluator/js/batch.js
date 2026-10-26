/* Evaluator: batch.js
 *
 * Checking several claims at once: one claim per line (up to 20), run one
 * after another with the chosen mode, then a scorecard with every verdict.
 * Each claim is a full run, saved to Recent results like any other, so the
 * scorecard links to them. The scorecard can be saved as a CSV file for a
 * spreadsheet.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

const BATCH_MAX = 20;
const BATCH_KEY = 'evaluator.batch.v1';
const batch = { suggestions: new Map(), running: false };

function batchLines() {
  const seen = new Set();
  return $('#batch-text').value.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length >= 10 && !seen.has(l) && seen.add(l));
}

function renderBatchCount() {
  const n = batchLines().length;
  const box = $('#batch-count');
  if (!box) return;
  box.textContent = n ? `${trn(n, '{n} claim', '{n} claims')}${n > BATCH_MAX ? ` ${tr('Only the first {max} will be checked.', { max: BATCH_MAX })}` : ''}` : '';
  const sug = $('#batch-mode option[value="suggested"]');
  if (sug) sug.hidden = sug.disabled = !batch.suggestions.size;
  if (sug && sug.disabled && $('#batch-mode').value === 'suggested') $('#batch-mode').value = 'balanced';
}

/** Fills the batch box from the claim finder, keeping its suggested button for each claim. */
function batchFromFinder(claims) {
  batch.suggestions = new Map(claims.map((c) => [c.text.trim(), c.suggest]));
  $('#batch-text').value = claims.map((c) => c.text.trim()).join('\n');
  $('#batch-wrap').open = true;
  renderBatchCount();
  $('#batch-mode').value = 'suggested';
  $('#batch-wrap').scrollIntoView({ block: 'start', behavior: 'smooth' });
  $('#batch-go').focus({ preventScroll: true });
}

async function runBatch() {
  if (batch.running) return;
  const claims = batchLines().slice(0, BATCH_MAX);
  if (!claims.length) { $('#batch-msg').textContent = tr('Write at least one claim, one per line.'); $('#batch-text').focus(); return; }
  if (!navigator.onLine) { setStatus(tr('You\'re offline. Connect to the internet to run a new analysis.'), true); return; }
  const choice = $('#batch-mode').value;
  const modeFor = (text) => (choice === 'suggested' ? batch.suggestions.get(text) || 'balanced' : choice);
  $('#batch-msg').textContent = '';
  setStatus('');
  batch.running = true;
  ui.controller = new AbortController();
  const rows = claims.map((text) => ({ statement: text, mode: modeFor(text), state: 'waiting' }));
  const card = { createdAt: new Date().toISOString(), rows };
  setBusy(true, rows[0].mode);
  $('#result').hidden = true;
  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (ui.controller.signal.aborted) { row.state = 'skipped'; continue; }
      $('#busy-title').textContent = tr('Checking claim {i} of {n}', { i: i + 1, n: rows.length });
      const progress = (text) => { $('#busy-msg').textContent = text; };
      try {
        const r = await runAnalysis({ mode: row.mode, statement: row.statement, signal: ui.controller.signal, progress });
        saveToHistory(r);
        Object.assign(row, { state: 'done', createdAt: r.createdAt, verdict: r.verdict, sources: r.pages.length, sites: new Set(r.pages.map((p) => p.site)).size });
      } catch (err) {
        if (err.name === 'AbortError') { row.state = 'skipped'; continue; }
        Object.assign(row, { state: 'error', error: err.message || String(err) });
        // A missing key or model fails every claim the same way: stop here.
        if (err instanceof ProviderError && /key|model|Settings|কী|মডেল/i.test(err.message) && !rows.some((x) => x.state === 'done')) { rows.slice(i + 1).forEach((x) => { x.state = 'skipped'; }); break; }
      }
      local.set(BATCH_KEY, card);
    }
  } finally {
    rows.forEach((x) => { if (x.state === 'waiting') x.state = 'skipped'; });
    local.set(BATCH_KEY, card);
    batch.running = false;
    setBusy(false);
    ui.controller = null;
    renderBalances(true);
    renderLastBatch();
  }
  showBatch(card);
}

function verdictTone(mode, v) {
  if (mode === 'check') return CHECK_TONE[v] || 'none';
  if (mode === 'balanced') return { 'well supported': 'good', 'leans towards support': 'good', 'evenly balanced': 'mid', 'leans against': 'bad', 'not supported': 'bad' }[v] || 'none';
  return v === 'insufficient' ? 'none' : 'mid';
}

function showBatch(card) {
  stopSpeaking();
  ui.result = null;
  ui.batch = card;
  const el = $('#result');
  el.className = 'result result-batch';
  el.hidden = false;
  el.setAttribute('tabindex', '-1');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', tr('Scorecard'));
  const done = card.rows.filter((r) => r.state === 'done').length;
  const failed = card.rows.filter((r) => r.state === 'error').length;
  const skipped = card.rows.filter((r) => r.state === 'skipped').length;
  const hist = readHistory();
  el.innerHTML = `<div class="result-head"><p class="result-kind">${icon('list')}<span>${tr('Scorecard')}</span></p></div>
    <p>${tr('{done} of {n} claims checked.', { done, n: card.rows.length })}${failed ? ` ${trn(failed, '{n} failed.', '{n} failed.')}` : ''}${skipped ? ` ${trn(skipped, '{n} not run.', '{n} not run.')}` : ''} <span class="muted">${esc(fmtDateTime(card.createdAt))}</span></p>
    <div class="table-wrap"><table class="batch-table">
      <thead><tr><th scope="col">#</th><th scope="col">${tr('Claim')}</th><th scope="col">${tr('Mode')}</th><th scope="col">${tr('Result')}</th><th scope="col"><span class="visually-hidden">${tr('Open')}</span></th></tr></thead>
      <tbody>${card.rows.map((row, i) => {
        const has = row.state === 'done' && hist.some((h) => h.createdAt === row.createdAt);
        const res = row.state === 'done'
          ? `<span class="tone ${verdictTone(row.mode, row.verdict)}">${esc(verdictText(row.mode, row.verdict))}</span> <span class="muted small">${trn(row.sources, '{n} source', '{n} sources')}</span>`
          : row.state === 'error' ? `<span class="tone bad">${tr('Failed')}</span> <span class="muted small">${esc(row.error)}</span>` : `<span class="muted">${tr('Not run')}</span>`;
        return `<tr><td>${i + 1}</td><td translate="no">${esc(row.statement)}</td><td>${esc(MODE_SHORT[row.mode] || row.mode)}</td><td>${res}</td>
          <td>${has ? `<button type="button" class="btn quiet small" data-batch-open="${i}">${tr('Open')}</button>` : row.state !== 'done' ? `<button type="button" class="btn ghost small" data-batch-fill="${i}">${tr('Fill in')}</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="result-actions no-print">
      <button type="button" class="btn quiet" id="batch-csv">${icon('download')}<span>${tr('Download CSV')}</span></button>
      <button type="button" class="btn ghost" id="batch-close">${icon('close')}<span>${tr('Close')}</span></button>
    </div>`;
  el.querySelectorAll('[data-batch-open]').forEach((b) => b.addEventListener('click', () => {
    const row = card.rows[Number(b.dataset.batchOpen)];
    const r = readHistory().find((h) => h.createdAt === row.createdAt);
    if (r) { ui.batchBack = r.createdAt; $('#statement').value = r.statement; showResult(r); }
  }));
  el.querySelectorAll('[data-batch-fill]').forEach((b) => b.addEventListener('click', () => {
    const row = card.rows[Number(b.dataset.batchFill)];
    $('#statement').value = row.statement;
    const t = document.querySelector(`button.act[value="${row.mode}"]`);
    if (t) { t.classList.add('suggested'); setTimeout(() => t.classList.remove('suggested'), 4000); t.focus(); }
  }));
  $('#batch-csv', el).addEventListener('click', () => downloadBatchCsv(card));
  $('#batch-close', el).addEventListener('click', () => { el.hidden = true; ui.batch = null; });
  announce(tr('Scorecard ready: {done} of {n} claims checked.', { done, n: card.rows.length }));
  el.focus({ preventScroll: true });
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheets reading it as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBatchCsv(card) {
  const head = ['#', 'Claim', 'Mode', 'Result', 'Sources', 'Websites', 'Checked at', 'Error'];
  const lines = [head, ...card.rows.map((r, i) => [i + 1, r.statement, MODE_LABEL[r.mode] || r.mode, r.state === 'done' ? verdictText(r.mode, r.verdict) : r.state === 'error' ? 'Failed' : 'Not run', r.sources ?? '', r.sites ?? '', r.createdAt || '', r.error || ''])];
  downloadText(`scorecard-${card.createdAt.slice(0, 10)}.csv`, `﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`, 'text/csv');
}

function renderLastBatch() {
  const box = $('#batch-last');
  if (!box) return;
  const card = local.get(BATCH_KEY, null);
  box.hidden = !(card && Array.isArray(card.rows) && card.rows.length);
}

function initBatch() {
  if (!$('#batch')) return;
  $('#batch-text').addEventListener('input', () => {
    // Suggestions only apply to the claims they came with.
    const lines = new Set(batchLines());
    [...batch.suggestions.keys()].forEach((k) => { if (!lines.has(k)) batch.suggestions.delete(k); });
    renderBatchCount();
  });
  $('#batch-go').addEventListener('click', runBatch);
  $('#batch-last-btn').addEventListener('click', () => { const c = local.get(BATCH_KEY, null); if (c) showBatch(c); });
  renderBatchCount();
  renderLastBatch();
}
