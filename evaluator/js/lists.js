/* Evaluator: lists.js
 *
 * Community source lists: topics with their trusted websites, made by
 * people and shared with others, like starter packs that anyone can write.
 *
 *  - Share a topic as a list: a link (#list=) or a .json file.
 *  - Open a list from a link, a file or a web address. You always see every
 *    website first, and nothing is added until you press Add.
 *  - Catalogues: index files that list many lists (community/index.json
 *    comes with the app; more can be added in Settings, or by whoever hosts
 *    this copy in config.js). When a list you added is updated in its
 *    catalogue, Settings offers the update.
 *
 * A list is { kind: 'evaluator-list', v: 1, id, name, description, author,
 * language, updated, exampleClaim, topic: { name, description },
 * sources: [{ domain, label, category, notes }] }. See community/README.md.
 * Everything from outside is rebuilt field by field before it is shown.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

const LISTS_KEY = 'evaluator.lists.v1';
const BUILTIN_CATALOGUE = 'community/index.json';
const listRecords = () => local.get(LISTS_KEY, {}) || {};

/* ---------- Cleaning what arrives ---------- */
const LIST_ID = /^[a-z0-9-]{3,64}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function cleanList(d) {
  if (!d || d.kind !== 'evaluator-list') throw new Error(tr('This isn\'t an Evaluator source list.'));
  const name = S(d.name, 60).trim();
  if (!name) throw new Error(tr('This isn\'t an Evaluator source list.'));
  const id = LIST_ID.test(String(d.id || '')) ? d.id : fileSlug(name, 'list').slice(0, 64);
  const seen = new Set();
  const sources = A(d.sources, 60).map((s) => {
    try {
      const domain = normalizeDomain(S(s && s.domain, 255));
      if (seen.has(domain)) return null;
      seen.add(domain);
      return { domain, label: S(s && s.label, 120).trim() || domain, category: E(s && s.category, CATEGORIES, 'other'), notes: S(s && s.notes, 500).trim() };
    } catch { return null; }
  }).filter(Boolean);
  if (!sources.length) throw new Error(tr('This list has no websites that could be read.'));
  const t = d.topic && typeof d.topic === 'object' ? d.topic : {};
  return {
    kind: 'evaluator-list', v: 1, id, name,
    description: S(d.description, 400).trim(), author: S(d.author, 80).trim(), language: S(d.language, 40).trim(),
    updated: ISO_DAY.test(String(d.updated || '')) ? d.updated : '',
    exampleClaim: S(d.exampleClaim, 300).trim(),
    topic: { name: S(t.name, 60).trim() || name, description: S(t.description, 200).trim() },
    sources,
  };
}

