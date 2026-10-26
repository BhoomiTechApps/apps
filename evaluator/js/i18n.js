/* Evaluator: i18n.js
 *
 * Interface languages: English (built in), Assamese (as) and Bengali (bn).
 *
 * The page is written in English. A language file (i18n/as.js, i18n/bn.js)
 * maps English text to the translation, and this script swaps it in:
 *   - once for the page as loaded, and
 *   - for everything the app adds or changes later (a MutationObserver), so
 *     the other scripts need no changes for most of their text.
 *
 * Keys are the English text with spaces collapsed. A key may be a whole
 * element's HTML when it holds only simple inline markup (<strong>, <em>,
 * <a href>, <code>, <br>), so a sentence is translated as a whole. Keys with
 * {name} placeholders are patterns: "{n} of {m} switched on" matches
 * "3 of 17 switched on" and the numbers are put into the translation.
 *
 * Anything inside translate="no" is left alone: your statements, the
 * model's writing in results, source titles, code and the settings editor.
 *
 * The language is kept in the settings file ("language"); a copy in this
 * browser lets the right language file load before the page is drawn.
 * Changing the language reloads the page.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

const LANGS = {
  en: { native: 'English', english: 'English' },
  as: { native: 'অসমীয়া', english: 'Assamese' },
  bn: { native: 'বাংলা', english: 'Bengali' },
};
const LANG_CACHE = 'evaluator.lang';

const I18N = (() => {
  const data = window.EV_I18N_DATA && LANGS[window.EV_I18N_DATA.lang] ? window.EV_I18N_DATA : null;
  const lang = data ? data.lang : 'en';
  const collect = Boolean(data && data.collect); // development: list untranslated text instead of skipping it
  const exact = new Map();
  const templates = new Map(); // keys with {placeholders}, looked up as written by tr()
  const patterns = [];
  const PH = /\{([a-z][a-z0-9]*)\}/g;
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (data) {
    Object.entries(data.strings || {}).forEach(([en, tr]) => {
      const key = norm(en);
      if (!tr) return;
      if (/\{[a-z][a-z0-9]*\}/.test(key)) {
        templates.set(key, tr);
        const names = [];
        const src = reEsc(key).replace(/\\\{([a-z][a-z0-9]*)\\\}/g, (m, n) => { names.push(n); return '(.+?)'; });
        patterns.push({ re: new RegExp(`^${src}$`), names, out: tr, len: key.length });
      } else {
        exact.set(key, tr);
      }
    });
    // Longer, more specific patterns are tried first.
    patterns.sort((a, b) => b.len - a.len);
  }

  /** The translation of an English string, or null. Values caught by a pattern are translated too when known. */
  function lookup(text) {
    if (!data) return null;
    const key = norm(text);
    if (!key) return null;
    if (exact.has(key)) return exact.get(key);
    if (templates.has(key)) return templates.get(key);
    for (const p of patterns) {
      const m = p.re.exec(key);
      if (!m) continue;
      const vals = {};
      p.names.forEach((n, i) => { const v = m[i + 1]; vals[n] = exact.has(v) ? exact.get(v) : v; });
      return p.out.replace(PH, (x, n) => (n in vals ? vals[n] : x));
    }
    return null;
  }

  /** For code: t('Copied') or t('{n} websites', { n: 3 }). Falls back to the English. */
  function t(text, vars) {
    const src = String(text ?? '');
    let out = lookup(src);
    if (out === null) out = src;
    else out = src.match(/^\s*/)[0] + out + src.match(/\s*$/)[0]; // keep spaces around fragments such as ' and '
    if (vars) out = out.replace(PH, (x, n) => (n in vars ? String(vars[n]) : x));
    return out;
  }

  /* ---------- Walking the page ---------- */
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'TEMPLATE', 'svg', 'SVG', 'INPUT', 'NOSCRIPT']);
  const INLINE = new Set(['STRONG', 'EM', 'B', 'I', 'A', 'CODE', 'BR', 'KBD', 'SMALL', 'SUP', 'SUB', 'U']);
  const UNIT = new Set(['P', 'LI', 'DT', 'DD', 'H1', 'H2', 'H3', 'H4', 'TH', 'TD', 'LEGEND', 'BUTTON', 'SUMMARY', 'LABEL', 'SPAN', 'DIV', 'A', 'STRONG', 'EM', 'OPTION']);
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const misses = new Set(); // English text seen without a translation (for the coverage check)
  const record = (s) => { if (data && /[A-Za-z]{2}/.test(s)) misses.add(norm(s)); };

  const skipped = (el) => el.nodeType === 1 && (SKIP.has(el.tagName) || el.getAttribute('translate') === 'no');
  function insideSkipped(node) {
    for (let el = node.nodeType === 1 ? node : node.parentElement; el; el = el.parentElement) {
      if (skipped(el)) return true;
      if (el.id === 'ev-frame') return false;
    }
    return false;
  }

  /**
   * True when an element holds only text and simple inline markup, so it can be translated as a whole.
   * Later changes must not replace links that scripts hook into (data-*); the first pass over the page
   * may, because it runs before the other scripts attach anything.
   */
  let firstPass = false;
  function isUnit(el) {
    if (!UNIT.has(el.tagName) || !el.firstElementChild) return false;
    for (const d of el.querySelectorAll('*')) {
      if (!INLINE.has(d.tagName) || d.id) return false;
      for (const a of d.attributes) if (/^on/.test(a.name) || (!firstPass && /^data-/.test(a.name))) return false;
    }
    return /[A-Za-z]/.test(el.textContent);
  }

  function doText(node) {
    const raw = node.data;
    if (!/[A-Za-z]/.test(raw)) return;
    const tr = lookup(raw);
    if (tr === null) { record(raw); return; }
    const lead = raw.match(/^\s*/)[0], tail = raw.match(/\s*$/)[0];
    const next = lead + tr + tail;
    if (next !== raw) node.data = next;
  }

  function doAttrs(el) {
    ATTRS.forEach((a) => {
      const v = el.getAttribute(a);
      if (!v || !/[A-Za-z]/.test(v)) return;
      const tr = lookup(v);
      if (tr === null) record(v); else if (tr !== v) el.setAttribute(a, tr);
    });
  }

  function walk(el) {
    // Form fields: only their placeholder, title and label are interface text, never their contents.
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.getAttribute('translate') !== 'no') { doAttrs(el); return; }
    if (skipped(el)) return;
    doAttrs(el);
    if (isUnit(el)) {
      const tr = lookup(el.innerHTML);
      if (tr !== null) { el.innerHTML = tr; return; }
      if (collect) { record(el.innerHTML); return; }
      // Not known as a whole: fall back to its pieces.
    }
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) doText(n);
      else if (n.nodeType === 1) walk(n);
    }
  }

  let observer = null;
  function start(root) {
    document.documentElement.lang = lang;
    if (!data) return;
    firstPass = true;
    walk(root);
    firstPass = false;
    document.documentElement.classList.remove('i18n-pending');
    observer = new MutationObserver((list) => {
      observer.disconnect();
      try {
        for (const m of list) {
          if (m.type === 'childList') {
            const done = new Set();
            m.addedNodes.forEach((n) => {
              if (!n.isConnected || insideSkipped(n.nodeType === 1 ? n.parentElement || n : n)) return;
              // Text set with innerHTML on a unit (for example a status line with <strong>): translate the unit as a whole.
              const p = n.parentElement;
              if (p && isUnit(p) && (lookup(p.innerHTML) !== null || collect)) { if (!done.has(p)) { done.add(p); walk(p); } return; }
              if (n.nodeType === 3) doText(n);
              else if (n.nodeType === 1) walk(n);
            });
          } else if (m.type === 'characterData') {
            if (m.target.isConnected && !insideSkipped(m.target)) doText(m.target);
          } else if (m.type === 'attributes') {
            if (m.target.isConnected && !insideSkipped(m.target)) doAttrs(m.target);
          }
        }
      } finally { connect(root); }
    });
    connect(root);
  }
  function connect(root) {
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  /* Messages shown by the browser itself. */
  if (data) {
    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);
    window.alert = (m) => nativeAlert(t(String(m)));
    window.confirm = (m) => nativeConfirm(t(String(m)));
  }

  return { lang, t, lookup, start, misses, active: Boolean(data), locale: { en: 'en-IN', as: 'as-IN', bn: 'bn-IN' }[lang] };
})();

