/* Evaluator: settings.js
 *
 * Balances and quotas, and the Settings panel for model, search and keys.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/* =====================================================================
 * Balances and quotas
 *
 * Only some services let an app read the balance with an ordinary API key:
 * OpenRouter (GET /api/v1/key) and Tavily (GET /usage). For the others the
 * app links to the provider's billing page instead.
 * ===================================================================== */
const BILLING_PAGES = {
  gemini: 'https://aistudio.google.com', groq: 'https://console.groq.com', mistral: 'https://console.mistral.ai',
  openai: 'https://platform.openai.com', anthropic: 'https://platform.claude.com', openrouter: 'https://openrouter.ai/settings/credits',
};
let balanceCache = { at: 0, key: '', items: null };

const money = (n) => `$${Number(n).toFixed(2)}`;

async function fetchBalances(force = false) {
  const s = getSettings();
  const provider = s.provider;
  const p = PROVIDERS[provider];
  const needsTavily = effectiveSearch(s) === 'tavily' || !p.builtinSearch;
  const cacheKey = `${provider}|${s.keys[provider] || ''}|${needsTavily ? s.keys.tavily || '' : ''}`;
  if (!force && balanceCache.items && balanceCache.key === cacheKey && Date.now() - balanceCache.at < 90000) return balanceCache.items;
  const items = [];

  const key = s.keys[provider];
  if (!key) {
    items.push({ name: p.name, text: 'Add an API key to see usage.', tone: 'none' });
  } else if (provider === 'openrouter') {
    try {
      const d = (await getJson('OpenRouter', 'https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${key}` })).data || {};
      const bits = [];
      let pct = null;
      if (d.limit_remaining != null && d.limit != null) {
        bits.push(`${money(d.limit_remaining)} of ${money(d.limit)} left on this key${d.limit_reset ? ` (resets ${d.limit_reset})` : ''}`);
        pct = d.limit ? d.limit_remaining / d.limit : null;
      } else {
        bits.push(`${money(d.usage || 0)} used by this key${d.usage_monthly != null ? `, ${money(d.usage_monthly)} this month` : ''}; no spending limit set`);
      }
      const fr = d.free_model_daily_requests;
      if (fr && typeof fr === 'object') {
        const lim = fr.limit ?? fr.ceiling ?? fr.max;
        const used = fr.used ?? fr.count ?? (lim != null && fr.remaining != null ? lim - fr.remaining : null);
        const rem = fr.remaining ?? (lim != null && used != null ? lim - used : null);
        if (lim != null && rem != null) { bits.push(`free models: ${rem} of ${lim} requests left today`); if (pct == null) pct = lim ? rem / lim : null; }
      }
      if (d.is_free_tier) bits.push('free tier');
      items.push({ name: 'OpenRouter', text: bits.join('; '), pct, link: BILLING_PAGES.openrouter });
    } catch (err) {
      items.push({ name: 'OpenRouter', text: `Couldn't read usage: ${err.message}`, tone: 'bad', link: BILLING_PAGES.openrouter });
    }
  } else {
    items.push({ name: p.name, text: `${p.name} doesn't let apps read your balance or free-tier quota. Check it on their site; each result here shows the tokens it used.`, tone: 'none', link: BILLING_PAGES[provider] });
  }

  if (needsTavily) {
    if (!s.keys.tavily) {
      items.push({ name: 'Tavily', text: 'Add a Tavily key to see searches left.', tone: 'none' });
    } else {
      try {
        const d = await getJson('Tavily', 'https://api.tavily.com/usage', { Authorization: `Bearer ${s.keys.tavily}` });
        const acc = d.account || {}, k = d.key || {};
        const limit = acc.plan_limit ?? k.limit;
        const used = acc.plan_usage ?? k.usage ?? 0;
        if (limit != null) {
          const left = Math.max(0, limit - used);
          items.push({ name: 'Tavily', text: `${left.toLocaleString()} of ${Number(limit).toLocaleString()} search credits left this month${acc.current_plan ? ` (${acc.current_plan} plan)` : ''}`, pct: limit ? left / limit : null, link: 'https://app.tavily.com' });
        } else {
          items.push({ name: 'Tavily', text: `${Number(used).toLocaleString()} credits used this month; no limit reported`, link: 'https://app.tavily.com' });
        }
      } catch (err) {
        items.push({ name: 'Tavily', text: `Couldn't read usage: ${err.message}`, tone: 'bad', link: 'https://app.tavily.com' });
      }
    }
  }
  balanceCache = { at: Date.now(), key: cacheKey, items };
  return items;
}

function balanceHtml(items, compact) {
  return items.map((b) => {
    const pct = b.pct == null ? null : Math.max(0, Math.min(1, b.pct));
    const tone = b.tone || (pct == null ? 'none' : pct < 0.1 ? 'bad' : pct < 0.25 ? 'mid' : 'good');
    if (compact) {
      return `<span class="bal ${tone}">${pct != null ? `<span class="bal-bar"><span style="width:${Math.round(pct * 100)}%"></span></span>` : ''}<strong>${esc(b.name)}:</strong> ${esc(b.text)}</span>`;
    }
    return `<li class="bal ${tone}">
      <div><strong>${esc(b.name)}</strong> ${esc(b.text)}${b.link ? ` <a href="${esc(b.link)}" target="_blank" rel="noopener">Open billing</a>` : ''}</div>
      ${pct != null ? `<div class="bal-bar wide" role="img" aria-label="${Math.round(pct * 100)}% left"><span style="width:${Math.round(pct * 100)}%"></span></div>` : ''}
    </li>`;
  }).join('');
}

async function renderBalances(force = false) {
  const box = $('#balance-list');
  const line = $('#balance-line');
  if (!navigator.onLine) { line.textContent = ''; return; }
  if (box) box.innerHTML = '<li class="muted">Checking…</li>';
  try {
    const items = await fetchBalances(force);
    if (box) box.innerHTML = balanceHtml(items, false);
    const live = items.filter((b) => b.pct != null || b.tone === 'bad');
    line.innerHTML = live.length ? balanceHtml(live, true) : '';
  } catch {
    if (box) box.innerHTML = '<li class="muted">Couldn\'t check balances right now.</li>';
  }
}

/* =====================================================================
 * Settings
 * ===================================================================== */
function getSettings() {
  const s = local.get(KEYS.settings, {});
  const keys = { ...(s.keys || {}) };
  const models = { ...(s.models || {}) };
  if (typeof s.apiKey === 'string' && s.apiKey && !keys.anthropic) keys.anthropic = s.apiKey; // v1 migration
  if (typeof s.model === 'string' && s.model && !models.anthropic) models.anthropic = s.model;
  const provider = PROVIDERS[s.provider] ? s.provider : (keys.anthropic ? 'anthropic' : 'gemini');
  return {
    provider, keys, models, helperModels: { ...(s.helperModels || {}) },
    search: s.search === 'builtin' || (s.search === undefined && typeof s.apiKey === 'string' && s.apiKey) ? 'builtin' : 'tavily',
    maxSearches: [3, 4, 6, 8].includes(Number(s.maxSearches)) ? Number(s.maxSearches) : 4,
    searchFocus: s.searchFocus === 'shared' ? 'shared' : 'own',
  };
}

function effectiveSearch(settings) {
  return settings.search === 'builtin' && PROVIDERS[settings.provider].builtinSearch ? 'builtin' : 'tavily';
}

function saveSettings(patch) {
  const s = getSettings();
  return local.set(KEYS.settings, {
    ...s, ...patch,
    keys: { ...s.keys, ...(patch.keys || {}) },
    models: { ...s.models, ...(patch.models || {}) },
    helperModels: { ...s.helperModels, ...(patch.helperModels || {}) },
  });
}

function missingItems(scope) {
  const s = getSettings();
  const p = PROVIDERS[s.provider];
  const missing = [];
  if (!s.keys[s.provider]) missing.push(`${p.name} API key`);
  if (!(s.models[s.provider] || p.defaultModel)) missing.push(`${p.name} model`);
  const webInScope = scope ? scope.web.length > 0 : true;
  if (webInScope && effectiveSearch(s) === 'tavily' && !s.keys.tavily) missing.push('Tavily API key');
  return missing;
}
const isReady = () => missingItems().length === 0;

function renderProviderFields() {
  const f = $('#key-form');
  const s = getSettings();
  const provider = f.provider.value;
  const p = PROVIDERS[provider];
  f.apiKey.value = s.keys[provider] || '';
  f.apiKey.placeholder = p.keyHint || 'Paste your key';
  renderModelSelect(provider, s.models[provider] || p.defaultModel);
  $('#key-label-text').textContent = `${p.name} API key`;
  $('#key-link').href = p.keyUrl;
  $('#key-link').textContent = `Get an API key from ${p.name}`;
  $('#models-msg').textContent = '';
  const builtinRadio = $('#search-builtin');
  builtinRadio.disabled = !p.builtinSearch;
  $('#search-builtin-label').classList.toggle('disabled', !p.builtinSearch);
  $('#search-builtin-name').textContent = p.builtinSearch ? `${p.name}'s own web search` : 'The model\'s own web search';
  $('#search-builtin-note').textContent = p.builtinSearch
    ? `One step, billed by ${p.name}. Restricted to your trusted domains.`
    : `Not available for ${p.name}: its search can't be limited to your trusted sources.`;
  if (!p.builtinSearch) $('#search-tavily').checked = true;
  else if (s.search === 'builtin') builtinRadio.checked = true;
  $('#tavily-fields').hidden = !$('#search-tavily').checked;
}

function fillKeyForm() {
  const s = getSettings();
  const f = $('#key-form');
  f.provider.value = s.provider;
  f.maxSearches.value = String(s.maxSearches);
  (s.searchFocus === 'shared' ? $('#focus-shared') : $('#focus-own')).checked = true;
  f.tavilyKey.value = s.keys.tavily || '';
  if (s.search === 'builtin') $('#search-builtin').checked = true; else $('#search-tavily').checked = true;
  renderProviderFields();
}

function storeForm() {
  const f = $('#key-form');
  const provider = f.provider.value;
  saveSettings({
    provider,
    search: $('#search-builtin').checked && !$('#search-builtin').disabled ? 'builtin' : 'tavily',
    maxSearches: Number(f.maxSearches.value),
    searchFocus: $('#focus-shared').checked ? 'shared' : 'own',
    keys: { [provider]: f.apiKey.value.trim(), tavily: f.tavilyKey.value.trim() },
    models: { [provider]: currentModelChoice() },
    helperModels: { [provider]: $('#helper-select').value },
  });
  renderScope();
  renderAccMeta();
  showSaveState();
  renderBalances();
}

function showSaveState() {
  const msg = $('#key-msg');
  const s = getSettings();
  const p = PROVIDERS[s.provider];
  const missing = missingItems();
  msg.className = missing.length ? 'form-error' : 'form-error ok';
  msg.textContent = missing.length
    ? `Saved. Traces will use ${p.name} once you add: ${missing.join(', ')}.`
    : `Saved. Traces will use ${p.name} (${s.models[s.provider] || p.defaultModel}) with ${effectiveSearch(s) === 'tavily' ? 'Tavily search' : `${p.name}'s web search`}.`;
}

function saveKeyForm(e) {
  e.preventDefault();
  storeForm();
}

function switchProvider() {
  // Switching takes effect at once; the new provider's saved key and model are loaded into the form.
  saveSettings({ provider: $('#key-form').provider.value });
  renderProviderFields();
  storeForm();
}

function forgetKey() {
  const f = $('#key-form');
  const provider = f.provider.value;
  saveSettings({ keys: { [provider]: '' } });
  f.apiKey.value = '';
  $('#key-msg').className = 'form-error ok';
  $('#key-msg').textContent = `${PROVIDERS[provider].name} key removed from this browser.`;
  renderScope();
}

const CUSTOM = '__custom__';

/** The model the form currently points at. */
function currentModelChoice() {
  const sel = $('#model-select');
  return (sel.value === CUSTOM ? $('#model-custom').value : sel.value).trim();
}

/** Always-visible model dropdown: remembered list + current model + "type a name". */
function renderModelSelect(provider, current) {
  const p = PROVIDERS[provider];
  const lists = local.get(KEYS.modelLists, {});
  const ids = lists[provider] && lists[provider].length ? [...lists[provider]] : (p.defaultModel ? [p.defaultModel] : []);
  if (current && !ids.includes(current)) ids.unshift(current);
  const sel = $('#model-select');
  sel.innerHTML = (ids.length ? '' : '<option value="">Click "Load models" to see your models</option>')
    + ids.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join('')
    + `<option value="${CUSTOM}">Type another model name…</option>`;
  sel.value = current && ids.includes(current) ? current : (ids[0] || '');
  $('#model-custom').hidden = true;
  $('#model-custom').value = '';
  renderHelperSelect(provider, ids);
}

/** The optional fast model for small steps (planning searches), from the same provider and key. */
const HELPER_SUGGESTIONS = {
  gemini: /flash-lite|flash-8b/i, groq: /8b-instant|llama-3\.1-8b|gpt-oss-20b/i, anthropic: /haiku/i,
  openai: /nano|mini/i, mistral: /small|ministral/i, openrouter: /:free$/i,
};
function renderHelperSelect(provider, ids) {
  const s = getSettings();
  const current = s.helperModels[provider] || '';
  const list = [...new Set([...(current ? [current] : []), ...ids])];
  const re = HELPER_SUGGESTIONS[provider];
  const fast = list.filter((id) => re && re.test(id));
  const rest = list.filter((id) => !fast.includes(id));
  const opt = (id) => `<option value="${esc(id)}">${esc(id)}</option>`;
  $('#helper-select').innerHTML = '<option value="">Same as the main model</option>'
    + (fast.length ? `<optgroup label="Usually fastest">${fast.map(opt).join('')}</optgroup>` : '')
    + (rest.length ? `<optgroup label="Other models">${rest.map(opt).join('')}</optgroup>` : '');
  $('#helper-select').value = current;
}

function onModelSelect() {
  const custom = $('#model-select').value === CUSTOM;
  $('#model-custom').hidden = !custom;
  if (custom) { $('#model-custom').focus(); return; }
  storeForm();
}

async function loadModels() {
  const f = $('#key-form');
  const provider = f.provider.value;
  const key = f.apiKey.value.trim();
  const msg = $('#models-msg');
  if (!key && provider !== 'openrouter') { msg.textContent = 'Paste the API key first.'; return; }
  msg.textContent = 'Loading models…';
  try {
    const ids = await listModels(provider, key);
    if (f.provider.value !== provider) return; // provider changed while loading
    const lists = local.get(KEYS.modelLists, {});
    lists[provider] = ids;
    local.set(KEYS.modelLists, lists);
    const current = currentModelChoice();
    renderModelSelect(provider, ids.includes(current) ? current : (ids[0] || current));
    storeForm();
    msg.textContent = ids.length
      ? `${ids.length} model${ids.length === 1 ? '' : 's'} available${provider === 'openrouter' ? ' for free' : ''}. Pick one from the Model list.${current && !ids.includes(current) ? ` "${current}" wasn't available, so ${ids[0]} is selected.` : ''}`
      : 'No suitable models were found for this key.';
  } catch (err) {
    msg.textContent = err.message;
  }
}
