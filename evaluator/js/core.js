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
