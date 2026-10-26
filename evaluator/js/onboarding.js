/* Evaluator: onboarding.js
 *
 * Getting started (16.4):
 *   - the setup guide: a step-by-step dialog that gets a free AI key and a
 *     search key, tests each one before saving it, and adds starter packs;
 *   - starter packs: one-click topics with trusted websites (packs.json);
 *   - examples: prepared results anyone can open without a key (samples.json).
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/* =====================================================================
 * Keys: recognising and testing them
 * ===================================================================== */
/** Order matters: the more specific prefixes come first. */
const KEY_PATTERNS = [
  ['anthropic', /^sk-ant-[A-Za-z0-9_-]{20,}$/],
  ['openrouter', /^sk-or-[A-Za-z0-9_-]{20,}$/],
  ['openai', /^sk-[A-Za-z0-9_-]{20,}$/],
  ['groq', /^gsk_[A-Za-z0-9]{20,}$/],
  ['gemini', /^AIza[0-9A-Za-z_-]{30,}$/],
  ['tavily', /^tvly-[A-Za-z0-9_-]{10,}$/],
];
/** Which service a pasted key most likely belongs to, or '' when it can't be told. */
function guessKeySlot(key) {
  const k = String(key || '').trim();
  const hit = KEY_PATTERNS.find(([, re]) => re.test(k));
  return hit ? hit[0] : '';
}
const slotName = (slot) => (slot === 'tavily' ? 'Tavily' : tr(PROVIDERS[slot].name));

/** What a key usually starts with, shown under the key box. */
const KEY_PREFIX = { gemini: 'AIza', groq: 'gsk_', openrouter: 'sk-or-', openai: 'sk-', anthropic: 'sk-ant-', tavily: 'tvly-', mistral: '', local: '' };

/**
 * Tests a key before it is saved, with a free request that only reads
 * (a model list, or Tavily's usage). Returns the model ids when the
 * service lists them.
 */
