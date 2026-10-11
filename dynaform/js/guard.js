/*
 * DynaForm PDF — interface guard.
 *
 * 1. Right-click is switched off everywhere. In text fields it opens a
 *    small menu with only Copy and Paste.
 * 2. Developer-tools shortcuts and "view source" are blocked, and opening
 *    the developer tools / console sends the page back to index.html.
 *
 * This is a deterrent, not real protection: anything a browser runs can
 * be read by someone determined (another browser, a download tool, JS
 * switched off). Set GUARD_DEVTOOLS to false while you work on the code.
 */
( function () {
	"use strict";

	var GUARD_DEVTOOLS = true;

	var HOME = new URL( "index.html", location.href.split( "#" )[ 0 ] ).href;
	var leaving = false;
	function goHome() {
		if ( leaving ) {
			return;
		}
		leaving = true;
		location.replace( HOME );
	}

	var isMac = /Mac|iPhone|iPad/.test( navigator.platform || navigator.userAgent );
	function ico( name ) {
		return ( window.DF_ICONS && window.DF_ICONS[ name ] ) || "";
	}
	function root() {
		return document.getElementById( "df-frame" ) || document.body;
	}

	/* ===============================================================
	 * 1. Context menu: Copy / Paste in text fields only
	 * ============================================================= */

	var FIELD_SEL = 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="tel"], input[type="email"], input[type="number"], input[type="password"]';
	var menu = null;
	var target = null; // { el, start, end }

	function hasSelectionApi( el ) {
		try {
			return typeof el.selectionStart === "number";
		} catch ( e ) {
			return false;
		}
	}

	function buildMenu() {
		menu = document.createElement( "div" );
		menu.className = "df-ctx";
		menu.setAttribute( "role", "menu" );
		menu.setAttribute( "aria-label", "Text actions" );
		menu.hidden = true;
		var key = isMac ? "\u2318" : "Ctrl+";
		menu.innerHTML =
			'<button type="button" role="menuitem" data-act="copy">' + ico( "copy" ) + "<span>Copy</span><kbd>" + key + "C</kbd></button>" +
			'<button type="button" role="menuitem" data-act="paste">' + ico( "paste" ) + "<span>Paste</span><kbd>" + key + "V</kbd></button>";
		// Keep focus (and the selection) in the field when clicking the menu.
		menu.addEventListener( "mousedown", function ( e ) {
			e.preventDefault();
		} );
		menu.addEventListener( "click", function ( e ) {
			var b = e.target.closest( "button[data-act]" );
			if ( b && ! b.disabled ) {
				run( b.getAttribute( "data-act" ) );
			}
		} );
		menu.addEventListener( "keydown", function ( e ) {
			var items = Array.prototype.filter.call( menu.querySelectorAll( "button" ), function ( b ) {
				return ! b.disabled;
			} );
			var i = items.indexOf( document.activeElement );
			if ( e.key === "ArrowDown" || e.key === "ArrowUp" ) {
				e.preventDefault();
				var n = items.length;
				if ( n ) {
					items[ ( i + ( e.key === "ArrowDown" ? 1 : n - 1 ) ) % n ].focus();
				}
			} else if ( e.key === "Tab" ) {
				e.preventDefault();
				hideMenu( true );
			}
		} );
	}

	function showMenu( el, x, y, fromKeyboard ) {
		if ( ! menu ) {
			buildMenu();
		}
		if ( menu.parentNode !== root() ) {
			root().appendChild( menu );
		}
		var start = null;
		var end = null;
		var hasSel = true;
		if ( hasSelectionApi( el ) ) {
			start = el.selectionStart;
			end = el.selectionEnd;
			hasSel = start !== end;
		}
		target = { el: el, start: start, end: end };
		menu.querySelector( '[data-act="copy"]' ).disabled = ! hasSel || ( el.type === "password" );
		menu.querySelector( '[data-act="paste"]' ).disabled = el.readOnly || el.disabled;

		menu.hidden = false;
		menu.style.left = "0px";
		menu.style.top = "0px";
		var r = menu.getBoundingClientRect();
		if ( fromKeyboard ) {
			var fr = el.getBoundingClientRect();
			x = fr.left + 12;
			y = fr.top + Math.min( fr.height, 40 );
		}
		x = Math.max( 6, Math.min( x, window.innerWidth - r.width - 6 ) );
		y = Math.max( 6, Math.min( y, window.innerHeight - r.height - 6 ) );
		menu.style.left = x + "px";
		menu.style.top = y + "px";
		if ( fromKeyboard ) {
			var first = menu.querySelector( "button:not(:disabled)" );
			if ( first ) {
				first.focus();
			}
		}
	}

	function hideMenu( refocus ) {
		if ( ! menu || menu.hidden ) {
			return;
		}
		menu.hidden = true;
		if ( refocus && target ) {
			restoreFocus();
		}
	}

	function restoreFocus() {
		var el = target.el;
		el.focus( { preventScroll: true } );
		if ( target.start !== null ) {
			try {
				el.setSelectionRange( target.start, target.end );
			} catch ( e ) {}
		}
	}

	function message( text ) {
		var el = root().querySelector( ".toast" );
		if ( ! el ) {
			el = document.createElement( "div" );
			el.className = "toast";
			el.setAttribute( "role", "status" );
			root().appendChild( el );
		}
		el.className = "toast";
		el.textContent = text;
		el.hidden = false;
		clearTimeout( message.t );
		message.t = setTimeout( function () {
			el.hidden = true;
		}, 2600 );
	}

	function insertText( el, text ) {
		if ( maxLeft( el ) < text.length ) {
			text = text.slice( 0, Math.max( 0, maxLeft( el ) ) );
		}
		var ok = false;
		try {
			ok = document.execCommand( "insertText", false, text ); // keeps undo history
		} catch ( e ) {}
		if ( ! ok ) {
			if ( hasSelectionApi( el ) && typeof el.setRangeText === "function" ) {
				el.setRangeText( text, el.selectionStart, el.selectionEnd, "end" );
			} else {
				el.value = el.value + text;
			}
			el.dispatchEvent( new Event( "input", { bubbles: true } ) );
		}
	}
	function maxLeft( el ) {
		var max = el.maxLength;
		if ( ! ( max >= 0 ) ) {
			return Infinity;
		}
		var selLen = hasSelectionApi( el ) ? el.selectionEnd - el.selectionStart : 0;
		return max - el.value.length + selLen;
	}

	function run( act ) {
		var t = target;
		hideMenu( false );
		if ( ! t ) {
			return;
		}
		restoreFocus();
		var el = t.el;
		if ( act === "copy" ) {
			var text = t.start !== null ? el.value.slice( t.start, t.end ) : "";
			var viaCommand = function () {
				try {
					return document.execCommand( "copy" );
				} catch ( e ) {
					return false;
				}
			};
			if ( text && navigator.clipboard && navigator.clipboard.writeText ) {
				navigator.clipboard.writeText( text ).catch( function () {
					if ( ! viaCommand() ) {
						message( "Copy blocked by the browser. Use " + ( isMac ? "\u2318C" : "Ctrl+C" ) + "." );
					}
				} );
			} else if ( ! viaCommand() ) {
				message( "Copy blocked by the browser. Use " + ( isMac ? "\u2318C" : "Ctrl+C" ) + "." );
			}
		} else if ( act === "paste" ) {
			var fail = function () {
				restoreFocus();
				message( "Allow clipboard access, or press " + ( isMac ? "\u2318V" : "Ctrl+V" ) + " to paste." );
			};
			if ( ! navigator.clipboard || ! navigator.clipboard.readText ) {
				fail();
				return;
			}
			navigator.clipboard.readText().then( function ( clip ) {
				restoreFocus();
				if ( clip ) {
					if ( el.tagName !== "TEXTAREA" ) {
						clip = clip.replace( /[\r\n]+/g, " " );
					}
					insertText( el, clip );
				}
			}, fail );
		}
	}

	document.addEventListener( "contextmenu", function ( e ) {
		e.preventDefault();
		var el = e.target && e.target.closest ? e.target.closest( FIELD_SEL ) : null;
		if ( ! el && document.activeElement && document.activeElement.matches && document.activeElement.matches( FIELD_SEL ) && e.target === document.activeElement ) {
			el = document.activeElement;
		}
		if ( el && ! el.disabled ) {
			var fromKeyboard = e.button !== 2 && e.clientX === 0 && e.clientY === 0;
			showMenu( el, e.clientX, e.clientY, fromKeyboard );
		} else {
			hideMenu( false );
		}
	}, true );

	document.addEventListener( "mousedown", function ( e ) {
		if ( menu && ! menu.hidden && ! menu.contains( e.target ) ) {
			hideMenu( false );
		}
	}, true );
	document.addEventListener( "keydown", function ( e ) {
		if ( e.key === "Escape" && menu && ! menu.hidden ) {
			e.stopPropagation();
			hideMenu( true );
		}
	}, true );
	window.addEventListener( "scroll", function () {
		hideMenu( false );
	}, true );
	window.addEventListener( "resize", function () {
		hideMenu( false );
	} );
	window.addEventListener( "blur", function () {
		hideMenu( false );
	} );

	/* ===============================================================
	 * 2. Keep the source out of reach of the console / dev tools
	 * ============================================================= */

	if ( ! GUARD_DEVTOOLS ) {
		return;
	}

	// Shortcuts for dev tools, console, inspector and view-source.
	window.addEventListener( "keydown", function ( e ) {
		var code = e.code || "";
		var key = ( e.key || "" ).toLowerCase();
		var ctrl = e.ctrlKey || e.metaKey;
		var devtools =
			key === "f12" || code === "F12" ||
			( ctrl && e.shiftKey && /^Key[IJCKE]$/.test( code ) ) ||
			( e.metaKey && e.altKey && /^Key[IJCU]$/.test( code ) ) ||
			( ctrl && ! e.shiftKey && ! e.altKey && code === "KeyU" );
		if ( devtools ) {
			e.preventDefault();
			e.stopPropagation();
			goHome();
			return;
		}
		// Save page (would write the code to disk). Forms autosave, so just block it.
		if ( ctrl && ! e.altKey && code === "KeyS" ) {
			e.preventDefault();
		}
	}, true );

	// Open dev tools pause on a debugger statement; a long pause means
	// someone is looking, so leave.
	var trap = Function( "debugger" ); // eslint-disable-line no-new-func
	function probe() {
		var t0 = performance.now();
		trap();
		if ( performance.now() - t0 > 150 ) {
			goHome();
		}
	}
	setInterval( probe, 1000 );

	// Docked dev tools (desktop, mouse only): the viewport shrinks while
	// the window and zoom stay the same.
	var desktop = window.matchMedia && window.matchMedia( "(pointer: fine)" ).matches && ! navigator.maxTouchPoints;
	if ( desktop ) {
		var snap = function () {
			return { ow: window.outerWidth, oh: window.outerHeight, iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio };
		};
		var base = snap();
		window.addEventListener( "resize", function () {
			var s = snap();
			if ( s.ow !== base.ow || s.oh !== base.oh || s.dpr !== base.dpr || s.iw >= base.iw && s.ih >= base.ih ) {
				base = s; // window resized, zoomed, or a panel closed
				return;
			}
			if ( base.iw - s.iw > 160 || base.ih - s.ih > 160 ) {
				goHome();
			}
		} );
	}
} )();
