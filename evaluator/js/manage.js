/* Evaluator: manage.js
 *
 * Settings screens for topics, trusted sources and local folders, plus
 * routing and the scope line on the Trace page.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/* =====================================================================
 * UI: routing and scope
 * ===================================================================== */
const ui = { result: null, mode: 'summary', editingId: null, editingTopicId: null, controller: null, sourceFilter: '' };

const VIEWS = ['trace', 'settings', 'help'];

function route() {
  const wanted = location.hash.slice(1);
  const view = VIEWS.includes(wanted) ? wanted : 'trace';
  VIEWS.forEach((v) => { $(`#view-${v}`).hidden = v !== view; });
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function selectedTopicId() {
  const id = local.get(KEYS.topic, '');
  return SourceStore.topic(id) ? id : '';
}

function renderTopicPicker() {
  const sel = $('#topic-select');
  const current = selectedTopicId();
  const on = SourceStore.enabled().length + LibraryStore.enabled().length;
  sel.innerHTML = `<option value="">All trusted sources (${on} on)</option>` + SourceStore.topics
    .map((t) => {
      const n = SourceStore.forTopic(t.id).length + LibraryStore.forTopic(t.id).length;
      return `<option value="${esc(t.id)}">${esc(t.name)} (${n} on)</option>`;
    }).join('');
  sel.value = current;
  const t = SourceStore.topic(current);
  $('#topic-note').textContent = t && t.description ? t.description : '';
}

function scopeText(scope) {
  const parts = [];
  if (scope.web.length) parts.push(`${scope.web.length} trusted website${scope.web.length === 1 ? '' : 's'}`);
  if (scope.local.length) parts.push(`${scope.local.length} local folder${scope.local.length === 1 ? '' : 's'}`);
  return parts.join(' and ');
}

function renderScope() {
  const s = getSettings();
  const scope = currentScope();
  const topic = scope.topic;
  let html = scope.web.length || scope.local.length
    ? `Searches ${scopeText(scope)}${topic ? ` in ${esc(topic.name)}` : ''}. <a href="#settings">Edit sources and topics</a>`
    : (topic ? `Nothing in ${esc(topic.name)} is switched on. <a href="#settings">Add sources to this topic</a>.` : 'No sources are switched on. <a href="#settings">Choose sources</a> before tracing.');
  const p = PROVIDERS[s.provider];
  const model = s.models[s.provider] || p.defaultModel;
  const searchName = !scope.web.length ? 'local files only' : (effectiveSearch(s) === 'tavily' ? 'Tavily' : `${esc(p.name)}'s web search`);
  html += `<br>Model: ${esc(p.name)}${model ? ` (${esc(model)})` : ''}. Search: ${searchName}.`;
  const missing = missingItems(scope);
  if (missing.length) {
    html += ` Still needed: ${esc(missing.join(', '))}. <a href="#settings" data-goto="acc-model">Add it in Settings</a>.`;
  }
  $('#scope-line').innerHTML = html;
}

function refreshAll() {
  renderTopics(); renderSources(); renderLibraries(); renderTopicPicker(); renderScope(); renderAccMeta(); renderSyncStatus();
}

/* ---------- Where the list is saved ---------- */
const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };

function renderSyncStatus() {
  const box = $('#sync-status');
  if (!box) return;
  box.innerHTML = '<div class="sync-box warn"><p>Your sources and topics are saved <strong>on this device only</strong>. Clearing the app\'s data or switching device loses them. Use <strong>Export JSON</strong> under Trusted sources to keep a copy.</p></div>';
}

/* ---------- Accordions: remember which are open ---------- */
function openAcc(id) {
  const d = document.getElementById(id);
  if (d && !d.open) d.open = true;
}

