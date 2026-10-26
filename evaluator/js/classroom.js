/* Evaluator: classroom.js
 *
 * Class mode, without accounts or a server.
 *
 *  Teacher: makes an assignment (title, instructions, a topic with its
 *  trusted websites, the claims to check and the mode) and sends it as a
 *  link or a file.
 *
 *  Student: opens the link, which adds the topic and websites to their
 *  trusted sources. They check each claim with their own keys, write their
 *  own conclusion for each, and send back a submission (link or file) with
 *  their results.
 *
 *  Teacher: opens the submissions; a grid shows every student's verdict
 *  per claim, and each result opens read only.
 *
 * Everything is kept on each person's device (localStorage). Assignments
 * and submissions from links or files are untrusted and are rebuilt field
 * by field before use.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

const CLASS_KEY = 'evaluator.class.v1';
const CLASS_MODES = ['any', ...MODES];
const classData = () => {
  const d = local.get(CLASS_KEY, null) || {};
  return { teaching: Array.isArray(d.teaching) ? d.teaching : [], learning: Array.isArray(d.learning) ? d.learning : [], submissions: d.submissions && typeof d.submissions === 'object' ? d.submissions : {}, name: S(d.name, 80) };
};
const saveClass = (d) => { if (!local.set(CLASS_KEY, d)) alert(tr('This device\'s storage is full. Remove some Recent results or old assignments and try again.')); };

/* ---------- Cleaning what arrives ---------- */
function cleanAssignment(a) {
  if (!a || a.kind !== 'evaluator-assignment') throw new Error(tr('This isn\'t an Evaluator assignment.'));
  const id = typeof a.id === 'string' && /^[\w-]{4,64}$/.test(a.id) ? a.id : uid();
  const title = S(a.title, 120).trim();
  if (!title) throw new Error(tr('This isn\'t an Evaluator assignment.'));
  const t = a.topic || {};
  const sources = A(a.sources, 60).map((s) => {
    try { return { domain: normalizeDomain(S(s && s.domain, 255)), label: S(s && s.label, 120), category: E(s && s.category, CATEGORIES, 'other'), notes: S(s && s.notes, 500) }; } catch { return null; }
  }).filter(Boolean);
  return {
    kind: 'evaluator-assignment', v: 1, id, title, teacher: S(a.teacher, 80).trim(), instructions: S(a.instructions, 2000).trim(),
    mode: E(a.mode, CLASS_MODES, 'any'),
    claims: A(a.claims, BATCH_MAX).map((c) => S(typeof c === 'string' ? c : c && c.text, 600).trim()).filter((c) => c.length >= 10),
    topic: { id: `t-class-${id}`.slice(0, 64), name: S(t.name, 60).trim() || title.slice(0, 60), description: S(t.description, 200) },
    sources,
    createdAt: Number.isFinite(Date.parse(a.createdAt)) ? new Date(a.createdAt).toISOString() : new Date().toISOString(),
  };
}

function cleanSubmission(s) {
  if (!s || s.kind !== 'evaluator-submission') throw new Error(tr('This isn\'t an Evaluator submission.'));
  const answers = A(s.answers, BATCH_MAX).map((x) => {
    let result = null;
    try { result = x && x.result ? sanitizeResult(x.result) : null; } catch { result = null; }
    return { claim: N(x && x.claim, 0, BATCH_MAX - 1), note: S(x && x.note, 1000), result };
  });
  return {
    kind: 'evaluator-submission', v: 1, assignmentId: S(s.assignmentId, 64), assignmentTitle: S(s.assignmentTitle, 120), student: S(s.student, 80).trim() || tr('Unnamed student'),
    createdAt: Number.isFinite(Date.parse(s.createdAt)) ? new Date(s.createdAt).toISOString() : new Date().toISOString(), answers,
  };
}

/* ---------- Student: matching their results to the claims ---------- */
function resultFor(assignment, i) {
  const text = assignment.claims[i].trim();
  return readHistory().find((h) => (h.statement || '').trim() === text && (assignment.mode === 'any' || (h.mode || h.stance) === assignment.mode)) || null;
}

function modeName(m) { return m === 'any' ? tr('Your choice') : MODE_LABEL[m]; }

/* ---------- Receiving links and files ---------- */
async function receiveAssignment(code) {
  try { showJoin(cleanAssignment(await unpackData(code))); } catch (err) { classMessage(err.message, true); }
}