async function testKey(slot, key) {
  const k = String(key || '').trim();
  const p = PROVIDERS[slot];
  if (slot === 'local') {
    const base = k.replace(/\/+$/, '');
    if (!/^https?:\/\/\S+$/i.test(base)) throw new ProviderError(tr('Enter the server address, for example {url}.', { url: LOCAL_DEFAULT_URL }));
    const d = await apiRequest(tr(p.name), 'GET', `${base}/models`, {});
    return { models: (d.data || []).map((m) => String((m && m.id) || '')).filter(Boolean).sort() };
  }
  if (!k) throw new ProviderError(tr('Paste the key first.'));
  if (/\s/.test(k)) throw new ProviderError(tr('The key has a space or line break in it. Copy it again, without anything before or after it.'));
  if (slot === 'tavily') {
    await apiRequest('Tavily', 'GET', 'https://api.tavily.com/usage', { Authorization: `Bearer ${k}` });
    return { models: [] };
  }
  if (slot === 'anthropic') {
    const d = await apiRequest(p.name, 'GET', 'https://api.anthropic.com/v1/models?limit=100', anthropicHeaders(k));
    return { models: (d.data || []).map((m) => m.id).filter(Boolean) };
  }
  if (slot === 'gemini') {
    const d = await apiRequest(p.name, 'GET', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': k });
    return {
      models: (d.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter((id) => id.includes('gemini')),
    };
  }
  if (slot === 'openrouter') {
    // OpenRouter lists models without a key, so the key itself is checked here.
    await apiRequest(p.name, 'GET', 'https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${k}` });
    const d = await apiRequest(p.name, 'GET', p.models, { Authorization: `Bearer ${k}` });
    return { models: (d.data || []).map((m) => String((m && m.id) || '')).filter((id) => id.endsWith(':free') || id === 'openrouter/free') };
  }
  const d = await apiRequest(p.name, 'GET', p.models, { Authorization: `Bearer ${k}` });
  let ids = (d.data || []).map((m) => String((m && m.id) || '')).filter(Boolean);
  if (slot === 'openai') ids = ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|image|transcribe|tts|search/.test(id));
  return { models: [...new Set(ids)].sort() };
}

/** A sensible model when the provider's default isn't offered to this key. */
const MODEL_PREFERENCE = {
  gemini: [/^gemini-[\d.]+-flash$/, /flash(?!.*(lite|image|tts|live|audio))/, /pro(?!.*(image|tts))/],
  groq: [/gpt-oss-120b/, /llama-3\.3-70b/, /70b/],
  openrouter: [/^openrouter\/free$/, /gpt-oss-120b/, /llama-3\.3-70b/, /deepseek/],
  mistral: [/^mistral-small-latest$/, /^mistral-medium-latest$/, /latest$/],
  openai: [/^gpt-5-mini$/, /^gpt-5/, /^gpt-4\.1-mini$/],
  anthropic: [/sonnet/, /haiku/],
  local: [/gemma3:12b|qwen3:14b/i, /gemma3|qwen3|qwen2\.5/i, /llama3|mistral|phi/i],
};
function pickModel(slot, ids) {
  const def = PROVIDERS[slot].defaultModel;
  if (!ids.length) return def;
  if (def && ids.includes(def)) return def;
  for (const re of MODEL_PREFERENCE[slot] || []) {
    const hit = [...ids].sort().reverse().find((id) => re.test(id));
    if (hit) return hit;
  }
  return ids[0];
}

/* =====================================================================
 * Setup guide (dialog)
 * ===================================================================== */
const PROVIDER_STEPS = {
  gemini: [
    'Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> and sign in with any Google account.',
    'Press <strong>Create API key</strong>. Accept the terms if asked.',
    'Copy the key. It starts with <code>AIza</code>.',
  ],
  groq: [
    'Open <a href="https://console.groq.com/keys" target="_blank" rel="noopener">GroqCloud</a> and sign in (Google, GitHub or email).',
    'Press <strong>Create API Key</strong> and give it a name, such as Evaluator.',
    'Copy the key straight away: it starts with <code>gsk_</code> and is shown only once.',
  ],
  openrouter: [
    'Open <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">OpenRouter</a> and sign in.',
    'Press <strong>Create Key</strong>. You can leave the credit limit empty for free models.',
    'Copy the key. It starts with <code>sk-or-</code>.',
  ],
  mistral: [
    'Open <a href="https://console.mistral.ai/api-keys" target="_blank" rel="noopener">Mistral’s console</a> and sign in.',
    'If asked to choose a plan, the free one is enough. Then press <strong>Create new key</strong>.',
    'Copy the key straight away: it is shown only once.',
  ],
  openai: [
    'Open <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAI’s platform</a> and sign in. OpenAI is paid: add billing first.',
    'Press <strong>Create new secret key</strong>.',
    'Copy the key. It starts with <code>sk-</code> and is shown only once.',
  ],
  anthropic: [
    'Open the <a href="https://platform.claude.com" target="_blank" rel="noopener">Claude Console</a> and sign in. Claude is paid: add credits first.',
    'Go to <strong>API keys</strong> and press <strong>Create key</strong>.',
    'Copy the key. It starts with <code>sk-ant-</code> and is shown only once.',
  ],
  local: [
    'Install <a href="https://ollama.com/download" target="_blank" rel="noopener">Ollama</a> (or <a href="https://lmstudio.ai" target="_blank" rel="noopener">LM Studio</a>) on this computer and open it.',
    'Download a model. In a terminal, run <code>ollama pull gemma3</code>. Larger models such as <code>gemma3:12b</code> give better answers, especially in Assamese and Bengali, but need more memory.',
    'Allow this app: set <code>OLLAMA_ORIGINS</code> to <code>{origin}</code> and restart Ollama (Help › Using a model on your own computer shows how). In LM Studio, switch on CORS in the server settings instead.',
  ],
};
const PROVIDER_BLURB = {
  gemini: 'Free with a Google account. Recommended.',
  groq: 'Free and very fast. Sign in with Google, GitHub or email.',
  openrouter: 'Free models from several makers.',
  mistral: 'Free plan available.',
  openai: 'Paid. Can also search your sites itself.',
  anthropic: 'Paid. Can also search your sites itself.',
  local: 'Free and private: runs on your own computer. Needs a fairly powerful computer.',
};

const setup = { step: 'welcome', provider: 'gemini', aiOk: false, searchOk: false, searchMode: 'tavily', addedPacks: [], from: '' };

function setupDialog() {
  let d = document.getElementById('setup-dialog');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'setup-dialog';
  d.className = 'setup-dialog';
  d.setAttribute('aria-labelledby', 'setup-title');
  d.innerHTML = '<div class="setup-inner"><button type="button" class="setup-close" aria-label="Close the setup guide">' + icon('close') + '</button><div id="setup-body"></div></div>';
  $('#ev-frame').appendChild(d);
  d.querySelector('.setup-close').addEventListener('click', () => closeSetup());
  d.addEventListener('cancel', (e) => { e.preventDefault(); closeSetup(); });
  return d;
}

/** Opens the guide. `step` jumps straight to one step (for example 'search'). */
function openSetup(step) {
  const s = getSettings();
  setup.aiOk = siteHasKey(s.provider);
  setup.provider = setup.aiOk ? s.provider : (setup.provider || 'gemini');
  setup.searchOk = Boolean(SettingsFile.key('tavily')) || effectiveSearch(s) === 'builtin' || orgSearchActive();
  setup.searchMode = effectiveSearch(s);
  setup.addedPacks = [];
  setup.step = step || (setup.aiOk && setup.searchOk ? 'packs' : setup.aiOk ? 'search' : 'welcome');
  const d = setupDialog();
  renderSetup();
  if (!d.open) {
    try { d.showModal(); } catch { d.setAttribute('open', ''); }
    // showModal() focuses the first control (Close); move focus to the step's main control.
    const first = d.querySelector('[data-autofocus]') || d.querySelector('h2');
    if (first) first.focus({ preventScroll: true });
  }
}

function closeSetup(state) {
  const d = document.getElementById('setup-dialog');
  if (d && d.open) d.close();
  const prev = local.get(KEYS.onboarding, {});
  local.set(KEYS.onboarding, { ...prev, state: state || (isReady() ? 'done' : 'later'), at: new Date().toISOString() });
  renderGettingStarted();
}

const STEP_ORDER = ['ai', 'search', 'packs'];
function stepper() {
  const i = STEP_ORDER.indexOf(setup.step);
  if (i === -1) return '';
  const names = ['AI model', 'Search', 'Topics'];
  return `<ol class="setup-steps" aria-label="Progress">${names.map((n, j) => `<li class="${j < i ? 'done' : j === i ? 'now' : ''}"${j === i ? ' aria-current="step"' : ''}><span>${j + 1}</span>${n}</li>`).join('')}</ol>`;
}

function renderSetup() {
  const body = $('#setup-body');
  const hosted = hostedServer() && !(SettingsFile.data && SettingsFile.data.provider === 'org' && providerReady('org'));
  const views = { welcome: hosted ? setupWelcomeHosted : setupWelcome, org: setupOrg, ai: setupAi, search: setupSearch, packs: setupPacks, done: setupDone };
  body.innerHTML = stepper() + views[setup.step]();
  const bind = { ai: bindAi, search: bindSearch, packs: bindPacks, done: bindDone, welcome: (b) => { bindWelcome(b); bindOrg(b); }, org: bindOrg }[setup.step];
  bind(body);
  body.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => { setup.step = b.dataset.step; renderSetup(); }));
  const first = body.querySelector('[data-autofocus]') || body.querySelector('h2');
  if (first) { if (first.tagName === 'H2') first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); }
  body.closest('.setup-inner').scrollTop = 0;
}

