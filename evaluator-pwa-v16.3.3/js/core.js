/* Evaluator: core.js
 *
 * Shared helpers and constants: DOM shortcuts, escaping, storage keys,
 * category and verdict labels, and the localStorage wrapper.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const PROVIDER_IDS_CORE = ['gemini', 'groq', 'openrouter', 'mistral', 'openai', 'anthropic'];
const KEYS = { sources: 'tracer.sources.v1', settings: 'tracer.settings.v1', history: 'tracer.history.v1', modelLists: 'tracer.modellists.v1', topic: 'tracer.topic.v1', accordions: 'tracer.accordions.v1' };
const TOPICS_ADDED_IN_V3 = ['t-science'];
const CATEGORIES = ['primary', 'academic', 'reference', 'archive', 'journalism', 'other'];
const CATEGORY_NAMES = {
  primary: 'Primary sources', academic: 'Academic journal', reference: 'Reference work',
  archive: 'Archive or library', journalism: 'Journalism', other: 'Other', local: 'Local file',
};
const VERDICT_TEXT = {
  strong: 'Strong evidence', moderate: 'Moderate evidence',
  weak: 'Weak evidence', insufficient: 'Not enough evidence',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

const local = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

/* ---------- App details ----------
 * window.EVALUATOR is set in index.html (asset base and version). What the
 * WordPress plugin used to tell the page (which services have a key, the app
 * height) now comes from the settings file (js/settingsfile.js), so these are
 * live getters. The app calls each AI provider and Tavily directly with the
 * keys in that file; there is no server in between.
 */
const WP = window.EVALUATOR || {};
Object.assign(WP, { canManage: true, userChoice: true, loggedIn: false });
Object.defineProperties(WP, {
  configured: { get: () => Object.fromEntries(PROVIDER_IDS_CORE.map((p) => [p, Boolean(SettingsFile.key(p))])) },
  tavily: { get: () => Boolean(SettingsFile.key('tavily')) },
  appHeight: { get: () => (SettingsFile.data ? SettingsFile.data.appHeight : 0) },
});

/* ---------- Line icons ----------
 * Same names and paths as evaluator_icon() in includes/frame.php.
 */
const ICONS = {
  support: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16 9.8"/>',
  challenge: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  evaluate: '<path d="M12 4v16M8 20h8M5 7h14"/><path d="M5 7 2.5 13a2.5 2.5 0 0 0 5 0L5 7zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0L19 7z"/>',
  verify: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7.5 15h9"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M7 14h10v6H7z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>',
  document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = (name) => (ICONS[name]
  ? `<svg class="ev-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`
  : '');
const MODE_ICON = { support: 'support', contest: 'challenge', balanced: 'evaluate', check: 'verify' };
const assetUrl = (path) => `${WP.assetBase || ''}${path}`;

// Settings (and keys an earlier stand-alone version left in this browser) are moved into the settings file by SettingsFile.init().
