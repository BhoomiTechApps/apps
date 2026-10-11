/**
 * OCR Studio — interface theme (Dark "Graphite" / Light "Stone").
 *
 * Runs synchronously right after the frame opens, so the page never flashes
 * the wrong theme. Order of precedence:
 *   1. ?theme=dark|light in the URL (per-instance override, not remembered)
 *   2. the person's own choice on this device (localStorage)
 *   3. data-default-theme on the frame (the site default; "light" if missing)
 */
( function () {
	'use strict';

	var frame = document.currentScript && document.currentScript.parentElement;
	if ( ! frame ) return;
	var KEY = 'ocr-studio:theme';
	var CHROME = { dark: '#1d1e20', light: '#d8d5ce' };

	function valid( t ) {
		return t === 'dark' || t === 'light' ? t : null;
	}

	var fromUrl = null, saved = null;
	try { fromUrl = valid( new URLSearchParams( location.search ).get( 'theme' ) ); } catch ( e ) { /* ignore */ }
	try { saved = valid( localStorage.getItem( KEY ) ); } catch ( e ) { /* ignore */ }
	var siteDefault = valid( frame.getAttribute( 'data-default-theme' ) ) || 'light';

	function syncToggle( t ) {
		var btns = frame.querySelectorAll( '[data-os-theme-set]' );
		for ( var i = 0; i < btns.length; i++ ) {
			btns[ i ].setAttribute( 'aria-pressed', btns[ i ].getAttribute( 'data-os-theme-set' ) === t ? 'true' : 'false' );
		}
	}

	function apply( t ) {
		frame.classList.remove( 'os-theme-dark', 'os-theme-light' );
		frame.classList.add( 'os-theme-' + t );
		document.documentElement.setAttribute( 'data-os-theme', t );
		var meta = document.querySelector( 'meta[name="theme-color"]' );
		if ( meta ) meta.setAttribute( 'content', CHROME[ t ] );
		syncToggle( t );
	}

	apply( fromUrl || saved || siteDefault );

	window.osGetTheme = function () {
		return frame.classList.contains( 'os-theme-dark' ) ? 'dark' : 'light';
	};
	window.osSetTheme = function ( t ) {
		t = valid( t );
		if ( ! t ) return;
		try { localStorage.setItem( KEY, t ); } catch ( e ) { /* ignore */ }
		apply( t );
	};

	document.addEventListener( 'DOMContentLoaded', function () {
		syncToggle( window.osGetTheme() );
		frame.addEventListener( 'click', function ( e ) {
			var b = e.target.closest && e.target.closest( '[data-os-theme-set]' );
			if ( b ) window.osSetTheme( b.getAttribute( 'data-os-theme-set' ) );
		} );
	} );
}() );