/* ---------- Step: welcome ---------- */
function setupWelcome() {
  return `<h2 id="setup-title">Set up Evaluator</h2>
    <p>Evaluator uses two services, and both have free plans:</p>
    <ul class="setup-list">
      <li><strong>An AI model</strong> that reads what the search finds and writes the result.</li>
      <li><strong>A search service</strong> that looks only at the websites you trust.</li>
    </ul>
    <p>You get a key (a long password for apps) from each, paste it here, and Evaluator checks that it works. It takes about three minutes. The keys stay on this device.</p>
    <div class="setup-actions">
      <button type="button" class="btn primary" data-step="ai" data-autofocus>Start setup</button>
      <button type="button" class="btn quiet" data-setup-examples>See an example first</button>
      <button type="button" class="btn ghost" data-setup-later>Later</button>
    </div>
    <p class="hint setup-org-link">${tr('Got an access code from your school, college or group? <button type="button" class="linkish" data-step="org">Use your organisation\'s server</button> instead: no keys needed.')}</p>`;
}

/* ---------- Organisation server (instead of keys) ---------- */
/** A server named by whoever hosts this copy of the app (config.js), if any. */
const hostedServer = () => (window.HOSTED && HOSTED.server && /^https:\/\/[^\s]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/i.test(String(HOSTED.server.url)) ? HOSTED.server : null);

function setupWelcomeHosted() {
  const h = hostedServer();
  return `<h2 id="setup-title">${tr('Welcome to Evaluator')}</h2>
    <p>${tr('{name} provides Evaluator for its members: you need no keys of your own, only the access code you were given.', { name: `<strong translate="no">${esc(h.name || new URL(h.url).host)}</strong>` })}</p>
    ${orgBox()}
    <div class="setup-actions">
      <button type="button" class="btn quiet" data-setup-examples>${tr('See an example first')}</button>
      <button type="button" class="btn ghost" data-setup-later>${tr('Later')}</button>
    </div>
    <p class="hint setup-org-link">${tr('No code? <button type="button" class="linkish" data-step="ai">Set up your own free keys</button> instead.')}</p>`;
}

function setupOrg() {
  return `<h2 id="setup-title">${tr('Use your organisation\'s server')}</h2>
    <p>${tr('If your school, college or group runs an Evaluator server, it pays for the AI model and the search. Enter its address and the access code you were given.')}</p>
    ${orgBox()}
    <div class="setup-actions"><button type="button" class="btn ghost" data-step="welcome">${tr('Back')}</button></div>`;
}

function orgBox() {
  const h = hostedServer();
  const url = orgBase() || (h ? h.url : '');
  return `<div class="setup-key setup-org">
      <div${h ? ' hidden' : ''}>
        <label for="setup-org-url" class="field-label">${tr('Server address')}</label>
        <input type="url" id="setup-org-url" autocomplete="off" spellcheck="false" autocapitalize="off" translate="no" placeholder="https://" value="${esc(url)}"${h ? '' : ' data-autofocus'}>
      </div>
      <label for="setup-org-code" class="field-label">${tr('Access code')}</label>
      <div class="inline-field">
        <input type="password" id="setup-org-code" autocomplete="off" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore value="${esc(SettingsFile.key('org'))}"${h ? ' data-autofocus' : ''}>
        <button type="button" class="btn primary" data-org-connect>${tr('Connect')}</button>
      </div>
      <p class="setup-key-msg" role="status" aria-live="polite"></p>
    </div>`;
}