function initAccordions() {
  const saved = local.get(KEYS.accordions, null);
  document.querySelectorAll('details.acc').forEach((d) => {
    const key = d.dataset.acc;
    // First visit: open only the model group, and only if setup isn't finished.
    // First visit: open the model group only if setup isn't finished, and Help's quick start.
    d.open = saved && key in saved ? Boolean(saved[key]) : ((key === 'model' && !isReady()) || key === 'help-start');
    d.addEventListener('toggle', () => {
      const state = local.get(KEYS.accordions, {});
      state[key] = d.open;
      local.set(KEYS.accordions, state);
    });
  });
  // Cancelling an edit also folds the form away.
  $('#topic-cancel').addEventListener('click', () => { $('#topic-form-wrap').open = false; });
  $('#source-cancel').addEventListener('click', () => { $('#source-form-wrap').open = false; });
}

function renderAccMeta() {
  const s = getSettings();
  const p = PROVIDERS[s.provider];
  const missing = missingItems();
  $('#meta-model').textContent = missing.length
    ? `Needs ${missing.join(', ')}`
    : `${p.name}, ${s.models[s.provider] || p.defaultModel}, ${effectiveSearch(s) === 'tavily' ? 'Tavily search' : 'built-in search'}`;
  $('#meta-model').classList.toggle('warn', missing.length > 0);
  const t = SourceStore.topics.length;
  $('#meta-topics').textContent = `${t} topic${t === 1 ? '' : 's'}`;
  $('#meta-sources').textContent = `${SourceStore.enabled().length} of ${SourceStore.list.length} switched on`;
  const libs = LibraryStore.list;
  $('#meta-local').textContent = libs.length
    ? `${libs.length} folder${libs.length === 1 ? '' : 's'}, ${libs.reduce((n, l) => n + (l.passageCount || 0), 0)} passages`
    : 'None added';
}

/* =====================================================================
 * UI: topics
 * ===================================================================== */
function sourceChecklist(container, checkedIds) {
  const checked = new Set(checkedIds);
  const web = [...SourceStore.list].sort((a, b) => a.label.localeCompare(b.label)).map((s) => `
      <label class="check"><input type="checkbox" value="${esc(s.id)}"${checked.has(s.id) ? ' checked' : ''}>
        <span>${esc(s.label)} <span class="muted">${esc(s.domain)}${s.enabled ? '' : ', switched off'}</span></span></label>`).join('');
  const libs = LibraryStore.list.map((l) => `
      <label class="check"><input type="checkbox" value="lib:${esc(l.id)}"${checked.has(`lib:${l.id}`) ? ' checked' : ''}>
        <span>${esc(l.name)} <span class="muted">local folder${l.enabled ? '' : ', switched off'}</span></span></label>`).join('');
  container.innerHTML = (web || libs)
    ? `${web}${libs ? `<p class="check-group">Local folders</p>${libs}` : ''}`
    : '<p class="muted">Add sources below first, then map them to this topic.</p>';
}

function topicChecklist(container, checkedIds) {
  const checked = new Set(checkedIds);
  container.innerHTML = SourceStore.topics.length
    ? SourceStore.topics.map((t) => `
      <label class="check"><input type="checkbox" value="${esc(t.id)}"${checked.has(t.id) ? ' checked' : ''}><span>${esc(t.name)}</span></label>`).join('')
    : '<p class="muted">No topics yet. Create one in Topics above.</p>';
}

const checkedValues = (container) => [...container.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value);

