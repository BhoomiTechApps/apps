/**
 * mapping.js - THE DATA. Everything Bishnupriya-specific that the plain engine does not do lives here.
 * Edit this file (add rows) and reload; no logic to change. rules.js reads it.
 *
 * Bengali keys are matched against the Bengali input; ZWNJ is written as \u200C so it stays visible in this file.
 */
( function ( root, factory ) {
	const m = factory();
	if ( typeof module === 'object' && module.exports ) module.exports = m; else root.TranslitMapping = m;
}( typeof self !== 'undefined' ? self : this, function () {
	'use strict';
	return {

		// 1. WORDS: a whole Bengali word (the letters between spaces / punctuation) -> the exact Roman text.
		//    Wins over everything else. Use it for compounds, splits, and anything the fragments do not cover.
		words: {
			'টমস্\u200C':      'tom\u200Cs\u200C',
			'যদিশৈমিঙাল':      'zodishoi mingal',
			'ভারহানথাগেলগা':   'bhar\u200Chan thagel\u200Cga',
		},

		// 2. SILENT o: fragments in which the FIRST consonant is bare and its inherent 'o' is dropped, marked by silent_mark.
		//    Notation (as in the pattern study):  -XY   X at the END of a word        -XY-  X INSIDE a word
		//                                          XY-   X at the START of a word      XY    the whole word
		//    Only the first consonant of the fragment is affected; the rest is written normally.
		silent_o: [
			// end of word
			'-রমা', '-রগা', '-লপা', '-চলা', '-নজা', '-কশৌ', '-লগা', '-রলা',
			// inside a word
			'-নশী-', '-লক-', '-ঙক-', '-সলা-', '-কহা-', '-তব-', '-মচ-', '-জরু-', '-কগা-', '-রকা-', '-রতে-', '-রপা-', '-কমা-', '-রহা-',
			// a single final consonant: its 'o' is dropped (the plain engine keeps it after th / sh / ng)
			'-থ', '-ঠ', '-শ', '-ষ', '-ঙ',
		],
		silent_mark: '\u200C',          // written after the consonant whose 'o' is silent ('' = nothing)

		// 3. ব-PHALA: base + ্ব is written with w  (ত্ব -> tw, ধ্ব -> dhw, স্ব -> sw). Add more bases (দ, শ, জ ...) to extend.
		ba_phala_w: [ 'ত', 'ধ', 'স' ],

		// 4. CONJUNCT spellings that replace the engine's own (merged into its consonant table, so the inherent 'o' still follows).
		conjuncts: {
			'জ্ঞ': 'gy',
		},
	};
} ) );