function bindOrg(body) {
  const box = body.querySelector('.setup-org');
  if (!box) return;
  const msg = box.querySelector('.setup-key-msg');
  const go = async () => {
    msg.innerHTML = `<span class="spinner small" aria-hidden="true"></span> ${tr('Checking…')}`;
    try {
      const info = await orgConnect(box.querySelector('#setup-org-url').value, box.querySelector('#setup-org-code').value.trim());
      setup.aiOk = true; setup.searchOk = Boolean(info.search); setup.provider = 'org'; setup.from = 'org';
      if (typeof afterOrgConnect === 'function') afterOrgConnect();
      setup.step = 'packs';
      renderSetup();
    } catch (err) {
      msg.innerHTML = `<span class="bad">${esc(err.message)}</span>`;
    }
  };
  box.querySelector('[data-org-connect]').addEventListener('click', go);
  box.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }));
}
function bindWelcome(body) {
  body.querySelector('[data-setup-later]').addEventListener('click', () => closeSetup('later'));
  body.querySelector('[data-setup-examples]').addEventListener('click', async () => {
    closeSetup('later');
    location.hash = '#trace';
    const list = await Samples.load().catch(() => []);
    if (list.length) openSample(list[0].id);
  });
}

/* ---------- Step 1: AI key ---------- */
function setupAi() {
  const pv = setup.provider;
  const p = PROVIDERS[pv];
  const saved = SettingsFile.key(pv);
  const card = (id) => `<label class="choice setup-choice">
      <input type="radio" name="setup-provider" value="${id}"${id === pv ? ' checked' : ''}>
      <span><strong>${esc(PROVIDERS[id].name)}</strong><br><span class="hint">${esc(PROVIDER_BLURB[id])}</span></span>
    </label>`;
  const others = ['openrouter', 'mistral', 'openai', 'anthropic', 'local'];
  return `<h2 id="setup-title">Get a free AI key</h2>
    <p class="hint">Pick one. You can add others later in Settings.</p>
    <div class="choices setup-providers">${card('gemini')}${card('groq')}
      <label class="choice setup-choice setup-other">
        <input type="radio" name="setup-provider" value="other"${others.includes(pv) ? ' checked' : ''}>
        <span><strong>Another provider</strong>
          <select id="setup-other" aria-label="Other provider">${others.map((id) => `<option value="${id}"${id === pv ? ' selected' : ''}>${esc(tr(PROVIDERS[id].name))}: ${esc(tr(PROVIDER_BLURB[id]))}</option>`).join('')}</select>
        </span>
      </label>
    </div>
    <h3 class="setup-sub">${pv === 'local' ? tr('Set up a model on this computer') : tr('Get your {name} key', { name: esc(p.name) })}</h3>
    <ol class="steps setup-howto">${PROVIDER_STEPS[pv].map((t) => `<li>${tr(t, { origin: esc(location.origin) })}</li>`).join('')}<li>${pv === 'local' ? tr('Check the address below (Ollama: <code>http://localhost:11434/v1</code>, LM Studio: <code>http://localhost:1234/v1</code>) and press <strong>Test and save</strong>.') : tr('Paste it below and press <strong>Test and save</strong>.')}</li></ol>
    ${keyBox('ai', pv, saved)}
    <div class="setup-actions">
      <button type="button" class="btn primary" data-step="search"${setup.aiOk ? '' : ' disabled'} id="setup-ai-next">Next: search</button>
      <button type="button" class="btn ghost" data-step="welcome">Back</button>
    </div>`;
}

function keyBox(which, slot, saved) {
  if (slot === 'local') {
    const url = (SettingsFile.data && SettingsFile.data.localUrl) || LOCAL_DEFAULT_URL;
    return `<div class="setup-key" data-which="${which}" data-slot="local">
      <label for="setup-key-${which}" class="field-label">${tr('Address of the model server')}</label>
      <div class="inline-field">
        <input type="url" id="setup-key-${which}" autocomplete="off" spellcheck="false" autocapitalize="off" translate="no" value="${esc(url)}" placeholder="${LOCAL_DEFAULT_URL}" data-autofocus>
        <button type="button" class="btn quiet" data-show hidden>Show</button>
        <button type="button" class="btn primary" data-test>${tr('Test and save')}</button>
      </div>
      <p class="setup-key-msg" role="status" aria-live="polite"></p>
    </div>`;
  }
  return `<div class="setup-key" data-which="${which}" data-slot="${slot}">
      <label for="setup-key-${which}" class="field-label">${tr('{name} API key', { name: esc(slotName(slot)) })}</label>
      <div class="inline-field">
        <input type="password" id="setup-key-${which}" autocomplete="off" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore
          placeholder="${esc(KEY_PREFIX[slot] ? tr('Starts with {prefix}', { prefix: KEY_PREFIX[slot] }) : tr('Paste the key here'))}" value="${esc(saved)}" data-autofocus>
        <button type="button" class="btn quiet" data-show>Show</button>
        <button type="button" class="btn primary" data-test>Test and save</button>
      </div>
      <p class="setup-key-msg" role="status" aria-live="polite">${saved ? `<span class="ok">${tr('Saved {hint}.', { hint: esc(keyHint(saved)) })}</span> ${tr('Press Test and save to check it again.')}` : ''}</p>
    </div>`;
}

