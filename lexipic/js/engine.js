/**
 * CompLing AI — BPM Fixed Transliteration Engine
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
 *   state.input    {string}  — full original input string
 *   state.output   {string}  — accumulated output
 *   state.pos      {number}  — current position in input (loop stage)
 *   state.prev     {object}  — { token, was_consonant, was_matra } — previous token metadata
 *   state.log      {Array}   — push strings to append log entries
 *   state.handled  {boolean} — set true in a loop hook to claim the token
 *                              and block the default match for this position
 *
 * config object passed to every hook:
 *   config.maps           — { forward: {...}, reverse: {...} } active maps
 *   config.virama         — virama character (U+09CD)
 *   config.inherent_vowel — inherent vowel roman token ('o')
 *   config.direction      — 'forward' | 'reverse'
 *   config.consonants_set — Set of consonant keys for active direction
 *   config.matras_set     — Set of matra keys for active direction
 *
 * Hardcoded-rule toggle flags (set via config_engine_settings snippet,
 * all default to true — set false to disable and handle via loop snippet):
 *   config.hardcode_independent_vowel — step 1: word-start independent vowel
 *   config.hardcode_explicit_zwnj     — step 2: apostrophe → ZWNJ
 *   config.hardcode_consonant_matra   — step 3: consonant + matra pair
 *   config.hardcode_consonant_cluster — step 4: consonant cluster + halanta/ZWJ
 */

