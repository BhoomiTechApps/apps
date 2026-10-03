/**
 * rules.js - the small glue that applies mapping.js on top of vendor/translit-reverse.min.js (which stays untouched).
 * No pronunciation logic lives here: it looks entries up and applies them.
 *
 *   pre  1  words       exact Bengali word -> placeholder (restored as exact Roman text at the very end)
 *   pre  3  ba-phala    base + ্ব -> base + ্ৱ  (ৱ is already 'w' in the engine's map)
 *   pre  4  silent o    put a marker after the first consonant of every matching fragment
 *   post 100            remove any virama left in the output (a bundle whose map lacks the  ্ -> ""  row)
 *   post 901            marker -> silent_mark (and the 'o' just before it is dropped), then placeholders -> exact Roman words
 *
 * The snippet keys, sort orders and private-use characters (U+F000-U+F8FF) are the ones the TransLit-Lab uses for the same logic.
 * A bundle rebuilt from the Lab may therefore already carry these snippets: build() then skips every hook whose key the bundle has,
 * so nothing is applied twice.
 * Each snippet is a self-contained function reading config.maps.reverse.<section>, so it can also be pasted into the
 * TransLit-Lab as js_body. The data sections are NOT matcher sections (those would lose the inherent 'o').
 * Browser: window.TranslitEngine.  Node: require('./rules.js').build(bundle [, { mapping }]).
 */