async function receiveSubmission(code) {
  try { storeSubmission(cleanSubmission(await unpackData(code))); } catch (err) { classMessage(err.message, true); }
}

function storeSubmission(sub) {
  const d = classData();
  const list = d.submissions[sub.assignmentId] || [];
  const i = list.findIndex((x) => x.student.toLowerCase() === sub.student.toLowerCase());
  if (i !== -1) list[i] = sub; else list.push(sub);
  d.submissions[sub.assignmentId] = list;
  saveClass(d);
  const known = d.teaching.some((a) => a.id === sub.assignmentId);
  classMessage(known
    ? tr('Added the submission from {student}.', { student: esc(sub.student) })
    : tr('Added the submission from {student}, for “{title}”, an assignment not made on this device.', { student: esc(sub.student), title: esc(sub.assignmentTitle) }));
  renderClass();
}

function showJoin(a) {
  const d = classData();
  const already = d.learning.find((x) => x.assignment.id === a.id);
  toolDialog(tr('Join this assignment?'), `
    <p class="class-join-title" translate="no"><strong>${esc(a.title)}</strong></p>
    ${a.teacher ? `<p>${tr('From {teacher}.', { teacher: `<span translate="no">${esc(a.teacher)}</span>` })}</p>` : ''}
    ${a.instructions ? `<p class="class-instructions" translate="no">${esc(a.instructions)}</p>` : ''}
    <p>${trn(a.claims.length, '{n} claim to check', '{n} claims to check')}, ${tr('mode: {mode}.', { mode: esc(modeName(a.mode)) })}</p>
    <p>${tr('Joining adds the topic {topic} with {n} to your trusted sources. Nothing you have is removed.', { topic: `<strong translate="no">${esc(a.topic.name)}</strong>`, n: trn(a.sources.length, '{n} website', '{n} websites') })}</p>
    ${already ? `<p class="hint">${tr('You have joined this assignment before. Joining again updates it and keeps your work.')}</p>` : ''}
    <div class="setup-actions"><button type="button" class="btn primary" data-join data-autofocus>${tr('Join')}</button><button type="button" class="btn quiet" data-cancel>${tr('Not now')}</button></div>`, (body, dlg) => {
    body.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
    body.querySelector('[data-join]').addEventListener('click', () => {
      let added = 0;
      if (a.sources.length) {
        try { added = SourceStore.installPack({ topic: a.topic, sources: a.sources }).added; } catch (err) { alert(err.message); return; }
      }
      const d2 = classData();
      const prev = d2.learning.find((x) => x.assignment.id === a.id);
      if (prev) prev.assignment = a; else d2.learning.unshift({ assignment: a, joinedAt: new Date().toISOString(), notes: {} });
      saveClass(d2);
      dlg.close();
      if (typeof renderTopicPicker === 'function') { renderTopicPicker(); renderScope(); }
      location.hash = '#class';
      route();
      renderClass();
      classMessage(added
        ? tr('Joined “{title}”. {n} added to your trusted sources.', { title: esc(a.title), n: trn(added, '{n} website', '{n} websites') })
        : tr('Joined “{title}”. Its websites were already in your trusted sources.', { title: esc(a.title) }));
    });
  });
}

async function importClassFile(file) {
  try {
    if (file.size > 5e6) throw new Error(tr('That file is too large.'));
    const data = JSON.parse(await file.text());
    if (data && data.kind === 'evaluator-assignment') { location.hash = '#class'; route(); showJoin(cleanAssignment(data)); }
    else if (data && data.kind === 'evaluator-submission') storeSubmission(cleanSubmission(data));
    else if (Array.isArray(data) && data.every((x) => x && x.kind === 'evaluator-submission')) data.slice(0, 200).forEach((x) => storeSubmission(cleanSubmission(x)));
    else throw new Error(tr('This file isn\'t an Evaluator assignment or submission.'));
  } catch (err) {
    classMessage(err instanceof SyntaxError ? tr('This file isn\'t an Evaluator assignment or submission.') : err.message, true);
  }
}

function classMessage(html, isError = false) {
  const box = $('#class-msg');
  if (!box) return;
  box.innerHTML = html;
  box.classList.toggle('error', isError);
}

