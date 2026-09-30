/**
 * Media Map — device storage.
 *
 * All data lives in one directory:
 *
 *   <folder>/
 *     mediamap.json          index: every entry, with the path of its local
 *                            file (if any) and its external URL (if any)
 *     mediamap.backup.json   the previous version of the index
 *     settings.json          this folder's own settings: basemap, pin
 *                            grouping, photo shrinking, last map view
 *     media/                 photos, video, audio and PDFs added from the device
 *     layers/                GeoJSON map layers
 *     forms/                 HTML forms whose output (e.g. a PDF) is attached to places
 *
 * Two kinds of directory are supported:
 *   "folder"  — a real folder the person picks (File System Access API,
 *               Chrome / Edge on desktop). They can open, copy and back it up.
 *   "private" — the browser's private app storage (Origin Private File
 *               System). Works on Android, iOS/Safari and Firefox; data is
 *               copied out with Export.
 */

export const INDEX_FILE  = 'mediamap.json';
export const BACKUP_FILE = 'mediamap.backup.json';
export const MEDIA_DIR   = 'media';
export const LAYER_DIR   = 'layers';
export const FORM_DIR    = 'forms';
export const FORMAT      = 'media-map';
export const SETTINGS_FILE = 'settings.json';
export const SETTINGS_FORMAT  = 'media-map-settings';
export const SETTINGS_VERSION = 1;
export const FORMAT_VERSION = 4;   // 2: notes, documents, layers. 3: forms, attachments. 4: author, class pack

export const supportsFolder  = typeof window.showDirectoryPicker === 'function';
export const supportsPrivate = !!( navigator.storage && typeof navigator.storage.getDirectory === 'function' );

/* ------------------------------------------------------------------ */
/* Tiny IndexedDB key/value store (directory handles can't go in       */
/* localStorage; the service worker also reads settings from here).    */
/* ------------------------------------------------------------------ */
const IDB_NAME = 'mediamap-pwa', IDB_STORE = 'kv';
let dbPromise = null;
function idb() {
    if ( ! dbPromise ) {
        dbPromise = new Promise( ( resolve, reject ) => {
            const req = indexedDB.open( IDB_NAME, 1 );
            req.onupgradeneeded = () => req.result.createObjectStore( IDB_STORE );
            req.onsuccess = () => resolve( req.result );
            req.onerror   = () => reject( req.error );
        } );
    }
    return dbPromise;
}
function kvReq( mode, fn ) {
    return idb().then( db => new Promise( ( resolve, reject ) => {
        const req = fn( db.transaction( IDB_STORE, mode ).objectStore( IDB_STORE ) );
        req.onsuccess = () => resolve( req.result );
        req.onerror   = () => reject( req.error );
    } ) );
}
export const kvGet = k => kvReq( 'readonly', s => s.get( k ) );
export const kvSet = ( k, v ) => kvReq( 'readwrite', s => s.put( v, k ) );
export const kvDel = k => kvReq( 'readwrite', s => s.delete( k ) );

/* ------------------------------------------------------------------ */
/* Safari (before 26) has no createWritable() in private storage; it   */
/* only allows synchronous handles inside a worker. This worker is     */
/* created on demand from a blob, so it also works offline.            */
/* ------------------------------------------------------------------ */
let writer = null, writerSeq = 0;
const writerPending = new Map();
function workerWrite( segments, buffer ) {
    if ( ! writer ) {
        const src = `onmessage = async (e) => {
            const { id, segs, buf } = e.data;
            try {
                let d = await navigator.storage.getDirectory();
                for (let i = 0; i < segs.length - 1; i++) d = await d.getDirectoryHandle(segs[i], { create: true });
                const fh = await d.getFileHandle(segs[segs.length - 1], { create: true });
                const h = await fh.createSyncAccessHandle();
                try { h.truncate(0); h.write(new Uint8Array(buf), { at: 0 }); h.flush(); } finally { h.close(); }
                postMessage({ id });
            } catch (err) { postMessage({ id, error: String((err && err.message) || err) }); }
        };`;
        writer = new Worker( URL.createObjectURL( new Blob( [ src ], { type: 'text/javascript' } ) ) );
        writer.onmessage = e => {
            const p = writerPending.get( e.data.id );
            writerPending.delete( e.data.id );
            if ( p ) e.data.error ? p.reject( new Error( e.data.error ) ) : p.resolve();
        };
    }
    return new Promise( ( resolve, reject ) => {
        const id = ++writerSeq;
        writerPending.set( id, { resolve, reject } );
        writer.postMessage( { id, segs: segments, buf: buffer }, [ buffer ] );
    } );
}

