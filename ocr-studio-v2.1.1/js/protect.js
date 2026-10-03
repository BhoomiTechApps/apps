/**
 * OCR Studio — right-click policy and code-access guard.
 *
 * 1. Right-click is switched off everywhere. In text fields (the extracted
 *    text, the keyboard box and the dialog fields) a small menu offers only
 *    Copy and Paste.
 * 2. Attempts to reach the app's JavaScript or CSS send the page back to
 *    index.html: developer-tools shortcuts, view-source and save-page
 *    shortcuts, developer tools found open, and fetching or reading the
 *    script and style files from the console.
 *
 * This is a deterrent. Anything a browser runs can still be read by someone
 * determined (for example with JavaScript turned off, or by downloading the
 * files directly). To debug the app yourself, remove the <script> tag that
 * loads this file from index.html.
 */
( function () {
	'use strict';

	var script = document.currentScript;
	var INDEX = new URL( '../index.html', script ? script.src : location.href ).href;
	var DRAFT_KEY = 'ocr-studio:draft';
	var GUARD_KEY = 'ocr-studio:guard-at';
	var leaving = false;

	// ── Return to index.html ────────────────────────────────────────────────

	function saveDraft() {
		try {
			var o = document.getElementById( 'output' );
			if ( o && o.value ) sessionStorage.setItem( DRAFT_KEY, o.value );
		} catch ( e ) { /* ignore */ }
	}

	function returnToIndex() {
		if ( leaving ) return;
		leaving = true;
		saveDraft();
		location.replace( INDEX );
	}

	// ── Keyboard shortcuts for developer tools, view source, save page ──────

	var DEV_SHIFT = /^Key[IJCKEM]$/;      // Ctrl/Cmd+Shift+I J C K E M
	var DEV_MAC_ALT = /^Key[IJCU]$/;      // Cmd+Option+I J C U

	function isCodeShortcut( e ) {
		if ( e.key === 'F12' || e.code === 'F12' ) return true;
		var mod = e.ctrlKey || e.metaKey;
		if ( ! mod ) return false;
		if ( e.shiftKey && DEV_SHIFT.test( e.code ) ) return true;
		if ( e.metaKey && e.altKey && DEV_MAC_ALT.test( e.code ) ) return true;
		if ( ! e.shiftKey && ! e.altKey && ( e.code === 'KeyU' || e.code === 'KeyS' ) ) return true;
		return false;
	}

	window.addEventListener( 'keydown', function ( e ) {
		if ( ! isCodeShortcut( e ) ) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		returnToIndex();
	}, true );

	// ── Developer tools found open ──────────────────────────────────────────
	// A debugger statement only pauses while developer tools are open, so a
	// long gap around it means they are. After one return to index.html, a
	// second detection within a few seconds shows a notice instead of
	// reloading in a loop; closing the tools reloads the app.

	var blockShown = false;

	function devtoolsOpen() {
		var t = performance.now();
		debugger; // eslint-disable-line no-debugger
		return performance.now() - t > 100;
	}

	function showBlock() {
		if ( blockShown ) return;
		blockShown = true;
		var box = document.createElement( 'div' );
		box.className = 'os-block';
		box.setAttribute( 'role', 'alertdialog' );
		box.setAttribute( 'aria-label', 'Developer tools are not available' );
		box.innerHTML = '<div class="os-block-card"><h2>Developer tools are not available</h2>' +
			'<p>Close the developer tools to continue. OCR Studio reloads when they are closed.</p>' +
			'<button type="button" class="primary-btn">Reload OCR Studio</button></div>';
		box.querySelector( 'button' ).onclick = function () { location.replace( INDEX ); };
		( document.getElementById( 'osFrame' ) || document.body ).appendChild( box );
	}

	setInterval( function () {
		var open = devtoolsOpen();
		if ( ! open ) {
			if ( blockShown ) returnToIndex();
			return;
		}
		var last = 0;
		try { last = +sessionStorage.getItem( GUARD_KEY ) || 0; } catch ( e ) { /* ignore */ }
		if ( Date.now() - last < 8000 ) { showBlock(); return; }
		try { sessionStorage.setItem( GUARD_KEY, String( Date.now() ) ); } catch ( e ) { /* ignore */ }
		returnToIndex();
	}, 1000 );

	// ── Reading the app's own code from the console ─────────────────────────

	var CODE_PATH = /\.(?:m?js|css|map)$/i;

	function isCodeUrl( u ) {
		try {
			var url = new URL( u, location.href );
			return url.origin === location.origin && CODE_PATH.test( url.pathname );
		} catch ( e ) {
			return false;
		}
	}

	if ( window.fetch ) {
		var nativeFetch = window.fetch;
		window.fetch = function ( input ) {
			var u = typeof input === 'string' ? input : ( input && input.url ) || String( input );
			if ( isCodeUrl( u ) ) {
				returnToIndex();
				return new Promise( function () {} );
			}
			return nativeFetch.apply( this, arguments );
		};
	}

	if ( window.XMLHttpRequest ) {
		var nativeOpen = XMLHttpRequest.prototype.open;
		XMLHttpRequest.prototype.open = function ( method, u ) {
			if ( isCodeUrl( u ) ) {
				returnToIndex();
				throw new DOMException( 'Not available', 'SecurityError' );
			}
			return nativeOpen.apply( this, arguments );
		};
	}

	// Rules of linked stylesheets (style.css). Style blocks that libraries
	// insert themselves have no href and stay readable.
	if ( window.CSSStyleSheet ) {
		[ 'cssRules', 'rules' ].forEach( function ( prop ) {
			var d = Object.getOwnPropertyDescriptor( CSSStyleSheet.prototype, prop );
			if ( ! d || ! d.get ) return;
			Object.defineProperty( CSSStyleSheet.prototype, prop, {
				configurable: false,
				enumerable: d.enumerable,
				get: function () {
					if ( this.href ) {
						returnToIndex();
						return [];
					}
					return d.get.call( this );
				},
			} );
		} );
	}

	// ── Right-click: off everywhere, Copy / Paste in text fields ────────────

	var TEXT_INPUT = /^(?:text|search|url|tel)$/;

	function textField( el ) {
		var f = el && el.closest ? el.closest( 'textarea, input' ) : null;
		if ( ! f || f.disabled ) return null;
		if ( f.tagName === 'TEXTAREA' ) return f;
		return TEXT_INPUT.test( f.type || 'text' ) ? f : null;
	}

	var menu = null, field = null, sel = { start: 0, end: 0 };

	function items() {
		return menu ? Array.prototype.slice.call( menu.querySelectorAll( '[data-act]' ) ) : [];
	}

	function toast( msg, kind ) {
		if ( typeof window.showToast === 'function' ) window.showToast( msg, undefined, kind );
	}

	function closeMenu( refocus ) {
		if ( ! menu || menu.hidden ) return;
		menu.hidden = true;
		if ( refocus && field ) {
			field.focus();
			try { field.setSelectionRange( sel.start, sel.end ); } catch ( e ) { /* ignore */ }
		}
	}

	function openMenu( f, e ) {
		if ( ! menu ) return;
		field = f;
		sel.start = f.selectionStart || 0;
		sel.end = f.selectionEnd || sel.start;
		var copyBtn = menu.querySelector( '[data-act="copy"]' );
		var pasteBtn = menu.querySelector( '[data-act="paste"]' );
		copyBtn.disabled = sel.end <= sel.start;
		pasteBtn.disabled = f.readOnly;

		// Inside a modal dialog everything else is inert, so the menu moves in.
		var host = f.closest( 'dialog[open]' ) || document.getElementById( 'osFrame' ) || document.body;
		if ( menu.parentNode !== host ) host.appendChild( menu );

		var x = e.clientX, y = e.clientY;
		if ( ! x && ! y ) { // context-menu key or Shift+F10
			var r = f.getBoundingClientRect();
			x = r.left + 16;
			y = r.top + 16;
		}
		menu.style.left = '0px';
		menu.style.top = '0px';
		menu.hidden = false;
		var w = menu.offsetWidth, h = menu.offsetHeight;
		menu.style.left = Math.max( 4, Math.min( x, window.innerWidth - w - 4 ) ) + 'px';
		menu.style.top = Math.max( 4, Math.min( y, window.innerHeight - h - 4 ) ) + 'px';
		var first = items().filter( function ( b ) { return ! b.disabled; } )[ 0 ];
		if ( first ) first.focus();
	}

	function doCopy() {
		var text = field.value.slice( sel.start, sel.end );
		closeMenu( true );
		if ( ! text ) return;
		var fallback = function () {
			field.focus();
			field.setSelectionRange( sel.start, sel.end );
			var ok = false;
			try { ok = document.execCommand( 'copy' ); } catch ( e ) { /* ignore */ }
			if ( ! ok ) toast( 'Copying was blocked by the browser. Press Ctrl+C (Cmd+C on Mac).', 'bad' );
		};
		if ( navigator.clipboard && navigator.clipboard.writeText ) {
			navigator.clipboard.writeText( text ).catch( fallback );
		} else {
			fallback();
		}
	}

	function doPaste() {
		var f = field, s = sel.start, en = sel.end;
		closeMenu( true );
		var blocked = function () {
			toast( 'Pasting from the menu was blocked by the browser. Press Ctrl+V (Cmd+V on Mac).', 'warn' );
		};
		if ( ! navigator.clipboard || ! navigator.clipboard.readText ) { blocked(); return; }
		navigator.clipboard.readText().then( function ( text ) {
			if ( ! text ) return;
			f.focus();
			f.setRangeText( text, s, en, 'end' );
			f.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} ).catch( blocked );
	}

	document.addEventListener( 'contextmenu', function ( e ) {
		e.preventDefault();
		var f = textField( e.target );
		if ( f ) openMenu( f, e );
		else closeMenu( false );
	}, true );

	// Dragging page images out would also expose them; text drag still works.
	document.addEventListener( 'dragstart', function ( e ) {
		if ( e.target && ( e.target.tagName === 'IMG' || e.target.tagName === 'CANVAS' ) ) e.preventDefault();
	}, true );

	document.addEventListener( 'DOMContentLoaded', function () {
		menu = document.getElementById( 'osCtxMenu' );
		if ( menu ) {
			menu.addEventListener( 'click', function ( e ) {
				var b = e.target.closest( '[data-act]' );
				if ( ! b || b.disabled ) return;
				if ( b.getAttribute( 'data-act' ) === 'copy' ) doCopy();
				else doPaste();
			} );
			menu.addEventListener( 'keydown', function ( e ) {
				var list = items().filter( function ( b ) { return ! b.disabled; } );
				var i = list.indexOf( document.activeElement );
				if ( e.key === 'Escape' ) { e.preventDefault(); e.stopPropagation(); closeMenu( true ); }
				else if ( e.key === 'ArrowDown' ) { e.preventDefault(); if ( list.length ) list[ ( i + 1 ) % list.length ].focus(); }
				else if ( e.key === 'ArrowUp' ) { e.preventDefault(); if ( list.length ) list[ ( i - 1 + list.length ) % list.length ].focus(); }
				else if ( e.key === 'Tab' ) { closeMenu( false ); }
			} );
			document.addEventListener( 'pointerdown', function ( e ) {
				if ( ! menu.hidden && ! menu.contains( e.target ) ) closeMenu( false );
			}, true );
			window.addEventListener( 'resize', function () { closeMenu( false ); } );
			window.addEventListener( 'blur', function () { closeMenu( false ); } );
			document.addEventListener( 'scroll', function () { closeMenu( false ); }, true );
		}

		// Restore the text typed before a return to index.html.
		try {
			var draft = sessionStorage.getItem( DRAFT_KEY );
			sessionStorage.removeItem( DRAFT_KEY );
			var out = document.getElementById( 'output' );
			if ( draft && out && ! out.value ) {
				out.value = draft;
				out.dispatchEvent( new Event( 'input', { bubbles: true } ) );
				toast( 'Your text was restored. Load the page image again to keep working on it.', 'info' );
			}
		} catch ( e ) { /* ignore */ }
	} );
}() );
