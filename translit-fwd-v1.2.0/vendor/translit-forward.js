/*! translit-js-forward v1.0.4
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
		root.TranslitForward = factory();
	}
} )( typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
'use strict';
/* -- Bundled data (generated from data/*.json by scripts/build.js) -- */
const DEFAULT_MAP = {"consonants":[["ssh","\u09B7"],["kkh","\u0995\u09CD\u09B7"],["chh","\u099B"],["t``","\u09CE"],["t''","\u09CE"],["rry","\u09F0\u09CD\u09AF"],["Sh","\u09B7"],["kh","\u0996"],["gh","\u0998"],["ch","\u099A"],["jh","\u099D"],["Th","\u09A0"],["Dh","\u09A2"],["th","\u09A5"],["dh","\u09A7"],["ph","\u09AB"],["bh","\u09AD"],["rr","\u09B0"],["rr","\u09F0"],["sh","\u09B8"],["y^","\u099E"],["Ng","\u0999"],["ng","\u0982"],["Rh","\u09A2\u09BC"],["S","\u09B6"],["k","\u0995"],["g","\u0997"],["j","\u099C"],["T","\u099F"],["D","\u09A1"],["N","\u09A3"],["t","\u09A4"],["d","\u09A6"],["n","\u09A8"],["p","\u09AA"],["f","\u09AB"],["b","\u09AC"],["v","\u09AD"],["m","\u09AE"],["y","\u09AF\u09BC"],["z","\u09AF"],["r","\u09B0"],["r","\u09F0"],["R","\u09A1\u09BC"],["l","\u09B2"],["w","\u09F1"],["s","\u099B"],["h","\u09B9"]],"digits":[["0","\u09E6"],["1","\u09E7"],["2","\u09E8"],["3","\u09E9"],["4","\u09EA"],["5","\u09EB"],["6","\u09EC"],["7","\u09ED"],["8","\u09EE"],["9","\u09EF"]],"independent_vowels":[["rri","\u098B"],["OI","\u0990"],["OU","\u0994"],["aa","\u0986"],["ee","\u0987"],["ii","\u0988"],["oo","\u0989"],["uu","\u098A"],["o","\u0985"],["a","\u0986"],["A","\u0986"],["i","\u0987"],["I","\u0988"],["u","\u0989"],["U","\u098A"],["e","\u098F"],["O","\u0993"]],"matras":[["rri","\u09C3"],["OI","\u09C8"],["OU","\u09CC"],["aa","\u09BE"],["ii","\u09C0"],["uu","\u09C2"],["o","\"\""],["A","\u09BE"],["I","\u09C0"],["U","\u09C2"],["a","\u09BE"],["i","\u09BF"],["u","\u09C1"],["e","\u09C7"],["O","\u09CB"],["y","\u09CD\u09AF"],["Y","\u09CD\u09AF"],["'","\u200C"]],"punctuation":[["..","\u0965"],[".","\u0964"],["!","!"],["?","?"],[";",";"],["(","("],[")",")"],["-","-"],["+","+"],["*","*"]],"special":[["ngg","\u0999\u09CD\u0997"],["ng","\u0982"],[",,","\u09CD\u200C"],["M","\u0982"],[":","\u0983"],["H","\u0983"],["^","\u0981"],["~","\u0981"]]};
const DEFAULT_SETTINGS = {"hardcode_consonant_cluster":1,"hardcode_consonant_matra":1,"hardcode_explicit_zwnj":1,"hardcode_independent_vowel":1,"inherent_vowel":"o","non_linking_consonants":["r","R","ng","M","NG","Ng",":","H","^","~"],"section_order":["special","consonants","matras","independent_vowels","digits","punctuation"],"virama":"\u09CD","zwj":"\u200D","zwnj":"\u200C"};
const DEFAULT_SNIPPETS = [
	{"snippet_key":"fwd_loop_vowel_after_vowel","label":"Shankar: Subsequent Vowel Independent Form","direction":"forward","hook_stage":"loop","sort_order":50,"is_active":1,"fn":(function fwdLoopVowelAfterVowel(state, config) {
  const matraKeys = (config.maps.forward.matras || [])
    .filter(function(p) { return Array.isArray(p) && p[0] !== '_meta' && p[0] !== 'o'; })
    .map(function(p) { return p[0]; })
    .sort(function(a, b) { return b.length - a.length; });

  const consumed     = state.input.slice(0, state.pos);
  const prevWasMatra = state.prev.was_matra
    || matraKeys.some(function(mk) { return consumed.endsWith(mk); })
    || consumed.endsWith('o');

  if (!prevWasMatra) return state;

  const ivMap = {};
  (config.maps.forward.independent_vowels || []).forEach(function(p) {
    if (Array.isArray(p) && p[0] !== '_meta') ivMap[p[0]] = p[1];
  });
  const sortedIV = Object.keys(ivMap).sort(function(a, b) { return b.length - a.length; });

  const ivMatch = sortedIV.find(function(vk) {
    return state.input.startsWith(vk, state.pos);
  });
  if (!ivMatch) return state;

  state.output  += ivMap[ivMatch];
  state.pos     += ivMatch.length;
  state.prev     = { token: ivMatch, was_consonant: false, was_matra: false };
  state.handled  = true;
  state.log.push('[V+V INDEP] ' + ivMatch + ' \u2192 ' + ivMap[ivMatch] + ' (independent vowel after matra)');
  return state;
}
)},
	{"snippet_key":"pre_anusvara_substitution","label":"Forward Pre: Anusvara + Vowel Substitution (ng+vowel \u2192 \u0999+matra) + \u0999\u09CD\u0997 Handling","direction":"forward","hook_stage":"pre","sort_order":6,"is_active":1,"fn":(function preAnusvaraVowelSubstitution(state, config) {
  const NGA = '\u0999'; // \u0999
  let input = state.input.replace(/[\u200c\u200d]/g, '');
  const matras = config.maps.forward.matras || [];
  
  const getMatra = (key) => {
    const match = matras.find(p => p[0] === key);
    return match ? match[1] : '';
  };

  // ONLY handle standard 'ng' here. Do not intercept 'ngg'!
  const subs = [
    ['ngai',  NGA + getMatra('a') + (config.maps.forward.independent_vowels.find(p => p[0] === 'i')[1] || '\u0987')],
    ['ngOI',  NGA + getMatra('OI')],
    ['ngOU',  NGA + getMatra('OU')],
    ['ngaa',  NGA + (getMatra('aa')  || getMatra('A'))],
    ['ngee',  NGA + (getMatra('ee')  || getMatra('ii'))],
    ['ngii',  NGA + getMatra('ii')],
    ['nguu',  NGA + (getMatra('uu')  || getMatra('U'))],
    ['ngA',   NGA + getMatra('A')],
    ['ngU',   NGA + getMatra('U')],
    ['ngrri', NGA + getMatra('rri')],
    ['ngai',  NGA + getMatra('ai')],
    ['ngO',   NGA + getMatra('O')],
	['ngu',   NGA + getMatra('u')],  
    ['nge',   NGA + getMatra('e')],
    ['ngi',   NGA + getMatra('i')],
    ['nga',   NGA + getMatra('a')],
    ['ngo',   NGA],
  ];

  for (const [from, to] of subs) {
    if (to !== undefined && to !== null && input.includes(from)) {
      input = input.split(from).join(to);
      state.log.push('[PRE ANUSVARA] ' + from + ' \u2192 ' + to);
    }
  }

  state.input = input;
  return state;
}
)}
];

