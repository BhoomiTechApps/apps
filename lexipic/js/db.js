/**
 * LexiPic PWA — storage layer (IndexedDB).
 *
 * Replaces the plugin's wp_lexipic_sets / wp_lexipic_entries tables, the
 * wp-content/uploads/lexipic audio folder, and the lexipic_languages /
 * lexipic_settings options. Photos and recordings are stored as Blobs.
 *
 * Stores:
 *   sets        { id, name, slug, language, created_at, updated_at }
 *   entries     { id, set_id, word_script, word_roman, description,
 *                 image: Blob|null, audio: Blob|null, created_at, updated_at }
 *   languages   { code, label, speech_locale, builtin }
 *   ime_files   { id: "lang:key", lang, key, data, filename, updated_at }
 *   ime_backups { id, lang, key, data, filename, created_at }
 *   kv          { k, v }    — app settings
 */

const DB_NAME    = 'lexipic';
const DB_VERSION = 1;

export const DEFAULT_LANGUAGES = [
	{ code: 'bpm', label: 'Bishnupriya Manipuri (ইমার ঠার)', speech_locale: 'bn-IN', builtin: true },
	{ code: 'as',  label: 'Assamese (অসমীয়া)',             speech_locale: 'as-IN', builtin: true },
	{ code: 'bn',  label: 'Bengali (বাংলা)',                speech_locale: 'bn-IN', builtin: true },
];

let dbPromise = null;

function req( r ) {
	return new Promise( ( resolve, reject ) => {
		r.onsuccess = () => resolve( r.result );
		r.onerror   = () => reject( r.error );
	} );
}

function txDone( tx ) {
	return new Promise( ( resolve, reject ) => {
		tx.oncomplete = () => resolve();
		tx.onerror    = () => reject( tx.error );
		tx.onabort    = () => reject( tx.error || new Error( 'Transaction aborted' ) );
	} );
}

export function open() {
	if ( dbPromise ) return dbPromise;
	dbPromise = new Promise( ( resolve, reject ) => {
		const r = indexedDB.open( DB_NAME, DB_VERSION );
		r.onupgradeneeded = ( ev ) => {
			const db = r.result;
			// Versioned migrations — unlike the plugin's CREATE TABLE IF NOT
			// EXISTS, future schema changes get an explicit upgrade step.
			if ( ev.oldVersion < 1 ) {
				const sets = db.createObjectStore( 'sets', { keyPath: 'id', autoIncrement: true } );
				sets.createIndex( 'slug', 'slug', { unique: true } );
				const entries = db.createObjectStore( 'entries', { keyPath: 'id', autoIncrement: true } );
				entries.createIndex( 'set_id', 'set_id' );
				const langs = db.createObjectStore( 'languages', { keyPath: 'code' } );
				DEFAULT_LANGUAGES.forEach( l => langs.put( l ) );
				db.createObjectStore( 'ime_files', { keyPath: 'id' } );
				const b = db.createObjectStore( 'ime_backups', { keyPath: 'id', autoIncrement: true } );
				b.createIndex( 'lang_key', [ 'lang', 'key' ] );
				db.createObjectStore( 'kv', { keyPath: 'k' } );
			}
		};
		r.onsuccess = () => {
			const db = r.result;
			db.onversionchange = () => db.close();
			resolve( db );
		};
		r.onerror   = () => reject( r.error );
		r.onblocked = () => reject( new Error( 'LexiPic is open in another tab with an older version. Close it and reload.' ) );
	} );
	return dbPromise;
}

async function store( name, mode = 'readonly' ) {
	const db = await open();
	const tx = db.transaction( name, mode );
	return { tx, s: tx.objectStore( name ) };
}

const now = () => new Date().toISOString();

// ── Settings (kv) ─────────────────────────────────────────────────────────

export async function getSetting( k, fallback = null ) {
	const { s } = await store( 'kv' );
	const row = await req( s.get( k ) );
	return row ? row.v : fallback;
}

