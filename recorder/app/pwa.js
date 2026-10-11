/* Interview Recorder: installable app.
 * Registers the service worker for the recorder address and shows an "Install app" button in the
 * frame header when the browser offers installation. Loaded only on the host recorder page. */
(function () {
	'use strict';
	var cfg = window.IR_CONFIG && window.IR_CONFIG.pwa;
	if (!cfg || !('serviceWorker' in navigator) || !window.isSecureContext) return;

	window.addEventListener('load', function () {
		navigator.serviceWorker.register(cfg.sw, { scope: cfg.scope }).catch(function () { /* no install; the page still works */ });
	});

	var installed = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
	if (installed) {
		document.documentElement.classList.add('ir-standalone');
		return;
	}

	var deferred = null, button = null;
	var ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
		+ '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 7v7"/><path d="m9 11 3 3 3-3"/><path d="M10 18h4"/></svg>';

	function showButton() {
		var head = document.querySelector('.ir-frame-head');
		if (!head || button) return;
		button = document.createElement('button');
		button.type = 'button';
		button.className = 'ir-install';
		button.innerHTML = ICON + '<span>Install app</span>';
		button.addEventListener('click', function () {
			if (!deferred) return;
			deferred.prompt();
			deferred.userChoice.then(function () { deferred = null; hideButton(); }, function () { /* ignore */ });
		});
		head.insertBefore(button, head.firstChild);
	}
	function hideButton() {
		if (button && button.parentNode) button.parentNode.removeChild(button);
		button = null;
	}

	window.addEventListener('beforeinstallprompt', function (e) {
		e.preventDefault();
		deferred = e;
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showButton);
		else showButton();
	});
	window.addEventListener('appinstalled', function () { deferred = null; hideButton(); });
})();