/** Translated text: tr('Copied'), tr('{n} websites', { n: 3 }). */
function tr(text, vars) { return I18N.t(text, vars); }
/** Singular or plural English key, then translated: trn(n, '{n} website', '{n} websites'). */
function trn(n, one, many, vars) { return I18N.t(Number(n) === 1 ? one : many, { n, ...(vars || {}) }); }
/** Dates in the interface language (digits stay Western, as in most Indian apps). */
function fmtDate(d) {
  try { return new Date(d).toLocaleDateString(`${I18N.locale}-u-nu-latn`, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return String(d); }
}
function fmtDateTime(d) {
  try { return new Date(d).toLocaleString(`${I18N.locale}-u-nu-latn`, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return String(d); }
}

/** Switches language: saved in the settings file, then the page reloads in it. */
async function setLanguage(code) {
  if (!LANGS[code]) return;
  try { localStorage.setItem(LANG_CACHE, code); } catch { /* the settings file still has it */ }
  if (typeof SettingsFile !== 'undefined' && SettingsFile.data) {
    SettingsFile.update({ language: code });
    await SettingsFile.save();
  }
  location.reload();
}

/** At start-up: if the settings file asks for another language than the one loaded, load that one. */
function checkLanguage() {
  if (window.EV_I18N_DATA && window.EV_I18N_DATA.collect) return false; // development run listing untranslated text
  const want = (SettingsFile.data && SettingsFile.data.language) || 'en';
  let cached = 'en';
  try { cached = localStorage.getItem(LANG_CACHE) || 'en'; } catch { /* ignore */ }
  if (want === I18N.lang) {
    try { if (cached !== want) localStorage.setItem(LANG_CACHE, want); sessionStorage.removeItem('evaluator.langReload'); } catch { /* ignore */ }
    return false;
  }
  // Reload once only, so blocked storage can't cause a loop.
  try {
    if (sessionStorage.getItem('evaluator.langReload') === want) return false;
    sessionStorage.setItem('evaluator.langReload', want);
    localStorage.setItem(LANG_CACHE, want);
  } catch { return false; }
  location.reload();
  return true;
}

function renderLanguagePickers() {
  document.querySelectorAll('select[data-lang-select]').forEach((sel) => {
    sel.setAttribute('translate', 'no');
    sel.innerHTML = Object.entries(LANGS).map(([code, l]) => `<option value="${code}" lang="${code}">${l.native}</option>`).join('');
    sel.value = I18N.lang;
    sel.addEventListener('change', () => setLanguage(sel.value));
  });
}

I18N.start(document.getElementById('ev-frame'));

/** Settings › Language of new results: the interface language (default), or a fixed one. */
function renderResultLanguage() {
  const sel = document.getElementById('result-lang-select');
  if (!sel) return;
  sel.innerHTML = `<option value="interface">${esc(tr('Same as the interface'))}</option>`
    + Object.entries(LANGS).map(([code, l]) => `<option value="${code}" lang="${code}" translate="no">${l.native}</option>`).join('');
  sel.value = (SettingsFile.data && SettingsFile.data.resultLanguage) || 'interface';
  if (!sel.dataset.bound) {
    sel.dataset.bound = '1';
    sel.addEventListener('change', () => { SettingsFile.update({ resultLanguage: sel.value }); });
  }
}
/** The language the model should write results in: 'en', 'as' or 'bn'. */
function resultLang() {
  const v = (SettingsFile.data && SettingsFile.data.resultLanguage) || 'interface';
  return v === 'interface' ? I18N.lang : (LANGS[v] ? v : 'en');
}