export async function setSetting( k, v ) {
	const { tx, s } = await store( 'kv', 'readwrite' );
	s.put( { k, v } );
	return txDone( tx );
}

// ── Slugs ─────────────────────────────────────────────────────────────────

export function slugify( name ) {
	// Keep native-script letters: sanitize_title() in WP would strip them to
	// an empty slug for a name typed purely in script.
	const s = String( name ).normalize( 'NFC' ).toLowerCase().trim()
		.replace( /[\s_]+/g, '-' )
		.replace( /[^\p{L}\p{M}\p{N}-]+/gu, '' )
		.replace( /-+/g, '-' ).replace( /^-|-$/g, '' );
	return s || 'set';
}

async function uniqueSlug( base, ignoreId = null ) {
	const { s } = await store( 'sets' );
	const idx   = s.index( 'slug' );
	let slug = base, n = 1;
	// eslint-disable-next-line no-constant-condition
	while ( true ) {
		const hit = await req( idx.get( slug ) );
		if ( ! hit || hit.id === ignoreId ) return slug;
		slug = base + '-' + n++;
	}
}

// ── Sets ──────────────────────────────────────────────────────────────────

export async function getSets() {
	const db   = await open();
	const tx   = db.transaction( [ 'sets', 'entries' ] );
	const sets = await req( tx.objectStore( 'sets' ).getAll() );
	const idx  = tx.objectStore( 'entries' ).index( 'set_id' );
	await Promise.all( sets.map( async ( set ) => {
		set.entry_count = await req( idx.count( set.id ) );
	} ) );
	return sets.sort( ( a, b ) => a.name.localeCompare( b.name ) );
}

export async function getSet( id ) {
	const { s } = await store( 'sets' );
	return req( s.get( id ) );
}

export async function getSetBySlug( slug ) {
	const { s } = await store( 'sets' );
	return req( s.index( 'slug' ).get( slug ) );
}

export async function createSet( name, language ) {
	name = String( name || '' ).trim();
	if ( ! name ) throw new Error( 'Give the set a name.' );
	const slug = await uniqueSlug( slugify( name ) );
	const { tx, s } = await store( 'sets', 'readwrite' );
	const set = { name, slug, language: language || 'bpm', created_at: now(), updated_at: now() };
	const id = await req( s.add( set ) );
	await txDone( tx );
	return Object.assign( set, { id } );
}

export async function updateSet( id, changes ) {
	const set = await getSet( id );
	if ( ! set ) throw new Error( 'Set not found.' );
	if ( changes.name !== undefined ) {
		const name = String( changes.name ).trim();
		if ( ! name ) throw new Error( 'Give the set a name.' );
		set.name = name;
		set.slug = await uniqueSlug( slugify( name ), id );
	}
	if ( changes.language ) set.language = changes.language;
	set.updated_at = now();
	const { tx, s } = await store( 'sets', 'readwrite' );
	s.put( set );
	await txDone( tx );
	return set;
}

export async function deleteSet( id ) {
	const db = await open();
	const tx = db.transaction( [ 'sets', 'entries' ], 'readwrite' );
	const idx = tx.objectStore( 'entries' ).index( 'set_id' );
	const keys = await req( idx.getAllKeys( id ) );
	keys.forEach( k => tx.objectStore( 'entries' ).delete( k ) );
	tx.objectStore( 'sets' ).delete( id );
	return txDone( tx );
}

// ── Entries ───────────────────────────────────────────────────────────────

export async function getEntries( setId ) {
	const { s } = await store( 'entries' );
	const rows = await req( s.index( 'set_id' ).getAll( setId ) );
	return rows.sort( ( a, b ) => ( a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id ) );
}

export async function getEntry( id ) {
	const { s } = await store( 'entries' );
	return req( s.get( id ) );
}

