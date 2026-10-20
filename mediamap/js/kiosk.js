/**
 * Kiosk export: writes the "mediamap-kiosk-data" folder that the MediaMap Kiosk app opens in its
 * USB mode (USB Drive → Select folder…). The kiosk reads a flat folder:
 *
 *   mediamap-kiosk-data/
 *   ├── settings.json            ← { kiosk: {…}, layers: [ { file, name, enabled, shapeStyle, cluster }, … ] }
 *   ├── places.json              ← this map's places, as rows of the Media Map WordPress plugin export
 *   ├── 2026-09-27_ward-boundaries.geojson
 *   └── 2026-09-27_temple-gate.jpg   ← media referenced from places.json by bare file name
 *
 * The kiosk can't open files in sub-folders, so media and layer files are copied to the top level
 * under unique names (case-insensitive, for FAT32/exFAT USB drives). It plays local image, video,
 * audio and PDF files, YouTube / Vimeo / Spotify / SoundCloud and similar links, and Street View
 * only as a google.com/maps/embed address, so links are converted to what it understands.
 *
 * settings.json also lists every file the export wrote ("exportedFiles"), so exporting again into
 * the same folder can remove files the previous export left behind, and nothing else.
 */
import * as S from './store.js';
import * as M from './media.js';
import { parseStreetView, streetViewSrc, findStreetViews } from './streetview.js';
import { parseGeoJSON } from './layers.js';
import { makeZip } from './zip.js';

export const KIOSK_DIR = 'mediamap-kiosk-data';
export const KIOSK_SETTINGS = 'settings.json';
export const PLACES_FILE = 'places.json';
export const GENERATOR = 'Media Map';

const OPTIONS_KEY = 'mediamap_kiosk';
const DEFAULT_OPTIONS = { idle: 90, lock: false, notes: false, author: false, placesName: '' };
const KIOSK_SHAPE_DEFAULT = { fillColor: '#4f46e5', fillOpacity: 0.35, lineColor: '#4f46e5', lineWeight: 3, label: '', labelColor: '#1e293b', labelSize: 14 };
// Styling properties (simplestyle-spec and common GIS leftovers) that mean nothing to a kiosk visitor.
const STYLE_PROPS = new Set( [ 'stroke', 'stroke-width', 'stroke-opacity', 'fill', 'fill-opacity', 'marker-color', 'marker-size', 'marker-symbol', 'styleUrl', 'styleHash', 'styleMapHash', 'icon', 'visibility' ] );
const KIOSK_VIDEO_HOSTS = /(?:dailymotion\.com\/video\/|clips\.twitch\.tv\/|twitch\.tv\/|tiktok\.com\/@[^/]+\/video\/|streamable\.com\/[A-Za-z0-9]+|loom\.com\/share\/)/i;

