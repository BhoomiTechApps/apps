/**
 * Basemap addresses: accept whatever the user pastes.
 *
 * - XYZ / slippy tiles:   https://host/{z}/{x}/{y}.png, {s} subdomains, {r}
 * - TMS (flipped y):      {-y}
 * - Bing-style quadkeys:  {q} or {quadkey}
 * - WMTS-style names:     {TileMatrix}, {TileRow}, {TileCol}, {zoom}, {level}, {row}, {col}
 * - Bounding boxes:       {bbox}, {bbox-epsg-3857}, {bbox-epsg-4326}, {width}, {height}
 * - JOSM-style switches:  {switch:a,b,c}
 * - WMS base URLs (…/wms or ?service=WMS): turned into a GetMap template
 * - WMTS KVP URLs (?service=WMTS): tile row / col / matrix filled in
 * - ArcGIS MapServer / ImageServer URLs: /tile/{z}/{y}/{x} added
 * - Any scheme (https, http, or anything else); a bare host gets https://
 *
 * Nothing is rejected. Placeholders the app doesn't know are left as they are,
 * so an unusual address is still tried rather than refused.
 */

const E = 20037508.342789244; // half the width of the Web Mercator world, in metres

const TILE_TOKEN = /\{(-?y|x|z|zoom|level|tilematrix|tilerow|tilecol|row|col|q|quadkey|bbox[^}]*)\}/i;

/** Tidy a pasted address into a tile template. Never throws, never refuses. */
export function normalizeBasemap( input ) {
    let s = String( input == null ? '' : input ).trim();
    if ( ! s ) return '';
    // Braces that got percent-encoded when copying from a browser bar.
    s = s.replace( /%7B/gi, '{' ).replace( /%7D/gi, '}' );
    if ( s.startsWith( '//' ) ) s = 'https:' + s;
    else if ( ! /^[a-z][a-z0-9+.-]*:/i.test( s ) ) s = 'https://' + s;

    if ( TILE_TOKEN.test( s ) ) return s;

    let u;
    try { u = new URL( s ); } catch { return s; }
    const params = u.searchParams;
    const get = name => { for ( const [ k, v ] of params ) if ( k.toLowerCase() === name ) return v; return null; };
    const set = ( name, value ) => {
        for ( const k of [ ...params.keys() ] ) if ( k.toLowerCase() === name.toLowerCase() ) params.delete( k );
        params.set( name, value );
    };
    const has = name => get( name.toLowerCase() ) !== null;
    const service = ( get( 'service' ) || '' ).toLowerCase();

    // ArcGIS REST map / image service.
    if ( /\/(MapServer|ImageServer)\/?$/i.test( u.pathname ) ) {
        u.pathname = u.pathname.replace( /\/?$/, '' ) + '/tile/{z}/{y}/{x}';
        return decodeBraces( u.href );
    }

    // WMTS key-value request.
    if ( service === 'wmts' || /\/wmts\/?$/i.test( u.pathname ) ) {
        if ( ! has( 'service' ) ) set( 'SERVICE', 'WMTS' );
        if ( ! has( 'request' ) ) set( 'REQUEST', 'GetTile' );
        if ( ! has( 'version' ) ) set( 'VERSION', '1.0.0' );
        if ( ! has( 'format' ) ) set( 'FORMAT', 'image/png' );
        if ( ! has( 'tilematrixset' ) ) set( 'TILEMATRIXSET', 'GoogleMapsCompatible' );
        set( 'TILEMATRIX', '{z}' );
        set( 'TILEROW', '{y}' );
        set( 'TILECOL', '{x}' );
        return decodeBraces( u.href );
    }

    // WMS: build a GetMap request per 256 px tile in Web Mercator.
    if ( service === 'wms' || /\/wms\/?$/i.test( u.pathname ) || has( 'layers' ) && /getmap/i.test( get( 'request' ) || '' ) ) {
        const version = get( 'version' ) || '1.1.1';
        if ( ! has( 'service' ) ) set( 'SERVICE', 'WMS' );
        set( 'REQUEST', 'GetMap' );
        set( 'VERSION', version );
        if ( ! has( 'layers' ) ) set( 'LAYERS', '' );
        if ( ! has( 'styles' ) ) set( 'STYLES', '' );
        if ( ! has( 'format' ) ) set( 'FORMAT', 'image/png' );
        if ( ! has( 'transparent' ) ) set( 'TRANSPARENT', 'false' );
        for ( const k of [ ...params.keys() ] ) if ( /^(srs|crs)$/i.test( k ) ) params.delete( k );
        params.set( /^1\.3/.test( version ) ? 'CRS' : 'SRS', 'EPSG:3857' );
        set( 'WIDTH', '{width}' );
        set( 'HEIGHT', '{height}' );
        set( 'BBOX', '{bbox-epsg-3857}' );
        return decodeBraces( u.href );
    }

    // Anything else is used exactly as given.
    return s;
}

