/* Evaluator: cite.js
 *
 * Two things that help people use a result's sources properly:
 *
 *  - Cite sources: reference-list entries for every source in a result, in
 *    APA 7, MLA 9, Chicago, BibTeX or RIS (for Zotero, Mendeley, EndNote).
 *    Web pages rarely give an author or date the app can trust, so entries
 *    use the page title, the website and the date the result was made as
 *    the access date. Check them against the page before handing them in.
 *
 *  - About the evidence: counts and warnings under a result (how many
 *    websites, primary or secondary, one-website cases) and the user's own
 *    notes on each website from Trusted sources.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/* =====================================================================
 * Citations
 * ===================================================================== */
const CITE_STYLES = {
  apa: { name: 'APA 7', ext: 'txt' },
  mla: { name: 'MLA 9', ext: 'txt' },
  chicago: { name: 'Chicago', ext: 'txt' },
  bibtex: { name: 'BibTeX', ext: 'bib' },
  ris: { name: 'RIS', ext: 'ris' },
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MLA_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

/** Page titles often end with the website's name ("Rice | Britannica"); that part is cut. */
function cleanTitle(title, site) {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  const parts = t.split(/\s+[|–—·-]\s+/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].toLowerCase();
    const siteWords = `${site.label} ${site.domain}`.toLowerCase();
    if (last.length <= 60 && (siteWords.includes(last) || last.split(/\s+/).some((w) => w.length > 3 && siteWords.includes(w)))) t = parts.slice(0, -1).join(' - ');
  }
  return t || site.label || site.domain || 'Untitled';
}

