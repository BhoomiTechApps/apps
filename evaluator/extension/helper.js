/* Evaluator extension: runs on the Evaluator app's own pages only (the
 * address set in the options). When the extension opened this tab with a
 * screenshot, it hands the picture to the app's claim finder. */
'use strict';
(() => {
  const api = globalThis.browser || globalThis.chrome;
  let sent = false;
  const give = (item) => {
    if (sent || !item) return;
    sent = true;
    window.postMessage({ type: 'evaluator-extension-image', dataUrl: item.dataUrl, site: item.site }, location.origin);
  };
  api.runtime.sendMessage({ type: 'evaluator-helper-ready' }).then((item) => {
    if (!item) return;
    if (document.documentElement.dataset.evaluatorReady === '1') give(item);
    else window.addEventListener('message', (e) => { if (e.source === window && e.data && e.data.type === 'evaluator-ready') give(item); });
  }).catch(() => {});
})();