export async function saveEntry( entry ) {
	const row = Object.assign( {}, entry );
	row.word_script = String( row.word_script || '' ).trim();
	row.word_roman  = String( row.word_roman  || '' ).trim();
	row.description = String( row.description || '' ).trim();
	row.updated_at  = now();
	if ( ! row.id ) {
		delete row.id;
		row.created_at = row.created_at || now();
	}
	const { tx, s } = await store( 'entries', 'readwrite' );
	const id = await req( s.put( row ) );
	await txDone( tx );
	return Object.assign( row, { id } );
}

export async function deleteEntry( id ) {
	const { tx, s } = await store( 'entries', 'readwrite' );
	s.delete( id );
	return txDone( tx );
}

// ── Languages ─────────────────────────────────────────────────────────────

export async function getLanguages() {
	const { s } = await store( 'languages' );
	const rows = await req( s.getAll() );
	const order = DEFAULT_LANGUAGES.map( l => l.code );
	return rows.sort( ( a, b ) => {
		const ia = order.indexOf( a.code ), ib = order.indexOf( b.code );
		if ( ia !== -1 || ib !== -1 ) return ( ia === -1 ? 99 : ia ) - ( ib === -1 ? 99 : ib );
		return a.label.localeCompare( b.label );
	} );
}

export async function getLanguage( code ) {
	const { s } = await store( 'languages' );
	return req( s.get( code ) );
}

export async function putLanguage( lang ) {
	const { tx, s } = await store( 'languages', 'readwrite' );
	s.put( lang );
	return txDone( tx );
}

export async function deleteLanguage( code ) {
	const db = await open();
	const tx = db.transaction( [ 'languages', 'ime_files', 'ime_backups' ], 'readwrite' );
	tx.objectStore( 'languages' ).delete( code );
	const files = await req( tx.objectStore( 'ime_files' ).getAll() );
	files.filter( f => f.lang === code ).forEach( f => tx.objectStore( 'ime_files' ).delete( f.id ) );
	const backups = await req( tx.objectStore( 'ime_backups' ).getAll() );
	backups.filter( b => b.lang === code ).forEach( b => tx.objectStore( 'ime_backups' ).delete( b.id ) );
	return txDone( tx );
}

export async function countSetsUsingLanguage( code ) {
	const { s } = await store( 'sets' );
	const rows = await req( s.getAll() );
	return rows.filter( r => r.language === code ).length;
}

// ── IME file overrides ────────────────────────────────────────────────────

export async function getImeOverride( lang, key ) {
	const { s } = await store( 'ime_files' );
	return req( s.get( lang + ':' + key ) );
}

export async function putImeOverride( lang, key, data, filename ) {
	const { tx, s } = await store( 'ime_files', 'readwrite' );
	s.put( { id: lang + ':' + key, lang, key, data, filename: filename || '', updated_at: now() } );
	return txDone( tx );
}

export async function deleteImeOverride( lang, key ) {
	const { tx, s } = await store( 'ime_files', 'readwrite' );
	s.delete( lang + ':' + key );
	return txDone( tx );
}

export async function addImeBackup( lang, key, data, filename, keep = 20 ) {
	const { tx, s } = await store( 'ime_backups', 'readwrite' );
	s.add( { lang, key, data, filename: filename || '', created_at: now() } );
	const all = await req( s.index( 'lang_key' ).getAll( [ lang, key ] ) );
	all.sort( ( a, b ) => b.id - a.id ).slice( keep ).forEach( b => s.delete( b.id ) );
	return txDone( tx );
}

export async function getImeBackups( lang, key ) {
	const { s } = await store( 'ime_backups' );
	const rows = await req( s.index( 'lang_key' ).getAll( [ lang, key ] ) );
	return rows.sort( ( a, b ) => b.id - a.id );
}

export async function getImeBackup( id ) {
	const { s } = await store( 'ime_backups' );
	return req( s.get( id ) );
}
