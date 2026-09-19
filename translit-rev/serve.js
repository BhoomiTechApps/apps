#!/usr/bin/env node
/* Tiny static server for trying the app locally:   node serve.js [port]   ->   http://localhost:8080
 * (Service workers need http://localhost or HTTPS - opening index.html straight from disk will not work.)
 * For production use any static host over HTTPS; nothing here is needed there. */
const http = require( 'http' ), fs = require( 'fs' ), path = require( 'path' );
const PORT = Number( process.argv[ 2 ] ) || 8080, ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
http.createServer( ( req, res ) => {
	let p = decodeURIComponent( new URL( req.url, 'http://x' ).pathname ); if ( p.endsWith( '/' ) ) p += 'index.html';
	const file = path.join( ROOT, p );
	if ( ! file.startsWith( ROOT + path.sep ) || ! fs.existsSync( file ) || ! fs.statSync( file ).isFile() ) { res.writeHead( 404 ); return res.end( 'Not found' ); }
	const st = fs.statSync( file );
	res.writeHead( 200, { 'Content-Type': MIME[ path.extname( file ) ] || 'application/octet-stream', 'ETag': '"' + st.size + '-' + st.mtimeMs + '"', 'Cache-Control': 'no-cache' } );
	fs.createReadStream( file ).pipe( res );
} ).listen( PORT, () => console.log( 'Serving on http://localhost:' + PORT ) );
