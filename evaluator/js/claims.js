/* Evaluator: claims.js
 *
 * Claim finder: pulls the claims worth checking out of
 *   - pasted text (an article, a post, a WhatsApp forward),
 *   - a web link (read with Tavily's extract service, using your Tavily key),
 *   - a screenshot or photo (read by your AI model, if it can read images).
 * Picking a claim puts it in the statement box with the suggested button.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

const FINDER_MAX_CHARS = 20000;
const finder = { tab: 'text', image: null, busy: false, controller: null };

/** Reads a web page's main text with Tavily Extract. 1 credit per 5 pages. */
async function extractPage(url, signal) {
  const acc = searchAccess();
  let u;
  try { u = new URL(url.trim()); } catch { throw new ProviderError(tr('That isn\'t a web address. It should start with https://')); }
  if (!/^https?:$/.test(u.protocol)) throw new ProviderError(tr('That isn\'t a web address. It should start with https://'));
  const data = await apiRequest(acc.name, 'POST', `${acc.base}/extract`, acc.headers, {
    urls: [u.href], extract_depth: 'basic', format: 'text', include_usage: true,
  }, signal);
  const hit = (data.results || [])[0];
  if (!hit || !hit.raw_content) {
    const why = (data.failed_results || [])[0];
    throw new ProviderError(tr('The page couldn\'t be read{reason}. Some sites block reading by apps; copy the text and paste it instead.', { reason: why && why.error ? ` (${why.error})` : '' }));
  }
  return { url: hit.url || u.href, text: String(hit.raw_content) };
}

/** Shrinks a picture to at most 1600 px on its longer side, as JPEG, to keep the request small. */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) { reject(new ProviderError(tr('That file isn\'t a picture. Use a PNG, JPEG or WebP screenshot.'))); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL('image/jpeg', 0.88);
      resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl, name: file.name || tr('Pasted picture') });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new ProviderError(tr('That picture couldn\'t be opened.'))); };
    img.src = url;
  });
}

/** Asks the model for the claims in a text or picture. */
async function findClaims({ text, image, signal }) {
  const s = getSettings();
  const p = PROVIDERS[s.provider];
  if (!siteHasKey(s.provider)) throw new ProviderError(tr('There\'s no {provider} API key yet. Add it in Settings › AI model and search.', { provider: tr(p.name) }));
  const model = (s.models[s.provider] || p.defaultModel || '').trim();
  const lang = LANGS[resultLang()].english;
  let system = CLAIMS_SYSTEM.replace(/\{LANG\}/g, lang);
  if (image) system += CLAIMS_IMAGE_RULE;
  let out;
  try {
    out = await chat({
      provider: s.provider, model, json: true, signal, system, image: image ? { mime: image.mime, data: image.data } : null,
      user: image ? 'Find the claims worth checking in this picture.' : `Material:\n"""${text.slice(0, FINDER_MAX_CHARS)}"""`,
    });
  } catch (err) {
    // Most text-only models answer a picture with a 400 error.
    if (image && err instanceof ProviderError && (err.status === 400 || err.status === 404 || err.status === 422)) {
      throw new ProviderError(tr('{model} can\'t read pictures. Choose a model that can, such as Google Gemini (free), or copy the text from the picture and paste it.', { model: `${tr(p.name)} ${model}` }));
    }
    throw err;
  }
  const j = extractJson(out, 'claims');
  if (!j || !Array.isArray(j.claims)) throw new ProviderError(tr('The model\'s {what} couldn\'t be read. Run it again, or pick a larger model in Settings.', { what: tr('list of claims') }));
  const modes = ['check', 'balanced', 'support', 'contest'];
  return {
    summary: String(j.summary || ''),
    transcript: String(j.transcript || ''),
    claims: j.claims.map((c) => ({ text: String((c && c.text) || '').trim().slice(0, 600), suggest: modes.includes(c && c.suggest) ? c.suggest : 'balanced', why: String((c && c.why) || '') }))
      .filter((c) => c.text.length >= 8).slice(0, 8),
  };
}