/** Wires a key box: Show, the look-alike check while typing, and Test and save. */
function bindKeyBox(box, onSaved) {
  const input = box.querySelector('input');
  const msg = box.querySelector('.setup-key-msg');
  const slot = () => box.dataset.slot;
  box.querySelector('[data-show]').addEventListener('click', (e) => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
  });
  const lookAlike = () => {
    const guess = guessKeySlot(input.value);
    if (!guess || guess === slot()) { if (msg.dataset.kind === 'guess') { msg.innerHTML = ''; msg.dataset.kind = ''; } return; }
    msg.dataset.kind = 'guess';
    const canSwitch = guess !== 'tavily' && box.dataset.which === 'ai';
    msg.innerHTML = `<span class="warn">${tr('This looks like a {guess} key, not {slot}.', { guess: esc(slotName(guess)), slot: esc(slotName(slot())) })}</span>${canSwitch ? ` <button type="button" class="btn quiet" data-switch="${guess}">${tr('Use {name}', { name: esc(slotName(guess)) })}</button>` : ''}`;
    const sw = msg.querySelector('[data-switch]');
    if (sw) sw.addEventListener('click', () => { const keep = input.value; setup.provider = guess; renderSetup(); const i2 = $('#setup-key-ai'); i2.value = keep; i2.dispatchEvent(new Event('input')); });
  };
  input.addEventListener('input', lookAlike);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.querySelector('[data-test]').click(); } });
  box.querySelector('[data-test]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const key = input.value.trim();
    btn.disabled = true;
    msg.dataset.kind = '';
    msg.innerHTML = '<span class="spinner small" aria-hidden="true"></span> Checking the key…';
    try {
      if (!navigator.onLine) throw new ProviderError(tr('You\'re offline. Connect to the internet to check the key.'));
      const out = await testKey(slot(), key);
      await onSaved(key, out);
      msg.innerHTML = `<span class="ok">${icon('support')} ${tr('It works. Saved to your settings file.')}</span>`;
    } catch (err) {
      msg.innerHTML = `<span class="bad">${esc(friendlyKeyError(slot(), err))}</span>`;
    } finally { btn.disabled = false; }
  });
}

function friendlyKeyError(slot, err) {
  const name = slotName(slot);
  // Gemini answers a wrong key with 400 "API key not valid", the others with 401 or 403.
  if (err && (err.status === 401 || err.status === 403 || (err.status === 400 && /api[ _-]?key/i.test(err.message || '')))) {
    return (KEY_PREFIX[slot] ? tr('{name} didn\'t accept this key. Check you copied all of it (it should start with {prefix}), or make a new one.', { name, prefix: KEY_PREFIX[slot] }) : tr('{name} didn\'t accept this key. Check you copied all of it, or make a new one.', { name }))
      + (slot === 'openai' || slot === 'anthropic' ? ` ${tr('Paid providers also need billing set up.')}` : '');
  }
  return err && err.message ? err.message : tr('Couldn\'t check the key with {name}.', { name });
}

/** Saves an AI key with a model the key can use, and remembers the model list for Settings. */
async function saveAiKey(slot, key, models) {
  if (slot === 'local' && !models.length) throw new ProviderError(tr('Connected, but no models are installed yet. In Ollama, run: ollama pull gemma3'));
  const model = pickModel(slot, models);
  if (models.length) {
    const lists = local.get(KEYS.modelLists, {});
    lists[slot] = models;
    local.set(KEYS.modelLists, lists);
  }
  const patch = slot === 'local' ? { localUrl: key.trim().replace(/\/+$/, ''), provider: 'local' } : { keys: { [slot]: key }, provider: slot };
  if (model && model !== PROVIDERS[slot].defaultModel) patch.models = { [slot]: model };
  SettingsFile.update(patch);
  await SettingsFile.save();
  afterSetupChange();
}

function afterSetupChange() {
  fillKeyForm();
  renderScope();
  renderAccMeta();
  renderBalances(true);
  renderGettingStarted();
}

function bindAi(body) {
  body.querySelectorAll('input[name=setup-provider]').forEach((r) => r.addEventListener('change', () => {
    setup.provider = r.value === 'other' ? $('#setup-other').value : r.value;
    setup.aiOk = siteHasKey(setup.provider) && getSettings().provider === setup.provider;
    renderSetup();
  }));
  $('#setup-other').addEventListener('change', (e) => {
    setup.provider = e.target.value;
    setup.aiOk = siteHasKey(setup.provider) && getSettings().provider === setup.provider;
    renderSetup();
  });
  $('#setup-other').addEventListener('click', () => { const r = body.querySelector('input[value=other]'); if (!r.checked) { r.checked = true; r.dispatchEvent(new Event('change')); } });
  bindKeyBox(body.querySelector('.setup-key'), async (key, out) => {
    await saveAiKey(setup.provider, key, out.models);
    setup.aiOk = true;
    $('#setup-ai-next').disabled = false;
    $('#setup-ai-next').focus();
  });
}

