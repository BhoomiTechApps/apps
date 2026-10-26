/* Evaluator: settings.js
 *
 * Balances and quotas, the Settings panel for API keys, model and search,
 * Appearance, and the Settings file panel. Everything here is read from and
 * written to the settings file (js/settingsfile.js).
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/* =====================================================================
 * Balances and quotas
 *
 * OpenRouter and Tavily balances are read with your keys. For the other
 * providers there is a link to their billing page instead.
 * ===================================================================== */
let balanceCache = { at: 0, key: '', items: null };

async function fetchBalances(force = false) {
  const s = getSettings();
  const needsTavily = effectiveSearch(s) === 'tavily' || !PROVIDERS[s.provider].builtinSearch;
  const cacheKey = `${s.provider}|${needsTavily}|${SettingsFile.key(s.provider).slice(-6)}|${SettingsFile.key('tavily').slice(-6)}`;
  if (!force && balanceCache.items && balanceCache.key === cacheKey && Date.now() - balanceCache.at < 90000) return balanceCache.items;
  const items = await balancesApi(s.provider, needsTavily);
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
      <div><strong>${esc(b.name)}</strong> ${esc(b.text)}${b.link ? ` <a href="${esc(b.link)}" target="_blank" rel="noopener">${tr('Open billing')}</a>` : ''}</div>
      ${pct != null ? `<div class="bal-bar wide" role="img" aria-label="${esc(tr('{pct}% left', { pct: Math.round(pct * 100) }))}"><span style="width:${Math.round(pct * 100)}%"></span></div>` : ''}
    </li>`;
  }).join('');
}

async function renderBalances(force = false) {
  const box = $('#balance-list');
  const line = $('#balance-line');
  $('#balance-block').hidden = false;
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
 * Settings (from the settings file)
 * ===================================================================== */
const canChooseModel = () => true;
const siteHasKey = (provider) => providerReady(provider);

function getSettings() {
  const d = SettingsFile.data;
  const provider = PROVIDERS[d.provider] ? d.provider : 'gemini';
  const defaults = Object.fromEntries(Object.entries(PROVIDERS).filter(([, p]) => p.defaultModel).map(([id, p]) => [id, p.defaultModel]));
  return {
    provider,
    models: { ...defaults, ...d.models },
    helperModels: { ...d.helperModels },
    search: d.search === 'builtin' ? 'builtin' : 'tavily',
    maxSearches: d.maxSearches,
    searchFocus: d.searchFocus === 'shared' ? 'shared' : 'own',
  };
}

function effectiveSearch(settings) {
  return settings.search === 'builtin' && PROVIDERS[settings.provider].builtinSearch ? 'builtin' : 'tavily';
}

/** Merges a change into the settings file and saves it. */
function saveSettings(patch) {
  SettingsFile.update(patch);
  return true;
}

function missingItems(scope) {
  const s = getSettings();
  const p = PROVIDERS[s.provider];
  const missing = [];
  if (!siteHasKey(s.provider)) missing.push(s.provider === 'org' ? tr('{name} access code', { name: p.name }) : tr('{name} API key', { name: p.name }));
  if (!(s.models[s.provider] || p.defaultModel)) missing.push(tr('{name} model', { name: p.name }));
  const webInScope = scope ? scope.web.length > 0 : true;
  if (webInScope && effectiveSearch(s) === 'tavily' && !WP.tavily) missing.push(tr('{name} API key', { name: 'Tavily' }));
  return missing;
}
const isReady = () => missingItems().length === 0;

/* ---------- API keys ---------- */
const KEY_ORDER = ['gemini', 'groq', 'openrouter', 'mistral', 'openai', 'anthropic', 'tavily'];
const keyName = (slot) => (slot === 'tavily' ? tr('Tavily (search)') : PROVIDERS[slot].name);
const keyHint = (k) => (k.length > 8 ? `…${k.slice(-4)}` : (k ? '…' : ''));

function renderKeyFields() {
  const box = $('#key-fields');
  box.innerHTML = KEY_ORDER.map((slot) => {
    const note = slot === 'tavily' ? tr('Needed to search your trusted websites with any model.') : tr(`${PROVIDERS[slot].cost[0].toUpperCase()}${PROVIDERS[slot].cost.slice(1)}.`);
    return `<div class="key-row" data-slot="${slot}">
      <label for="key-${slot}"><span>${esc(keyName(slot))}</span> <span class="key-state" data-key-state></span></label>
      <div class="inline-field">
        <input type="password" id="key-${slot}" data-key="${slot}" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="${esc(tr('Not set'))}" data-lpignore="true" data-1p-ignore>
        <button type="button" class="btn quiet" data-show-key aria-controls="key-${slot}">${tr('Show')}</button>
      </div>
      <p class="hint">${esc(note)} <a href="${esc(KEY_LINKS[slot])}" target="_blank" rel="noopener">${tr('Get a key')}</a></p>
    </div>`;
  }).join('') + `<div class="key-row local-row" data-slot="local">
      <label for="local-url"><span>${esc(tr(PROVIDERS.local.name))}</span> <span class="key-state" id="local-state"></span></label>
      <div class="inline-field">
        <input type="url" id="local-url" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="${LOCAL_DEFAULT_URL}" translate="no">
        <button type="button" class="btn quiet" id="local-test">${tr('Test connection')}</button>
      </div>
      <p class="hint">${tr('Free, private, works offline: the model runs on your own computer. Address of the server:')}
        <button type="button" class="linkish" data-local-preset="ollama">Ollama</button> ·
        <button type="button" class="linkish" data-local-preset="lmstudio">LM Studio</button>.
        <a href="#help" data-open="help-local-model">${tr('How to set it up')}</a></p>
      <p class="hint" id="local-msg" role="status" aria-live="polite"></p>
    </div>
    <div class="key-row org-row" data-slot="org">
      <p class="field-label org-title"><span>${tr('Your organisation\'s server')}</span> <span class="key-state" id="org-state"></span></p>
      <p class="hint">${tr('If your school, college or group runs an Evaluator server, you need no keys of your own: enter its address and the access code you were given.')} <a href="#help" data-open="help-hosted">${tr('About organisation servers')}</a></p>
      <label for="org-url" class="field-label">${tr('Server address')}</label>
      <input type="url" id="org-url" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="https://" translate="no">
      <label for="key-org" class="field-label">${tr('Access code')}</label>
      <div class="inline-field">
        <input type="password" id="key-org" data-key="org" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="${esc(tr('Not set'))}" data-lpignore="true" data-1p-ignore>
        <button type="button" class="btn primary" id="org-connect">${tr('Connect')}</button>
      </div>
      <p class="hint" id="org-msg" role="status" aria-live="polite"></p>
    </div>`;
  bindLocalRow();
  bindOrgRow();
  box.querySelectorAll('[data-show-key]').forEach((b) => b.addEventListener('click', () => {
    const input = b.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.textContent = show ? tr('Hide') : tr('Show');
  }));
  box.querySelectorAll('input[data-key]').forEach((i) => {
    i.addEventListener('change', storeForm);
    i.addEventListener('input', () => { clearTimeout(i._t); i._t = setTimeout(storeForm, 800); });
  });
  fillKeyFields();
}

/** The row for a model on this computer: its address, presets and a connection test. */
function bindLocalRow() {
  const input = $('#local-url');
  input.value = (SettingsFile.data && SettingsFile.data.localUrl) || LOCAL_DEFAULT_URL;
  input.addEventListener('change', () => { if (input.value.trim()) storeForm(); });
  document.querySelectorAll('[data-local-preset]').forEach((b) => b.addEventListener('click', () => {
    input.value = LOCAL_PRESETS[b.dataset.localPreset];
    storeForm();
  }));
  $('#local-test').addEventListener('click', async () => {
    const msg = $('#local-msg');
    storeForm();
    msg.className = 'hint';
    msg.textContent = tr('Checking…');
    try {
      const ids = await listModels('local');
      const lists = local.get(KEYS.modelLists, {});
      lists.local = ids;
      local.set(KEYS.modelLists, lists);
      msg.className = 'hint ok';
      msg.textContent = ids.length
        ? trn(ids.length, 'Connected. {n} model found: {list}.', 'Connected. {n} models found: {list}.', { list: ids.slice(0, 6).join(', ') + (ids.length > 6 ? '…' : '') })
        : tr('Connected, but no models are installed yet. In Ollama, run: ollama pull gemma3');
      if ($('#key-form').provider.value === 'local') renderProviderFields();
    } catch (err) {
      msg.className = 'hint bad';
      msg.textContent = err.message;
    }
  });
}

/** The row for an organisation's server: address, access code and Connect. */
function bindOrgRow() {
  const url = $('#org-url');
  url.value = orgBase() || (window.HOSTED && HOSTED.server ? HOSTED.server.url : '');
  renderOrgState();
  $('#org-connect').addEventListener('click', async () => {
    const msg = $('#org-msg');
    msg.className = 'hint';
    msg.textContent = tr('Checking…');
    try {
      const info = await orgConnect(url.value, $('#key-org').value.trim());
      msg.className = 'hint ok';
      msg.textContent = tr('Connected to {name}. It is now your AI model and search; the models offered are: {models}.', { name: info.name, models: (info.models || []).join(', ') || '?' });
      afterOrgConnect();
    } catch (err) {
      msg.className = 'hint bad';
      msg.textContent = err.message;
    }
  });
}

function renderOrgState() {
  const st = $('#org-state');
  if (!st) return;
  const on = orgBase() && providerReady('org');
  st.textContent = on ? tr('Connected: {name}', { name: PROVIDERS.org.name }) : tr('Not set');
  st.classList.toggle('ok', Boolean(on));
}

/** Refreshes everything that depends on the provider after connecting to a server. */
function afterOrgConnect() {
  fillKeyForm();
  renderOrgState();
  renderScope();
  renderAccMeta();
  renderBalances(true);
  if (typeof renderGettingStarted === 'function') renderGettingStarted();
}

function fillKeyFields() {
  document.querySelectorAll('#key-fields input[data-key]').forEach((i) => {
    const k = SettingsFile.key(i.dataset.key);
    if (document.activeElement !== i) i.value = k;
    const state = i.closest('.key-row').querySelector('[data-key-state]');
    if (!state) return;
    state.textContent = k ? tr('Saved {hint}', { hint: keyHint(k) }) : tr('Not set');
    state.classList.toggle('ok', Boolean(k));
  });
}

function keyPatch() {
  const keys = {};
  document.querySelectorAll('#key-fields input[data-key]').forEach((i) => { keys[i.dataset.key] = i.value.trim(); });
  return keys;
}

function renderProviderFields() {
  const f = $('#key-form');
  const s = getSettings();
  const provider = f.provider.value || s.provider;
  const p = PROVIDERS[provider];

  $('#site-model-note').hidden = true;
  renderModelSelect(provider, s.models[provider] || p.defaultModel);
  $('#models-msg').dataset.nokey = siteHasKey(provider) ? '' : '1';
  $('#models-msg').textContent = siteHasKey(provider) ? '' : (provider === 'openrouter' ? tr('No {name} API key yet. Add it above (OpenRouter can list its free models without one).', { name: p.name }) : tr('No {name} API key yet. Add it above.', { name: p.name }));
  const builtinRadio = $('#search-builtin');
  builtinRadio.disabled = !p.builtinSearch;
  $('#search-builtin-label').classList.toggle('disabled', !p.builtinSearch);
  $('#search-builtin-name').textContent = p.builtinSearch ? tr('{name}\'s own web search', { name: p.name }) : tr('The model\'s own web search');
  $('#search-builtin-note').textContent = p.builtinSearch
    ? tr('One step, billed by {name}. Restricted to your trusted domains.', { name: p.name })
    : tr('Not available for {name}: its search can\'t be limited to your trusted sources.', { name: p.name });
  if (!p.builtinSearch) $('#search-tavily').checked = true;
  else if (s.search === 'builtin') builtinRadio.checked = true;
}

function fillProviderOptions() {
  const sel = $('#provider-select');
  const s = getSettings();
  sel.innerHTML = Object.keys(PROVIDERS).map((id) => `<option value="${esc(id)}">${esc(PROVIDERS[id].name)}${siteHasKey(id) ? '' : ` ${tr('(no key yet)')}`}</option>`).join('');
  sel.value = s.provider;
}

/** Puts the settings file's values into the form (on start-up and whenever the file changes). */
function fillKeyForm() {
  const s = getSettings();
  const f = $('#key-form');
  if (!$('#key-fields').children.length) renderKeyFields(); else fillKeyFields();
  fillProviderOptions();
  f.maxSearches.value = String(s.maxSearches);
  (s.searchFocus === 'shared' ? $('#focus-shared') : $('#focus-own')).checked = true;
  if (s.search === 'builtin') $('#search-builtin').checked = true; else $('#search-tavily').checked = true;
  renderProviderFields();
}

function storeForm() {
  const f = $('#key-form');
  const provider = f.provider.value;
  const lu = $('#local-url') && $('#local-url').value.trim();
  saveSettings({
    ...(lu && /^https?:\/\//i.test(lu) ? { localUrl: lu } : {}),
    keys: keyPatch(),
    maxSearches: Number(f.maxSearches.value),
    searchFocus: $('#focus-shared').checked ? 'shared' : 'own',
    provider,
    search: $('#search-builtin').checked && !$('#search-builtin').disabled ? 'builtin' : 'tavily',
    models: { [provider]: currentModelChoice() },
    helperModels: { [provider]: $('#helper-select').value },
  });
  fillKeyFields();
  // Provider names show "(no key yet)"; refresh them without losing the selection.
  [...$('#provider-select').options].forEach((o) => { o.textContent = `${PROVIDERS[o.value].name}${siteHasKey(o.value) ? '' : ` ${tr('(no key yet)')}`}`; });
  if (siteHasKey(provider) && $('#models-msg').dataset.nokey) $('#models-msg').textContent = '';
  renderScope();
  renderAccMeta();
  showSaveState();
  renderBalances();
  if (typeof renderGettingStarted === 'function') renderGettingStarted();
}

function showSaveState() {
  const msg = $('#key-msg');
  const s = getSettings();
  const p = PROVIDERS[s.provider];
  const missing = missingItems();
  msg.className = missing.length ? 'form-error' : 'form-error ok';
  msg.textContent = missing.length
    ? tr('Saved to the settings file. Still needed: {missing}.', { missing: missing.join(', ') })
    : tr('Saved to the settings file. Traces will use {name} ({model}) with {search}.', { name: p.name, model: s.models[s.provider] || p.defaultModel, search: effectiveSearch(s) === 'tavily' ? tr('Tavily search') : tr('{name}\'s web search', { name: p.name }) });
}

function saveKeyForm(e) {
  e.preventDefault();
  storeForm();
  SettingsFile.save();
}

function switchProvider() {
  saveSettings({ provider: $('#key-form').provider.value });
  renderProviderFields();
  storeForm();
}

/* =====================================================================
 * Appearance (theme and app height, from the settings file)
 * ===================================================================== */
function applyAppearance() {
  const theme = SettingsFile.data.theme === 'dark' ? 'dark' : 'light';
  // Text size: the whole app is scaled, so spacing and line breaks stay in proportion.
  const size = [100, 115, 130].includes(SettingsFile.data.textSize) ? SettingsFile.data.textSize : 100;
  document.documentElement.style.setProperty('--ev-zoom', String(size / 100));
  document.querySelectorAll('#look-form input[name=textSize]').forEach((r) => { r.checked = Number(r.value) === size; });
  document.body.className = `ev-page ev-page-${theme}${document.body.classList.contains('is-busy') ? ' is-busy' : ''}`;
  const frame = $('#ev-frame');
  frame.classList.toggle('ev-theme-light', theme === 'light');
  frame.classList.toggle('ev-theme-dark', theme === 'dark');
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = theme === 'light' ? '#d8d5ce' : '#1d1e20';
  try { localStorage.setItem('evaluator.theme', theme); } catch { /* only a start-up hint */ }
  const f = $('#look-form');
  if (f) {
    f.querySelectorAll('input[name=theme]').forEach((r) => { r.checked = r.value === theme; });
    if (document.activeElement !== f.appHeight) f.appHeight.value = String(SettingsFile.data.appHeight || 0);
  }
  const look = $('#meta-look');
  if (look) look.textContent = `${LANGS[I18N.lang].native}, ${theme === 'light' ? tr('Light') : tr('Dark')}${size !== 100 ? `, ${size}%` : ''}, ${SettingsFile.data.appHeight ? `${SettingsFile.data.appHeight} px` : tr('fits the window')}`;
  if (typeof fitWorkspace === 'function') fitWorkspace();
}

function storeLook() {
  const f = $('#look-form');
  const theme = (f.querySelector('input[name=theme]:checked') || {}).value === 'dark' ? 'dark' : 'light';
  const raw = parseInt(f.appHeight.value, 10) || 0;
  const size = Number((f.querySelector('input[name=textSize]:checked') || {}).value) || 100;
  saveSettings({ theme, textSize: size, appHeight: raw > 0 ? Math.max(600, Math.min(4000, raw)) : 0 });
  if (raw > 0 && (raw < 600 || raw > 4000)) f.appHeight.value = String(SettingsFile.data.appHeight);
  applyAppearance();
}

/* =====================================================================
 * Settings file panel
 * ===================================================================== */
const fileUi = { editorDirty: false };

function renderFileStatus() {
  const box = $('#file-status');
  if (!box) return;
  const sf = SettingsFile;
  const where = esc(sf.locationText());
  let html;
  if (sf.state === 'broken') {
    html = `<div class="sync-box bad"><p>${esc(sf.message || (sf.broken && sf.broken.error) || tr('The settings file has an error.'))} ${tr('The app is using the last good settings. Fix it in <strong>Edit the settings file</strong> below, or in the file itself and press Reload.')}</p></div>`;
  } else if (sf.state === 'permission') {
    html = `<div class="sync-box warn"><p>${esc(sf.message)}</p><button type="button" class="btn quiet" data-file="reconnect">${tr('Reconnect')}</button></div>`;
  } else if (sf.state === 'error') {
    html = `<div class="sync-box bad"><p>${esc(sf.message)}</p><button type="button" class="btn quiet" data-file="retry">${tr('Try again')}</button></div>`;
  } else {
    const when = sf.lastSavedAt ? ` ${tr('Last saved {when}.', { when: esc(fmtWhen(sf.lastSavedAt)) })}` : '';
    html = `<div class="sync-box ok"><p>${sf.state === 'saving' ? tr('Saving…') : `${sf.message ? `${esc(sf.message)} ` : ''}${tr('Saved in {where}.', { where: `<code>${where}</code>` })}${when}`}</p></div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll('[data-file]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.file === 'reconnect') await SettingsFile.reconnect();
    else SettingsFile.save();
  }));

  // Banner over every page while the chosen folder needs permission or the file is broken.
  const banner = $('#file-banner');
  banner.hidden = !(sf.state === 'permission' || sf.state === 'broken');
  $('#file-banner-text').textContent = sf.state === 'broken'
    ? tr('Your settings file has an error, so the last good settings are in use.')
    : tr('Your settings folder “{folder}” needs permission again.', { folder: sf.folderLabel });
  $('#file-banner-btn').textContent = sf.state === 'broken' ? tr('Fix it') : tr('Reconnect');

  $('#file-folder').hidden = !sf.canPickFolder();
  $('#file-folder').textContent = sf.where === 'folder' ? tr('Choose another folder…') : tr('Choose where to keep it…');
  $('#file-unlink').hidden = sf.where !== 'folder';
  $('#file-folder-note').textContent = sf.canPickFolder()
    ? (sf.where === 'folder'
      ? tr('Kept in a folder you chose, with a copy in the app\'s own folder so the app always starts.')
      : tr('It is in the app\'s own folder now. Choose a folder (for example Documents) to keep it where you can open, back up or edit it yourself; the app makes an Evaluator folder there.'))
    : tr('This browser keeps the file in the app\'s own folder. Chrome or Edge on a computer can keep it in a folder you choose.');
  const meta = $('#meta-file');
  if (meta) {
    meta.textContent = sf.state === 'broken' ? tr('Has an error') : sf.state === 'permission' ? tr('Needs permission') : (sf.where === 'folder' ? sf.folderLabel : tr('App folder'));
    meta.classList.toggle('warn', sf.state === 'broken' || sf.state === 'permission' || sf.state === 'error');
  }
}

