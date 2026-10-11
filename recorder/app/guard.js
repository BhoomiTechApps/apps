/* Interview Recorder: page guard.
 * 1. Right-click is switched off everywhere. Text fields get a small menu with only Copy and Paste.
 * 2. When code protection is on (admin setting, on by default), the developer-tools shortcuts,
 *    view-source and save-page shortcuts, and an opened developer-tools panel send the visitor
 *    to the site's main page.
 * This is a deterrent: anything a browser downloads can still be read by someone determined. */
(function () {
	'use strict';
	var cfg = (window.IR_CONFIG && window.IR_CONFIG.guard) || {};
	var protect = cfg.protect !== false;
	var home = cfg.home || '/';
	var leaving = false;

	function leave() {
		if (leaving) return;
		leaving = true;
		try {
			if (window.top !== window && window.top.location.origin === location.origin) {
				window.top.location.replace(home);
				return;
			}
		} catch (e) { /* cross-origin parent: fall through */ }
		location.replace(home);
	}

	/* ---------- text-field context menu: Copy and Paste only ---------- */
	var TEXT_TYPES = { text: 1, search: 1, email: 1, url: 1, tel: 1, password: 1, number: 1 };
	function textField(el) {
		if (!el || !el.tagName) return null;
		if (el.tagName === 'TEXTAREA') return el;
		if (el.tagName === 'INPUT' && TEXT_TYPES[(el.type || 'text').toLowerCase()]) return el;
		return null;
	}
	var ICON = {
		copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
		paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'
	};
	function svg(name) {
		return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>';
	}
	var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
	var mod = isMac ? '⌘' : 'Ctrl+';
	var menu = null, toastTimer = 0;

	function host() { return document.querySelector('.ir-frame') || document.body; }

	function toast(text) {
		var t = document.querySelector('.ir-toast');
		if (!t) { t = document.createElement('div'); t.className = 'ir-toast'; t.setAttribute('role', 'status'); host().appendChild(t); }
		t.textContent = text;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
	}

	function closeMenu() {
		if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
		menu = null;
	}

	function selectedText(el) {
		try {
			var a = el.selectionStart, b = el.selectionEnd;
			if (a != null && b != null && b > a) return el.value.slice(a, b);
		} catch (e) { /* number inputs have no selection API */ }
		return el.value;
	}

	function insertText(el, text) {
		el.focus();
		var ok = false;
		try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
		if (ok) return;
		// Fallback that React controlled inputs still notice.
		var a = el.selectionStart != null ? el.selectionStart : el.value.length;
		var b = el.selectionEnd != null ? el.selectionEnd : el.value.length;
		var next = el.value.slice(0, a) + text + el.value.slice(b);
		if (el.maxLength > 0) next = next.slice(0, el.maxLength);
		var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, next);
		el.dispatchEvent(new Event('input', { bubbles: true }));
		try { el.setSelectionRange(a + text.length, a + text.length); } catch (e) { /* ignore */ }
	}

	function copyFrom(el) {
		var text = selectedText(el);
		if (!text) return;
		var done = function () { toast('Copied.'); };
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(done, function () { legacyCopy(el, text) && done(); });
		} else if (legacyCopy(el, text)) {
			done();
		}
	}
	function legacyCopy(el, text) {
		try {
			var hadSel = el.selectionEnd > el.selectionStart;
			if (!hadSel) el.select();
			var ok = document.execCommand('copy');
			return ok;
		} catch (e) { return false; }
	}

	function pasteInto(el) {
		if (!navigator.clipboard || !navigator.clipboard.readText) {
			toast('Press ' + mod + 'V to paste.');
			return;
		}
		navigator.clipboard.readText().then(function (text) {
			if (text) insertText(el, text);
		}, function () {
			el.focus();
			toast('Paste was blocked by the browser. Press ' + mod + 'V instead.');
		});
	}

	function openMenu(el, x, y) {
		closeMenu();
		var canCopy = el.type !== 'password' && !!el.value;
		var canPaste = !el.readOnly && !el.disabled;
		menu = document.createElement('div');
		menu.className = 'ir-ctx';
		menu.setAttribute('role', 'menu');
		menu.innerHTML =
			'<button type="button" role="menuitem" data-act="copy"' + (canCopy ? '' : ' disabled') + '>' + svg('copy') + '<span>Copy</span><kbd>' + mod + 'C</kbd></button>' +
			'<button type="button" role="menuitem" data-act="paste"' + (canPaste ? '' : ' disabled') + '>' + svg('paste') + '<span>Paste</span><kbd>' + mod + 'V</kbd></button>';
		// Keep the field's selection while the menu is used.
		menu.addEventListener('mousedown', function (e) { e.preventDefault(); });
		menu.addEventListener('click', function (e) {
			var b = e.target.closest && e.target.closest('button');
			if (!b || b.disabled) return;
			var act = b.getAttribute('data-act');
			closeMenu();
			if (act === 'copy') copyFrom(el); else if (act === 'paste') pasteInto(el);
		});
		menu.addEventListener('keydown', function (e) {
			var items = Array.prototype.slice.call(menu.querySelectorAll('button:not([disabled])'));
			var i = items.indexOf(document.activeElement);
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				if (!items.length) return;
				i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
				items[i].focus();
			}
		});
		host().appendChild(menu);
		var r = menu.getBoundingClientRect();
		var left = Math.min(x, window.innerWidth - r.width - 6);
		var top = Math.min(y, window.innerHeight - r.height - 6);
		menu.style.left = Math.max(6, left) + 'px';
		menu.style.top = Math.max(6, top) + 'px';
	}

	document.addEventListener('contextmenu', function (e) {
		e.preventDefault();
		var el = textField(e.target);
		if (!el) { closeMenu(); return; }
		var x = e.clientX, y = e.clientY;
		if (!x && !y) { var r = el.getBoundingClientRect(); x = r.left + 8; y = r.bottom + 4; }
		openMenu(el, x, y);
		if (e.button !== 2) { var first = menu && menu.querySelector('button:not([disabled])'); if (first) first.focus(); }
	}, true);
	document.addEventListener('mousedown', function (e) { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
	window.addEventListener('blur', closeMenu);
	window.addEventListener('resize', closeMenu);
	document.addEventListener('scroll', closeMenu, true);
	document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

	/* ---------- full screen button ---------- */
	function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
	function fsSupported() {
		var r = document.documentElement;
		return !!((document.fullscreenEnabled || document.webkitFullscreenEnabled) && (r.requestFullscreen || r.webkitRequestFullscreen));
	}
	var FS_ENTER = 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3';
	var FS_EXIT = 'M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3';
	function fsSync() {
		var on = !!fsElement();
		var bs = document.querySelectorAll('.ir-fs');
		for (var i = 0; i < bs.length; i++) {
			var b = bs[i];
			b.hidden = !fsSupported();
			var label = b.getAttribute(on ? 'data-off' : 'data-on');
			var span = b.querySelector('span');
			var path = b.querySelector('path');
			if (label && span) span.textContent = label;
			if (path) path.setAttribute('d', on ? FS_EXIT : FS_ENTER);
			b.setAttribute('aria-pressed', on ? 'true' : 'false');
		}
	}
	function fsToggle() {
		var r = document.documentElement;
		try {
			if (fsElement()) {
				(document.exitFullscreen || document.webkitExitFullscreen).call(document);
			} else {
				var p = (r.requestFullscreen || r.webkitRequestFullscreen).call(r);
				if (p && p.catch) p.catch(function () { toast('Full screen was blocked by the browser.'); });
			}
		} catch (e) { toast('Full screen is not available here.'); }
	}
	document.addEventListener('click', function (e) {
		var b = e.target.closest && e.target.closest('.ir-fs');
		if (b) { e.preventDefault(); fsToggle(); }
	});
	document.addEventListener('fullscreenchange', fsSync);
	document.addEventListener('webkitfullscreenchange', fsSync);
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fsSync); else fsSync();

	/* ---------- shortcode iframe: tell the host page how tall the recorder is, so the box grows to fit ---------- */
	(function () {
		if (window.top === window || !/[?&]ir_embed=/.test(location.search)) return;
		document.documentElement.classList.add('ir-embed-root'); /* no scrollbar of its own inside the shortcode box */
		if (/[?&]ir_auto=/.test(location.search)) document.documentElement.classList.add('ir-auto');
		var last = 0;
		function measure() {
			var f = document.querySelector('.ir-frame');
			if (!f) return 0;
			var r = f.getBoundingClientRect();
			var h = r.bottom + (window.pageYOffset || 0);
			/* anything that spills past the frame (long text, wide rows on a phone) counts too */
			if (document.body) h = Math.max(h, document.body.scrollHeight);
			return Math.ceil(h) + 1;
		}
		/* force = true re-sends even when the number has not changed: the host page may have attached its
		   listener after our first message (deferred or delayed scripts, common on phones), and would
		   otherwise never hear it. */
		function send(force) {
			if (fsElement()) return; /* full screen resizes the iframe to the screen: don't pass that on */
			var h = measure();
			if (h && (force === true || h !== last)) {
				last = h;
				try { window.parent.postMessage({ irHeight: h }, '*'); /* only a number is sent; the host checks which iframe it came from */ } catch (e) { /* ignore */ }
			}
		}
		function onChange() { send(false); }
		function start() {
			send(true);
			var f = document.querySelector('.ir-frame');
			if (window.ResizeObserver && f) new ResizeObserver(onChange).observe(f);
			if (window.MutationObserver) new MutationObserver(onChange).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
			window.addEventListener('resize', onChange);
			window.addEventListener('orientationchange', function () { setTimeout(onChange, 250); });
			window.addEventListener('load', function () { send(true); });
			window.addEventListener('transitionend', onChange, true);
			window.addEventListener('animationend', onChange, true);
			if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { send(true); });
			/* the host asks for the height once it is listening */
			window.addEventListener('message', function (e) {
				if (e.source === window.parent && e.data && e.data.irMeasure) send(true);
			});
			/* early retries, then a slow heartbeat as a safety net (a single small number every 2 seconds) */
			[150, 600, 1500, 3500].forEach(function (t) { setTimeout(function () { send(true); }, t); });
			setInterval(function () { if (!document.hidden) send(true); }, 2000);
		}
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
	})();

	if (!protect) return;

	/* ---------- developer tools, view-source and save-page shortcuts ---------- */
	document.addEventListener('keydown', function (e) {
		var k = (e.key || '').toLowerCase();
		var code = e.keyCode || e.which;
		var blocked =
			k === 'f12' || code === 123 ||
			(e.ctrlKey && e.shiftKey && (k === 'i' || k === 'j' || k === 'c' || k === 'k')) ||
			(e.metaKey && e.altKey && (k === 'i' || k === 'j' || k === 'c' || k === 'u' || code === 73 || code === 74 || code === 67 || code === 85)) ||
			((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (k === 'u' || k === 's'));
		if (blocked) {
			e.preventDefault();
			e.stopPropagation();
			leave();
		}
	}, true);

	/* ---------- an open developer-tools panel ---------- */
	// A `debugger` statement only pauses while developer tools are open; the pause shows up as
	// lost time. Checked once a second; costs nothing when the panel is closed.
	function probe() {
		var t = performance.now();
		/* eslint-disable-next-line no-debugger */
		debugger;
		if (performance.now() - t > 120) leave();
	}
	setInterval(probe, 1000);
})();
