/* Media Map service worker.
 * - App shell: precached on install, served cache-first. Bump VERSION when
 *   any app file changes; the page then offers "Update now".
 * - PDF.js fonts / character maps: cached the first time a PDF needs them.
 * - Map tiles: cache-first, kept up to a limit set in Settings. Areas saved
 *   for fieldwork live in a separate cache that is never trimmed.
 * - Everything else (place search, embeds, links) goes straight to the network.
 * - Opening a code file (.js, .mjs, .css, .map) directly as a page - typed in the address bar, a link, or
 *   location = 'js/app.js' from the console - is redirected to index.html. The page's own <script>/<link>
 *   loads, module imports and the PDF worker are not page loads, so they are served as usual.
 */
importScripts( 'js/version.js' );                // the one place the version is set
const VERSION     = self.APP_VERSION;
const SHELL_CACHE = 'mm-shell-' + VERSION;
const TILE_CACHE  = 'mm-tiles';
const SAVED_CACHE = 'mm-tiles-saved';          // areas saved for fieldwork: never trimmed
const EXTRA_CACHE = 'mm-extra-' + VERSION;   // PDF fonts / character maps, cached on first use
const SHELL = [
    './',
    'index.html',
    'manifest.webmanifest',
    'css/app.css',
    'js/guard.js',
    'js/version.js',
    'js/icons.js',
    'js/app.js',
    'js/store.js',
    'js/zip.js',
    'js/media.js',
    'js/coords.js',
    'js/pdf.js',
    'js/layers.js',
    'js/forms.js',
    'js/reports.js',
    'js/offline.js',
    'js/basemap.js',
    'vendor/pdfjs/pdf.min.js',
    'vendor/pdfjs/pdf.worker.min.js',
    'vendor/leaflet/leaflet.min.js',
    'vendor/leaflet/leaflet.min.css',
    'vendor/markercluster/leaflet.markercluster.min.js',
    'vendor/markercluster/MarkerCluster.css',
    'vendor/markercluster/MarkerCluster.Default.css',
    'vendor/onest/onest-latin-wght-normal.woff2',
    'vendor/onest/onest-latin-ext-wght-normal.woff2',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/favicon-32.png',
    'icons/apple-touch-icon.png',
];
const scopeUrl = p => new URL( p, self.registration.scope ).href;

self.addEventListener( 'install', event => {
    event.waitUntil( ( async () => {
        const cache = await caches.open( SHELL_CACHE );
        await cache.addAll( SHELL.map( p => new Request( scopeUrl( p ), { cache: 'reload' } ) ) );
        // First install: take over straight away. Updates wait for the page.
        if ( ! ( await self.clients.matchAll() ).length ) self.skipWaiting();
    } )() );
} );

self.addEventListener( 'activate', event => {
    event.waitUntil( ( async () => {
        for ( const key of await caches.keys() ) {
            if ( ( key.startsWith( 'mm-shell-' ) && key !== SHELL_CACHE ) || ( key.startsWith( 'mm-extra-' ) && key !== EXTRA_CACHE ) ) await caches.delete( key );
        }
        await self.clients.claim();
    } )() );
} );

self.addEventListener( 'message', event => {
    if ( event.data && event.data.type === 'skipWaiting' ) self.skipWaiting();
    if ( event.data && event.data.type === 'tileRe' ) setTileRe( event.data.re );
} );

const CODE_FILE = /\.(?:m?js|css|map)$/i;
const TILE_RE = /\/\d{1,2}\/\d+\/\d+(@2x)?\.(png|jpe?g|webp|pbf)(\?|$)/i;

// The current basemap's own URL pattern, shared by the page, so tiles from any
// kind of basemap (WMS, quadkey, query-string servers…) are kept for offline use.
let tileRe = null, tileReReady = null;
function setTileRe( src ) {
    try { tileRe = src ? new RegExp( src, 'i' ) : false; } catch { tileRe = false; }
}
function loadTileRe() {
    if ( ! tileReReady ) tileReReady = readKv( 'tileRe' ).then( v => { if ( tileRe === null ) setTileRe( v ); } );
    return tileReReady;
}
loadTileRe();
const isTile = url => TILE_RE.test( url.pathname + url.search ) || ( tileRe && tileRe.test( url.href ) );

self.addEventListener( 'fetch', event => {
    const req = event.request;
    if ( req.method !== 'GET' ) return;
    const url = new URL( req.url );

    if ( url.origin === self.location.origin ) {
        if ( req.mode === 'navigate' && CODE_FILE.test( url.pathname ) ) {
            event.respondWith( Response.redirect( scopeUrl( 'index.html' ), 302 ) );
            return;
        }
        if ( req.mode === 'navigate' ) {
            // Any page load inside the app (including share-target URLs) gets the shell.
            event.respondWith( ( async () => {
                const cached = await caches.match( scopeUrl( 'index.html' ) );
                if ( cached ) return cached;
                try { return await fetch( req ); }
                catch { return new Response( 'Media Map is offline and not installed yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } } ); }
            } )() );
            return;
        }
        event.respondWith( ( async () => {
            const cached = await caches.match( req, { ignoreSearch: true } );
            if ( cached ) return cached;
            const res = await fetch( req );
            if ( res.ok && url.pathname.includes( '/vendor/pdfjs/' ) ) {
                const copy = res.clone();
                event.waitUntil( caches.open( EXTRA_CACHE ).then( c => c.put( req, copy ) ) );
            }
            return res;
        } )() );
        return;
    }

    if ( req.destination !== 'image' ) return;
    if ( isTile( url ) ) { event.respondWith( tile( req, event ) ); return; }
    if ( tileRe === null ) {
        // Worker just woke up and hasn't read the pattern yet: decide once it has.
        event.respondWith( loadTileRe().then( () => isTile( url ) ? tile( req, event ) : fetch( req ) ) );
    }
} );

let putsSinceTrim = 0;
async function tile( req, event ) {
    const cache = await caches.open( TILE_CACHE );
    const hit = await cache.match( req, { ignoreVary: true } )
        || await ( await caches.open( SAVED_CACHE ) ).match( req, { ignoreVary: true } );
    if ( hit ) return hit;
    const res = await fetch( req );
    // Only CORS responses are stored: opaque ones can't be checked and
    // count as several MB each against the storage quota.
    if ( res.ok && res.type === 'cors' ) {
        event.waitUntil( cache.put( req, res.clone() ).then( () => {
            if ( ++putsSinceTrim >= 50 ) { putsSinceTrim = 0; return trimTiles( cache ); }
        } ).catch( () => {} ) );
    }
    return res;
}

async function trimTiles( cache ) {
    const max  = Number( await readKv( 'maxTiles' ) ) || 3000;
    const keys = await cache.keys();
    // Keys come back in insertion order, so the oldest tiles go first.
    for ( let i = 0; i < keys.length - max; i++ ) await cache.delete( keys[ i ] );
}

function readKv( key ) {
    return new Promise( resolve => {
        try {
            const open = indexedDB.open( 'mediamap-pwa', 1 );
            open.onupgradeneeded = () => open.result.createObjectStore( 'kv' );
            open.onerror = () => resolve( undefined );
            open.onsuccess = () => {
                try {
                    const get = open.result.transaction( 'kv' ).objectStore( 'kv' ).get( key );
                    get.onsuccess = () => resolve( get.result );
                    get.onerror = () => resolve( undefined );
                } catch { resolve( undefined ); }
            };
        } catch { resolve( undefined ); }
    } );
}
