/* LexiPic service worker — offline app shell.
 * Bump VERSION on every release so clients pick up new files.
 *
 * Code files (.js, .css, source maps) are only handed to the page's own <script> and <link> tags. Opening one
 * in the address bar goes back to the app, and fetching one from the console gets index.html instead. */
const VERSION = 'lexipic-2.1.3';
const SHELL = [
	'./',
	'index.html',
	'manifest.webmanifest',
	'css/app.css',
	'js/guard.js',
	'js/theme.js',
	'js/app.js',
	'js/db.js',
	'js/ime.js',
	'js/transfer.js',
	'js/engine.js',
	'ime/default/forwardMap.json',
	'ime/default/reverseMap.json',
	'ime/default/defaults.json',
	'ime/default/js-engine-settings.default.json',
	'icons/icon.svg',
	'icons/icon-192.png',
	'icons/icon-512.png',
	'icons/maskable-512.png',
	'icons/apple-touch-icon.png',
	'vendor/onest/onest-latin-wght-normal.woff2',
	'vendor/onest/onest-latin-ext-wght-normal.woff2',
	'vendor/noto-serif-bengali/noto-serif-bengali-bengali-wght-normal.woff2',
];

self.addEventListener( 'install', ( e ) => {
	e.waitUntil( caches.open( VERSION ).then( c => c.addAll( SHELL.map( u => new Request( u, { cache: 'reload' } ) ) ) ) );
} );

self.addEventListener( 'activate', ( e ) => {
	e.waitUntil( ( async () => {
		const keys = await caches.keys();
		await Promise.all( keys.filter( k => k !== VERSION ).map( k => caches.delete( k ) ) );
		await self.clients.claim();
	} )() );
} );

self.addEventListener( 'message', ( e ) => {
	if ( e.data && e.data.type === 'SKIP_WAITING' ) self.skipWaiting();
} );

self.addEventListener( 'fetch', ( e ) => {
	const req = e.request;
	if ( req.method !== 'GET' ) return;
	const url = new URL( req.url );

	if ( url.origin !== self.location.origin ) return;

	// Code files stay with the app (see the note at the top).
	if ( isCode( url ) && ! LOADERS.has( req.destination ) ) {
		e.respondWith( backToApp( req ) );
		return;
	}

	// App navigations: serve the cached shell (query strings like ?tab=add included).
	if ( req.mode === 'navigate' ) {
		e.respondWith( caches.match( 'index.html' ).then( hit => hit || fetch( req ) ) );
		return;
	}

	// Shell assets: cache first, then network (and cache the result).
	e.respondWith( caches.match( req, { ignoreSearch: true } ).then( hit => hit || fetch( req ).then( ( res ) => {
		if ( res.ok ) {
			const copy = res.clone();
			caches.open( VERSION ).then( c => c.put( req, copy ) );
		}
		return res;
	} ) ) );
} );

// Only these request types may receive a .js or .css file: the page's <script> tags and module imports, its
// <link rel=stylesheet>, and the service worker's own update check. A typed address ('document'), a frame, or
// fetch()/XHR from the console ('') gets the app instead.
const LOADERS = new Set( [ 'script', 'style', 'worker', 'sharedworker', 'serviceworker' ] );

function isCode( url ) {
	return /\.(m?js|css|map)$/i.test( url.pathname );
}

async function backToApp( req ) {
	const home = new URL( './', self.registration.scope ).href;
	// An opened page is sent back to the app's address (so its relative links still work);
	// anything else just receives index.html, never the code.
	if ( req.mode === 'navigate' ) return Response.redirect( home, 302 );
	const page = await caches.match( 'index.html' ) || await fetch( home ).catch( () => null );
	return page || new Response( '', { status: 404 } );
}
