/**
 * GeoJSON map layers.
 * Files live in <data folder>/layers/*.geojson; their display settings are
 * kept in mediamap.json under "layers" (top of the list draws on top).
 */
import * as S from './store.js';
import { icon } from './icons.js';

const CATEGORY_COLORS = [ '#1F77B4', '#FF7F0E', '#2CA02C', '#D62728', '#9467BD', '#8C564B',
                          '#E377C2', '#7F7F7F', '#BCBD22', '#17BECF', '#393B79', '#AD494A' ];
const RAMP = [ '#FFE08A', '#FDB44E', '#F47C3C', '#D8433A', '#8E1B3D' ];
const MAX_LABELS = 2000;
const PRINT_MAX_LABELS = 10000;   // the print map drops overlapping labels, so it can take more
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

const esc = s => String( s ?? '' ).replace( /[&<>"']/g, c => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } )[ c ] );
const plural = ( n, one, many ) => `${ n.toLocaleString() } ${ n === 1 ? one : many }`;

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */
const GEOM = [ 'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection' ];

/** Validate and normalise GeoJSON text into a FeatureCollection. */
export function parseGeoJSON( text ) {
    let data;
    try { data = JSON.parse( text ); }
    catch { throw new Error( 'This file isn’t valid JSON.' ); }
    let features;
    if ( data && data.type === 'FeatureCollection' && Array.isArray( data.features ) ) features = data.features;
    else if ( data && data.type === 'Feature' ) features = [ data ];
    else if ( data && GEOM.includes( data.type ) ) features = [ { type: 'Feature', properties: {}, geometry: data } ];
    else throw new Error( 'This isn’t a GeoJSON file (no FeatureCollection, Feature or geometry found).' );

    features = features.filter( f => f && f.type === 'Feature' && f.geometry && GEOM.includes( f.geometry.type ) );
    if ( ! features.length ) throw new Error( 'The GeoJSON file has no features with a geometry.' );

    // Spot-check coordinates: GeoJSON must be longitude/latitude (WGS 84).
    let checked = 0;
    const walk = c => {
        if ( checked > 2000 || ! Array.isArray( c ) ) return;
        if ( typeof c[ 0 ] === 'number' ) {
            checked++;
            if ( Math.abs( c[ 0 ] ) > 180.0001 || Math.abs( c[ 1 ] ) > 90.0001 ) {
                throw new Error( 'The coordinates aren’t longitude/latitude. Export the file again as GeoJSON in WGS 84 (EPSG:4326).' );
            }
            return;
        }
        for ( const x of c ) walk( x );
    };
    const walkGeom = g => g.type === 'GeometryCollection' ? ( g.geometries || [] ).forEach( walkGeom ) : walk( g.coordinates );
    for ( const f of features ) { walkGeom( f.geometry ); if ( checked > 2000 ) break; }

    const fc = { type: 'FeatureCollection', features: features.map( f => ( { type: 'Feature', properties: f.properties && typeof f.properties === 'object' ? f.properties : {}, geometry: f.geometry, ...( f.id != null ? { id: f.id } : {} ) } ) ) };
    if ( data.name && typeof data.name === 'string' ) fc.name = data.name;
    return { fc, info: describe( fc ) };
}

/** Geometry kinds, property names and whether simplestyle colours are present. */
export function describe( fc ) {
    const kinds = new Set();
    const props = new Map();
    let fileStyle = false;
    const kindOf = t => ( /Point/.test( t ) ? 'points' : /Line/.test( t ) ? 'lines' : /Polygon/.test( t ) ? 'areas' : '' );
    fc.features.forEach( ( f, i ) => {
        const g = f.geometry;
        if ( g.type === 'GeometryCollection' ) ( g.geometries || [] ).forEach( x => kinds.add( kindOf( x.type ) ) );
        else kinds.add( kindOf( g.type ) );
        if ( i < 2000 ) {
            for ( const [ k, v ] of Object.entries( f.properties || {} ) ) {
                if ( props.size < 150 || props.has( k ) ) props.set( k, ( props.get( k ) || 0 ) + ( v != null && v !== '' ? 1 : 0 ) );
                if ( ! fileStyle && [ 'stroke', 'fill', 'marker-color' ].includes( k ) && HEX.test( v ) ) fileStyle = true;
            }
        }
    } );
    kinds.delete( '' );
    const styleKeys = new Set( [ 'stroke', 'stroke-width', 'stroke-opacity', 'fill', 'fill-opacity', 'marker-color', 'marker-size', 'marker-symbol' ] );
    return {
        count: fc.features.length,
        kinds: [ 'points', 'lines', 'areas' ].filter( k => kinds.has( k ) ),
        props: [ ...props.entries() ].filter( ( [ k, n ] ) => n > 0 && ! styleKeys.has( k ) ).map( ( [ k ] ) => k ),
        fileStyle,
    };
}

/* ------------------------------------------------------------------ */
/* Colour by data                                                      */
/* ------------------------------------------------------------------ */
export function classify( fc, prop, fallback ) {
    if ( ! prop ) return null;
    const values = [];
    for ( const f of fc.features ) {
        const v = f.properties ? f.properties[ prop ] : undefined;
        if ( v !== undefined && v !== null && v !== '' ) values.push( v );
    }
    if ( ! values.length ) return null;
    const isNum = v => typeof v === 'number' || ( typeof v === 'string' && v.trim() !== '' && Number.isFinite( Number( v ) ) );
    const distinct = new Set( values.map( String ) );

    if ( values.every( isNum ) && distinct.size > 8 ) {
        const nums = values.map( Number ).sort( ( a, b ) => a - b );
        const q = p => nums[ Math.min( nums.length - 1, Math.floor( p * nums.length ) ) ];
        const breaks = [ nums[ 0 ], q( 0.2 ), q( 0.4 ), q( 0.6 ), q( 0.8 ), nums[ nums.length - 1 ] ];
        const classes = [];
        for ( let i = 0; i < 5; i++ ) {
            if ( i > 0 && breaks[ i ] === breaks[ i - 1 ] && breaks[ i + 1 ] === breaks[ i ] ) continue;
            classes.push( { min: breaks[ i ], max: breaks[ i + 1 ], color: RAMP[ i ], label: `${ fmtNum( breaks[ i ] ) } – ${ fmtNum( breaks[ i + 1 ] ) }` } );
        }
        return {
            kind: 'range', classes,
            colorFor: v => {
                if ( ! isNum( v ) ) return null;
                const n = Number( v );
                for ( const c of classes ) if ( n <= c.max ) return c.color;
                return classes[ classes.length - 1 ].color;
            },
        };
    }
    const counts = new Map();
    for ( const v of values ) counts.set( String( v ), ( counts.get( String( v ) ) || 0 ) + 1 );
    const sorted = [ ...counts.entries() ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] || a[ 0 ].localeCompare( b[ 0 ], undefined, { numeric: true } ) );
    const top = sorted.slice( 0, CATEGORY_COLORS.length );
    const map = new Map( top.map( ( [ v ], i ) => [ v, CATEGORY_COLORS[ i ] ] ) );
    const classes = top.map( ( [ v, n ] ) => ( { label: v, count: n, color: map.get( v ) } ) );
    if ( sorted.length > top.length ) classes.push( { label: `Other (${ sorted.length - top.length })`, color: fallback, other: true } );
    return { kind: 'category', classes, colorFor: v => ( v == null || v === '' ? null : map.get( String( v ) ) || fallback ) };
}
function fmtNum( n ) {
    const a = Math.abs( n );
    return a >= 1000 ? Math.round( n ).toLocaleString() : a >= 10 ? ( Math.round( n * 10 ) / 10 ).toString() : ( Math.round( n * 100 ) / 100 ).toString();
}

function featureStyle( f, st, cls ) {
    const p = f.properties || {};
    const isLine = /Line/.test( f.geometry.type );
    let stroke = st.stroke, fill = st.fill, weight = st.weight, opacity = st.opacity, fillOpacity = st.fillOpacity;
    if ( cls ) {
        const c = cls.colorFor( p[ st.colorBy ] );
        if ( c ) { fill = c; if ( isLine ) stroke = c; }
    }
    if ( st.useFileStyle ) {
        if ( HEX.test( p.stroke ) ) stroke = p.stroke;
        if ( HEX.test( p.fill ) ) fill = p.fill;
        if ( HEX.test( p[ 'marker-color' ] ) && /Point/.test( f.geometry.type ) ) fill = p[ 'marker-color' ];
        if ( Number.isFinite( +p[ 'stroke-width' ] ) && p[ 'stroke-width' ] !== '' ) weight = +p[ 'stroke-width' ];
        if ( Number.isFinite( +p[ 'stroke-opacity' ] ) && p[ 'stroke-opacity' ] !== '' ) opacity = +p[ 'stroke-opacity' ];
        if ( Number.isFinite( +p[ 'fill-opacity' ] ) && p[ 'fill-opacity' ] !== '' ) fillOpacity = +p[ 'fill-opacity' ];
    }
    const w = Math.max( weight, 1 );
    return {
        color: stroke, weight, opacity: weight > 0 ? opacity : 0,
        fillColor: fill, fillOpacity: isLine ? 0 : fillOpacity,
        dashArray: st.dash === 'dashed' ? `${ w * 3 } ${ w * 2 }` : st.dash === 'dotted' ? `1 ${ w * 2.2 }` : null,
        lineCap: 'round',
        radius: st.radius,
        stroke: weight > 0,
    };
}

/** Small legend swatch for a layer or class. */
function swatch( kinds, color, st ) {
    if ( kinds.length === 1 && kinds[ 0 ] === 'lines' ) {
        return `<svg width="22" height="12" aria-hidden="true"><line x1="1" y1="6" x2="21" y2="6" stroke="${ color }" stroke-width="${ Math.min( 5, Math.max( 1.5, st.weight ) ) }" stroke-linecap="round" ${ st.dash === 'dashed' ? 'stroke-dasharray="5 3"' : st.dash === 'dotted' ? 'stroke-dasharray="1 4"' : '' }/></svg>`;
    }
    if ( kinds.length === 1 && kinds[ 0 ] === 'points' ) {
        return `<svg width="22" height="14" aria-hidden="true"><circle cx="11" cy="7" r="5" fill="${ color }" fill-opacity="${ Math.max( 0.35, st.fillOpacity ) }" stroke="${ st.stroke }" stroke-width="1.5"/></svg>`;
    }
    return `<svg width="22" height="14" aria-hidden="true"><rect x="2" y="1.5" width="18" height="11" rx="2" fill="${ color }" fill-opacity="${ Math.max( 0.3, st.fillOpacity ) }" stroke="${ st.stroke }" stroke-width="1.5"/></svg>`;
}

/* ------------------------------------------------------------------ */
/* Clusters and label tidying                                          */
/* ------------------------------------------------------------------ */
const isPointFeature = f => !! ( f && f.geometry && /Point/.test( f.geometry.type ) );

/** Text colour that stays readable on a given fill. */
function inkOn( hex ) {
    let h = String( hex ).replace( '#', '' );
    if ( h.length === 3 ) h = h.replace( /./g, c => c + c );
    const n = parseInt( h, 16 );
    if ( ! Number.isFinite( n ) ) return '#fff';
    const lum = ( 0.299 * ( n >> 16 & 255 ) + 0.587 * ( n >> 8 & 255 ) + 0.114 * ( n & 255 ) ) / 255;
    return lum > 0.6 ? '#1B2A3A' : '#fff';
}

/** Cluster bubble in the layer's colour (the most common colour of its points). */
function clusterIcon( cluster, st, cls ) {
    const n = cluster.getChildCount();
    const kids = cluster.getAllChildMarkers();
    const tally = new Map();
    for ( let i = 0; i < kids.length && i < 150; i++ ) {
        const f = kids[ i ].feature;
        const c = f ? featureStyle( f, st, cls ).fillColor : st.fill;
        tally.set( c, ( tally.get( c ) || 0 ) + 1 );
    }
    let color = st.fill, best = 0;
    for ( const [ c, k ] of tally ) if ( k > best ) { best = k; color = c; }
    const d = Math.round( 24 + Math.min( 22, Math.log10( n ) * 9 ) );
    const label = n >= 10000 ? Math.round( n / 1000 ) + 'k' : n >= 1000 ? ( Math.round( n / 100 ) / 10 ) + 'k' : String( n );
    return L.divIcon( {
        className: 'geo-cluster',
        iconSize: [ d, d ],
        html: `<span style="background:${ color };color:${ inkOn( color ) };border-color:${ st.stroke }">${ label }</span>`,
    } );
}

/**
 * Hide labels that would overlap one another (or a cluster bubble), so the
 * map stays readable when zoomed out. Earlier entries in `labelled` win, so
 * the layer at the top of the list keeps its labels first. Zooming in frees
 * space and brings hidden labels back.
 */
function tidyLabels( map, labelled, clusterGroups ) {
    if ( ! map || ! map._loaded ) return;
    const pb = map.getPixelBounds(), origin = map.getPixelOrigin();
    const view = { x0: pb.min.x - origin.x - 50, y0: pb.min.y - origin.y - 50, x1: pb.max.x - origin.x + 50, y1: pb.max.y - origin.y + 50 };
    const CELL = 80, grid = new Map(), PAD = 3;
    const cells = ( r, fn ) => {
        for ( let gx = Math.floor( r.x0 / CELL ); gx <= Math.floor( r.x1 / CELL ); gx++ )
            for ( let gy = Math.floor( r.y0 / CELL ); gy <= Math.floor( r.y1 / CELL ); gy++ ) if ( fn( gx + ':' + gy ) === true ) return true;
        return false;
    };
    const hits = r => cells( r, k => ( grid.get( k ) || [] ).some( o => o.x0 < r.x1 && o.x1 > r.x0 && o.y0 < r.y1 && o.y1 > r.y0 ) );
    const take = r => cells( r, k => { if ( ! grid.has( k ) ) grid.set( k, [] ); grid.get( k ).push( r ); } );

    // Cluster bubbles are obstacles: labels shouldn't sit on top of them.
    for ( const cg of clusterGroups ) {
        if ( ! cg._featureGroup || ! cg._map ) continue;
        cg._featureGroup.eachLayer( m => {
            if ( ! m._icon || ! m.getChildCount ) return;
            const p = map.latLngToLayerPoint( m.getLatLng() );
            const w = m._icon.offsetWidth, h = m._icon.offsetHeight;
            take( { x0: p.x - w / 2, y0: p.y - h / 2, x1: p.x + w / 2, y1: p.y + h / 2 } );
        } );
    }
    for ( const layer of labelled ) {
        const tip = layer.getTooltip && layer.getTooltip();
        const el = tip && tip._map && tip._container;
        if ( ! el ) continue;
        const pos = L.DomUtil.getPosition( el );
        if ( ! pos ) continue;
        if ( el._w == null || el._w === 0 ) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
        const r = { x0: pos.x - PAD, y0: pos.y - PAD, x1: pos.x + el._w + PAD, y1: pos.y + el._h + PAD };
        if ( r.x1 < view.x0 || r.x0 > view.x1 || r.y1 < view.y0 || r.y0 > view.y1 ) continue;
        const clash = hits( r );
        el.style.visibility = clash ? 'hidden' : '';
        if ( ! clash ) take( r );
    }
}

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */
/**
 * @param ctx {
 *   map, getStore(), getIndex(), mutate(fn), toast(msg, opts), openSheet(view, title, html, opts),
 *   closeSheet(), sheetView(), isPicking(), confirm(msg)
 * }
 */
export function createLayers( ctx ) {
    const { map } = ctx;
    const pane = map.createPane( 'geojson' );
    pane.style.zIndex = 350;
    map.createPane( 'geojson-clusters' ).style.zIndex = 555;
    map.createPane( 'geojson-labels' ).style.zIndex = 560;
    const renderer = L.canvas( { pane: 'geojson', padding: 0.3, tolerance: 5 } );
    const items = new Map();   // id -> { meta, fc, info, fileKey, group, styleKey, cls, error, preview }
    let orderKey = '';
    let legend = null;

    /* ---------- label tidying ---------- */
    let tidyFrame = 0;
    function scheduleTidy() {
        if ( tidyFrame ) return;
        tidyFrame = requestAnimationFrame( () => {
            tidyFrame = 0;
            const metas = ( ctx.getIndex().layers || [] ).filter( m => m.visible );
            const shown = metas.map( m => items.get( m.id ) ).filter( it => it && it.group && map.hasLayer( it.group ) );
            tidyLabels( map, shown.flatMap( it => it.labelled || [] ), shown.map( it => it.clusters ).filter( Boolean ) );
        } );
    }
    map.on( 'zoomend moveend resize', scheduleTidy );

    /* ---------- loading & drawing ---------- */
    async function loadData( meta, item ) {
        const st = ctx.getStore();
        const file = await st.getFile( meta.file );
        const key = meta.file + ':' + file.lastModified + ':' + file.size;
        if ( item.fileKey === key && item.fc ) return false;
        const { fc, info } = parseGeoJSON( await file.text() );
        item.fc = fc;
        item.info = info;
        item.fileKey = key;
        return true;
    }

    /** opts.renderer / opts.forPrint let the same layer be drawn on the print map. */
    function build( item, opts = {} ) {
        const meta = item.meta;
        const st = opts.forPrint ? meta.style : ( item.preview || meta.style );
        const cls = classify( item.fc, st.colorBy, st.fill );
        if ( ! opts.forPrint ) item.cls = cls;
        const r = opts.renderer || renderer;
        const feats = item.fc.features;
        const nPoints = feats.reduce( ( n, f ) => n + ( isPointFeature( f ) ? 1 : 0 ), 0 );
        // Points are grouped into clusters when zoomed out (not on the print map).
        const clustered = ! opts.forPrint && st.cluster && nPoints > 0;
        // Clustered points only draw labels for what is on screen, so they have
        // no limit; everything else is capped to keep the map responsive.
        const labelPoints = st.label && ( clustered || feats.length <= ( opts.forPrint ? PRINT_MAX_LABELS : MAX_LABELS ) );
        const labelOthers = st.label && ( opts.forPrint ? feats.length <= PRINT_MAX_LABELS : feats.length - nPoints <= MAX_LABELS );
        const labelled = [];
        const tip = ( layer, text, isPoint ) => {
            layer.bindTooltip( text, {
                permanent: true, direction: isPoint ? 'right' : 'center', offset: isPoint ? [ st.radius + 2, 0 ] : [ 0, 0 ],
                className: 'geo-label', pane: 'geojson-labels', interactive: false,
            } );
            labelled.push( layer );
        };
        const geo = L.geoJSON( item.fc, {
            renderer: r,
            pane: 'geojson',
            interactive: ! opts.forPrint,
            style: f => featureStyle( f, st, cls ),
            pointToLayer: ( f, latlng ) => L.circleMarker( latlng, { renderer: r, pane: 'geojson', radius: st.radius, interactive: ! opts.forPrint } ),
            onEachFeature: ( f, layer ) => {
                const isPoint = isPointFeature( f );
                // MultiPoints arrive as a group; give each dot the feature so it
                // can be clustered, labelled and clicked on its own.
                if ( isPoint && layer.eachLayer ) layer.eachLayer( l => { l.feature = f; } );
                if ( ! ( isPoint ? labelPoints : labelOthers ) ) return;
                const v = f.properties ? f.properties[ st.label ] : null;
                if ( v == null || v === '' ) return;
                const text = String( v ).slice( 0, 80 );
                if ( isPoint && layer.eachLayer ) layer.eachLayer( l => tip( l, text, true ) );
                else tip( layer, text, isPoint );
            },
        } );
        // Points first: they are the most precise, so their labels win.
        labelled.sort( ( a, b ) => ( a instanceof L.CircleMarker ? 0 : 1 ) - ( b instanceof L.CircleMarker ? 0 : 1 ) );

        let group = geo, clusters = null;
        if ( clustered ) {
            const dots = [];
            for ( const l of [ ...geo.getLayers() ] ) {
                if ( ! isPointFeature( l.feature ) ) continue;
                geo.removeLayer( l );
                if ( l.eachLayer ) l.eachLayer( d => dots.push( d ) ); else dots.push( l );
            }
            clusters = L.markerClusterGroup( {
                clusterPane: 'geojson-clusters',
                maxClusterRadius: z => z <= 8 ? 70 : z >= 15 ? 30 : 50,
                showCoverageOnHover: false,
                spiderfyOnMaxZoom: true,
                chunkedLoading: true,
                removeOutsideVisibleBounds: true,
                iconCreateFunction: c => clusterIcon( c, st, cls ),
            } );
            clusters.addLayers( dots );
            group = L.featureGroup( [ geo, clusters ] );
        }
        item.labelled = labelled;
        item.clusters = clusters;
        if ( opts.forPrint ) return group;
        if ( clusters ) clusters.on( 'animationend spiderfied unspiderfied', scheduleTidy );
        group.on( 'click', e => {
            if ( ctx.isPicking() ) return;
            const f = e.layer && e.layer.feature;
            if ( ! f ) return;
            L.popup( { maxWidth: 320, className: 'geo-popup', autoPanPadding: [ 20, 70 ] } )
                .setLatLng( e.latlng )
                .setContent( popupHtml( meta, f ) )
                .openOn( map );
        } );
        return group;
    }

    function popupHtml( meta, f ) {
        const p = f.properties || {};
        const st = meta.style;
        const titleKey = [ st.label, 'name', 'Name', 'NAME', 'title', 'Title' ].find( k => k && p[ k ] != null && p[ k ] !== '' );
        const styleKeys = [ 'stroke', 'stroke-width', 'stroke-opacity', 'fill', 'fill-opacity', 'marker-color', 'marker-size', 'marker-symbol' ];
        const rows = Object.entries( p )
            .filter( ( [ k, v ] ) => k !== titleKey && v !== null && v !== undefined && v !== '' && ! styleKeys.includes( k ) )
            .slice( 0, 40 )
            .map( ( [ k, v ] ) => {
                let val = typeof v === 'object' ? JSON.stringify( v ) : String( v );
                val = val.length > 300 ? val.slice( 0, 300 ) + '…' : val;
                const cell = /^https?:\/\/\S+$/i.test( val ) ? `<a href="${ esc( val ) }" target="_blank" rel="noopener noreferrer">${ esc( val ) }</a>` : esc( val );
                return `<tr><th scope="row">${ esc( k ) }</th><td>${ cell }</td></tr>`;
            } ).join( '' );
        return `<div class="geo-pop">
            <p class="geo-pop-layer">${ esc( meta.name ) }</p>
            ${ titleKey ? `<p class="geo-pop-title">${ esc( p[ titleKey ] ) }</p>` : '' }
            ${ rows ? `<div class="geo-pop-scroll"><table>${ rows }</table></div>` : ( titleKey ? '' : '<p class="muted">No details for this feature.</p>' ) }
        </div>`;
    }

    /**
     * Bring map layers in line with the index. Calls are serialised (file
     * reads are async) and collapsed: at most one run waits behind the
     * current one, and it always uses the latest index.
     */
    let running = null, pending = false;
    function sync() {
        if ( running ) { pending = true; return running; }
        running = ( async () => {
            do {
                pending = false;
                try { await doSync( ctx.getIndex().layers ); } catch ( err ) { console.warn( err ); }
            } while ( pending );
            running = null;
        } )();
        return running;
    }
    async function doSync( metas ) {
        metas = metas || [];
        const ids = new Set( metas.map( m => m.id ) );
        for ( const [ id, item ] of items ) {
            if ( ! ids.has( id ) ) { item.group && map.removeLayer( item.group ); items.delete( id ); }
        }
        let rebuilt = false;
        for ( const meta of metas ) {
            let item = items.get( meta.id );
            if ( ! item ) { item = { meta }; items.set( meta.id, item ); }
            item.meta = meta;
            if ( ! meta.visible ) {
                if ( item.group && map.hasLayer( item.group ) ) map.removeLayer( item.group );
                continue;
            }
            try {
                const changed = await loadData( meta, item );
                item.error = '';
                const styleKey = JSON.stringify( item.preview || meta.style );
                if ( changed || ! item.group || item.styleKey !== styleKey ) {
                    item.group && map.removeLayer( item.group );
                    item.group = build( item );
                    item.styleKey = styleKey;
                    rebuilt = true;
                }
                // Clustering needs a known maximum zoom (normally set by the basemap).
                if ( item.clusters && ! Number.isFinite( map.getMaxZoom() ) ) map.setMaxZoom( 19 );
                if ( ! map.hasLayer( item.group ) ) { item.group.addTo( map ); rebuilt = true; }
            } catch ( err ) {
                item.error = err && err.name === 'NotFoundError' ? `The file ${ meta.file } is missing from the data folder.` : ( err.message || String( err ) );
                if ( item.group ) { map.removeLayer( item.group ); item.group = null; }
            }
        }
        // Draw order: last in the list is drawn first (bottom).
        const key = metas.filter( m => m.visible ).map( m => m.id ).join( ',' );
        if ( rebuilt || key !== orderKey ) {
            orderKey = key;
            for ( const meta of [ ...metas ].reverse() ) {
                const it = items.get( meta.id );
                if ( it && it.group && map.hasLayer( it.group ) ) it.group.bringToFront();
            }
        }
        updateLegend( metas );
        scheduleTidy();
        if ( ctx.sheetView() === 'layers' ) renderPanelList();
    }

    function updateLegend( metas ) {
        const shown = metas.filter( m => m.visible && items.get( m.id ) && items.get( m.id ).group );
        if ( ! shown.length ) { if ( legend ) { legend.remove(); legend = null; } return; }
        if ( ! legend ) {
            legend = L.control( { position: 'bottomleft' } );
            legend.onAdd = () => {
                const div = L.DomUtil.create( 'div', 'legend' );
                L.DomEvent.disableClickPropagation( div );
                L.DomEvent.disableScrollPropagation( div );
                return div;
            };
            legend.addTo( map );
        }
        const div = legend.getContainer();
        const wasOpen = div.querySelector( 'details' ) ? div.querySelector( 'details' ).open : window.matchMedia( '(min-width: 720px)' ).matches;
        div.innerHTML = `<details${ wasOpen ? ' open' : '' }><summary>Layers</summary><ul>${ legendItems( shown ) }</ul></details>`;
    }

    function legendItems( shown ) {
        return shown.map( m => {
            const it = items.get( m.id );
            const st = it.preview || m.style;
            const kinds = it.info ? it.info.kinds : [];
            const sub = it.cls ? `<ul class="legend-classes">${ it.cls.classes.map( c =>
                `<li>${ swatch( kinds, c.color, { ...st, stroke: kinds.length === 1 && kinds[ 0 ] === 'lines' ? c.color : st.stroke } ) }<span>${ esc( c.label ) }</span></li>` ).join( '' ) }</ul>` : '';
            return `<li><span class="legend-row">${ swatch( kinds, kinds.length === 1 && kinds[ 0 ] === 'lines' ? st.stroke : st.fill, st ) }<span>${ esc( m.name ) }</span></span>${ sub }</li>`;
        } ).join( '' );
    }

    /**
     * Draw every visible layer on another map (the print map) as crisp SVG.
     * Returns { bounds, legend } where legend is <li> markup for the key.
     */
    function addToMap( target ) {
        if ( ! target.getPane( 'geojson' ) ) {
            target.createPane( 'geojson' ).style.zIndex = 350;
            target.createPane( 'geojson-labels' ).style.zIndex = 560;
        }
        const svg = L.svg( { pane: 'geojson', padding: 0.2 } );
        const bounds = L.latLngBounds( [] );
        const metas = ( ctx.getIndex().layers || [] ).filter( m => m.visible && items.get( m.id ) && items.get( m.id ).fc );
        const labelled = new Map();
        for ( const meta of [ ...metas ].reverse() ) {
            const it = items.get( meta.id );
            const live = { labelled: it.labelled, clusters: it.clusters };
            const g = build( it, { renderer: svg, forPrint: true } ).addTo( target );
            labelled.set( meta.id, it.labelled );
            Object.assign( it, live );
            const b = g.getBounds();
            if ( b.isValid() ) bounds.extend( b );
        }
        // Call once the print map has its final view, to drop overlapping labels.
        const tidy = () => tidyLabels( target, metas.flatMap( m => labelled.get( m.id ) || [] ), [] );
        return { bounds, legend: legendItems( metas ), tidy };
    }

    function zoomTo( id ) {
        const it = items.get( id );
        if ( ! it || ! it.group ) return;
        const b = it.group.getBounds();
        const [ px, py ] = ctx.coveredBy ? ctx.coveredBy() : [ 0, 0 ];
        if ( b.isValid() ) map.fitBounds( b, { paddingTopLeft: [ 40, 40 ], paddingBottomRight: [ 40 + px, 40 + py ], maxZoom: 17 } );
    }

    /* ---------- adding ---------- */
    async function addFromText( text, name ) {
        const { fc, info } = parseGeoJSON( text );
        const st = ctx.getStore();
        const idx = ctx.getIndex();
        const base = String( fc.name || name || 'layer' ).replace( /\.(geo)?json$/i, '' ).slice( 0, 80 ) || 'layer';
        const path = await st.freeMediaPath( base + '.geojson', S.LAYER_DIR );
        await st.write( path, JSON.stringify( fc ) );
        const color = S.LAYER_COLORS[ ( idx.layers || [] ).length % S.LAYER_COLORS.length ];
        const style = S.defaultStyle( color );
        if ( info.kinds.length === 1 && info.kinds[ 0 ] === 'lines' ) style.weight = 3;
        const meta = S.cleanLayer( { id: S.newId(), name: base, file: path, visible: true, style, features: info.count } );
        try {
            await ctx.mutate( ix => { ix.layers = [ meta, ...( ix.layers || [] ) ]; } );
        } catch ( err ) {
            await st.remove( path ).catch( () => {} );
            throw err;
        }
        await sync();
        zoomTo( meta.id );
        return { meta, info };
    }

    async function addFiles( files ) {
        for ( const file of files ) {
            try {
                if ( file.size > 60 * 1024 * 1024 ) throw new Error( 'files over 60 MB are too large to display smoothly. Simplify the data first.' );
                const { meta, info } = await addFromText( await file.text(), file.name );
                ctx.toast( `Added “${ meta.name }” with ${ plural( info.count, 'feature', 'features' ) }.` );
            } catch ( err ) {
                ctx.toast( `Couldn’t add ${ file.name }: ${ err.message }`, { long: true } );
            }
        }
    }

    async function addFromUrl( url ) {
        if ( ! navigator.onLine ) { ctx.toast( 'Adding a layer from the web needs an internet connection.' ); return; }
        let text;
        try {
            const res = await fetch( url, { mode: 'cors' } );
            if ( ! res.ok ) throw new Error( `the server answered ${ res.status }` );
            text = await res.text();
        } catch ( err ) {
            ctx.toast( `Couldn’t download the file (${ err.message === 'Failed to fetch' ? 'the server doesn’t allow it or is unreachable' : err.message }). Download it and add the file instead.`, { long: true } );
            return false;
        }
        try {
            const name = decodeURIComponent( new URL( url ).pathname.split( '/' ).pop() || 'layer' );
            const { meta, info } = await addFromText( text, name );
            ctx.toast( `Added “${ meta.name }” with ${ plural( info.count, 'feature', 'features' ) }.` );
            return true;
        } catch ( err ) {
            ctx.toast( err.message, { long: true } );
            return false;
        }
    }

    /* ---------- panel ---------- */
    function showPanel() {
        const body = ctx.openSheet( 'layers', 'Map layers', `
            <p class="muted">Show GeoJSON data, such as boundaries, routes or survey points, underneath your places. Layer files are saved in the <code>layers</code> folder with your data.</p>
            <ul class="layer-list" data-layer-list></ul>
            <div class="actions wrap">
                <label class="btn btn-primary file-btn">Add GeoJSON file<input type="file" data-add-file accept=".geojson,.json,application/geo+json,application/json" multiple></label>
            </div>
            <form class="lbl" data-add-url>
                <label for="layer-url">Or add from a web address</label>
                <div class="loc-row">
                    <input id="layer-url" type="url" class="field" inputmode="url" placeholder="https://example.org/data.geojson" required>
                    <button type="submit" class="btn">Add</button>
                </div>
                <small class="hint">A copy is saved with your data, so it works offline. The website must allow downloads by other apps.</small>
            </form>` );
        if ( ! body ) return;
        $( '[data-add-file]', body ).addEventListener( 'change', async e => {
            const files = [ ...e.target.files ];
            e.target.value = '';
            await addFiles( files );
        } );
        $( '[data-add-url]', body ).addEventListener( 'submit', async e => {
            e.preventDefault();
            const input = $( '#layer-url', body );
            const btn = $( 'button', e.target );
            btn.disabled = true;
            if ( await addFromUrl( input.value.trim() ) ) input.value = '';
            btn.disabled = false;
        } );
        renderPanelList();
    }

    function renderPanelList() {
        const ul = document.querySelector( '[data-layer-list]' );
        if ( ! ul ) return;
        const metas = ctx.getIndex().layers || [];
        if ( ! metas.length ) {
            ul.innerHTML = '<li class="empty">No layers yet. Add a <code>.geojson</code> file to get started.</li>';
            return;
        }
        ul.innerHTML = metas.map( ( m, i ) => {
            const it = items.get( m.id ) || {};
            const kinds = it.info ? it.info.kinds : [];
            const st = m.style;
            const sub = it.error ? `<span class="layer-err">${ esc( it.error ) }</span>`
                : `<span class="layer-sub">${ plural( m.features || ( it.info ? it.info.count : 0 ), 'feature', 'features' ) }${ kinds.length ? ': ' + kinds.join( ', ' ) : '' }</span>`;
            return `<li class="layer-row" data-id="${ esc( m.id ) }">
                <input type="checkbox" class="layer-vis" data-vis ${ m.visible ? 'checked' : '' } aria-label="Show ${ esc( m.name ) }">
                <span class="layer-swatch">${ swatch( kinds.length ? kinds : [ 'areas' ], kinds.length === 1 && kinds[ 0 ] === 'lines' ? st.stroke : st.fill, st ) }</span>
                <button type="button" class="layer-main" data-edit>
                    <span class="layer-name">${ esc( m.name ) }</span>${ sub }
                </button>
                <span class="layer-btns">
                    <button type="button" class="icon-btn small" data-up aria-label="Move ${ esc( m.name ) } up" ${ i === 0 ? 'disabled' : '' }>${ icon( 'up', 18 ) }</button>
                    <button type="button" class="icon-btn small" data-down aria-label="Move ${ esc( m.name ) } down" ${ i === metas.length - 1 ? 'disabled' : '' }>${ icon( 'down', 18 ) }</button>
                    <button type="button" class="icon-btn small" data-zoom aria-label="Zoom to ${ esc( m.name ) }" ${ m.visible && ! it.error ? '' : 'disabled' }>${ icon( 'fit', 18 ) }</button>
                </span>
            </li>`;
        } ).join( '' );
        ul.querySelectorAll( '.layer-row' ).forEach( row => {
            const id = row.dataset.id;
            $( '[data-vis]', row ).addEventListener( 'change', e => update( id, m => { m.visible = e.target.checked; } ) );
            $( '[data-edit]', row ).addEventListener( 'click', () => showEditor( id ) );
            $( '[data-zoom]', row ).addEventListener( 'click', () => zoomTo( id ) );
            $( '[data-up]', row ).addEventListener( 'click', () => move( id, -1 ) );
            $( '[data-down]', row ).addEventListener( 'click', () => move( id, 1 ) );
        } );
    }

    function update( id, fn ) {
        return ctx.mutate( ix => {
            const m = ( ix.layers || [] ).find( l => l.id === id );
            if ( m ) { fn( m ); m.updated = new Date().toISOString(); }
        } ).catch( err => ctx.toast( 'Could not save: ' + err.message, { long: true } ) );
    }
    function move( id, dir ) {
        return ctx.mutate( ix => {
            const i = ix.layers.findIndex( l => l.id === id );
            const j = i + dir;
            if ( i < 0 || j < 0 || j >= ix.layers.length ) return;
            [ ix.layers[ i ], ix.layers[ j ] ] = [ ix.layers[ j ], ix.layers[ i ] ];
        } ).then( () => {
            const btn = document.querySelector( `.layer-row[data-id="${ CSS.escape( id ) }"] [data-${ dir < 0 ? 'up' : 'down' }]` );
            btn && ! btn.disabled && btn.focus();
        } ).catch( err => ctx.toast( 'Could not save: ' + err.message, { long: true } ) );
    }

    /* ---------- style editor ---------- */
    async function showEditor( id ) {
        const meta = ( ctx.getIndex().layers || [] ).find( l => l.id === id );
        if ( ! meta ) return;
        let item = items.get( id );
        if ( ! item ) { item = { meta }; items.set( id, item ); }
        let info = item.info;
        if ( ! info ) {
            try { await loadData( meta, item ); info = item.info; }
            catch { info = { count: meta.features, kinds: [ 'points', 'lines', 'areas' ], props: [], fileStyle: false }; }
        }
        const st = { ...meta.style };
        const has = k => info.kinds.includes( k );
        const opts = ( sel, first ) => `<option value="">${ first }</option>` + info.props.map( p => `<option value="${ esc( p ) }"${ p === sel ? ' selected' : '' }>${ esc( p ) }</option>` ).join( '' );
        const range = ( k, label, min, max, step, fmt ) => `
            <label class="style-row"><span>${ label }</span>
                <input type="range" data-k="${ k }" min="${ min }" max="${ max }" step="${ step }" value="${ st[ k ] }">
                <output data-out="${ k }">${ fmt( st[ k ] ) }</output></label>`;
        const pct = v => Math.round( v * 100 ) + '%';
        const px  = v => v + ' px';
        let saved = false;

        const body = ctx.openSheet( 'layer', meta.name, `
            <label class="lbl">Name<input type="text" class="field" data-name maxlength="200" value="${ esc( meta.name ) }"></label>
            <p class="muted small">${ plural( info.count, 'feature', 'features' ) }${ info.kinds.length ? ' (' + info.kinds.join( ', ' ) + ')' : '' }. Saved as <code>${ esc( meta.file ) }</code>.</p>

            <section class="set">
                <h3>${ has( 'lines' ) && ! has( 'areas' ) && ! has( 'points' ) ? 'Lines' : 'Lines and outlines' }</h3>
                <label class="style-row"><span>Colour</span><input type="color" data-k="stroke" value="${ st.stroke }"></label>
                ${ range( 'weight', 'Width', 0, 12, 0.5, px ) }
                ${ range( 'opacity', 'Opacity', 0, 1, 0.05, pct ) }
                <label class="style-row"><span>Style</span>
                    <select class="field" data-k="dash">
                        <option value="solid"${ st.dash === 'solid' ? ' selected' : '' }>Solid</option>
                        <option value="dashed"${ st.dash === 'dashed' ? ' selected' : '' }>Dashed</option>
                        <option value="dotted"${ st.dash === 'dotted' ? ' selected' : '' }>Dotted</option>
                    </select></label>
            </section>
            ${ has( 'areas' ) || has( 'points' ) ? `
            <section class="set">
                <h3>Fill</h3>
                <label class="style-row"><span>Colour</span><input type="color" data-k="fill" value="${ st.fill }"></label>
                ${ range( 'fillOpacity', 'Opacity', 0, 1, 0.05, pct ) }
            </section>` : '' }
            ${ has( 'points' ) ? `
            <section class="set">
                <h3>Points</h3>
                ${ range( 'radius', 'Size', 2, 20, 1, px ) }
                <label class="check"><input type="checkbox" data-k="cluster" ${ st.cluster !== false ? 'checked' : '' }> Group nearby points into clusters when zoomed out</label>
            </section>` : '' }
            <section class="set">
                <h3>Colour by data</h3>
                ${ info.props.length ? `
                <select class="field" data-k="colorBy" aria-label="Colour by property">${ opts( st.colorBy, 'Use one colour' ) }</select>
                <div class="class-preview" data-classes></div>` : '<p class="muted">This layer has no properties to colour by.</p>' }
            </section>
            <section class="set">
                <h3>Labels</h3>
                ${ info.props.length ? `
                <select class="field" data-k="label" aria-label="Label property">${ opts( st.label, 'No labels' ) }</select>
                <small class="hint">Labels that would overlap are hidden until you zoom in.${ info.count > MAX_LABELS ? ` Labels for lines and areas are only drawn for layers with up to ${ MAX_LABELS.toLocaleString() } features; clustered points are always labelled.` : '' }</small>` : '<p class="muted">This layer has no properties to use as labels.</p>' }
                ${ info.fileStyle ? `<label class="check"><input type="checkbox" data-k="useFileStyle" ${ st.useFileStyle ? 'checked' : '' }> Use colours saved in the file where features have them</label>` : '' }
            </section>
            <div class="actions wrap">
                <button type="button" class="btn btn-primary" data-save>Save style</button>
                <button type="button" class="btn" data-cancel>Cancel</button>
                <button type="button" class="btn btn-danger push-right" data-delete>Delete layer</button>
            </div>`, {
            backTo: showPanel,
            onLeave: () => {
                if ( ! saved && item.preview ) { item.preview = null; sync( ctx.getIndex().layers ); }
            },
        } );
        if ( ! body ) return;

        const renderClasses = () => {
            const box = $( '[data-classes]', body );
            if ( ! box ) return;
            const cls = item.fc && st.colorBy ? classify( item.fc, st.colorBy, st.fill ) : null;
            box.innerHTML = cls ? `<ul>${ cls.classes.map( c => `<li><span class="class-dot" style="background:${ c.color }"></span>${ esc( c.label ) }${ c.count ? ` <span class="muted">(${ c.count })</span>` : '' }</li>` ).join( '' ) }</ul>
                <small class="hint">${ cls.kind === 'range' ? 'Numbers are split into five equal-sized groups.' : cls.classes.some( c => c.other ) ? 'The 12 most common values get their own colour.' : 'Each value gets its own colour.' }</small>` : '';
        };
        renderClasses();

        let t;
        const applyPreview = () => {
            clearTimeout( t );
            t = setTimeout( () => { item.preview = { ...st }; sync( ctx.getIndex().layers ); }, 60 );
        };
        body.querySelectorAll( '[data-k]' ).forEach( input => {
            const k = input.dataset.k;
            const ev = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
            input.addEventListener( ev, () => {
                st[ k ] = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number( input.value ) : input.value;
                const out = $( `[data-out="${ k }"]`, body );
                if ( out ) out.textContent = k === 'opacity' || k === 'fillOpacity' ? pct( st[ k ] ) : px( st[ k ] );
                if ( k === 'colorBy' || k === 'fill' ) renderClasses();
                applyPreview();
            } );
        } );
        $( '[data-save]', body ).addEventListener( 'click', async () => {
            const name = $( '[data-name]', body ).value.trim() || meta.name;
            saved = true;
            item.preview = null;
            await update( id, m => { m.name = name; m.style = S.cleanStyle( st ); } );
            ctx.toast( 'Layer style saved.' );
            showPanel();
        } );
        $( '[data-cancel]', body ).addEventListener( 'click', () => showPanel() );
        $( '[data-delete]', body ).addEventListener( 'click', async () => {
            if ( ! ctx.confirm( `Delete the layer “${ meta.name }”? Its file will be removed from the data folder.` ) ) return;
            saved = true;
            item.preview = null;
            try {
                await ctx.mutate( ix => { ix.layers = ( ix.layers || [] ).filter( l => l.id !== id ); } );
                const stillUsed = ( ctx.getIndex().layers || [] ).some( l => l.file === meta.file );
                if ( ! stillUsed ) await ctx.getStore().remove( meta.file ).catch( () => {} );
                ctx.toast( 'Layer deleted.' );
                showPanel();
            } catch ( err ) {
                ctx.toast( 'Could not delete: ' + err.message, { long: true } );
            }
        } );
    }

    function reset() {
        for ( const it of items.values() ) it.group && map.removeLayer( it.group );
        items.clear();
        orderKey = '';
        if ( legend ) { legend.remove(); legend = null; }
    }

    return { sync, showPanel, addFromText, addFiles, zoomTo, reset, addToMap, hasPreview: () => [ ...items.values() ].some( i => i.preview ) };
}

function $( sel, root = document ) { return root.querySelector( sel ); }