function fillEditor(force = false) {
  const ta = $('#file-editor');
  if (!ta || (fileUi.editorDirty && !force)) return;
  ta.value = SettingsFile.broken && SettingsFile.broken.text ? SettingsFile.broken.text : SettingsFile.serialize();
  fileUi.editorDirty = false;
  if (SettingsFile.broken) { $('#file-msg').className = 'form-error'; $('#file-msg').textContent = SettingsFile.broken.error; }
}

async function saveEditor() {
  const msg = $('#file-msg');
  try {
    const notes = await SettingsFile.replace($('#file-editor').value);
    fileUi.editorDirty = false;
    fillEditor(true);
    msg.className = 'form-error ok';
    msg.textContent = notes.length ? tr('Saved. Some values were corrected: {notes}.', { notes: notes.join('; ') }) : tr('Saved to the settings file and applied.');
  } catch (err) {
    msg.className = 'form-error';
    msg.textContent = err.message;
  }
}

function tidyEditor() {
  const msg = $('#file-msg');
  try {
    const { data, notes } = SettingsFile.parse($('#file-editor').value);
    $('#file-editor').value = SettingsFile.serialize(data);
    fileUi.editorDirty = true;
    msg.className = 'form-error ok';
    msg.textContent = notes.length ? tr('Tidied. These will be corrected when you save: {notes}.', { notes: notes.join('; ') }) : tr('Tidied. Press Save to file to apply.');
  } catch (err) {
    msg.className = 'form-error';
    msg.textContent = err.message;
  }
}