/* ---------- Sending ---------- */
async function sendDialog(title, obj, fileName, intro) {
  const code = await packData(obj);
  const link = appLink({ 'evaluator-assignment': 'class', 'evaluator-submission': 'submission', 'evaluator-list': 'list' }[obj.kind], code);
  const fits = link.length <= LINK_SOFT_LIMIT;
  toolDialog(title, `<p>${intro}</p>
    ${fits ? `<label class="field-label" for="send-link">${tr('Link')}</label><textarea id="send-link" class="share-link" rows="3" readonly translate="no">${esc(link)}</textarea>`
    : `<p class="notice">${tr('This is too much to fit in a link, so send the file instead (by email, a class group or a shared drive).')}</p>`}
    <div class="setup-actions">
      ${fits ? `<button type="button" class="btn primary" data-copy data-autofocus>${icon('copy')}<span>${tr('Copy link')}</span></button>` : ''}
      ${fits && navigator.share ? `<button type="button" class="btn quiet" data-native>${icon('share')}<span>${tr('Share…')}</span></button>` : ''}
      <button type="button" class="btn ${fits ? 'quiet' : 'primary'}" data-file${fits ? '' : ' data-autofocus'}>${icon('download')}<span>${tr('Download file')}</span></button>
    </div>`, (body) => {
    const c = body.querySelector('[data-copy]');
    if (c) c.addEventListener('click', (e) => copyWithFeedback(e.currentTarget, link));
    const n = body.querySelector('[data-native]');
    if (n) n.addEventListener('click', () => navigator.share({ title: obj.title || obj.assignmentTitle || obj.name || 'Evaluator', url: link }).catch(() => {}));
    body.querySelector('[data-file]').addEventListener('click', () => downloadText(fileName, JSON.stringify(obj, null, 1), 'application/json'));
  });
}

function submitWork(a) {
  const d = classData();
  const entry = d.learning.find((x) => x.assignment.id === a.id);
  const name = ($('#class-name') && $('#class-name').value.trim()) || d.name;
  if (!name) { classMessage(tr('Write your name first, so your teacher knows whose work it is.'), true); const n = $('#class-name'); if (n) n.focus(); return; }
  const answers = a.claims.map((c, i) => {
    const r = resultFor(a, i);
    return { claim: i, note: (entry && entry.notes && entry.notes[i]) || '', result: r ? compactResult(r) : null };
  });
  if (!answers.some((x) => x.result || x.note)) { classMessage(tr('Check at least one claim before sending your work.'), true); return; }
  const sub = { kind: 'evaluator-submission', v: 1, assignmentId: a.id, assignmentTitle: a.title, student: name, createdAt: new Date().toISOString(), answers };
  if (entry) { entry.submittedAt = sub.createdAt; saveClass(d); }
  sendDialog(tr('Send your work'), sub, `${fileSlug(a.title, 'assignment')}-${fileSlug(name, 'work')}.json`,
    tr('Send this to your teacher. It holds your results and your conclusions for {n}.', { n: trn(answers.filter((x) => x.result).length, '{n} claim', '{n} claims') }));
  renderClass();
}

/* ---------- Teacher: creating ---------- */
function createAssignment(form) {
  const title = form.querySelector('#ca-title').value.trim();
  const claims = form.querySelector('#ca-claims').value.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((l) => l.length >= 10);
  const topicId = form.querySelector('#ca-topic').value;
  const err = (m, el) => { classMessage(m, true); form.querySelector(el).focus(); };
  if (!title) return err(tr('Give the assignment a title.'), '#ca-title');
  if (!claims.length) return err(tr('Add at least one claim of 10 characters or more, one per line.'), '#ca-claims');
  if (claims.length > BATCH_MAX) return err(tr('An assignment can have at most {max} claims.', { max: BATCH_MAX }), '#ca-claims');
  const topic = SourceStore.topic(topicId);
  if (!topic) return err(tr('Choose the topic whose websites students should use.'), '#ca-topic');
  const sources = SourceStore.inTopic(topic.id).filter((s) => s.enabled).map((s) => ({ domain: s.domain, label: s.label, category: s.category, notes: s.notes || '' }));
  if (!sources.length) return err(tr('That topic has no websites switched on. Add some in Settings › Trusted sources.'), '#ca-topic');
  const d = classData();
  const teacher = form.querySelector('#ca-teacher').value.trim();
  d.name = d.name || '';
  const a = cleanAssignment({
    kind: 'evaluator-assignment', id: `a-${uid()}`, title, teacher, instructions: form.querySelector('#ca-instructions').value,
    mode: form.querySelector('#ca-mode').value, claims, topic: { name: tr(topic.name), description: tr(topic.description || '') }, sources, createdAt: new Date().toISOString(),
  });
  d.teaching.unshift(a);
  d.teacherName = teacher;
  saveClass(d);
  try { localStorage.setItem('evaluator.teacherName', teacher); } catch { /* ignore */ }
  form.reset();
  renderClass();
  sendDialog(tr('Send the assignment'), a, `${fileSlug(a.title, 'class')}-assignment.json`, tr('Send this to your students. Opening it adds the topic and its websites to their trusted sources and lists the claims to check. They use their own free keys.'));
}

