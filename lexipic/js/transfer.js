/**
 * LexiPic PWA — JSON import / export.
 *
 * Export format is byte-compatible with the WordPress plugin's
 * /sets/{id}/export, so sets move freely between the plugin and the PWA:
 *
 *   { lexipic_version, set: { name, slug, language },
 *     entries: [ { word_script, word_roman, description,
 *                  image: dataURI, audio: dataURI, image_mime, audio_mime } ] }
 *
 * Import additionally accepts:
 *   - the legacy prototype-PWA flat array  [ { heritage, transliteration, image, audio } ]
 *   - a full-device backup                 { lexipic_backup: 1, sets: [ <set export> … ],
 *                                            languages: [ … ], ime_files: [ … ] }
 */

import * as DB from './db.js';

export const APP_VERSION = '2.0.1';

const IMAGE_MIMES = [ 'image/jpeg', 'image/png', 'image/webp', 'image/gif' ];

// ── Blob <-> data URI ─────────────────────────────────────────────────────

export function blobToDataUri( blob ) {
	return new Promise( ( resolve, reject ) => {
		const r = new FileReader();
		r.onload  = () => resolve( r.result );
		r.onerror = () => reject( r.error );
		r.readAsDataURL( blob );
	} );
}

/**
 * Decode a base64 data URI to a Blob, enforcing a MIME whitelist.
 * (The plugin accepted any MIME and later served it back with that
 * Content-Type — see AUDIT.md, finding S1.)
 */
export function dataUriToBlob( uri, kind ) {
	if ( typeof uri !== 'string' || uri.indexOf( 'data:' ) !== 0 ) return null;
	const comma = uri.indexOf( ',' );
	if ( comma < 0 ) return null;
	const header = uri.slice( 5, comma );
	const mime   = ( header.split( ';' )[ 0 ] || '' ).toLowerCase();
	if ( kind === 'image' && ! IMAGE_MIMES.includes( mime ) ) return null;
	if ( kind === 'audio' && ! /^audio\/[a-z0-9.+-]+$/.test( mime ) ) return null;
	if ( ! /;base64/i.test( header ) ) return null;
	try {
		const bin = atob( uri.slice( comma + 1 ).replace( /\s/g, '' ) );
		const buf = new Uint8Array( bin.length );
		for ( let i = 0; i < bin.length; i++ ) buf[ i ] = bin.charCodeAt( i );
		return new Blob( [ buf ], { type: mime } );
	} catch ( e ) {
		return null;
	}
}

// ── Export ────────────────────────────────────────────────────────────────

export async function buildSetExport( setId ) {
	const set = await DB.getSet( setId );
	if ( ! set ) throw new Error( 'Set not found.' );
	const entries = await DB.getEntries( setId );
	const out = {
		lexipic_version: APP_VERSION,
		set: { name: set.name, slug: set.slug, language: set.language },
		entries: [],
	};
	for ( const e of entries ) {
		out.entries.push( {
			id:          e.id,
			word_script: e.word_script,
			word_roman:  e.word_roman,
			description: e.description || '',
			image:       e.image ? await blobToDataUri( e.image ) : '',
			audio:       e.audio ? await blobToDataUri( e.audio ) : '',
			image_mime:  e.image ? e.image.type : null,
			audio_mime:  e.audio ? e.audio.type : null,
		} );
	}
	return out;
}

export async function buildFullBackup() {
	const sets = await DB.getSets();
	const langs = ( await DB.getLanguages() ).filter( l => ! l.builtin );
	const ime = [];
	for ( const l of await DB.getLanguages() ) {
		for ( const key of [ 'forward', 'reverse', 'hooks', 'settings' ] ) {
			const o = await DB.getImeOverride( l.code, key );
			if ( o ) ime.push( { lang: o.lang, key: o.key, filename: o.filename, data: o.data } );
		}
	}
	const out = {
		lexipic_backup:  1,
		lexipic_version: APP_VERSION,
		exported_at:     new Date().toISOString(),
		languages:       langs,
		ime_files:       ime,
		sets:            [],
	};
	for ( const s of sets ) out.sets.push( await buildSetExport( s.id ) );
	return out;
}

