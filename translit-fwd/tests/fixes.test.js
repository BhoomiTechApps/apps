// Run:  node tests/fixes.test.js
const path = require( 'path' );
const bundle = require( path.join( __dirname, '../vendor/translit-forward.min.js' ) );
const Fixes = require( path.join( __dirname, '../fixes.js' ) );

let pass = 0, fail = 0;
const check = ( name, ok, detail ) => { if ( ok ) pass++; else { fail++; console.log( 'FAIL', name, detail || '' ); } };
const j = JSON.stringify;

const before = Fixes.defects( bundle );
const E = Fixes.apply( bundle );

// 1. After the fixes nothing is left to fix.
check( 'no defect remains after apply()', Fixes.defects( E ).length === 0, j( Fixes.defects( E ) ) );

// 2. The two corrections give the right letters.
const cases = [
	[ 'ngg', 'ঙ্গ' ], [ 'angga', 'আঙ্গা' ], [ 'nggo', 'ঙ্গ‌' ], [ 'nggr', 'ঙ্গ্ৰ' ],
	[ 'ngu', 'ঙু' ], [ 'Ngu', 'ঙু' ], [ 'nguu', 'ঙূ' ], [ 'ngugg', 'ঙুগ্গ' ],
	// unchanged: the other ng + vowel forms, ng on its own, and words with ng + consonant
	[ 'nga', 'ঙা' ], [ 'ngi', 'ঙি' ], [ 'nge', 'ঙে' ], [ 'ngo', 'ঙ' ], [ 'ng', 'ং' ], [ 'Ng', 'ঙ' ], [ 'ongko', 'অংক‌' ], [ 'bongo', 'ব‌ঙ' ], [ 'Ngg', 'ঙগ' ],
];
cases.forEach( ( [ a, b ] ) => check( a + ' -> ' + b, E.transliterate( a ) === b, E.transliterate( a ) ) );

// 3. Nothing else changes: over all fixture phrases only those containing ngg or ngu differ from the bundle.
const phrases = require( './phrases.json' );
const odd = phrases.filter( ( p ) => bundle.transliterate( p ) !== E.transliterate( p ) && ! /ngg|ngu/.test( p ) );
check( 'phrases without ngg / ngu are converted exactly as before', odd.length === 0, j( odd ) );
const touched = phrases.filter( ( p ) => bundle.transliterate( p ) !== E.transliterate( p ) );
check( 'the fixes do change the phrases that contain ngg / ngu', touched.length > 0 || before.length === 0 );

// 4. The corrected engine keeps the rest of the API.
check( 'getDefaults / normalizeMap / run are still there', typeof E.getDefaults === 'function' && typeof E.normalizeMap === 'function' && typeof E.run === 'function' );
check( 'the map shows ngg as a consonant', E.getDefaults().map.consonants.some( ( p ) => p[ 0 ] === 'ngg' ) || before.indexOf( 'ngg' ) === -1 );

// 5. Once the package itself is fixed, the layer does nothing: apply() hands back the engine it was given.
check( 'apply() twice returns the same engine', Fixes.apply( E ) === E );
const fixedBundle = Object.assign( {}, bundle, { transliterate: E.transliterate } );   // a bundle that already gives the right answers
check( 'an already-fixed bundle is left alone', Fixes.apply( fixedBundle ) === fixedBundle );

console.log( `\n${fail ? 'FAILED' : 'OK'} - ${pass} checks passed, ${fail} failed` + ( before.length ? `  (fixes in use: ${before.join( ', ' )})` : '  (bundle needs no fixes)' ) );
process.exit( fail ? 1 : 0 );