function renderTopics() {
  const list = $('#topic-list');
  const openIds = new Set([...list.querySelectorAll('details[open]')].map((d) => d.dataset.topic));
  if (!SourceStore.topics.length) {
    list.innerHTML = '<li class="empty">No topics yet. Use "Add a topic" to group your sources by subject.</li>';
  } else {
    list.innerHTML = SourceStore.topics.map((t) => {
      const members = [...SourceStore.inTopic(t.id)].sort((x, y) => x.label.localeCompare(y.label))
        .concat(LibraryStore.inTopic(t.id).map((l) => ({ label: l.name, domain: 'local folder', enabled: l.enabled })));
      const on = members.filter((m) => m.enabled).length;
      return `<li><details class="topic-item" data-topic="${esc(t.id)}"${openIds.has(t.id) ? ' open' : ''}>
        <summary>
          <span class="topic-name">${esc(t.name)}</span>
          <span class="acc-meta">${members.length} source${members.length === 1 ? '' : 's'}, ${on} on</span>
        </summary>
        <div class="topic-body">
          ${t.description ? `<p class="source-notes">${esc(t.description)}</p>` : ''}
          ${members.length
            ? `<ul class="member-list">${members.map((m) => `<li class="${m.enabled ? '' : 'off'}">${esc(m.label)} <span class="muted">${esc(m.domain)}${m.enabled ? '' : ', switched off'}</span></li>`).join('')}</ul>`
            : '<p class="muted">No sources mapped yet. Edit the topic to add some.</p>'}
          <div class="row-actions">
            <button type="button" class="btn quiet" data-edit-topic="${esc(t.id)}">Edit</button>
            <button type="button" class="btn quiet danger" data-delete-topic="${esc(t.id)}">Delete</button>
          </div>
        </div>
      </details></li>`;
    }).join('');
  }
  list.querySelectorAll('[data-edit-topic]').forEach((b) => b.addEventListener('click', () => startTopicEdit(b.dataset.editTopic)));
  list.querySelectorAll('[data-delete-topic]').forEach((b) => b.addEventListener('click', () => {
    const t = SourceStore.topic(b.dataset.deleteTopic);
    if (!t || !confirm(`Delete the topic "${t.name}"? Its sources stay in your list.`)) return;
    SourceStore.removeTopic(t.id);
    LibraryStore.removeTopic(t.id).then(refreshAll);
    if (ui.editingTopicId === t.id) resetTopicForm();
    refreshAll();
  }));
  if (!ui.editingTopicId) sourceChecklist($('#topic-source-checks'), checkedValues($('#topic-source-checks')));
  topicChecklist($('#source-topic-checks'), checkedValues($('#source-topic-checks')));
  const filter = $('#source-filter');
  filter.innerHTML = '<option value="">All sources</option>' + SourceStore.topics.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  filter.value = SourceStore.topic(ui.sourceFilter) ? ui.sourceFilter : '';
}

