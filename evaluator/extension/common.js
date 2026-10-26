/* Evaluator extension: shared helpers (background, popup and options). */
'use strict';

const api = globalThis.browser || globalThis.chrome;

/** The Evaluator app's address, saved in the options ('' until set). */
async function appAddress() {
  const { appUrl } = await api.storage.sync.get('appUrl');
  return typeof appUrl === 'string' ? appUrl : '';
}

/** Checks and tidies an app address: https (or http on this computer), ending in '/'. */
function cleanAppUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local))) return null;
  u.hash = ''; u.search = '';
  if (!u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/[^/]*\.html?$/, '/').replace(/([^/])$/, '$1/');
  return u.href;
}

/** The pattern for the app's pages, for permissions and the helper script. */
function appMatch(appUrl) {
  const u = new URL(appUrl);
  return `${u.protocol}//${u.hostname}/*`;
}

/** Opens the app with ?claim= / ?text= / ?url= (one tab; reuses an open Evaluator tab when it can). */
async function openApp(params, { image = null, site = '' } = {}) {
  const appUrl = await appAddress();
  if (!appUrl) { await api.runtime.openOptionsPage(); return; }
  const q = new URLSearchParams(params).toString();
  const tab = await api.tabs.create({ url: `${appUrl}${q ? `?${q}` : ''}#trace` });
  if (image) await api.storage.session.set({ [`pending-${tab.id}`]: { dataUrl: image, site } });
}

const CLAIM_MAX = 600; // longer selections go to the claim finder instead
