/**
 * OCR Studio — minimal ZIP writer (no dependencies).
 *
 * Files are stored uncompressed: page images, WAV audio and PNG line images
 * are already compressed or barely compress, and storing keeps this small
 * and fast on low-end phones. File names are UTF-8 (flag bit 11), so
 * Bengali/Assamese titles survive.
 *
 *   const zip = new ZipWriter();
 *   await zip.add('folder/page.png', blob);        // Blob | string | Uint8Array
 *   const blob = zip.toBlob();                     // application/zip
 */
( function () {
	'use strict';

	const CRC_TABLE = ( () => {
		const t = new Uint32Array( 256 );
		for ( let n = 0; n < 256; n++ ) {
			let c = n;
			for ( let k = 0; k < 8; k++ ) c = c & 1 ? 0xEDB88320 ^ ( c >>> 1 ) : c >>> 1;
			t[ n ] = c >>> 0;
		}
		return t;
	} )();

	function crc32( bytes ) {
		let c = 0xFFFFFFFF;
		for ( let i = 0; i < bytes.length; i++ ) c = CRC_TABLE[ ( c ^ bytes[ i ] ) & 0xFF ] ^ ( c >>> 8 );
		return ( c ^ 0xFFFFFFFF ) >>> 0;
	}

	function dosTime( d ) {
		return {
			time: ( d.getHours() << 11 ) | ( d.getMinutes() << 5 ) | ( Math.floor( d.getSeconds() / 2 ) ),
			date: ( ( d.getFullYear() - 1980 ) << 9 ) | ( ( d.getMonth() + 1 ) << 5 ) | d.getDate(),
		};
	}

	async function toBytes( data ) {
		if ( data instanceof Uint8Array ) return data;
		if ( data instanceof ArrayBuffer ) return new Uint8Array( data );
		if ( data instanceof Blob ) return new Uint8Array( await data.arrayBuffer() );
		return new TextEncoder().encode( String( data ) );
	}

	class ZipWriter {
		constructor() {
			this.parts = [];
			this.central = [];
			this.offset = 0;
			this.names = new Set();
		}

		/** Avoid duplicate names by suffixing -2, -3… */
		uniqueName( name ) {
			let n = name.replace( /^\/+/, '' ), i = 2;
			const dot = n.lastIndexOf( '.' );
			while ( this.names.has( n ) ) {
				n = dot > 0 ? name.slice( 0, dot ) + '-' + i + name.slice( dot ) : name + '-' + i;
				i++;
			}
			this.names.add( n );
			return n;
		}

		async add( name, data, date = new Date() ) {
			name = this.uniqueName( name );
			const bytes = await toBytes( data );
			const nameBytes = new TextEncoder().encode( name );
			const crc = crc32( bytes );
			const { time, date: d } = dosTime( date );

			const local = new DataView( new ArrayBuffer( 30 ) );
			local.setUint32( 0, 0x04034b50, true );
			local.setUint16( 4, 20, true );          // version needed
			local.setUint16( 6, 0x0800, true );      // UTF-8 names
			local.setUint16( 8, 0, true );           // stored
			local.setUint16( 10, time, true );
			local.setUint16( 12, d, true );
			local.setUint32( 14, crc, true );
			local.setUint32( 18, bytes.length, true );
			local.setUint32( 22, bytes.length, true );
			local.setUint16( 26, nameBytes.length, true );
			local.setUint16( 28, 0, true );

			const cen = new DataView( new ArrayBuffer( 46 ) );
			cen.setUint32( 0, 0x02014b50, true );
			cen.setUint16( 4, 20, true );
			cen.setUint16( 6, 20, true );
			cen.setUint16( 8, 0x0800, true );
			cen.setUint16( 10, 0, true );
			cen.setUint16( 12, time, true );
			cen.setUint16( 14, d, true );
			cen.setUint32( 16, crc, true );
			cen.setUint32( 20, bytes.length, true );
			cen.setUint32( 24, bytes.length, true );
			cen.setUint16( 28, nameBytes.length, true );
			cen.setUint32( 42, this.offset, true );

			this.parts.push( local.buffer, nameBytes, bytes );
			this.central.push( cen.buffer, nameBytes );
			this.offset += 30 + nameBytes.length + bytes.length;
			return name;
		}

		toBlob() {
			const centralSize = this.central.reduce( ( n, p ) => n + ( p.byteLength ), 0 );
			const count = this.names.size;
			const end = new DataView( new ArrayBuffer( 22 ) );
			end.setUint32( 0, 0x06054b50, true );
			end.setUint16( 8, count, true );
			end.setUint16( 10, count, true );
			end.setUint32( 12, centralSize, true );
			end.setUint32( 16, this.offset, true );
			return new Blob( [ ...this.parts, ...this.central, end.buffer ], { type: 'application/zip' } );
		}
	}

	window.ZipWriter = ZipWriter;
}() );