/* ------------------------------------------------------------------ */
/* Index helpers                                                       */
/* ------------------------------------------------------------------ */
export function emptyIndex() {
    return { format: FORMAT, version: FORMAT_VERSION, updated: new Date().toISOString(), entries: [], layers: [], forms: [], pack: null };
}

const TYPES = [ 'image', 'video', 'audio', 'document', 'text' ];
const num = v => ( typeof v === 'number' ? v : parseFloat( v ) );

/** Normalise one entry; returns null when it can't be placed on the map. */
export function cleanEntry( e ) {
    if ( ! e || typeof e !== 'object' ) return null;
    const lat = num( e.lat ), lng = num( e.lng );
    if ( ! Number.isFinite( lat ) || ! Number.isFinite( lng ) || Math.abs( lat ) > 90 || Math.abs( lng ) > 180 ) return null;
    const out = {
        id:          String( e.id || newId() ),
        lat:         Math.round( lat * 1e7 ) / 1e7,
        lng:         Math.round( lng * 1e7 ) / 1e7,
        place:       String( e.place || '' ).slice( 0, 500 ),
        description: String( e.description || '' ).slice( 0, 20000 ),
        type:        TYPES.includes( e.type ) ? e.type : 'text',
        file:        null,
        url:         typeof e.url === 'string' && /^https?:\/\//i.test( e.url.trim() ) ? e.url.trim() : '',
        author:      String( e.author || '' ).trim().slice( 0, 100 ),
        created:     validDate( e.created ) || new Date().toISOString(),
        updated:     validDate( e.updated ) || validDate( e.created ) || new Date().toISOString(),
    };
    if ( e.file && typeof e.file === 'object' && safePath( e.file.path ) ) {
        out.file = {
            path: e.file.path,
            name: String( e.file.name || e.file.path.split( '/' ).pop() ),
            mime: String( e.file.mime || '' ),
            size: Number( e.file.size ) || 0,
        };
    }
    out.notes = [];
    if ( Array.isArray( e.notes ) ) {
        const seen = new Set();
        for ( const n of e.notes ) {
            if ( ! n || typeof n.text !== 'string' || ! n.text.trim() ) continue;
            const id = String( n.id || newId() );
            if ( seen.has( id ) ) continue;
            seen.add( id );
            const created = validDate( n.created ) || out.updated;
            out.notes.push( { id, text: n.text.slice( 0, 20000 ), created, updated: validDate( n.updated ) || created } );
        }
        out.notes.sort( ( a, b ) => a.created.localeCompare( b.created ) );
    }
    out.attachments = [];
    if ( Array.isArray( e.attachments ) ) {
        const seen = new Set();
        for ( const a of e.attachments ) {
            if ( ! a || ! safePath( a.path ) ) continue;
            const id = String( a.id || newId() );
            if ( seen.has( id ) ) continue;
            seen.add( id );
            out.attachments.push( {
                id,
                path: a.path,
                name: String( a.name || a.path.split( '/' ).pop() ).slice( 0, 300 ),
                mime: String( a.mime || '' ).slice( 0, 100 ),
                size: Number( a.size ) || 0,
                form: a.form && typeof a.form === 'object' ? { id: String( a.form.id || '' ), name: String( a.form.name || '' ).slice( 0, 200 ) } : null,
                created: validDate( a.created ) || out.updated,
            } );
        }
        out.attachments.sort( ( a, b ) => a.created.localeCompare( b.created ) );
    }
    return out;
}

