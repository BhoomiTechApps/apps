/**
 * fixes.js - corrections to the bundled transliteration engine (vendor/translit-forward.min.js).
 *
 * The bundle is a generated file, so instead of editing it these fixes are applied on top when the app starts:
 * Fixes.apply( TranslitForward ) returns an engine with the same API (transliterate, run, getDefaults, normalizeMap).
 * Each fix is applied only while the defect is still there. When the defect is fixed in the package itself
 * (src/ + `npm run build`) and vendor/ is replaced, that fix switches itself off and this file can be deleted.
 *
 *   ngg  Should give ঙ্গ (the map has an entry for it) but gave ংগ: the consonant "ng" is matched first, so the
 *        "ngg" entry in the map's special section is never reached. Fix: also list "ngg" as a consonant, where
 *        the longest key wins.
 *   ngu  Should give ঙু like every other ng + vowel (nga, ngi, nge, ngo, ...) but gave ংু: the list of ng + vowel
 *        substitutions in the bundled pre snippet has no "ngu". Fix: a small pre snippet that handles it.
 */
( function ( root, factory ) {
	if ( typeof module === 'object' && module.exports ) { module.exports = factory(); } else { root.Fixes = factory(); }
}( typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	const NGA = 'ঙ';
	const clone = ( v ) => JSON.parse( JSON.stringify( v ) );

	// "ngu" -> ঙ + u-matra, but leave "nguu" to the bundled snippet (it becomes ঙূ)
	function preNgu( state, config ) {
		const m = ( config.maps.forward.matras || [] ).find( ( p ) => Array.isArray( p ) && p[ 0 ] === 'u' );
		if ( m ) state.input = state.input.replace( /ngu(?!u)/g, NGA + m[ 1 ] );
		return state;
	}

	/** Which of the fixes this engine still needs: a list of 'ngg' and/or 'ngu'. */
	function defects( engine ) {
		const list = [];
		if ( engine.transliterate( 'ngg' ) !== 'ঙ্গ' ) list.push( 'ngg' );
		if ( engine.transliterate( 'ngu' ) !== 'ঙু' ) list.push( 'ngu' );
		return list;
	}

	function apply( engine ) {
		const need = defects( engine );
		if ( ! need.length ) return engine;            // nothing to correct: use the bundle as it is

		const d = engine.getDefaults();
		if ( need.indexOf( 'ngg' ) > -1 ) d.map.consonants.push( [ 'ngg', 'ঙ্গ' ] );
		if ( need.indexOf( 'ngu' ) > -1 ) {
			d.snippets.push( { snippet_key: 'fix_pre_ngu', label: 'ng + u -> ঙু', direction: 'forward', hook_stage: 'pre', sort_order: 5, is_active: 1, fn: preNgu } );
		}
		const fixed = engine.create( { map: d.map, settings: d.settings, snippets: d.snippets, silent: true } );
		return {
			version: engine.version,
			direction: engine.direction,
			transliterate: fixed.transliterate,
			run: fixed.run,
			normalizeMap: engine.normalizeMap,
			getDefaults: () => ( { map: clone( d.map ), settings: clone( d.settings ), snippets: d.snippets.map( ( s ) => Object.assign( {}, s ) ) } ),
			fixes: need,
		};
	}

	return { apply, defects };
} ) );