/* ---------- Page ---------- */
function verdictCell(r) {
  if (!r) return `<span class="muted">${tr('Not done')}</span>`;
  return `<span class="tone ${verdictTone(r.mode, r.verdict)}">${esc(verdictText(r.mode, r.verdict))}</span>`;
}

function studentHtml(entry, d) {
  const a = entry.assignment;
  const rows = a.claims.map((c, i) => {
    const r = resultFor(a, i);
    const note = (entry.notes && entry.notes[i]) || '';
    return `<li class="class-claim">
      <p class="class-claim-text" translate="no">${esc(c)}</p>
      <p class="class-claim-state">${verdictCell(r)} ${r
        ? `<button type="button" class="btn quiet small" data-c-open="${esc(a.id)}" data-i="${i}">${tr('Open')}</button>`
        : `<button type="button" class="btn primary small" data-c-start="${esc(a.id)}" data-i="${i}">${tr('Check it')}</button>`}</p>
      <label class="field-label" for="note-${esc(a.id)}-${i}">${tr('Your conclusion, in your own words')}</label>
      <textarea id="note-${esc(a.id)}-${i}" rows="2" data-c-note="${esc(a.id)}" data-i="${i}" maxlength="1000">${esc(note)}</textarea>
    </li>`;
  }).join('');
  const done = a.claims.filter((c, i) => resultFor(a, i)).length;
  return `<details class="acc class-card" ${d.learning[0] === entry ? 'open' : ''}>
    <summary class="acc-head"><h3 class="acc-title" translate="no">${esc(a.title)}</h3><span class="acc-meta">${tr('{done} of {n} done', { done, n: a.claims.length })}${entry.submittedAt ? `, ${tr('sent')}` : ''}</span></summary>
    <div class="acc-body">
      ${a.teacher ? `<p class="muted">${tr('From {teacher}.', { teacher: `<span translate="no">${esc(a.teacher)}</span>` })} ${tr('Mode: {mode}.', { mode: esc(modeName(a.mode)) })} ${tr('Topic: {topic}.', { topic: `<span translate="no">${esc(a.topic.name)}</span>` })}</p>` : ''}
      ${a.instructions ? `<p class="class-instructions" translate="no">${esc(a.instructions)}</p>` : ''}
      <ol class="class-claims">${rows}</ol>
      <div class="form-actions">
        <button type="button" class="btn primary" data-c-submit="${esc(a.id)}">${icon('share')}<span>${entry.submittedAt ? tr('Send again') : tr('Send my work')}</span></button>
        <button type="button" class="btn ghost" data-c-leave="${esc(a.id)}">${tr('Remove')}</button>
      </div>
      ${entry.submittedAt ? `<p class="hint">${tr('Last sent {when}.', { when: esc(fmtDateTime(entry.submittedAt)) })}</p>` : ''}
    </div></details>`;
}