/*
 * translit-js-forward: the forward-only core of the CompLing AI BPM engine.
 * Extracted from assets/engine.js (engine 4.2.0, TransLit-Lab 1.1.1); the
 * reverse loop was removed, the logic that remains is unchanged.
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

// -- Forward core: hardcoded logic -----------------------------------------

/**
 * Build sorted arrays and maps for the forward-loop core logic.
 * Called once per transliterate() invocation; result threaded into forwardLoop.
 *
 * @param {Object} fwdMap
 * @return {{ consonantMap, matraMap, ivMap, sortedCons, sortedMatras, sortedIV }}
 */
function buildForwardLookups( fwdMap ) {
	const consonantMap = Object.fromEntries(
		isPairsArray( fwdMap.consonants ) ? ( fwdMap.consonants || [] ) : Object.entries( fwdMap.consonants || {} )
	);
	const matraMap = Object.fromEntries(
		isPairsArray( fwdMap.matras ) ? ( fwdMap.matras || [] ) : Object.entries( fwdMap.matras || {} )
	);
	const ivMap = Object.fromEntries(
		isPairsArray( fwdMap.independent_vowels )
			? ( fwdMap.independent_vowels || [] )
			: Object.entries( fwdMap.independent_vowels || {} )
	);

	const sortedCons   = Object.keys( consonantMap ).sort( ( a, b ) => b.length - a.length );
	const sortedMatras = Object.keys( matraMap ).sort( ( a, b ) => b.length - a.length );
	const sortedIV     = Object.keys( ivMap ).sort( ( a, b ) => b.length - a.length );

	return { consonantMap, matraMap, ivMap, sortedCons, sortedMatras, sortedIV };
}

