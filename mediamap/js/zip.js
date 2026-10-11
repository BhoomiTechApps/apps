/**
 * Minimal ZIP support for backups — no dependencies.
 * Writing: "stored" (no compression; photos/video are already compressed).
 * Reading: stored and deflate (via DecompressionStream), so zips re-packed
 * by other tools can be imported too. No ZIP64 (4 GB limit).
 */

const CRC_TABLE = ( () => {
    const t = new Uint32Array( 256 );
    for ( let n = 0; n < 256; n++ ) {
        let c = n;
        for ( let k = 0; k < 8; k++ ) c = c & 1 ? 0xEDB88320 ^ ( c >>> 1 ) : c >>> 1;
        t[ n ] = c >>> 0;
    }
    return t;
} )();

async function crc32( blob ) {
    let crc = 0xFFFFFFFF;
    const reader = blob.stream().getReader();
    for ( ;; ) {
        const { done, value } = await reader.read();
        if ( done ) break;
        for ( let i = 0; i < value.length; i++ ) crc = CRC_TABLE[ ( crc ^ value[ i ] ) & 0xFF ] ^ ( crc >>> 8 );
    }
    return ( crc ^ 0xFFFFFFFF ) >>> 0;
}

function dosTime( d ) {
    return {
        time: ( d.getHours() << 11 ) | ( d.getMinutes() << 5 ) | Math.floor( d.getSeconds() / 2 ),
        date: ( ( Math.max( 1980, d.getFullYear() ) - 1980 ) << 9 ) | ( ( d.getMonth() + 1 ) << 5 ) | d.getDate(),
    };
}

/**
 * @param {{name:string, data:Blob|string, date?:Date}[]} files
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function makeZip( files, onProgress ) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for ( let i = 0; i < files.length; i++ ) {
        const f    = files[ i ];
        const data = typeof f.data === 'string' ? new Blob( [ f.data ] ) : f.data;
        const name = enc.encode( f.name );
        const crc  = await crc32( data );
        const size = data.size;
        if ( offset + size > 0xFFFFFFF0 ) throw new Error( 'The backup would be larger than 4 GB. Copy the data folder instead.' );
        const { time, date } = dosTime( f.date || new Date() );

        const lh = new DataView( new ArrayBuffer( 30 ) );
        lh.setUint32( 0, 0x04034b50, true );
        lh.setUint16( 4, 20, true );
        lh.setUint16( 6, 0x0800, true );          // UTF-8 names
        lh.setUint16( 8, 0, true );               // stored
        lh.setUint16( 10, time, true );
        lh.setUint16( 12, date, true );
        lh.setUint32( 14, crc, true );
        lh.setUint32( 18, size, true );
        lh.setUint32( 22, size, true );
        lh.setUint16( 26, name.length, true );
        lh.setUint16( 28, 0, true );
        parts.push( lh.buffer, name, data );

        const ch = new DataView( new ArrayBuffer( 46 ) );
        ch.setUint32( 0, 0x02014b50, true );
        ch.setUint16( 4, 20, true );
        ch.setUint16( 6, 20, true );
        ch.setUint16( 8, 0x0800, true );
        ch.setUint16( 10, 0, true );
        ch.setUint16( 12, time, true );
        ch.setUint16( 14, date, true );
        ch.setUint32( 16, crc, true );
        ch.setUint32( 20, size, true );
        ch.setUint32( 24, size, true );
        ch.setUint16( 28, name.length, true );
        ch.setUint32( 42, offset, true );
        central.push( ch.buffer, name );

        offset += 30 + name.length + size;
        if ( onProgress ) onProgress( i + 1, files.length );
    }
    const cdSize = central.reduce( ( s, p ) => s + ( p.byteLength ?? p.length ), 0 );
    const end = new DataView( new ArrayBuffer( 22 ) );
    end.setUint32( 0, 0x06054b50, true );
    end.setUint16( 8, files.length, true );
    end.setUint16( 10, files.length, true );
    end.setUint32( 12, cdSize, true );
    end.setUint32( 16, offset, true );
    return new Blob( [ ...parts, ...central, end.buffer ], { type: 'application/zip' } );
}

/**
 * @param {Blob} blob
 * @returns {Promise<Map<string, {size:number, blob:()=>Promise<Blob>}>>}
 */
export async function readZip( blob ) {
    const tailLen = Math.min( blob.size, 65557 );
    const tail = new DataView( await blob.slice( blob.size - tailLen ).arrayBuffer() );
    let eocd = -1;
    for ( let i = tailLen - 22; i >= 0; i-- ) {
        if ( tail.getUint32( i, true ) === 0x06054b50 ) { eocd = i; break; }
    }
    if ( eocd < 0 ) throw new Error( 'This file is not a valid ZIP archive.' );
    const count  = tail.getUint16( eocd + 10, true );
    const cdSize = tail.getUint32( eocd + 12, true );
    const cdOff  = tail.getUint32( eocd + 16, true );
    if ( cdOff === 0xFFFFFFFF ) throw new Error( 'ZIP64 archives are not supported.' );

    const cd  = new DataView( await blob.slice( cdOff, cdOff + cdSize ).arrayBuffer() );
    const dec = new TextDecoder();
    const out = new Map();
    let p = 0;
    for ( let i = 0; i < count; i++ ) {
        if ( cd.getUint32( p, true ) !== 0x02014b50 ) throw new Error( 'The ZIP archive is damaged.' );
        const method  = cd.getUint16( p + 10, true );
        const csize   = cd.getUint32( p + 20, true );
        const usize   = cd.getUint32( p + 24, true );
        const nLen    = cd.getUint16( p + 28, true );
        const xLen    = cd.getUint16( p + 30, true );
        const cLen    = cd.getUint16( p + 32, true );
        const lhOff   = cd.getUint32( p + 42, true );
        const name    = dec.decode( new Uint8Array( cd.buffer, cd.byteOffset + p + 46, nLen ) );
        p += 46 + nLen + xLen + cLen;
        if ( name.endsWith( '/' ) ) continue;
        out.set( name, {
            size: usize,
            blob: async () => {
                const lh = new DataView( await blob.slice( lhOff, lhOff + 30 ).arrayBuffer() );
                const start = lhOff + 30 + lh.getUint16( 26, true ) + lh.getUint16( 28, true );
                const raw = blob.slice( start, start + csize );
                if ( method === 0 ) return raw;
                if ( method === 8 && typeof DecompressionStream === 'function' ) {
                    return new Response( raw.stream().pipeThrough( new DecompressionStream( 'deflate-raw' ) ) ).blob();
                }
                throw new Error( `Unsupported compression in ${ name }.` );
            },
        } );
    }
    return out;
}
