/**
 * Google Street View links: recognise them and turn them into an embeddable viewer address.
 *
 * Understood (any Google country domain, e.g. google.co.in):
 *   https://www.google.com/maps/@26.18,91.74,3a,75y,90h,95t/data=!3m6!1e1!3m4!1s<pano>!2e0…   shared from Google Maps
 *   https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=26.18,91.74&heading=90&pano=…   Maps URLs
 *   https://maps.google.com/?layer=c&cbll=26.18,91.74&cbp=12,90,,0,0&panoid=…                     older links
 *   https://www.google.com/maps/embed?pb=…!6m8!1m7!1s<pano>…                                       "Embed a map" from Street View
 *   https://www.google.com/maps/embed/v1/streetview?key=…&location=…                                Maps Embed API
 *   <iframe src="…"> embed code pasted from Google Maps (the src is used)
 * Short maps.app.goo.gl links can't be resolved in the browser and stay ordinary links.
 *
 * The viewer address: with a panorama ID, the keyless embed that Google's own "Share › Embed a map"
 * produces. With only a location, the Maps Embed API when a key is set in Settings, otherwise
 * Google's older keyless viewer. Views keep the heading and tilt of the original link.
 */

const GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i;
const PB_ZOOM = '0.7820865974627469';
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;

let apiKey = '';
/** Optional Google Maps Embed API key (device setting). */
export function setStreetViewKey( k ) { apiKey = String( k || '' ).trim(); }

const num = x => {
    if ( x === null || x === undefined || x === '' ) return null;
    const n = parseFloat( x );
    return Number.isFinite( n ) ? n : null;
};
const round = ( n, d ) => Math.round( n * 10 ** d ) / 10 ** d;
const clampPitch = p => round( Math.max( -90, Math.min( 90, p ) ), 2 );
const clampFov = f => round( Math.max( 10, Math.min( 100, f ) ), 0 );
function safeDecode( s ) { try { return decodeURIComponent( s ); } catch { return s; } }
/** Trailing punctuation from prose, and &amp; from pasted HTML. */
const cleanUrl = s => String( s ).replace( /&amp;/g, '&' ).replace( /[),.;:!?\]}'"]+$/, '' );

/** The src of a pasted <iframe> embed code, or the text itself. */
function unwrapIframe( s ) {
    const m = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec( s );
    return m ? m[ 1 ] : s;
}

