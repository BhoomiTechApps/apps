// Run:  node tests/rules.test.js      (mapping.js + rules.js on top of the vendor bundle)
const fs = require( 'fs' ), path = require( 'path' );
const Bundle = require( path.join( __dirname, '../vendor/translit-reverse.min.js' ) );
const Rules = require( path.join( __dirname, '../rules.js' ) );
const InPlace = require( path.join( __dirname, '../inplace.js' ) );
const E = Rules.build( Bundle );
const Z = '\u200C';
let pass = 0, fail = 0;
const check = ( name, ok, detail ) => { if ( ok ) pass++; else { fail++; console.log( 'FAIL', name, detail || '' ); } };
const vis = s => String( s ).replace( /\u200C/g, '<Z>' );
const eq = ( w, want, eng = E ) => { const got = eng.transliterate( w ); check( `${ w } -> ${ vis( want ) }`, got === want, 'got ' + vis( got ) ); };
const only = ( m ) => Rules.build( Bundle, { mapping: Object.assign( { words: {}, silent_o: [], ba_phala_w: [], conjuncts: {} }, m ) } );   // everything off except what is given

// 1. The revised sample: the whole text, exactly, by paste and by typing (the app's own paths)
{
	const dir = path.join( __dirname, 'samples' );
	const inp = fs.readFileSync( path.join( dir, 'revised.input.txt' ), 'utf8' ), exp = fs.readFileSync( path.join( dir, 'revised.expected.txt' ), 'utf8' );
	const BENGALI = /[\u0964\u0965\u0980-\u09FF]/, convert = w => BENGALI.test( w ) ? E.transliterate( w ) : w;
	const pasted = inp.replace( /\S+/g, w => { const o = convert( w ); return o === '' ? w : o; } );
	check( 'revised sample: pasted text equals the expected text exactly', pasted === exp );
	if ( pasted !== exp ) { const a = pasted.split( /\s+/ ), b = exp.split( /\s+/ ); const i = b.findIndex( ( x, k ) => x !== a[ k ] ); console.log( '   first difference:', vis( a[ i ] ), '!=', vis( b[ i ] ) ); }
	const ip = InPlace.create( convert, { perWord: true } ); ip.reset( '' ); let v = '', c = 0;
	for ( const ch of Array.from( inp ) ) { v = v.slice( 0, c ) + ch + v.slice( c ); c += ch.length; const r = ip.update( v, c, 'insertText', false ); if ( r.changed ) { v = r.value; c = r.caret; } ip.selection( c, c ); }
	check( 'revised sample: typed one character at a time equals the expected text exactly', v === exp );
	const plainOut = inp.replace( /\S+/g, w => BENGALI.test( w ) ? Bundle.transliterate( w ) : w );
	check( 'the sample really needs the mapping (plain bundle differs)', plainOut !== exp );
}

// 2. words: exact Bengali word -> exact Roman, only for the whole word
eq( 'যদিশৈমিঙাল', 'zodishoi mingal' ); eq( 'ভারহানথাগেলগা।', `bhar${ Z }han thagel${ Z }ga.` ); eq( 'টমস্' + Z, `tom${ Z }s${ Z }` );
check( 'the plain engine glues the two words (the reason for the entry)', Bundle.transliterate( 'যদিশৈমিঙাল' ) === 'zodishoimingal' );
const w1 = only( { words: { 'যদিশৈমিঙাল': 'zodishoi mingal' } } );
eq( 'যদিশৈমিঙালকে', Bundle.transliterate( 'যদিশৈমিঙালকে' ), w1 );                          // a longer word that merely CONTAINS the key is untouched
eq( 'বাংলা', 'Bangla', only( { words: { 'বাংলা': 'Bangla' } } ) );                          // the case written in mapping.js is kept