( function ( root, factory ) {
	const mapping = ( typeof module === 'object' && module.exports ) ? require( './mapping.js' ) : root.TranslitMapping;
	const api = factory( mapping );
	if ( typeof module === 'object' && module.exports ) { module.exports = api; }
	else { root.TranslitRules = api; if ( root.TranslitReverse ) root.TranslitEngine = api.build( root.TranslitReverse ); }
}( typeof self !== 'undefined' ? self : this, function ( DEFAULT_MAPPING ) {
	'use strict';

	// ── pre 1: whole words ──
	function revPreWords( state, config ) {
		const words = config.maps.reverse.bpm_words || {};
		const keys = Object.keys( words ).map( ( k ) => k.normalize( 'NFC' ) );
		state.input = state.input.replace( /[\uF000-\uF8FF]/g, '' );                       // our own private-use characters can never come from the user
		if ( ! keys.length ) return state;
		const at = new Map( keys.map( ( k, i ) => [ k, i ] ) );
		state.input = state.input.replace( /[\u0980-\u09FF\u200C]+/g, ( w ) => at.has( w ) ? String.fromCharCode( 0xF100 + at.get( w ) ) : w );
		return state;
	}

	// ── pre 3: ব-phala ──
	function revPreBaPhala( state, config ) {
		const list = ( config.maps.reverse.bpm_ba_phala_w || [] ).map( String ).filter( Boolean );
		if ( ! list.length ) return state;
		state.input = state.input.replace( new RegExp( '(' + list.join( '|' ) + ')\u09CD\u09AC', 'g' ), '$1\u09CD\u09F1' );
		return state;
	}

	// ── pre 4: silent-o fragments ──
	function revPreSilentO( state, config ) {
		const M = '\uF001';
		const CONS = /[\u0995-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09DC\u09DD\u09DF\u09F0\u09F1]/;
		const norm = ( s ) => String( s ).normalize( 'NFC' ).replace( /\u09F0/g, '\u09B0' );                 // ৰ counts as র
		const frags = [];
		for ( const raw of ( config.maps.reverse.bpm_silent_o || [] ) ) {
			const e = norm( raw ).trim();
			const before = e.startsWith( '-' ), after = e.length > 1 && e.endsWith( '-' );
			const core = e.replace( /^-/, '' ).replace( /-$/, '' );
			if ( ! core || ! CONS.test( core[ 0 ] ) ) continue;
			const c1 = core[ 1 ] === '\u09BC' ? 2 : 1;                                                        // the first consonant, with its nukta if it has one
			if ( core.length > c1 ? ! CONS.test( core[ c1 ] ) : after ) continue;                            // C1 must be followed by a consonant, or end the word
			frags.push( { core, before, after, c1 } );
		}
		if ( ! frags.length ) return state;
		state.input = state.input.replace( /[\u0980-\u09FF\u200C]+/g, ( word, offset, whole ) => {
			const w = norm( word ), n = w.length, cut = new Set();
			for ( const f of frags ) {
				for ( let p = w.indexOf( f.core ); p !== -1; p = w.indexOf( f.core, p + 1 ) ) {
					const end = p + f.core.length;
					if ( f.before ? p === 0 : p !== 0 ) continue;                                             // start anchor
					if ( f.after ? end >= n : end !== n ) continue;                                           // end anchor
					if ( p > 0 && w[ p - 1 ] === '\u09CD' ) continue;                                         // C1 is the tail of a conjunct: not bare
					if ( f.core.length === f.c1 && w[ p + f.c1 ] === '\u09BC' ) continue;
					cut.add( p + f.c1 );
				}
			}
			if ( whole[ offset + word.length ] === "'" ) cut.delete( n );                                    // an explicit  '  after the last consonant means "show its o": that wins
			if ( ! cut.size ) return word;
			let out = ''; for ( let i = 0; i < word.length; i++ ) { if ( cut.has( i ) ) out += M; out += word[ i ]; }
			if ( cut.has( word.length ) ) out += M;                                                        // a final consonant: the marker goes after the last letter
			return out;
		} );
		return state;
	}

	// ── post 100: the engine writes nothing for a virama because the map has a row  ্ -> "" . A bundle whose map lost that row
	//    (a Lab map import drops rows with an empty Roman value) leaks it into every conjunct (p্rotha). Removing it first, before
	//    rev_post_clean_o_vowels (885), gives the other post rules the same text as a healthy bundle. With the row present: no change. ──
	function revPostStripVirama( state ) {
		if ( state.output.indexOf( '\u09CD' ) !== -1 ) {
			state.output = state.output.split( '\u09CD' ).join( '' );
			state.log.push( '[REV POST] Stray virama removed.' );
		}
		return state;
	}

	// ── post 901: after rev_post_clean_o_vowels (885) and rev_post_finalize_output (900), so neither can touch what is put in here ──
	function revPostRestoreMapping( state, config ) {
		const mark = config.maps.reverse.bpm_silent_mark;
		state.output = state.output.replace( /o?\uF001/g, typeof mark === 'string' ? mark : '\u200C' );        // silent-o marker: drop its 'o', write silent_mark
		const vals = Object.values( config.maps.reverse.bpm_words || {} );
		state.output = state.output.replace( /[\uF100-\uF8FF]/g, ( c ) => { const v = vals[ c.charCodeAt( 0 ) - 0xF100 ]; return v === undefined ? '' : v; } );   // placeholder -> exact word
		return state;
	}

	const SNIPPETS = [
		{ snippet_key: 'rev_pre_words',        label: 'Mapping: whole words',       direction: 'reverse', hook_stage: 'pre',  sort_order: 1,   is_active: 1, fn: revPreWords },
		{ snippet_key: 'rev_pre_ba_phala_w',   label: 'Mapping: ba-phala w',        direction: 'reverse', hook_stage: 'pre',  sort_order: 3,   is_active: 1, fn: revPreBaPhala },
		{ snippet_key: 'rev_pre_silent_o',     label: 'Mapping: silent-o fragments', direction: 'reverse', hook_stage: 'pre',  sort_order: 4,   is_active: 1, fn: revPreSilentO },
		{ snippet_key: 'rev_post_strip_virama',  label: 'Mapping: remove stray virama', direction: 'reverse', hook_stage: 'post', sort_order: 100, is_active: 1, fn: revPostStripVirama },
		{ snippet_key: 'rev_post_restore_mapping', label: 'Mapping: restore silent o and words', direction: 'reverse', hook_stage: 'post', sort_order: 901, is_active: 1, fn: revPostRestoreMapping },
	];

	/** @param {Object} bundle  the vendor bundle (TranslitReverse); @param {{mapping?: Object}} [options] replace / extend mapping.js */
	function build( bundle, options ) {
		const m = Object.assign( {}, DEFAULT_MAPPING, ( options && options.mapping ) || {} );
		const d = bundle.getDefaults();
		for ( const [ k, v ] of Object.entries( m.conjuncts || {} ) ) {                                       // conjunct spellings go INTO the consonant table
			d.map.consonants = d.map.consonants.filter( ( e ) => e[ 0 ] !== k );
			d.map.consonants.unshift( [ k, v ] );
		}
		d.map.bpm_words = Object.assign( {}, m.words );
		d.map.bpm_silent_o = ( m.silent_o || [] ).slice();
		d.map.bpm_silent_mark = m.silent_mark === undefined ? '\u200C' : m.silent_mark;
		d.map.bpm_ba_phala_w = ( m.ba_phala_w || [] ).slice();
		// A bundle rebuilt from the Lab may already carry some of these snippets (same keys): its copy wins, ours is not added,
		// so nothing is applied twice (a second silent-o pass would write two ZWNJ).
		const have = new Set( d.snippets.map( ( s ) => s.snippet_key ) );
		return bundle.create( { map: d.map, settings: d.settings, snippets: d.snippets.concat( SNIPPETS.filter( ( s ) => ! have.has( s.snippet_key ) ) ), silent: true } );
	}

	return { build, SNIPPETS, mapping: DEFAULT_MAPPING };
} ) );