function cleanCatalogue(d, baseUrl) {
  if (!d || d.kind !== 'evaluator-list-index') throw new Error(tr('That address isn\'t a catalogue of Evaluator lists.'));
  return {
    name: S(d.name, 80).trim() || new URL(baseUrl, location.href).host,
    updated: ISO_DAY.test(String(d.updated || '')) ? d.updated : '',
    lists: A(d.lists, 200).map((x) => {
      let url = '';
      try { url = new URL(S(x && x.url, 500), new URL(baseUrl, location.href)).href; } catch { return null; }
      if (!/^https:\/\//.test(url) && new URL(url).origin !== location.origin) return null;
      return {
        id: LIST_ID.test(String(x.id || '')) ? x.id : '', name: S(x.name, 60).trim(), description: S(x.description, 400).trim(),
        author: S(x.author, 80).trim(), language: S(x.language, 40).trim(), updated: ISO_DAY.test(String(x.updated || '')) ? x.updated : '',
        count: N(x.count, 0, 60), url,
      };
    }).filter((x) => x && x.id && x.name),
  };
}

/** Fetches JSON from this app or an https:// address: no cookies, at most 1 MB. */
async function fetchJson(url) {
  let u;
  try { u = new URL(url, location.href); } catch { throw new Error(tr('That isn\'t a web address. It should start with https://')); }
  if (u.origin !== location.origin && u.protocol !== 'https:') throw new Error(tr('That isn\'t a web address. It should start with https://'));
  let res;
  try { res = await fetch(u.href, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache' }); } catch {
    throw new Error(tr('Couldn\'t load {url}. Check the address and your connection. The site must allow apps to read the file (GitHub and most file hosts do).', { url: u.host }));
  }
  if (!res.ok) throw new Error(tr('Couldn\'t load {url} (error {status}).', { url: u.host, status: res.status }));
  const text = await res.text();
  if (text.length > 1e6) throw new Error(tr('That file is too large.'));
  try { return JSON.parse(text); } catch { throw new Error(tr('That address doesn\'t contain an Evaluator list or catalogue.')); }
}

/* ---------- Catalogues ---------- */
function catalogueUrls() {
  const own = (SettingsFile.data && SettingsFile.data.listCatalogs) || [];
  const hosted = window.HOSTED && Array.isArray(HOSTED.listCatalogs) ? HOSTED.listCatalogs.filter((u) => /^https:\/\/\S+$/i.test(String(u))) : [];
  return [{ url: BUILTIN_CATALOGUE, kind: 'builtin' }, ...hosted.map((url) => ({ url, kind: 'hosted' })), ...own.map((url) => ({ url, kind: 'own' }))]
    .filter((c, i, all) => all.findIndex((x) => x.url === c.url) === i);
}

const catalogueCache = new Map();
async function loadCatalogue(url, fresh = false) {
  if (!fresh && catalogueCache.has(url)) return catalogueCache.get(url);
  const c = cleanCatalogue(await fetchJson(url), url);
  catalogueCache.set(url, c);
  return c;
}

/* ---------- Installing ---------- */
const listTopicId = (l) => `t-list-${l.id}`.slice(0, 64);

/** Which of a list's websites you already have, and whether the list's topic exists. */
function listState(l) {
  const rec = listRecords()[l.id];
  const topic = SourceStore.topic(rec ? rec.topicId : listTopicId(l)) || SourceStore.packTopic({ topic: { id: listTopicId(l), name: l.topic.name } });
  const have = new Set(SourceStore.list.map((s) => s.domain));
  const mapped = topic ? l.sources.filter((s) => { const x = SourceStore.list.find((y) => y.domain === s.domain); return x && x.topics.includes(topic.id); }).length : 0;
  return { rec, topic, newSites: l.sources.filter((s) => !have.has(s.domain)), mapped };
}

function installList(l, url = '') {
  const r = SourceStore.installPack({ topic: { id: listTopicId(l), name: l.topic.name, description: l.topic.description || l.description.slice(0, 200) }, sources: l.sources });
  const recs = listRecords();
  recs[l.id] = { name: l.name, updated: l.updated, url, topicId: r.topic.id, addedAt: (recs[l.id] && recs[l.id].addedAt) || new Date().toISOString() };
  local.set(LISTS_KEY, recs);
  refreshAll();
  return r;
}

/** Shows every website in a list before anything is added. */
function previewList(l, { url = '', from = '' } = {}) {
  const st = listState(l);
  const isUpdate = Boolean(st.rec);
  toolDialog(isUpdate ? tr('Update this list?') : tr('Add this source list?'), `
    <p class="list-title"><strong translate="no">${esc(l.name)}</strong>${l.author ? ` <span class="muted">${tr('by {author}', { author: `<span translate="no">${esc(l.author)}</span>` })}</span>` : ''}${l.updated ? ` <span class="muted">${tr('updated {date}', { date: esc(fmtDate(l.updated)) })}</span>` : ''}</p>
    ${l.description ? `<p translate="no">${esc(l.description)}</p>` : ''}
    ${from ? `<p class="hint">${tr('From: {where}', { where: `<span translate="no">${esc(from)}</span>` })}</p>` : ''}
    <p class="notice">${tr('Lists are made by other people. Look through the websites below: only add the list if you would trust each of them for this topic. You can switch any of them off later.')}</p>
    <h3 class="setup-sub">${trn(l.sources.length, '{n} website', '{n} websites')}${st.newSites.length && st.newSites.length < l.sources.length ? ` <span class="muted">(${trn(st.newSites.length, '{n} new to you', '{n} new to you')})</span>` : ''}</h3>
    <ul class="list-sites">${l.sources.map((s) => `<li${st.newSites.includes(s) ? ' class="is-new"' : ''}><strong translate="no">${esc(s.label)}</strong> <span class="muted" translate="no">${esc(s.domain)}</span> <span class="tag">${esc(CATEGORY_NAMES[s.category] || s.category)}</span>${st.newSites.includes(s) && st.newSites.length < l.sources.length ? ` <span class="tag ok">${tr('New')}</span>` : ''}${s.notes ? `<br><span class="hint" translate="no">${esc(s.notes)}</span>` : ''}</li>`).join('')}</ul>
    <p class="hint">${tr('Adding creates the topic {topic} (or adds to it). Websites you already have are mapped to it, not added twice. Nothing is removed.', { topic: `<strong translate="no">${esc(l.topic.name)}</strong>` })}</p>
    <div class="setup-actions">
      <button type="button" class="btn primary" data-list-add data-autofocus>${isUpdate ? tr('Update') : tr('Add list')}</button>
      <button type="button" class="btn quiet" data-list-cancel>${tr('Not now')}</button>
    </div>`, (body, dlg) => {
    body.querySelector('[data-list-cancel]').addEventListener('click', () => dlg.close());
    body.querySelector('[data-list-add]').addEventListener('click', () => {
      try {
        const r = installList(l, url);
        dlg.close();
        const bits = [];
        if (r.added) bits.push(trn(r.added, '{n} website added', '{n} websites added'));
        if (r.linked) bits.push(trn(r.linked, '{n} you already had was mapped to it', '{n} you already had were mapped to it'));
        listMessage(tr('“{name}” is ready as a topic: {details}.', { name: esc(l.topic.name), details: bits.join('; ') || tr('nothing new was needed') }));
        renderLists();
      } catch (err) { alert(err.message); }
    });
  });
}

function listMessage(html, isError = false) {
  const box = $('#list-msg');
  if (!box) return;
  box.className = isError ? 'form-error' : 'form-error ok';
  box.innerHTML = html;
  const acc = $('#acc-lists');
  if (acc && !isError) acc.open = true;
}

/* ---------- Receiving ---------- */
async function receiveList(code) {
  location.hash = '#settings';
  try { previewList(cleanList(await unpackData(code)), { from: tr('a shared link') }); } catch (err) { listMessage(esc(err.message), true); }
}

async function openListUrl(url) {
  const d = await fetchJson(url);
  if (d && d.kind === 'evaluator-list-index') {
    // A catalogue: keep it, so its lists show up below.
    const abs = new URL(url, location.href).href;
    const own = (SettingsFile.data.listCatalogs || []).filter((u) => u !== abs);
    SettingsFile.update({ listCatalogs: [...own, abs] });
    catalogueCache.delete(abs);
    listMessage(tr('Catalogue added. Its lists are shown below.'));
    renderLists();
    return;
  }
  previewList(cleanList(d), { url: new URL(url, location.href).href, from: new URL(url, location.href).host });
}

async function importListFile(file) {
  if (file.size > 1e6) throw new Error(tr('That file is too large.'));
  let d;
  try { d = JSON.parse(await file.text()); } catch { throw new Error(tr('This file isn\'t an Evaluator source list.')); }
  previewList(cleanList(d), { from: file.name });
}

/* ---------- Sharing a topic ---------- */
function topicAsList(topicId, author = '') {
  const t = SourceStore.topic(topicId);
  if (!t) return null;
  const sources = SourceStore.inTopic(t.id).filter((s) => s.enabled).map((s) => ({ domain: s.domain, label: s.label, category: s.category, notes: s.notes || '' }));
  return {
    kind: 'evaluator-list', v: 1, id: fileSlug(tr(t.name), 'list').slice(0, 64), name: tr(t.name).slice(0, 60),
    description: tr(t.description || '').slice(0, 400), author, language: I18N.lang, updated: new Date().toISOString().slice(0, 10),
    topic: { name: tr(t.name).slice(0, 60), description: tr(t.description || '').slice(0, 200) }, sources,
  };
}

function shareTopic(topicId) {
  const t = SourceStore.topic(topicId);
  if (!t) return;
  const n = SourceStore.inTopic(t.id).filter((s) => s.enabled).length;
  if (!n) { alert(tr('That topic has no websites switched on. Add some in Settings › Trusted sources.')); return; }
  let author = '';
  try { author = localStorage.getItem('evaluator.listAuthor') || localStorage.getItem('evaluator.teacherName') || ''; } catch { /* ignore */ }
  toolDialog(tr('Share this topic as a list'), `
    <p>${tr('Others can add the {n} websites switched on in {topic}, with your notes on each, to their own trusted sources. Local folders are never included.', { n: trn(n, '{n} website', '{n} websites'), topic: `<strong translate="no">${esc(tr(t.name))}</strong>` })}</p>
    <label class="field-label" for="list-author">${tr('Your name or organisation (optional, shown with the list)')}</label>
    <input id="list-author" type="text" maxlength="80" value="${esc(author)}" data-autofocus>
    <div class="setup-actions"><button type="button" class="btn primary" data-list-make>${icon('share')}<span>${tr('Make the list')}</span></button></div>
    <p class="hint">${tr('To have it listed in a catalogue for everyone, send the file to whoever looks after that catalogue. See Help › Community source lists.')}</p>`, (body) => {
    body.querySelector('[data-list-make]').addEventListener('click', () => {
      const a = body.querySelector('#list-author').value.trim().slice(0, 80);
      try { localStorage.setItem('evaluator.listAuthor', a); } catch { /* ignore */ }
      const l = topicAsList(topicId, a);
      sendDialog(tr('Share this topic as a list'), l, `${l.id}.json`, tr('Anyone who opens this sees every website first, and chooses whether to add them.'));
    });
  });
}

/* ---------- Settings › Community lists ---------- */
async function renderLists() {
  const box = $('#list-catalogues');
  if (!box) return;
  const cats = catalogueUrls();
  const recs = listRecords();
  box.innerHTML = cats.map((c, i) => `<section class="list-cat" data-cat="${i}"><p class="hint"><span class="spinner small" aria-hidden="true"></span> ${tr('Loading…')}</p></section>`).join('');
  let shown = 0, updates = 0;
  await Promise.all(cats.map(async (c, i) => {
    const sec = box.querySelector(`[data-cat="${i}"]`);
    try {
      const cat = await loadCatalogue(c.url);
      shown += cat.lists.length;
      sec.innerHTML = `<h3 class="list-cat-name"><span translate="no">${esc(c.kind === 'builtin' ? tr(cat.name) : cat.name)}</span> <span class="muted small">${c.kind === 'builtin' ? tr('comes with the app') : c.kind === 'hosted' ? tr('added by whoever runs this copy of the app') : `<span translate="no">${esc(new URL(c.url).host)}</span>`}</span>
        ${c.kind === 'own' ? `<button type="button" class="btn ghost small" data-cat-remove="${esc(c.url)}">${tr('Remove')}</button>` : ''}</h3>
        <ul class="pack-list">${cat.lists.map((l) => {
          const rec = recs[l.id];
          const update = rec && l.updated && rec.updated && l.updated > rec.updated;
          if (update) updates++;
          return `<li class="pack-card${rec ? ' is-added' : ''}">
            <div class="pack-main">
              <p class="pack-name"><span translate="no">${esc(l.name)}</span> ${update ? `<span class="tag">${tr('Update available')}</span>` : rec ? `<span class="tag ok">${tr('Added')}</span>` : ''}</p>
              <p class="hint"><span translate="no">${esc(l.description)}</span> <em>${[l.author && tr('By {author}.', { author: `<span translate="no">${esc(l.author)}</span>` }), l.count && trn(l.count, '{n} website.', '{n} websites.'), l.updated && tr('Updated {date}.', { date: esc(fmtDate(l.updated)) })].filter(Boolean).join(' ')}</em></p>
            </div>
            <div class="pack-actions"><button type="button" class="btn ${rec && !update ? 'quiet' : 'primary'}" data-list-open="${esc(l.url)}">${update ? tr('See the update') : rec ? tr('Look again') : tr('Look and add')}</button></div>
          </li>`;
        }).join('') || `<li class="hint">${tr('This catalogue has no lists yet.')}</li>`}</ul>`;
    } catch (err) {
      sec.innerHTML = `<h3 class="list-cat-name"><span translate="no">${esc(c.url)}</span>${c.kind === 'own' ? ` <button type="button" class="btn ghost small" data-cat-remove="${esc(c.url)}">${tr('Remove')}</button>` : ''}</h3><p class="form-error">${esc(err.message)}</p>`;
    }
  }));
  const meta = $('#meta-lists');
  if (meta) meta.textContent = updates ? trn(updates, '{n} update', '{n} updates') : tr('{n} added', { n: Object.keys(recs).length });
  box.querySelectorAll('[data-list-open]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await openListUrl(b.dataset.listOpen); } catch (err) { listMessage(esc(err.message), true); }
    b.disabled = false;
  }));
  box.querySelectorAll('[data-cat-remove]').forEach((b) => b.addEventListener('click', () => {
    SettingsFile.update({ listCatalogs: (SettingsFile.data.listCatalogs || []).filter((u) => u !== b.dataset.catRemove) });
    renderLists();
  }));
  return shown;
}

function initLists() {
  const acc = $('#acc-lists');
  if (!acc) return;
  let loaded = false;
  acc.addEventListener('toggle', () => { if (acc.open && !loaded) { loaded = true; renderLists(); } });
  if (acc.open) { loaded = true; renderLists(); }
  $('#list-url-go').addEventListener('click', async () => {
    const u = $('#list-url').value.trim();
    if (!u) { $('#list-url').focus(); return; }
    const b = $('#list-url-go'); b.disabled = true;
    try { await openListUrl(u); $('#list-url').value = ''; } catch (err) { listMessage(esc(err.message), true); }
    b.disabled = false;
  });
  $('#list-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#list-url-go').click(); } });
  $('#list-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) try { await importListFile(f); } catch (err) { listMessage(esc(err.message), true); }
  });
}
