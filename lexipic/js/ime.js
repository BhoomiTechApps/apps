/**
 * LexiPic PWA — IME manager.
 *
 * Port of Lexipic_IME_Manager. Each language has four engine files; a
 * language with no saved override falls back to the bundled defaults in
 * ime/default/ (same behaviour as the plugin).
 *
 * Unlike the plugin, the IME used on the Add Entry screen follows the
 * *selected set's* language, not a single site-wide default.
 */

/* global CPLAI_ENGINE */
import * as DB from './db.js';

export const FILE_KEYS = {
	forward:  'forwardMap.json',
	reverse:  'reverseMap.json',
	hooks:    'defaults.json',
	settings: 'js-engine-settings.default.json',
};

export const FILE_LABELS = {
	forward:  'Forward map (Roman → script)',
	reverse:  'Reverse map (script → Roman)',
	hooks:    'Snippet hooks',
	settings: 'Engine settings',
};

const REQUIRED_MAP_SECTIONS = [ 'independent_vowels', 'consonants', 'matras', 'special', 'digits', 'punctuation' ];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const defaultsCache = {};
const engineCache   = new Map(); // lang → compiled engine

export async function getDefaultFile( key ) {
	if ( ! defaultsCache[ key ] ) {
		defaultsCache[ key ] = fetch( 'ime/default/' + FILE_KEYS[ key ] ).then( ( r ) => {
			if ( ! r.ok ) throw new Error( 'Could not load bundled ' + FILE_KEYS[ key ] );
			return r.json();
		} );
	}
	return defaultsCache[ key ];
}

export async function getActiveFile( lang, key ) {
	const o = await DB.getImeOverride( lang, key );
	return o ? o.data : getDefaultFile( key );
}

export async function isCustom( lang, key ) {
	return !! ( await DB.getImeOverride( lang, key ) );
}

export function invalidate( lang ) {
	if ( lang ) engineCache.delete( lang );
	else engineCache.clear();
}

// ── Validation (port of validate_structure) ───────────────────────────────

export function validateStructure( key, d ) {
	const w = [];
	const isObj = d && typeof d === 'object' && ! Array.isArray( d );
	switch ( key ) {
		case 'forward':
		case 'reverse': {
			if ( ! isObj ) { w.push( 'Expected a JSON object with map sections (consonants, matras, …).' ); break; }
			const missing = REQUIRED_MAP_SECTIONS.filter( s => ! ( s in d ) );
			if ( missing.length ) w.push( 'Missing section(s): ' + missing.join( ', ' ) + '. They will be skipped until added.' );
			break;
		}
		case 'hooks':
			if ( ! Array.isArray( d ) ) { w.push( 'Expected a JSON array of snippet hook objects.' ); break; }
			d.forEach( ( h, i ) => {
				if ( ! h || typeof h !== 'object' || ! h.snippet_key || ! h.hook_stage || ! h.js_body ) {
					w.push( 'Hook #' + ( i + 1 ) + ' is missing snippet_key, hook_stage or js_body.' );
				}
			} );
			break;
		case 'settings': {
			if ( ! isObj ) { w.push( 'Expected a JSON object of engine settings.' ); break; }
			const missing = [ 'virama', 'zwj', 'zwnj', 'inherent_vowel', 'section_order' ].filter( s => ! ( s in d ) );
			if ( missing.length ) w.push( 'Missing setting(s), built-in fallbacks will be used: ' + missing.join( ', ' ) + '.' );
			break;
		}
	}
	return w;
}

/**
 * Hard errors that would break the engine (the plugin only warned).
 */
function fatalProblems( key, d ) {
	if ( key === 'hooks' ) {
		if ( ! Array.isArray( d ) ) return 'Snippet hooks must be a JSON array.';
		for ( const h of d ) {
			if ( h && h.js_body ) {
				try { compileHook( h ); } catch ( e ) {
					return 'Hook "' + ( h.snippet_key || '?' ) + '" does not compile: ' + e.message;
				}
			}
		}
	}
	if ( ( key === 'forward' || key === 'reverse' || key === 'settings' ) && ( ! d || typeof d !== 'object' || Array.isArray( d ) ) ) {
		return 'This file must be a JSON object.';
	}
	return null;
}

// ── Replace / revert / restore ────────────────────────────────────────────

