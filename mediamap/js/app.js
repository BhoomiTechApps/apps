/**
 * Media Map — standalone, device-only PWA.
 * No account, no server: entries are kept in mediamap.json inside a folder
 * on the device, with local media files in its media/ sub-folder and the
 * folder's own settings (basemap etc.) in settings.json.
 */
import * as S from './store.js';
import { makeZip, readZip } from './zip.js';
import * as M from './media.js';
import { parseCoords } from './coords.js';
import * as PDF from './pdf.js';
import { createLayers } from './layers.js';
import { createForms } from './forms.js';
import { createReports } from './reports.js';
import { createOffline } from './offline.js';
import { makeZip as makeZipFile } from './zip.js';
import { createBasemap, normalizeBasemap, templateRegexSource } from './basemap.js';

const APP_VERSION = '1.5.0';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const $  = ( sel, root = document ) => root.querySelector( sel );
const $$ = ( sel, root = document ) => [ ...root.querySelectorAll( sel ) ];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String( s ?? '' ).replace( /[&<>"']/g, c => ESC[ c ] );
const sleep = ms => new Promise( r => setTimeout( r, ms ) );
const debounce = ( fn, ms ) => { let t; return ( ...a ) => { clearTimeout( t ); t = setTimeout( () => fn( ...a ), ms ); }; };
const fmtDate = iso => { try { return new Date( iso ).toLocaleDateString( undefined, { day: 'numeric', month: 'long', year: 'numeric' } ); } catch { return ''; } };
const fmtCoord = n => Number( n ).toFixed( 5 );
const plural = ( n, one, many ) => `${ n } ${ n === 1 ? one : many }`;
const isSmall = () => window.matchMedia( '(max-width: 719px)' ).matches;

const TYPES = {
    image: { label: 'Photo', color: '#1F6F8B', glyph: 'M9 4 7.2 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z' },
    video: { label: 'Video', color: '#A23B5B', glyph: 'M8 5v14l11-7z' },
    audio: { label: 'Audio', color: '#3E7D4F', glyph: 'M12 3v10.6A4 4 0 1 0 14 17V7h4V3z' },
    document: { label: 'Document', color: '#7A5230', glyph: 'M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5zM8 13h8v2H8zm0 4h8v2H8z' },
    text:  { label: 'Note',  color: '#6B5B95', glyph: 'M4 5h16v2H4zm0 4h16v2H4zm0 4h10v2H4z' },
};

const DEFAULTS = {
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    cluster: true,
    shrinkPhotos: true,
    author: '',
    maxTiles: 3000,
};
/*
 * Settings come from two places:
 *  - settings.json in the data folder: the basemap, pin grouping, photo
 *    shrinking and the last map view (S.FOLDER_SETTING_KEYS). Each folder
 *    keeps its own, so every map opens with the background it was made with.
 *  - this device (localStorage): your name and the offline tile limit.
 * localStorage also keeps the last-used folder settings, which a folder
 * without a settings.json (new, or made by an older version) starts from.
 */
let settings = loadSettings();
function loadSettings() {
    let s = {};
    try { s = JSON.parse( localStorage.getItem( 'mediamap_settings' ) || '{}' ) || {}; } catch {}
    if ( ! s.view ) { try { s.view = JSON.parse( localStorage.getItem( 'mediamap_view' ) || 'null' ); } catch {} }
    return { ...DEFAULTS, view: null, ...s };
}
function rememberOnDevice() {
    try { localStorage.setItem( 'mediamap_settings', JSON.stringify( settings ) ); } catch {}
    S.kvSet( 'maxTiles', settings.maxTiles ).catch( () => {} );
    shareTilePattern();
}
/**
 * Save settings. `keys` are the ones that changed; any that belong to the
 * folder are also written to its settings.json.
 */
function saveSettings( ...keys ) {
    rememberOnDevice();
    if ( keys.some( k => S.FOLDER_SETTING_KEYS.includes( k ) ) ) {
        writeFolderSettings( keys ).catch( err => toast( `Could not save ${ S.SETTINGS_FILE }: ${ err.message }`, { long: true } ) );
    }
}

let folderSettingsChain = Promise.resolve();
/**
 * Write settings.json. If the file was changed outside this window (another
 * tab, or edited by hand) since we read it, its values are kept for every
 * setting except the ones this save is about.
 */
function writeFolderSettings( keys = S.FOLDER_SETTING_KEYS, quiet = false ) {
    const run = async () => {
        const st = state.store;
        if ( ! st ) return;
        if ( await st.settingsChangedOnDisk() ) {
            const { settings: disk } = await st.readSettings();
            if ( disk ) {
                const keep = {};
                for ( const k of S.FOLDER_SETTING_KEYS ) if ( ! keys.includes( k ) && k in disk ) keep[ k ] = disk[ k ];
                applyFolderSettings( keep );
            }
        }
        await st.saveSettings( settings );
        if ( ! quiet ) channel && channel.postMessage( { type: 'changed' } );
    };
    const p = folderSettingsChain.then( run );
    folderSettingsChain = p.catch( () => {} );
    return p;
}

/**
 * Use settings read from a folder's settings.json: update the in-memory
 * settings and redraw whatever changed. With `moveMap`, also go to the
 * folder's saved view.
 */
function applyFolderSettings( incoming, { moveMap = false } = {} ) {
    const prev = { ...settings };
    for ( const k of S.FOLDER_SETTING_KEYS ) if ( k in incoming ) settings[ k ] = incoming[ k ];
    settings.tileUrl = normalizeBasemap( settings.tileUrl ) || DEFAULTS.tileUrl;
    rememberOnDevice();
    if ( state.map ) {
        const tilesChanged = prev.tileUrl !== settings.tileUrl || prev.attribution !== settings.attribution || prev.maxZoom !== settings.maxZoom;
        if ( prev.maxZoom !== settings.maxZoom ) state.map.setMaxZoom( settings.maxZoom );
        if ( tilesChanged ) setTiles();
        if ( prev.cluster !== settings.cluster ) buildLayer();
        if ( moveMap && settings.view ) {
            const v = settings.view, z = Math.min( v.zoom, settings.maxZoom );
            state.savedViewKey = `${ v.lat.toFixed( 5 ) },${ v.lng.toFixed( 5 ) },${ z }`;
            state.map.setView( [ v.lat, v.lng ], z, { animate: false } );
            state.fittedOnce = true;
        }
    }
    return prev;
}

/** Open the settings of a newly opened folder, creating settings.json if it has none. */
async function loadFolderSettings( store ) {
    const { settings: saved, warning } = await store.readSettings();
    if ( saved ) {
        applyFolderSettings( saved, { moveMap: true } );
    } else if ( ! warning ) {
        // New folder, or one from before 1.5: give it the settings in use now.
        if ( state.map ) {
            const c = state.map.getCenter();
            if ( state.fittedOnce ) settings.view = { lat: c.lat, lng: c.lng, zoom: state.map.getZoom() };
        }
        try { await writeFolderSettings( S.FOLDER_SETTING_KEYS, true ); } catch {}
    }
    return warning;
}
/** Tell the service worker which URLs are basemap tiles, so any basemap works offline. */
function shareTilePattern() {
    const re = templateRegexSource( settings.tileUrl );
    S.kvSet( 'tileRe', re ).catch( () => {} );
    try { navigator.serviceWorker?.controller?.postMessage( { type: 'tileRe', re } ); } catch {}
}

const state = {
    store: null,
    index: S.emptyIndex(),
    byId: new Map(),
    markers: new Map(),
    map: null,
    layer: null,
    tiles: null,
    selectedId: null,
    form: null,          // active form state while adding/editing
    draftMarker: null,
    locateLayer: null,
    installEvt: null,
    swReg: null,
    blobUrls: [],
    fittedOnce: false,
};
const channel = 'BroadcastChannel' in window ? new BroadcastChannel( 'mediamap' ) : null;

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */
const toastEl = $( '#toast' );
let toastTimer = 0;
function toast( msg, { action, onAction, sticky = false, long = false } = {} ) {
    clearTimeout( toastTimer );
    toastEl.innerHTML = `<span>${ esc( msg ) }</span>`;
    if ( action ) {
        const b = document.createElement( 'button' );
        b.type = 'button';
        b.className = 'toast-action';
        b.textContent = action;
        b.addEventListener( 'click', () => { hideToast(); onAction && onAction(); } );
        toastEl.append( b );
    }
    toastEl.hidden = false;
    if ( ! sticky ) toastTimer = setTimeout( hideToast, long ? 9000 : 3800 );
}
function hideToast() { toastEl.hidden = true; }

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */
const iconCache = new Map();
function pinSvg( type, selected ) {
    const t = TYPES[ type ] || TYPES.text;
    const stroke = selected ? '#D19A2E' : '#ffffff';
    return `<svg viewBox="0 0 30 40" width="30" height="40" aria-hidden="true"><path d="M15 1.5C7.5 1.5 1.5 7.4 1.5 14.9 1.5 25 15 38.5 15 38.5S28.5 25 28.5 14.9C28.5 7.4 22.5 1.5 15 1.5z" fill="${ t.color }" stroke="${ stroke }" stroke-width="${ selected ? 3 : 2 }"/><g transform="translate(7 7) scale(.667)" fill="#fff"><path d="${ t.glyph }"/></g></svg>`;
}
function iconFor( type, selected = false ) {
    const key = type + ( selected ? ':sel' : '' );
    if ( ! iconCache.has( key ) ) {
        iconCache.set( key, L.divIcon( {
            className: 'pin' + ( selected ? ' pin-selected' : '' ),
            html: pinSvg( type, selected ),
            iconSize: [ 30, 40 ], iconAnchor: [ 15, 39 ],
        } ) );
    }
    return iconCache.get( key );
}
const draftIcon = L.divIcon( {
    className: 'pin pin-draft',
    html: '<svg viewBox="0 0 30 40" width="34" height="45" aria-hidden="true"><path d="M15 1.5C7.5 1.5 1.5 7.4 1.5 14.9 1.5 25 15 38.5 15 38.5S28.5 25 28.5 14.9C28.5 7.4 22.5 1.5 15 1.5z" fill="#D19A2E" stroke="#1B2A3A" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#1B2A3A"/></svg>',
    iconSize: [ 34, 45 ], iconAnchor: [ 17, 44 ],
} );

function initMap() {
    const view = settings.view;
    const map = L.map( 'map', {
        center: view ? [ view.lat, view.lng ] : [ 20, 0 ],
        zoom: view ? view.zoom : 2,
        worldCopyJump: true,
        zoomControl: false,
    } );
    L.control.zoom( { position: 'topleft' } ).addTo( map );
    state.map = map;
    state.fittedOnce = !! view;
    setTiles();
    buildLayer();
    state.layers = createLayers( {
        map,
        getStore: () => state.store,
        getIndex: () => state.index,
        mutate,
        toast,
        openSheet: ( view, title, html, opts ) => {
            if ( ! confirmLeave() ) return null;
            const body = openSheet( view, title, html, opts );
            selectMarker( null );
            return body;
        },
        sheetView: () => sheet.view,
        isPicking: () => !! state.form,
        coveredBy: () => {
            const [ x, y ] = sheetOffset();
            return [ x * 2 + ( x ? 12 : 0 ), y * 2 ];
        },
        confirm: msg => confirm( msg ),
    } );

    // The view is kept on the device straight away, and in the folder's
    // settings.json once the map has settled, so a synced folder isn't
    // rewritten on every pan.
    const saveViewToFolder = debounce( () => {
        if ( ! state.store || ! settings.view ) return;
        const v = settings.view, key = `${ v.lat.toFixed( 5 ) },${ v.lng.toFixed( 5 ) },${ v.zoom }`;
        if ( key === state.savedViewKey ) return;
        state.savedViewKey = key;
        writeFolderSettings( [ 'view' ], true ).catch( () => {} );
    }, 2500 );
    map.on( 'moveend', debounce( () => {
        const c = map.getCenter();
        settings.view = { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
        try { localStorage.setItem( 'mediamap_view', JSON.stringify( settings.view ) ); } catch {}
        rememberOnDevice();
        saveViewToFolder();
    }, 400 ) );
    map.on( 'click', e => { if ( state.form ) setFormLocation( e.latlng.lat, e.latlng.lng, 'map' ); } );
}

function setTiles() {
    if ( state.tiles ) state.map.removeLayer( state.tiles );
    state.tiles = makeTiles( true ).addTo( state.map );
}
/**
 * Tiles are requested with CORS so the service worker can keep them for
 * offline use. A tile server that doesn't send CORS headers would fail
 * that way, so fall back to a plain layer if nothing loads at all.
 */
function makeTiles( cors ) {
    const t = createBasemap( settings.tileUrl, {
        maxZoom: settings.maxZoom,
        attribution: settings.attribution,
        crossOrigin: cors ? 'anonymous' : undefined,
    } );
    let ok = 0, bad = 0;
    t.on( 'tileload', () => { ok++; } );
    t.on( 'tileerror', () => {
        if ( cors && navigator.onLine && ++bad >= 4 && ok === 0 && state.tiles === t ) {
            state.map.removeLayer( t );
            state.tiles = makeTiles( false ).addTo( state.map );
        }
    } );
    return t;
}

function buildLayer() {
    if ( state.layer ) state.map.removeLayer( state.layer );
    state.layer = settings.cluster
        ? L.markerClusterGroup( { showCoverageOnHover: false, maxClusterRadius: 48, chunkedLoading: true } )
        : L.featureGroup();
    state.layer.on( 'click', e => {
        const m = e.propagatedFrom || e.layer;
        if ( m && m.options.entryId ) showEntry( m.options.entryId );
    } );
    state.layer.addTo( state.map );
    renderMarkers();
}

function renderMarkers() {
    if ( ! state.layer ) return;
    state.layer.clearLayers();
    state.markers.clear();
    const list = [];
    for ( const e of state.index.entries ) {
        const m = L.marker( [ e.lat, e.lng ], {
            icon: iconFor( e.type, e.id === state.selectedId ),
            entryId: e.id,
            title: e.place || TYPES[ e.type ].label,
            alt: e.place || TYPES[ e.type ].label,
            keyboard: true,
        } );
        state.markers.set( e.id, m );
        list.push( m );
    }
    if ( state.layer.addLayers ) state.layer.addLayers( list ); else list.forEach( m => state.layer.addLayer( m ) );
}

function selectMarker( id ) {
    const prev = state.selectedId && state.markers.get( state.selectedId );
    const prevEntry = state.selectedId && state.byId.get( state.selectedId );
    if ( prev && prevEntry ) prev.setIcon( iconFor( prevEntry.type, false ) );
    state.selectedId = id;
    const m = id && state.markers.get( id );
    const e = id && state.byId.get( id );
    if ( m && e ) { m.setIcon( iconFor( e.type, true ) ); m.setZIndexOffset( 500 ); }
}

/** Part of the map hidden by the sheet, so focus points stay visible. */
function sheetOffset() {
    const sh = $( '#sheet' );
    if ( sh.hidden ) return [ 0, 0 ];
    return isSmall() ? [ 0, sh.offsetHeight / 2 ] : [ sh.offsetWidth / 2, 0 ];
}
function focusOn( lat, lng, zoom ) {
    const map = state.map;
    const z = zoom ?? map.getZoom();
    const [ ox, oy ] = sheetOffset();
    const p = map.project( [ lat, lng ], z ).add( [ ox, oy ] );
    map.flyTo( map.unproject( p, z ), z, { duration: 0.6 } );
}
function ensureVisible( lat, lng ) {
    const map = state.map;
    const pt = map.latLngToContainerPoint( [ lat, lng ] );
    const size = map.getSize();
    const sh = $( '#sheet' );
    let r = { x: 40, y: 40, w: size.x - 80, h: size.y - 80 };
    if ( ! sh.hidden ) {
        if ( isSmall() ) r.h = size.y - sh.offsetHeight - 60;
        else r.w = size.x - sh.offsetWidth - 80;
    }
    if ( pt.x < r.x || pt.y < r.y || pt.x > r.x + r.w || pt.y > r.y + r.h ) focusOn( lat, lng );
}

function fitAll() {
    const pts = state.index.entries.map( e => [ e.lat, e.lng ] );
    if ( ! pts.length ) return;
    if ( pts.length === 1 ) state.map.setView( pts[ 0 ], 14 );
    else state.map.fitBounds( pts, { padding: [ 40, 40 ], maxZoom: 15 } );
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */
function setIndex( index ) {
    state.index = index;
    state.byId = new Map( index.entries.map( e => [ e.id, e ] ) );
    if ( state.selectedId && ! state.byId.has( state.selectedId ) ) state.selectedId = null;
    renderMarkers();
    if ( sheet.view === 'list' ) renderListResults();
    if ( state.layers ) state.layers.sync();
}

async function useStore( store ) {
    const { index, warning } = await store.readIndex();
    if ( state.layers && state.store && state.store !== store ) state.layers.reset();
    state.store = store;
    const settingsWarning = await loadFolderSettings( store );
    setIndex( index );
    updateWhere();
    hideWelcome();
    if ( warning || settingsWarning ) toast( [ warning, settingsWarning ].filter( Boolean ).join( ' ' ), { long: true } );
    if ( ! state.fittedOnce ) { fitAll(); state.fittedOnce = true; }
    handleShareTarget();
}

let mutateChain = Promise.resolve();
/**
 * Apply a change to the index and save it. If the file was changed on disk
 * (another tab, or someone editing the folder), reload it first so those
 * changes aren't overwritten.
 */
function mutate( fn ) {
    const run = async () => {
        const st = state.store;
        if ( await st.changedOnDisk() ) {
            const { index } = await st.readIndex();
            state.index = index;
        }
        fn( state.index );
        await st.saveIndex( state.index );
        setIndex( state.index );
        channel && channel.postMessage( { type: 'changed' } );
    };
    const p = mutateChain.then( run );
    mutateChain = p.catch( () => {} );
    return p;
}

async function reloadFromDisk( message ) {
    if ( ! state.store || state.form ) return;
    try {
        const st = state.store;
        const msgs = [];
        let changed = false;
        if ( await st.settingsChangedOnDisk() ) {
            // Settings changed elsewhere: take them, but don't move the map under the person.
            await folderSettingsChain;
            const { settings: disk, warning } = await st.readSettings();
            if ( disk ) {
                const { view, ...rest } = disk;
                applyFolderSettings( rest );
                changed = true;
            }
            if ( warning ) msgs.push( warning );
        }
        if ( await st.changedOnDisk() ) {
            const { index, warning } = await st.readIndex();
            setIndex( index );
            if ( sheet.view === 'entry' && ! state.byId.has( sheet.entryId ) ) closeSheet();
            changed = true;
            if ( warning ) msgs.push( warning );
        }
        if ( ! changed && ! msgs.length ) return;
        const typing = sheet.el.contains( document.activeElement ) && document.activeElement.matches( 'input:not([type=checkbox]), textarea, select' );
        if ( changed && sheet.view === 'settings' && ! typing ) showSettings();
        toast( msgs.join( ' ' ) || message, { long: !! msgs.length } );
    } catch ( err ) {
        toast( err.message, { long: true } );
    }
}

/** Every file the index refers to: media files and layer files. */
function dataFiles( index = state.index ) {
    const paths = new Set();
    for ( const e of index.entries ) {
        if ( e.file ) paths.add( e.file.path );
        for ( const a of e.attachments ) paths.add( a.path );
    }
    for ( const l of index.layers || [] ) paths.add( l.file );
    for ( const f of index.forms || [] ) paths.add( f.file );
    return [ ...paths ];
}

/** Is `path` used by any place (other than `exceptId`), as its file or an attachment? */
function isFileUsed( path, exceptId ) {
    return state.index.entries.some( e => e.id !== exceptId && ( ( e.file && e.file.path === path ) || e.attachments.some( a => a.path === path ) ) );
}

/* ------------------------------------------------------------------ */
/* Sheet                                                               */
/* ------------------------------------------------------------------ */
const sheet = {
    el: $( '#sheet' ), title: $( '#sheet-title' ), body: $( '#sheet-body' ),
    back: $( '#sheet-back' ), view: null, entryId: null, onLeave: null, backTo: null,
};
function openSheet( view, title, html, { onLeave = null, backTo = null } = {} ) {
    leaveSheet();
    sheet.view = view;
    sheet.onLeave = onLeave;
    sheet.backTo = backTo;
    sheet.title.textContent = title;
    sheet.body.innerHTML = html;
    sheet.body.scrollTop = 0;
    sheet.back.hidden = ! backTo;
    sheet.el.hidden = false;
    sheet.el.dataset.view = view;
    document.body.classList.add( 'sheet-open' );
    return sheet.body;
}
function leaveSheet() {
    for ( const u of state.blobUrls ) URL.revokeObjectURL( u );
    state.blobUrls = [];
    if ( sheet.onLeave ) { const f = sheet.onLeave; sheet.onLeave = null; f(); }
}
/**
 * Ask before throwing away unsaved work (an open add/edit form, or a note
 * being typed). Returns false if the person wants to stay.
 */
function confirmLeave() {
    if ( state.form && state.form.dirty && ! confirm( state.form.id ? 'Discard your changes?' : 'Discard this place?' ) ) return false;
    const draft = sheet.el.hidden ? '' : ( sheet.body.querySelector( '[data-note-new]' ) || {} ).value;
    if ( draft && draft.trim() && ! confirm( 'Discard the note you’re writing?' ) ) return false;
    const editing = ! sheet.el.hidden && sheet.body.querySelector( '.log-edit textarea' );
    if ( editing && ! confirm( 'Discard your changes to this note?' ) ) return false;
    if ( state.form ) state.form.dirty = false;
    const nd = sheet.body.querySelector( '[data-note-new]' );
    if ( nd ) nd.value = '';
    return true;
}

function closeSheet() {
    if ( ! confirmLeave() ) return false;
    leaveSheet();
    sheet.el.hidden = true;
    sheet.view = null;
    sheet.entryId = null;
    document.body.classList.remove( 'sheet-open' );
    selectMarker( null );
    return true;
}
$( '#sheet-close' ).addEventListener( 'click', closeSheet );
sheet.back.addEventListener( 'click', () => {
    if ( ! confirmLeave() ) return;
    sheet.backTo && sheet.backTo();
} );

/* ------------------------------------------------------------------ */
/* Entry details                                                       */
/* ------------------------------------------------------------------ */
function showEntry( id, { fly = false, backTo = null } = {} ) {
    const e = state.byId.get( id );
    if ( ! e ) return;
    if ( ! confirmLeave() ) return;
    const t = TYPES[ e.type ] || TYPES.text;
    const host = e.url ? M.hostOf( e.url ) : '';
    const body = openSheet( 'entry', e.place || 'Untitled place', `
        <div class="entry-media" data-media></div>
        <p class="entry-meta"><span class="type-dot" style="--c:${ t.color }"></span>${ esc( t.label ) }, added ${ esc( fmtDate( e.created ) ) }${ e.author ? ` by ${ esc( e.author ) }` : '' }</p>
        ${ e.description ? `<p class="entry-desc">${ esc( e.description ) }</p>` : '' }
        ${ e.url ? `<a class="link-card" href="${ esc( e.url ) }" target="_blank" rel="noopener noreferrer">
            <span class="link-host">${ esc( host ) }</span>
            <span class="link-url">${ esc( e.url ) }</span></a>` : '' }
        <p class="entry-coords">
            <a href="https://www.openstreetmap.org/?mlat=${ e.lat }&amp;mlon=${ e.lng }#map=16/${ e.lat }/${ e.lng }" target="_blank" rel="noopener noreferrer">${ fmtCoord( e.lat ) }, ${ fmtCoord( e.lng ) }</a>
            <button type="button" class="btn-link" data-copy-coords>Copy</button>
        </p>
        <div class="actions">
            <button type="button" class="btn btn-primary" data-edit>Edit</button>
            <button type="button" class="btn btn-danger" data-delete>Delete</button>
        </div>
        <section class="attach" aria-labelledby="att-title">
            <h3 id="att-title">Forms and attachments <span class="muted" data-att-count></span></h3>
            <ul class="att-list" data-att></ul>
            <div class="actions wrap" data-att-actions></div>
        </section>
        <section class="log" aria-labelledby="log-title">
            <h3 id="log-title">Notes <span class="muted" data-log-count></span></h3>
            <ol class="log-list" data-log></ol>
            <form class="log-add" data-log-add>
                <label class="visually-hidden" for="note-new">Add a note</label>
                <textarea class="field" id="note-new" data-note-new rows="3" placeholder="Add a note: an observation, a visit, a to-do…"></textarea>
                <div class="actions"><button type="submit" class="btn">Add note</button></div>
            </form>
        </section>`, { backTo, onLeave: () => { sheet.entryId = null; } } );
    sheet.entryId = id;
    selectMarker( id );
    renderMedia( $( '[data-media]', body ), e );
    renderNotes( id );
    renderAttachments( id );
    $( '[data-log-add]', body ).addEventListener( 'submit', ev => { ev.preventDefault(); addNote( id ); } );
    $( '[data-note-new]', body ).addEventListener( 'keydown', ev => {
        if ( ev.key === 'Enter' && ( ev.ctrlKey || ev.metaKey ) ) { ev.preventDefault(); addNote( id ); }
    } );
    $( '[data-copy-coords]', body ).addEventListener( 'click', async () => {
        try { await navigator.clipboard.writeText( `${ fmtCoord( e.lat ) }, ${ fmtCoord( e.lng ) }` ); toast( 'Coordinates copied.' ); }
        catch { toast( `${ fmtCoord( e.lat ) }, ${ fmtCoord( e.lng ) }` ); }
    } );
    $( '[data-edit]', body ).addEventListener( 'click', () => showForm( e ) );
    $( '[data-delete]', body ).addEventListener( 'click', () => deleteEntry( e ) );

    if ( fly ) {
        focusOn( e.lat, e.lng, Math.max( state.map.getZoom(), 15 ) );
    } else {
        requestAnimationFrame( () => ensureVisible( e.lat, e.lng ) );
    }
}

async function renderMedia( box, e ) {
    if ( e.file ) {
        let file;
        try { file = await state.store.getFile( e.file.path ); }
        catch {
            box.innerHTML = `<p class="notice">The file <code>${ esc( e.file.path ) }</code> isn't in the data folder any more.</p>`;
            return;
        }
        if ( sheet.entryId !== e.id ) return;
        const url = URL.createObjectURL( file );
        state.blobUrls.push( url );
        const kind = M.typeFromFile( file.type || e.file.mime, e.file.name );
        if ( kind === 'image' ) {
            box.innerHTML = `<button type="button" class="media-img" aria-label="View photo full screen"><img src="${ url }" alt="${ esc( e.place || 'Photo' ) }"></button>`;
            const img = $( 'img', box );
            img.addEventListener( 'error', () => {
                box.innerHTML = `<p class="notice">This browser can't display ${ esc( e.file.name ) }. <a href="${ url }" download="${ esc( e.file.name ) }">Download it</a></p>`;
            } );
            $( 'button', box ).addEventListener( 'click', () => openLightbox( url, e.place ) );
        } else if ( kind === 'video' ) {
            box.innerHTML = `<video controls playsinline preload="metadata" src="${ url }"></video>`;
        } else if ( kind === 'audio' ) {
            box.innerHTML = `<audio controls preload="metadata" src="${ url }"></audio>`;
        } else if ( kind === 'document' && M.isPdf( file.type || e.file.mime, e.file.name ) ) {
            renderPdf( box, e, file, url );
        } else {
            box.innerHTML = `<a class="btn" href="${ url }" download="${ esc( e.file.name ) }">Download ${ esc( e.file.name ) }</a>`;
        }
        return;
    }
    if ( ! e.url ) { box.remove(); return; }
    const emb = M.embedFor( e.url );
    if ( ! emb ) { box.remove(); return; }
    if ( ! navigator.onLine ) {
        box.innerHTML = `<p class="notice">Connect to the internet to ${ emb.kind === 'pdf' ? 'view this document' : 'play this link' }.</p>`;
        return;
    }
    if ( emb.kind === 'pdf' ) {
        // Works when the website allows other apps to read the file (CORS); otherwise the link card is enough.
        box.classList.add( 'is-doc' );
        box.innerHTML = '<p class="pdf-status">Loading preview…</p>';
        const open = () => PDF.openViewer( emb.src, { title: e.place || 'Document', onError: () => window.open( emb.src, '_blank', 'noopener' ) } );
        try {
            const pages = await PDF.renderPreview( box, emb.src, { onOpen: open } );
            if ( sheet.entryId !== e.id ) return;
            box.insertAdjacentHTML( 'beforeend', `<div class="doc-bar"><span>${ plural( pages, 'page', 'pages' ) }</span><button type="button" class="btn" data-open-doc>Open document</button></div>` );
            $( '[data-open-doc]', box ).addEventListener( 'click', open );
        } catch {
            box.remove();
        }
        return;
    }
    if ( emb.kind === 'iframe' ) {
        const style = emb.ratio ? `aspect-ratio:${ emb.ratio }` : `height:${ emb.height }px`;
        box.innerHTML = `<iframe src="${ esc( emb.src ) }" style="${ style }" loading="lazy" title="${ esc( e.place || 'Embedded media' ) }"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    } else if ( emb.kind === 'image' ) {
        box.innerHTML = `<button type="button" class="media-img" aria-label="View photo full screen"><img src="${ esc( emb.src ) }" alt="${ esc( e.place || 'Photo' ) }" referrerpolicy="no-referrer"></button>`;
        $( 'img', box ).addEventListener( 'error', () => box.remove() );
        $( 'button', box ).addEventListener( 'click', () => openLightbox( emb.src, e.place ) );
    } else {
        box.innerHTML = `<${ emb.kind } controls playsinline preload="metadata" src="${ esc( emb.src ) }"></${ emb.kind }>`;
    }
}

async function renderPdf( box, e, file, url ) {
    box.classList.add( 'is-doc' );
    box.innerHTML = '<p class="pdf-status">Loading preview…</p>';
    const title = e.place || e.file.name;
    const open = () => PDF.openViewer( file, {
        title, downloadName: e.file.name,
        onError: err => toast( `This PDF can’t be shown here (${ err.message }). Use Download to open it in another app.`, { long: true } ),
    } );
    const bar = pages => `<div class="doc-bar">
        <span>${ pages ? plural( pages, 'page', 'pages' ) + ', ' : '' }${ M.formatBytes( file.size ) }</span>
        ${ pages ? '<button type="button" class="btn btn-primary" data-open-doc>Open document</button>' : '' }
        <a class="btn" href="${ url }" download="${ esc( e.file.name ) }">Download</a></div>`;
    try {
        const pages = await PDF.renderPreview( box, file, { onOpen: open } );
        if ( sheet.entryId !== e.id ) return;
        box.insertAdjacentHTML( 'beforeend', bar( pages ) );
        $( '[data-open-doc]', box ).addEventListener( 'click', open );
    } catch ( err ) {
        if ( sheet.entryId !== e.id ) return;
        const why = err && err.name === 'PasswordException' ? 'it is password protected' : 'it couldn’t be read';
        box.innerHTML = `<p class="notice">No preview: ${ why }.</p>` + bar( 0 );
    }
}

async function deleteEntry( e ) {
    const nFiles = ( e.file ? 1 : 0 ) + e.attachments.length;
    if ( ! confirm( `Delete “${ e.place || 'this place' }”?${ nFiles ? ` Its ${ nFiles === 1 ? 'file' : nFiles + ' files' } will be removed from the data folder.` : '' }` ) ) return;
    try {
        await mutate( ix => { ix.entries = ix.entries.filter( x => x.id !== e.id ); } );
        for ( const path of [ e.file && e.file.path, ...e.attachments.map( a => a.path ) ].filter( Boolean ) ) {
            if ( ! isFileUsed( path ) ) await state.store.remove( path ).catch( () => {} );
        }
        closeSheet();
        toast( 'Place deleted.' );
    } catch ( err ) {
        toast( 'Could not delete: ' + err.message, { long: true } );
    }
}

/* ------------------------------------------------------------------ */
/* Attachments: form responses and other files on a place              */
/* ------------------------------------------------------------------ */
const DOC_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5zM8 13h8v2H8zm0 4h8v2H8z"/></svg>';

function renderAttachments( id ) {
    const e = state.byId.get( id );
    const ul = sheet.entryId === id && $( '[data-att]', sheet.body );
    if ( ! e || ! ul ) return;
    $( '[data-att-count]', sheet.body ).textContent = e.attachments.length ? `(${ e.attachments.length })` : '';
    ul.innerHTML = e.attachments.length ? e.attachments.slice().reverse().map( a => `
        <li data-att-id="${ esc( a.id ) }">
            <span class="att-icon">${ DOC_ICON }</span>
            <button type="button" class="att-main" data-att-open>
                <span class="att-name">${ esc( a.name ) }</span>
                <span class="att-sub">${ a.form ? `Form “${ esc( a.form.name ) }”, ` : '' }${ esc( fmtDateTime( a.created ) ) }, ${ M.formatBytes( a.size ) }</span>
            </button>
            <span class="att-btns">
                <button type="button" class="btn-link" data-att-dl>Download</button>
                <button type="button" class="btn-link danger" data-att-del>Delete</button>
            </span>
        </li>` ).join( '' ) : '<li class="empty">Nothing yet. Fill in a form for this place, or attach a PDF or other file.</li>';
    $$( 'li[data-att-id]', ul ).forEach( li => {
        const a = e.attachments.find( x => x.id === li.dataset.attId );
        $( '[data-att-open]', li ).addEventListener( 'click', () => openAttachment( a ) );
        $( '[data-att-dl]', li ).addEventListener( 'click', () => downloadAttachment( a ) );
        $( '[data-att-del]', li ).addEventListener( 'click', () => deleteAttachment( id, a ) );
    } );

    const forms = state.index.forms || [];
    const box = $( '[data-att-actions]', sheet.body );
    box.innerHTML = `
        ${ forms.length > 1 ? `<select class="field form-pick" data-form-pick aria-label="Form">${ forms.map( f => `<option value="${ esc( f.id ) }">${ esc( f.name ) }</option>` ).join( '' ) }</select>` : '' }
        <button type="button" class="btn btn-primary" data-fill>${ forms.length === 1 ? `Fill in “${ esc( forms[ 0 ].name ) }”` : 'Fill in a form' }</button>
        <label class="btn file-btn">Attach file<input type="file" data-att-file></label>`;
    $( '[data-fill]', box ).addEventListener( 'click', () => {
        const pick = $( '[data-form-pick]', box );
        state.forms.fillIn( state.byId.get( id ), pick ? pick.value : null );
    } );
    $( '[data-att-file]', box ).addEventListener( 'change', async ev => {
        const file = ev.target.files && ev.target.files[ 0 ];
        ev.target.value = '';
        if ( ! file ) return;
        try {
            await state.forms.saveOutput( id, null, file, file.name );
            toast( `Attached ${ file.name }.` );
        } catch ( err ) {
            toast( 'Could not attach the file: ' + err.message, { long: true } );
        }
    } );
}

async function attachmentFile( a ) {
    try { return await state.store.getFile( a.path ); }
    catch { toast( `The file ${ a.path } is missing from the data folder.`, { long: true } ); return null; }
}

async function openAttachment( a ) {
    const file = await attachmentFile( a );
    if ( ! file ) return;
    if ( M.isPdf( a.mime || file.type, a.name ) ) {
        PDF.openViewer( file, {
            title: a.name, downloadName: a.name,
            onError: err => toast( `This PDF can’t be shown here (${ err.message }). Use Download to open it in another app.`, { long: true } ),
        } );
    } else if ( M.typeFromFile( a.mime || file.type, a.name ) === 'image' ) {
        const url = URL.createObjectURL( file );
        state.blobUrls.push( url );
        openLightbox( url, a.name );
    } else {
        downloadAttachment( a, file );
    }
}

async function downloadAttachment( a, file ) {
    file = file || await attachmentFile( a );
    if ( file ) download( file, a.name );
}

async function deleteAttachment( id, a ) {
    if ( ! confirm( `Delete ${ a.name } from this place?` ) ) return;
    try {
        await mutate( ix => {
            const e = ix.entries.find( x => x.id === id );
            if ( ! e ) return;
            e.attachments = e.attachments.filter( x => x.id !== a.id );
            e.updated = new Date().toISOString();
        } );
        if ( ! isFileUsed( a.path ) ) await state.store.remove( a.path ).catch( () => {} );
        renderAttachments( id );
        toast( 'Attachment deleted.' );
    } catch ( err ) {
        toast( 'Could not delete: ' + err.message, { long: true } );
    }
}

/* ------------------------------------------------------------------ */
/* Notes log: dated text entries on a place                            */
/* ------------------------------------------------------------------ */
const fmtDateTime = iso => {
    try { return new Date( iso ).toLocaleString( undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' } ); }
    catch { return ''; }
};

function renderNotes( id ) {
    const e = state.byId.get( id );
    const ol = sheet.entryId === id && $( '[data-log]', sheet.body );
    if ( ! e || ! ol ) return;
    $( '[data-log-count]', sheet.body ).textContent = e.notes.length ? `(${ e.notes.length })` : '';
    ol.innerHTML = e.notes.map( n => `
        <li data-note="${ esc( n.id ) }">
            <p class="log-meta"><time datetime="${ esc( n.created ) }">${ esc( fmtDateTime( n.created ) ) }</time>${ n.updated !== n.created ? ' (edited)' : '' }</p>
            <p class="log-text">${ esc( n.text ) }</p>
            <p class="log-actions">
                <button type="button" class="btn-link" data-note-edit>Edit</button>
                <button type="button" class="btn-link danger" data-note-del>Delete</button>
            </p>
        </li>` ).join( '' );
    $$( 'li[data-note]', ol ).forEach( li => {
        const nid = li.dataset.note;
        $( '[data-note-edit]', li ).addEventListener( 'click', () => editNote( id, nid, li ) );
        $( '[data-note-del]', li ).addEventListener( 'click', () => deleteNote( id, nid ) );
    } );
}

function changeNotes( id, fn ) {
    return mutate( ix => {
        const e = ix.entries.find( x => x.id === id );
        if ( ! e ) throw new Error( 'This place no longer exists.' );
        fn( e.notes, e );
        e.updated = new Date().toISOString();
    } );
}

async function addNote( id ) {
    const ta = $( '[data-note-new]', sheet.body );
    const text = ta.value.trim();
    if ( ! text ) { ta.focus(); return; }
    const btn = $( '[data-log-add] button', sheet.body );
    btn.disabled = true;
    try {
        const now = new Date().toISOString();
        await changeNotes( id, notes => notes.push( { id: S.newId(), text: text.slice( 0, 20000 ), created: now, updated: now } ) );
        ta.value = '';
        renderNotes( id );
    } catch ( err ) {
        toast( 'Could not save the note: ' + err.message, { long: true } );
    } finally {
        btn.disabled = false;
    }
}

function editNote( id, nid, li ) {
    const e = state.byId.get( id );
    const n = e && e.notes.find( x => x.id === nid );
    if ( ! n ) return;
    li.classList.add( 'log-edit' );
    li.innerHTML = `
        <label class="visually-hidden" for="note-edit-${ esc( nid ) }">Edit note</label>
        <textarea class="field" id="note-edit-${ esc( nid ) }" rows="4">${ esc( n.text ) }</textarea>
        <div class="actions">
            <button type="button" class="btn btn-primary" data-save>Save note</button>
            <button type="button" class="btn" data-cancel>Cancel</button>
        </div>`;
    const ta = $( 'textarea', li );
    ta.focus();
    ta.setSelectionRange( ta.value.length, ta.value.length );
    $( '[data-cancel]', li ).addEventListener( 'click', () => renderNotes( id ) );
    $( '[data-save]', li ).addEventListener( 'click', async () => {
        const text = ta.value.trim();
        if ( ! text ) { ta.focus(); return; }
        try {
            if ( text !== n.text ) {
                await changeNotes( id, notes => {
                    const x = notes.find( y => y.id === nid );
                    if ( x ) { x.text = text.slice( 0, 20000 ); x.updated = new Date().toISOString(); }
                } );
            }
            renderNotes( id );
        } catch ( err ) {
            toast( 'Could not save the note: ' + err.message, { long: true } );
        }
    } );
}

async function deleteNote( id, nid ) {
    if ( ! confirm( 'Delete this note?' ) ) return;
    try {
        await changeNotes( id, notes => { const i = notes.findIndex( x => x.id === nid ); if ( i >= 0 ) notes.splice( i, 1 ); } );
        renderNotes( id );
    } catch ( err ) {
        toast( 'Could not delete the note: ' + err.message, { long: true } );
    }
}

/* ------------------------------------------------------------------ */
/* Lightbox                                                            */
/* ------------------------------------------------------------------ */
const lightbox = $( '#lightbox' );
let lightboxReturn = null;
function openLightbox( src, alt ) {
    lightboxReturn = document.activeElement;
    $( 'img', lightbox ).src = src;
    $( 'img', lightbox ).alt = alt || '';
    lightbox.hidden = false;
    $( '.lightbox-close', lightbox ).focus();
}
function closeLightbox() {
    lightbox.hidden = true;
    $( 'img', lightbox ).removeAttribute( 'src' );
    lightboxReturn && lightboxReturn.focus && lightboxReturn.focus();
}
lightbox.addEventListener( 'click', e => { if ( e.target.tagName !== 'IMG' ) closeLightbox(); } );

/* ------------------------------------------------------------------ */
/* Add / edit form                                                     */
/* ------------------------------------------------------------------ */
function showForm( entry = null, prefill = {} ) {
    if ( ! state.store ) return;
    const f = {
        id: entry ? entry.id : null,
        entry,
        lat: entry ? entry.lat : null,
        lng: entry ? entry.lng : null,
        file: null,
        keepFile: entry ? entry.file : null,
        removeFile: false,
        placeAuto: false,
        dirty: false,
    };
    // Only pre-select a kind when it was chosen by hand (differs from what
    // would be detected), so removing or swapping a file updates it.
    const manualType = entry && entry.type !== autoType( entry.file, entry.url ) ? entry.type : '';
    const typeOptions = Object.entries( TYPES ).map( ( [ k, t ] ) =>
        `<option value="${ k }"${ manualType === k ? ' selected' : '' }>${ t.label }</option>` ).join( '' );

    const body = openSheet( 'form', entry ? 'Edit place' : 'Add a place', `
        <form class="form" novalidate>
            <fieldset class="loc">
                <legend>Location</legend>
                <p class="loc-status" data-loc aria-live="polite"></p>
                <div class="loc-row">
                    <input type="search" class="field" data-q placeholder="Search for a place" aria-label="Search for a place" autocomplete="off">
                    <button type="button" class="btn" data-here>Use my location</button>
                </div>
                <ul class="results" data-results hidden></ul>
                <div class="loc-row coords-row">
                    <input type="text" class="field" data-coords placeholder="Or type coordinates" aria-label="Coordinates" aria-describedby="coords-hint" autocomplete="off" spellcheck="false" autocapitalize="characters">
                    <button type="button" class="btn" data-coords-set>Set</button>
                </div>
                <small class="hint" id="coords-hint" data-coords-hint>Latitude, longitude, e.g. 26.1445, 91.7362 or 26°08′40″N 91°44′10″E</small>
            </fieldset>
            <label class="lbl">Place name
                <input type="text" class="field" data-place maxlength="500" value="${ esc( entry ? entry.place : prefill.place || '' ) }">
            </label>
            <div class="lbl" role="group" aria-labelledby="file-lbl">
                <span id="file-lbl">Photo, video, audio or PDF from this device</span>
                <div class="file-row">
                    <label class="btn file-btn">Choose file<input type="file" data-file accept="image/*,video/*,audio/*,application/pdf,.pdf"></label>
                    <span class="file-name" data-file-name></span>
                    <button type="button" class="btn-link" data-file-clear hidden>Remove</button>
                </div>
            </div>
            <label class="lbl">Link
                <input type="url" class="field" data-url inputmode="url" placeholder="https://" value="${ esc( entry ? entry.url : prefill.url || '' ) }">
                <small class="hint" data-url-hint>YouTube, Vimeo, SoundCloud, Spotify, a direct media link or any web page.</small>
            </label>
            <label class="lbl">Kind
                <select class="field" data-type>
                    <option value="">Work it out from the file or link</option>
                    ${ typeOptions }
                </select>
            </label>
            <label class="lbl">Description
                <textarea class="field" data-desc rows="4">${ esc( entry ? entry.description : prefill.description || '' ) }</textarea>
            </label>
            <p class="form-error" data-error role="alert" hidden></p>
            <div class="actions">
                <button type="submit" class="btn btn-primary" data-save>${ entry ? 'Save changes' : 'Save place' }</button>
                <button type="button" class="btn" data-cancel>Cancel</button>
            </div>
        </form>`, {
        backTo: entry ? () => showEntry( entry.id ) : null,
        onLeave: () => {
            state.form = null;
            if ( state.draftMarker ) { state.map.removeLayer( state.draftMarker ); state.draftMarker = null; }
            $( '#pick-hint' ).hidden = true;
            document.body.classList.remove( 'picking' );
            if ( f.id && state.markers.get( f.id ) && state.layer && ! state.layer.hasLayer( state.markers.get( f.id ) ) ) {
                state.layer.addLayer( state.markers.get( f.id ) );
            }
        },
    } );
    f.el = body;
    state.form = f;
    document.body.classList.add( 'picking' );

    // Hide the entry's own pin while its draft pin is shown.
    if ( entry && state.markers.get( entry.id ) ) state.layer.removeLayer( state.markers.get( entry.id ) );

    if ( entry ) setFormLocation( entry.lat, entry.lng, 'init' );
    else if ( prefill.lat != null ) setFormLocation( prefill.lat, prefill.lng, 'init' );
    else updateLocStatus();
    updateFileName();

    const form = $( 'form', body );
    form.addEventListener( 'input', () => { f.dirty = true; } );
    $( '[data-place]', body ).addEventListener( 'input', () => { f.placeAuto = false; } );
    $( '[data-here]', body ).addEventListener( 'click', () => locate( true ) );
    $( '[data-cancel]', body ).addEventListener( 'click', () => {
        if ( f.dirty && ! confirm( 'Discard your changes?' ) ) return;
        f.dirty = false;
        entry ? showEntry( entry.id ) : closeSheet();
    } );
    $( '[data-file]', body ).addEventListener( 'change', onFileChosen );
    $( '[data-file-clear]', body ).addEventListener( 'click', () => {
        f.file = null;
        if ( f.keepFile ) f.removeFile = true;
        f.dirty = true;
        $( '[data-file]', body ).value = '';
        updateFileName();
    } );
    $( '[data-url]', body ).addEventListener( 'input', debounce( updateUrlHint, 250 ) );
    $( '[data-q]', body ).addEventListener( 'input', debounce( placeSearch, 600 ) );
    const coordsEl = $( '[data-coords]', body );
    coordsEl.addEventListener( 'input', () => { f.coordsTyped = true; } );
    coordsEl.addEventListener( 'keydown', ev => { if ( ev.key === 'Enter' ) { ev.preventDefault(); applyTypedCoords(); } } );
    $( '[data-coords-set]', body ).addEventListener( 'click', applyTypedCoords );
    $( '[data-q]', body ).addEventListener( 'keydown', ev => { if ( ev.key === 'Enter' ) { ev.preventDefault(); placeSearch(); } } );
    form.addEventListener( 'submit', ev => { ev.preventDefault(); saveForm(); } );
    if ( prefill.url ) { f.dirty = true; updateUrlHint(); }
}

function autoType( file, url ) {
    return ( file && M.typeFromFile( file.mime, file.name ) ) || ( url && M.typeFromUrl( url ) ) || 'text';
}

function updateLocStatus() {
    const f = state.form;
    if ( ! f ) return;
    const el = $( '[data-loc]', f.el );
    el.textContent = f.lat == null
        ? 'Tap the map to place the pin, search for a place, type coordinates, or use your location.'
        : `Pinned at ${ fmtCoord( f.lat ) }, ${ fmtCoord( f.lng ) }. Drag the pin or tap the map to move it.`;
    el.classList.toggle( 'is-set', f.lat != null );
    $( '#pick-hint' ).hidden = f.lat != null;
    if ( f.lat != null ) {
        $( '[data-coords]', f.el ).value = `${ fmtCoord( f.lat ) }, ${ fmtCoord( f.lng ) }`;
        f.coordsTyped = false;
        setCoordsHint( '' );
    }
}

function setCoordsHint( msg ) {
    const hint = $( '[data-coords-hint]', state.form.el );
    hint.textContent = msg || 'Latitude, longitude, e.g. 26.1445, 91.7362 or 26°08′40″N 91°44′10″E';
    hint.classList.toggle( 'is-warn', !! msg );
}

/** Returns true when the typed coordinates were understood (or nothing was typed). */
function applyTypedCoords() {
    const f = state.form;
    if ( ! f ) return false;
    const v = $( '[data-coords]', f.el ).value.trim();
    if ( ! v ) return true;
    const c = parseCoords( v );
    if ( ! c ) {
        setCoordsHint( 'Those coordinates couldn’t be read. Use latitude, longitude, e.g. 26.1445, 91.7362' );
        return false;
    }
    setFormLocation( c.lat, c.lng, 'typed' );
    if ( c.swapped ) toast( 'Read as longitude, latitude and swapped. Check the pin is in the right place.', { long: true } );
    return true;
}

function setFormLocation( lat, lng, source ) {
    const f = state.form;
    if ( ! f ) return;
    f.lat = Math.round( lat * 1e7 ) / 1e7;
    f.lng = Math.round( ( ( ( lng + 180 ) % 360 + 360 ) % 360 - 180 ) * 1e7 ) / 1e7;
    if ( source !== 'init' ) f.dirty = true;
    if ( ! state.draftMarker ) {
        state.draftMarker = L.marker( [ f.lat, f.lng ], { icon: draftIcon, draggable: true, zIndexOffset: 1000, keyboard: false } ).addTo( state.map );
        state.draftMarker.on( 'dragend', () => {
            const p = state.draftMarker.getLatLng();
            setFormLocation( p.lat, p.lng, 'drag' );
        } );
    } else {
        state.draftMarker.setLatLng( [ f.lat, f.lng ] );
    }
    updateLocStatus();
    if ( source === 'init' || source === 'search' || source === 'gps' || source === 'photo' || source === 'typed' ) {
        focusOn( f.lat, f.lng, Math.max( state.map.getZoom(), 15 ) );
    }
    const placeEl = $( '[data-place]', f.el );
    if ( ( source === 'map' || source === 'drag' || source === 'gps' || source === 'photo' || source === 'typed' ) && ( ! placeEl.value.trim() || f.placeAuto ) ) {
        reverseGeocode( f.lat, f.lng );
    }
}

async function onFileChosen( ev ) {
    const f = state.form;
    const file = ev.target.files && ev.target.files[ 0 ];
    if ( ! f || ! file ) return;
    f.file = file;
    f.removeFile = false;
    f.dirty = true;
    updateFileName();
    if ( f.lat == null ) {
        const gps = await M.gpsFromPhoto( file );
        if ( gps && state.form === f && f.lat == null ) {
            setFormLocation( gps.lat, gps.lng, 'photo' );
            toast( 'Location taken from the photo.' );
        }
    }
}

function updateFileName() {
    const f = state.form;
    const nameEl = $( '[data-file-name]', f.el );
    const clear  = $( '[data-file-clear]', f.el );
    if ( f.file ) {
        nameEl.textContent = `${ f.file.name } (${ M.formatBytes( f.file.size ) })`;
        clear.hidden = false;
    } else if ( f.keepFile && ! f.removeFile ) {
        nameEl.textContent = `${ f.keepFile.name } (${ M.formatBytes( f.keepFile.size ) })`;
        clear.hidden = false;
    } else {
        nameEl.textContent = 'No file chosen';
        clear.hidden = true;
    }
}

function updateUrlHint() {
    const f = state.form;
    if ( ! f ) return;
    const v = $( '[data-url]', f.el ).value.trim();
    const hint = $( '[data-url-hint]', f.el );
    hint.classList.remove( 'is-warn' );
    if ( ! v ) { hint.textContent = 'YouTube, Vimeo, SoundCloud, Spotify, a direct media link or any web page.'; return; }
    if ( ! M.parseUrl( v ) ) { hint.textContent = 'Links start with https:// or http://'; hint.classList.add( 'is-warn' ); return; }
    const t = M.typeFromUrl( v );
    const dup = state.index.entries.find( e => e.url === v && e.id !== f.id );
    hint.textContent = ( t ? `Looks like ${ TYPES[ t ].label.toLowerCase() }.` : 'Saved as a link.' ) +
        ( dup ? ` Already used for “${ dup.place || 'another place' }”.` : '' );
    if ( dup ) hint.classList.add( 'is-warn' );
}

async function saveForm() {
    const f = state.form;
    if ( ! f ) return;
    const el = f.el;
    const errEl = $( '[data-error]', el );
    const showErr = msg => { errEl.textContent = msg; errEl.hidden = false; errEl.scrollIntoView( { block: 'nearest' } ); };
    errEl.hidden = true;

    if ( f.coordsTyped && ! applyTypedCoords() ) return showErr( 'Fix the coordinates, or clear them and tap the map instead.' );
    const place = $( '[data-place]', el ).value.trim();
    const url   = $( '[data-url]', el ).value.trim();
    const desc  = $( '[data-desc]', el ).value.trim();
    if ( f.lat == null ) return showErr( 'Place the pin first: tap the map, search, or use your location.' );
    if ( url && ! M.parseUrl( url ) ) return showErr( 'The link needs to start with https:// or http://' );
    const hasFile = !! f.file || ( f.keepFile && ! f.removeFile );
    if ( ! hasFile && ! url && ! desc && ! place && ! ( f.entry && f.entry.notes.length ) ) return showErr( 'Add a name, a description, a file or a link.' );

    const btn = $( '[data-save]', el );
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const st = state.store;
    let newPath = null;
    try {
        let fileInfo = f.removeFile ? null : f.keepFile;
        if ( f.file ) {
            let file = f.file;
            if ( settings.shrinkPhotos ) file = await M.shrinkPhoto( file );
            newPath = await st.freeMediaPath( file.name );
            await st.write( newPath, file );
            fileInfo = { path: newPath, name: file.name, mime: file.type, size: file.size };
        }
        const type = $( '[data-type]', el ).value || autoType( fileInfo, url );
        const now = new Date().toISOString();
        const entry = S.cleanEntry( {
            id: f.id || S.newId(),
            lat: f.lat, lng: f.lng, place, description: desc, url, type,
            file: fileInfo,
            notes: f.entry ? f.entry.notes : [],
            author: f.entry ? f.entry.author : settings.author,
            created: f.entry ? f.entry.created : now,
            updated: now,
        } );
        const oldPath = f.entry && f.entry.file ? f.entry.file.path : null;
        await mutate( ix => {
            const i = ix.entries.findIndex( x => x.id === entry.id );
            if ( i >= 0 ) { entry.notes = ix.entries[ i ].notes; entry.attachments = ix.entries[ i ].attachments; ix.entries[ i ] = entry; } else ix.entries.push( entry );
        } );
        if ( oldPath && ( ! entry.file || entry.file.path !== oldPath ) && ! isFileUsed( oldPath ) ) {
            await st.remove( oldPath ).catch( () => {} );
        }
        f.dirty = false;
        toast( f.id ? 'Changes saved.' : 'Place saved.' );
        showEntry( entry.id );
    } catch ( err ) {
        if ( newPath ) await st.remove( newPath ).catch( () => {} );
        btn.disabled = false;
        btn.textContent = f.id ? 'Save changes' : 'Save place';
        showErr( 'Could not save: ' + ( err.message || err ) + ( err.name === 'QuotaExceededError' ? ' The device is out of space.' : '' ) );
    }
}

/* ------------------------------------------------------------------ */
/* Place search (OpenStreetMap Nominatim; online only, 1 request/sec)  */
/* ------------------------------------------------------------------ */
const geo = { last: 0, cache: new Map(), ctrl: null };
async function nominatim( path, params ) {
    // Language goes in the query string: a custom header would trigger a CORS preflight.
    const qs = new URLSearchParams( { format: 'jsonv2', 'accept-language': navigator.language || 'en', ...params } ).toString();
    if ( geo.cache.has( path + qs ) ) return geo.cache.get( path + qs );
    if ( geo.ctrl ) geo.ctrl.abort();
    const ctrl = geo.ctrl = new AbortController();
    const wait = geo.last + 1100 - Date.now();
    if ( wait > 0 ) await sleep( wait );
    if ( ctrl.signal.aborted ) throw new DOMException( 'aborted', 'AbortError' );
    geo.last = Date.now();
    const res = await fetch( `https://nominatim.openstreetmap.org/${ path }?${ qs }`, { signal: ctrl.signal } );
    if ( ! res.ok ) throw new Error( 'Place search is unavailable right now.' );
    const data = await res.json();
    geo.cache.set( path + qs, data );
    return data;
}
const shortName = s => String( s || '' ).split( ',' ).slice( 0, 3 ).map( x => x.trim() ).join( ', ' );

async function placeSearch() {
    const f = state.form;
    if ( ! f ) return;
    const q = $( '[data-q]', f.el ).value.trim();
    const ul = $( '[data-results]', f.el );
    if ( q.length < 3 ) { ul.hidden = true; return; }
    if ( ! navigator.onLine ) { ul.innerHTML = '<li class="muted">Place search needs an internet connection. Tap the map instead.</li>'; ul.hidden = false; return; }
    ul.innerHTML = '<li class="muted">Searching…</li>';
    ul.hidden = false;
    try {
        const rows = await nominatim( 'search', { q, limit: 6 } );
        if ( state.form !== f ) return;
        if ( ! rows.length ) { ul.innerHTML = '<li class="muted">No matching places.</li>'; return; }
        ul.innerHTML = rows.map( ( r, i ) => `<li><button type="button" data-i="${ i }">${ esc( r.display_name ) }</button></li>` ).join( '' );
        $$( 'button', ul ).forEach( b => b.addEventListener( 'click', () => {
            const r = rows[ +b.dataset.i ];
            $( '[data-place]', f.el ).value = shortName( r.display_name );
            f.placeAuto = true;
            ul.hidden = true;
            setFormLocation( parseFloat( r.lat ), parseFloat( r.lon ), 'search' );
        } ) );
    } catch ( err ) {
        if ( err.name !== 'AbortError' && state.form === f ) ul.innerHTML = `<li class="muted">${ esc( err.message ) }</li>`;
    }
}

async function reverseGeocode( lat, lng ) {
    const f = state.form;
    if ( ! f || ! navigator.onLine ) return;
    try {
        const r = await nominatim( 'reverse', { lat: lat.toFixed( 5 ), lon: lng.toFixed( 5 ), zoom: 16 } );
        const placeEl = f.el && $( '[data-place]', f.el );
        if ( state.form !== f || f.lat !== lat || ! r || ! r.display_name ) return;
        if ( ! placeEl.value.trim() || f.placeAuto ) { placeEl.value = shortName( r.display_name ); f.placeAuto = true; }
    } catch {}
}

/* ------------------------------------------------------------------ */
/* My location                                                         */
/* ------------------------------------------------------------------ */
function locate( forForm = false ) {
    if ( ! navigator.geolocation ) { toast( 'This device can’t share its location.' ); return; }
    toast( 'Finding your location…', { sticky: true } );
    navigator.geolocation.getCurrentPosition( pos => {
        hideToast();
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        if ( state.locateLayer ) state.map.removeLayer( state.locateLayer );
        state.locateLayer = L.layerGroup( [
            L.circle( [ lat, lng ], { radius: accuracy, className: 'you-accuracy', interactive: false } ),
            L.circleMarker( [ lat, lng ], { radius: 7, className: 'you-dot', interactive: false } ),
        ] ).addTo( state.map );
        if ( forForm && state.form ) setFormLocation( lat, lng, 'gps' );
        else focusOn( lat, lng, Math.max( state.map.getZoom(), 15 ) );
    }, err => {
        const msg = err.code === 1 ? 'Location access is turned off for this app. Allow it in your browser settings.'
            : err.code === 3 ? 'Finding your location took too long. Try again outdoors or tap the map.'
            : 'Your location isn’t available right now.';
        toast( msg, { long: true } );
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 } );
}

/* ------------------------------------------------------------------ */
/* Entries list                                                        */
/* ------------------------------------------------------------------ */
let listQuery = '';
function showList() {
    if ( ! confirmLeave() ) return;
    const body = openSheet( 'list', 'Places', `
        <input type="search" class="field" data-filter placeholder="Search places and notes" aria-label="Search places and notes" value="${ esc( listQuery ) }">
        <p class="list-count" data-count aria-live="polite"></p>
        <ul class="entry-list" data-list></ul>` );
    selectMarker( null );
    const input = $( '[data-filter]', body );
    input.addEventListener( 'input', debounce( () => { listQuery = input.value; renderListResults(); }, 120 ) );
    renderListResults();
    if ( ! isSmall() ) input.focus();
}
function renderListResults() {
    const body = sheet.body;
    const ul = $( '[data-list]', body );
    if ( ! ul ) return;
    const q = listQuery.trim().toLowerCase();
    const all = [ ...state.index.entries ].sort( ( a, b ) => b.created.localeCompare( a.created ) );
    const rows = q ? all.filter( e => ( e.place + '\n' + e.description + '\n' + e.url + '\n' + ( e.file ? e.file.name : '' ) + '\n' + e.notes.map( n => n.text ).join( '\n' ) + '\n' + e.attachments.map( a => a.name + ' ' + ( a.form ? a.form.name : '' ) ).join( '\n' ) + '\n' + e.author ).toLowerCase().includes( q ) ) : all;
    $( '[data-count]', body ).textContent = q
        ? `${ plural( rows.length, 'match', 'matches' ) } of ${ plural( all.length, 'place', 'places' ) }`
        : plural( all.length, 'place', 'places' );
    if ( ! all.length ) {
        ul.innerHTML = '<li class="empty">No places yet. Use “Add a place”, then tap the map where it belongs.</li>';
        return;
    }
    ul.innerHTML = rows.slice( 0, 500 ).map( e => {
        const t = TYPES[ e.type ] || TYPES.text;
        return `<li><button type="button" data-id="${ esc( e.id ) }">
            <span class="list-pin">${ pinSvg( e.type ) }</span>
            <span class="list-text">
                <span class="list-title">${ esc( e.place || 'Untitled place' ) }</span>
                <span class="list-sub">${ esc( t.label ) }, ${ esc( fmtDate( e.created ) ) }${ e.author ? `, ${ esc( e.author ) }` : '' }${ e.notes.length ? `, ${ plural( e.notes.length, 'note', 'notes' ) }` : '' }${ e.attachments.length ? `, ${ plural( e.attachments.length, 'attachment', 'attachments' ) }` : '' }</span>
                ${ e.description ? `<span class="list-desc">${ esc( e.description.slice( 0, 140 ) ) }</span>` : '' }
            </span></button></li>`;
    } ).join( '' ) + ( rows.length > 500 ? `<li class="empty">Showing the newest 500. Search to narrow down.</li>` : '' );
    $$( 'button[data-id]', ul ).forEach( b => b.addEventListener( 'click', () => showEntry( b.dataset.id, { fly: true, backTo: showList } ) ) );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
async function showSettings() {
    if ( ! confirmLeave() ) return;
    const st = state.store;
    const files = state.index.entries.filter( e => e.file ).length;
    const nLayers = ( state.index.layers || [] ).length;
    const nForms = ( state.index.forms || [] ).length;
    const where = st.kind === 'folder'
        ? `Saved in the folder <strong>${ esc( st.name ) }</strong> on this device. It contains <code>mediamap.json</code>, this map’s <code>settings.json</code>, and <code>media</code>, <code>layers</code> and <code>forms</code> folders, so you can open, copy or back it up with any file manager.`
        : `Saved in this app’s private storage on this device. Use <strong>Export backup</strong> to get a copy you can keep elsewhere${ S.supportsFolder ? ', or move everything into a folder you choose' : '' }.`;
    const pack = state.index.pack;
    const body = openSheet( 'settings', 'Settings', `
        <section class="set">
            <h3>Your name</h3>
            <label class="lbl">Name shown on places you add
                <input type="text" class="field" data-author maxlength="100" autocomplete="name" value="${ esc( settings.author ) }" placeholder="For example, Ria Das (Class 9B)">
            </label>
            <small class="hint">Helps your teacher or group tell whose places are whose when work is combined. It’s saved with each new place.</small>
        </section>

        <section class="set">
            <h3>Print and export</h3>
            <p>Print the map with a numbered list of places, or save it as a PDF for a report. Export the places as a spreadsheet for Excel or Google Sheets, or as GeoJSON for GIS software such as QGIS.</p>
            <div class="actions wrap">
                <button type="button" class="btn btn-primary" data-print-map>Print or save as PDF</button>
                <button type="button" class="btn" data-csv>Spreadsheet (CSV)</button>
                <button type="button" class="btn" data-geojson>GeoJSON</button>
            </div>
        </section>

        <section class="set">
            <h3>Your data</h3>
            <p>${ where }</p>
            <p class="muted">${ plural( state.index.entries.length, 'place', 'places' ) }, ${ plural( files, 'file', 'files' ) }, ${ plural( nLayers, 'map layer', 'map layers' ) }, ${ plural( nForms, 'form', 'forms' ) }.</p>
            <div class="actions wrap">
                <button type="button" class="btn btn-primary" data-export>Export backup</button>
                <button type="button" class="btn" data-import>Import</button>
                ${ S.supportsFolder ? `<button type="button" class="btn" data-folder>${ st.kind === 'folder' ? 'Use a different folder' : 'Move to a folder' }</button>` : '' }
                ${ st.kind === 'folder' ? '<button type="button" class="btn" data-reload>Reload from folder</button>' : '' }
                <button type="button" class="btn" data-check>Check files</button>
            </div>
            <p class="muted small" data-check-out hidden></p>
            <p class="muted small">Import accepts a Media Map backup (.zip), a <code>mediamap.json</code> or <code>settings.json</code> file, a GeoJSON file (added as a map layer), or a JSON export from the Media Map WordPress plugin.</p>
        </section>

        <section class="set" data-forms-settings></section>

        <section class="set">
            <h3>Class pack</h3>
            ${ pack ? `<p>From the pack <strong>${ esc( pack.title ) }</strong>.${ pack.instructions ? ' <button type="button" class="btn-link" data-pack-info>Read the instructions</button>' : '' }</p>` : '' }
            <p>Teachers and group leaders: share one file that gives everyone the same forms, map layers and starting map, with instructions. Students add it with <strong>Import</strong>, and later send back their own <strong>Export backup</strong>, which you can import to combine everyone’s work.</p>
            <div class="actions"><button type="button" class="btn" data-make-pack>Create a class pack</button></div>
        </section>

        <section class="set">
            <h3>Photos</h3>
            <p class="muted small">This setting and the map settings below belong to this map and are saved in its <code>settings.json</code>. Your name and the offline tile limit apply to every map on this device.</p>
            <label class="check"><input type="checkbox" data-shrink ${ settings.shrinkPhotos ? 'checked' : '' }> Shrink large photos before saving (longest side 2560 px)</label>
        </section>

        <section class="set">
            <h3>Map</h3>
            <label class="lbl">Tile server
                <input type="text" class="field" data-tile inputmode="url" autocomplete="off" autocapitalize="off" value="${ esc( settings.tileUrl ) }" spellcheck="false">
                <small class="hint">Any tile address works: XYZ (<code>{z}/{x}/{y}</code>), TMS (<code>{-y}</code>), quadkey (<code>{q}</code>), bounding box (<code>{bbox}</code>), a WMS or WMTS address, or an ArcGIS MapServer link.</small>
            </label>
            <label class="lbl">Attribution
                <input type="text" class="field" data-attr value="${ esc( settings.attribution ) }" spellcheck="false">
            </label>
            <label class="lbl">Maximum zoom
                <input type="number" class="field field-short" data-maxzoom min="1" max="22" value="${ settings.maxZoom }">
            </label>
            <label class="check"><input type="checkbox" data-cluster ${ settings.cluster ? 'checked' : '' }> Group nearby pins</label>
            <small class="hint">Saved with this map${ st.kind === 'folder' ? ` in <code>${ esc( st.name ) }/settings.json</code>` : '' }. Other maps keep their own.</small>
            <div class="actions">
                <button type="button" class="btn btn-primary" data-map-save>Save map settings</button>
                <button type="button" class="btn-link" data-map-reset>Reset to OpenStreetMap</button>
            </div>
        </section>

        <section class="set">
            <h3>Offline map</h3>
            <p>Map areas you have looked at are kept so they show without a connection.</p>
            <p class="muted" data-tiles>Counting saved map tiles…</p>
            <label class="lbl">Keep up to
                <span class="inline"><input type="number" class="field field-short" data-maxtiles min="200" max="50000" step="100" value="${ settings.maxTiles }"> tiles</span>
            </label>
            <div class="actions"><button type="button" class="btn" data-clear-tiles>Clear saved map tiles</button></div>
            <div class="offline-area" data-offline-area></div>
        </section>

        <section class="set">
            <h3>This device</h3>
            <p class="muted" data-quota>Checking storage…</p>
            <div class="actions wrap">
                <button type="button" class="btn" data-persist hidden>Protect app data from clean-up</button>
                <button type="button" class="btn" data-install hidden>Install app</button>
                <button type="button" class="btn" data-update>Check for updates</button>
            </div>
            <p class="muted small" data-ios hidden>To install on iPhone or iPad, tap Share, then Add to Home Screen.</p>
            <p class="muted small">Media Map ${ APP_VERSION }. No account, nothing uploaded.</p>
        </section>` );

    $( '[data-export]', body ).addEventListener( 'click', exportBackup );
    $( '[data-import]', body ).addEventListener( 'click', () => $( '#import-input' ).click() );
    $( '[data-folder]', body )?.addEventListener( 'click', () => switchStorage( 'folder' ) );
    $( '[data-reload]', body )?.addEventListener( 'click', async () => {
        try {
            const { index, warning } = await state.store.readIndex();
            setIndex( index );
            toast( warning || `Loaded ${ plural( index.entries.length, 'place', 'places' ) } from the folder.` );
            showSettings();
        } catch ( err ) { toast( err.message, { long: true } ); }
    } );
    $( '[data-check]', body ).addEventListener( 'click', () => checkFiles( $( '[data-check-out]', body ) ) );
    $( '[data-shrink]', body ).addEventListener( 'change', e => { settings.shrinkPhotos = e.target.checked; saveSettings( 'shrinkPhotos' ); } );
    $( '[data-map-save]', body ).addEventListener( 'click', () => {
        const tile = normalizeBasemap( $( '[data-tile]', body ).value ) || DEFAULTS.tileUrl;
        $( '[data-tile]', body ).value = tile;
        const clusterChanged = settings.cluster !== $( '[data-cluster]', body ).checked;
        settings.tileUrl = tile;
        settings.attribution = $( '[data-attr]', body ).value.trim();
        settings.maxZoom = Math.min( 22, Math.max( 1, parseInt( $( '[data-maxzoom]', body ).value, 10 ) || 19 ) );
        settings.cluster = $( '[data-cluster]', body ).checked;
        saveSettings( 'tileUrl', 'attribution', 'maxZoom', 'cluster' );
        state.map.setMaxZoom( settings.maxZoom );
        setTiles();
        if ( clusterChanged ) buildLayer();
        toast( 'Map settings saved.' );
    } );
    $( '[data-map-reset]', body ).addEventListener( 'click', () => {
        $( '[data-tile]', body ).value = DEFAULTS.tileUrl;
        $( '[data-attr]', body ).value = DEFAULTS.attribution;
        $( '[data-maxzoom]', body ).value = DEFAULTS.maxZoom;
    } );
    $( '[data-maxtiles]', body ).addEventListener( 'change', e => {
        settings.maxTiles = Math.min( 50000, Math.max( 200, parseInt( e.target.value, 10 ) || DEFAULTS.maxTiles ) );
        e.target.value = settings.maxTiles;
        saveSettings( 'maxTiles' );
    } );
    $( '[data-clear-tiles]', body ).addEventListener( 'click', async () => {
        await caches.delete( 'mm-tiles' ).catch( () => {} );
        countTiles( $( '[data-tiles]', body ) );
        toast( 'Saved map tiles cleared.' );
    } );
    $( '[data-update]', body ).addEventListener( 'click', async () => {
        if ( ! state.swReg ) { toast( 'Updates need the app to be opened from a web address (https).' ); return; }
        try { await state.swReg.update(); } catch {}
        if ( ! state.swReg.installing && ! state.swReg.waiting ) toast( 'You have the latest version.' );
    } );

    countTiles( $( '[data-tiles]', body ) );
    showQuota( body );
    state.forms.renderSettings( $( '[data-forms-settings]', body ) );
    state.offline.renderSettings( $( '[data-offline-area]', body ) );
    $( '[data-author]', body ).addEventListener( 'change', e => {
        settings.author = e.target.value.trim().slice( 0, 100 );
        saveSettings( 'author' );
        toast( settings.author ? `New places will show “${ settings.author }”.` : 'Your name was removed.' );
    } );
    $( '[data-print-map]', body ).addEventListener( 'click', () => state.reports.showPrint( showSettings ) );
    $( '[data-csv]', body ).addEventListener( 'click', () => state.reports.exportCSV() );
    $( '[data-geojson]', body ).addEventListener( 'click', () => state.reports.exportGeoJSON() );
    $( '[data-make-pack]', body ).addEventListener( 'click', showPackMaker );
    $( '[data-pack-info]', body )?.addEventListener( 'click', () => showPackInfo( state.index.pack, showSettings ) );
    const installBtn = $( '[data-install]', body );
    if ( state.installEvt ) {
        installBtn.hidden = false;
        installBtn.addEventListener( 'click', async () => {
            const evt = state.installEvt;
            state.installEvt = null;
            installBtn.hidden = true;
            evt.prompt();
            try { await evt.userChoice; } catch {}
        } );
    } else if ( /iphone|ipad|ipod/i.test( navigator.userAgent ) && ! navigator.standalone ) {
        $( '[data-ios]', body ).hidden = false;
    }
}

async function countTiles( el ) {
    if ( ! el ) return;
    try {
        const n = ( await ( await caches.open( 'mm-tiles' ) ).keys() ).length;
        el.textContent = n ? `${ plural( n, 'map tile', 'map tiles' ) } saved for offline use.` : 'No map tiles saved yet.';
    } catch { el.textContent = 'Offline map tiles aren’t available in this browser.'; }
}

async function showQuota( body ) {
    const el = $( '[data-quota]', body );
    if ( ! navigator.storage || ! navigator.storage.estimate ) { el.textContent = ''; return; }
    try {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : true;
        const what = state.store.kind === 'folder' ? 'App and saved map tiles use' : 'Your places, files and map tiles use';
        el.textContent = `${ what } ${ M.formatBytes( usage ) }${ quota ? ` of about ${ M.formatBytes( quota ) } available` : '' }.` +
            ( persisted ? ' The browser won’t clear this data on its own.' : ' The browser may clear this data if the device runs low on space.' );
        const btn = $( '[data-persist]', body );
        if ( ! persisted && navigator.storage.persist ) {
            btn.hidden = false;
            btn.addEventListener( 'click', async () => {
                const ok = await navigator.storage.persist().catch( () => false );
                toast( ok ? 'App data is now protected from automatic clean-up.' : 'The browser declined. Installing the app usually allows it.' , { long: ! ok } );
                showQuota( body );
                btn.hidden = ok;
            }, { once: true } );
        }
    } catch { el.textContent = ''; }
}

async function checkFiles( out ) {
    out.hidden = false;
    out.textContent = 'Checking files…';
    const st = state.store;
    const used = new Set( dataFiles() );
    let missing = 0;
    for ( const p of used ) if ( ! ( await st.exists( p ) ) ) missing++;
    const listed = [
        ...( await st.list( S.MEDIA_DIR ) ).map( n => `${ S.MEDIA_DIR }/${ n }` ),
        ...( await st.list( S.LAYER_DIR ) ).map( n => `${ S.LAYER_DIR }/${ n }` ),
        ...( await st.list( S.FORM_DIR ) ).map( n => `${ S.FORM_DIR }/${ n }` ),
    ];
    const unused = listed.filter( p => ! used.has( p ) && ! p.split( '/' ).pop().startsWith( '.' ) );
    const parts = [];
    parts.push( missing ? `${ plural( missing, 'file is', 'files are' ) } missing from the data folder.` : 'Every file is in place.' );
    if ( unused.length ) parts.push( `${ plural( unused.length, 'file in the data folder isn’t', 'files in the data folder aren’t' ) } used by any place, layer or form.` );
    out.textContent = parts.join( ' ' );
    if ( unused.length ) {
        const b = document.createElement( 'button' );
        b.type = 'button';
        b.className = 'btn-link';
        b.textContent = unused.length === 1 ? 'Delete it' : 'Delete them';
        b.addEventListener( 'click', async () => {
            if ( ! confirm( `Delete ${ plural( unused.length, 'unused file', 'unused files' ) } from the data folder?` ) ) return;
            for ( const p of unused ) await st.remove( p ).catch( () => {} );
            toast( 'Unused files deleted.' );
            checkFiles( out );
        } );
        out.append( ' ', b );
    }
}

/* ------------------------------------------------------------------ */
/* Export / import                                                     */
/* ------------------------------------------------------------------ */
function download( blob, name ) {
    const a = document.createElement( 'a' );
    a.href = URL.createObjectURL( blob );
    a.download = name;
    document.body.append( a );
    a.click();
    a.remove();
    setTimeout( () => URL.revokeObjectURL( a.href ), 60000 );
}

async function exportBackup() {
    const st = state.store;
    const files = [
        { name: S.INDEX_FILE, data: JSON.stringify( state.index, null, 2 ) + '\n' },
        { name: S.SETTINGS_FILE, data: JSON.stringify( S.settingsDocument( settings ), null, 2 ) + '\n' },
    ];
    let missing = 0;
    for ( const path of dataFiles() ) {
        try {
            const file = await st.getFile( path );
            files.push( { name: path, data: file, date: new Date( file.lastModified ) } );
        } catch { missing++; }
    }
    try {
        toast( 'Preparing backup…', { sticky: true } );
        const zip = await makeZip( files, ( d, t ) => { if ( t > 20 && d % 10 === 0 ) toast( `Preparing backup… ${ Math.round( d / t * 100 ) }%`, { sticky: true } ); } );
        const name = `media-map-backup-${ new Date().toISOString().slice( 0, 10 ) }.zip`;
        const file = new File( [ zip ], name, { type: 'application/zip' } );
        // Phones handle "Share → Save to Files/Drive" better than downloads.
        if ( isSmall() && navigator.canShare && navigator.canShare( { files: [ file ] } ) ) {
            hideToast();
            try { await navigator.share( { files: [ file ], title: 'Media Map backup' } ); return; }
            catch ( err ) { if ( err.name === 'AbortError' ) return; }
        }
        download( file, name );
        toast( `Backup saved as ${ name }${ missing ? `. ${ plural( missing, 'file was', 'files were' ) } missing and left out.` : '.' }`, { long: true } );
    } catch ( err ) {
        toast( 'Could not create the backup: ' + err.message, { long: true } );
    }
}

/** Convert rows exported by the Media Map WordPress plugin. */
function fromWordPress( rows ) {
    const out = [];
    for ( const r of rows ) {
        if ( ! r || typeof r !== 'object' || r.status === 'rejected' ) continue;
        const date = r.submitted_at ? String( r.submitted_at ).replace( ' ', 'T' ) : '';
        const e = S.cleanEntry( {
            id: 'wp-' + ( r.id || S.newId() ),
            lat: r.lat, lng: r.lng,
            place: r.place_name || '',
            description: r.description || '',
            url: r.media_url || '',
            type: r.media_type || ( r.media_url ? M.typeFromUrl( r.media_url ) : 'text' ) || 'text',
            created: date, updated: r.reviewed_at ? String( r.reviewed_at ).replace( ' ', 'T' ) : date,
        } );
        if ( e ) out.push( e );
    }
    return out;
}

async function importFile( file ) {
    const st = state.store;
    let incoming = [], incomingLayers = [], incomingForms = [], incomingPack = null, incomingSettings = null, zip = null, prefix = '';
    // A backup's map settings are only taken when restoring into an empty map,
    // so combining other people's backups never changes this map's basemap.
    const wasEmpty = ! state.index.entries.length && ! ( state.index.layers || [] ).length && ! ( state.index.forms || [] ).length;
    try {
        if ( /\.zip$/i.test( file.name ) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed' ) {
            zip = await readZip( file );
            const key = [ ...zip.keys() ]
                .filter( k => k === S.INDEX_FILE || k.endsWith( '/' + S.INDEX_FILE ) )
                .sort( ( a, b ) => a.length - b.length )[ 0 ];
            if ( ! key ) throw new Error( 'The ZIP file has no mediamap.json in it.' );
            prefix = key.slice( 0, -S.INDEX_FILE.length );
            const parsed = S.parseIndex( await ( await zip.get( key ).blob() ).text() );
            incoming = parsed.entries;
            incomingLayers = parsed.layers;
            incomingForms = parsed.forms;
            incomingPack = parsed.pack;
            const sz = zip.get( prefix + S.SETTINGS_FILE );
            if ( sz ) { try { incomingSettings = S.parseSettings( await ( await sz.blob() ).text() ); } catch {} }
        } else {
            const text = await file.text();
            const data = JSON.parse( text );
            if ( data && [ 'FeatureCollection', 'Feature' ].includes( data.type ) ) {
                const { meta, info } = await state.layers.addFromText( text, file.name );
                toast( `Added the map layer “${ meta.name }” with ${ plural( info.count, 'feature', 'features' ) }.` );
                return;
            }
            if ( data && data.format === S.SETTINGS_FORMAT ) {
                const incomingOnly = S.parseSettings( text );
                if ( ! confirm( `Use the map settings in “${ file.name }” for this map? This changes its background map${ incomingOnly.view ? ' and starting view' : '' }.` ) ) return;
                applyFolderSettings( incomingOnly, { moveMap: true } );
                await writeFolderSettings();
                toast( 'Map settings imported.' );
                if ( sheet.view === 'settings' ) showSettings();
                return;
            }
            if ( data && data.format === S.FORMAT ) {
                const parsed = S.parseIndex( text );
                incoming = parsed.entries;
                incomingLayers = parsed.layers;
                incomingForms = parsed.forms;
                incomingPack = parsed.pack;
            }
            else if ( Array.isArray( data ) ) incoming = fromWordPress( data );
            else if ( data && Array.isArray( data.submissions ) ) incoming = fromWordPress( data.submissions );
            else if ( data && Array.isArray( data.data ) ) incoming = fromWordPress( data.data );
            else throw new Error( 'This JSON file isn’t a Media Map export.' );
        }
    } catch ( err ) {
        toast( err instanceof SyntaxError ? 'That file isn’t valid JSON.' : err.message, { long: true } );
        return;
    }
    if ( ! incoming.length && ! incomingLayers.length && ! incomingForms.length && ! incomingPack && ! incomingSettings ) { toast( 'No places found in that file.' ); return; }

    const existing = new Map( state.index.entries.map( e => [ e.id, e ] ) );
    const apply = [];
    let added = 0, updated = 0, skipped = 0, missing = 0, n = 0;
    try {
        for ( const e of incoming ) {
            n++;
            if ( incoming.length > 20 && n % 10 === 0 ) toast( `Importing… ${ n } of ${ incoming.length }`, { sticky: true } );
            const cur = existing.get( e.id );
            if ( cur && cur.updated >= e.updated ) { skipped++; continue; }
            // Copy a file referenced by the entry out of the zip (renamed if the name is taken).
            const bring = async ( path, name ) => {
                const zf = zip && zip.get( prefix + path );
                if ( zf ) {
                    if ( ! path.startsWith( S.MEDIA_DIR + '/' ) || isFileUsed( path, e.id ) ) path = await st.freeMediaPath( name );
                    await st.write( path, await zf.blob() );
                } else if ( ! ( await st.exists( path ) ) ) {
                    missing++;
                }
                return path;
            };
            if ( e.file ) e.file.path = await bring( e.file.path, e.file.name );
            for ( const a of e.attachments ) a.path = await bring( a.path, a.name );
            apply.push( e );
            cur ? updated++ : added++;
        }
        // Map layers: same rule, newer copy wins; files come from the zip.
        const applyLayers = [];
        const curLayers = new Map( ( state.index.layers || [] ).map( l => [ l.id, l ] ) );
        let layersAdded = 0;
        for ( const l of incomingLayers ) {
            const cur = curLayers.get( l.id );
            if ( cur && cur.updated >= l.updated ) continue;
            const zf = zip && zip.get( prefix + l.file );
            if ( zf ) {
                let path = l.file;
                const usedElsewhere = ( state.index.layers || [] ).some( x => x.file === path && x.id !== l.id );
                if ( ! path.startsWith( S.LAYER_DIR + '/' ) || usedElsewhere ) path = await st.freeMediaPath( path.split( '/' ).pop(), S.LAYER_DIR );
                await st.write( path, await zf.blob() );
                l.file = path;
            } else if ( ! ( await st.exists( l.file ) ) ) {
                missing++;
                continue;
            }
            applyLayers.push( l );
            if ( ! cur ) layersAdded++;
        }
        // Forms: same rule.
        const applyForms = [];
        const curForms = new Map( ( state.index.forms || [] ).map( f => [ f.id, f ] ) );
        let formsAdded = 0;
        for ( const f of incomingForms ) {
            const cur = curForms.get( f.id );
            if ( cur && cur.updated >= f.updated ) continue;
            const zf = zip && zip.get( prefix + f.file );
            if ( zf ) {
                let path = f.file;
                const usedElsewhere = ( state.index.forms || [] ).some( x => x.file === path && x.id !== f.id );
                if ( ! path.startsWith( S.FORM_DIR + '/' ) || usedElsewhere ) path = await st.freeMediaPath( path.split( '/' ).pop(), S.FORM_DIR );
                await st.write( path, await zf.blob() );
                f.file = path;
            } else if ( ! ( await st.exists( f.file ) ) ) {
                missing++;
                continue;
            }
            applyForms.push( f );
            if ( ! cur ) formsAdded++;
        }
        if ( incomingSettings && wasEmpty ) {
            applyFolderSettings( incomingSettings, { moveMap: ! apply.length } );
            await writeFolderSettings();
        }
        if ( apply.length || applyLayers.length || applyForms.length ) {
            await mutate( ix => {
                for ( const e of apply ) {
                    const i = ix.entries.findIndex( x => x.id === e.id );
                    if ( i >= 0 ) ix.entries[ i ] = e; else ix.entries.push( e );
                }
                ix.layers = ix.layers || [];
                for ( const l of applyLayers ) {
                    const i = ix.layers.findIndex( x => x.id === l.id );
                    if ( i >= 0 ) ix.layers[ i ] = l; else ix.layers.push( l );
                }
                ix.forms = ix.forms || [];
                for ( const f of applyForms ) {
                    const i = ix.forms.findIndex( x => x.id === f.id );
                    if ( i >= 0 ) ix.forms[ i ] = f; else ix.forms.push( f );
                }
            } );
            if ( apply.length ) fitAll();
        }
        const parts = [];
        if ( added )   parts.push( `${ plural( added, 'place', 'places' ) } added` );
        if ( updated ) parts.push( `${ updated } updated` );
        if ( skipped ) parts.push( `${ skipped } already up to date` );
        if ( layersAdded ) parts.push( plural( layersAdded, 'map layer', 'map layers' ) + ' added' );
        if ( formsAdded ) parts.push( plural( formsAdded, 'form', 'forms' ) + ' added' );
        let msg = parts.length ? parts.join( ', ' ) + '.' : 'Nothing to import.';
        if ( missing ) msg += ` ${ plural( missing, 'file wasn’t', 'files weren’t' ) } included; those places keep their details without the file.`;
        toast( msg.charAt( 0 ).toUpperCase() + msg.slice( 1 ), { long: true } );
        // Student backups carry the pack they started from; don't re-apply it each time.
        const cur = state.index.pack;
        const samePack = incomingPack && cur && cur.title === incomingPack.title && cur.created === incomingPack.created;
        if ( incomingPack && ! samePack ) await applyPack( incomingPack );
        else if ( sheet.view === 'settings' ) showSettings();
    } catch ( err ) {
        toast( 'Import stopped: ' + err.message, { long: true } );
    }
}
$( '#import-input' ).addEventListener( 'change', e => {
    const file = e.target.files && e.target.files[ 0 ];
    e.target.value = '';
    if ( file && state.store ) importFile( file );
} );

/* ------------------------------------------------------------------ */
/* Class pack: forms + layers + map settings + instructions in one zip */
/* ------------------------------------------------------------------ */
function showPackMaker() {
    const idx = state.index;
    const nForms = ( idx.forms || [] ).length, nLayers = ( idx.layers || [] ).length;
    const c = state.map.getCenter();
    const body = openSheet( 'pack', 'Create a class pack', `
        <p>The pack contains your ${ plural( nForms, 'form', 'forms' ) } and ${ plural( nLayers, 'map layer', 'map layers' ) }, plus anything you choose below. Share the file however you like: email, messaging, a shared drive or a USB stick.</p>
        <label class="lbl">Title<input type="text" class="field" data-p-title maxlength="200" value="${ esc( ( idx.pack && idx.pack.title ) || '' ) }" placeholder="For example, Class 9 river survey"></label>
        <label class="lbl">Instructions for students
            <textarea class="field" data-p-instr rows="6" maxlength="5000" placeholder="What to record, which form to fill in at each site, when to hand in…">${ esc( ( idx.pack && idx.pack.instructions ) || '' ) }</textarea>
        </label>
        <fieldset class="opts">
            <legend>Also include</legend>
            <label class="check"><input type="checkbox" data-p-map checked> This map’s settings and the current view (${ fmtCoord( c.lat ) }, ${ fmtCoord( c.lng ) }, zoom ${ Math.round( state.map.getZoom() ) })</label>
            <label class="check"><input type="checkbox" data-p-places ${ idx.entries.length ? '' : 'disabled' }> The places on the map now (${ idx.entries.length }), for example sample sites</label>
        </fieldset>
        <p class="form-error" data-p-err hidden role="alert"></p>
        <div class="actions wrap">
            <button type="button" class="btn btn-primary" data-p-make>Create pack</button>
        </div>`, { backTo: showSettings } );
    if ( ! body ) return;
    $( '[data-p-make]', body ).addEventListener( 'click', async ev => {
        const title = $( '[data-p-title]', body ).value.trim();
        const err = $( '[data-p-err]', body );
        if ( ! title ) { err.textContent = 'Give the pack a title.'; err.hidden = false; return; }
        err.hidden = true;
        const btn = ev.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Creating…';
        try {
            const center = state.map.getCenter();
            const pack = S.cleanPack( {
                title,
                instructions: $( '[data-p-instr]', body ).value.trim(),
                map: $( '[data-p-map]', body ).checked ? {
                    tileUrl: settings.tileUrl, attribution: settings.attribution, maxZoom: settings.maxZoom,
                    lat: center.lat, lng: center.lng, zoom: state.map.getZoom(),
                } : null,
            } );
            const out = {
                format: S.FORMAT, version: S.FORMAT_VERSION, updated: new Date().toISOString(),
                entries: $( '[data-p-places]', body ).checked ? idx.entries : [],
                layers: idx.layers || [], forms: idx.forms || [], pack,
            };
            const files = [ { name: S.INDEX_FILE, data: JSON.stringify( out, null, 2 ) + '\n' } ];
            for ( const path of dataFiles( out ) ) {
                try { const f = await state.store.getFile( path ); files.push( { name: path, data: f, date: new Date( f.lastModified ) } ); } catch {}
            }
            const zip = await makeZipFile( files );
            const name = `media-map-pack-${ S.safeFileName( title, 60 ) || 'class' }.zip`;
            await mutate( ix => { ix.pack = pack; } );
            const file = new File( [ zip ], name, { type: 'application/zip' } );
            let shared = false;
            if ( isSmall() && navigator.canShare && navigator.canShare( { files: [ file ] } ) ) {
                try { await navigator.share( { files: [ file ], title } ); shared = true; } catch {}
            }
            if ( ! shared ) download( file, name );
            toast( `Class pack “${ title }” created (${ M.formatBytes( zip.size ) }).`, { long: true } );
            showSettings();
        } catch ( e ) {
            toast( 'Could not create the pack: ' + e.message, { long: true } );
            btn.disabled = false;
            btn.textContent = 'Create pack';
        }
    } );
}

/** After importing a pack: remember it, offer its map settings, show its instructions. */
async function applyPack( pack ) {
    await mutate( ix => { ix.pack = pack; } ).catch( () => {} );
    if ( pack.map ) {
        const differs = pack.map.tileUrl !== settings.tileUrl;
        if ( ! differs || confirm( `Use the map from “${ pack.title }”? This changes the background map to the one chosen for the pack.` ) ) {
            settings.tileUrl = pack.map.tileUrl;
            settings.attribution = pack.map.attribution;
            settings.maxZoom = pack.map.maxZoom;
            saveSettings( 'tileUrl', 'attribution', 'maxZoom' );
            state.map.setMaxZoom( settings.maxZoom );
            if ( differs ) setTiles();
        }
        state.map.setView( [ pack.map.lat, pack.map.lng ], pack.map.zoom );
    }
    showPackInfo( pack );
}

function showPackInfo( pack, backTo = null ) {
    if ( ! pack ) return;
    const body = openSheet( 'pack-info', pack.title, `
        ${ pack.instructions ? `<div class="pack-instructions">${ esc( pack.instructions ) }</div>` : '<p>This pack has no instructions.</p>' }
        <p class="muted small">You can read these again in Settings, under Class pack.</p>
        <div class="actions"><button type="button" class="btn btn-primary" data-start>${ backTo ? 'Done' : 'Start mapping' }</button></div>`, { backTo } );
    if ( ! body ) return;
    $( '[data-start]', body ).addEventListener( 'click', () => ( backTo ? backTo() : closeSheet() ) );
}

/* ------------------------------------------------------------------ */
/* Changing where data is kept                                         */
/* ------------------------------------------------------------------ */
async function switchStorage( kind ) {
    let target;
    try {
        target = kind === 'folder' ? await S.pickFolder() : await S.privateStore();
    } catch ( err ) {
        if ( err.name !== 'AbortError' ) toast( 'Could not open that folder: ' + err.message, { long: true } );
        return;
    }
    const cur = state.store;
    if ( cur && cur.kind === target.kind && ( target.kind === 'private' || await target.root.isSameEntry( cur.root ) ) ) {
        toast( 'Your data is already saved there.' );
        return;
    }
    try {
        const { index: there } = await target.readIndex();
        if ( there.entries.length ) {
            if ( ! confirm( `“${ target.name }” already holds ${ plural( there.entries.length, 'place', 'places' ) }. Switch to it? Your current places stay where they are; use Export and Import to combine them.` ) ) return;
        } else if ( cur && dataFiles().length + state.index.entries.length ) {
            const files = dataFiles();
            let done = 0;
            for ( const path of files ) {
                try { await target.write( path, await cur.getFile( path ) ); } catch {}
                if ( ++done % 5 === 0 ) toast( `Copying files… ${ done } of ${ files.length }`, { sticky: true } );
            }
            await target.saveIndex( JSON.parse( JSON.stringify( state.index ) ) );
        }
        await S.remember( target );
        state.fittedOnce = false;
        await useStore( target );
        toast( there.entries.length ? `Opened “${ target.name }”.` : `Your places are now saved in “${ target.name }”.`, { long: true } );
        if ( sheet.view === 'settings' ) showSettings();
    } catch ( err ) {
        toast( 'Could not use that folder: ' + err.message, { long: true } );
    }
}

function updateWhere() {
    const b = $( '#where' );
    if ( ! state.store ) { b.hidden = true; return; }
    b.hidden = false;
    const name = state.store.kind === 'folder' ? state.store.name : 'On this device';
    $( '#where-name' ).textContent = name;
    b.setAttribute( 'aria-label', state.store.kind === 'folder' ? `Data saved in folder ${ name }` : 'Data saved in app storage on this device' );
}

/* ------------------------------------------------------------------ */
/* Welcome                                                             */
/* ------------------------------------------------------------------ */
function showWelcome( mode, handle ) {
    const card = $( '#welcome-card' );
    const canAny = S.supportsFolder || S.supportsPrivate;
    if ( mode === 'error' ) {
        card.innerHTML = `
            <h1 id="welcome-title">Your map couldn’t be opened</h1>
            <p class="notice">${ esc( handle.message ) }</p>
            <p>Nothing has been changed${ handle.store.kind === 'folder' ? ` in the folder “${ esc( handle.store.name ) }”` : '' }.</p>
            <div class="stack">
                <button type="button" class="btn btn-primary btn-big" data-act="retry">Try again</button>
                ${ S.supportsFolder ? '<button type="button" class="btn" data-act="folder">Open a different folder</button>' : '' }
            </div>`;
    } else if ( mode === 'reconnect' ) {
        card.innerHTML = `
            <h1 id="welcome-title">Open “${ esc( handle.name ) }” again</h1>
            <p>Your places are saved in that folder. The browser asks for permission before the app can use it again.</p>
            <div class="stack">
                <button type="button" class="btn btn-primary btn-big" data-act="reconnect">Allow access to “${ esc( handle.name ) }”</button>
                <button type="button" class="btn" data-act="folder">Choose a different folder</button>
            </div>`;
    } else {
        card.innerHTML = `
            <h1 id="welcome-title">Where should your map be saved?</h1>
            <p>Media Map keeps everything on this device. There’s no account, and nothing is uploaded.</p>
            ${ canAny ? '' : '<p class="notice">This browser can’t save files for web apps. Use a recent version of Chrome, Edge, Safari or Firefox.</p>' }
            <div class="choices">
                ${ S.supportsFolder ? `
                <button type="button" class="choice" data-act="folder">
                    <span class="choice-title">Choose a folder</span>
                    <span class="choice-text">Places are saved as <code>mediamap.json</code> with your files in a <code>media</code> folder you can open, copy and back up. Pick an existing Media Map folder to open it.</span>
                </button>` : '' }
                ${ S.supportsPrivate ? `
                <button type="button" class="choice" data-act="private">
                    <span class="choice-title">${ S.supportsFolder ? 'Keep it inside the app' : 'Start mapping' }</span>
                    <span class="choice-text">Saved in the app’s own storage on this device. Export a backup from Settings whenever you want a copy${ S.supportsFolder ? '' : ' in your files' }.</span>
                </button>` : '' }
            </div>
            ${ canAny ? '<button type="button" class="btn-link" data-act="restore">Restore from a backup</button>' : '' }`;
    }
    $( '#welcome' ).hidden = false;
    card.onclick = async ev => {
        const act = ev.target.closest( '[data-act]' )?.dataset.act;
        if ( ! act ) return;
        if ( act === 'retry' ) { location.reload(); return; }
        try {
            let store;
            if ( act === 'reconnect' ) store = await S.reconnectFolder( handle );
            else if ( act === 'folder' && mode === 'error' ) store = await S.pickFolder();
            else if ( act === 'folder' || ( act === 'restore' && S.supportsFolder ) ) store = await S.pickFolder();
            else store = await S.privateStore();
            await useStore( store );
            await S.remember( store );
            if ( act === 'restore' ) $( '#import-input' ).click();
        } catch ( err ) {
            if ( err.name !== 'AbortError' ) toast( err.message, { long: true } );
        }
    };
    const first = $( 'button', card );
    first && first.focus();
}
function hideWelcome() { $( '#welcome' ).hidden = true; }

/* ------------------------------------------------------------------ */
/* Share target: other apps can share a link into Media Map            */
/* ------------------------------------------------------------------ */
let shareHandled = false;
function handleShareTarget() {
    if ( shareHandled ) return;
    shareHandled = true;
    const p = new URLSearchParams( location.search );
    if ( ! p.has( 'share_url' ) && ! p.has( 'share_text' ) && ! p.has( 'share_title' ) ) return;
    const text = p.get( 'share_text' ) || '';
    const url  = p.get( 'share_url' ) || ( text.match( /https?:\/\/\S+/ ) || [] )[ 0 ] || '';
    const title = p.get( 'share_title' ) || '';
    history.replaceState( null, '', location.pathname );
    showForm( null, { url, place: title, description: text.replace( url, '' ).trim() } );
    toast( 'Now tap the map to choose where this belongs.' );
}

/* ------------------------------------------------------------------ */
/* Service worker + install                                            */
/* ------------------------------------------------------------------ */
function registerSW() {
    if ( ! ( 'serviceWorker' in navigator ) || ! window.isSecureContext ) return;
    const hadController = !! navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener( 'controllerchange', () => {
        if ( ! hadController || reloading ) return;
        reloading = true;
        location.reload();
    } );
    window.addEventListener( 'load', async () => {
        try {
            const reg = await navigator.serviceWorker.register( 'sw.js' );
            state.swReg = reg;
            const onWaiting = w => toast( 'A new version of Media Map is ready.', {
                action: 'Update now', sticky: true,
                onAction: () => {
                    if ( state.form && state.form.dirty ) { toast( 'Save or cancel the place you’re editing first.' ); return; }
                    w.postMessage( { type: 'skipWaiting' } );
                },
            } );
            if ( reg.waiting && hadController ) onWaiting( reg.waiting );
            reg.addEventListener( 'updatefound', () => {
                const w = reg.installing;
                w && w.addEventListener( 'statechange', () => {
                    if ( w.state === 'installed' && navigator.serviceWorker.controller ) onWaiting( w );
                } );
            } );
        } catch ( err ) {
            console.warn( 'Service worker registration failed', err );
        }
    } );
}
window.addEventListener( 'beforeinstallprompt', e => { e.preventDefault(); state.installEvt = e; } );
window.addEventListener( 'appinstalled', () => { state.installEvt = null; toast( 'Media Map is installed.' ); } );

/* ------------------------------------------------------------------ */
/* Global events                                                       */
/* ------------------------------------------------------------------ */
// No right-click / long-press menu anywhere in the app, except in text
// fields, where it's needed for copy and paste.
document.addEventListener( 'contextmenu', e => {
    if ( e.target.closest( 'input, textarea, [contenteditable="true"]' ) ) return;
    e.preventDefault();
} );

function updateOnline() { $( '#offline-chip' ).hidden = navigator.onLine; }
window.addEventListener( 'online', updateOnline );
window.addEventListener( 'offline', updateOnline );

document.addEventListener( 'keydown', e => {
    if ( e.key !== 'Escape' ) return;
    if ( ! lightbox.hidden ) { closeLightbox(); return; }
    if ( ! sheet.el.hidden && ! e.target.closest( '.results' ) ) closeSheet();
} );
document.addEventListener( 'visibilitychange', () => {
    if ( document.visibilityState === 'visible' ) reloadFromDisk( 'Loaded changes made outside the app.' );
} );
channel && channel.addEventListener( 'message', e => {
    if ( e.data && e.data.type === 'changed' ) reloadFromDisk( 'Updated from another window.' );
} );

$( '#btn-add' ).addEventListener( 'click', () => {
    if ( ! state.store ) return;
    if ( state.form && ! state.form.id ) return;
    if ( ! confirmLeave() ) return;
    showForm();
} );
$( '#btn-locate' ).addEventListener( 'click', () => locate( !! state.form ) );
$( '#btn-list' ).addEventListener( 'click', () => ( sheet.view === 'list' ? closeSheet() : showList() ) );
$( '#btn-layers' ).addEventListener( 'click', () => {
    if ( ! state.store ) return;
    if ( sheet.view === 'layers' || sheet.view === 'layer' ) closeSheet(); else state.layers.showPanel();
} );
$( '#btn-settings' ).addEventListener( 'click', () => { if ( state.store ) ( sheet.view === 'settings' ? closeSheet() : showSettings() ); } );
$( '#where' ).addEventListener( 'click', () => showSettings() );

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
async function boot() {
    state.forms = createForms( {
        getStore: () => state.store,
        getIndex: () => state.index,
        mutate,
        toast,
        onAttached: id => renderAttachments( id ),
        confirm: msg => confirm( msg ),
    } );
    registerSW();
    updateOnline();
    S.kvSet( 'maxTiles', settings.maxTiles ).catch( () => {} );
    shareTilePattern();
    initMap();
    state.reports = createReports( {
        map: state.map,
        layers: state.layers,
        getIndex: () => state.index,
        getSettings: () => settings,
        types: TYPES,
        download,
        toast,
        fmtDate,
        openSheet: ( view, title, html, opts ) => ( confirmLeave() ? openSheet( view, title, html, opts ) : null ),
    } );
    state.offline = createOffline( { map: state.map, getSettings: () => settings, toast, confirm: msg => confirm( msg ) } );
    let r;
    try { r = await S.openSaved(); }
    catch { r = { state: 'none' }; }
    if ( r.state === 'needs-permission' ) { showWelcome( 'reconnect', r.handle ); return; }
    if ( r.state !== 'ready' ) { showWelcome( 'first' ); return; }
    try { await useStore( r.store ); }
    catch ( err ) { showWelcome( 'error', { message: err.message, store: r.store } ); }
}
boot();
