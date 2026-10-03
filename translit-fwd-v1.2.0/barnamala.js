/**
 * barnamala.js - the Roman-key chart in barnamala order, built from the map inside the transliteration engine.
 *
 * Pure logic, no DOM: build( TranslitForward ) returns the chart as an HTML string. Because it reads the engine's own map
 * (and asks the engine what each key really produces), the chart stays right when vendor/translit-forward.js is replaced:
 *
 *   - a key that the map lists for a letter but that does not actually produce it is shown struck through;
 *   - a map entry that has no place in the layout below is listed under "Other keys", so nothing is ever hidden.
 */
( function ( root, factory ) {
	if ( typeof module === 'object' && module.exports ) { module.exports = factory(); } else { root.Barnamala = factory(); }
}( typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	const VOWELS = [
		[ 'অ', null ], [ 'আ', 'া' ], [ 'ই', 'ি' ], [ 'ঈ', 'ী' ], [ 'উ', 'ু' ], [ 'ঊ', 'ূ' ],
		[ 'ঋ', 'ৃ' ], [ 'এ', 'ে' ], [ 'ঐ', 'ৈ' ], [ 'ও', 'ো' ], [ 'ঔ', 'ৌ' ],
	];

	// One row per group, five letters across; null = empty cell.
	const GRID = [
		[ 'ক-বর্গ', 'ka-varga', [ 'ক', 'খ', 'গ', 'ঘ', 'ঙ' ] ],
		[ 'চ-বর্গ', 'ca-varga', [ 'চ', 'ছ', 'জ', 'ঝ', 'ঞ' ] ],
		[ 'ট-বর্গ', 'Ta-varga', [ 'ট', 'ঠ', 'ড', 'ঢ', 'ণ' ] ],
		[ 'ত-বর্গ', 'ta-varga', [ 'ত', 'থ', 'দ', 'ধ', 'ন' ] ],
		[ 'প-বর্গ', 'pa-varga', [ 'প', 'ফ', 'ব', 'ভ', 'ম' ] ],
		[ 'অন্তঃস্থ', 'semivowels', [ 'য', 'র', 'ৰ', 'ল', 'ৱ' ] ],
		[ 'ঊষ্ম', 'sibilants and h', [ 'শ', 'ষ', 'স', 'হ', null ] ],
		[ 'অন্যান্য', 'dotted forms, khanda-ta', [ 'ড়', 'ঢ়', 'য়', 'ৎ', null ] ],
		[ 'অযোগবাহ', 'anusvara, visarga, chandrabindu', [ 'ং', 'ঃ', 'ঁ', null, null ] ],
		[ 'যুক্তাক্ষর', 'conjunct shortcuts', [ 'ক্ষ', 'ৰ্য', 'ঙ্গ', null, null ] ],
	];

	const TAGS = { 'ৰ': 'Assamese ra', 'ৱ': 'Assamese wa' };   // just to tell them apart from র and ব
	const DANDA_NAMES = { '।': 'danda', '॥': 'double danda' };

	const esc = ( s ) => String( s ).replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' ).replace( /"/g, '&quot;' );
	const cp = ( s ) => Array.from( s ).map( ( c ) => 'U+' + c.codePointAt( 0 ).toString( 16 ).toUpperCase().padStart( 4, '0' ) ).join( ' ' );
	// shortest key first, then lower case before upper case
	const byLen = ( a, b ) => a.length - b.length || a.localeCompare( b, 'en', { caseFirst: 'lower' } );

	/**
	 * @param {{transliterate: function(string): string, getDefaults: function(): Object, normalizeMap: function(Object): Object}} engine
	 * @return {{ html: string, dead: string[], unplaced: string[][] }}
	 *   dead:     keys listed for a letter that do not produce it
	 *   unplaced: [ section, key, value ] map entries that the layout has no place for
	 */
	function build( engine ) {
		const T = engine.transliterate;
		const defaults = engine.getDefaults();
		const map = engine.normalizeMap( defaults.map );
		const settings = defaults.settings || {};

		const all = [];
		Object.keys( map ).forEach( ( sec ) => ( map[ sec ] || [] ).forEach( ( p ) => all.push( { sec, k: String( p[ 0 ] ), v: String( p[ 1 ] ) } ) ) );
		const used = new Set();
		const dead = [];
		const mark = ( e ) => used.add( e.sec + '|' + e.k + '|' + e.v );

		/** Unique keys, in the given sections, that the map lists for this text. */
		function keysFor( value, secs, quiet ) {
			const seen = [];
			all.forEach( ( e ) => {
				if ( e.v !== value || secs.indexOf( e.sec ) === -1 ) return;
				if ( ! quiet ) mark( e );
				if ( seen.indexOf( e.k ) === -1 ) seen.push( e.k );
			} );
			return seen.sort( byLen );
		}
		const chip = ( k, ok ) => {
			if ( ! ok && dead.indexOf( k ) === -1 ) dead.push( k );
			return '<kbd' + ( ok ? '' : ' class="dead" title="In the map, but never produces this letter"' ) + '>' + esc( k ) + '</kbd>';
		};
		const chips = ( keys, works ) => keys.map( ( k ) => chip( k, works( k ) ) ).join( ' ' );

		const base = keysFor( 'ক', [ 'consonants' ], true )[ 0 ] || 'k';
		const inherent = settings.inherent_vowel || 'o';
		const virama = settings.virama || '্', zwnj = settings.zwnj || '‌';

		// ── vowels ──
		let vowels = '';
		VOWELS.forEach( ( [ iv, kar ] ) => {
			const ik = keysFor( iv, [ 'independent_vowels' ] );
			let karCell = '<span class="none">none</span>', kk = '';
			if ( kar ) {
				const ks = keysFor( kar, [ 'matras' ] );
				karCell = '<span class="bn big">◌' + kar + '</span>';
				kk = chips( ks, ( k ) => T( base + k ) === 'ক' + kar );
			} else {
				// the inherent vowel: its matra key only marks "no sign"
				all.forEach( ( e ) => { if ( e.sec === 'matras' && e.k === inherent ) mark( e ); } );
				kk = chip( inherent, true );
			}
			vowels += '<tr><th scope="row" class="bn big">' + iv + '</th><td>' + chips( ik, ( k ) => T( k ) === iv ) + '</td><td class="ctr">' + karCell + '</td><td>' + kk + '</td></tr>';
		} );

		// ── consonants ──
		let grid = '';
		GRID.forEach( ( [ label, sub, cells ] ) => {
			let tds = '';
			cells.forEach( ( g ) => {
				const keys = g === null ? [] : keysFor( g, [ 'consonants', 'special' ] );
				if ( ! keys.length ) { tds += '<td class="empty"></td>'; return; }
				const live = keys.some( ( k ) => T( k ) === g );
				const tag = ! live ? '<span class="tag warn">not produced</span>' : TAGS[ g ] ? '<span class="tag">' + TAGS[ g ] + '</span>' : '';
				tds += '<td' + ( live ? '' : ' class="shadow"' ) + ' title="' + cp( g ) + '"><span class="bn glyph">' + g + '</span><span class="keys">' +
					chips( keys, ( k ) => T( k ) === g ) + '</span>' + tag + '</td>';
			} );
			grid += '<tbody><tr><th colspan="5" scope="colgroup" class="vg"><span class="bn">' + label + '</span> <span class="sub">' + esc( sub ) + '</span></th></tr><tr>' + tds + '</tr></tbody>';
		} );

		// ── digits ──
		let dg = '', dk = '';
		( map.digits || [] ).forEach( ( p ) => {
			const k = String( p[ 0 ] ), v = String( p[ 1 ] );
			all.forEach( ( e ) => { if ( e.sec === 'digits' && e.k === k ) mark( e ); } );
			dg += '<td class="bn big">' + v + '</td>';
			dk += '<td>' + chip( k, T( k ) === v ) + '</td>';
		} );

		// ── punctuation and signs ──
		let signs = '';
		const same = [];
		( map.punctuation || [] ).slice().sort( ( a, b ) => String( a[ 0 ] ).length - String( b[ 0 ] ).length ).forEach( ( p ) => {
			const k = String( p[ 0 ] ), v = String( p[ 1 ] );
			all.forEach( ( e ) => { if ( e.sec === 'punctuation' && e.k === k ) mark( e ); } );
			if ( k === v ) { same.push( k ); return; }
			signs += '<tr><th scope="row" class="bn big">' + esc( v ) + '</th><td>' + chip( k, T( k ) === v ) + '</td><td>' + esc( DANDA_NAMES[ v ] || '' ) + '</td></tr>';
		} );
		function signRow( th, sec, value, text ) {
			const ks = keysFor( value, [ sec ] );
			if ( ks.length ) signs += '<tr>' + th + '<td>' + chips( ks, ( k ) => T( k ) === value || T( 'k' + k ) === 'ক' + value ) + '</td><td>' + text + '</td></tr>';
		}
		signRow( '<th scope="row" class="bn big">◌' + virama + zwnj + '</th>', 'special', virama + zwnj, 'hasanta with ZWNJ' );
		signRow( '<th scope="row" class="bn big">◌' + virama + 'য</th>', 'matras', virama + 'য', 'ya-phala after a consonant' );
		signRow( '<th scope="row" class="mono">ZWNJ</th>', 'matras', zwnj, 'stops letters joining' );
		if ( same.length ) signs += '<tr><th scope="row" class="big mono">' + esc( same.join( ' ' ) ) + '</th><td colspan="2">unchanged</td></tr>';

		// ── anything the layout has no place for ──
		const unplaced = all.filter( ( e ) => ! used.has( e.sec + '|' + e.k + '|' + e.v ) );
		let other = '';
		if ( unplaced.length ) {
			other = '<h3>Other keys</h3><table><tbody>' + unplaced.map( ( e ) => '<tr><td>' + chip( e.k, T( e.k ) === e.v ) + '</td><td class="bn">' + esc( e.v ) + '</td><td class="muted">' + esc( e.sec ) + '</td></tr>' ).join( '' ) + '</tbody></table>';
		}

		const hint = '<p class="hint">Keys are case-sensitive, and the longest matching key wins. Point at a letter to see its code point.' +
			( dead.length ? ' A struck-through key is in the map but does not produce that letter.' : '' ) + '</p>';

		const html = hint +
			'<h3><span class="bn">স্বরবর্ণ</span> Vowels</h3><table class="vowels"><thead><tr><th></th><th>Letter, at word start</th><th class="ctr">Matra</th><th>After a consonant</th></tr></thead><tbody>' + vowels + '</tbody></table>' +
			'<h3><span class="bn">ব্যঞ্জনবর্ণ</span> Consonants</h3><table class="grid">' + grid + '</table>' +
			'<h3><span class="bn">সংখ্যা</span> Digits</h3><table class="digits"><tbody><tr>' + dg + '</tr><tr>' + dk + '</tr></tbody></table>' +
			'<h3>Punctuation and signs</h3><table class="signs"><tbody>' + signs + '</tbody></table>' + other;

		return { html, dead, unplaced: unplaced.map( ( e ) => [ e.sec, e.k, e.v ] ) };
	}

	return { build, GRID, VOWELS };
} ) );