const esc = s => String( s ?? '' ).replace( /[&<>"']/g, c => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } )[ c ] );
const $ = ( sel, root = document ) => root.querySelector( sel );
const $$ = ( sel, root = document ) => [ ...root.querySelectorAll( sel ) ];
const plural = ( n, one, many ) => `${ n } ${ n === 1 ? one : many }`;
const clip = ( s, n ) => ( s.length > n ? s.slice( 0, n - 1 ).trimEnd() + '…' : s );

/* ------------------------------------------------------------------ */
/* Conversion (no DOM; exported for testing)                           */
/* ------------------------------------------------------------------ */

/**
 * How the kiosk can show an external link: { type, url } with a kiosk media_type
 * ('image' | 'video' | 'audio' | 'pdf' | 'streetview'), or null when it can only be text.
 */
export function kioskMediaForUrl( raw ) {
    const url = String( raw || '' ).trim();
    if ( ! M.parseUrl( url ) && ! /^\s*<iframe\b/i.test( url ) ) return null;
    // Street View: the kiosk accepts only https://www.google.com/maps/embed… addresses.
    const sv = parseStreetView( url );
    if ( sv ) {
        const src = streetViewSrc( sv );
        return /^https:\/\/(?:www\.)?google\.com\/maps\/embed/.test( src ) ? { type: 'streetview', url: src.replace( '//google.com', '//www.google.com' ) } : null;
    }
    if ( ! M.parseUrl( url ) ) return null;
    const emb = M.embedFor( url );
    if ( emb ) {
        if ( emb.kind === 'pdf' ) return { type: 'pdf', url };
        if ( emb.kind === 'image' || emb.kind === 'video' || emb.kind === 'audio' ) return { type: emb.kind, url };
        if ( emb.kind === 'iframe' ) {
            // Rewrite to the address forms the kiosk's own link matcher recognises.
            let m;
            if ( ( m = /youtube-nocookie\.com\/embed\/([\w-]+)/.exec( emb.src ) ) ) return { type: 'video', url: `https://www.youtube.com/watch?v=${ m[ 1 ] }` };
            if ( ( m = /player\.vimeo\.com\/video\/(\d+)/.exec( emb.src ) ) ) return { type: 'video', url: `https://vimeo.com/${ m[ 1 ] }` };
            if ( ( m = /open\.spotify\.com\/embed\/(\w+)\/(\w+)/.exec( emb.src ) ) ) return { type: 'audio', url: `https://open.spotify.com/${ m[ 1 ] }/${ m[ 2 ] }` };
            if ( /w\.soundcloud\.com\/player/.test( emb.src ) ) {
                const u = M.parseUrl( url );
                return { type: 'audio', url: `https://soundcloud.com${ u.pathname }` };
            }
        }
    }
    // Players the kiosk knows but this app shows as plain links.
    if ( KIOSK_VIDEO_HOSTS.test( url ) ) return { type: 'video', url };
    return null;
}

/** Kiosk media_type for a file stored with a place. */
export function kioskTypeForFile( file, entryType ) {
    const t = M.typeFromFile( file.mime, file.name || file.path ) || entryType;
    if ( t === 'document' ) return M.isPdf( file.mime, file.name || file.path ) ? 'pdf' : '';
    return [ 'image', 'video', 'audio' ].includes( t ) ? t : '';
}

/** Short date for notes, e.g. 28 Sep 2026. */
function shortDate( iso ) {
    try { return new Date( iso ).toLocaleDateString( 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' } ); } catch { return ''; }
}

/**
 * One place as a kiosk row (the WordPress plugin's export columns, which the kiosk reads).
 * @param e        a cleaned entry from mediamap.json
 * @param fileName the kiosk-folder name of the place's file, or '' if it isn't included
 * @param opts     { notes, author }
 * @returns { row, linkOnly, svSkipped }
 */
export function placeRow( e, fileName, opts = {} ) {
    let mediaType = '', mediaUrl = '', linkUsed = false, svSkipped = false;
    if ( e.file && fileName ) {
        mediaType = kioskTypeForFile( e.file, e.type );
        if ( mediaType ) mediaUrl = fileName;
    }
    if ( ! mediaUrl && e.url ) {
        const k = kioskMediaForUrl( e.url );
        if ( k ) { mediaType = k.type; mediaUrl = k.url; linkUsed = true; }
        else if ( parseStreetView( e.url ) ) svSkipped = true;
    }
    const parts = [];
    if ( e.description.trim() ) parts.push( e.description.trim() );
    if ( e.url && ! linkUsed ) parts.push( `Link: ${ e.url }` );
    if ( opts.notes && e.notes.length ) {
        parts.push( 'Notes: ' + e.notes.map( n => `${ n.text.trim() } (${ shortDate( n.created ) })` ).join( ' · ' ) );
    }
    if ( opts.author && e.author ) parts.push( `Added by ${ e.author }.` );
    return {
        row: {
            id: e.id,
            lat: e.lat,
            lng: e.lng,
            place_name: e.place || 'Untitled place',
            media_type: mediaUrl ? mediaType : 'text',
            media_url: mediaUrl,
            description: parts.join( '\n\n' ),
            author: e.author,
            submitted_at: e.created,
            updated_at: e.updated,
        },
        linkOnly: !! ( e.url && ! linkUsed && ! mediaUrl ),
        svSkipped,
    };
}

/** A Media Map layer style as the kiosk's shapeStyle. */
export function kioskShapeStyle( style ) {
    const st = S.cleanStyle( style );
    return {
        ...KIOSK_SHAPE_DEFAULT,
        fillColor: st.fill,
        fillOpacity: st.fillOpacity,
        lineColor: st.stroke,
        lineWeight: st.weight,
    };
}

function hasPoint( g ) {
    if ( ! g ) return false;
    if ( g.type === 'Point' || g.type === 'MultiPoint' ) return true;
    return g.type === 'GeometryCollection' && ( g.geometries || [] ).some( hasPoint );
}
const blank = v => v === null || v === undefined || ( typeof v === 'string' && ! v.trim() );

/** Media for a layer property, following the layer popup's rules (URL, Street View in text, media-named fields). */
function mediaFromProperty( key, value ) {
    const raw = String( value ).trim();
    const words = raw.split( /\s+/ );
    if ( words.length === 1 && M.parseUrl( raw ) ) {
        const k = kioskMediaForUrl( raw );
        if ( k ) return k;
        const name = String( key ).toLowerCase().replace( /[^a-z0-9]+/g, ' ' ).trim();
        if ( /(^| )(image|img|photo|picture|thumbnail|pic)( |$)/.test( name ) ) return { type: 'image', url: raw };
        if ( /(^| )(audio|sound|recording|voice)( |$)/.test( name ) ) return { type: 'audio', url: raw };
        if ( /(^| )(video|movie|film|clip)( |$)/.test( name ) ) return { type: 'video', url: raw };
        return null;
    }
    for ( const w of words.length > 1 && words.every( x => M.parseUrl( x ) ) ? words : [] ) {
        const k = kioskMediaForUrl( w );
        if ( k ) return k;
    }
    const sv = findStreetViews( raw ).map( s => kioskMediaForUrl( s.url ) ).find( Boolean );
    return sv || null;
}

/**
 * Give a layer's point features the fields the kiosk shows (place_name, description, media_type,
 * media_url), taken from the layer's popup settings. Existing fields of those names are kept, so
 * data made for the kiosk passes through unchanged. Lines and areas are left as they are.
 * @returns a new FeatureCollection
 */
export function kioskLayerData( fc, meta ) {
    const cfg = S.cleanPopup( meta.popup );
    const st = S.cleanStyle( meta.style );
    const order = cfg.fields.map( f => f.key );
    const hidden = new Set( cfg.fields.filter( f => ! f.visible ).map( f => f.key ) );
    const features = fc.features.map( f => {
        if ( ! hasPoint( f.geometry ) ) return f;
        const p = f.properties || {};
        const titleKey = [ cfg.title, st.label, 'name', 'Name', 'NAME', 'title', 'Title' ].find( k => k && ! blank( p[ k ] ) ) || '';
        const add = {};
        if ( blank( p.place_name ) && blank( p.name ) && titleKey ) add.place_name = clip( String( p[ titleKey ] ), 300 );
        const wantMedia = blank( p.media_url );
        const wantDesc = blank( p.description ) && blank( p.desc );
        if ( wantMedia || wantDesc ) {
            const keys = [ ...order.filter( k => k in p ), ...Object.keys( p ).filter( k => ! order.includes( k ) ) ]
                .filter( k => ! hidden.has( k ) && k !== titleKey && ! STYLE_PROPS.has( k ) && ! blank( p[ k ] ) );
            const lines = [];
            let media = null;
            for ( const k of cfg.enabled ? keys : [] ) {
                const v = p[ k ];
                const text = typeof v === 'object' ? JSON.stringify( v ) : String( v );
                if ( wantMedia && ! media ) {
                    media = mediaFromProperty( k, text );
                    if ( media ) continue;
                }
                lines.push( `${ k }: ${ clip( text.replace( /\s+/g, ' ' ).trim(), 300 ) }` );
            }
            if ( wantMedia && media ) { add.media_type = media.type; add.media_url = media.url; }
            if ( wantDesc && lines.length ) add.description = clip( lines.join( '\n' ), 2000 );
        }
        return Object.keys( add ).length ? { ...f, properties: { ...p, ...add } } : f;
    } );
    return { ...fc, features };
}

/** Geometry kind for the kiosk's settings: 'point', 'shape' or 'mixed'. */
export function layerKind( fc ) {
    let pts = 0, shapes = 0;
    const walk = g => {
        if ( ! g ) return;
        if ( g.type === 'GeometryCollection' ) return ( g.geometries || [] ).forEach( walk );
        if ( g.type === 'Point' || g.type === 'MultiPoint' ) pts++; else shapes++;
    };
    fc.features.forEach( f => walk( f.geometry ) );
    return pts && shapes ? 'mixed' : pts ? 'point' : 'shape';
}

/** Unique, flat, drive-safe file names (compared case-insensitively). */
export function nameAllocator( reserved = [ KIOSK_SETTINGS, PLACES_FILE ] ) {
    const used = new Set( reserved.map( n => n.toLowerCase() ) );
    return ( wanted, fallbackExt = '' ) => {
        let clean = S.safeFileName( wanted ) || 'file' + fallbackExt;
        if ( fallbackExt && ! /\.[^.]{1,5}$/.test( clean ) ) clean += fallbackExt;
        const dot = clean.lastIndexOf( '.' );
        const base = dot > 0 ? clean.slice( 0, dot ) : clean;
        const ext = dot > 0 ? clean.slice( dot ) : '';
        let name = clean;
        for ( let i = 2; used.has( name.toLowerCase() ); i++ ) name = `${ base }-${ i }${ ext }`;
        used.add( name.toLowerCase() );
        return name;
    };
}

/**
 * Everything that goes into the kiosk folder.
 * @param ctx  { getStore, getIndex, getSettings, appVersion }
 * @param opts { places:boolean, placesName, layerIds:string[], notes, author, idle, lock }
 * @returns { files: [{name, data, date?}], report }
 */
export async function buildKioskData( ctx, opts, onStep = () => {} ) {
    const st = ctx.getStore();
    const idx = ctx.getIndex();
    const settings = ctx.getSettings();
    const alloc = nameAllocator();
    const files = [];
    const report = { places: 0, media: 0, layers: 0, missing: [], badLayers: [], linkOnly: 0, svSkipped: 0, bytes: 0 };
    const kioskLayers = [];

    // Map layers: the kiosk draws its list in order, later ones on top; Media Map lists the top layer first.
    const chosen = ( idx.layers || [] ).filter( l => opts.layerIds.includes( l.id ) ).reverse();
    for ( const l of chosen ) {
        onStep( `Copying the layer “${ l.name }”…` );
        let fc;
        try { fc = parseGeoJSON( await ( await st.getFile( l.file ) ).text() ).fc; }
        catch ( err ) { report.badLayers.push( `${ l.name } (${ err.name === 'NotFoundError' ? 'file missing' : err.message })` ); continue; }
        const name = alloc( l.file.split( '/' ).pop().replace( /\.(json|geojson)$/i, '' ) + '.geojson' );
        const text = JSON.stringify( kioskLayerData( fc, l ) );
        files.push( { name, data: text } );
        report.bytes += text.length;
        report.layers++;
        kioskLayers.push( {
            file: name,
            name: l.name,
            type: layerKind( fc ),
            enabled: true,
            cluster: S.cleanStyle( l.style ).cluster,
            featureCount: fc.features.length,
            shapeStyle: kioskShapeStyle( l.style ),
            createdAt: l.created,
            updatedAt: l.updated,
        } );
    }

    // Places, with their files, as the top layer.
    if ( opts.places && idx.entries.length ) {
        const byPath = new Map();
        const rows = [];
        const entries = [ ...idx.entries ].sort( ( a, b ) => a.created.localeCompare( b.created ) );
        let n = 0;
        for ( const e of entries ) {
            if ( ++n % 10 === 0 ) onStep( `Copying places… ${ n } of ${ entries.length }` );
            let fileName = '';
            if ( e.file && kioskTypeForFile( e.file, e.type ) ) {
                if ( byPath.has( e.file.path ) ) fileName = byPath.get( e.file.path );
                else {
                    try {
                        const f = await st.getFile( e.file.path );
                        fileName = alloc( e.file.path.split( '/' ).pop() );
                        files.push( { name: fileName, data: f, date: new Date( f.lastModified ) } );
                        byPath.set( e.file.path, fileName );
                        report.media++;
                        report.bytes += f.size;
                    } catch { report.missing.push( e.file.path ); }
                }
            }
            const { row, linkOnly, svSkipped } = placeRow( e, fileName, opts );
            rows.push( row );
            if ( linkOnly ) report.linkOnly++;
            if ( svSkipped ) report.svSkipped++;
        }
        const text = JSON.stringify( rows, null, 2 ) + '\n';
        files.push( { name: PLACES_FILE, data: text } );
        report.bytes += text.length;
        report.places = rows.length;
        const title = String( opts.placesName || '' ).trim() || ( idx.pack && idx.pack.title ) || 'Places';
        kioskLayers.push( {
            file: PLACES_FILE,
            name: clip( title, 200 ),
            type: 'point',
            enabled: true,
            cluster: settings.cluster !== false,
            featureCount: rows.length,
            shapeStyle: { ...KIOSK_SHAPE_DEFAULT },
            createdAt: entries[ 0 ] ? entries[ 0 ].created : new Date().toISOString(),
            updatedAt: idx.updated || new Date().toISOString(),
        } );
    }

    kioskLayers.forEach( ( l, i ) => { l.order = i; } );
    const doc = {
        backupFormatVersion: 1,
        exportedAt: new Date().toISOString(),
        generator: `${ GENERATOR } ${ ctx.appVersion || '' }`.trim(),
        kiosk: {
            idle_time_seconds: Math.min( 3600, Math.max( 5, Math.round( Number( opts.idle ) || DEFAULT_OPTIONS.idle ) ) ),
            lock_bounds_to_data: !! opts.lock,
        },
        layers: kioskLayers,
        exportedFiles: files.map( f => f.name ),
    };
    files.unshift( { name: KIOSK_SETTINGS, data: JSON.stringify( doc, null, 2 ) + '\n' } );
    return { files, report };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

async function writeFile( dir, name, data ) {
    const fh = await dir.getFileHandle( name, { create: true } );
    const w = await fh.createWritable();
    try { await w.write( data ); await w.close(); }
    catch ( err ) { try { await w.abort(); } catch {} throw err; }
}

/**
 * Ask for a folder: a folder called mediamap-kiosk-data is used as it is; anything else (for
 * example the USB drive itself) gets a mediamap-kiosk-data folder inside it. Must run from a click.
 */
async function pickKioskFolder() {
    const picked = await window.showDirectoryPicker( { id: 'mediamap-kiosk', mode: 'readwrite' } );
    const dir = picked.name === KIOSK_DIR ? picked : await picked.getDirectoryHandle( KIOSK_DIR, { create: true } );
    const names = [];
    for await ( const [ name, h ] of dir.entries() ) if ( h.kind === 'file' ) names.push( name );
    if ( names.includes( S.INDEX_FILE ) ) {
        throw new Error( `That folder holds a Media Map (it has ${ S.INDEX_FILE }). Choose your USB drive or an empty folder instead.` );
    }
    let previous = null;
    if ( names.includes( KIOSK_SETTINGS ) ) {
        try { previous = JSON.parse( await ( await ( await dir.getFileHandle( KIOSK_SETTINGS ) ).getFile() ).text() ); } catch {}
    }
    return { dir, label: picked.name === KIOSK_DIR ? picked.name : `${ picked.name }/${ KIOSK_DIR }`, names, previous };
}

/* ------------------------------------------------------------------ */
/* Settings sheet                                                      */
/* ------------------------------------------------------------------ */

/**
 * @param ctx { getStore, getIndex, getSettings, appVersion, toast, download, openSheet, backTo, isSmall, formatBytes, confirm }
 */
export function createKiosk( ctx ) {
    function loadOptions() {
        try { return { ...DEFAULT_OPTIONS, ...( JSON.parse( localStorage.getItem( OPTIONS_KEY ) || '{}' ) || {} ) }; }
        catch { return { ...DEFAULT_OPTIONS }; }
    }
    function saveOptions( o ) {
        try { localStorage.setItem( OPTIONS_KEY, JSON.stringify( { idle: o.idle, lock: o.lock, notes: o.notes, author: o.author, placesName: o.placesName } ) ); } catch {}
    }

    function show() {
        const idx = ctx.getIndex();
        const layers = idx.layers || [];
        const nPlaces = idx.entries.length;
        const o = loadOptions();
        const defaultTitle = ( idx.pack && idx.pack.title ) || 'Places';
        const body = ctx.openSheet( 'kiosk', 'Export for kiosk', `
            <p>Makes a <code>${ KIOSK_DIR }</code> folder for the MediaMap Kiosk app. Put it on a USB drive, then on the kiosk choose <strong>USB Drive → Select folder…</strong> and pick that folder.</p>
            <fieldset class="opts">
                <legend>What the kiosk shows</legend>
                <label class="check"><input type="checkbox" data-k-places ${ nPlaces ? 'checked' : 'disabled' }> Places (${ nPlaces }), with their photos, videos, audio and PDFs</label>
                <label class="lbl">Name of the places layer
                    <input type="text" class="field" data-k-pname maxlength="200" value="${ esc( o.placesName ) }" placeholder="${ esc( defaultTitle ) }">
                </label>
                ${ layers.length ? layers.map( l => `<label class="check"><input type="checkbox" data-k-layer="${ esc( l.id ) }" ${ l.visible ? 'checked' : '' }> Map layer: ${ esc( l.name ) } (${ plural( l.features, 'feature', 'features' ) })</label>` ).join( '' ) : '<p class="muted small">No map layers yet.</p>' }
            </fieldset>
            <fieldset class="opts">
                <legend>On each place</legend>
                <label class="check"><input type="checkbox" data-k-notes ${ o.notes ? 'checked' : '' }> Add the place’s notes to its description</label>
                <label class="check"><input type="checkbox" data-k-author ${ o.author ? 'checked' : '' }> Show who added it</label>
            </fieldset>
            <fieldset class="opts">
                <legend>Kiosk</legend>
                <label class="lbl">When nobody touches the screen, close the open place and show the whole map again after
                    <span class="inline"><input type="number" class="field field-short" data-k-idle min="5" max="3600" step="5" value="${ o.idle }"> seconds</span>
                </label>
                <label class="check"><input type="checkbox" data-k-lock ${ o.lock ? 'checked' : '' }> Keep visitors within the area of the data</label>
            </fieldset>
            <p class="muted small" data-k-summary></p>
            <p class="form-error" data-k-err hidden role="alert"></p>
            <div class="actions wrap">
                ${ S.supportsFolder ? '<button type="button" class="btn btn-primary" data-k-folder>Save to a USB drive or folder…</button>' : '' }
                <button type="button" class="btn ${ S.supportsFolder ? '' : 'btn-primary' }" data-k-zip>Download as .zip</button>
            </div>
            <p class="muted small" data-k-progress hidden aria-live="polite"></p>
            <div data-k-result></div>
            <p class="muted small">The kiosk uses its own background map, and shows each layer in one line and fill colour: colour by data, dashed lines, labels and the file’s own colours stay in Media Map. Forms and attached files aren’t included. Files are copied to the top of the folder, because the kiosk can’t open sub-folders.</p>
            ${ S.supportsFolder ? '' : '<p class="muted small">Unzip the file onto the USB drive so that the <code>' + KIOSK_DIR + '</code> folder is on it.</p>' }`, { backTo: ctx.backTo } );
        if ( ! body ) return;

        const read = () => ( {
            places: $( '[data-k-places]', body ).checked,
            placesName: $( '[data-k-pname]', body ).value.trim(),
            layerIds: $$( '[data-k-layer]', body ).filter( c => c.checked ).map( c => c.dataset.kLayer ),
            notes: $( '[data-k-notes]', body ).checked,
            author: $( '[data-k-author]', body ).checked,
            idle: Math.min( 3600, Math.max( 5, parseInt( $( '[data-k-idle]', body ).value, 10 ) || DEFAULT_OPTIONS.idle ) ),
            lock: $( '[data-k-lock]', body ).checked,
        } );

        const summary = () => {
            const opts = read();
            const ix = ctx.getIndex();
            const withFiles = opts.places ? ix.entries.filter( e => e.file && kioskTypeForFile( e.file, e.type ) ) : [];
            const size = new Set( withFiles.map( e => e.file.path ) ).size;
            const bytes = withFiles.reduce( ( s, e ) => s + ( e.file.size || 0 ), 0 );
            const parts = [];
            if ( opts.places ) parts.push( plural( ix.entries.length, 'place', 'places' ) + ( size ? ` with ${ plural( size, 'file', 'files' ) } (${ ctx.formatBytes( bytes ) })` : '' ) );
            if ( opts.layerIds.length ) parts.push( plural( opts.layerIds.length, 'map layer', 'map layers' ) );
            $( '[data-k-summary]', body ).textContent = parts.length ? `The kiosk will show ${ parts.join( ' and ' ) }.` : 'Choose what the kiosk should show.';
        };
        body.addEventListener( 'change', () => { summary(); saveOptions( read() ); } );
        summary();

        const err = $( '[data-k-err]', body );
        const progress = $( '[data-k-progress]', body );
        const buttons = $$( '[data-k-folder], [data-k-zip]', body );
        const busy = on => { buttons.forEach( b => { b.disabled = on; } ); progress.hidden = ! on; };
        const step = msg => { progress.textContent = msg; };

        const start = () => {
            const opts = read();
            err.hidden = true;
            $( '[data-k-result]', body ).innerHTML = '';
            if ( ! ( opts.places && ctx.getIndex().entries.length ) && ! opts.layerIds.length ) {
                err.textContent = 'Choose the places or at least one map layer.';
                err.hidden = false;
                return null;
            }
            saveOptions( opts );
            return opts;
        };

        const showResult = ( report, where ) => {
            const notes = [];
            if ( report.missing.length ) notes.push( `${ plural( report.missing.length, 'file was', 'files were' ) } missing from your data and left out: ${ esc( report.missing.slice( 0, 5 ).join( ', ' ) ) }${ report.missing.length > 5 ? '…' : '' }.` );
            if ( report.badLayers.length ) notes.push( `Not included: ${ esc( report.badLayers.join( '; ' ) ) }.` );
            if ( report.svSkipped ) notes.push( `${ plural( report.svSkipped, 'Street View link has', 'Street View links have' ) } only a location and no panorama, which the kiosk can’t show; ${ report.svSkipped === 1 ? 'it is' : 'they are' } shown as text. Copy the link again from Google Maps with the Street View open, or set a Maps Embed API key under Google Street View.` );
            if ( report.linkOnly ) notes.push( `${ plural( report.linkOnly, 'link', 'links' ) } can’t play on the kiosk and ${ report.linkOnly === 1 ? 'is' : 'are' } shown as text in the description.` );
            $( '[data-k-result]', body ).innerHTML = `
                <div class="kiosk-done">
                    <p><strong>Saved${ where ? ` in ${ esc( where ) }` : '' }.</strong> ${ [ report.places ? plural( report.places, 'place', 'places' ) : '', report.media ? plural( report.media, 'media file', 'media files' ) : '', report.layers ? plural( report.layers, 'map layer', 'map layers' ) : '' ].filter( Boolean ).join( ', ' ) }.</p>
                    ${ notes.map( n => `<p class="muted small">${ n }</p>` ).join( '' ) }
                </div>`;
        };

        $( '[data-k-folder]', body )?.addEventListener( 'click', async () => {
            const opts = start();
            if ( ! opts ) return;
            let target;
            try { target = await pickKioskFolder(); }
            catch ( e ) {
                if ( e.name !== 'AbortError' ) { err.textContent = e.message; err.hidden = false; }
                return;
            }
            busy( true );
            try {
                const { files, report } = await buildKioskData( ctx, opts, step );
                // Replacing an earlier export: only files that export listed may be removed.
                const ours = target.previous && Array.isArray( target.previous.exportedFiles ) && String( target.previous.generator || '' ).startsWith( GENERATOR )
                    ? target.previous.exportedFiles : [];
                const keep = new Set( files.map( f => f.name.toLowerCase() ) );
                const stale = ours.filter( n => typeof n === 'string' && target.names.includes( n ) && ! keep.has( n.toLowerCase() ) );
                const foreign = target.names.filter( n => ! keep.has( n.toLowerCase() ) && ! stale.includes( n ) && ! n.startsWith( '.' ) );
                if ( target.previous && ! ours.length && ! ctx.confirm( `“${ target.label }” already has kiosk data that wasn’t made by Media Map. Replace its settings.json? Its other files stay, but the kiosk will only show what you export now.` ) ) {
                    busy( false );
                    return;
                }
                let i = 0;
                for ( const f of files ) {
                    step( `Writing ${ ++i } of ${ files.length }: ${ f.name }` );
                    // settings.json last, so a kiosk never reads a list of files that aren't there yet.
                    if ( f.name === KIOSK_SETTINGS ) continue;
                    await writeFile( target.dir, f.name, f.data );
                }
                await writeFile( target.dir, KIOSK_SETTINGS, files.find( f => f.name === KIOSK_SETTINGS ).data );
                for ( const n of stale ) { try { await target.dir.removeEntry( n ); } catch {} }
                busy( false );
                showResult( report, target.label );
                if ( foreign.length ) {
                    $( '[data-k-result] .kiosk-done', body ).insertAdjacentHTML( 'beforeend', `<p class="muted small">The folder also has ${ plural( foreign.length, 'other file', 'other files' ) } that Media Map didn’t write; ${ foreign.length === 1 ? 'it was' : 'they were' } left as ${ foreign.length === 1 ? 'it is' : 'they are' }.</p>` );
                }
                ctx.toast( `Kiosk data saved in ${ target.label }.` );
            } catch ( e ) {
                busy( false );
                err.textContent = 'Could not save the kiosk data: ' + e.message;
                err.hidden = false;
            }
        } );

        $( '[data-k-zip]', body ).addEventListener( 'click', async () => {
            const opts = start();
            if ( ! opts ) return;
            busy( true );
            try {
                const { files, report } = await buildKioskData( ctx, opts, step );
                const zip = await makeZip( files.map( f => ( { ...f, name: `${ KIOSK_DIR }/${ f.name }` } ) ), ( d, t ) => step( `Packing… ${ Math.round( d / t * 100 ) }%` ) );
                const name = `${ KIOSK_DIR }-${ new Date().toISOString().slice( 0, 10 ) }.zip`;
                const file = new File( [ zip ], name, { type: 'application/zip' } );
                busy( false );
                let shared = false;
                if ( ctx.isSmall() && navigator.canShare && navigator.canShare( { files: [ file ] } ) ) {
                    try { await navigator.share( { files: [ file ], title: 'Kiosk data' } ); shared = true; }
                    catch ( e ) { if ( e.name === 'AbortError' ) return; }
                }
                if ( ! shared ) ctx.download( file, name );
                showResult( report, name );
                ctx.toast( `Kiosk data saved as ${ name } (${ ctx.formatBytes( zip.size ) }). Unzip it onto the USB drive.`, { long: true } );
            } catch ( e ) {
                busy( false );
                err.textContent = 'Could not create the kiosk data: ' + e.message;
                err.hidden = false;
            }
        } );
    }

    return { show };
}

/** True for a settings.json written for the kiosk (by Media Map or the kiosk's WordPress plugin). */
export function isKioskSettings( data ) {
    return !! ( data && typeof data === 'object' && Array.isArray( data.layers ) && ( data.kiosk || data.backupFormatVersion ) && ! data.format );
}
