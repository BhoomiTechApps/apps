/*! translit-js-reverse v1.0.3
 *  Transliteration engine + bundled map, settings and snippets.
 *  Derived from the CompLing AI BPM Fixed Transliteration Engine 4.2.0
 *  (TransLit-Lab 1.1.1) by BhoomiTech Heritage and Development Foundation.
 *  @license GPL-2.0-or-later
 *  GENERATED FILE - edit src/ or data/ and run `npm run build`.
 */

( function ( root, factory ) {
	if ( typeof module === 'object' && module.exports ) {
		module.exports = factory();
	} else {
		root.TranslitReverse = factory();
	}
} )( typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
'use strict';
/* -- Bundled data (generated from data/*.json by scripts/build.js) -- */
const DEFAULT_MAP = {"consonants":[["\u0995\u09CD\u09B7","kkh"],["\u099C\u09CD\u099E","jng"],["\u09B7\u09CD\u099F","sht"],["\u099E\u09CD\u099A","ngc"],["\u099E\u09CD\u099C","ngj"],["\u09AE\u09CD\u09AD","mbh"],["\u09A3\u09CD\u09A1","nd"],["\u09A8\u09CD\u09A6","nd"],["\u09A8\u09CD\u09A4","nt"],["\u09AE\u09CD\u09AA","mp"],["\u09B9\u09CD\u09AE","hm"],["\u0996","kh"],["\u0998","gh"],["\u0999","ng"],["\u099A","ch"],["\u099D","jh"],["\u099E","ng"],["\u09A0","th"],["\u09A2","dh"],["\u09A5","th"],["\u09A7","dh"],["\u09AD","bh"],["\u09AB","ph"],["\u09B6","sh"],["\u09B7","sh"],["\u09A2\u09BC","rh"],["\u09B0\u09CD\u09AF","rz"],["\u09B0\u09B0","r"],["\u09B0","r"],["\u09F0\u09F0","r"],["\u09F0","r"],["\u09AF\u09BC","y"],["\u0997","g"],["\u0995","k"],["\u099B","s"],["\u099C","j"],["\u099F","t"],["\u09A1","d"],["\u09A3","n"],["\u09A4","t"],["\u09A6","d"],["\u09A8","n"],["\u09AA","p"],["\u09AC","b"],["\u09AE","m"],["\u09AF","z"],["\u09B2","l"],["\u09B8","s"],["\u09B9","h"],["\u09A1\u09BC","r"],["\u09F1","w"],["\u09CE","t"]],"digits":[["\u09E6","0"],["\u09E7","1"],["\u09E8","2"],["\u09E9","3"],["\u09EA","4"],["\u09EB","5"],["\u09EC","6"],["\u09ED","7"],["\u09EE","8"],["\u09EF","9"]],"independent_vowels":[["\u0985","o"],["\u0986","a"],["\u0987","i"],["\u0988","i"],["\u0989","u"],["\u098A","u"],["\u098B","ri"],["\u098F","e"],["\u0990","oi"],["\u0993","o"],["\u0994","ou"]],"matras":[["\u09C8","oi"],["\u09C3","ri"],["\u09CC","ou"],["\u09BE","a"],["\u09BF","i"],["\u09C0","i"],["\u09C1","u"],["\u09C2","u"],["\u09C7","e"],["\u09CB","O"],["\u09CD\u09AF","y"]],"punctuation":[["\u0965",".."],["\u0964","."]],"special":[["\u0982","ng"],["\u0983",":"],["\u0981","^"],["\u09CD",""]]};
const DEFAULT_SETTINGS = {"hardcode_consonant_cluster":1,"hardcode_consonant_matra":1,"hardcode_explicit_zwnj":1,"hardcode_independent_vowel":1,"inherent_vowel":"o","non_linking_consonants":["r","R","ng","M","NG","Ng",":","H","^","~"],"section_order":["special","consonants","matras","independent_vowels","digits","punctuation"],"virama":"\u09CD","zwj":"\u200D","zwnj":"\u200C"};
const DEFAULT_SNIPPETS = [
	{"snippet_key":"rev_post_clean_o_vowels","label":"Shankar: Clean 'o' vowels","direction":"reverse","hook_stage":"post","sort_order":885,"is_active":1,"fn":(function revPostCleanOVowels(state, config) {
  // 1. Target and preserve uppercase explicit open-O matras
  state.output = state.output.replace(/O/g, 'PROTECT_O');
  
  // 2. Fix the structural inversion (e.g., 'rajgro' back to 'rajgor')
  if (state.output.includes('rajgro')) {
    state.output = state.output.replace(/rajgro/gi, 'rajgor');
  }
  
  // 3. Clean inherent trailing 'o' from single final word letters safely
  const trailingPattern = /(?:(?<=[aeiouy])|(?<![^aeiouy ]{2}))o(?=[.,!?;\u0964 \s\u00A0]|$)/gi;
  state.output = state.output.replace(trailingPattern, '');
  
  // 4. Keep the terminal 'o' on processed double consonants (like 'tt') at word boundaries
  const doubleConsonantPattern = /\b([^aeiouy\s\d])\1(?=[.,!?;\u0964 \s\u00A0]|$)/gi;
  state.output = state.output.replace(doubleConsonantPattern, '$&o');
  
  // 5. Restore explicit protected matras
  state.output = state.output.replace(/PROTECT_O/g, 'o');

  // 6. Y-phala rule: a 'y' that follows a consonant (y-phala) must be followed
  //    by the inherent 'o' when it is word-final or directly followed by a consonant.
  //    - (?<=[consonant])  -> y is attached to a consonant (so it's a phala, not a standalone y)
  //    - (?![aeiouy])      -> next char is not a vowel: i.e. a consonant, whitespace,
  //                           punctuation, or end of string (this also skips an existing 'o')
  const yPhalaPattern = /(?<=[bcdfghjklmnpqrstvwxz])y(?![aeiouy])/gi;
  state.output = state.output.replace(yPhalaPattern, '$&o');
  
  state.log.push('[REV POST] Structural inversion fixed, vowels aligned, y-phala inherent o applied.');
  return state;
}
)},
	{"snippet_key":"rev_post_finalize_output","label":"Shankar: Finalize output","direction":"reverse","hook_stage":"post","sort_order":900,"is_active":1,"fn":(function revPostFinalizeOutput(state, config) {
  state.output = state.output.toLowerCase().trim();
  state.log.push('[REV POST] Outputs lowercased and whitespaces trimmed.');
  return state;
}
)},
	{"snippet_key":"rev_pre_pipeline","label":"Shankar: Pre-Processing Pipeline","direction":"reverse","hook_stage":"pre","sort_order":2,"is_active":1,"fn":(function revPrePipeline(state, config) {
  // 1. Structural normalization: Inject a hasant bridge into 'raj-gor' compounds 
  // This targets '\u099C\u0997' when it follows a vowel+consonant prefix (like '\u09F0\u09BE\u099C')
  state.input = state.input.replace(/([\u0985\u0986\u0987\u0988\u0989\u098A\u098B\u098F\u0990\u0993\u0994\u09BE\u09BF\u09C0\u09C1\u09C2\u09C3\u09C7\u09C8\u09CB\u09CC]\u099C)(\u0997)/g, '$1\u09CD$2');
  
  // 2. Strip structural rendering blocks
  state.input = state.input.replace(/\u200D/g, '');
  
  // 3. Guarantee explicit fallback configurations
  config.unknown_char_handling = config.unknown_char_handling ?? 'passthrough';
  
  state.log.push('[REV PRE] Compound word boundaries normalized with virtual hasant.');
  return state;
}
)}
];

/*
 * translit-js-reverse: the reverse-only core of the CompLing AI BPM engine.
 * Extracted from assets/engine.js (engine 4.2.0, TransLit-Lab 1.1.1); the
 * forward loop was removed, the logic that remains is unchanged.
 */
/**
 * CompLing AI - BPM Fixed Transliteration Engine
 *
 * Version:   4.2.0
 * Package:   CompilingAI
 * Author:    BhoomiTech Heritage and Development Foundation
 * License:   GPL-2.0-or-later
 *
 * This is the FIXED engine. It is never AI-generated.
 * AI only generates snippet hook functions (js_body) which plug into the
 * pre / loop / post hook slots defined here.
 *
 * Hook contract (state object):
 *   state.input    {string}  - full original input string
 *   state.output   {string}  - accumulated output
 *   state.pos      {number}  - current position in input (loop stage)
 *   state.prev     {object}  - { token, was_consonant, was_matra } - previous token metadata
 *   state.log      {Array}   - push strings to append log entries
 *   state.handled  {boolean} - set true in a loop hook to claim the token
 *                              and block the default match for this position
 *
 * config object passed to every hook:
 *   config.maps           - { forward: {...}, reverse: {...} } active maps
 *   config.virama         - virama character (U+09CD)
 *   config.inherent_vowel - inherent vowel roman token ('o')
 *   config.direction      - 'forward' | 'reverse'
 *   config.consonants_set - Set of consonant keys for active direction
 *   config.matras_set     - Set of matra keys for active direction
 *
 * Hardcoded-rule toggle flags (set via config_engine_settings snippet,
 * all default to true - set false to disable and handle via loop snippet):
 *   config.hardcode_independent_vowel - step 1: word-start independent vowel
 *   config.hardcode_explicit_zwnj     - step 2: apostrophe \u2192 ZWNJ
 *   config.hardcode_consonant_matra   - step 3: consonant + matra pair
 *   config.hardcode_consonant_cluster - step 4: consonant cluster + halanta/ZWJ
 */

// Defaults used only when no settings are supplied (see js-engine-settings.default.json).
const FALLBACK_SETTINGS = {
	virama: '\u09CD',
	inherent_vowel: 'o',
	zwj: '\u200D',
	zwnj: '\u200C',
	non_linking_consonants: [ 'r', 'R', 'ng', 'M', 'NG', 'Ng', ':', 'H', '^', '~' ],
	section_order: [ 'special', 'consonants', 'matras', 'independent_vowels', 'digits', 'punctuation' ],
	hardcode_independent_vowel: true,
	hardcode_explicit_zwnj: true,
	hardcode_consonant_matra: true,
	hardcode_consonant_cluster: true,
};

// -- Map helpers -----------------------------------------------------------

/**
 * Detect whether a map section is v2 (ordered pairs) or v1 (plain object).
 *
 * @param {*} raw
 * @return {boolean}
 */
function isPairsArray( raw ) {
	return Array.isArray( raw ) && raw.length > 0 && Array.isArray( raw[ 0 ] );
}

/**
 * Flatten all sections of a directional map into a single lookup array,
 * sorted longest-key-first, then by original array order within same length.
 *
 * @param {Object} map
 * @return {Array<[string, string]>}  [ [from, to], ... ]
 */
function flattenMap( map, sectionOrder ) {
	const items = [];
	let pos = 0;

	for ( const section of sectionOrder ) {
		const raw = map[ section ];
		if ( ! raw ) continue;

		if ( isPairsArray( raw ) ) {
			for ( const pair of raw ) {
				if ( Array.isArray( pair ) && pair[ 0 ] !== '_meta' ) {
					items.push( { from: String( pair[ 0 ] ), to: String( pair[ 1 ] ), pos: pos++ } );
				}
			}
		} else {
			for ( const [ k, v ] of Object.entries( raw ) ) {
				if ( k !== '_meta' ) {
					items.push( { from: String( k ), to: String( v ), pos: pos++ } );
				}
			}
		}
	}

	items.sort( ( a, b ) => {
		const lenDiff = b.from.length - a.from.length;
		return lenDiff !== 0 ? lenDiff : a.pos - b.pos;
	} );

	// Deduplicate (first occurrence wins after sort).
	const seen   = new Set();
	const result = [];
	for ( const item of items ) {
		if ( ! seen.has( item.from ) ) {
			seen.add( item.from );
			result.push( [ item.from, item.to ] );
		}
	}
	return result;
}

/**
 * Build a Set of keys from a single map section.
 *
 * @param {Object} map
 * @param {string} section
 * @return {Set<string>}
 */
function sectionKeySet( map, section ) {
	const raw  = map[ section ];
	const keys = new Set();
	if ( ! raw ) return keys;

	if ( isPairsArray( raw ) ) {
		for ( const pair of raw ) {
			if ( Array.isArray( pair ) && pair[ 0 ] !== '_meta' ) keys.add( String( pair[ 0 ] ) );
		}
	} else {
		for ( const k of Object.keys( raw ) ) {
			if ( k !== '_meta' ) keys.add( k );
		}
	}
	return keys;
}

// -- State factory ---------------------------------------------------------

/**
 * Create a fresh engine state object.
 *
 * @param {string} input
 * @return {Object}
 */
function makeState( input ) {
	return {
		input:   input,
		output:  '',
		pos:     0,
		prev:    { token: '', was_consonant: false, was_matra: false },
		log:     [],
		handled: false,
	};
}

// -- Core reverse loop -----------------------------------------------------

/**
 * Reverse transliteration core loop.
 *
 * @param {Object}   state
 * @param {Object}   config
 * @param {Array}    lookup
 * @param {Function[]} loopHooks
 * @return {Object}  state
 */
function reverseLoop( state, config, lookup, loopHooks ) {
	// Split input into Unicode-safe character array.
	const chars = [ ...state.input ];
	const total = chars.length;
	state.pos   = 0;

	while ( state.pos < total ) {
		state.handled = false;

		// -- Loop hooks ----------------------------------------------------
		for ( const fn of loopHooks ) {
			try {
				state = fn( state, config );
			} catch ( e ) {
				state.log.push( '[SNIPPET ERROR] ' + fn.name + ': ' + e.message );
			}
			if ( state.handled ) break;
		}

		if ( state.handled ) {
			state.handled = false;
			continue;
		}

		// -- Default longest-match -----------------------------------------
		let matched = false;

		for ( const [ bpm, roman ] of lookup ) {
			const slice = chars.slice( state.pos, state.pos + bpm.length ).join( '' );
			if ( slice !== bpm ) continue;

			const isConsonant = config.consonants_set.has( bpm );
			state.output     += roman;

			if ( isConsonant ) {
				const nextChar    = chars[ state.pos + bpm.length ] ?? '';
				const isMatra     = config.matras_set.has( nextChar );
				const isVirama    = nextChar === config.virama;
				if ( ! isMatra && ! isVirama ) {
					state.output += config.inherent_vowel;
					state.log.push( '[INHERENT] after \'' + bpm + '\'' );
				}
			}

			state.log.push( '[MATCH] \'' + bpm + '\' \u2192 \'' + roman + '\' (pos ' + state.pos + ')' );
			state.pos        += bpm.length;
			state.prev        = { token: bpm, was_consonant: isConsonant, was_matra: config.matras_set.has( bpm ) };
			matched           = true;
			break;
		}

		if ( ! matched ) {
			state.output += chars[ state.pos ];
			state.log.push( '[PASS] \'' + chars[ state.pos ] + '\' (pos ' + state.pos + ')' );
			state.pos++;
			state.prev = { token: chars[ state.pos - 1 ] || '', was_consonant: false, was_matra: false };
		}
	}

	return state;
}

// -- Public engine entry point ---------------------------------------------

/**
 * Run the full transliteration pipeline for a single direction.
 *
 * @param {string}     input
 * @param {string}     direction   'forward' | 'reverse'
 * @param {Object}     maps        { forward: {...}, reverse: {...} }
 * @param {Function[]} preHooks    - snippet functions for pre stage
 * @param {Function[]} loopHooks   - snippet functions for loop stage
 * @param {Function[]} postHooks   - snippet functions for post stage
 * @return {{ output: string, log: string[] }}
 */
function bpmTransliterate( input, direction, maps, preHooks, loopHooks, postHooks, engineToggles, settings ) {
	if ( direction !== 'reverse' ) {
		throw new Error( 'This build only supports reverse transliteration.' );
	}
	preHooks  = Array.isArray( preHooks )  ? preHooks  : [];
	loopHooks = Array.isArray( loopHooks ) ? loopHooks : [];
	postHooks = Array.isArray( postHooks ) ? postHooks : [];
	settings  = Object.assign( {}, FALLBACK_SETTINGS, settings || {} );

	const activeMap      = direction === 'forward' ? maps.forward : maps.reverse;
	const lookup         = flattenMap( activeMap, settings.section_order );
	const consonants_set = sectionKeySet( activeMap, 'consonants' );
	const matras_set     = sectionKeySet( activeMap, 'matras' );

	const config = Object.assign(
		{
			maps,
			virama:                  settings.virama,
			inherent_vowel:          settings.inherent_vowel,
			zwj:                     settings.zwj,
			zwnj:                    settings.zwnj,
			non_linking_consonants:  new Set( settings.non_linking_consonants ),
			direction,
			consonants_set,
			matras_set,
			hardcode_independent_vowel: settings.hardcode_independent_vowel,
			hardcode_explicit_zwnj:     settings.hardcode_explicit_zwnj,
			hardcode_consonant_matra:   settings.hardcode_consonant_matra,
			hardcode_consonant_cluster: settings.hardcode_consonant_cluster,
		},
		// engineToggles (from snippet config hooks) override settings-derived defaults.
		engineToggles || {}
	);

	let state = makeState( input );

	// NFC normalise for reverse direction (defensive).
	if ( direction === 'reverse' && typeof input === 'string' ) {
		state.input = input.normalize( 'NFC' );
	}

	// -- Pre hooks ---------------------------------------------------------
	for ( const fn of preHooks ) {
		try {
			state = fn( state, config );
		} catch ( e ) {
			state.log.push( '[SNIPPET ERROR pre] ' + fn.name + ': ' + e.message );
		}
	}

	// -- Main loop ---------------------------------------------------------
	state = reverseLoop( state, config, lookup, loopHooks );

	// -- Post hooks --------------------------------------------------------
	for ( const fn of postHooks ) {
		try {
			state = fn( state, config );
		} catch ( e ) {
			state.log.push( '[SNIPPET ERROR post] ' + fn.name + ': ' + e.message );
		}
	}

	return { output: state.output, log: state.log };
}


/* ==========================================================================
 * Public API
 * ========================================================================== */

const VERSION   = '1.0.3';
const DIRECTION = 'reverse';
const STAGES    = [ 'pre', 'loop', 'post' ];

function clone( value ) {
	return JSON.parse( JSON.stringify( value ) );
}

/**
 * Normalise a map to { section: [ [from, to], ... ] }.
 * Accepts plain [from, to] pairs (data/*.json) and the [id, from, to] rows the
 * TransLit-Lab stores and exports (same rule as mapForEngine() in the Lab).
 *
 * @param {Object} map
 * @return {Object}
 */
function normalizeMap( map ) {
	const out = {};
	for ( const section of Object.keys( map || {} ) ) {
		const entries = map[ section ];
		out[ section ] = Array.isArray( entries )
			? entries.map( function ( e ) { return Array.isArray( e ) && e.length === 3 ? [ e[ 1 ], e[ 2 ] ] : e; } )
			: entries;
	}
	return out;
}

/**
 * Turn a snippet's js_body (source text of one function) into a function.
 * Uses the Function constructor, so it is blocked by a Content-Security-Policy
 * without 'unsafe-eval'. The snippets bundled with this package are already
 * compiled and never go through here.
 *
 * @param {string} source
 * @return {Function}
 */
function compileSnippet( source ) {
	const fn = new Function( 'return (' + source + '\n)' )();
	if ( typeof fn !== 'function' ) {
		throw new TypeError( 'snippet body did not evaluate to a function' );
	}
	return fn;
}

/**
 * Select, order and compile the snippet rows that apply to this direction.
 * Rows use the TransLit-Lab format: { snippet_key, direction, hook_stage,
 * sort_order, is_active, js_body } - or carry an already-compiled `fn`.
 *
 * Order is the one the Lab uses (ORDER BY direction, hook_stage, sort_order):
 * rows for direction "both" run before rows for this direction.
 *
 * @param {Array} rows
 * @return {{ hooks: {pre: Function[], loop: Function[], post: Function[]}, warnings: string[] }}
 */
function buildHooks( rows ) {
	const hooks    = { pre: [], loop: [], post: [] };
	const warnings = [];
	const picked   = [];

	( Array.isArray( rows ) ? rows : [] ).forEach( function ( row, index ) {
		if ( ! row || typeof row !== 'object' ) return;
		const direction = row.direction || DIRECTION;
		if ( direction !== DIRECTION && direction !== 'both' ) return;
		const active = row.is_active === undefined || row.is_active === null
			? true
			: ( row.is_active !== '0' && !! row.is_active );
		if ( ! active ) return;
		if ( STAGES.indexOf( row.hook_stage ) === -1 ) {
			warnings.push( "Snippet '" + row.snippet_key + "' skipped: unknown hook_stage '" + row.hook_stage + "'" );
			return;
		}
		picked.push( { row: row, index: index, direction: direction, order: Number( row.sort_order ) || 0 } );
	} );

	picked.sort( function ( a, b ) {
		return ( a.direction < b.direction ? -1 : a.direction > b.direction ? 1 : 0 )
			|| a.order - b.order
			|| a.index - b.index;
	} );

	for ( const item of picked ) {
		const row = item.row;
		let fn    = row.fn;
		if ( typeof fn !== 'function' ) {
			if ( ! row.js_body || String( row.js_body ).trim() === '' ) continue;
			try {
				fn = compileSnippet( row.js_body );
			} catch ( e ) {
				warnings.push( "Snippet '" + row.snippet_key + "' skipped: " + e.message );
				continue;
			}
		}
		hooks[ row.hook_stage ].push( fn );
	}
	return { hooks: hooks, warnings: warnings };
}

/**
 * Create a transliterator.
 *
 * With no options it uses the map, settings and snippets bundled in this file.
 *
 * @param {Object}   [options]
 * @param {Object}   [options.map]       Map to use instead of the bundled one.
 * @param {Object}   [options.settings]  Engine settings, merged over the bundled ones.
 * @param {Array}    [options.snippets]  Snippet rows to use INSTEAD of the bundled ones ([] = none).
 * @param {boolean}  [options.silent]    Do not console.warn about skipped snippets.
 * @return {{ direction: string, transliterate: function(string): string,
 *            run: function(string): {output: string, log: string[]},
 *            map: Object, settings: Object, warnings: string[] }}
 */
function create( options ) {
	options = options || {};

	const map      = normalizeMap( options.map || DEFAULT_MAP );
	const settings = Object.assign( {}, DEFAULT_SETTINGS, options.settings || {} );
	const built    = buildHooks( options.snippets || DEFAULT_SNIPPETS );
	const maps     = { forward: {}, reverse: {} };
	maps[ DIRECTION ] = map;

	if ( built.warnings.length && options.silent !== true && typeof console !== 'undefined' && console.warn ) {
		built.warnings.forEach( function ( w ) { console.warn( '[translit] ' + w ); } );
	}

	function run( text ) {
		const input = text === null || text === undefined ? '' : String( text );
		return bpmTransliterate( input, DIRECTION, maps, built.hooks.pre, built.hooks.loop, built.hooks.post, null, settings );
	}

	function transliterate( text ) {
		return run( text ).output;
	}

	return {
		direction:     DIRECTION,
		transliterate: transliterate,
		run:           run,
		map:           map,
		settings:      settings,
		warnings:      built.warnings,
	};
}

let defaultInstance = null;
function getDefaultInstance() {
	return defaultInstance || ( defaultInstance = create() );
}

const API = {
	version:   VERSION,
	direction: DIRECTION,
	create:    create,
	/** Transliterate with the bundled data. @param {string} text @return {string} */
	transliterate: function ( text ) { return getDefaultInstance().transliterate( text ); },
	/** Same, but returns { output, log }. */
	run:           function ( text ) { return getDefaultInstance().run( text ); },
	compileSnippet: compileSnippet,
	normalizeMap:   normalizeMap,
	/** Fresh copy of the bundled data, safe to modify and pass back to create(). */
	getDefaults: function () {
		return {
			map:      clone( DEFAULT_MAP ),
			settings: clone( DEFAULT_SETTINGS ),
			snippets: DEFAULT_SNIPPETS.map( function ( s ) { return Object.assign( {}, s ); } ),
		};
	},
	/** Low-level engine pieces (advanced). */
	engine: { bpmTransliterate: bpmTransliterate, flattenMap: flattenMap, sectionKeySet: sectionKeySet, makeState: makeState, FALLBACK_SETTINGS: FALLBACK_SETTINGS },
};

return API;
} );
