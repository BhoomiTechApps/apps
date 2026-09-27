/* Evaluator: main.js
 *
 * Start-up: wires up every control and registers the service worker.
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

// No context menu (right click, or long press on phones) anywhere on the app
// screen. Text boxes keep theirs so pasting a statement or an API key still works.
document.addEventListener('contextmenu', (e) => {
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  e.preventDefault();
});

document.addEventListener('DOMContentLoaded', async () => {
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
  $('#forget-key').addEventListener('click', forgetKey);
  $('#provider-select').addEventListener('change', switchProvider);
  $('#model-select').addEventListener('change', onModelSelect);
  $('#model-custom').addEventListener('change', storeForm);
  $('#helper-select').addEventListener('change', storeForm);
  ['apiKey', 'tavilyKey', 'maxSearches'].forEach((n) => $('#key-form')[n].addEventListener('change', storeForm));
  document.querySelectorAll('input[name=searchFocus]').forEach((r) => r.addEventListener('change', storeForm));
  $('#load-models').addEventListener('click', loadModels);
  document.querySelectorAll('input[name=search]').forEach((r) => r.addEventListener('change', () => { $('#tavily-fields').hidden = !$('#search-tavily').checked; storeForm(); }));
  $('#topic-form').addEventListener('submit', submitTopic);
  $('#topic-cancel').addEventListener('click', resetTopicForm);
  $('#source-form').addEventListener('submit', submitSource);
  $('#source-cancel').addEventListener('click', resetSourceForm);
  $('#source-filter').addEventListener('change', (e) => { ui.sourceFilter = e.target.value; renderSources(); if (!ui.editingId) resetSourceForm(); });
  $('#export-btn').addEventListener('click', exportSources);
  $('#import-input').addEventListener('change', importSources);
  $('#reset-btn').addEventListener('click', restoreDefaults);
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

  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded && !ui.controller) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch(() => {});
  }
});