/* ---------- Step 2: search ---------- */
function setupSearch() {
  const pv = getSettings().provider;
  const builtin = PROVIDERS[pv].builtinSearch;
  const saved = SettingsFile.key('tavily');
  return `<h2 id="setup-title">Get a free search key</h2>
    <p><strong>Tavily</strong> does the searching, and Evaluator limits it to your trusted websites. The free plan gives 1,000 searches a month with no card needed. Each result uses 3 to 8 of them (Settings › Searches per trace).</p>
    ${builtin ? `<div class="choices">
      <label class="choice"><input type="radio" name="setup-search" value="tavily"${setup.searchMode === 'tavily' ? ' checked' : ''}><span><strong>Tavily</strong><br><span class="hint">Free plan; works with every AI provider.</span></span></label>
      <label class="choice"><input type="radio" name="setup-search" value="builtin"${setup.searchMode === 'builtin' ? ' checked' : ''}><span><strong>${esc(PROVIDERS[pv].name)}'s own web search</strong><br><span class="hint">No extra key. Billed by ${esc(PROVIDERS[pv].name)}, limited to your trusted websites.</span></span></label>
    </div>` : ''}
    <div id="setup-tavily"${builtin && setup.searchMode === 'builtin' ? ' hidden' : ''}>
      <ol class="steps setup-howto">
        <li>Open <a href="https://app.tavily.com" target="_blank" rel="noopener">Tavily</a> and sign up with Google or email.</li>
        <li>Your API key is on the first page you see (the overview). Copy it. It starts with <code>tvly-</code>.</li>
        <li>Paste it below and press <strong>Test and save</strong>.</li>
      </ol>
      ${keyBox('search', 'tavily', saved)}
    </div>
    <p class="hint">Only want to check claims against your own PDFs and notes? You can skip this: topics that contain only local files need no search.</p>
    <div class="setup-actions">
      <button type="button" class="btn primary" data-step="packs" id="setup-search-next"${setup.searchOk ? '' : ' disabled'}>Next: topics</button>
      <button type="button" class="btn quiet" data-step="packs" id="setup-search-skip"${setup.searchOk ? ' hidden' : ''}>Skip for now</button>
      <button type="button" class="btn ghost" data-step="ai">Back</button>
    </div>`;
}

function bindSearch(body) {
  body.querySelectorAll('input[name=setup-search]').forEach((r) => r.addEventListener('change', () => {
    setup.searchMode = r.value;
    SettingsFile.update({ search: r.value });
    if (r.value === 'builtin') setup.searchOk = true;
    else setup.searchOk = Boolean(SettingsFile.key('tavily'));
    afterSetupChange();
    renderSetup();
  }));
  const box = body.querySelector('.setup-key');
  if (box) bindKeyBox(box, async (key) => {
    SettingsFile.update({ keys: { tavily: key }, search: 'tavily' });
    await SettingsFile.save();
    afterSetupChange();
    setup.searchOk = true;
    $('#setup-search-next').disabled = false;
    $('#setup-search-skip').hidden = true;
    $('#setup-search-next').focus();
  });
}

/* ---------- Step 3: starter packs ---------- */
function setupPacks() {
  const list = Packs.list || [];
  const defaults = SourceStore.topics.map((t) => t.name);
  return `<h2 id="setup-title">What will you check?</h2>
    <p>Each pack adds a <strong>topic</strong>: a set of websites trusted for that subject. On the Trace page you pick a topic, and only its websites are searched.</p>
    ${defaults.length ? `<p class="hint">${tr('You already have: {list}.', { list: esc(defaults.map((n) => tr(n)).join(', ')) })}</p>` : ''}
    <div class="pack-grid setup-packs">${list.map((p) => {
      const st = SourceStore.packState(p);
      return `<label class="pack-pick${st === 'added' ? ' is-added' : ''}">
        <input type="checkbox" value="${esc(p.id)}"${st === 'added' ? ' checked disabled' : ''}>
        <span><strong>${esc(p.name)}</strong>${st === 'added' ? ' <span class="tag">Added</span>' : ''}<br><span class="hint">${esc(tr(p.audience))}. ${trn(p.sources.length, '{n} website.', '{n} websites.')}</span></span>
      </label>`;
    }).join('') || '<p class="hint">Starter packs couldn\'t be loaded. You can add them later in Settings.</p>'}</div>
    <p class="setup-key-msg" id="setup-pack-msg" role="status"></p>
    <div class="setup-actions">
      <button type="button" class="btn primary" id="setup-packs-add" data-autofocus>Add and finish</button>
      <button type="button" class="btn ghost" data-step="search">Back</button>
    </div>`;
}

function bindPacks(body) {
  if (!Packs.list) Packs.load().then(() => { if (setup.step === 'packs') renderSetup(); }).catch(() => {});
  $('#setup-packs-add').addEventListener('click', () => {
    const ids = [...body.querySelectorAll('.setup-packs input:checked:not(:disabled)')].map((i) => i.value);
    try {
      ids.forEach((id) => { const p = Packs.get(id); if (p) { SourceStore.installPack(p); setup.addedPacks.push(id); } });
    } catch (err) { $('#setup-pack-msg').innerHTML = `<span class="bad">${esc(err.message)}</span>`; return; }
    refreshAll();
    renderPacks();
    setup.step = 'done';
    renderSetup();
  });
}

