/* Evaluator: compare.js
 *
 * Second opinion: the same statement, the same mode and (where it is still
 * saved) the same evidence, judged again by another model. If two models
 * reading the same sources come to different verdicts, the evidence is
 * probably less clear-cut than either one makes it sound.
 *
 * The comparison is kept with the first result (r.second) and the second
 * result is saved to Recent results as well.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/** Verdicts in order, from most for to most against; the special "can't tell" values are kept apart. */
const VERDICT_SCALES = {
  side: { order: ['strong', 'moderate', 'weak'], none: 'insufficient' },
  balanced: { order: ['well supported', 'leans towards support', 'evenly balanced', 'leans against', 'not supported'], none: 'insufficient evidence' },
  check: { order: ['true', 'mostly true', 'mixed', 'mostly false', 'false'], none: 'unverified' },
};
const scaleFor = (mode) => (mode === 'balanced' ? VERDICT_SCALES.balanced : mode === 'check' ? VERDICT_SCALES.check : VERDICT_SCALES.side);

/** 'agree' | 'partly' | 'disagree' for two verdicts on the same scale. */
function agreement(mode, a, b) {
  const s = scaleFor(mode);
  if (a === b) return 'agree';
  if (a === s.none || b === s.none) return 'partly';
  const d = Math.abs(s.order.indexOf(a) - s.order.indexOf(b));
  return d <= 1 ? 'partly' : 'disagree';
}

const AGREE_TEXT = { agree: 'Agrees', partly: 'Partly agrees', disagree: 'Disagrees' };
const AGREE_TONE = { agree: 'good', partly: 'mid', disagree: 'bad' };

function verdictText(mode, v) {
  return (mode === 'balanced' ? LEANING_TEXT[v] : mode === 'check' ? CHECK_TEXT[v] : VERDICT_TEXT[v]) || v;
}