function startTopicEdit(id) {
  const t = SourceStore.topic(id);
  if (!t) return;
  const f = $('#topic-form');
  ui.editingTopicId = id;
  f.topicName.value = t.name;
  f.topicDescription.value = t.description;
  sourceChecklist($('#topic-source-checks'), SourceStore.inTopic(id).map((s) => s.id).concat(LibraryStore.inTopic(id).map((l) => `lib:${l.id}`)));
  f.classList.add('editing');
  openAcc('acc-topics'); $('#topic-form-wrap').open = true;
  $('#topic-form-title').textContent = `Edit ${t.name}`;
  $('#topic-submit').textContent = 'Save topic';
  $('#topic-cancel').hidden = false;
  $('#topic-error').textContent = '';
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetTopicForm() {
  const f = $('#topic-form');
  f.reset();
  ui.editingTopicId = null;
  f.classList.remove('editing');
  sourceChecklist($('#topic-source-checks'), []);
  $('#topic-form-title').textContent = 'Add a topic';
  $('#topic-submit').textContent = 'Add topic';
  $('#topic-cancel').hidden = true;
  $('#topic-error').textContent = '';
}

async function submitTopic(e) {
  e.preventDefault();
  const f = e.target;
  const payload = { name: f.topicName.value, description: f.topicDescription.value };
  const all = checkedValues($('#topic-source-checks'));
  const ids = all.filter((v) => !v.startsWith('lib:'));
  const libIds = all.filter((v) => v.startsWith('lib:')).map((v) => v.slice(4));
  try {
    const wasEditing = Boolean(ui.editingTopicId);
    let topicId = ui.editingTopicId;
    if (wasEditing) SourceStore.updateTopic(ui.editingTopicId, payload, ids);
    else topicId = SourceStore.addTopic(payload, ids).id;
    await LibraryStore.setTopicLibraries(topicId, libIds);
    resetTopicForm(); refreshAll();
    if (wasEditing) $('#topic-form-wrap').open = false;
  } catch (err) {
    $('#topic-error').textContent = err.message;
  }
}

/* =====================================================================
 * UI: sources
 * ===================================================================== */
function renderSources() {
  const list = $('#source-list');
  list.innerHTML = '';
  const on = SourceStore.enabled().length;
  const count = $('#source-count');
  count.textContent = `${on} of ${SourceStore.list.length} switched on`;
  const filterTopic = SourceStore.topic(ui.sourceFilter);
  const shown = filterTopic ? SourceStore.inTopic(filterTopic.id) : SourceStore.list;
  if (!shown.length) {
    list.innerHTML = filterTopic
      ? `<li class="empty">No sources are mapped to ${esc(filterTopic.name)} yet. Edit the topic, or tick it when adding a source.</li>`
      : '<li class="empty">Your list is empty. Add the first site you trust above, or restore the default list.</li>';
    return;
  }
  const tpl = $('#source-row');
  [...shown].sort((a, b) => a.label.localeCompare(b.label)).forEach((s) => {
    const row = tpl.content.firstElementChild.cloneNode(true);
    row.classList.toggle('off', !s.enabled);
    $('.toggle', row).checked = s.enabled;
    $('.toggle-label', row).textContent = `Search ${s.label}`;
    $('.source-label', row).textContent = s.label;
    $('.source-domain', row).textContent = s.domain;
    $('.source-notes', row).textContent = s.notes;
    const names = s.topics.map((id) => SourceStore.topic(id)).filter(Boolean).map((t) => t.name);
    $('.source-topics', row).textContent = names.length ? `Topics: ${names.join(', ')}` : 'No topic';
    $('.tag', row).textContent = CATEGORY_NAMES[s.category] || s.category;
    $('.toggle', row).addEventListener('change', (e) => {
      try { SourceStore.update(s.id, { enabled: e.target.checked }); } catch (err) { alert(err.message); }
      refreshAll();
    });
    $('.edit', row).addEventListener('click', () => startEdit(s));
    $('.delete', row).addEventListener('click', () => {
      if (!confirm(`Delete ${s.label} from your trusted sources?`)) return;
      SourceStore.remove(s.id);
      if (ui.editingId === s.id) resetSourceForm();
      refreshAll();
    });
    list.appendChild(row);
  });
}

function startEdit(s) {
  const f = $('#source-form');
  ui.editingId = s.id;
  f.domain.value = s.domain; f.label.value = s.label; f.category.value = s.category; f.notes.value = s.notes;
  topicChecklist($('#source-topic-checks'), s.topics);
  f.classList.add('editing');
  openAcc('acc-sources'); $('#source-form-wrap').open = true;
  $('#source-form-title').textContent = `Edit ${s.label}`;
  $('#source-submit').textContent = 'Save changes';
  $('#source-cancel').hidden = false;
  $('#source-error').textContent = '';
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  f.domain.focus({ preventScroll: true });
}

function resetSourceForm() {
  const f = $('#source-form');
  f.reset();
  ui.editingId = null;
  f.classList.remove('editing');
  topicChecklist($('#source-topic-checks'), ui.sourceFilter ? [ui.sourceFilter] : []);
  $('#source-form-title').textContent = 'Add a source';
  $('#source-submit').textContent = 'Add source';
  $('#source-cancel').hidden = true;
  $('#source-error').textContent = '';
}

function submitSource(e) {
  e.preventDefault();
  const f = e.target;
  const payload = {
    domain: f.domain.value, label: f.label.value, category: f.category.value, notes: f.notes.value,
    topics: checkedValues($('#source-topic-checks')),
  };
  try {
    const wasEditing = Boolean(ui.editingId);
    if (wasEditing) SourceStore.update(ui.editingId, payload); else SourceStore.add(payload);
    resetSourceForm(); refreshAll();
    if (wasEditing) $('#source-form-wrap').open = false;
  } catch (err) {
    $('#source-error').textContent = err.message;
  }
}

function exportSources() {
  const blob = new Blob([JSON.stringify(SourceStore.exportData(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'trusted-sources.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importSources(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { alert('That file isn\'t valid JSON.'); return; }
  const n = (Array.isArray(parsed) ? parsed : parsed.sources || []).length;
  const t = Array.isArray(parsed.topics) ? parsed.topics.length : 0;
  if (!confirm(`Replace your sources and topics with the ${n} sources and ${t} topics in this file?${Sync.enabled ? ' Your current list is kept as an earlier version.' : ''}`)) return;
  try { SourceStore.replaceAll(parsed); } catch (err) { alert(`Import failed. ${err.message}`); return; }
  resetSourceForm(); resetTopicForm(); refreshAll();
}

async function restoreDefaults() {
  if (!confirm(`Replace your sources and topics with the default list?${Sync.enabled ? ' Your current list is kept as an earlier version.' : ''}`)) return;
  await SourceStore.restoreDefaults();
  resetSourceForm(); resetTopicForm(); refreshAll();
}

/* =====================================================================
 * UI: local files
 * ===================================================================== */
const STATUS_TEXT = { ok: '', empty: 'no readable text', unsupported: 'not supported', error: 'could not be read' };

function renderLibraries() {
  const list = $('#library-list');
  const note = $('#local-note');
  if (!LibraryStore.available) {
    note.textContent = 'This browser is blocking on-device storage (common in private windows), so local files can\'t be added here.';
    $('#add-folder').disabled = true;
    list.innerHTML = '';
    return;
  }
  note.textContent = TracerLocal.canPickFolder()
    ? 'This browser can remember a folder, so you can rescan it after adding or changing files.'
    : 'This browser can\'t remember folders. To pick up changes, remove the folder and add it again.';
  const openIds = new Set([...list.querySelectorAll('details[open]')].map((d) => d.dataset.lib));
  if (!LibraryStore.list.length) {
    list.innerHTML = '<li class="empty">No local folders yet.</li>';
    return;
  }
  list.innerHTML = LibraryStore.list.map((l) => {
    const problems = l.files.filter((f) => f.status !== 'ok');
    const okCount = l.files.length - problems.length;
    const topicIds = new Set(l.topics);
    return `<li><details class="topic-item lib-item${l.enabled ? '' : ' off'}" data-lib="${esc(l.id)}"${openIds.has(l.id) ? ' open' : ''}>
      <summary>
        <span class="topic-name">${esc(l.name)}</span>
        <span class="acc-meta">${okCount} file${okCount === 1 ? '' : 's'}, ${l.passageCount} passages${l.enabled ? '' : ', switched off'}</span>
      </summary>
      <div class="topic-body">
        <label class="check"><input type="checkbox" data-lib-enabled${l.enabled ? ' checked' : ''}><span>Search this folder</span></label>
        <fieldset class="checks"><legend>Topics</legend>
          <div class="check-list">${SourceStore.topics.map((t) => `<label class="check"><input type="checkbox" data-lib-topic value="${esc(t.id)}"${topicIds.has(t.id) ? ' checked' : ''}><span>${esc(t.name)}</span></label>`).join('') || '<p class="muted">No topics yet.</p>'}</div>
        </fieldset>
        <p class="source-domain">Added ${new Date(l.addedAt).toLocaleDateString()}, last read ${new Date(l.updatedAt).toLocaleString()}.${l.skippedOther ? ` ${l.skippedOther} other file${l.skippedOther === 1 ? '' : 's'} ignored (not PDF, DOCX, TXT or MD).` : ''}</p>
        ${problems.length ? `<p class="lib-problems-title">${problems.length} file${problems.length === 1 ? '' : 's'} couldn't be used:</p><ul class="member-list problems">${problems.map((f) => `<li>${esc(f.path)} <span class="muted">${esc(f.message || STATUS_TEXT[f.status])}</span></li>`).join('')}</ul>` : ''}
        <details class="file-list"><summary>Show all ${l.files.length} files</summary>
          <ul class="member-list">${l.files.map((f) => `<li class="${f.status === 'ok' ? '' : 'off'}">${esc(f.path)} <span class="muted">${f.status === 'ok' ? `${f.passages} passage${f.passages === 1 ? '' : 's'}` : esc(f.message || STATUS_TEXT[f.status])}</span></li>`).join('')}</ul>
        </details>
        <div class="row-actions">
          ${l.canRescan ? '<button type="button" class="btn quiet" data-lib-rescan>Rescan</button>' : ''}
          <button type="button" class="btn quiet" data-lib-rename>Rename</button>
          <button type="button" class="btn quiet danger" data-lib-remove>Remove</button>
        </div>
      </div>
    </details></li>`;
  }).join('');

  list.querySelectorAll('details[data-lib]').forEach((d) => {
    const id = d.dataset.lib;
    $('[data-lib-enabled]', d).addEventListener('change', async (e) => { await LibraryStore.update(id, { enabled: e.target.checked }); refreshAll(); });
    d.querySelectorAll('[data-lib-topic]').forEach((c) => c.addEventListener('change', async () => {
      await LibraryStore.update(id, { topics: [...d.querySelectorAll('[data-lib-topic]:checked')].map((x) => x.value) });
      refreshAll();
    }));
    const rescanBtn = $('[data-lib-rescan]', d);
    if (rescanBtn) rescanBtn.addEventListener('click', () => withLocalProgress(async (progress) => {
      const lib = LibraryStore.get(id);
      const updated = await TracerLocal.rescan(lib, progress);
      await LibraryStore.put({ ...updated, topics: lib.topics, enabled: lib.enabled, name: lib.name });
      return `${updated.name} rescanned: ${updated.passageCount} passages.`;
    }));
    $('[data-lib-rename]', d).addEventListener('click', async () => {
      const lib = LibraryStore.get(id);
      const name = prompt('New name for this folder:', lib.name);
      if (name && name.trim()) { await LibraryStore.update(id, { name: name.trim().slice(0, 80) }); refreshAll(); }
    });
    $('[data-lib-remove]', d).addEventListener('click', async () => {
      const lib = LibraryStore.get(id);
      if (!confirm(`Remove ${lib.name}? Its stored text is deleted from this device. Your actual files are not touched.`)) return;
      await LibraryStore.remove(id);
      refreshAll();
    });
  });
}

let localBusy = false;
async function withLocalProgress(task) {
  if (localBusy) return;
  localBusy = true;
  const status = $('#local-progress');
  const buttons = document.querySelectorAll('#add-folder, #files-input, [data-lib-rescan]');
  $('#busy-bar').hidden = false;
  buttons.forEach((b) => { b.disabled = true; });
  status.classList.remove('error');
  const progress = (done, total, path) => {
    status.innerHTML = `<span class="spinner small" aria-hidden="true"></span> Reading ${done} of ${total}: ${esc(path)}
      <progress max="${total}" value="${done - 1}" aria-label="Files read">${done - 1} of ${total}</progress>`;
  };
  try {
    const message = await task(progress);
    status.textContent = message || '';
    refreshAll();
  } catch (err) {
    if (err && err.name === 'AbortError') status.textContent = '';
    else { status.classList.add('error'); status.textContent = err.message || 'Something went wrong while reading the files.'; }
  } finally {
    localBusy = false;
    if (!ui.controller) $('#busy-bar').hidden = true;
    buttons.forEach((b) => { b.disabled = false; });
  }
}

function addFolder() {
  if (!TracerLocal.canPickFolder()) { $('#folder-input').click(); return; }
  withLocalProgress(async (progress) => {
    const lib = await TracerLocal.addFolderWithPicker(progress);
    await LibraryStore.put({ ...lib, topics: selectedTopicId() ? [selectedTopicId()] : [] });
    return describeAdded(lib);
  });
}

function addFromInput(e, fallbackName) {
  const files = e.target.files;
  withLocalProgress(async (progress) => {
    const lib = await TracerLocal.addFromFileList(files, progress, fallbackName);
    e.target.value = '';
    if (!lib) return '';
    await LibraryStore.put({ ...lib, topics: selectedTopicId() ? [selectedTopicId()] : [] });
    return describeAdded(lib);
  });
}

function describeAdded(lib) {
  const ok = lib.files.filter((f) => f.status === 'ok').length;
  const bad = lib.files.length - ok;
  const topic = SourceStore.topic(selectedTopicId());
  return `Added “${lib.name}”: ${ok} file${ok === 1 ? '' : 's'}, ${lib.passageCount} passages.${bad ? ` ${bad} file${bad === 1 ? '' : 's'} couldn't be used; see the list below.` : ''}${topic ? ` Mapped to ${topic.name}.` : ''}`;
}
