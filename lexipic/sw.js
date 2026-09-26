/* LexiPic service worker — offline app shell.
 * Bump VERSION on every release so clients pick up new files. */
const VERSION = 'lexipic-2.0.1';
const SHELL = [
	'./',
	'index.html',
	'manifest.webmanifest',
	'css/app.css',
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
];
const FONT_CACHE = 'lexipic-fonts';

self.addEventListener( 'install', ( e ) => {
	e.waitUntil( caches.open( VERSION ).then( c => c.addAll( SHELL.map( u => new Request( u, { cache: 'reload' } ) ) ) ) );
} );

self.addEventListener( 'activate', ( e ) => {
	e.waitUntil( ( async () => {
		const keys = await caches.keys();
		await Promise.all( keys.filter( k => k !== VERSION && k !== FONT_CACHE ).map( k => caches.delete( k ) ) );
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

	// Google Fonts: stale-while-revalidate so the script font works offline
	// after the first visit (system fonts are the fallback until then).
	if ( url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' ) {
		e.respondWith( ( async () => {
			const cache = await caches.open( FONT_CACHE );
			const hit = await cache.match( req );
			const net = fetch( req ).then( ( res ) => {
				if ( res && ( res.ok || res.type === 'opaque' ) ) cache.put( req, res.clone() );
				return res;
			} ).catch( () => hit );
			return hit || net;
		} )() );
		return;
	}

	if ( url.origin !== self.location.origin ) return;

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
