/* Evaluator extension: options (the app's address, and the screenshot helper). */
'use strict';
const $ = (id) => document.getElementById(id);
const HELPER_ID = 'evaluator-helper';

async function registerHelper(appUrl) {
  try { await api.scripting.unregisterContentScripts({ ids: [HELPER_ID] }); } catch { /* none yet */ }
  if (!appUrl) return;
  await api.scripting.registerContentScripts([{ id: HELPER_ID, js: ['helper.js'], matches: [appMatch(appUrl)], runAt: 'document_idle', persistAcrossSessions: true }]);
}

(async () => {
  $('app-url').value = await appAddress();
  $('save').addEventListener('click', async () => {
    const msg = $('msg');
    const appUrl = cleanAppUrl($('app-url').value);
    if (!appUrl) { msg.className = 'bad'; msg.textContent = 'Enter the full address, starting with https:// (or http://localhost for a copy on this computer).'; return; }
    let screens = $('allow-screens').checked;
    // Permission must be asked for straight from the click.
    if (screens) screens = await api.permissions.request({ origins: [appMatch(appUrl)] }).catch(() => false);
    await api.storage.sync.set({ appUrl });
    await registerHelper(screens ? appUrl : '');
    $('app-url').value = appUrl;
    msg.className = 'ok';
    msg.textContent = screens ? 'Saved. Everything is ready, screenshots included.' : 'Saved. Screenshots are off (the permission was not given); everything else works.';
  });
})();
