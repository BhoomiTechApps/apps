// Run:  node tests/docfile.test.js
const path = require( 'path' );
const D = require( path.join( __dirname, '../docfile.js' ) );

let pass = 0, fail = 0;
const check = ( name, ok, detail ) => { if ( ok ) pass++; else { fail++; console.log( 'FAIL', name, detail || '' ); } };
const j = JSON.stringify;
const bytes = ( a ) => Uint8Array.from( a );
const utf8 = ( s ) => new TextEncoder().encode( s );

const bn = 'আমি তমায় ভালবাশি\nদ্বিতীয় লাইন';

// 1. Round trip: what is saved opens as the same text.
check( 'round trip Bengali', D.decode( D.encode( bn ) ).text === bn );
check( 'round trip empty', D.decode( D.encode( '' ) ).text === '' );
check( 'encode writes no BOM', D.encode( 'a' ).length === 1 && D.encode( 'a' )[ 0 ] === 0x61 );
check( 'encode is UTF-8', j( Array.from( D.encode( 'অ' ) ) ) === j( [ 0xE0, 0xA6, 0x85 ] ) );

// 2. Other files people may have.
check( 'UTF-8 with BOM', D.decode( bytes( [ 0xEF, 0xBB, 0xBF, ...utf8( bn ) ] ) ).text === bn );
const u16le = [ 0xFF, 0xFE ]; for ( const c of 'অa' ) { const n = c.charCodeAt( 0 ); u16le.push( n & 255, n >> 8 ); }
check( 'UTF-16 LE with BOM', D.decode( bytes( u16le ) ).text === 'অa', j( D.decode( bytes( u16le ) ) ) );
const u16be = [ 0xFE, 0xFF ]; for ( const c of 'অa' ) { const n = c.charCodeAt( 0 ); u16be.push( n >> 8, n & 255 ); }
check( 'UTF-16 BE with BOM', D.decode( bytes( u16be ) ).text === 'অa' );
check( 'Windows line endings', D.decode( utf8( 'a\r\nb\r\n' ) ).text === 'a\nb\n' );
check( 'old Mac line endings', D.decode( utf8( 'a\rb' ) ).text === 'a\nb' );
check( 'tabs are kept', D.decode( utf8( 'a\tb' ) ).text === 'a\tb' );
check( 'encode normalizes line endings', D.decode( D.encode( 'a\r\nb' ) ).text === 'a\nb' );

// 3. Refused, with a message.
check( 'invalid UTF-8 (e.g. Windows-1252)', D.decode( bytes( [ 0x63, 0x61, 0x66, 0xE9 ] ) ).error === 'not-text' );
check( 'binary (PNG header)', D.decode( bytes( [ 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13 ] ) ).error === 'not-text' );
check( 'zip / docx', D.decode( bytes( [ 0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00 ] ) ).error === 'not-text' );
check( 'too big', D.decode( new Uint8Array( D.MAX_BYTES + 1 ) ).error === 'too-big' );
check( 'messages exist', /too large/.test( D.message( 'too-big' ) ) && /plain text/.test( D.message( 'not-text' ) ) );

// 4. Signature tells changed from unchanged text.
check( 'signature stable', D.signature( bn ) === D.signature( bn.slice() ) );
check( 'signature changes', D.signature( bn ) !== D.signature( bn + ' ' ) && D.signature( 'ab' ) !== D.signature( 'ba' ) );
check( 'signature of empty', typeof D.signature( '' ) === 'string' && D.signature( '' ) !== D.signature( ' ' ) );

// 5. File names.
check( 'defaultName', D.defaultName( new Date( 2026, 9, 1 ) ) === 'translit-2026-10-01.txt', D.defaultName( new Date( 2026, 9, 1 ) ) );
const names = [
	[ 'notes', 'notes.txt' ], [ 'notes.txt', 'notes.txt' ], [ 'notes.TXT', 'notes.txt' ], [ '  my  notes  ', 'my notes.txt' ],
	[ 'আমার লেখা', 'আমার লেখা.txt' ], [ 'a/b\\c:d*e?f"g<h>i|j', 'a b c d e f g h i j.txt' ], [ '..hidden', 'hidden.txt' ],
	[ 'draft.', 'draft.txt' ], [ 'draft.txt.', 'draft.txt' ], [ 'v1.2', 'v1.2.txt' ], [ '', '' ], [ '   ', '' ], [ '.txt', '' ], [ '///', '' ], [ null, '' ],
];
names.forEach( ( [ a, b ] ) => check( 'cleanName ' + j( a ), D.cleanName( a ) === b, j( D.cleanName( a ) ) ) );
check( 'cleanName caps length', D.cleanName( 'x'.repeat( 300 ) ).length === 124 );
check( 'stem', D.stem( 'abc.txt' ) === 'abc' && D.stem( 'abc' ) === 'abc' );

console.log( pass + ' passed, ' + fail + ' failed' );
process.exit( fail ? 1 : 0 );
