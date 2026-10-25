/**
 * CompLing AI — BPM Fixed Transliteration Engine (Extracted for Lekhoni)
 *
 * Version:   4.3.1
 * Original:  BhoomiTech Heritage and Development Foundation
 * Extraction for Lekhoni: 2026
 * License:   GPL-2.0-or-later
 *
 * Changes in 4.3.1
 *  - y after a linking consonant gives the y-phala ্য (not ্য়): kabyo → কাব্য.
 *
 * Changes in 4.3.0
 *  - Virama logic lives in ONE place (needsVirama) and honours settings:
 *      non_linking_consonants  — never take a virama AFTER them (plain `r` → no reph)
 *      no_virama_before        — signs that never take a virama BEFORE them (ং ঃ ঁ …)
 *  - Plain `r` no longer forms reph; type `rr` for an explicit reph (amarrta → আমাৰ্তা).
 *  - Ra-phala still works: `pr` → প্ৰ (virama is decided by the PREVIOUS consonant).
 *  - Removed the broken cluster step that skipped the virama in 3-consonant clusters
 *    and left prev.token stale.
 *  - Vowel after a vowel/matra now yields the independent vowel (kia → কিআ, ai → আই),
 *    instead of a dangling matra.
 *  - Language overrides: map.lang_overrides[lang] replaces entries per section
 *    (e.g. 'bn' swaps ৰ → র). Set via settings.lang or engine.setLanguage().
 *  - Lookup tables are cached per language instead of rebuilt on every call.
 *
 * Usage:
 *   const engine = new TranslitEngine(forwardMap, reverseMap, { lang: 'as' });
 *   const result = engine.transliterate(input, 'forward');
 *   result.output // Assamese/Bengali string
 *   result.log    // debug log
 */