// -- Core forward loop -----------------------------------------------------

/**
 * Forward transliteration core loop.
 *
 * Execution order at each position:
 *  1. fwd_loop_atstart_independent_vowel - word-start independent vowel
 *     (skipped when config.hardcode_independent_vowel === false)
 *  2. loop_explicit_zwnj                 - apostrophe \u2192 ZWNJ conjunct-breaker
 *     (skipped when config.hardcode_explicit_zwnj === false)
 *  3. fwd_loop_consonant_plus_matra      - consonant + matra pair
 *     (skipped when config.hardcode_consonant_matra === false)
 *  4. fwd_loop_consonant_cluster_halanta - consonant cluster + halanta/ZWJ
 *     (skipped when config.hardcode_consonant_cluster === false)
 *  5. External loopHooks                 - remaining snippet hooks
 *  6. Default longest-match              - falls through when nothing above matched
 *
 * NOTE: loop_virama_conjunct (snippet index 9) was dead code - it referenced
 * state.currentIsConsonant which does not exist in the state contract - and is
 * not ported here. Virama insertion between consonant clusters is owned
 * exclusively by step 4 above (when enabled).
 *
 * @param {Object}   state
 * @param {Object}   config
 * @param {Array}    lookup        - flattenMap output
 * @param {Function[]} loopHooks
 * @param {Object}   fwdLookups   - buildForwardLookups output
 * @return {Object}  state
 */
