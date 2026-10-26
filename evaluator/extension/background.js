/* Evaluator extension: right-click menus and the hand-over of screenshots. */
'use strict';

if (typeof importScripts === 'function') importScripts('common.js');

function menus() {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({ id: 'claim', title: 'Check this claim with Evaluator', contexts: ['selection'] });
    api.contextMenus.create({ id: 'find-text', title: 'Find claims in the selected text', contexts: ['selection'] });
    api.contextMenus.create({ id: 'find-link', title: 'Find claims on the linked page', contexts: ['link'] });
    api.contextMenus.create({ id: 'find-page', title: 'Find claims on this page', contexts: ['page'] });
  });
}

api.runtime.onInstalled.addListener(async (details) => {
  menus();
  if (details.reason === 'install' && !(await appAddress())) api.runtime.openOptionsPage();
});
api.runtime.onStartup && api.runtime.onStartup.addListener(menus);

api.contextMenus.onClicked.addListener((info, tab) => {
  const text = String(info.selectionText || '').trim();
  if (info.menuItemId === 'claim') openApp(text.length <= CLAIM_MAX ? { claim: text } : { text });
  else if (info.menuItemId === 'find-text') openApp({ text });
  else if (info.menuItemId === 'find-link' && /^https?:/.test(info.linkUrl || '')) openApp({ url: info.linkUrl });
  else if (info.menuItemId === 'find-page' && tab && /^https?:/.test(tab.url || '')) openApp({ url: tab.url });
});

/* The helper on the app's page asks for the screenshot meant for its tab; it is given once, then forgotten. */
api.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'evaluator-helper-ready' || !sender.tab) return false;
  const key = `pending-${sender.tab.id}`;
  (async () => {
    const appUrl = await appAddress();
    if (!appUrl || !String(sender.url || '').startsWith(appUrl)) { reply(null); return; }
    // The picture is stored just after the tab opens; wait a moment for it if needed.
    for (let i = 0; i < 15; i++) {
      const got = await api.storage.session.get(key);
      if (got[key]) { await api.storage.session.remove(key); reply(got[key]); return; }
      await new Promise((r) => setTimeout(r, 200));
    }
    reply(null);
  })();
  return true;
});