(function (global) {
	'use strict';

	const FALLBACK_SETTINGS = {
		lang: 'as',
		virama: '্',           // ্
		inherent_vowel: 'o',
		zwj: '‍',
		zwnj: '‌',
		// Consonant keys that never take a virama AFTER them (no conjunct with what follows).
		non_linking_consonants: ['r', 'R', 'Rh', 'ng', 'M', ':', 'H', '^', '~'],
		// Keys that never take a virama BEFORE them (signs attach to the previous letter).
		no_virama_before: ['ng', 'M', ':', 'H', '^', '~', ',,'],
		// Letter to use when a key joins a preceding consonant (y-phala: ্য, not ্য়).
		// Type an apostrophe to keep the full letter: k'y → ক‌য়.
		phala_forms: { y: '\u09AF' },
		section_order: ['special', 'consonants', 'matras', 'independent_vowels', 'digits', 'punctuation'],
		hardcode_independent_vowel: true,
		hardcode_explicit_zwnj: true,
		hardcode_consonant_matra: true,
		hardcode_consonant_cluster: true,
	};

	// ── Map helpers ────────────────────────────────────────────────────────

	function isPairsArray(raw) {
		return Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0]);
	}

	function toPairs(raw) {
		if (!raw) return [];
		const pairs = isPairsArray(raw) ? raw : Object.entries(raw);
		return pairs
			.filter(p => Array.isArray(p) && p[0] !== '_meta')
			.map(p => [String(p[0]), String(p[1])]);
	}

	/** Apply map.lang_overrides[lang] on top of the base sections. */
	function resolveMap(map, lang) {
		const overrides = (map.lang_overrides && map.lang_overrides[lang]) || {};
		const out = {};
		for (const section of Object.keys(map)) {
			if (section === 'lang_overrides' || section === '_meta') continue;
			const base = toPairs(map[section]);
			const ov = toPairs(overrides[section]);
			if (!ov.length) { out[section] = base; continue; }
			const ovMap = new Map(ov);
			const merged = base.map(([k, v]) => [k, ovMap.has(k) ? ovMap.get(k) : v]);
			for (const [k, v] of ov) if (!base.some(p => p[0] === k)) merged.push([k, v]);
			out[section] = merged;
		}
		return out;
	}

	function flattenMap(map, sectionOrder) {
		const items = [];
		let pos = 0;
		for (const section of sectionOrder) {
			for (const [from, to] of toPairs(map[section])) {
				items.push({ from, to, pos: pos++ });
			}
		}
		items.sort((a, b) => (b.from.length - a.from.length) || (a.pos - b.pos));

		const seen = new Set();
		const result = [];
		for (const item of items) {
			if (!seen.has(item.from)) {
				seen.add(item.from);
				result.push([item.from, item.to]);
			}
		}
		return result;
	}

	function keySet(map, section) {
		return new Set(toPairs(map[section]).map(p => p[0]));
	}

	function byLengthDesc(obj) {
		return Object.keys(obj).sort((a, b) => b.length - a.length);
	}

	function buildTables(map, settings) {
		const consonantMap = Object.fromEntries(toPairs(map.consonants));
		const matraMap = Object.fromEntries(toPairs(map.matras));
		const ivMap = Object.fromEntries(toPairs(map.independent_vowels));
		return {
			lookup: flattenMap(map, settings.section_order),
			consonants_set: keySet(map, 'consonants'),
			matras_set: keySet(map, 'matras'),
			fwd: {
				consonantMap, matraMap, ivMap,
				sortedCons: byLengthDesc(consonantMap),
				sortedMatras: byLengthDesc(matraMap),
				sortedIV: byLengthDesc(ivMap),
			},
		};
	}

	// ── State factory ──────────────────────────────────────────────────────

	function makeState(input) {
		return {
			input: input,
			output: '',
			pos: 0,
			prev: { token: '', was_consonant: false, was_matra: false },
			log: [],
			handled: false,
		};
	}

	/**
	 * Single source of truth for virama insertion between two consonant keys.
	 * The PREVIOUS consonant decides whether it links (so `pr` → প্ৰ, but `rt` → ৰত).
	 */
	function needsVirama(prevToken, curToken, config) {
		if (!prevToken) return false;
		if (config.non_linking_consonants.has(prevToken)) return false;
		if (config.no_virama_before.has(curToken)) return false;
		return true;
	}

	function emitConsonant(state, config, key, bpm, tag) {
		if (state.prev.was_consonant && needsVirama(state.prev.token, key, config)) {
			state.output += config.virama;
			state.log.push('[VIRAMA] ' + state.prev.token + ' + ' + key);
			// Phala form: inside a cluster some keys use a different letter
			// (y → য, not য়, so k+y gives the y-phala ক্য).
			if (Object.prototype.hasOwnProperty.call(config.phala_forms, key)) {
				bpm = config.phala_forms[key];
				tag = 'PHALA';
			}
		}
		state.output += bpm;
		state.log.push('[' + tag + '] ' + key + ' → ' + bpm);
		state.pos += key.length;
		// Signs like ং/ঃ/ঁ are in no_virama_before; they end the cluster.
		const isSign = config.no_virama_before.has(key);
		state.prev = { token: key, was_consonant: !isSign, was_matra: false };
	}

	// ── Core forward loop ──────────────────────────────────────────────────

	/**
	 * Execution order at each position:
	 *  1. Independent vowel at word start
	 *  2. Apostrophe → ZWNJ (conjunct breaker)
	 *  3. Consonant + matra
	 *  4. Consonant (with cluster/virama logic)
	 *  5. External loop hooks
	 *  6. Longest-match fallback (vowel-after-vowel → independent form)
	 */
	function forwardLoop(state, config, lookup, loopHooks, fwd) {
		const { consonantMap, matraMap, ivMap, sortedCons, sortedMatras, sortedIV } = fwd;

		while (state.pos < state.input.length) {
			state.handled = false;
			const input = state.input;
			const pos = state.pos;

			// 1. Word-start independent vowel
			if (config.hardcode_independent_vowel !== false) {
				const atStart = (pos === 0) || /[^a-zA-Z']/.test(input[pos - 1]);
				if (atStart) {
					for (const vKey of sortedIV) {
						if (input.startsWith(vKey, pos)) {
							state.output += ivMap[vKey];
							state.log.push('[INDEP_VOWEL] ' + vKey + ' → ' + ivMap[vKey]);
							state.pos += vKey.length;
							state.prev = { token: vKey, was_consonant: false, was_matra: false };
							state.handled = true;
							break;
						}
					}
				}
			}

			// 2. Apostrophe → ZWNJ
			if (!state.handled && config.hardcode_explicit_zwnj !== false && input[pos] === "'") {
				state.output += config.zwnj;
				state.log.push('[ZWNJ] apostrophe');
				state.pos++;
				// Cluster is broken: the next consonant must not get a virama.
				state.prev = { token: "'", was_consonant: false, was_matra: false };
				state.handled = true;
			}

			// 3. Consonant + matra
			if (!state.handled && config.hardcode_consonant_matra !== false && state.prev.was_consonant) {
				for (const mKey of sortedMatras) {
					if (input.startsWith(mKey, pos)) {
						state.output += matraMap[mKey];
						state.log.push('[CONSONANT+MATRA] ' + mKey + ' → ' + (matraMap[mKey] || '(inherent)'));
						state.pos += mKey.length;
						state.prev = { token: mKey, was_consonant: false, was_matra: true };
						state.handled = true;
						break;
					}
				}
			}

			// 4. Consonant (cluster-aware)
			if (!state.handled && config.hardcode_consonant_cluster !== false) {
				for (const cKey of sortedCons) {
					if (input.startsWith(cKey, pos)) {
						emitConsonant(state, config, cKey, consonantMap[cKey], 'CONSONANT');
						state.handled = true;
						break;
					}
				}
			}

			// 5. External loop hooks
			if (!state.handled) {
				for (const fn of loopHooks) {
					try {
						state = fn(state, config);
					} catch (e) {
						state.log.push('[SNIPPET ERROR] ' + fn.name + ': ' + e.message);
					}
					if (state.handled) break;
				}
			}

			if (state.handled) continue;

			// 6. Longest-match fallback
			let matched = false;
			for (const [roman, bpm] of lookup) {
				if (!input.startsWith(roman, state.pos)) continue;

				if (config.consonants_set.has(roman)) {
					emitConsonant(state, config, roman, bpm, 'MATCH');
				} else if (config.matras_set.has(roman) && !state.prev.was_consonant && ivMap[roman] !== undefined) {
					// Vowel not preceded by a consonant → independent form.
					state.output += ivMap[roman];
					state.log.push('[V+V] ' + roman + ' → ' + ivMap[roman]);
					state.pos += roman.length;
					state.prev = { token: roman, was_consonant: false, was_matra: false };
				} else {
					state.output += bpm;
					state.log.push('[MATCH] ' + roman + ' → ' + bpm);
					state.pos += roman.length;
					const isSign = config.no_virama_before.has(roman);
					state.prev = {
						token: roman,
						// A sign (ং ঃ ঁ) after a consonant ends the cluster.
						was_consonant: false,
						was_matra: config.matras_set.has(roman) && !isSign,
					};
				}
				matched = true;
				break;
			}

			if (!matched) {
				const ch = input[state.pos];
				state.output += ch;
				state.log.push('[PASS] ' + ch);
				state.pos++;
				state.prev = { token: ch, was_consonant: false, was_matra: false };
			}
		}

		return state;
	}

	// ── Core reverse loop (unchanged behaviour) ────────────────────────────

	function reverseLoop(state, config, lookup, loopHooks) {
		const chars = [...state.input];
		const total = chars.length;
		state.pos = 0;

		while (state.pos < total) {
			state.handled = false;

			for (const fn of loopHooks) {
				try {
					state = fn(state, config);
				} catch (e) {
					state.log.push('[SNIPPET ERROR] ' + fn.name + ': ' + e.message);
				}
				if (state.handled) break;
			}
			if (state.handled) continue;

			let matched = false;
			for (const [bpm, roman] of lookup) {
				const len = [...bpm].length;
				const slice = chars.slice(state.pos, state.pos + len).join('');
				if (slice !== bpm) continue;

				const isConsonant = config.consonants_set.has(bpm);
				state.output += roman;

				if (isConsonant) {
					const nextChar = chars[state.pos + len] ?? '';
					if (!config.matras_set.has(nextChar) && nextChar !== config.virama) {
						state.output += config.inherent_vowel;
						state.log.push('[INHERENT] after ' + bpm);
					}
				}

				state.log.push('[MATCH] ' + bpm + ' → ' + roman);
				state.pos += len;
				state.prev = { token: bpm, was_consonant: isConsonant, was_matra: config.matras_set.has(bpm) };
				matched = true;
				break;
			}

			if (!matched) {
				state.output += chars[state.pos];
				state.log.push('[PASS] ' + chars[state.pos]);
				state.pos++;
				state.prev = { token: chars[state.pos - 1] || '', was_consonant: false, was_matra: false };
			}
		}

		return state;
	}

	// ── Public engine interface ────────────────────────────────────────────

	function TranslitEngine(forwardMap, reverseMap, settings) {
		this.forwardMap = forwardMap;
		this.reverseMap = reverseMap || {};
		this.settings = Object.assign({}, FALLBACK_SETTINGS, settings || {});
		this._cache = {};
	}

	TranslitEngine.prototype.setLanguage = function (lang) {
		this.settings = Object.assign({}, this.settings, { lang: lang });
	};

	TranslitEngine.prototype._tables = function (direction) {
		const lang = this.settings.lang || 'as';
		const key = direction + ':' + lang;
		// Invalidate if settings object was swapped (e.g. via wrapper.updateSettings).
		if (this._cache[key] && this._cache[key].settings === this.settings) {
			return this._cache[key].tables;
		}
		const raw = direction === 'forward' ? this.forwardMap : this.reverseMap;
		const map = resolveMap(raw || {}, lang);
		const tables = buildTables(map, this.settings);
		tables.map = map;
		this._cache[key] = { settings: this.settings, tables };
		return tables;
	};

	/**
	 * @param {string} input
	 * @param {string} direction  'forward' (Roman → script) or 'reverse'
	 * @param {Array} preHooks / loopHooks / postHooks  optional snippet functions
	 * @return {{ output: string, log: Array }}
	 */
	TranslitEngine.prototype.transliterate = function (input, direction, preHooks, loopHooks, postHooks) {
		preHooks = Array.isArray(preHooks) ? preHooks : [];
		loopHooks = Array.isArray(loopHooks) ? loopHooks : [];
		postHooks = Array.isArray(postHooks) ? postHooks : [];

		const t = this._tables(direction);
		const s = this.settings;

		const config = {
			// Hooks see the language-resolved forward map.
			maps: {
				forward: direction === 'forward' ? t.map : resolveMap(this.forwardMap, s.lang),
				reverse: this.reverseMap,
			},
			lang: s.lang,
			virama: s.virama,
			inherent_vowel: s.inherent_vowel,
			zwj: s.zwj,
			zwnj: s.zwnj,
			non_linking_consonants: new Set(s.non_linking_consonants),
			no_virama_before: new Set(s.no_virama_before),
			phala_forms: s.phala_forms || {},
			direction: direction,
			consonants_set: t.consonants_set,
			matras_set: t.matras_set,
			hardcode_independent_vowel: s.hardcode_independent_vowel,
			hardcode_explicit_zwnj: s.hardcode_explicit_zwnj,
			hardcode_consonant_matra: s.hardcode_consonant_matra,
			hardcode_consonant_cluster: s.hardcode_consonant_cluster,
		};

		let state = makeState(typeof input === 'string' ? input : '');
		if (direction === 'reverse') state.input = state.input.normalize('NFC');

		for (const fn of preHooks) {
			try { state = fn(state, config); }
			catch (e) { state.log.push('[SNIPPET ERROR pre] ' + fn.name + ': ' + e.message); }
		}

		state = direction === 'forward'
			? forwardLoop(state, config, t.lookup, loopHooks, t.fwd)
			: reverseLoop(state, config, t.lookup, loopHooks);

		for (const fn of postHooks) {
			try { state = fn(state, config); }
			catch (e) { state.log.push('[SNIPPET ERROR post] ' + fn.name + ': ' + e.message); }
		}

		return { output: state.output, log: state.log };
	};

	global.TranslitEngine = TranslitEngine;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = TranslitEngine;
	}

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : {});