function teacherHtml(a, d) {
  const subs = d.submissions[a.id] || [];
  const grid = subs.length ? `<div class="table-wrap"><table class="class-grid">
      <thead><tr><th scope="col">${tr('Student')}</th>${a.claims.map((c, i) => `<th scope="col" title="${esc(c)}">${tr('Claim {n}', { n: i + 1 })}</th>`).join('')}<th scope="col">${tr('Sent')}</th><th scope="col"><span class="visually-hidden">${tr('Remove')}</span></th></tr></thead>
      <tbody>${subs.map((s, si) => `<tr><th scope="row" translate="no">${esc(s.student)}</th>${a.claims.map((c, i) => {
        const ans = s.answers.find((x) => x.claim === i);
        if (!ans || (!ans.result && !ans.note)) return `<td><span class="muted">–</span></td>`;
        return `<td>${ans.result ? `<button type="button" class="linkish" data-s-open="${esc(a.id)}" data-s="${si}" data-i="${i}">${verdictCell(ans.result)}</button>` : ''}${ans.note ? `<p class="class-note" translate="no">${esc(ans.note)}</p>` : ''}</td>`;
      }).join('')}<td class="muted small">${esc(fmtDate(s.createdAt))}</td><td><button type="button" class="btn ghost small" data-s-del="${esc(a.id)}" data-s="${si}" aria-label="${esc(tr('Remove the submission from {student}', { student: s.student }))}">${icon('close')}</button></td></tr>`).join('')}</tbody>
    </table></div>
    <ol class="class-claim-key">${a.claims.map((c) => `<li translate="no">${esc(c)}</li>`).join('')}</ol>`
    : `<p class="muted">${tr('No submissions yet. When students send their work, open the links here, or use Open a file below.')}</p>`;
  return `<details class="acc class-card">
    <summary class="acc-head"><h3 class="acc-title" translate="no">${esc(a.title)}</h3><span class="acc-meta">${trn(subs.length, '{n} submission', '{n} submissions')}</span></summary>
    <div class="acc-body">
      <p class="muted">${trn(a.claims.length, '{n} claim', '{n} claims')}. ${tr('Mode: {mode}.', { mode: esc(modeName(a.mode)) })} ${tr('Topic: {topic}.', { topic: `<span translate="no">${esc(a.topic.name)}</span>` })} ${tr('Made {when}.', { when: esc(fmtDate(a.createdAt)) })}</p>
      ${grid}
      <div class="form-actions">
        <button type="button" class="btn quiet" data-a-send="${esc(a.id)}">${icon('share')}<span>${tr('Send to students')}</span></button>
        ${subs.length ? `<button type="button" class="btn quiet" data-a-csv="${esc(a.id)}">${icon('download')}<span>${tr('Download CSV')}</span></button>` : ''}
        <button type="button" class="btn ghost" data-a-del="${esc(a.id)}">${tr('Delete')}</button>
      </div>
    </div></details>`;
}

function orphanHtml(d) {
  const known = new Set(d.teaching.map((a) => a.id));
  const ids = Object.keys(d.submissions).filter((id) => !known.has(id) && d.submissions[id].length);
  if (!ids.length) return '';
  return `<h3>${tr('Submissions for assignments made elsewhere')}</h3><ul class="class-orphans">${ids.map((id) => {
    const subs = d.submissions[id];
    return `<li><strong translate="no">${esc(subs[0].assignmentTitle)}</strong>: ${subs.map((s, si) => `<button type="button" class="linkish" data-o-open="${esc(id)}" data-s="${si}" translate="no">${esc(s.student)}</button>`).join(', ')}</li>`;
  }).join('')}</ul>`;
}

