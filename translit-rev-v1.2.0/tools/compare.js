// Usage:  node tools/compare.js input.txt expected.txt [--plain]
// Converts the Bengali input with the app's engine (bundle + mapping.js; --plain = bundle only), lines it up with your expected
// Roman text word by word (an input word may match 1-3 expected words), and prints every difference plus a ready-to-paste
// line for the  words  section of mapping.js. ZWNJ is shown as \u200C.
const fs = require( 'fs' ), path = require( 'path' );
const bundle = require( path.join( __dirname, '../vendor/translit-reverse.min.js' ) );
const engine = process.argv.includes( '--plain' ) ? bundle : require( path.join( __dirname, '../rules.js' ) ).build( bundle );
const [ inFile, expFile ] = process.argv.slice( 2 ).filter( a => ! a.startsWith( '--' ) );
if ( ! inFile || ! expFile ) { console.log( 'usage: node tools/compare.js input.txt expected.txt [--plain]' ); process.exit( 1 ); }
const BENGALI = /[\u0964\u0965\u0980-\u09FF]/;
const iw = fs.readFileSync( inFile, 'utf8' ).split( /\s+/ ).filter( Boolean ), ew = fs.readFileSync( expFile, 'utf8' ).split( /\s+/ ).filter( Boolean );
const out = iw.map( w => BENGALI.test( w ) ? engine.transliterate( w ) : w );
const key = s => s.replace( /[\u200C\s]/g, '' ).toLowerCase();
function dist( a, b ) { const m = a.length, n = b.length; let p = Array.from( { length: n + 1 }, ( _, j ) => j );
	for ( let i = 1; i <= m; i++ ) { const c = [ i ]; for ( let j = 1; j <= n; j++ ) c[ j ] = Math.min( p[ j ] + 1, c[ j - 1 ] + 1, p[ j - 1 ] + ( a[ i - 1 ] === b[ j - 1 ] ? 0 : 1 ) ); p = c; } return p[ n ]; }
// dynamic programming: input word i takes expected words j..j+k-1 (k = 1..3); cost = letter distance ignoring ZWNJ / spaces
const INF = 1e9, N = iw.length, M = ew.length, best = Array.from( { length: N + 1 }, () => new Array( M + 1 ).fill( INF ) ), back = Array.from( { length: N + 1 }, () => new Array( M + 1 ) );
best[ 0 ][ 0 ] = 0;
for ( let i = 0; i < N; i++ ) for ( let j = 0; j < M; j++ ) if ( best[ i ][ j ] < INF ) for ( let k = 1; k <= 3 && j + k <= M; k++ ) {
	const c = best[ i ][ j ] + dist( key( out[ i ] ), key( ew.slice( j, j + k ).join( ' ' ) ) ) + ( k - 1 ) * 0.5;
	if ( c < best[ i + 1 ][ j + k ] ) { best[ i + 1 ][ j + k ] = c; back[ i + 1 ][ j + k ] = k; } }
if ( best[ N ][ M ] >= INF ) { console.log( 'could not line the two texts up (are they the same text?)' ); process.exit( 1 ); }
const spans = []; for ( let i = N, j = M; i > 0; i-- ) { const k = back[ i ][ j ]; spans.unshift( ew.slice( j - k, j ).join( ' ' ) ); j -= k; }
const show = s => s.replace( /\u200C/g, '\\u200C' ), seen = new Set(); let ok = 0;
iw.forEach( ( w, i ) => { if ( out[ i ] === spans[ i ] ) { ok++; return; } if ( seen.has( w ) ) return; seen.add( w );
	console.log( w.padEnd( 20 ) + show( out[ i ] ).padEnd( 26 ) + '->  ' + show( spans[ i ] ) ); } );
console.log( `\n${ ok } of ${ iw.length } words exact. ${ seen.size ? 'Paste-ready lines for the "words" section of mapping.js:' : '' }` );
seen.forEach( () => {} ); const done = new Set();
iw.forEach( ( w, i ) => { const bare = w.replace( /[\u0964\u0965]+$/, '' ), tail = spans[ i ].replace( /[.,;:!?]+$/, '' ); if ( out[ i ] !== spans[ i ] && ! done.has( bare ) ) { done.add( bare ); console.log( `\t'${ show( bare ) }': '${ show( tail ) }',` ); } } );