/* ---------- Done ---------- */
function setupDone() {
  const s = getSettings();
  const p = PROVIDERS[s.provider];
  const missing = missingItems();
  const added = setup.addedPacks.map((id) => Packs.get(id)).filter(Boolean);
  const tries = (added.length ? added : (Packs.list || []).filter((pk) => SourceStore.packState(pk) === 'added')).slice(0, 3);
  const fallback = [{ id: '', name: 'Indian history', exampleClaim: 'The Permanent Settlement of 1793 impoverished the peasantry of Bengal.', topic: { id: 't-india' } }];
  return `<h2 id="setup-title">${missing.length ? tr('Almost there') : tr('You\'re ready')}</h2>
    <ul class="setup-list setup-summary">
      <li>${siteHasKey(s.provider) ? icon('support') : icon('challenge')} ${tr('AI model: {model}', { model: siteHasKey(s.provider) ? `${esc(p.name)} (${esc(s.models[s.provider] || p.defaultModel)})` : tr('not set up yet') })}</li>
      <li>${effectiveSearch(s) === 'builtin' || WP.tavily ? icon('support') : icon('challenge')} ${tr('Search: {search}', { search: effectiveSearch(s) === 'builtin' ? esc(tr('{name}\'s web search', { name: p.name })) : WP.tavily ? 'Tavily' : tr('not set up yet (only local files can be searched)') })}</li>
      ${added.length ? `<li>${icon('support')} ${tr('Added: {list}', { list: esc(added.map((a) => tr(a.name)).join(', ')) })}</li>` : ''}
    </ul>
    ${missing.length ? `<p class="notice">${tr('Still needed: {missing}.', { missing: esc(missing.join(', ')) })} <button type="button" class="btn quiet" data-step="${siteHasKey(s.provider) ? 'search' : 'ai'}">Go back to it</button></p>` : ''}
    <h3 class="setup-sub">Try a first claim</h3>
    <p class="hint">Pick one and it is filled in on the Trace page. Then press <strong>Evaluate</strong> (or any of the four buttons).</p>
    <div class="setup-tries">${(tries.length ? tries : fallback).map((pk) => `<button type="button" class="try-claim" data-claim="${esc(pk.exampleClaim)}" data-topic="${esc(pk.topic.id)}"><span class="hint">${esc(tr(pk.name))}</span><span translate="no">${esc(pk.exampleClaim)}</span></button>`).join('')}</div>
    <div class="setup-actions">
      <button type="button" class="btn primary" data-finish data-autofocus>Go to Trace</button>
    </div>`;
}

function bindDone(body) {
  body.querySelector('[data-finish]').addEventListener('click', () => { closeSetup(); location.hash = '#trace'; });
  body.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', () => {
    useClaim(b.dataset.claim, b.dataset.topic);
    closeSetup();
  }));
}

/** Fills in a claim on the Trace page and picks its topic (when you have it). */
function useClaim(claim, topicId) {
  location.hash = '#trace';
  if (topicId && SourceStore.topic(topicId)) { local.set(KEYS.topic, topicId); renderTopicPicker(); renderScope(); }
  const box = $('#statement');
  box.value = claim;
  box.focus();
  setStatus(tr('Claim filled in. Choose <strong>Support</strong>, <strong>Challenge</strong>, <strong>Evaluate</strong> or <strong>Verify</strong>.'));
}

/* =====================================================================
 * Getting started on the Trace page
 * ===================================================================== */
function renderGettingStarted() {
  const box = $('#getting-started');
  if (!box) return;
  const ready = isReady();
  box.hidden = ready;
  if (!ready) {
    const missing = missingItems();
    $('#gs-text').textContent = missing.length === 1
      ? tr('Evaluator needs one more thing before it can check claims: {missing}. The guide gets it in about three minutes.', { missing: missing[0] })
      : tr('Evaluator needs a couple of free keys before it can check claims: {missing}. The guide gets them in about three minutes.', { missing: missing.join(', ') });
  }
}

/* =====================================================================
 * Settings: starter packs
 * ===================================================================== */