function downloadSettings() {
  const blob = new Blob([SettingsFile.serialize()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = SETTINGS_FILE;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importSettings(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  try { SettingsFile.parse(text); } catch (err) { alert(err.message); return; }
  if (!confirm(tr('Replace all your settings and API keys with the ones in “{file}”?', { file: file.name }))) return;
  try {
    const notes = await SettingsFile.replace(text);
    if (notes.length) alert(tr('Loaded. Some values were corrected: {notes}.', { notes: notes.join('; ') }));
  } catch (err) { alert(err.message); }
}

async function resetSettings() {
  if (!confirm(tr('Remove every API key and put all settings back to their defaults? Download a copy first if you may need them again.'))) return;
  await SettingsFile.reset();
}

async function chooseSettingsFolder() {
  try { await SettingsFile.chooseFolder(); } catch (err) {
    if (err && err.name === 'AbortError') return;
    alert(tr('Couldn\'t use that folder. {message}', { message: err.message }));
  }
}

async function unlinkSettingsFolder() {
  if (!confirm(tr('Stop using “{folder}”? The file there is left as it is; the app keeps its settings in its own folder from now on.', { folder: SettingsFile.folderLabel }))) return;
  await SettingsFile.unlinkFolder();
}

/** Everything that shows a setting is redrawn when the file changes (editor, import, reload, reconnect). */
function onSettingsData() {
  fillKeyForm();
  applyAppearance();
  fillEditor();
  if (typeof refreshAll === 'function' && SourceStore.list) { renderScope(); renderAccMeta(); }
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
  sel.innerHTML = (ids.length ? '' : `<option value="">${esc(tr('Click "Load models" to see your models'))}</option>`)
    + ids.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join('')
    + `<option value="${CUSTOM}">${tr('Type another model name…')}</option>`;
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
  $('#helper-select').innerHTML = `<option value="">${tr('Same as the main model')}</option>`
    + (fast.length ? `<optgroup label="${esc(tr('Usually fastest'))}">${fast.map(opt).join('')}</optgroup>` : '')
    + (rest.length ? `<optgroup label="${esc(tr('Other models'))}">${rest.map(opt).join('')}</optgroup>` : '');
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
  const msg = $('#models-msg');
  storeForm(); // a key typed a moment ago is saved first
  if (!siteHasKey(provider) && provider !== 'openrouter') { msg.textContent = tr('No {name} API key yet. Add it above.', { name: PROVIDERS[provider].name }); return; }
  msg.dataset.nokey = '';
  msg.textContent = tr('Loading models…');
  try {
    const ids = await listModels(provider);
    if (f.provider.value !== provider) return; // provider changed while loading
    const lists = local.get(KEYS.modelLists, {});
    lists[provider] = ids;
    local.set(KEYS.modelLists, lists);
    const current = currentModelChoice();
    renderModelSelect(provider, ids.includes(current) ? current : (ids[0] || current));
    storeForm();
    msg.textContent = ids.length
      ? `${provider === 'openrouter' ? trn(ids.length, '{n} model available for free. Pick one from the Model list.', '{n} models available for free. Pick one from the Model list.') : trn(ids.length, '{n} model available. Pick one from the Model list.', '{n} models available. Pick one from the Model list.')}${current && !ids.includes(current) ? ` ${tr('"{current}" wasn\'t available, so {first} is selected.', { current, first: ids[0] })}` : ''}`
      : tr('No suitable models were found for your key.');
  } catch (err) {
    msg.textContent = err.message;
  }
}