/**
 * Class pack details: a title and instructions a teacher adds when sharing a
 * starter pack, plus (optionally) the map settings and starting view.
 */
export function cleanPack( p ) {
    if ( ! p || typeof p !== 'object' ) return null;
    const title = String( p.title || '' ).trim().slice( 0, 200 );
    if ( ! title ) return null;
    let map = null;
    const m = p.map;
    if ( m && typeof m === 'object' && typeof m.tileUrl === 'string' && m.tileUrl.trim() ) {
        const num = ( v, lo, hi, d ) => { const n = Number( v ); return Number.isFinite( n ) ? Math.min( hi, Math.max( lo, n ) ) : d; };
        map = {
            tileUrl: m.tileUrl.trim().slice( 0, 4000 ),
            attribution: String( m.attribution || '' ).slice( 0, 1000 ),
            maxZoom: num( m.maxZoom, 1, 22, 19 ),
            lat: num( m.lat, -85, 85, 20 ),
            lng: num( m.lng, -180, 180, 0 ),
            zoom: num( m.zoom, 0, 22, 2 ),
        };
    }
    return {
        title,
        instructions: String( p.instructions || '' ).slice( 0, 5000 ),
        created: validDate( p.created ) || new Date().toISOString(),
        map,
    };
}

/** An HTML form kept in forms/. */
export function cleanForm( f ) {
    if ( ! f || typeof f !== 'object' || ! safePath( f.file ) ) return null;
    const created = validDate( f.created ) || new Date().toISOString();
    return {
        id:      String( f.id || newId() ),
        name:    String( f.name || f.file.split( '/' ).pop() ).slice( 0, 200 ),
        file:    f.file,
        prefillLocation: f.prefillLocation !== false,
        created,
        updated: validDate( f.updated ) || created,
    };
}

/* ------------------------------------------------------------------ */
/* Per-folder settings (settings.json)                                 */
/* ------------------------------------------------------------------ */
/** Settings that belong to a data folder rather than to the device. */
export const FOLDER_SETTING_KEYS = [ 'tileUrl', 'attribution', 'maxZoom', 'cluster', 'shrinkPhotos', 'view' ];

function cleanView( v ) {
    if ( ! v || typeof v !== 'object' ) return null;
    const lat = Number( v.lat ), lng = Number( v.lng ), zoom = Number( v.zoom );
    if ( ! Number.isFinite( lat ) || ! Number.isFinite( lng ) || ! Number.isFinite( zoom ) ) return null;
    if ( Math.abs( lat ) > 90 ) return null;
    return {
        lat:  Math.round( lat * 1e6 ) / 1e6,
        lng:  Math.round( ( ( ( lng + 180 ) % 360 + 360 ) % 360 - 180 ) * 1e6 ) / 1e6,
        zoom: Math.min( 22, Math.max( 0, Math.round( zoom * 100 ) / 100 ) ),
    };
}

/**
 * Read a settings.json document into flat settings. Only valid fields are
 * returned, so anything missing or broken falls back to the app's current
 * value instead of wiping it.
 */
