/* Evaluator extension: the toolbar popup. */
'use strict';
const $ = (id) => document.getElementById(id);
const say = (t) => { $('msg').textContent = t; };

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

(async () => {
  const appUrl = await appAddress();
  $('setup').hidden = Boolean(appUrl);
  $('actions').hidden = !appUrl;
  $('open-options').addEventListener('click', () => { api.runtime.openOptionsPage(); window.close(); });
  $('options-link').addEventListener('click', (e) => { e.preventDefault(); api.runtime.openOptionsPage(); window.close(); });
  $('app-link').addEventListener('click', async (e) => { e.preventDefault(); await openApp({}); window.close(); });

  $('check-selection').addEventListener('click', async () => {
    const tab = await activeTab();
    let text = '';
    try {
      const [r] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection() || '') });
      text = String((r && r.result) || '').trim();
    } catch { say('This page can\'t be read by extensions (browser pages and the web store are protected).'); return; }
    if (!text) { say('Select some text on the page first.'); return; }
    await openApp(text.length <= CLAIM_MAX ? { claim: text } : { text });
    window.close();
  });

  $('find-page').addEventListener('click', async () => {
    const tab = await activeTab();
    if (!/^https?:/.test(tab.url || '')) { say('Only web pages (http or https) can be read.'); return; }
    await openApp({ url: tab.url });
    window.close();
  });

  $('screenshot').addEventListener('click', async () => {
    const granted = await api.permissions.contains({ origins: [appMatch(appUrl)] });
    if (!granted) { say('To pass screenshots to the app, allow it in Options first.'); return; }
    const tab = await activeTab();
    let image;
    try { image = await api.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 }); } catch { say('This tab can\'t be captured (browser pages are protected).'); return; }
    let site = '';
    try { site = new URL(tab.url).hostname; } catch { /* leave empty */ }
    await openApp({}, { image, site });
    window.close();
  });
})();