// 3. silent_o notation:  -XY end of word | -XY- inside | XY- start | XY whole word
const sil = ( list, mark ) => only( mark === undefined ? { silent_o: list } : { silent_o: list, silent_mark: mark } );
eq( 'পরমা', `por${ Z }ma`, sil( [ '-রমা' ] ) ); eq( 'পরমাণু', Bundle.transliterate( 'পরমাণু' ), sil( [ '-রমা' ] ) );        // end anchor: not in the middle
eq( 'নজরুল', `noj${ Z }rul`, sil( [ '-জরু-' ] ) ); eq( 'জরুরি', Bundle.transliterate( 'জরুরি' ), sil( [ '-জরু-' ] ) );        // inside: not at the start
eq( 'জরুরি', `j${ Z }ruri`, sil( [ 'জরু-' ] ) );                                                                        // start anchor
eq( 'কমা', `k${ Z }ma`, sil( [ 'কমা' ] ) ); eq( 'একমা', Bundle.transliterate( 'একমা' ), sil( [ 'কমা' ] ) );            // whole word only
eq( 'এক্তবে', Bundle.transliterate( 'এক্তবে' ), sil( [ '-তব-' ] ) );                                                   // the tail of a conjunct is not a bare consonant
eq( 'মচমচ', Bundle.transliterate( 'মচমচ' ), sil( [ '-মচ-' ] ) );                                                       // "inside" needs a letter on both sides
eq( 'ৰমা', `r${ Z }ma`, sil( [ 'রমা' ] ) );                                                                             // ৰ is treated as র
eq( 'পথ', `poth${ Z }`, sil( [ '-থ' ] ) ); eq( 'পথ।', `poth${ Z }.`, sil( [ '-থ' ] ) ); eq( '“পথ”', `“poth${ Z }”`, sil( [ '-থ' ] ) );   // punctuation / quotes end a word
eq( "পথ'", 'potho', sil( [ '-থ' ] ) ); eq( "নাঙ'", 'nango', sil( [ '-ঙ' ] ) );                                            // an explicit  '  shows the o, and wins
eq( 'পথ', 'poth', sil( [ '-থ' ], '' ) );                                                                                // silent_mark '' = drop the o, write nothing
eq( 'দুঃখ', 'du:kho' );                                                                                                 // খ is not in the list: the o stays
eq( 'ইসলামর', `is${ Z }lamor` );                                                                                       // -সলা-
eq( 'বর্ষ', 'borsho' ); eq( 'বরষ', `borosh${ Z }` );                                                                     // a conjunct is never touched; a bare final ষ is

// 4. ব-phala and conjuncts
[ [ 'ধ্বনি', 'dhwoni' ], [ 'তত্ত্ব', 'tottwo' ], [ 'সান্ত্বনা', 'santwona' ], [ 'ঊর্ধ্ব', 'urdhwo' ], [ 'তাপিত্বর', 'tapitwor' ], [ 'ত্বরা', 'twora' ], [ 'বিধ্বংসী', 'bidhwongsi' ],
  [ 'স্বাধীনতা', 'swadhinota' ], [ 'স্বামী', 'swami' ], [ 'দ্বন্দ্ব', 'dbondbo' ], [ 'লম্বা', 'lomba' ], [ 'গর্ব', 'gorbo' ], [ 'তব', 'tob' ], [ 'আত্মজ্ঞানী', 'atmogyani' ], [ 'ক্ষ', 'kkho' ] ].forEach( ( [ w, r ] ) => eq( w, r ) );
eq( 'দ্বন্দ্ব', 'dwondwo', only( { ba_phala_w: [ 'দ', 'ন্দ' ] } ) ); eq( 'ধ্বনি', 'dhboni', only( {} ) );
eq( 'ক্ষ', 'ksho', only( { conjuncts: { 'ক্ষ': 'ksh' } } ) );                                                                // a conjunct entry keeps the inherent o after it

// 5. Everything else is the plain engine: README examples, Assamese words, words from the sample that must NOT change
[ [ 'বাংলা', 'bangla' ], [ 'আমার সোনার বাংলা', 'amar sonar bangla' ], [ 'বিষ্ণুপ্রিয়া মনিপুরি', 'bishnupriya monipuri' ], [ 'ভারত', 'bharot' ], [ 'শান্তি', 'shanti' ], [ 'আমি', 'ami' ],
  [ 'অসমীয়া', 'osomiya' ], [ 'ব্যোম', 'byom' ], [ 'ব্যবহার', 'byobohar' ], [ 'ঘটনা', 'ghotona' ], [ 'সময়ে', 'somoye' ], [ 'কলমর', 'kolomor' ], [ 'গীরকর', 'girokor' ], [ 'ৰাজগৰ', 'rajgor' ] ].forEach( ( [ w, r ] ) => eq( w, r ) );
