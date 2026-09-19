/* Service worker: makes the app work offline and keeps it fresh.
 *
 *  - install:  downloads the whole app shell into a cache (bypassing the browser's HTTP cache).
 *  - fetch:    answers from the cache at once (so it works offline and starts instantly).
 *  - freshness: every time the app is opened (a navigation), the code files (see REFRESH) are re-downloaded in the background;
 *              any file whose bytes changed replaces the cached copy and the page is told ("UPDATED"), which
 *              offers a reload. So replacing a file - for example a new vendor/translit-reverse.min.js - reaches
 *              users without touching this file. Files are revalidated with `cache: 'no-cache'`, so a long
 *              Cache-Control max-age on your server does not delay updates.
 *  - Bump VERSION only to force a clean cache (e.g. after deleting or renaming files).
 */
const VERSION = 'v2';
const CACHE = 'translit-reverse-pwa-' + VERSION;      // its own name: the forward app may live on the same origin
const BASE = self.registration.scope;                       // works from any sub-folder
const url = ( p ) => new URL( p, BASE ).href;
const INDEX = url( 'index.html' );

const CODE = [ 'index.html', 'styles.css', 'app.js', 'inplace.js', 'manifest.webmanifest', 'vendor/translit-reverse.min.js' ].map( url );
const ICONS = [ 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png' ].map( url );
const SHELL = CODE.concat( ICONS );                          // cached at install
const REFRESH = CODE;                                        // re-checked on every app open

self.addEventListener( 'install', ( event ) => {
	event.waitUntil(
		caches.open( CACHE )
			.then( ( c ) => c.addAll( SHELL.map( ( u ) => new Request( u, { cache: 'reload' } ) ) ) )
			.then( () => self.skipWaiting() )
	);
} );

self.addEventListener( 'activate', ( event ) => {
	event.waitUntil(
		caches.keys()
			.then( ( keys ) => Promise.all( keys.filter( ( k ) => k.startsWith( 'translit-reverse-pwa-' ) && k !== CACHE ).map( ( k ) => caches.delete( k ) ) ) )
			.then( () => self.clients.claim() )
	);
} );

async function sameBytes( a, b ) {
	const [ x, y ] = await Promise.all( [ a.clone().arrayBuffer(), b.clone().arrayBuffer() ] );
	if ( x.byteLength !== y.byteLength ) return false;
	const p = new Uint8Array( x ), q = new Uint8Array( y );
	for ( let i = 0; i < p.length; i++ ) if ( p[ i ] !== q[ i ] ) return false;
	return true;
}

async function notify( file ) {
	for ( const c of await self.clients.matchAll( { type: 'window' } ) ) c.postMessage( { type: 'UPDATED', url: file } );
}

/** Re-download one file; if it differs from the cached copy, store it and tell the page. */
async function revalidate( cache, request ) {
	const res = await fetch( request, { cache: 'no-cache' } );
	if ( res && res.ok && res.type === 'basic' ) {
		const old = await cache.match( request, { ignoreSearch: true } );     // a fresh, unread Response every time
		const changed = old ? ! ( await sameBytes( old, res ) ) : false;
		await cache.put( request, res.clone() );
		if ( changed ) await notify( request.url );
	}
	return res;
}

async function respond( event ) {
	const req = event.request;
	const cache = await caches.open( CACHE );
	const isNav = req.mode === 'navigate';
	const target = isNav ? new Request( INDEX ) : req;                        // every page load gets the app shell
	const cached = await cache.match( target, { ignoreSearch: true } );

	// Opening the app re-checks every code file, whatever the browser then does with its own memory cache.
	if ( isNav ) event.waitUntil( Promise.all( REFRESH.map( ( u ) => revalidate( cache, new Request( u ) ).catch( () => null ) ) ) );

	if ( cached ) return cached;
	// Not cached (a file that is not in the lists above): fetch it and remember it.
	try {
		const res = await fetch( req );
		if ( res.ok && res.type === 'basic' ) await cache.put( req, res.clone() );
		return res;
	} catch ( e ) {
		return Response.error();
	}
}

self.addEventListener( 'fetch', ( event ) => {
	const req = event.request;
	if ( req.method !== 'GET' || new URL( req.url ).origin !== self.location.origin ) return;
	event.respondWith( respond( event ) );
} );