function forwardLoop( state, config, lookup, loopHooks, fwdLookups ) {
	const len = state.input.length;
	const { consonantMap, matraMap, ivMap, sortedCons, sortedMatras, sortedIV } = fwdLookups;

	while ( state.pos < len ) {
		state.handled = false;
		const input = state.input;
		const pos   = state.pos;

		// -- 1. fwd_loop_atstart_independent_vowel ------------------------
		// Word-start independent vowel form. Only fires when we are at the
		// start of input (pos === 0) or the immediately preceding character
		// is non-alphabetic, AND the previous consumed slice does NOT itself
		// end with a vowel key (which would mean the vowel is a matra).
		if ( ! state.handled && config.hardcode_independent_vowel !== false ) {
			const atStart        = ( pos === 0 ) || /[^a-zA-Z]/.test( input[ pos - 1 ] );
			const consumed       = input.slice( 0, pos );
			const prevEndsVowel  = sortedIV.some( vk => consumed.endsWith( vk ) );
			const ivMatch        = sortedIV.find( vk => input.startsWith( vk, pos ) );

			if ( ivMatch && atStart && ! prevEndsVowel ) {
				state.output          += ivMap[ ivMatch ];
				state.pos             += ivMatch.length;
				state.prev.was_consonant = false;
				state.handled          = true;
				state.log.push( '[FWD IND VOWEL] ' + ivMatch + ' \u2192 ' + ivMap[ ivMatch ] );
			}
		}

		// -- 2. loop_explicit_zwnj -----------------------------------------
		// Apostrophe in input \u2192 emit ZWNJ to break conjunct formation.
		if ( ! state.handled && config.hardcode_explicit_zwnj !== false ) {
			if ( input[ state.pos ] === "'" ) {
				state.output  += config.zwnj;
				state.pos     += 1;
				state.handled  = true;
				state.log.push( '[ZWNJ] explicit ZWNJ emitted at pos ' + state.pos );
			}
		}

		// -- 3. fwd_loop_consonant_plus_matra -----------------------------
		// Match consonant key, then immediately scan for a following matra.
		// Sub-cases:
		//   (a) matra 'o' = inherent vowel suppressor: bare consonant + ZWNJ
		//       at word boundary, or bare consonant mid-word.
		//   (b) apostrophe matra \u2192 consonant + ZWNJ conjunct-breaker.
		//   (c) y/Y matra: y-fala chaining with optional second matra.
		//   (d) all other matras: consonant + matra glyph.
		// Sets state.prev.was_consonant = true.
		if ( ! state.handled && config.hardcode_consonant_matra !== false ) {
			const cMatch = sortedCons.find( ck => input.startsWith( ck, state.pos ) );
			if ( cMatch !== undefined ) {
				const nextPos    = state.pos + cMatch.length;
				const matraMatch = sortedMatras.find( mk => input.startsWith( mk, nextPos ) );

				if ( matraMatch !== undefined ) {
					const bpm        = consonantMap[ cMatch ];
					const afterMatra = nextPos + matraMatch.length;

					if ( matraMatch === 'o' ) {
						const charAfter = input[ afterMatra ];
						state.output += ( ! charAfter || /[^a-zA-Z]/.test( charAfter ) )
							? bpm + config.zwnj
							: bpm;
						state.pos = afterMatra;
					} else if ( matraMatch === "'" ) {
						state.output += bpm + config.zwnj;
						state.pos     = afterMatra;
					} else if ( matraMatch === 'y' || matraMatch === 'Y' ) {
						const yValue           = matraMap[ matraMatch ] || '';
						const secondMatraMatch = sortedMatras.find( mk2 => input.startsWith( mk2, afterMatra ) );
						if ( secondMatraMatch !== undefined ) {
							if ( secondMatraMatch === 'o' ) {
								const charAfter2 = input[ afterMatra + secondMatraMatch.length ];
								state.output += bpm + yValue +
									( ! charAfter2 || /[^a-zA-Z]/.test( charAfter2 ) ? config.zwnj : '' );
							} else {
								state.output += bpm + yValue + ( matraMap[ secondMatraMatch ] || '' );
							}
							state.pos = afterMatra + secondMatraMatch.length;
						} else {
							state.output += bpm + yValue;
							state.pos     = afterMatra;
						}
					} else {
						state.output += bpm + ( matraMap[ matraMatch ] || '' );
						state.pos     = afterMatra;
					}

					state.prev.was_consonant = true;
					state.handled            = true;
					state.log.push( '[FWD CONS+MATRA] ' + cMatch + ' + ' + matraMatch );
				}
			}
		}

		// -- 4. fwd_loop_consonant_cluster_halanta ------------------------
		// Consonant followed by another consonant (no matra between them).
		// 'r' + consonant \u2192 reph: r + HALANTA + ZWJ.
		// 'r' + 'r'       \u2192 double-r: r + HALANTA (no ZWJ).
		// non-linking      \u2192 emit bare (no halanta).
		// Sets state.prev.was_consonant = true.
		if ( ! state.handled && config.hardcode_consonant_cluster !== false ) {
			const cMatch = sortedCons.find( ck => input.startsWith( ck, state.pos ) );
			if ( cMatch !== undefined ) {
				const nextPos    = state.pos + cMatch.length;
				const matraMatch = sortedMatras.find( mk => input.startsWith( mk, nextPos ) );

				// Only fires when there is NO matra immediately after the consonant.
				if ( matraMatch === undefined ) {
					const bpm          = consonantMap[ cMatch ];
					const nextCons     = sortedCons.find( ck2 => input.startsWith( ck2, nextPos ) );
					const isNonLinking = config.non_linking_consonants.has( cMatch );

					if ( nextCons && ! isNonLinking ) {
						if ( cMatch === 'r' && input.startsWith( 'r', nextPos ) ) {
							state.output += bpm + config.virama; // rr: halanta only
						} else if ( cMatch === 'r' ) {
							state.output += bpm + config.virama + config.zwj; // reph: halanta + ZWJ
						} else {
							state.output += bpm + config.virama;
						}
					} else {
						state.output += bpm; // non-linking or end of cluster
					}

					state.pos             = nextPos;
					state.prev.was_consonant = true;
					state.handled          = true;
					state.log.push( '[FWD CLUSTER] ' + cMatch + ( nextCons && ! isNonLinking ? '+HALANTA' : ' bare' ) );
				}
			}
		}

		// -- 5. External loop hooks (remaining snippets) -------------------
		if ( ! state.handled ) {
			for ( const fn of loopHooks ) {
				try {
					state = fn( state, config );
				} catch ( e ) {
					state.log.push( '[SNIPPET ERROR] ' + fn.name + ': ' + e.message );
				}
				if ( state.handled ) break;
			}
		}

		if ( state.handled ) {
			state.handled = false;
			continue;
		}

		// -- 6. Default longest-match --------------------------------------
		let matched = false;

		for ( const [ roman, bpm ] of lookup ) {
			const chunk = state.input.substr( state.pos, roman.length );
			if ( chunk !== roman ) continue;

			const isConsonant = config.consonants_set.has( roman );
			const isMatra     = config.matras_set.has( roman );

			if ( state.prev.was_consonant && isConsonant ) {
				state.output += config.virama;
				state.log.push( '[VIRAMA] before \'' + roman + '\'' );
			}

			state.output      += bpm;
			state.log.push( '[MATCH] \'' + roman + '\' \u2192 \'' + bpm + '\' (pos ' + state.pos + ')' );
			state.pos         += roman.length;
			state.prev         = { token: roman, was_consonant: isConsonant && ! isMatra, was_matra: isMatra };
			matched            = true;
			break;
		}

		if ( ! matched ) {
			const ch       = state.input[ state.pos ];
			state.output  += ch;
			state.log.push( '[PASS] \'' + ch + '\' (pos ' + state.pos + ')' );
			state.pos++;
			state.prev = { token: ch, was_consonant: false, was_matra: false };
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
	if ( direction !== 'forward' ) {
		throw new Error( 'This build only supports forward transliteration.' );
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

	// -- Pre hooks ---------------------------------------------------------
	for ( const fn of preHooks ) {
		try {
			state = fn( state, config );
		} catch ( e ) {
			state.log.push( '[SNIPPET ERROR pre] ' + fn.name + ': ' + e.message );
		}
	}

	// -- Main loop ---------------------------------------------------------
	const fwdLookups = buildForwardLookups( maps.forward );
	state = forwardLoop( state, config, lookup, loopHooks, fwdLookups );

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

const VERSION   = '1.0.4';
const DIRECTION = 'forward';
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