export function exportFilename( base ) {
	const d = new Date();
	const ymd = d.getFullYear() + String( d.getMonth() + 1 ).padStart( 2, '0' ) + String( d.getDate() ).padStart( 2, '0' );
	return ( base || 'lexipic' ).replace( /[^\p{L}\p{N}_-]+/gu, '-' ) + '_lexipic_' + ymd + '.json';
}

// ── Import ────────────────────────────────────────────────────────────────

async function importOneSet( data, languagesKnown, fallbackName ) {
	let name, language, entries;
	if ( Array.isArray( data ) ) {
		name     = fallbackName || ( 'Imported set ' + new Date().toLocaleDateString() );
		language = 'bpm';
		entries  = data;
	} else if ( data && typeof data === 'object' && data.set && Array.isArray( data.entries ) ) {
		name     = String( data.set.name || '' ).trim() || fallbackName || ( 'Imported set ' + new Date().toLocaleDateString() );
		language = String( data.set.language || 'bpm' );
		entries  = data.entries;
	} else {
		throw new Error( 'This file is not a LexiPic export.' );
	}
	const warnings = [];
	if ( ! languagesKnown.has( language ) ) {
		warnings.push( 'Language "' + language + '" is not registered here; the set was imported with the Bishnupriya Manipuri keyboard. Change it under Sets.' );
		language = 'bpm';
	}

	const set = await DB.createSet( name, language );
	let imported = 0, skipped = 0, noAudio = 0, noImage = 0;
	for ( const e of entries ) {
		if ( ! e || typeof e !== 'object' ) { skipped++; continue; }
		const word_script = e.word_script ?? e.heritage ?? '';
		const word_roman  = e.word_roman  ?? e.transliteration ?? '';
		if ( ! String( word_script ).trim() && ! String( word_roman ).trim() ) { skipped++; continue; }
		const image = dataUriToBlob( e.image, 'image' );
		const audio = dataUriToBlob( e.audio, 'audio' );
		if ( e.image && ! image ) noImage++;
		if ( e.audio && ! audio ) noAudio++;
		await DB.saveEntry( {
			set_id: set.id,
			word_script, word_roman,
			description: e.description || '',
			image, audio,
		} );
		imported++;
	}
	if ( skipped ) warnings.push( skipped + ' entr' + ( skipped === 1 ? 'y' : 'ies' ) + ' had no word and were skipped.' );
	if ( noImage ) warnings.push( noImage + ' photo(s) were in an unsupported format and were dropped.' );
	if ( noAudio ) warnings.push( noAudio + ' recording(s) were in an unsupported format and were dropped.' );
	return { set, imported, warnings };
}

export async function importFile( file ) {
	let data;
	try { data = JSON.parse( await file.text() ); } catch ( e ) {
		throw new Error( 'This file is not valid JSON.' );
	}
	const languagesKnown = new Set( ( await DB.getLanguages() ).map( l => l.code ) );

	if ( data && data.lexipic_backup ) {
		// Restore custom languages + engine files first so sets keep their language.
		for ( const l of ( data.languages || [] ) ) {
			if ( l && l.code && ! languagesKnown.has( l.code ) ) {
				await DB.putLanguage( { code: l.code, label: l.label || l.code, speech_locale: l.speech_locale || 'bn-IN', builtin: false } );
				languagesKnown.add( l.code );
			}
		}
		for ( const f of ( data.ime_files || [] ) ) {
			if ( f && languagesKnown.has( f.lang ) && ! ( await DB.getImeOverride( f.lang, f.key ) ) ) {
				await DB.putImeOverride( f.lang, f.key, f.data, f.filename );
			}
		}
		const results = [];
		for ( const s of ( data.sets || [] ) ) results.push( await importOneSet( s, languagesKnown ) );
		return {
			sets:     results.map( r => r.set ),
			imported: results.reduce( ( n, r ) => n + r.imported, 0 ),
			warnings: results.flatMap( r => r.warnings ),
		};
	}

	const fromFile = file.name.replace( /\.json$/i, '' ).replace( /_lexipic_\d{8}$/, '' ).replace( /[-_]+/g, ' ' ).trim();
	const r = await importOneSet( data, languagesKnown, fromFile );
	return { sets: [ r.set ], imported: r.imported, warnings: r.warnings };
}
