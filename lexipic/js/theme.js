/* LexiPic: theme.js
 *
 * Applies the interface theme before the first paint. Light ("Stone") is the default; Dark ("Graphite") is chosen
 * in Settings → Appearance and saved on this device. ?theme=dark|light in the address overrides the saved choice
 * for that visit only (handy for a shared link).
 *
 * Loaded as a classic script straight after the frame's opening tag (the Content-Security-Policy does not allow
 * inline scripts), so the frame already exists. js/app.js calls LexiPicTheme.set() when the setting changes.
 */
( function () {
	'use strict';

	var KEY = 'lexipic_theme';
	var COLOURS = { light: '#d8d5ce', dark: '#1d1e20' };   // --lp-frame of each theme, for the browser bar
	var fromUrl = ( /[?&]theme=(dark|light)(?:&|$)/.exec( location.search ) || [] )[ 1 ] || '';

	function saved() {
		try { var s = localStorage.getItem( KEY ); if ( s === 'dark' || s === 'light' ) return s; } catch ( e ) {}
		return 'light';
	}

	function apply( t ) {
		var f = document.getElementById( 'lp-frame' );
		if ( f ) {
			f.classList.remove( 'lp-theme-dark', 'lp-theme-light' );
			f.classList.add( 'lp-theme-' + t );
		}
		document.documentElement.setAttribute( 'data-lp-theme', t );
		var meta = document.querySelector( 'meta[name=theme-color]' );
		if ( meta ) meta.content = COLOURS[ t ];
		var cs = document.querySelector( 'meta[name=color-scheme]' );
		if ( cs ) cs.content = t;
	}

	window.LexiPicTheme = {
		/** The theme on screen now. */
		current: function () { return document.documentElement.getAttribute( 'data-lp-theme' ) || 'light'; },
		/** The theme saved on this device. */
		saved: saved,
		/** True while ?theme= in the address overrides the saved choice. */
		overridden: function () { return !! fromUrl; },
		/** Save a choice and show it (an address override stays on screen until the next visit). */
		set: function ( t ) {
			if ( t !== 'dark' && t !== 'light' ) return;
			try { localStorage.setItem( KEY, t ); } catch ( e ) {}
			fromUrl = '';
			apply( t );
		},
	};

	apply( fromUrl || saved() );
}() );
