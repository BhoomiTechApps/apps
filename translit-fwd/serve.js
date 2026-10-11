#!/usr/bin/env node
/* Tiny static server for trying the app locally:   node serve.js [port]   ->   http://localhost:8080
 * (Service workers need http://localhost or HTTPS - opening index.html straight from disk will not work.)
 * For production use any static host over HTTPS; nothing here is needed there. */
const http = require( 'http' ), fs = require( 'fs' ), path = require( 'path' );
const PORT = Number( process.argv[ 2 ] ) || 8080, ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
http.createServer( ( req, res ) => {
	let p = decodeURIComponent( new URL( req.url, 'http://x' ).pathname ); if ( p.endsWith( '/' ) ) p += 'index.html';
	const file = path.join( ROOT, p );
	if ( ! file.startsWith( ROOT + path.sep ) || ! fs.existsSync( file ) || ! fs.statSync( file ).isFile() ) { res.writeHead( 404 ); return res.end( 'Not found' ); }
	// A code file opened as a page (address bar, link, location = ... in the console) goes back to the app.
	// <script>/<link> loads and the service worker's fetches are not navigations, so they still get the file.
	const isCode = /\.(?:m?js|css|map)$/i.test( file );
	const mode = req.headers[ 'sec-fetch-mode' ];
	const navigation = mode ? mode === 'navigate' : /text\/html/.test( req.headers.accept || '' );   // older browsers: no Sec-Fetch-*
	if ( isCode && navigation ) { res.writeHead( 302, { 'Location': '/index.html', 'Cache-Control': 'no-store', 'Vary': 'Sec-Fetch-Mode, Accept' } ); return res.end(); }
	const st = fs.statSync( file );
	res.writeHead( 200, { 'Content-Type': MIME[ path.extname( file ) ] || 'application/octet-stream', 'ETag': '"' + st.size + '-' + st.mtimeMs + '"', 'Cache-Control': 'no-cache', ...( isCode ? { 'Vary': 'Sec-Fetch-Mode, Accept' } : {} ) } );
	fs.createReadStream( file ).pipe( res );
} ).listen( PORT, () => console.log( 'Serving on http://localhost:' + PORT ) );