function renderClass() {
  const root = $('#class-root');
  if (!root) return;
  const d = classData();
  const topics = SourceStore.topics.filter((t) => SourceStore.inTopic(t.id).some((s) => s.enabled));
  let teacherName = '';
  try { teacherName = localStorage.getItem('evaluator.teacherName') || ''; } catch { /* ignore */ }
  root.innerHTML = `
    <div class="ev-split-a">
    <section class="class-sec" aria-labelledby="class-learn-h">
      <h2 id="class-learn-h">${icon('school')}<span>${tr('My assignments')}</span></h2>
      ${d.learning.length ? `
        <label class="field-label" for="class-name">${tr('Your name, as your teacher knows you')}</label>
        <input id="class-name" type="text" autocomplete="name" maxlength="80" value="${esc(d.name)}">
        ${d.learning.map((e) => studentHtml(e, d)).join('')}`
        : `<p class="muted">${tr('When your teacher sends you an assignment link, open it and the assignment appears here, with the claims to check.')}</p>`}
    </section>
    <section class="class-sec" aria-labelledby="class-file-h">
      <h2 id="class-file-h">${tr('Open a file')}</h2>
      <p class="hint">${tr('An assignment or submission sent as a file. You can choose several submissions at once.')}</p>
      <label class="btn quiet file-btn">${icon('download')}<span>${tr('Choose files')}</span><input type="file" id="class-file" accept=".json,application/json" multiple></label>
    </section>
    </div><div class="ev-split-b">
    <section class="class-sec" aria-labelledby="class-teach-h">
      <h2 id="class-teach-h">${tr('For teachers')}</h2>
      ${d.teaching.map((a) => teacherHtml(a, d)).join('')}
      ${orphanHtml(d)}
      <details class="acc" id="class-new" ${d.teaching.length ? '' : 'open'}>
        <summary class="acc-head"><h3 class="acc-title">${tr('New assignment')}</h3></summary>
        <div class="acc-body">
        <form id="class-form" class="stack" novalidate>
          <p class="hint">${tr('Students get the claims, your instructions and the websites of one topic. They check each claim with their own free keys and send their results back to you.')}</p>
          <label class="field-label" for="ca-title">${tr('Title')}</label>
          <input id="ca-title" type="text" maxlength="120" required>
          <label class="field-label" for="ca-teacher">${tr('Your name (shown to students)')}</label>
          <input id="ca-teacher" type="text" maxlength="80" value="${esc(teacherName)}">
          <label class="field-label" for="ca-instructions">${tr('Instructions (optional)')}</label>
          <textarea id="ca-instructions" rows="3" maxlength="2000"></textarea>
          <label class="field-label" for="ca-topic">${tr('Topic: the websites students search')}</label>
          <select id="ca-topic"><option value="">${tr('Choose a topic')}</option>${topics.map((t) => `<option value="${esc(t.id)}">${esc(tr('{name} ({n} on)', { name: tr(t.name), n: SourceStore.inTopic(t.id).filter((s) => s.enabled).length }))}</option>`).join('')}</select>
          <label class="field-label" for="ca-claims">${tr('Claims to check, one per line (up to {max})', { max: BATCH_MAX })}</label>
          <textarea id="ca-claims" rows="5"></textarea>
          <label class="field-label" for="ca-mode">${tr('Mode')}</label>
          <select id="ca-mode">${CLASS_MODES.map((m) => `<option value="${m}"${m === 'balanced' ? ' selected' : ''}>${esc(modeName(m))}</option>`).join('')}</select>
          <div class="form-actions"><button type="submit" class="btn primary">${icon('school')}<span>${tr('Create and send')}</span></button></div>
        </form></div>
      </details>
    </section>
    </div>`;
  bindClass(root);
}

