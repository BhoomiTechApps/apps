/* The app's name and version: the one place they are set.
 * The frame header shows them, and sw.js uses the version to name its cache, so bumping it here
 * also gives every user a clean cache on their next visit. Bump it on every change to the code or the styles. */
( function ( g ) {
	'use strict';
	g.APP_NAME = 'Eastern Nagari to Roman';
	g.APP_VERSION = '1.2.0';
	if ( typeof document === 'undefined' ) return;               // inside the service worker
	const fill = () => document.querySelectorAll( '[data-app-version]' ).forEach( ( el ) => { el.textContent = 'v' + g.APP_VERSION; } );
	if ( document.readyState === 'loading' ) document.addEventListener( 'DOMContentLoaded', fill ); else fill();
}( typeof self !== 'undefined' ? self : this ) );
