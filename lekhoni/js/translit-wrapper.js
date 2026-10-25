/**
 * Translit Wrapper — Avro-Compatible Interface
 *
 * Provides a drop-in replacement for Avro.parse() that uses the
 * CompLing AI transliteration engine under the hood.
 *
 * Usage (identical to Avro):
 *   Translit.lang = 'bn';  // or 'as' for Assamese
 *   const bengali = Translit.parse('amar');
 *   console.log(bengali);  // "আমার"
 *
 * This wrapper is thin and focused — it hides the engine's complexity
 * while preserving Avro's simple API surface.
 */

(function (global) {
	'use strict';

	// Ensure the engine is available
	if (!global.TranslitEngine) {
		console.error('[Translit Wrapper] TranslitEngine not found. Load translit-engine.js first.');
		return;
	}

	// Hooks will be loaded from translit-hooks.js
	let TRANSLIT_HOOKS = null;
	if (global.TRANSLIT_HOOKS) {
		TRANSLIT_HOOKS = global.TRANSLIT_HOOKS;
	}

	// Settings passed to the engine. Linking rules (non_linking_consonants,
	// no_virama_before) come from the engine defaults unless overridden in init().
	const DEFAULT_SETTINGS = {
		virama: '\u09CD',
		inherent_vowel: 'o',
		zwj: '\u200D',
		zwnj: '\u200C',
		hardcode_independent_vowel: true,
		hardcode_explicit_zwnj: true,
		hardcode_consonant_matra: true,
		hardcode_consonant_cluster: true,
	};

	/**
	 * Translit object — public API.
	 */
	const Translit = {
		// Current language: 'as' (ৰ) or 'bn' (র) — applied via map.lang_overrides
		lang: 'as',

		// Engine instances (lazy-loaded)
		_engine: null,
		_mapData: null,
		_settings: null,

		/**
		 * Set the language for transliteration.
		 * Currently supports: 'bn' (Bengali), 'as' (Assamese)
		 * (Assamese rendering differences are minimal in the mapping)
		 */
		setLanguage: function (lang) {
			if (lang === 'bn' || lang === 'as') {
				this.lang = lang;
			} else {
				console.warn('[Translit] Unknown language: ' + lang + '. Defaulting to as.');
				this.lang = 'as';
			}
			if (this._engine) this._engine.setLanguage(this.lang);
		},

		/**
		 * Initialize the engine with mapping data.
		 * Called once during app setup.
		 * @param {Object} mapData — The forward/reverse maps (from JSON)
		 * @param {Object} settings — Optional custom settings
		 */
		init: function (mapData, settings) {
			try {
				this._mapData = mapData;
				this._settings = Object.assign({}, DEFAULT_SETTINGS, { lang: this.lang }, settings || {});
				this.lang = this._settings.lang;

				// Create engine instance with provided maps
				this._engine = new global.TranslitEngine(
					this._mapData,
					{}, // reverseMap (optional, not used for forward-only typing)
					this._settings
				);
			} catch (e) {
				console.error('[Translit] Init failed:', e);
				throw e;
			}
		},

		/**
		 * Main transliteration method — drop-in replacement for Avro.parse().
		 * Converts Roman text to Bengali/Assamese.
		 *
		 * @param {string} romanText — Input Roman/Latin text
		 * @return {string} — Bengali or Assamese output
		 */
		parse: function (romanText) {
			if (!this._engine) {
				console.error('[Translit] Engine not initialized. Call Translit.init() first.');
				return romanText; // Fallback: return input unchanged
			}

			if (!romanText || typeof romanText !== 'string') {
				return '';
			}

			try {
				if (this._engine.settings.lang !== this.lang) this._engine.setLanguage(this.lang);
				// Use hooks if available, otherwise empty arrays
				const preHooks = TRANSLIT_HOOKS ? TRANSLIT_HOOKS.preHooks : [];
				const loopHooks = TRANSLIT_HOOKS ? TRANSLIT_HOOKS.loopHooks : [];
				const postHooks = TRANSLIT_HOOKS ? TRANSLIT_HOOKS.postHooks : [];
				
				const result = this._engine.transliterate(romanText, 'forward', preHooks, loopHooks, postHooks);
				return result.output;
			} catch (e) {
				console.error('[Translit] Transliteration failed:', e);
				return romanText; // Fallback: return input unchanged
			}
		},

		/**
		 * Debug helper: get transliteration logs.
		 * Useful for testing and understanding why a transliteration
		 * produced unexpected output.
		 *
		 * @param {string} romanText — Input text
		 * @return {Array} — Array of log messages
		 */
		debug: function (romanText) {
			if (!this._engine) {
				console.error('[Translit] Engine not initialized.');
				return [];
			}

			try {
				if (this._engine.settings.lang !== this.lang) this._engine.setLanguage(this.lang);
				// Use hooks if available
				const preHooks = TRANSLIT_HOOKS ? TRANSLIT_HOOKS.preHooks : [];
				const loopHooks = TRANSLIT_HOOKS ? TRANSLIT_HOOKS.loopHooks : [];
				const postHooks = TRANSLIT_HOOKS ? TRANSLIT_HOOKS.postHooks : [];
				
				const result = this._engine.transliterate(romanText, 'forward', preHooks, loopHooks, postHooks);
				return result.log;
			} catch (e) {
				console.error('[Translit] Debug failed:', e);
				return [];
			}
		},

		/**
		 * Batch transliteration — convert an array of strings.
		 * Useful for converting entire documents or lists.
		 *
		 * @param {Array<string>} inputs — Array of Roman text
		 * @return {Array<string>} — Array of Bengali/Assamese output
		 */
		parseMany: function (inputs) {
			if (!Array.isArray(inputs)) return [];
			return inputs.map(text => this.parse(text));
		},

		/**
		 * Get the engine's current settings.
		 * @return {Object} — Settings object
		 */
		getSettings: function () {
			return Object.assign({}, this._settings);
		},

		/**
		 * Update engine settings at runtime.
		 * Useful for tweaking virama behavior, inherent vowel, etc.
		 * @param {Object} newSettings — Partial settings object
		 */
		updateSettings: function (newSettings) {
			if (!this._engine) {
				console.error('[Translit] Engine not initialized.');
				return;
			}

			try {
				this._settings = Object.assign({}, this._settings, newSettings || {});
				this._engine.settings = Object.assign({}, this._engine.settings, newSettings || {});
				if (newSettings && newSettings.lang) this.lang = newSettings.lang;
			} catch (e) {
				console.error('[Translit] updateSettings failed:', e);
			}
		},
	};

	// Expose in global scope
	global.Translit = Translit;

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : {});