function bindClass(root) {
  const d = () => classData();
  const findLearn = (id) => d().learning.find((x) => x.assignment.id === id);
  const findTeach = (id) => d().teaching.find((x) => x.id === id);
  const name = $('#class-name', root);
  if (name) name.addEventListener('change', () => { const x = d(); x.name = name.value.trim().slice(0, 80); saveClass(x); });
  root.querySelectorAll('[data-c-start]').forEach((b) => b.addEventListener('click', () => {
    const e = findLearn(b.dataset.cStart);
    if (!e) return;
    const a = e.assignment;
    const topic = SourceStore.packTopic({ topic: a.topic });
    if (topic) { local.set(KEYS.topic, topic.id); renderTopicPicker(); renderScope(); }
    location.hash = '#trace';
    route();
    $('#statement').value = a.claims[Number(b.dataset.i)];
    const mode = a.mode === 'any' ? null : a.mode;
    setStatus(mode ? tr('Claim filled in from “{title}”. Press <strong>{mode}</strong>.', { title: esc(a.title), mode: esc(MODE_SHORT[mode]) }) : tr('Claim filled in from “{title}”. Choose the button you think fits.', { title: esc(a.title) }));
    const t = mode && document.querySelector(`button.act[value="${mode}"]`);
    if (t) { t.classList.add('suggested'); setTimeout(() => t.classList.remove('suggested'), 4000); t.focus(); } else $('#statement').focus();
  }));
  root.querySelectorAll('[data-c-open]').forEach((b) => b.addEventListener('click', () => {
    const e = findLearn(b.dataset.cOpen);
    const r = e && resultFor(e.assignment, Number(b.dataset.i));
    if (r) { location.hash = '#trace'; route(); $('#statement').value = r.statement; showResult(r); }
  }));
  root.querySelectorAll('[data-c-note]').forEach((t) => t.addEventListener('change', () => {
    const x = d();
    const e = x.learning.find((y) => y.assignment.id === t.dataset.cNote);
    if (!e) return;
    e.notes = e.notes || {};
    e.notes[t.dataset.i] = t.value.trim().slice(0, 1000);
    saveClass(x);
  }));
  root.querySelectorAll('[data-c-submit]').forEach((b) => b.addEventListener('click', () => {
    // Save any note still being typed first.
    root.querySelectorAll('[data-c-note]').forEach((t) => t.dispatchEvent(new Event('change')));
    if (name) name.dispatchEvent(new Event('change'));
    const e = findLearn(b.dataset.cSubmit);
    if (e) submitWork(e.assignment);
  }));
  root.querySelectorAll('[data-c-leave]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm(tr('Remove this assignment from this device? Your results stay in Recent results, and the websites stay in your trusted sources.'))) return;
    const x = d(); x.learning = x.learning.filter((y) => y.assignment.id !== b.dataset.cLeave); saveClass(x); renderClass();
  }));
  root.querySelectorAll('[data-a-send]').forEach((b) => b.addEventListener('click', () => {
    const a = findTeach(b.dataset.aSend);
    if (a) sendDialog(tr('Send the assignment'), a, `${fileSlug(a.title, 'class')}-assignment.json`, tr('Send this to your students. Opening it adds the topic and its websites to their trusted sources and lists the claims to check. They use their own free keys.'));
  }));
  root.querySelectorAll('[data-a-del]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm(tr('Delete this assignment and the submissions you received for it?'))) return;
    const x = d(); x.teaching = x.teaching.filter((y) => y.id !== b.dataset.aDel); delete x.submissions[b.dataset.aDel]; saveClass(x); renderClass();
  }));
  root.querySelectorAll('[data-a-csv]').forEach((b) => b.addEventListener('click', () => {
    const x = d(); const a = x.teaching.find((y) => y.id === b.dataset.aCsv); if (!a) return;
    const subs = x.submissions[a.id] || [];
    const head = ['Student', 'Sent', ...a.claims.flatMap((c, i) => [`Claim ${i + 1} result`, `Claim ${i + 1} conclusion`])];
    const rows = subs.map((s) => [s.student, s.createdAt, ...a.claims.flatMap((c, i) => { const ans = s.answers.find((y) => y.claim === i); return [ans && ans.result ? verdictText(ans.result.mode, ans.result.verdict) : '', ans ? ans.note : '']; })]);
    downloadText(`${fileSlug(a.title, 'class')}-submissions.csv`, `﻿${[head, ...rows].map((l) => l.map(csvCell).join(',')).join('\r\n')}`, 'text/csv');
  }));
  const openSub = (id, si, i) => {
    const s = (d().submissions[id] || [])[si];
    if (!s) return;
    const ans = i === undefined ? s.answers.find((y) => y.result) : s.answers.find((y) => y.claim === i);
    if (!ans || !ans.result) { classMessage(tr('{student} sent no result for that claim.', { student: esc(s.student) }), true); return; }
    location.hash = '#trace'; route();
    showResult({ ...ans.result, shared: true, sharedBy: s.student, studentNote: ans.note });
  };
  root.querySelectorAll('[data-s-open]').forEach((b) => b.addEventListener('click', () => openSub(b.dataset.sOpen, Number(b.dataset.s), Number(b.dataset.i))));
  root.querySelectorAll('[data-o-open]').forEach((b) => b.addEventListener('click', () => openSub(b.dataset.oOpen, Number(b.dataset.s))));
  root.querySelectorAll('[data-s-del]').forEach((b) => b.addEventListener('click', () => {
    const x = d(); const list = x.submissions[b.dataset.sDel] || [];
    list.splice(Number(b.dataset.s), 1); x.submissions[b.dataset.sDel] = list; saveClass(x); renderClass();
  }));
  $('#class-form', root).addEventListener('submit', (e) => { e.preventDefault(); createAssignment(e.currentTarget); });
  $('#class-file', root).addEventListener('change', async (e) => {
    for (const f of [...e.target.files]) await importClassFile(f); // eslint-disable-line no-await-in-loop
    e.target.value = '';
  });
}