export function parseSettings( text ) {
    const d = JSON.parse( text );
    if ( ! d || typeof d !== 'object' || d.format !== SETTINGS_FORMAT ) throw new Error( 'Not a Media Map settings file' );
    if ( Number( d.version ) > SETTINGS_VERSION ) throw new Error( 'These settings were saved by a newer version of Media Map' );
    const out = {};
    const b = d.basemap && typeof d.basemap === 'object' ? d.basemap : {};
    if ( typeof b.tileUrl === 'string' && b.tileUrl.trim() ) out.tileUrl = b.tileUrl.trim().slice( 0, 4000 );
    if ( typeof b.attribution === 'string' ) out.attribution = b.attribution.slice( 0, 1000 );
    if ( Number.isFinite( Number( b.maxZoom ) ) && b.maxZoom !== null && b.maxZoom !== '' ) out.maxZoom = clampNum( b.maxZoom, 1, 22, 19 );
    if ( typeof d.cluster === 'boolean' ) out.cluster = d.cluster;
    if ( typeof d.shrinkPhotos === 'boolean' ) out.shrinkPhotos = d.shrinkPhotos;
    if ( 'view' in d ) out.view = cleanView( d.view );
    return out;
}

/** The settings.json document for the given (flat) settings. */
export function settingsDocument( s ) {
    return {
        format:  SETTINGS_FORMAT,
        version: SETTINGS_VERSION,
        updated: new Date().toISOString(),
        basemap: {
            tileUrl:     String( s.tileUrl || '' ),
            attribution: String( s.attribution || '' ),
            maxZoom:     clampNum( s.maxZoom, 1, 22, 19 ),
        },
        cluster:      s.cluster !== false,
        shrinkPhotos: s.shrinkPhotos !== false,
        view:         cleanView( s.view ),
    };
}

/* ------------------------------------------------------------------ */
/* Map layers (GeoJSON)                                                */
/* ------------------------------------------------------------------ */
const HEX = /^#[0-9a-f]{6}$/i;
const clampNum = ( v, min, max, d ) => { const n = Number( v ); return Number.isFinite( n ) ? Math.min( max, Math.max( min, n ) ) : d; };
export const LAYER_COLORS = [ '#1F6F8B', '#C0392B', '#2E8B57', '#8E44AD', '#D35400', '#2C3E50', '#B8860B', '#16A085' ];

export function defaultStyle( color = LAYER_COLORS[ 0 ] ) {
    return {
        stroke: color, weight: 2, opacity: 0.9, dash: 'solid',
        fill: color, fillOpacity: 0.25, radius: 6,
        colorBy: '', label: '', useFileStyle: true, cluster: true,
    };
}

export function cleanStyle( st ) {
    const d = defaultStyle();
    st = st && typeof st === 'object' ? st : {};
    return {
        stroke:      HEX.test( st.stroke ) ? st.stroke : d.stroke,
        weight:      clampNum( st.weight, 0, 20, d.weight ),
        opacity:     clampNum( st.opacity, 0, 1, d.opacity ),
        dash:        [ 'solid', 'dashed', 'dotted' ].includes( st.dash ) ? st.dash : 'solid',
        fill:        HEX.test( st.fill ) ? st.fill : d.fill,
        fillOpacity: clampNum( st.fillOpacity, 0, 1, d.fillOpacity ),
        radius:      clampNum( st.radius, 1, 40, d.radius ),
        colorBy:     typeof st.colorBy === 'string' ? st.colorBy.slice( 0, 200 ) : '',
        label:       typeof st.label === 'string' ? st.label.slice( 0, 200 ) : '',
        useFileStyle: st.useFileStyle !== false,
        cluster:     st.cluster !== false,
    };
}

export function cleanLayer( l ) {
    if ( ! l || typeof l !== 'object' || ! safePath( l.file ) ) return null;
    const created = validDate( l.created ) || new Date().toISOString();
    return {
        id:       String( l.id || newId() ),
        name:     String( l.name || l.file.split( '/' ).pop() ).slice( 0, 200 ),
        file:     l.file,
        visible:  l.visible !== false,
        style:    cleanStyle( l.style ),
        features: Math.max( 0, parseInt( l.features, 10 ) || 0 ),
        created,
        updated:  validDate( l.updated ) || created,
    };
}

function validDate( d ) {
    if ( ! d ) return '';
    const t = new Date( d );
    return isNaN( t ) ? '' : t.toISOString();
}