const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sentenceEnd = (s) => (/[.?!]$/.test(s) ? s : `${s}.`);
const bibEsc = (s) => String(s).replace(/([{}%&$#_\\])/g, '\\$1');

function citeKey(site, title, used) {
  const base = `${(site.domain || site.label || 'source').split('.')[0].replace(/[^a-z0-9]/gi, '').toLowerCase() || 'source'}${(title.match(/[A-Za-z]{4,}/) || ['page'])[0].toLowerCase()}`;
  let k = base, i = 2;
  while (used.has(k)) k = `${base}${i++}`;
  used.add(k);
  return k;
}

/** One entry: { html, text } for the reference styles, plain text for BibTeX and RIS. */
function citeEntry(style, p, site, when, used) {
  const title = cleanTitle(p.title, site);
  const siteName = site.category === 'local' ? (site.folder || site.label || '') : (site.label || site.domain);
  const d = new Date(when);
  const day = d.getDate(), month = d.getMonth(), year = d.getFullYear();
  const iso = d.toISOString().slice(0, 10);
  const it = (s) => ({ html: `<i>${esc(s)}</i>`, text: s });
  const tx = (s) => ({ html: esc(s), text: s });
  const join = (bits) => ({ html: bits.map((b) => b.html).join(''), text: bits.map((b) => b.text).join('') });
  if (p.local) {
    switch (style) {
      case 'apa': return join([it(title), tx(` [Unpublished document]. (n.d.). ${siteName ? sentenceEnd(siteName) : ''}`.trimEnd())]);
      case 'mla': return join([tx(`“${sentenceEnd(title)}” Unpublished document${siteName ? `, ${siteName}` : ''}.`)]);
      case 'chicago': return join([tx(`“${title}.” Unpublished document${siteName ? `, ${siteName}` : ''}.`)]);
      case 'bibtex': return { text: `@unpublished{${citeKey(site, title, used)},\n  title = {${bibEsc(title)}},\n  note = {Unpublished document${siteName ? `, ${bibEsc(siteName)}` : ''}}\n}` };
      default: return { text: ['TY  - UNPB', `TI  - ${title}`, siteName ? `PB  - ${siteName}` : '', 'ER  - '].filter(Boolean).join('\n') };
    }
  }
  const url = p.url;
  switch (style) {
    case 'apa': return join([it(capFirst(title)), tx(`. (n.d.). ${sentenceEnd(siteName)} Retrieved ${MONTHS[month]} ${day}, ${year}, from ${url}`)]);
    case 'mla': return join([tx(`“${sentenceEnd(title)}” `), it(siteName), tx(`, ${url.replace(/^https?:\/\//, '')}. Accessed ${day} ${MLA_MONTHS[month]} ${year}.`)]);
    case 'chicago': return join([tx(`${siteName}. “${title}.” Accessed ${MONTHS[month]} ${day}, ${year}. ${url}.`)]);
    case 'bibtex': return { text: `@misc{${citeKey(site, title, used)},\n  title = {${bibEsc(title)}},\n  howpublished = {${bibEsc(siteName)}},\n  url = {${url}},\n  note = {Accessed ${iso}}\n}` };
    default: return { text: ['TY  - ELEC', `TI  - ${title}`, `T2  - ${siteName}`, `PB  - ${siteName}`, `UR  - ${url}`, `Y2  - ${iso.replace(/-/g, '/')}`, 'ER  - '].join('\n') };
  }
}

function citeAll(r, style) {
  const used = new Set();
  const list = r.pages.map((p) => citeEntry(style, p, r.sites[p.site] || {}, r.createdAt, used));
  if (style === 'apa' || style === 'mla' || style === 'chicago') list.sort((a, b) => a.text.replace(/^[“"]/, '').localeCompare(b.text.replace(/^[“"]/, '')));
  return list;
}

function openCite(r) {
  let style = 'apa';
  try { style = localStorage.getItem('evaluator.citeStyle') || 'apa'; } catch { /* ignore */ }
  if (!CITE_STYLES[style]) style = 'apa';
  const render = (body) => {
    const list = citeAll(r, style);
    const raw = style === 'bibtex' || style === 'ris';
    body.querySelector('#cite-out').innerHTML = raw
      ? `<pre class="cite-raw" translate="no">${esc(list.map((e) => e.text).join('\n\n'))}</pre>`
      : `<ol class="cite-list" translate="no">${list.map((e) => `<li>${e.html}</li>`).join('')}</ol>`;
    body.querySelectorAll('[data-style]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.style === style)));
    return list.map((e) => e.text).join(raw ? '\n\n' : '\n');
  };
  let text = '';
  toolDialog(tr('Cite sources'), `
    <div class="segmented cite-styles" role="group" aria-label="${esc(tr('Citation style'))}">
      ${Object.entries(CITE_STYLES).map(([k, s]) => `<button type="button" data-style="${k}" aria-pressed="false" translate="no">${s.name}</button>`).join('')}
    </div>
    <div id="cite-out" class="cite-out"></div>
    <p class="hint">${tr('Web pages rarely show an author or date the app can trust, so these use the page title, the website, and the day this result was made as the date you looked at it. Open each page and add the author and date if it gives them.')}</p>
    <div class="setup-actions">
      <button type="button" class="btn primary" data-copy data-autofocus>${icon('copy')}<span>${tr('Copy all')}</span></button>
      <button type="button" class="btn quiet" data-save>${icon('download')}<span>${tr('Download')}</span></button>
    </div>`, (body) => {
    text = render(body);
    body.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => {
      style = b.dataset.style;
      try { localStorage.setItem('evaluator.citeStyle', style); } catch { /* ignore */ }
      text = render(body);
    }));
    body.querySelector('[data-copy]').addEventListener('click', (e) => copyWithFeedback(e.currentTarget, text));
    body.querySelector('[data-save]').addEventListener('click', () => downloadText(`sources-${fileSlug(r.statement, 'result')}.${CITE_STYLES[style].ext}`, text, style === 'ris' ? 'application/x-research-info-systems' : 'text/plain'));
  });
}

/* =====================================================================
 * About the evidence
 * ===================================================================== */
const PRIMARY_STUDIES = ['systematic review or meta-analysis', 'randomised or controlled experiment', 'observational study'];
const SECONDARY_STUDIES = ['expert body or consensus statement', 'textbook or reference'];

/** Every cited piece of evidence, with the side it backs ('for', 'against' or 'context') and its kind. */
function evidenceRows(r) {
  const rows = [];
  const fromSide = (side, dir) => (side ? side.arguments : []).forEach((a) => a.evidence.forEach((e) => rows.push({ n: e.n, dir, kind: e.sourceType || 'unknown' })));
  if (r.mode === 'balanced') { fromSide(r.support, 'for'); fromSide(r.contest, 'against'); }
  else if (r.mode === 'check') {
    (r.claims || []).forEach((c) => c.evidence.forEach((e) => rows.push({
      n: e.n, dir: e.stance === 'supports' ? 'for' : e.stance === 'contradicts' ? 'against' : 'context',
      kind: PRIMARY_STUDIES.includes(e.studyType) ? 'primary' : SECONDARY_STUDIES.includes(e.studyType) ? 'secondary' : 'unknown',
    })));
  } else fromSide(r, r.mode === 'support' ? 'for' : 'against');
  return rows.filter((x) => r.pages[x.n - 1]);
}

function qualityHtml(r) {
  const rows = evidenceRows(r);
  if (!rows.length) return '';
  const siteOfN = (n) => r.pages[n - 1].site;
  const sitesUsed = new Set(rows.map((x) => siteOfN(x.n)));
  const count = (k) => rows.filter((x) => x.kind === k).length;
  const primary = count('primary'), secondary = count('secondary'), unknown = count('unknown');
  const name = (i) => `<span translate="no">${esc((r.sites[i] || {}).label || '')}</span>`;
  const warn = [];
  const sideLabel = { for: r.mode === 'check' ? tr('the evidence that supports the claims') : tr('the case for'), against: r.mode === 'check' ? tr('the evidence against the claims') : tr('the case against') };
  ['for', 'against'].forEach((dir) => {
    const side = rows.filter((x) => x.dir === dir);
    const s = new Set(side.map((x) => siteOfN(x.n)));
    if (side.length >= 2 && s.size === 1) warn.push(tr('All of {side} comes from one website, {site}. One website can be wrong or one-sided; look for a second.', { side: sideLabel[dir], site: name([...s][0]) }));
  });
  if (sitesUsed.size === 1 && !warn.length && rows.length >= 2) warn.push(tr('Everything here comes from one website, {site}. Look for a second before relying on it.', { site: name([...sitesUsed][0]) }));
  if (!primary) warn.push(r.mode === 'check'
    ? tr('No original research was cited: the evidence is reviews, reference works or unclassified. That can be fine for settled facts; for anything disputed, look for the studies themselves.')
    : tr('No primary source was cited (an original document, record or eyewitness account). The evidence is other people\'s accounts, so check how they know.'));
  const store = typeof SourceStore !== 'undefined' && Array.isArray(SourceStore.list) ? SourceStore.list : [];
  const notes = [...sitesUsed].map((i) => {
    const s = r.sites[i];
    const mine = s && store.find((x) => x.domain === s.domain && x.notes);
    return mine ? `<li><strong translate="no">${esc(s.label)}:</strong> <span translate="no">${esc(mine.notes)}</span></li>` : '';
  }).filter(Boolean);
  const kinds = [primary && trn(primary, '{n} primary', '{n} primary'), secondary && trn(secondary, '{n} secondary', '{n} secondary'), unknown && trn(unknown, '{n} not stated', '{n} not stated')].filter(Boolean).join(', ');
  return `<section class="quality" aria-labelledby="quality-h">
    <h3 id="quality-h">${tr('About the evidence')}</h3>
    <p>${tr('{evidence} {sites}: {kinds}.', { evidence: trn(rows.length, '{n} piece of evidence', '{n} pieces of evidence'), sites: trn(sitesUsed.size, 'from {n} website', 'from {n} websites'), kinds })}</p>
    ${warn.length ? `<ul class="quality-warn">${warn.map((w) => `<li>${w}</li>`).join('')}</ul>` : `<p class="muted small">${tr('The evidence comes from more than one website on each side.')}</p>`}
    ${notes.length ? `<p class="quality-notes-h">${tr('Your notes on these websites')}</p><ul class="quality-notes">${notes.join('')}</ul>` : ''}
  </section>`;
}
