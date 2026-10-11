/** Media helpers: type detection, embeds, EXIF GPS, photo resizing. */

// "domain" or "domain/path-prefix"; matched on whole host names only,
// so "x.com" never matches netflix.com.
const PLATFORMS = {
    video: [
        'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'vimeo.com', 'dailymotion.com', 'dai.ly',
        'twitch.tv', 'facebook.com/watch', 'fb.watch', 'tiktok.com', 'instagram.com/reel', 'instagram.com/tv',
        'twitter.com', 'x.com', 'v.redd.it', 'streamable.com', 'wistia.com', 'wistia.net', 'loom.com',
        'ted.com', 'bilibili.com', 'rumble.com', 'odysee.com', 'vidyard.com', 'panopto.com',
    ],
    audio: [
        'spotify.com', 'soundcloud.com', 'anchor.fm', 'podcasts.apple.com', 'music.apple.com', 'bandcamp.com',
        'mixcloud.com', 'audiomack.com', 'buzzsprout.com', 'simplecast.com', 'transistor.fm', 'podbean.com',
        'overcast.fm', 'pocketcasts.com', 'audius.co', 'hearthis.at', 'reverbnation.com',
    ],
    image: [
        'imgur.com', 'flickr.com', 'flic.kr', 'unsplash.com', 'pexels.com', 'pixabay.com', '500px.com',
        'deviantart.com', 'artstation.com', 'behance.net', 'dribbble.com', 'instagram.com', 'pinterest.com',
        'pin.it', 'giphy.com', 'tenor.com', 'cloudinary.com', 'imgbb.com', 'ibb.co', 'postimg.cc',
    ],
};
const EXT = {
    image: [ 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff' ],
    video: [ 'mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv', '3gp' ],
    audio: [ 'mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'm4a', 'opus', 'amr', 'weba' ],
    document: [ 'pdf' ],
};
const KINDS = [ 'image', 'video', 'audio', 'document' ];

export function parseUrl( s ) {
    try { const u = new URL( String( s ).trim() ); return /^https?:$/.test( u.protocol ) ? u : null; }
    catch { return null; }
}
export function hostOf( s ) {
    const u = parseUrl( s );
    return u ? u.hostname.replace( /^www\./, '' ) : '';
}
function extOf( name ) {
    const m = /\.([a-z0-9]{2,5})$/i.exec( name || '' );
    return m ? m[ 1 ].toLowerCase() : '';
}
function hostMatches( host, path, entry ) {
    const [ domain, prefix ] = entry.split( /\/(.*)/s );
    if ( host !== domain && ! host.endsWith( '.' + domain ) ) return false;
    return ! prefix || path.startsWith( '/' + prefix );
}

/** 'image' | 'video' | 'audio' | 'document' | '' for an external URL. */
export function typeFromUrl( s ) {
    const u = parseUrl( s );
    if ( ! u ) return '';
    const ext = extOf( u.pathname );
    for ( const t of KINDS ) if ( EXT[ t ].includes( ext ) ) return t;
    const host = u.hostname.toLowerCase().replace( /^www\./, '' );
    for ( const t of [ 'video', 'audio', 'image' ] ) {
        if ( PLATFORMS[ t ].some( e => hostMatches( host, u.pathname, e ) ) ) return t;
    }
    return '';
}

/** 'image' | 'video' | 'audio' | 'document' | '' for a local file. */
export function typeFromFile( mime, name ) {
    if ( mime === 'application/pdf' ) return 'document';
    const m = ( mime || '' ).split( '/' )[ 0 ];
    if ( [ 'image', 'video', 'audio' ].includes( m ) ) return m;
    const ext = extOf( name );
    for ( const t of KINDS ) if ( EXT[ t ].includes( ext ) ) return t;
    return '';
}

export const isPdf = ( mime, name ) => mime === 'application/pdf' || extOf( name ) === 'pdf';

/** How an external URL can be shown inline, or null (link only). */
export function embedFor( s ) {
    const u = parseUrl( s );
    if ( ! u ) return null;
    const host = u.hostname.toLowerCase().replace( /^www\.|^m\./, '' );
    const ext  = extOf( u.pathname );
    if ( ext === 'pdf' ) return { kind: 'pdf', src: u.href };
    for ( const t of [ 'image', 'video', 'audio' ] ) {
        if ( EXT[ t ].includes( ext ) && ext !== 'heic' && ext !== 'heif' ) return { kind: t, src: u.href };
    }
    let id = '';
    if ( host === 'youtu.be' ) id = u.pathname.slice( 1 ).split( '/' )[ 0 ];
    else if ( host.endsWith( 'youtube.com' ) ) {
        id = u.searchParams.get( 'v' ) || ( /^\/(?:shorts|embed|live)\/([\w-]{6,})/.exec( u.pathname ) || [] )[ 1 ] || '';
    }
    if ( /^[\w-]{6,20}$/.test( id ) ) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${ id }`, ratio: '16/9' };

    if ( host === 'vimeo.com' || host === 'player.vimeo.com' ) {
        const m = /\/(?:video\/)?(\d{5,})/.exec( u.pathname );
        if ( m ) return { kind: 'iframe', src: `https://player.vimeo.com/video/${ m[ 1 ] }`, ratio: '16/9' };
    }
    if ( host === 'open.spotify.com' ) {
        const m = /^\/(?:intl-[\w-]+\/)?(track|album|playlist|episode|show)\/(\w+)/.exec( u.pathname );
        if ( m ) return { kind: 'iframe', src: `https://open.spotify.com/embed/${ m[ 1 ] }/${ m[ 2 ] }`, height: m[ 1 ] === 'track' || m[ 1 ] === 'episode' ? 152 : 352 };
    }
    if ( host === 'soundcloud.com' ) {
        return { kind: 'iframe', src: `https://w.soundcloud.com/player/?url=${ encodeURIComponent( u.href ) }&visual=false`, height: 166 };
    }
    return null;
}

/* ------------------------------------------------------------------ */
/* EXIF GPS (JPEG) — lets a photo place itself on the map.             */
/* ------------------------------------------------------------------ */
export async function gpsFromPhoto( file ) {
    try {
        if ( ! /jpe?g$/i.test( file.type ) && ! /\.jpe?g$/i.test( file.name ) ) return null;
        const v = new DataView( await file.slice( 0, 256 * 1024 ).arrayBuffer() );
        if ( v.getUint16( 0 ) !== 0xFFD8 ) return null;
        let p = 2;
        while ( p + 4 < v.byteLength ) {
            const marker = v.getUint16( p );
            const len    = v.getUint16( p + 2 );
            if ( marker === 0xFFE1 && v.getUint32( p + 4 ) === 0x45786966 ) return readGps( v, p + 10 );
            if ( ( marker & 0xFF00 ) !== 0xFF00 || marker === 0xFFDA ) break;
            p += 2 + len;
        }
    } catch {}
    return null;
}
function readGps( v, tiff ) {
    const le  = v.getUint16( tiff ) === 0x4949;
    const u16 = o => v.getUint16( tiff + o, le );
    const u32 = o => v.getUint32( tiff + o, le );
    const ifd0 = u32( 4 );
    let gpsIfd = 0;
    for ( let i = 0, n = u16( ifd0 ); i < n; i++ ) {
        const e = ifd0 + 2 + i * 12;
        if ( u16( e ) === 0x8825 ) gpsIfd = u32( e + 8 );
    }
    if ( ! gpsIfd ) return null;
    const tags = {};
    for ( let i = 0, n = u16( gpsIfd ); i < n; i++ ) {
        const e = gpsIfd + 2 + i * 12;
        const tag = u16( e );
        if ( tag === 1 || tag === 3 ) tags[ tag ] = String.fromCharCode( v.getUint8( tiff + e + 8 ) );
        if ( tag === 2 || tag === 4 ) {
            const off = u32( e + 8 );
            const r = k => { const d = u32( off + k * 8 + 4 ); return d ? u32( off + k * 8 ) / d : 0; };
            tags[ tag ] = r( 0 ) + r( 1 ) / 60 + r( 2 ) / 3600;
        }
    }
    if ( typeof tags[ 2 ] !== 'number' || typeof tags[ 4 ] !== 'number' ) return null;
    const lat = tags[ 2 ] * ( tags[ 1 ] === 'S' ? -1 : 1 );
    const lng = tags[ 4 ] * ( tags[ 3 ] === 'W' ? -1 : 1 );
    if ( ! lat && ! lng ) return null;
    if ( Math.abs( lat ) > 90 || Math.abs( lng ) > 180 ) return null;
    return { lat, lng };
}

/**
 * Downscale large JPEG/WebP photos to save space on the device.
 * Returns a new File, or the original when no change is worthwhile.
 */
export async function shrinkPhoto( file, maxSide = 2560, quality = 0.85 ) {
    if ( ! /^image\/(jpeg|webp)$/.test( file.type ) || typeof createImageBitmap !== 'function' ) return file;
    let bmp;
    try { bmp = await createImageBitmap( file, { imageOrientation: 'from-image' } ); }
    catch { return file; }
    const scale = Math.min( 1, maxSide / Math.max( bmp.width, bmp.height ) );
    if ( scale === 1 && file.size < 1.5 * 1024 * 1024 ) { bmp.close?.(); return file; }
    const c = document.createElement( 'canvas' );
    c.width  = Math.round( bmp.width * scale );
    c.height = Math.round( bmp.height * scale );
    c.getContext( '2d' ).drawImage( bmp, 0, 0, c.width, c.height );
    bmp.close?.();
    const blob = await new Promise( r => c.toBlob( r, 'image/jpeg', quality ) );
    if ( ! blob || blob.size >= file.size ) return file;
    const name = file.name.replace( /\.(jpe?g|webp)$/i, '' ) + '.jpg';
    return new File( [ blob ], name, { type: 'image/jpeg', lastModified: file.lastModified } );
}

export function formatBytes( n ) {
    if ( ! n ) return '0 B';
    const u = [ 'B', 'KB', 'MB', 'GB' ];
    const i = Math.min( u.length - 1, Math.floor( Math.log( n ) / Math.log( 1024 ) ) );
    return `${ ( n / 1024 ** i ).toFixed( i ? 1 : 0 ) } ${ u[ i ] }`;
}
