// Run:  node tests/barnamala.test.js
const path = require( 'path' );
// the engine the app runs: the minified bundle plus the corrections in fixes.js
const T = require( path.join( __dirname, '../fixes.js' ) ).apply( require( path.join( __dirname, '../vendor/translit-forward.min.js' ) ) );
const B = require( path.join( __dirname, '../barnamala.js' ) );

let pass = 0, fail = 0;
const check = ( name, ok, detail ) => { if ( ok ) pass++; else { fail++; console.log( 'FAIL', name, detail || '' ); } };
const j = JSON.stringify;

const { html, dead, unplaced } = B.build( T );
const text = html.replace( /<[^>]+>/g, ' ' );

// 1. Every entry of the engine's map has a place on the chart.
const defaults = T.getDefaults();
const map = T.normalizeMap( defaults.map );
check( 'no map entry is left off the chart', unplaced.length === 0, j( unplaced ) );
const missing = [];
const escRe = ( k ) => k.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ).replace( /&/g, '&amp;' );
Object.keys( map ).forEach( ( sec ) => map[ sec ].forEach( ( [ k, v ] ) => {
	// punctuation that maps to itself is shown as plain text in the "unchanged" row, everything else as a key
	const shown = ( sec === 'punctuation' && k === v ) ? text.indexOf( k ) > -1 : new RegExp( '<kbd[^>]*>' + escRe( k ) + '</kbd>' ).test( html );
	if ( ! shown ) missing.push( sec + ':' + k );
} ) );
check( 'every map key appears as a key on the chart', missing.length === 0, j( missing ) );

// 2. Letters come in barnamala order.
const order = ( list ) => list.map( ( g ) => html.indexOf( '>' + g + '<' ) );
const increasing = ( a ) => a.every( ( v, i ) => v > -1 && ( i === 0 || v > a[ i - 1 ] ) );
check( 'vowels are in order', increasing( order( [ 'অ', 'আ', 'ই', 'ঈ', 'উ', 'ঊ', 'ঋ', 'এ', 'ঐ', 'ও', 'ঔ' ] ) ) );
check( 'consonants are in order (by group)', increasing( order( [ 'ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ', 'ছ', 'জ', 'ঝ', 'ঞ', 'ট', 'ঠ', 'ড', 'ঢ', 'ণ', 'ত', 'থ', 'দ', 'ধ', 'ন', 'প', 'ফ', 'ব', 'ভ', 'ম', 'য', 'ল', 'শ', 'ষ', 'স', 'হ' ] ) ) );
check( 'the group headings are in order', increasing( [ 'ক-বর্গ', 'চ-বর্গ', 'ট-বর্গ', 'ত-বর্গ', 'প-বর্গ', 'অন্তঃস্থ', 'ঊষ্ম', 'অন্যান্য', 'অযোগবাহ', 'যুক্তাক্ষর' ].map( ( g ) => html.indexOf( '>' + g + '<' ) ) ) );
check( 'digits are in order', increasing( order( [ '০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯' ] ) ) );

// 3. Each key on the chart really produces its letter, unless it is flagged as dead.
const wrong = [];
B.GRID.forEach( ( [ , , cells ] ) => cells.forEach( ( g ) => {
	if ( g === null ) return;
	Object.keys( map ).forEach( ( sec ) => map[ sec ].forEach( ( [ k, v ] ) => {
		if ( v === g && T.transliterate( k ) !== g && dead.indexOf( k ) === -1 ) wrong.push( k );
	} ) );
} ) );
check( 'a key that does not produce its letter is always shown struck through', wrong.length === 0, j( wrong ) );
dead.forEach( ( k ) => check( 'dead key ' + j( k ) + ' is really dead', html.indexOf( '<kbd class="dead" title="In the map, but never produces this letter">' + k + '</kbd>' ) > -1 ) );
check( 'dead keys are explained on the chart', dead.length === 0 || /struck-through/.test( text ) );

// 4. A map with an entry the layout does not know still shows it, and a missing letter does not break the chart.
const odd = Object.assign( {}, T, {
	getDefaults: () => { const d = T.getDefaults(); d.map.consonants.push( [ 'qq', 'ᱛ' ] ); d.map.consonants = d.map.consonants.filter( ( [ k ] ) => k !== 'w' ); return d; },
} );
const r2 = B.build( odd );
check( 'an unknown map entry is listed under "Other keys"', r2.unplaced.length === 1 && r2.unplaced[ 0 ][ 1 ] === 'qq' && /Other keys/.test( r2.html ), j( r2.unplaced ) );
check( 'a letter missing from the map leaves an empty cell, not an error', ! /<span class="bn glyph">ৱ<\/span>/.test( r2.html ) );

console.log( `\n${fail ? 'FAILED' : 'OK'} - ${pass} checks passed, ${fail} failed` + ( dead.length ? `  (keys the map lists but never produce their letter: ${dead.join( ', ' )})` : '' ) );
process.exit( fail ? 1 : 0 );