export async function replaceFile( lang, key, file ) {
	if ( ! FILE_KEYS[ key ] ) throw new Error( 'Unknown IME file type.' );
	if ( file.size > MAX_FILE_SIZE ) throw new Error( 'File is too large (5 MB limit).' );
	if ( ! /\.json$/i.test( file.name ) ) throw new Error( 'File must have a .json extension.' );
	let data;
	try { data = JSON.parse( await file.text() ); } catch ( e ) {
		throw new Error( 'Not valid JSON: ' + e.message );
	}
	const fatal = fatalProblems( key, data );
	if ( fatal ) throw new Error( fatal );
	const warnings = validateStructure( key, data );

	const current = await DB.getImeOverride( lang, key );
	if ( current ) await DB.addImeBackup( lang, key, current.data, current.filename );
	await DB.putImeOverride( lang, key, data, file.name );
	invalidate( lang );
	return { warnings, backup_made: !! current };
}

export async function revertToDefault( lang, key ) {
	const current = await DB.getImeOverride( lang, key );
	if ( ! current ) throw new Error( 'Already using the bundled default.' );
	await DB.addImeBackup( lang, key, current.data, current.filename );
	await DB.deleteImeOverride( lang, key );
	invalidate( lang );
}

export async function restoreBackup( lang, key, backupId ) {
	const b = await DB.getImeBackup( backupId );
	if ( ! b || b.lang !== lang || b.key !== key ) throw new Error( 'Backup not found.' );
	const current = await DB.getImeOverride( lang, key );
	if ( current ) await DB.addImeBackup( lang, key, current.data, current.filename );
	await DB.putImeOverride( lang, key, b.data, b.filename );
	invalidate( lang );
}

export async function cloneFiles( from, to ) {
	for ( const key of Object.keys( FILE_KEYS ) ) {
		const o = await DB.getImeOverride( from, key );
		if ( o ) await DB.putImeOverride( to, key, o.data, o.filename );
	}
	invalidate( to );
}

// ── Engine ────────────────────────────────────────────────────────────────

function functionNameFromBody( body ) {
	const m = /function\s+([A-Za-z0-9_$]+)\s*\(/.exec( body || '' );
	return m ? m[ 1 ] : '';
}

function compileHook( hook ) {
	const name = functionNameFromBody( hook.js_body );
	if ( ! name ) throw new Error( 'js_body must be a named function declaration' );
	// eslint-disable-next-line no-new-func
	const fn = new Function( hook.js_body + '\nreturn ' + name + ';' )();
	if ( typeof fn !== 'function' ) throw new Error( 'did not produce a function' );
	return fn;
}

function bucketHooks( hooks, direction ) {
	const b = { pre: [], loop: [], post: [] };
	( Array.isArray( hooks ) ? hooks : [] )
		.filter( h => h && h.direction === direction && h.is_active !== 0 && h.is_active !== false && h.js_body && b[ h.hook_stage ] )
		// Sort on the hook definition itself (plugin re-looked-up by function
		// name, which mis-orders two hooks sharing a name).
		.sort( ( x, y ) => ( x.sort_order || 0 ) - ( y.sort_order || 0 ) )
		.forEach( ( h ) => {
			try { b[ h.hook_stage ].push( compileHook( h ) ); } catch ( e ) {
				console.error( 'LexiPic: failed to compile IME hook', h.snippet_key, e );
			}
		} );
	return b;
}

/**
 * @return {Promise<{forward:(s:string)=>string, reverse:(s:string)=>string}>}
 */
export async function getEngine( lang ) {
	if ( engineCache.has( lang ) ) return engineCache.get( lang );
	const p = ( async () => {
		const [ forward, reverse, hooks, settings ] = await Promise.all(
			[ 'forward', 'reverse', 'hooks', 'settings' ].map( k => getActiveFile( lang, k ) )
		);
		const maps = { forward, reverse };
		const F = bucketHooks( hooks, 'forward' );
		const R = bucketHooks( hooks, 'reverse' );
		const run = ( text, dir ) => {
			if ( ! text ) return '';
			if ( ! window.CPLAI_ENGINE ) return text;
			const h = dir === 'forward' ? F : R;
			try {
				const res = CPLAI_ENGINE.bpmTransliterate( text, dir, maps, h.pre, h.loop, h.post, {}, settings );
				return res && typeof res.output === 'string' ? res.output : text;
			} catch ( e ) {
				console.error( 'LexiPic: IME error', e );
				return text;
			}
		};
		return { forward: t => run( t, 'forward' ), reverse: t => run( t, 'reverse' ) };
	} )();
	engineCache.set( lang, p );
	p.catch( () => engineCache.delete( lang ) );
	return p;
}