/* global CPLAI_ENGINE */
( function ( window ) {
	'use strict';

	// Defaults used only when no settings are supplied (see js-engine-settings.default.json).
	const FALLBACK_SETTINGS = {
		virama: '\u09CD',
		inherent_vowel: 'o',
		zwj: '\u200D',
		zwnj: '\u200C',
		non_linking_consonants: [ 'ng', 'M', 'NG', 'Ng', ':', 'H', '^', '~' ],
		section_order: [ 'special', 'consonants', 'matras', 'independent_vowels', 'digits', 'punctuation' ],
		hardcode_independent_vowel: true,
		hardcode_explicit_zwnj: true,
		hardcode_consonant_matra: true,
		hardcode_consonant_cluster: true,
	};

	// ── Map helpers ───────────────────────────────────────────────────────────

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
	 * @return {Array<[string, string]>}  [ [from, to], … ]
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

	// ── State factory ─────────────────────────────────────────────────────────

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

	// ── Forward core: hardcoded logic ─────────────────────────────────────────

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

	// ── Core forward loop ─────────────────────────────────────────────────────

	/**
	 * Forward transliteration core loop.
	 *
	 * Execution order at each position:
	 *  1. fwd_loop_atstart_independent_vowel — word-start independent vowel
	 *     (skipped when config.hardcode_independent_vowel === false)
	 *  2. loop_explicit_zwnj                 — apostrophe → ZWNJ conjunct-breaker
	 *     (skipped when config.hardcode_explicit_zwnj === false)
	 *  3. fwd_loop_consonant_plus_matra      — consonant + matra pair
	 *     (skipped when config.hardcode_consonant_matra === false)
	 *  4. fwd_loop_consonant_cluster_halanta — consonant cluster + halanta/ZWJ
	 *     (skipped when config.hardcode_consonant_cluster === false)
	 *  5. External loopHooks                 — remaining snippet hooks
	 *  6. Default longest-match              — falls through when nothing above matched
	 *
	 * NOTE: loop_virama_conjunct (snippet index 9) was dead code — it referenced
	 * state.currentIsConsonant which does not exist in the state contract — and is
	 * not ported here. Virama insertion between consonant clusters is owned
	 * exclusively by step 4 above (when enabled).
	 *
	 * @param {Object}   state
	 * @param {Object}   config
	 * @param {Array}    lookup        — flattenMap output
	 * @param {Function[]} loopHooks
	 * @param {Object}   fwdLookups   — buildForwardLookups output
	 * @return {Object}  state
	 */
	function forwardLoop( state, config, lookup, loopHooks, fwdLookups ) {
		const len = state.input.length;
		const { consonantMap, matraMap, ivMap, sortedCons, sortedMatras, sortedIV } = fwdLookups;

		while ( state.pos < len ) {
			state.handled = false;
			const input = state.input;
			const pos   = state.pos;

			// ── 1. fwd_loop_atstart_independent_vowel ────────────────────────
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
					state.log.push( '[FWD IND VOWEL] ' + ivMatch + ' → ' + ivMap[ ivMatch ] );
				}
			}

			// ── 2. loop_explicit_zwnj ─────────────────────────────────────────
			// Apostrophe in input → emit ZWNJ to break conjunct formation.
			if ( ! state.handled && config.hardcode_explicit_zwnj !== false ) {
				if ( input[ state.pos ] === "'" ) {
					state.output  += config.zwnj;
					state.pos     += 1;
					state.handled  = true;
					state.log.push( '[ZWNJ] explicit ZWNJ emitted at pos ' + state.pos );
				}
			}

			// ── 3. fwd_loop_consonant_plus_matra ─────────────────────────────
			// Match consonant key, then immediately scan for a following matra.
			// Sub-cases:
			//   (a) matra 'o' = inherent vowel suppressor: bare consonant + ZWNJ
			//       at word boundary, or bare consonant mid-word.
			//   (b) apostrophe matra → consonant + ZWNJ conjunct-breaker.
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

			// ── 4. fwd_loop_consonant_cluster_halanta ────────────────────────
			// Consonant followed by another consonant (no matra between them).
			// 'r' + consonant → reph: r + HALANTA + ZWJ.
			// 'r' + 'r'       → double-r: r + HALANTA (no ZWJ).
			// non-linking      → emit bare (no halanta).
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

			// ── 5. External loop hooks (remaining snippets) ───────────────────
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

			// ── 6. Default longest-match ──────────────────────────────────────
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
				state.log.push( '[MATCH] \'' + roman + '\' → \'' + bpm + '\' (pos ' + state.pos + ')' );
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

	// ── Core reverse loop ─────────────────────────────────────────────────────

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

			// ── Loop hooks ────────────────────────────────────────────────────
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

			// ── Default longest-match ─────────────────────────────────────────
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

				state.log.push( '[MATCH] \'' + bpm + '\' → \'' + roman + '\' (pos ' + state.pos + ')' );
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

	// ── Public engine entry point ─────────────────────────────────────────────

	/**
	 * Run the full transliteration pipeline for a single direction.
	 *
	 * @param {string}     input
	 * @param {string}     direction   'forward' | 'reverse'
	 * @param {Object}     maps        { forward: {…}, reverse: {…} }
	 * @param {Function[]} preHooks    — snippet functions for pre stage
	 * @param {Function[]} loopHooks   — snippet functions for loop stage
	 * @param {Function[]} postHooks   — snippet functions for post stage
	 * @return {{ output: string, log: string[] }}
	 */
	function bpmTransliterate( input, direction, maps, preHooks, loopHooks, postHooks, engineToggles, settings ) {
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

		// ── Pre hooks ─────────────────────────────────────────────────────────
		for ( const fn of preHooks ) {
			try {
				state = fn( state, config );
			} catch ( e ) {
				state.log.push( '[SNIPPET ERROR pre] ' + fn.name + ': ' + e.message );
			}
		}

		// ── Main loop ─────────────────────────────────────────────────────────
		if ( direction === 'forward' ) {
			const fwdLookups = buildForwardLookups( maps.forward );
			state = forwardLoop( state, config, lookup, loopHooks, fwdLookups );
		} else {
			state = reverseLoop( state, config, lookup, loopHooks );
		}

		// ── Post hooks ────────────────────────────────────────────────────────
		for ( const fn of postHooks ) {
			try {
				state = fn( state, config );
			} catch ( e ) {
				state.log.push( '[SNIPPET ERROR post] ' + fn.name + ': ' + e.message );
			}
		}

		return { output: state.output, log: state.log };
	}

	// ── Expose via global namespace ───────────────────────────────────────────
	window.CPLAI_ENGINE = {
		bpmTransliterate,
		flattenMap,
		sectionKeySet,
		makeState,
		FALLBACK_SETTINGS,
	};

} )( window );
