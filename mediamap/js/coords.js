/**
 * Parse typed coordinates. Accepts, for example:
 *   26.1445, 91.7362          26.1445 91.7362          -33.86 151.21
 *   26.1445N 91.7362E         N26.1445 E91.7362        26.1445° N, 91.7362° E
 *   26°08'40"N 91°44'10"E     26 08 40 N 91 44 10 E    26°08.67'N 91°44.17'E
 * Returns { lat, lng, swapped } or null. "swapped" is true when the numbers
 * only make sense as longitude-first and were swapped.
 */
export function parseCoords( input ) {
    let s = String( input || '' ).trim().toUpperCase();
    if ( ! s ) return null;
    s = s.replace( /[°º˚]/g, ' ' ).replace( /[′’‘`´']/g, ' ' ).replace( /[″”“"]/g, ' ' )
        .replace( /[;|]/g, ',' ).replace( /\s+/g, ' ' ).trim();

    let parts;
    const hemis = s.match( /[NSEW]/g ) || [];
    if ( hemis.length === 2 ) {
        // Split right after the first hemisphere letter when letters follow the numbers,
        // or right before the second letter when they lead ("N26 E91").
        const leading = /^[NSEW]/.test( s );
        const idx = leading ? s.search( /[NSEW](?=[^NSEW]*$)/ ) : s.search( /[NSEW]/ ) + 1;
        parts = [ s.slice( 0, idx ), s.slice( idx ) ];
    } else if ( hemis.length === 0 && s.includes( ',' ) && s.split( ',' ).length === 2 ) {
        parts = s.split( ',' );
    } else if ( hemis.length === 0 ) {
        const nums = s.replace( /,/g, ' ' ).trim().split( ' ' );
        if ( nums.length === 2 ) parts = nums;
        else if ( nums.length === 4 ) parts = [ nums.slice( 0, 2 ).join( ' ' ), nums.slice( 2 ).join( ' ' ) ];
        else if ( nums.length === 6 ) parts = [ nums.slice( 0, 3 ).join( ' ' ), nums.slice( 3 ).join( ' ' ) ];
        else return null;
    } else {
        return null;
    }

    const a = part( parts[ 0 ] ), b = part( parts[ 1 ] );
    if ( ! a || ! b ) return null;
    let lat, lng, swapped = false;
    if ( a.h || b.h ) {
        if ( ( a.h === 'N' || a.h === 'S' ) && ( b.h === 'E' || b.h === 'W' || ! b.h ) ) { lat = a.v; lng = b.v; }
        else if ( ( b.h === 'N' || b.h === 'S' ) && ( a.h === 'E' || a.h === 'W' || ! a.h ) ) { lat = b.v; lng = a.v; }
        else return null;
    } else {
        lat = a.v; lng = b.v;
        if ( Math.abs( lat ) > 90 && Math.abs( lng ) <= 90 ) { [ lat, lng ] = [ lng, lat ]; swapped = true; }
    }
    if ( ! Number.isFinite( lat ) || ! Number.isFinite( lng ) || Math.abs( lat ) > 90 || Math.abs( lng ) > 180 ) return null;
    return { lat, lng, swapped };
}

function part( p ) {
    p = p.replace( /,/g, ' ' ).trim();
    const h = ( p.match( /[NSEW]/ ) || [] )[ 0 ] || '';
    const nums = p.replace( /[NSEW]/g, ' ' ).trim().split( /\s+/ ).filter( Boolean );
    if ( ! nums.length || nums.length > 3 || nums.some( n => ! /^[-+]?\d+(\.\d+)?$/.test( n ) ) ) return null;
    const [ d, m = 0, sec = 0 ] = nums.map( Number );
    if ( nums.length > 1 && ( m >= 60 || sec >= 60 || m < 0 || sec < 0 || ! Number.isInteger( d ) ) ) return null;
    let v = Math.abs( d ) + m / 60 + sec / 3600;
    if ( d < 0 || nums[ 0 ].startsWith( '-' ) || h === 'S' || h === 'W' ) v = -v;
    return { v, h };
}