/* ---------- Panel ---------- */
function finderTab(tab) {
  finder.tab = tab;
  document.querySelectorAll('#finder [data-finder-tab]').forEach((b) => {
    const on = b.dataset.finderTab === tab;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('#finder [data-finder-pane]').forEach((p) => { p.hidden = p.dataset.finderPane !== tab; });
}

function setFinderImage(img) {
  finder.image = img;
  $('#finder-image-preview').hidden = !img;
  if (img) { $('#finder-image-preview img').src = img.preview; $('#finder-image-name').textContent = img.name; }
}

async function takeImageFile(file) {
  const msg = $('#finder-msg');
  try { setFinderImage(await shrinkImage(file)); msg.textContent = ''; finderTab('image'); } catch (err) { msg.className = 'status error'; msg.textContent = err.message; }
}

async function runFinder() {
  if (finder.busy) { if (finder.controller) finder.controller.abort(); return; }
  const msg = $('#finder-msg');
  const list = $('#finder-results');
  msg.className = 'status';
  list.innerHTML = '';
  let input;
  if (finder.tab === 'text') {
    const text = $('#finder-text').value.trim();
    if (text.length < 20) { msg.className = 'status error'; msg.textContent = tr('Paste some text first: an article, a post or a forward.'); return; }
    input = { text };
  } else if (finder.tab === 'link') {
    if (!$('#finder-url').value.trim()) { msg.className = 'status error'; msg.textContent = tr('Paste a web address first.'); return; }
  } else if (!finder.image) {
    msg.className = 'status error'; msg.textContent = tr('Choose or paste a screenshot first.'); return;
  }
  if (!navigator.onLine && getSettings().provider !== 'local') { msg.className = 'status error'; msg.textContent = tr('You\'re offline. Connect to the internet to run a new analysis.'); return; }
  finder.busy = true;
  finder.controller = new AbortController();
  const btn = $('#finder-go');
  btn.querySelector('span').textContent = tr('Stop');
  msg.innerHTML = `<span class="spinner small" aria-hidden="true"></span> ${esc(tr('Reading…'))}`;
  try {
    if (finder.tab === 'link') {
      msg.innerHTML = `<span class="spinner small" aria-hidden="true"></span> ${esc(tr('Reading the page…'))}`;
      const page = await extractPage($('#finder-url').value, finder.controller.signal);
      input = { text: page.text };
    } else if (finder.tab === 'image') {
      input = { image: finder.image };
    }
    msg.innerHTML = `<span class="spinner small" aria-hidden="true"></span> ${esc(tr('Finding the claims worth checking…'))}`;
    const res = await findClaims({ ...input, signal: finder.controller.signal });
    renderFinderResults(res);
    msg.textContent = res.claims.length ? '' : tr('No checkable claims were found. Opinions and greetings are skipped.');
  } catch (err) {
    msg.className = 'status error';
    msg.textContent = err.name === 'AbortError' ? tr('Stopped.') : err.message;
  } finally {
    finder.busy = false;
    finder.controller = null;
    btn.querySelector('span').textContent = tr('Find claims');
    renderBalances(true);
  }
}

function renderFinderResults(res) {
  const box = $('#finder-results');
  box.innerHTML = `${res.summary ? `<p class="hint finder-summary">${esc(res.summary)}</p>` : ''}
    ${res.transcript ? `<details class="finder-transcript"><summary>${esc(tr('Text read from the picture'))}</summary><p translate="no">${esc(res.transcript)}</p></details>` : ''}
    ${res.claims.length ? `<p class="finder-pick">${esc(tr('Pick a claim to check:'))}</p>` : ''}
    <ul class="finder-claims">${res.claims.map((c, i) => `<li>
      <button type="button" class="finder-claim" data-claim-i="${i}">
        <span class="finder-claim-text" translate="no">${esc(c.text)}</span>
        <span class="finder-claim-meta"><span class="h-dir ${c.suggest === 'check' ? 'check' : c.suggest}">${icon(MODE_ICON[c.suggest === 'check' ? 'check' : c.suggest])}${esc(MODE_SHORT[c.suggest])}</span> <span class="hint" translate="no">${esc(c.why)}</span></span>
      </button></li>`).join('')}</ul>`;
  if (res.claims.length > 1) {
    box.insertAdjacentHTML('beforeend', `<div class="form-actions"><button type="button" class="btn quiet" id="finder-batch">${icon('list')}<span>${esc(tr('Check all these claims'))}</span></button></div>`);
    $('#finder-batch').addEventListener('click', () => batchFromFinder(res.claims));
  }
  box.querySelectorAll('[data-claim-i]').forEach((b) => b.addEventListener('click', () => {
    const c = res.claims[Number(b.dataset.claimI)];
    const st = $('#statement');
    st.value = c.text.slice(0, 2000);
    const target = document.querySelector(`button.act[value="${c.suggest}"]`);
    setStatus(tr('Claim filled in. Suggested: <strong>{mode}</strong>. Or choose another button.', { mode: esc(MODE_SHORT[c.suggest]) }));
    st.scrollIntoView({ block: 'nearest' });
    if (target) { target.classList.add('suggested'); setTimeout(() => target.classList.remove('suggested'), 4000); target.focus(); }
  }));
  // Model text keeps its own language for screen readers.
  box.querySelectorAll('[translate=no]').forEach((el) => { if (!el.lang) el.lang = guessLang(el.textContent); });
}

/** A best guess at the language of a piece of text, for screen readers: Assamese, Bengali or English. */
function guessLang(text) {
  const s = String(text || '');
  if (/[ৰৱ]/.test(s)) return 'as';
  if (/[ঀ-৿]/.test(s)) return 'bn';
  if (/[ऀ-ॿ]/.test(s)) return 'hi';
  return /[A-Za-z]/.test(s) ? 'en' : '';
}

function initFinder() {
  document.querySelectorAll('[data-app-origin]').forEach((c) => { c.textContent = location.origin; });
  const root = $('#finder');
  if (!root) return;
  root.querySelectorAll('[data-finder-tab]').forEach((b) => b.addEventListener('click', () => finderTab(b.dataset.finderTab)));
  // Arrow keys move between the tabs.
  $('#finder-tabs').addEventListener('keydown', (e) => {
    const tabs = [...root.querySelectorAll('[data-finder-tab]')];
    const i = tabs.findIndex((t) => t.dataset.finderTab === finder.tab);
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    if (j === null) return;
    e.preventDefault(); finderTab(tabs[j].dataset.finderTab); tabs[j].focus();
  });
  $('#finder-go').addEventListener('click', runFinder);
  $('#finder-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) takeImageFile(f); });
  $('#finder-image-clear').addEventListener('click', () => setFinderImage(null));
  // Paste a screenshot (Ctrl+V) anywhere in the panel, or drop it on the picture area.
  root.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find((x) => x.kind === 'file' && /^image\//.test(x.type));
    if (item) { e.preventDefault(); takeImageFile(item.getAsFile()); }
  });
  const drop = $('#finder-drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) takeImageFile(f); });
  $('#finder-text').addEventListener('input', () => {
    const n = $('#finder-text').value.length;
    $('#finder-count').textContent = n > FINDER_MAX_CHARS ? tr('Only the first {max} characters are read.', { max: FINDER_MAX_CHARS.toLocaleString('en-IN') }) : '';
  });
  // A shared link (Android "Share to Evaluator", the browser extension) or ?text= / ?url= opens the finder
  // with it filled in; ?claim= fills in the statement itself.
  const q = new URLSearchParams(location.search);
  const sharedUrl = q.get('url') || ((q.get('text') || '').match(/https?:\/\/\S+/) || [])[0];
  if (q.get('claim')) {
    $('#statement').value = q.get('claim').replace(/\s+/g, ' ').trim().slice(0, 2000);
    setStatus(tr('Claim filled in. Choose <strong>Support</strong>, <strong>Challenge</strong>, <strong>Evaluate</strong> or <strong>Verify</strong>.'));
    history.replaceState(null, '', location.pathname + location.hash);
  } else if (q.get('text') || sharedUrl) {
    $('#finder-wrap').open = true;
    if (sharedUrl && !(q.get('text') || '').replace(sharedUrl, '').trim()) { finderTab('link'); $('#finder-url').value = sharedUrl; } else { finderTab('text'); $('#finder-text').value = q.get('text') || ''; }
    history.replaceState(null, '', location.pathname + location.hash);
  }
  // A screenshot from the browser extension: its helper on this page passes the picture in a message.
  // Only messages from this same page are accepted, and only as a picture for the claim finder.
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== location.origin || !e.data || e.data.type !== 'evaluator-extension-image') return;
    const url = String(e.data.dataUrl || '');
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) || url.length > 25e6) return;
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], tr('Screenshot of {site}', { site: String(e.data.site || '').slice(0, 80) || tr('a web page') }), { type: blob.type });
      location.hash = '#trace';
      $('#finder-wrap').open = true;
      await takeImageFile(file);
      $('#finder-wrap').scrollIntoView({ block: 'start' });
    } catch { /* ignore a broken picture */ }
  });
  // Tells the extension's helper (if any) that the page is ready for a picture.
  document.documentElement.dataset.evaluatorReady = '1';
  window.postMessage({ type: 'evaluator-ready' }, location.origin);
}