export function safePath( p ) {
    if ( typeof p !== 'string' || ! p || p.length > 400 ) return false;
    const parts = p.split( '/' );
    return parts.every( s => s && s !== '.' && s !== '..' && ! /[\\:*?"<>|\x00-\x1f]/.test( s ) );
}

/**
 * A file-name-safe version of `name`. Keeps letters in any script
 * (e.g. Assamese or Bengali place names), digits, dots, dashes and
 * underscores; spaces become dashes. Long names keep their beginning.
 */
export function safeFileName( name, max = 120 ) {
    let s = String( name || '' ).normalize( 'NFC' )
        .replace( /[^\p{L}\p{M}\p{N}._\- ]+/gu, ' ' )
        .trim().replace( /\s+/g, '-' ).replace( /-{2,}/g, '-' ).replace( /^[.-]+/, '' );
    const dot = s.lastIndexOf( '.' );
    const ext = dot > 0 && s.length - dot <= 6 ? s.slice( dot ) : '';
    const base = ext ? s.slice( 0, dot ) : s;
    return ( [ ...base ].slice( 0, max ).join( '' ).replace( /[-.]+$/, '' ) + ext );
}

export function newId() {
    if ( crypto.randomUUID ) return crypto.randomUUID().replace( /-/g, '' ).slice( 0, 12 );
    return Date.now().toString( 36 ) + Math.random().toString( 36 ).slice( 2, 8 );
}

export function parseIndex( text ) {
    const data = JSON.parse( text );
    if ( ! data || data.format !== FORMAT || ! Array.isArray( data.entries ) ) {
        throw new Error( 'Not a Media Map index file' );
    }
    if ( Number( data.version ) > FORMAT_VERSION ) {
        throw new Error( 'This data was saved by a newer version of Media Map. Update the app to open it' );
    }
    const seen = new Set();
    const entries = [];
    for ( const raw of data.entries ) {
        const e = cleanEntry( raw );
        if ( e && ! seen.has( e.id ) ) { seen.add( e.id ); entries.push( e ); }
    }
    const layers = [];
    const seenL = new Set();
    for ( const raw of Array.isArray( data.layers ) ? data.layers : [] ) {
        const l = cleanLayer( raw );
        if ( l && ! seenL.has( l.id ) ) { seenL.add( l.id ); layers.push( l ); }
    }
    const forms = [];
    const seenF = new Set();
    for ( const raw of Array.isArray( data.forms ) ? data.forms : [] ) {
        const f = cleanForm( raw );
        if ( f && ! seenF.has( f.id ) ) { seenF.add( f.id ); forms.push( f ); }
    }
    return { format: FORMAT, version: FORMAT_VERSION, updated: validDate( data.updated ) || new Date().toISOString(), entries, layers, forms, pack: cleanPack( data.pack ) };
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */
export class Store {
    constructor( root, kind ) {
        this.root = root;
        this.kind = kind;                       // 'folder' | 'private'
        this.name = kind === 'folder' ? root.name : 'App storage';
        this.lastModified = 0;                  // of INDEX_FILE, as last read/written by us
        this.settingsModified = 0;              // of SETTINGS_FILE, likewise
        this._queue = Promise.resolve();
    }

    _split( path ) {
        if ( ! safePath( path ) ) throw new Error( 'Invalid file path: ' + path );
        const parts = path.split( '/' );
        return { dirs: parts.slice( 0, -1 ), name: parts[ parts.length - 1 ] };
    }
    async _dir( dirs, create ) {
        let d = this.root;
        for ( const p of dirs ) d = await d.getDirectoryHandle( p, { create } );
        return d;
    }

    async getFile( path ) {
        const { dirs, name } = this._split( path );
        const d = await this._dir( dirs, false );
        return ( await d.getFileHandle( name ) ).getFile();
    }
    async exists( path ) {
        try { await this.getFile( path ); return true; } catch { return false; }
    }

    /** Writes are serialised so two saves can never interleave. */
    write( path, data ) {
        const p = this._queue.then( () => this._write( path, data ) );
        this._queue = p.catch( () => {} );
        return p;
    }
    async _write( path, data ) {
        const { dirs, name } = this._split( path );
        const d  = await this._dir( dirs, true );
        const fh = await d.getFileHandle( name, { create: true } );
        if ( typeof fh.createWritable === 'function' ) {
            const w = await fh.createWritable();
            try { await w.write( data ); await w.close(); }
            catch ( err ) { try { await w.abort(); } catch {} throw err; }
            return;
        }
        if ( this.kind !== 'private' ) throw new Error( 'This browser cannot write to the chosen folder.' );
        const buf = typeof data === 'string' ? new TextEncoder().encode( data ).buffer : await data.arrayBuffer();
        await workerWrite( [ ...dirs, name ], buf );
    }

    async remove( path ) {
        const { dirs, name } = this._split( path );
        try {
            const d = await this._dir( dirs, false );
            await d.removeEntry( name );
        } catch ( err ) {
            if ( err && err.name !== 'NotFoundError' ) throw err;
        }
    }

    /** Names of files in a sub-directory (non-recursive). */
    async list( dirPath ) {
        const out = [];
        try {
            const d = await this._dir( dirPath ? dirPath.split( '/' ) : [], false );
            for await ( const [ n, h ] of d.entries() ) if ( h.kind === 'file' ) out.push( n );
        } catch {}
        return out;
    }

    /** Pick a file name under media/ (or another folder) that isn't taken yet. */
    async freeMediaPath( fileName, dir = MEDIA_DIR ) {
        const clean = safeFileName( fileName ) || 'file';
        const dot  = clean.lastIndexOf( '.' );
        const base = dot > 0 ? clean.slice( 0, dot ) : clean;
        const ext  = dot > 0 ? clean.slice( dot ) : '';
        const day  = new Date().toISOString().slice( 0, 10 );
        let path = `${ dir }/${ day }_${ base }${ ext }`;
        for ( let i = 2; await this.exists( path ); i++ ) path = `${ dir }/${ day }_${ base }-${ i }${ ext }`;
        return path;
    }

    /**
     * Read the index. Falls back to the backup copy if the main file is
     * damaged (e.g. edited by hand). A missing file means a new, empty map.
     */
    async readIndex() {
        let file = null;
        try { file = await this.getFile( INDEX_FILE ); } catch {}
        if ( ! file ) { this.lastModified = 0; return { index: emptyIndex(), warning: '' }; }
        try {
            const index = parseIndex( await file.text() );
            this.lastModified = file.lastModified;
            return { index, warning: '' };
        } catch ( err ) {
            try {
                const index = parseIndex( await ( await this.getFile( BACKUP_FILE ) ).text() );
                this.lastModified = file.lastModified;
                return { index, warning: `${ INDEX_FILE } could not be read (${ err.message }). Loaded the backup copy instead; saving will replace the damaged file.` };
            } catch {
                throw new Error( `${ INDEX_FILE } could not be read: ${ err.message }. Fix or remove the file, then reload.` );
            }
        }
    }

    /** True when the index on disk was changed by something other than this tab. */
    async changedOnDisk() {
        try { return ( await this.getFile( INDEX_FILE ) ).lastModified !== this.lastModified; }
        catch { return this.lastModified !== 0; }
    }

    /**
     * Read this folder's settings.json.
     * Returns { settings, warning }; settings is null when the folder has no
     * settings file yet, or when it couldn't be read (then warning says why).
     */
    async readSettings() {
        let file = null;
        try { file = await this.getFile( SETTINGS_FILE ); } catch {}
        if ( ! file ) { this.settingsModified = 0; return { settings: null, warning: '' }; }
        this.settingsModified = file.lastModified;
        try {
            return { settings: parseSettings( await file.text() ), warning: '' };
        } catch ( err ) {
            const why = err instanceof SyntaxError ? 'it isn’t valid JSON' : err.message;
            return { settings: null, warning: `${ SETTINGS_FILE } could not be read (${ why }). The map is using the previous settings; saving a setting will replace the file.` };
        }
    }

    async settingsChangedOnDisk() {
        try { return ( await this.getFile( SETTINGS_FILE ) ).lastModified !== this.settingsModified; }
        catch { return this.settingsModified !== 0; }
    }

    async saveSettings( settings ) {
        await this.write( SETTINGS_FILE, JSON.stringify( settingsDocument( settings ), null, 2 ) + '\n' );
        try { this.settingsModified = ( await this.getFile( SETTINGS_FILE ) ).lastModified; } catch {}
    }

    async saveIndex( index ) {
        index.updated = new Date().toISOString();
        const text = JSON.stringify( index, null, 2 ) + '\n';
        // Keep the previous version as a backup before replacing it.
        try {
            const prev = await ( await this.getFile( INDEX_FILE ) ).text();
            parseIndex( prev );
            await this.write( BACKUP_FILE, prev );
        } catch {}
        await this.write( INDEX_FILE, text );
        try { this.lastModified = ( await this.getFile( INDEX_FILE ) ).lastModified; } catch {}
    }
}

/* ------------------------------------------------------------------ */
/* Choosing / reopening the storage location                           */
/* ------------------------------------------------------------------ */

/** Returns { state: 'ready', store } | { state: 'needs-permission', handle } | { state: 'none' } */
export async function openSaved() {
    let saved = null;
    try { saved = await kvGet( 'store' ); } catch {}
    if ( ! saved ) return { state: 'none' };
    if ( saved.kind === 'private' && supportsPrivate ) {
        return { state: 'ready', store: new Store( await navigator.storage.getDirectory(), 'private' ) };
    }
    if ( saved.kind === 'folder' && saved.handle && supportsFolder ) {
        const perm = await saved.handle.queryPermission( { mode: 'readwrite' } );
        if ( perm === 'granted' ) return { state: 'ready', store: new Store( saved.handle, 'folder' ) };
        return { state: 'needs-permission', handle: saved.handle };
    }
    return { state: 'none' };
}

/** Must be called from a click handler. */
export async function reconnectFolder( handle ) {
    const perm = await handle.requestPermission( { mode: 'readwrite' } );
    if ( perm !== 'granted' ) throw new Error( 'Access to the folder was not allowed.' );
    return new Store( handle, 'folder' );
}

/**
 * Ask for a folder. If it already holds a Media Map (its mediamap.json or
 * settings.json) it is used as-is; an
 * empty folder is used directly; a folder with other files in it gets a
 * "Media Map" sub-folder so the data doesn't mix with unrelated files.
 * Must be called from a click handler. Does not remember the choice.
 */
export async function pickFolder() {
    const picked = await window.showDirectoryPicker( { id: 'mediamap', mode: 'readwrite', startIn: 'documents' } );
    let hasIndex = false, hasOther = false;
    for await ( const [ name ] of picked.entries() ) {
        if ( name === INDEX_FILE || name === SETTINGS_FILE || name === BACKUP_FILE ) hasIndex = true;
        else if ( ! name.startsWith( '.' ) ) hasOther = true;
    }
    const root = ( hasIndex || ! hasOther ) ? picked : await picked.getDirectoryHandle( 'Media Map', { create: true } );
    return new Store( root, 'folder' );
}

export async function privateStore() {
    return new Store( await navigator.storage.getDirectory(), 'private' );
}

export async function remember( store ) {
    await kvSet( 'store', store.kind === 'folder' ? { kind: 'folder', handle: store.root } : { kind: 'private' } );
    if ( store.kind === 'private' && navigator.storage.persist ) {
        try { await navigator.storage.persist(); } catch {}
    }
}