// URLSearchParams encodes braces, commas and colons; put the readable forms back.
function decodeBraces( href ) {
    return href.replace( /%7B/gi, '{' ).replace( /%7D/gi, '}' ).replace( /%3A/gi, ':' ).replace( /%2F/gi, '/' ).replace( /%2C/gi, ',' );
}

function quadkey( z, x, y ) {
    let q = '';
    for ( let i = z; i > 0; i-- ) {
        const m = 1 << ( i - 1 );
        q += ( ( x & m ) ? 1 : 0 ) + ( ( y & m ) ? 2 : 0 );
    }
    return q || '0';
}

function bbox3857( z, x, y ) {
    const size = 2 * E / 2 ** z;
    return [ -E + x * size, E - ( y + 1 ) * size, -E + ( x + 1 ) * size, E - y * size ];
}
function bbox4326( z, x, y ) {
    const n = 2 ** z;
    const lon = v => v / n * 360 - 180;
    const lat = v => Math.atan( Math.sinh( Math.PI * ( 1 - 2 * v / n ) ) ) * 180 / Math.PI;
    return [ lon( x ), lat( y + 1 ), lon( x + 1 ), lat( y ) ];
}

/** Build one tile's URL. Used by the map, the print view and offline saving, so they all agree. */
export function tileUrlFor( tpl, z, x, y, opts = {} ) {
    const subs = opts.subdomains || 'abc';
    const size = opts.tileSize || 256;
    const pick = list => list[ Math.abs( x + y ) % list.length ];
    return String( tpl ).replace( /\{([^{}]+)\}/g, ( whole, key ) => {
        const k = key.trim().toLowerCase();
        switch ( k ) {
            case 'z': case 'zoom': case 'level': case 'tilematrix': return z;
            case 'x': case 'col': case 'tilecol': return x;
            case 'y': case 'row': case 'tilerow': return y;
            case '-y': return 2 ** z - 1 - y;
            case 's': return pick( subs );
            case 'r': return opts.retina ? '@2x' : '';
            case 'q': case 'quadkey': return quadkey( z, x, y );
            case 'width': case 'height': case 'size': return size;
            case 'bbox': case 'bbox-epsg-3857': case 'bbox-epsg-900913': return bbox3857( z, x, y ).join( ',' );
            case 'bbox-epsg-4326': return bbox4326( z, x, y ).join( ',' );
        }
        if ( k.startsWith( 'switch:' ) ) {
            const list = key.slice( key.indexOf( ':' ) + 1 ).split( ',' ).map( v => v.trim() ).filter( Boolean );
            return list.length ? pick( list ) : '';
        }
        return whole; // unknown: leave it alone
    } );
}

/** A Leaflet tile layer that understands every placeholder above. */
export function createBasemap( tpl, options = {} ) {
    const L = window.L;
    const Layer = L.TileLayer.extend( {
        getTileUrl( coords ) {
            return tileUrlFor( this._url, this._getZoomForUrl(), coords.x, coords.y, {
                retina: this.options.detectRetina && L.Browser.retina && this.options.maxZoom > 0,
                tileSize: this.getTileSize().x,
            } );
        },
    } );
    return new Layer( normalizeBasemap( tpl ), options );
}

/** Regex matching every tile URL a template can produce (for the service worker). */
export function templateRegexSource( tpl ) {
    const t = normalizeBasemap( tpl );
    if ( ! t ) return '';
    return '^' + t.split( /\{[^{}]+\}/ ).map( p => p.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) ).join( '[^/?&#]*' ) + '$';
}