const words = (t) => new Set(String(t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
function overlap(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
  return n / (A.size + B.size - n);
}

/** Verify mode: each claim of the first result matched to the closest claim of the second. */
function matchClaims(a, b) {
  const used = new Set();
  return (a.claims || []).map((c) => {
    let best = -1, score = 0;
    (b.claims || []).forEach((d, i) => { const s = overlap(c.text, d.text); if (!used.has(i) && s > score) { score = s; best = i; } });
    if (best !== -1 && score >= 0.3) { used.add(best); const d = b.claims[best]; return { text: c.text, first: c.verdict, second: d.verdict, agreement: agreement('check', c.verdict, d.verdict) }; }
    return { text: c.text, first: c.verdict, second: null, agreement: null };
  });
}

function makeSecond(first, other) {
  return {
    provider: other.meta.provider, model: other.meta.model, createdAt: other.createdAt,
    verdict: other.verdict, verdictReason: other.mode === 'balanced' ? other.judgment.leaningReason : other.verdictReason,
    agreement: agreement(first.mode, first.verdict, other.verdict),
    sameEvidence: Boolean(other.meta.reusedEvidence),
    claims: first.mode === 'check' ? matchClaims(first, other) : [],
  };
}

/** For results that come from outside (links, files). */
function cleanSecond(s) {
  const all = [...new Set([...SIDE_VERDICTS, ...LEANINGS, ...CHECK_VERDICTS])];
  const AG = ['agree', 'partly', 'disagree'];
  return {
    provider: S(s.provider, 80), model: S(s.model, 200), createdAt: Number.isFinite(Date.parse(s.createdAt)) ? new Date(s.createdAt).toISOString() : '',
    verdict: E(s.verdict, all, 'unverified'), verdictReason: S(s.verdictReason, 600), agreement: E(s.agreement, AG, 'partly'), sameEvidence: Boolean(s.sameEvidence),
    claims: A(s.claims, 20).map((c) => ({ text: S(c && c.text, 800), first: E(c && c.first, CHECK_VERDICTS, 'unverified'), second: c && c.second ? E(c.second, CHECK_VERDICTS, 'unverified') : null, agreement: c && c.agreement ? E(c.agreement, AG, 'partly') : null })),
  };
}

function secondHtml(r) {
  const s = r.second;
  if (!s) return '';
  const inHistory = !r.shared && readHistory().some((x) => x.createdAt === s.createdAt);
  const lead = s.agreement === 'agree'
    ? tr('Both models reached the same verdict.')
    : s.agreement === 'partly'
      ? tr('The models were close but not the same. Read both before relying on either.')
      : tr('The models disagree. The evidence is probably less clear-cut than either result makes it sound.');
  return `<section class="second second-${s.agreement}" aria-labelledby="second-h">
    <h3 id="second-h">${tr('Second opinion')} <span class="tone ${AGREE_TONE[s.agreement]}">${tr(AGREE_TEXT[s.agreement])}</span></h3>
    <p>${tr('{model} gave: {verdict}.', { model: `<span translate="no">${esc(`${s.provider} ${s.model}`.trim())}</span>`, verdict: `<strong>${esc(verdictText(r.mode, s.verdict))}</strong>` })} ${lead}</p>
    ${s.verdictReason ? `<p class="muted small" translate="no">${esc(s.verdictReason)}</p>` : ''}
    ${s.claims.length ? `<div class="table-wrap"><table class="second-table"><thead><tr><th>${tr('Claim')}</th><th>${tr('First')}</th><th>${tr('Second')}</th></tr></thead><tbody>
      ${s.claims.map((c) => `<tr><td translate="no">${esc(c.text)}</td><td>${esc(CHECK_TEXT[c.first] || c.first)}</td><td>${c.second ? `<span class="tone ${AGREE_TONE[c.agreement]}">${esc(CHECK_TEXT[c.second] || c.second)}</span>` : `<span class="muted">${tr('Not checked')}</span>`}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
    <p class="muted small">${s.sameEvidence ? tr('Both read the same evidence.') : tr('The second model gathered its own evidence, so some differences may come from the sources.')}</p>
    ${inHistory ? `<div class="form-actions no-print"><button type="button" class="btn quiet" id="open-second">${tr('Open the second result')}</button></div>` : ''}
  </section>`;
}

function bindSecond(el, r) {
  const b = $('#open-second', el);
  if (b) b.addEventListener('click', () => { const x = readHistory().find((h) => h.createdAt === r.second.createdAt); if (x) showResult(x); });
}

/** Providers with a key (or a local server) set, for the second opinion. */
function readyProviders() {
  const s = getSettings();
  // A model on this computer counts only once it has been set up (an address or a model chosen).
  const localSet = Boolean((SettingsFile.data && SettingsFile.data.localUrl) || (s.models && s.models.local) || s.provider === 'local');
  return Object.keys(PROVIDERS).filter((id) => { try { return (id !== 'local' || localSet) && providerReady(id); } catch { return false; } });
}

function openSecondOpinion(r) {
  const s = getSettings();
  const ready = readyProviders();
  const firstProv = (r.meta && r.meta.provider) || '';
  const firstId = Object.keys(PROVIDERS).find((id) => PROVIDERS[id].name === firstProv || id === firstProv) || s.provider;
  const pick = ready.find((id) => id !== firstId) || ready[0];
  if (!pick) {
    toolDialog(tr('Second opinion'), `<p>${tr('A second opinion needs an AI model with a key set up. Add one in Settings, ideally from a different company to the first.')}</p>
      <div class="setup-actions"><button type="button" class="btn primary" data-open-setup data-autofocus>${tr('Set up a key')}</button></div>`);
    return;
  }
  const modelFor = (id) => (s.models[id] || PROVIDERS[id].defaultModel || '').trim();
  toolDialog(tr('Second opinion'), `
    <p>${tr('Ask another model to judge the same statement. Where the evidence from the first run is still saved, it is reused, so only the judging is repeated.')}</p>
    <label class="field-label" for="second-provider">${tr('Model provider')}</label>
    <select id="second-provider" data-autofocus>${ready.map((id) => `<option value="${id}"${id === pick ? ' selected' : ''} translate="no">${esc(PROVIDERS[id].name)}${id === firstId ? ` (${esc(tr('same as the first'))})` : ''}</option>`).join('')}</select>
    <label class="field-label" for="second-model">${tr('Model')}</label>
    <input id="second-model" type="text" autocomplete="off" spellcheck="false" translate="no" value="${esc(modelFor(pick))}">
    <p class="hint" id="second-hint"></p>
    <div class="setup-actions"><button type="button" class="btn primary" data-run>${icon('compare')}<span>${tr('Get a second opinion')}</span></button></div>`, (body, dlg) => {
    const sel = body.querySelector('#second-provider');
    const inp = body.querySelector('#second-model');
    const hint = () => {
      const same = sel.value === firstId && inp.value.trim() === (r.meta.model || '');
      body.querySelector('#second-hint').textContent = same ? tr('This is the same model as the first run. A different model gives a more useful second opinion.') : (sel.value === firstId ? tr('Same company, different model. A model from another company is more independent.') : '');
    };
    sel.addEventListener('change', () => { inp.value = modelFor(sel.value); hint(); });
    inp.addEventListener('input', hint);
    hint();
    body.querySelector('[data-run]').addEventListener('click', () => {
      const use = { provider: sel.value, model: inp.value.trim() };
      dlg.close();
      runSecondOpinion(r, use);
    });
  });
}

async function runSecondOpinion(r, use) {
  if (!navigator.onLine && !isLocalAddress(localBase())) { setStatus(tr('You\'re offline. Connect to the internet to run a new analysis.'), true); return; }
  setStatus('');
  ui.controller = new AbortController();
  setBusy(true, r.mode);
  $('#busy-title').textContent = tr('Second opinion in progress');
  const progress = (text) => { $('#busy-msg').textContent = text; };
  try {
    const other = await runAnalysis({ mode: r.mode, statement: r.statement, signal: ui.controller.signal, progress, use });
    other.secondOf = r.createdAt;
    r.second = makeSecond(r, other);
    const items = readHistory();
    const i = items.findIndex((x) => x.createdAt === r.createdAt && x.statement === r.statement);
    if (i !== -1) { items[i].second = r.second; local.set(KEYS.history, items); }
    saveToHistory(other);
    showResult(r);
    const sec = $('#second-h');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    announce(tr('Second opinion: {agreement}.', { agreement: tr(AGREE_TEXT[r.second.agreement]) }));
  } catch (err) {
    if (err.name === 'AbortError') setStatus(tr('Stopped.'));
    else setStatus(esc(err.message), true);
  } finally {
    setBusy(false);
    ui.controller = null;
    renderBalances(true);
  }
}
