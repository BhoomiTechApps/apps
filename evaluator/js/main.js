/* Evaluator: main.js
 *
 * Start-up: reads the settings file, wires up every control and registers
 * the service worker that lets the app be installed and open offline.
 * Loaded last.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/* =====================================================================
 * Boot
 * ===================================================================== */
function updateOnline() { $('#offline-banner').hidden = navigator.onLine; }

// Right-click / long press: see js/guard.js (no menu anywhere, Copy / Paste only in text fields).

/**
 * Sizes the two columns of the open view (Trace, Settings or Help) so the
 * whole frame fits the window, or the App height set by the administrator or
 * the shortcode: each column then scrolls on its own. Below the stacking
 * breakpoint the CSS ignores it.
 */
function fitWorkspace() {
  const ws = document.querySelector('.ev-main > .view:not([hidden])');
  const frame = $('.ev-frame');
  if (!ws || !frame) return;
  // A set App height (Settings › Appearance) wins over the window.
  const target = WP.appHeight || window.innerHeight;
  const set = (h) => frame.style.setProperty('--ev-ws-h', `${Math.max(360, Math.floor(h))}px`);
  // Measured against the frame and its margins, not the page, which may be taller.
  const cs = getComputedStyle(frame);
  const outer = () => frame.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
  set(target - (outer() - ws.getBoundingClientRect().height));
  // Second pass: correct for anything that moved once the height was applied.
  const miss = target - outer();
  if (Math.abs(miss) > 1) set(ws.getBoundingClientRect().height + miss);
}

document.addEventListener('DOMContentLoaded', async () => {
  // The settings file comes first: keys, provider, model and theme all live in it.
  await SettingsFile.init();
  SettingsFile.on((kind) => {
    if (kind === 'status') renderFileStatus();
    else if (kind === 'data') onSettingsData();
    else if (kind === 'change') fillEditor();
  });
  applyAppearance();
  renderFileStatus();
  fillEditor();

  route();
  window.addEventListener('hashchange', route);
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  try {
    if (sessionStorage.getItem('tracer.cleared')) {
      sessionStorage.removeItem('tracer.cleared');
      $('#statement').value = '';
      window.scrollTo(0, 0);
    }
  } catch { /* ignore */ }

  // Help tables become stacked cards on phones; each cell is labelled with its column name.
  document.querySelectorAll('.help-table').forEach((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => td.setAttribute('data-label', heads[i] || '')));
  });

  // Links inside Help that jump to another Help section: open it and scroll to it.
  document.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.getElementById(a.dataset.open);
    if (!target) return;
    target.open = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  // Moving between Trace, Settings and Help starts at the top of the page.
  window.addEventListener('hashchange', () => { if (VIEWS.includes(location.hash.slice(1))) window.scrollTo(0, 0); });

  $('#trace-form').addEventListener('submit', (e) => { e.preventDefault(); runTrace(e.submitter ? e.submitter.value : 'support'); });
  $('#stop-btn').addEventListener('click', () => { if (ui.controller) { $('#busy-msg').textContent = 'Stopping…'; ui.controller.abort(); } });
  $('#balance-refresh').addEventListener('click', () => renderBalances(true));
  $('#clear-history').addEventListener('click', () => { if (confirm('Clear all recent results from this device?')) { local.remove(KEYS.history); refreshPage(); } });
  $('#topic-select').addEventListener('change', (e) => { local.set(KEYS.topic, e.target.value); renderTopicPicker(); renderScope(); });
  $('#key-form').addEventListener('submit', saveKeyForm);
  $('#provider-select').addEventListener('change', switchProvider);
  $('#model-select').addEventListener('change', onModelSelect);
  $('#model-custom').addEventListener('change', storeForm);
  $('#helper-select').addEventListener('change', storeForm);
  $('#key-form').maxSearches.addEventListener('change', storeForm);
  document.querySelectorAll('input[name=searchFocus]').forEach((r) => r.addEventListener('change', storeForm));
  $('#load-models').addEventListener('click', loadModels);
  document.querySelectorAll('input[name=search]').forEach((r) => r.addEventListener('change', storeForm));
  $('#topic-form').addEventListener('submit', submitTopic);
  $('#topic-cancel').addEventListener('click', resetTopicForm);
  $('#source-form').addEventListener('submit', submitSource);
  $('#source-cancel').addEventListener('click', resetSourceForm);
  $('#source-filter').addEventListener('change', (e) => { ui.sourceFilter = e.target.value; renderSources(); if (!ui.editingId) resetSourceForm(); });
  $('#export-btn').addEventListener('click', exportSources);
  $('#import-input').addEventListener('change', importSources);
  $('#reset-btn').addEventListener('click', restoreDefaults);
  // Settings file and appearance.
  $('#look-form').addEventListener('change', storeLook);
  $('#look-form').addEventListener('submit', (e) => { e.preventDefault(); storeLook(); });
  $('#file-folder').addEventListener('click', chooseSettingsFolder);
  $('#file-unlink').addEventListener('click', unlinkSettingsFolder);
  $('#file-reload').addEventListener('click', async () => { fileUi.editorDirty = false; await SettingsFile.reload(); fillEditor(true); });
  $('#file-download').addEventListener('click', downloadSettings);
  $('#file-import').addEventListener('change', importSettings);
  $('#file-reset').addEventListener('click', resetSettings);
  $('#file-editor').addEventListener('input', () => { fileUi.editorDirty = true; });
  $('#file-save').addEventListener('click', saveEditor);
  $('#file-tidy').addEventListener('click', tidyEditor);
  $('#file-revert').addEventListener('click', () => { fileUi.editorDirty = false; fillEditor(true); $('#file-msg').textContent = ''; });
  $('#file-banner-btn').addEventListener('click', async () => {
    if (SettingsFile.state === 'permission') { await SettingsFile.reconnect(); return; }
    location.hash = '#settings';
    openAcc('acc-file'); $('#file-editor-wrap').open = true;
    fillEditor(true);
    setTimeout(() => $('#file-editor-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  });
  // Links that say "Add it in Settings" open the right section.
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element && e.target.closest('[data-goto]');
    if (a) setTimeout(() => { openAcc(a.dataset.goto); document.getElementById(a.dataset.goto).scrollIntoView({ block: 'start' }); }, 30);
  });
  // A write still waiting when the window closes is written now.
  window.addEventListener('pagehide', () => { if (SettingsFile.timer) SettingsFile.save(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && SettingsFile.timer) SettingsFile.save(); });
  $('#add-folder').addEventListener('click', addFolder);
  $('#folder-input').addEventListener('change', (e) => addFromInput(e));
  $('#files-input').addEventListener('change', (e) => addFromInput(e, `Selected files, ${new Date().toLocaleDateString()}`));

  fillKeyForm();
  renderHistory();
  await SourceStore.init();
  await LibraryStore.init();
  initAccordions();
  refreshAll();
  renderBalances();
  resetTopicForm();
  resetSourceForm();

  // Installable app: the service worker keeps the app's files for offline start.
  if ('serviceWorker' in navigator && /^(https:|http:\/\/(localhost|127\.0\.0\.1))/.test(location.href)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Side by side, every view's columns fill the window (or the App height in Appearance).
  fitWorkspace();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitWorkspace);
  window.addEventListener('resize', fitWorkspace);
  window.addEventListener('hashchange', fitWorkspace);

});