/** Details of a Street View link, or null. {lat, lng, heading, pitch, fov, pano, embed?, open} */
export function parseStreetView( raw ) {
    let u;
    try { u = new URL( cleanUrl( unwrapIframe( String( raw || '' ).trim() ) ) ); } catch { return null; }
    if ( ! /^https?:$/.test( u.protocol ) || ! GOOGLE_HOST.test( u.hostname ) ) return null;
    const q = u.searchParams;
    const path = safeDecode( u.pathname );
    const r = { lat: null, lng: null, heading: null, pitch: null, fov: null, pano: null, open: u.href };

    // Maps Embed API: the key is already in the address.
    if ( /^\/maps\/embed\/v1\/streetview/i.test( u.pathname ) ) {
        const loc = ( q.get( 'location' ) || '' ).split( ',' );
        Object.assign( r, { lat: num( loc[ 0 ] ), lng: num( loc[ 1 ] ), pano: q.get( 'pano' ),
            heading: num( q.get( 'heading' ) ), pitch: num( q.get( 'pitch' ) ), fov: num( q.get( 'fov' ) ) } );
        r.embed = 'https://www.google.com' + u.pathname + u.search;
        r.open = mapsUrl( r );
        return r;
    }
    // Keyless "Embed a map" address; Street View ones carry !6m…!1m…!1s<pano>.
    if ( /^\/maps\/embed\/?$/i.test( u.pathname ) && q.get( 'pb' ) ) {
        const pb = q.get( 'pb' );
        const m = /!6m\d+!1m\d+!1s([^!]+)(?:!2m2!1d(-?[\d.]+)!2d(-?[\d.]+))?(?:!3f(-?[\d.]+))?(?:!4f(-?[\d.]+))?/.exec( pb );
        if ( ! m ) return null;
        Object.assign( r, { pano: safeDecode( m[ 1 ] ), lat: num( m[ 2 ] ), lng: num( m[ 3 ] ), heading: num( m[ 4 ] ), pitch: num( m[ 5 ] ) } );
        r.embed = 'https://www.google.com/maps/embed?pb=' + pb.replace( /[\s"<>]/g, encodeURIComponent );
        r.open = mapsUrl( r );
        return r;
    }
    // Maps URLs: /maps/@?api=1&map_action=pano
    if ( ( q.get( 'map_action' ) || '' ).toLowerCase() === 'pano' ) {
        const vp = ( q.get( 'viewpoint' ) || '' ).split( ',' );
        Object.assign( r, { lat: num( vp[ 0 ] ), lng: num( vp[ 1 ] ), pano: q.get( 'pano' ) || null,
            heading: num( q.get( 'heading' ) ), pitch: num( q.get( 'pitch' ) ), fov: num( q.get( 'fov' ) ) } );
        return r.pano || r.lat !== null ? r : null;
    }
    // Shared from Google Maps: …/@lat,lng,3a,75y,90h,95t/data=!3m…!1e1!3m…!1s<pano>!2e0
    const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)((?:,[^,/]+)*)/.exec( path );
    if ( at ) {
        let isPano = /!1e1(?:!|$)/.test( path );
        for ( const t of ( at[ 3 ] || '' ).split( ',' ).filter( Boolean ) ) {
            const v = num( t ), unit = t.slice( -1 );
            if ( v === null ) continue;
            if ( unit === 'a' ) isPano = true;
            else if ( unit === 'h' ) r.heading = v;
            else if ( unit === 't' ) r.pitch = v - 90;     // 90t = level with the horizon
            else if ( unit === 'y' ) r.fov = v;
        }
        if ( ! isPano ) return null;                         // an ordinary map view, not Street View
        const pm = /!1s([^!/?]+)!2e\d+/.exec( path );
        if ( pm ) r.pano = safeDecode( pm[ 1 ] );
        r.lat = num( at[ 1 ] ); r.lng = num( at[ 2 ] );
        return r;
    }
    // Older links: ?layer=c&cbll=lat,lng&cbp=12,heading,,zoom,pitch&panoid=…
    if ( q.get( 'cbll' ) || q.get( 'panoid' ) || ( q.get( 'layer' ) === 'c' && q.get( 'll' ) ) ) {
        const ll = ( q.get( 'cbll' ) || q.get( 'll' ) || '' ).split( ',' );
        const cbp = ( q.get( 'cbp' ) || '' ).split( ',' );
        const lp = num( cbp[ 4 ] );
        Object.assign( r, { lat: num( ll[ 0 ] ), lng: num( ll[ 1 ] ), pano: q.get( 'panoid' ) || null,
            heading: num( cbp[ 1 ] ), pitch: lp === null ? null : -lp } );   // older links count pitch downwards
        return r.pano || r.lat !== null ? r : null;
    }
    return null;
}

function mapsUrl( r ) {
    let s = 'https://www.google.com/maps/@?api=1&map_action=pano';
    if ( r.lat !== null && r.lng !== null ) s += `&viewpoint=${ r.lat },${ r.lng }`;
    if ( r.pano ) s += '&pano=' + encodeURIComponent( r.pano );
    if ( r.heading !== null ) s += '&heading=' + round( r.heading, 2 );
    if ( r.pitch !== null ) s += '&pitch=' + clampPitch( r.pitch );
    if ( r.fov !== null ) s += '&fov=' + clampFov( r.fov );
    return s;
}

/** Address to load in an <iframe>, or '' when there's nothing to show. */
export function streetViewSrc( r ) {
    if ( ! r ) return '';
    if ( r.embed ) return r.embed;
    const h = r.heading === null ? 0 : round( r.heading, 2 );
    const p = r.pitch === null ? 0 : clampPitch( r.pitch );
    const hasLoc = r.lat !== null && r.lng !== null;
    if ( apiKey && ( r.pano || hasLoc ) ) {
        return 'https://www.google.com/maps/embed/v1/streetview?key=' + encodeURIComponent( apiKey ) +
            ( r.pano ? '&pano=' + encodeURIComponent( r.pano ) : `&location=${ r.lat },${ r.lng }` ) +
            `&heading=${ h }&pitch=${ p }` + ( r.fov !== null ? '&fov=' + clampFov( r.fov ) : '' );
    }
    if ( r.pano ) {
        const pano = /^[\w-]+$/.test( r.pano ) ? r.pano : encodeURIComponent( r.pano );
        return `https://www.google.com/maps/embed?pb=!4v1!6m8!1m7!1s${ pano }!2m2!1d${ hasLoc ? r.lat : 0 }!2d${ hasLoc ? r.lng : 0 }!3f${ h }!4f${ p }!5f${ PB_ZOOM }`;
    }
    if ( hasLoc ) return `https://www.google.com/maps?layer=c&cbll=${ r.lat },${ r.lng }&cbp=11,${ h },0,0,${ -p }&output=svembed`;
    return '';
}

/** Every Street View link inside a longer text (e.g. Google My Maps "gx_media_links"). */
export function findStreetViews( text ) {
    const out = [], seen = new Set();
    const s = String( text || '' );
    const iframe = unwrapIframe( s );
    const candidates = iframe !== s ? [ iframe ] : ( s.match( URL_IN_TEXT ) || [] ).map( cleanUrl );
    for ( const url of candidates ) {
        const r = parseStreetView( url );
        const src = streetViewSrc( r );
        if ( src && ! seen.has( src ) ) { seen.add( src ); out.push( { url, ...r, src } ); }
    }
    return out;
}