async function renderPacks() {
  const box = $('#pack-list');
  if (!box) return;
  try { await Packs.load(); } catch { box.innerHTML = '<p class="hint">Starter packs couldn\'t be loaded. Check your connection and reopen this section.</p>'; return; }
  const states = Packs.list.map((p) => SourceStore.packState(p));
  const meta = $('#meta-packs');
  if (meta) meta.textContent = tr('{n} of {m} added', { n: states.filter((s) => s === 'added').length, m: Packs.list.length });
  box.innerHTML = Packs.list.map((p, i) => {
    const st = states[i];
    const topic = SourceStore.packTopic(p);
    return `<li class="pack-card${st === 'added' ? ' is-added' : ''}">
      <div class="pack-main">
         <p class="pack-name">${esc(tr(p.name))} ${st === 'added' ? '<span class="tag ok">Added</span>' : st === 'partial' ? '<span class="tag">Partly added</span>' : ''}</p>
        <p class="hint">${esc(tr(p.description))} <em>${tr('For: {audience}.', { audience: esc(tr(p.audience)) })}</em></p>
        <details class="pack-sites"><summary>${trn(p.sources.length, '{n} website', '{n} websites')}</summary>
          <ul>${p.sources.map((s) => `<li><strong translate="no">${esc(s.label)}</strong> <span class="muted" translate="no">${esc(s.domain)}</span> <span class="tag">${esc(CATEGORY_NAMES[s.category] || s.category)}</span><br><span class="hint">${esc(tr(s.notes))}</span></li>`).join('')}</ul>
        </details>
      </div>
      <div class="pack-actions">
        ${st === 'added'
          ? `<button type="button" class="btn quiet" data-pack-use="${esc(topic.id)}">Use on Trace</button>`
          : `<button type="button" class="btn primary" data-pack-add="${esc(p.id)}">${st === 'partial' ? 'Add the missing sites' : 'Add pack'}</button>`}
      </div>
    </li>`;
  }).join('');
  box.querySelectorAll('[data-pack-add]').forEach((b) => b.addEventListener('click', () => {
    const p = Packs.get(b.dataset.packAdd);
    try {
      const r = SourceStore.installPack(p);
      refreshAll();
      renderPacks();
      const bits = [];
      if (r.added) bits.push(trn(r.added, '{n} website added', '{n} websites added'));
      if (r.linked) bits.push(trn(r.linked, '{n} you already had was mapped to it', '{n} you already had were mapped to it'));
      $('#pack-msg').className = 'form-error ok';
      $('#pack-msg').textContent = tr('“{name}” is ready as a topic: {details}.', { name: tr(p.name), details: bits.join('; ') || tr('nothing new was needed') })
        + (r.off ? ` ${trn(r.off, '{n} of them is switched off in your list and stays off.', '{n} of them are switched off in your list and stay off.')}` : '');
    } catch (err) {
      $('#pack-msg').className = 'form-error';
      $('#pack-msg').textContent = err.message;
    }
  }));
  box.querySelectorAll('[data-pack-use]').forEach((b) => b.addEventListener('click', () => {
    local.set(KEYS.topic, b.dataset.packUse);
    location.hash = '#trace';
    renderTopicPicker(); renderScope();
  }));
}

/* =====================================================================
 * Examples (samples.json): prepared results, opened without a key
 * ===================================================================== */
const Samples = {
  list: null,
  async load() {
    if (this.list) return this.list;
    const res = await fetch(assetUrl('samples.json'), { cache: 'no-cache' });
    const d = await res.json();
    this.list = Array.isArray(d.samples) ? d.samples : [];
    this.note = String(d.note || '');
    return this.list;
  },
  get(id) { return (this.list || []).find((s) => s.id === id) || null; },
};

async function renderSampleChips() {
  const box = $('#sample-chips');
  if (!box) return;
  try { await Samples.load(); } catch { box.hidden = true; return; }
  box.hidden = !Samples.list.length;
  box.querySelector('ul').innerHTML = Samples.list.map((s) => `<li><button type="button" class="sample-chip" data-sample="${esc(s.id)}">
      <span class="h-dir ${esc(s.result.mode)}">${icon(MODE_ICON[s.result.mode])}${esc(MODE_SHORT[s.result.mode])}</span>
      <span class="sample-text" translate="no">${esc(s.label)}</span></button></li>`).join('');
  box.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => openSample(b.dataset.sample)));
}

function openSample(id) {
  const s = Samples.get(id);
  if (!s) return;
  showResult({ ...s.result, sample: true, sampleId: s.id, sampleNote: Samples.note });
}

function sampleBannerHtml(r) {
  return `<div class="sample-banner no-print" role="note"><p><strong>${tr('Example result, not run live.')}</strong> ${esc(tr(r.sampleNote || ''))}</p></div>`;
}

/** "Run this claim myself": fills it in and runs it, or opens the setup guide first. */
function runSampleYourself(r) {
  $('#statement').value = r.statement;
  const s = Samples.get(r.sampleId);
  if (s && s.topicId && SourceStore.topic(s.topicId)) { local.set(KEYS.topic, s.topicId); renderTopicPicker(); renderScope(); }
  if (!isReady()) {
    setStatus(tr('The claim is filled in. Set up your free keys first, then press a button to run it live.'));
    openSetup();
    return;
  }
  runTrace(r.mode);
}

/* =====================================================================
 * Start-up
 * ===================================================================== */
function initOnboarding() {
  $('#gs-open').addEventListener('click', () => openSetup());
  $('#setup-guide-btn').addEventListener('click', () => openSetup());
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element && e.target.closest('[data-open-setup]');
    if (a) { e.preventDefault(); openSetup(); }
  });
  const accPacks = $('#acc-packs');
  if (accPacks) accPacks.addEventListener('toggle', () => { if (accPacks.open) renderPacks(); });
  renderPacks();
  renderSampleChips();
  renderGettingStarted();
  // First visit with nothing set up: open the guide once. "Later" is remembered.
  const seen = local.get(KEYS.onboarding, {});
  if (!isReady() && !seen.state && SettingsFile.state !== 'broken') {
    Packs.load().catch(() => {});
    setTimeout(() => openSetup(), 350);
  }
}