check( 'empty mapping = the plain bundle', [ 'যারগা', 'পথ', 'ধ্বনি', 'আত্মজ্ঞানী', 'টমস্' + Z ].every( w => only( {} ).transliterate( w ) === Bundle.transliterate( w ) ) );

// 6. Random Bengali-script input: nothing leaks; the fragment rule only ever removes an 'o' (ZWNJ ignored on both sides)
{
	const frag = only( { silent_o: Rules.mapping.silent_o } ), full = E;
	let seed = 777; const rnd = () => ( seed = ( seed * 1664525 + 1013904223 ) >>> 0 ) / 4294967296;
	const pool = [];
	for ( let c = 0x0995; c <= 0x09B9; c++ ) pool.push( String.fromCharCode( c ), String.fromCharCode( c ) );
	// a lone independent vowel অ/ও is left out on purpose: the engine's old trailing-o rule drops a lone one (README, "Known limits")
	for ( const c of [ 0x09BE, 0x09BF, 0x09C0, 0x09C1, 0x09C7, 0x09C8, 0x09CB, 0x09CC, 0x09CD, 0x09CD, 0x09BC, 0x0982, 0x0983, 0x200C, 0x200D, 0x09F0, 0x09F1, 0x09CE, 0x0986, 0x0987, 0x09E6, 0x0964 ] ) pool.push( String.fromCharCode( c ) );
	pool.push( ' ', ' ', "'", 'a', '\n', '“', '”' );
	const onlyO = ( b, a ) => { let i = 0; for ( const ch of b ) { if ( i < a.length && ch === a[ i ] ) i++; else if ( ch !== 'o' ) return false; } return i === a.length; };
	const strip = s => s.replace( /\u200C/g, '' );
	let leak = 0, notO = 0, threw = 0; const N = 30000;
	for ( let n = 0; n < N; n++ ) {
		let s = ''; const len = 1 + Math.floor( rnd() * 10 ); for ( let k = 0; k < len; k++ ) s += pool[ Math.floor( rnd() * pool.length ) ];
		try { const b = Bundle.transliterate( s ), a = frag.transliterate( s ), f = full.transliterate( s );
			if ( /[\uF000-\uF8FF]/.test( a + f ) ) leak++;
			if ( ! onlyO( strip( b ), strip( a ) ) ) notO++;
		} catch ( e ) { threw++; }
	}
	check( `random input (${ N }): no marker or placeholder leaks`, leak === 0, leak );
	check( `random input (${ N }): the silent-o fragments only ever remove an 'o'`, notO === 0, notO );
	check( `random input (${ N }): nothing throws`, threw === 0, threw );
}
// 7. A bundle whose reverse map has lost the  ্ -> ""  row (a rebuild from a Lab that dropped it) must behave exactly like the real bundle
{
	const noRow = Object.assign( {}, Bundle, { getDefaults() { const d = Bundle.getDefaults(); d.map.special = d.map.special.filter( e => e[ 1 ] !== '' ); return d; } } );
	check( 'the test bundle really has no virama row', ! noRow.getDefaults().map.special.some( e => e[ 0 ] === '\u09CD' ) );
	const bad = Bundle.create( { map: noRow.getDefaults().map, silent: true } );      // the plain leak, without rules.js
	check( 'without the fix a missing row leaks the virama (the problem)', bad.transliterate( 'প্রথা' ) === 'p\u09CDrotha' );
	const NR = Rules.build( noRow );
	[ [ 'প্রথা', 'protha' ], [ 'তাপিত্বর', 'tapitwor' ], [ 'বিপ্লব', 'biplob' ], [ 'বিভিন্ন', 'bibhinno' ], [ 'প্ৰকাশ', `prokash${ Z }` ], [ 'ভারতবর্ষর', `bharot${ Z }borshor` ] ].forEach( ( [ w, r ] ) => eq( w, r, NR ) );
	check( 'no virama can reach the output', ! [ 'ক্ষ', 'বিপ্লব', 'কৃষ্ণ', 'ন্দ্র', '্', 'ক্', 'ক্‌', 'ক্‍' ].some( w => NR.transliterate( w ).includes( '\u09CD' ) ) );
	const dir = path.join( __dirname, 'samples' );
	const inp = fs.readFileSync( path.join( dir, 'revised.input.txt' ), 'utf8' ), exp = fs.readFileSync( path.join( dir, 'revised.expected.txt' ), 'utf8' );
	check( 'revised sample: exact even with the virama row missing', inp.replace( /\S+/g, w => /[\u0964\u0965\u0980-\u09FF]/.test( w ) ? NR.transliterate( w ) : w ) === exp );
	let seed = 31337; const rnd = () => ( seed = ( seed * 1664525 + 1013904223 ) >>> 0 ) / 4294967296;
	const pool = [];
	for ( let c = 0x0995; c <= 0x09B9; c++ ) pool.push( String.fromCharCode( c ) );
	for ( const c of [ 0x09BE, 0x09BF, 0x09C1, 0x09C7, 0x09CB, 0x09CD, 0x09CD, 0x09CD, 0x09BC, 0x0982, 0x200C, 0x200D, 0x09F0, 0x09F1, 0x0986, 0x0964 ] ) pool.push( String.fromCharCode( c ) );
	pool.push( ' ', "'", '\n', '“' );
	let diff = 0; const N = 20000;
	for ( let n = 0; n < N; n++ ) { let s = ''; const len = 1 + Math.floor( rnd() * 10 ); for ( let k = 0; k < len; k++ ) s += pool[ Math.floor( rnd() * pool.length ) ]; if ( NR.transliterate( s ) !== E.transliterate( s ) ) diff++; }
	check( `random input (${ N }): a bundle without the virama row gives exactly the same output as the real one`, diff === 0, diff );
}
// 8. A bundle rebuilt from the TransLit-Lab already carries these snippets (same keys, sort orders and private-use characters):
//    rules.js must then add nothing a second time, must respect a snippet switched off in the Lab, and must fill in what is missing.
{
	const withRows = ( rows ) => Object.assign( {}, Bundle, { getDefaults() { const d = Bundle.getDefaults(); d.snippets = d.snippets.concat( rows ); return d; } } );
	const keys = Rules.SNIPPETS.map( s => s.snippet_key );
	check( 'snippet keys are the Lab\'s', JSON.stringify( keys ) === JSON.stringify( [ 'rev_pre_words', 'rev_pre_ba_phala_w', 'rev_pre_silent_o', 'rev_post_strip_virama', 'rev_post_restore_mapping' ] ), keys.join() );
	check( 'sort orders are the Lab\'s', JSON.stringify( Rules.SNIPPETS.map( s => s.sort_order ) ) === '[1,3,4,100,901]' );
	const all = Rules.build( withRows( Rules.SNIPPETS ) );                                            // the bundle already has every one of them
	const some = Rules.build( withRows( Rules.SNIPPETS.filter( s => s.snippet_key === 'rev_post_strip_virama' ) ) );   // only the virama snippet
	const off = Rules.build( withRows( Rules.SNIPPETS.map( s => s.snippet_key === 'rev_pre_silent_o' ? Object.assign( {}, s, { is_active: 0 } ) : s ) ) );   // silent-o switched off
	eq( 'পথ', `poth${ Z }`, all ); eq( 'যারগা', `zar${ Z }ga`, all );                                 // one ZWNJ, not two
	eq( 'যারগা', `zar${ Z }ga`, some ); eq( 'যারগা', 'zaroga', off ); eq( 'যদিশৈমিঙাল', 'zodishoi mingal', off );   // completed / respected
	const dir = path.join( __dirname, 'samples' );
	const inp = fs.readFileSync( path.join( dir, 'revised.input.txt' ), 'utf8' ), exp = fs.readFileSync( path.join( dir, 'revised.expected.txt' ), 'utf8' );
	const whole = ( eng ) => inp.replace( /\S+/g, w => /[\u0964\u0965\u0980-\u09FF]/.test( w ) ? eng.transliterate( w ) : w );
	check( 'revised sample exact when the bundle already carries every snippet', whole( all ) === exp );
	check( 'revised sample exact when the bundle carries only the virama snippet', whole( some ) === exp );
	let seed = 4711; const rnd = () => ( seed = ( seed * 1664525 + 1013904223 ) >>> 0 ) / 4294967296;
	const pool = [];
	for ( const ch of 'রৰলচনকঙতমজসথঠশষগপহবয' ) pool.push( ch, ch );
	for ( const c of [ 0x09BE, 0x09BF, 0x09C0, 0x09C1, 0x09C7, 0x09CB, 0x09CD, 0x09CD, 0x09CD, 0x09AF, 0x0982, 0x200C, 0x0964 ] ) pool.push( String.fromCharCode( c ) );
	pool.push( ' ', "'", '😀' );
	let dAll = 0, dSome = 0; const N = 20000;
	for ( let n = 0; n < N; n++ ) { let s = ''; const len = 1 + Math.floor( rnd() * 10 ); for ( let k = 0; k < len; k++ ) s += pool[ Math.floor( rnd() * pool.length ) ];
		const want = E.transliterate( s ); if ( all.transliterate( s ) !== want ) dAll++; if ( some.transliterate( s ) !== want ) dSome++; }
	check( `random input (${ N }): a bundle that already has every snippet gives the same output as the plain PWA (nothing applied twice)`, dAll === 0, dAll );
	check( `random input (${ N }): a bundle with only the virama snippet gives the same output`, dSome === 0, dSome );
}
// 8. The map: the PWA must run with exactly the Lab's reverse map (tests/samples/reverseMap.json). Same rows in every section; the ORDER of
//    rows does not matter (the engine sorts by key length and no key repeats), and the outputs prove it.
{
	const lab = JSON.parse( fs.readFileSync( path.join( __dirname, 'samples', 'reverseMap.json' ), 'utf8' ) );
	const rows = ( m, sec ) => ( m[ sec ] || [] ).map( e => e[ 0 ] + '\t' + e[ 1 ] );
	const M = E.map;                                                                       // the map the engine really runs with
	for ( const sec of Object.keys( lab ) ) {
		const a = rows( M, sec ), b = rows( lab, sec );
		const missing = b.filter( x => ! a.includes( x ) ), extra = a.filter( x => ! b.includes( x ) );
		check( `map section ${ sec }: same rows as the Lab map`, ! missing.length && ! extra.length && a.length === b.length,
			`missing ${ JSON.stringify( missing ) } extra ${ JSON.stringify( extra ) }` );
		check( `map section ${ sec }: no repeated key`, new Set( b.map( x => x.split( '\t' )[ 0 ] ) ).size === b.length );
	}
	check( 'the virama row is in the map (special: ্ -> "")', rows( M, 'special' ).includes( '\u09CD\t' ) );
	check( 'no map section beyond the Lab\'s (rules.js data sections aside)', Object.keys( M ).filter( k => ! k.startsWith( 'bpm_' ) ).every( k => k in lab ) );
	const onLab = Rules.build( Object.assign( {}, Bundle, { getDefaults() { const d = Bundle.getDefaults(); d.map = JSON.parse( JSON.stringify( lab ) ); return d; } } ) );
	const inp = fs.readFileSync( path.join( __dirname, 'samples', 'revised.input.txt' ), 'utf8' );
	const words = inp.split( /\s+/ ).filter( w => /[\u0980-\u09FF]/.test( w ) );
	check( 'running on the Lab map gives the same output as running on the bundle map (sample words)', words.every( w => onLab.transliterate( w ) === E.transliterate( w ) ) );
}
console.log( `\n${ fail ? 'FAILED' : 'OK' } - ${ pass } checks passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
