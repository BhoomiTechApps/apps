/*
 * DynaForm PDF service worker: precaches the whole app (including the
 * ~590 KB PDF library and Bengali font) so it works with no signal.
 * Bump CACHE_VERSION whenever any file below changes.
 */
var CACHE_VERSION = "dynaform-v1.2.0";
var PRECACHE = [
	"./",
	"./index.html",
	"./manifest.webmanifest",
	"./css/app.css",
	"./css/dynaform-frontend.css",
	"./js/app.js",
	"./js/dynaform-frontend.js",
	"./js/vendor/jspdf.umd.min.js",
	"./js/vendor/noto-sans-bengali-normal.js",
	"./icons/icon-192.png",
	"./icons/icon-512.png",
	"./icons/maskable-512.png",
	"./icons/apple-touch-icon.png",
	"./icons/favicon-32.png"
];

self.addEventListener( "install", function ( event ) {
	event.waitUntil(
		caches.open( CACHE_VERSION ).then( function ( cache ) {
			// cache: "reload" bypasses the HTTP cache so a new version never
			// precaches stale files.
			return cache.addAll( PRECACHE.map( function ( url ) {
				return new Request( url, { cache: "reload" } );
			} ) );
		} )
	);
	// First install: take over right away. Updates wait for the user.
	if ( ! self.registration.active ) {
		self.skipWaiting();
	}
} );

self.addEventListener( "activate", function ( event ) {
	event.waitUntil(
		caches.keys().then( function ( keys ) {
			return Promise.all( keys.filter( function ( k ) {
				return k.indexOf( "dynaform-" ) === 0 && k !== CACHE_VERSION;
			} ).map( function ( k ) {
				return caches.delete( k );
			} ) );
		} ).then( function () {
			return self.clients.claim();
		} )
	);
} );

self.addEventListener( "message", function ( event ) {
	if ( event.data && event.data.type === "SKIP_WAITING" ) {
		self.skipWaiting();
	}
} );

self.addEventListener( "fetch", function ( event ) {
	var req = event.request;
	if ( req.method !== "GET" ) {
		return;
	}
	var url = new URL( req.url );
	if ( url.origin !== self.location.origin ) {
		return;
	}

	// Page loads (any route is a hash on index.html): serve the cached shell.
	if ( req.mode === "navigate" ) {
		event.respondWith(
			caches.match( "./index.html", { cacheName: CACHE_VERSION } ).then( function ( cached ) {
				return cached || fetch( req );
			} ).catch( function () {
				return fetch( req );
			} )
		);
		return;
	}

	// Everything else: cache first, fall back to network (and cache it).
	event.respondWith(
		caches.match( req, { ignoreSearch: true } ).then( function ( cached ) {
			if ( cached ) {
				return cached;
			}
			return fetch( req ).then( function ( res ) {
				if ( res && res.ok && res.type === "basic" ) {
					var copy = res.clone();
					caches.open( CACHE_VERSION ).then( function ( c ) {
						c.put( req, copy );
					} );
				}
				return res;
			} );
		} )
	);
} );
