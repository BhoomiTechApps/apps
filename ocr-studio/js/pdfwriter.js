/**
 * OCR Studio 3.0 — searchable PDF writer.
 *
 * Builds PDFs whose hidden text layer is the user's CORRECTED text, laid
 * over the page image where the printed lines are. Copying, searching and
 * screen readers therefore get the proofread Unicode text, not the raw
 * machine reading.
 *
 * The text layer uses the same technique as Tesseract's own PDF renderer:
 * an invisible (render mode 3) Type0 font with Identity-H encoding, where
 * each 2-byte code is the UTF-16 code unit itself and a ToUnicode CMap maps
 * it straight back. The embedded "GlyphLessFont" (572 bytes) comes from
 * Tesseract (Apache-2.0). Because the text is never drawn, any script works,
 * including Eastern Nagari with its conjuncts and vowel signs, and the text
 * keeps its logical (typed) order.
 *
 *   SearchablePDF.placeText( text, detectedLines, width, height ) -> placed lines
 *   SearchablePDF.build( { pages: [ { jpeg, lines } ], info } )   -> Uint8Array
 */
( function () {
	'use strict';

	const GLYPHLESS_TTF = 'AAEAAAAKAIAAAwAgT1MvMlbeyJQAAAEoAAAAYGNtYXAACgA0AAABkAAAAB5nbHlmFSJBJAAAAbgAAAAYaGVhZAt48WUAAACsAAAANmhoZWEMAgQCAAAA5AAAACRobXR4BAAAAAAAAYgAAAAIbG9jYQAMAAAAAAGwAAAABm1heHAABAAFAAABCAAAACBuYW1l8usW2gAAAdAAAABLcG9zdAABAAEAAAIcAAAAIAABAAAAAQAAsJRxEF8PPPUEBwgAAAAAAM+a/G4AAAAA1MOn8gAAAAAEAAgAAAAAEAACAAAAAAAAAAEAAAgA//8AAAQAAAAAAAQAAAEAAAAAAAAAAAAAAAAAAAACAAEAAAACAAQAAQAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAwAAAZAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAR09PRwBAAAAAAAAB//8AAAABAAGAAAAAAAAAAAAAAAAAAAABAAAAAAAABAAAAAAAAAIAAQAAAAAAFAADAAAAAAAUAAYACgAAAAAAAAAAAAAAAAAMAAAAAQAAAAAEAAgAAAMAADEhESEEAPwACAAAAAADACoAAAADAAAABQAWAAAAAQAAAAAABQALABYAAwABBAkABQAWAAAAVgBlAHIAcwBpAG8AbgAgADEALgAwVmVyc2lvbiAxLjAAAAEAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAA=';
	// CIDToGIDMap: every code -> glyph 1 (zlib-compressed, 131072 bytes raw).
	const CIDMAP_Z = 'eNrtwgENAAAMw6Dev+lnPghUBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAPAOIADw==';
	const TO_UNICODE = [
		'/CIDInit /ProcSet findresource begin',
		'12 dict begin',
		'begincmap',
		'/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
		'/CMapName /Adobe-Identity-UCS def',
		'/CMapType 2 def',
		'1 begincodespacerange',
		'<0000> <FFFF>',
		'endcodespacerange',
		'1 beginbfrange',
		'<0000> <FFFF> <0000>',
		'endbfrange',
		'endcmap',
		'CMapName currentdict /CMap defineresource pop',
		'end',
		'end',
	].join( '\n' );
	const GLYPH_W = 0.5; // /DW 500: every code advances half an em

	// ── Bytes ───────────────────────────────────────────────────────────────

	function b64bytes( s ) {
		const bin = atob( s );
		const u = new Uint8Array( bin.length );
		for ( let i = 0; i < bin.length; i++ ) u[ i ] = bin.charCodeAt( i );
		return u;
	}
	function latin1( s ) {
		const u = new Uint8Array( s.length );
		for ( let i = 0; i < s.length; i++ ) u[ i ] = s.charCodeAt( i ) & 0xff;
		return u;
	}
	function num( n ) {
		const r = Math.round( n * 1000 ) / 1000;
		return Object.is( r, -0 ) ? '0' : String( r );
	}
	function hex16( s ) {
		let h = '';
		for ( let i = 0; i < s.length; i++ ) h += s.charCodeAt( i ).toString( 16 ).toUpperCase().padStart( 4, '0' );
		return h;
	}
	// Text string for the document information dictionary (UTF-16BE + BOM).
	function pdfText( s ) {
		return '<FEFF' + hex16( String( s || '' ).normalize( 'NFC' ) ) + '>';
	}
	function pdfDate( d ) {
		const p = n => String( n ).padStart( 2, '0' );
		return '(D:' + d.getUTCFullYear() + p( d.getUTCMonth() + 1 ) + p( d.getUTCDate() ) + p( d.getUTCHours() ) + p( d.getUTCMinutes() ) + p( d.getUTCSeconds() ) + 'Z)';
	}

	// Width, height and colour components from a JPEG's SOF marker.
	function jpegInfo( u ) {
		if ( u[ 0 ] !== 0xff || u[ 1 ] !== 0xd8 ) throw new Error( 'The page image is not a JPEG.' );
		let i = 2;
		while ( i + 9 < u.length ) {
			if ( u[ i ] !== 0xff ) { i++; continue; }
			const m = u[ i + 1 ];
			if ( m === 0xd8 || m === 0x01 || ( m >= 0xd0 && m <= 0xd7 ) || m === 0xff ) { i += m === 0xff ? 1 : 2; continue; }
			const len = ( u[ i + 2 ] << 8 ) | u[ i + 3 ];
			if ( ( m >= 0xc0 && m <= 0xcf ) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc ) {
				return { h: ( u[ i + 5 ] << 8 ) | u[ i + 6 ], w: ( u[ i + 7 ] << 8 ) | u[ i + 8 ], comps: u[ i + 9 ] };
			}
			i += 2 + len;
		}
		throw new Error( 'Could not read the page image size.' );
	}

	// ── Placing the corrected text on the page ──────────────────────────────

	function squash( s ) {
		return String( s || '' ).normalize( 'NFC' ).replace( /\s+/g, '' );
	}
	function bigrams( s ) {
		const m = new Map();
		const cps = Array.from( s );
		if ( cps.length < 2 ) { if ( cps.length ) m.set( cps[ 0 ], 1 ); return m; }
		for ( let i = 0; i < cps.length - 1; i++ ) {
			const g = cps[ i ] + cps[ i + 1 ];
			m.set( g, ( m.get( g ) || 0 ) + 1 );
		}
		return m;
	}
	// Dice similarity of two lines (0 = nothing in common, 1 = identical).
	function similarity( a, b ) {
		a = squash( a ); b = squash( b );
		if ( ! a || ! b ) return 0;
		if ( a === b ) return 1;
		const A = bigrams( a ), B = bigrams( b );
		let inter = 0, na = 0, nb = 0;
		A.forEach( v => { na += v; } );
		B.forEach( v => { nb += v; } );
		A.forEach( ( v, k ) => { if ( B.has( k ) ) inter += Math.min( v, B.get( k ) ); } );
		return ( 2 * inter ) / ( na + nb );
	}

	// Pair typed lines with detected lines in order (Needleman–Wunsch). Two
	// lines are paired even when heavily corrected (pairing scores at least
	// -0.5, leaving both unpaired costs -0.8), so a page whose line count is
	// unchanged always maps line for line; added or removed lines leave gaps.
	function alignLines( typed, det ) {
		const n = typed.length, m = det.length, GAP = -0.4;
		const S = [], P = [];
		for ( let i = 0; i <= n; i++ ) { S.push( new Float64Array( m + 1 ) ); P.push( new Uint8Array( m + 1 ) ); }
		for ( let i = 1; i <= n; i++ ) { S[ i ][ 0 ] = i * GAP; P[ i ][ 0 ] = 1; }
		for ( let j = 1; j <= m; j++ ) { S[ 0 ][ j ] = j * GAP; P[ 0 ][ j ] = 2; }
		for ( let i = 1; i <= n; i++ ) {
			for ( let j = 1; j <= m; j++ ) {
				const d = S[ i - 1 ][ j - 1 ] + similarity( typed[ i - 1 ], det[ j - 1 ].text ) * 2 - 0.5;
				const u = S[ i - 1 ][ j ] + GAP, l = S[ i ][ j - 1 ] + GAP;
				if ( d >= u && d >= l ) { S[ i ][ j ] = d; P[ i ][ j ] = 0; } else if ( u >= l ) { S[ i ][ j ] = u; P[ i ][ j ] = 1; } else { S[ i ][ j ] = l; P[ i ][ j ] = 2; }
			}
		}
		const match = new Array( n ).fill( -1 );
		let i = n, j = m;
		while ( i > 0 || j > 0 ) {
			const p = P[ i ][ j ];
			if ( i > 0 && j > 0 && p === 0 ) { match[ i - 1 ] = j - 1; i--; j--; } else if ( i > 0 && ( j === 0 || p === 1 ) ) { i--; } else { j--; }
		}
		return match;
	}

	function box( b ) {
		return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
	}

	/**
	 * text:  the corrected text (lines separated by newlines)
	 * det:   lines found by recognition: [ { text, bbox, words: [ { text, bbox } ] } ]
	 * w, h:  page image size in pixels
	 * Returns [ { text, bbox, words: [ { text, bbox } ] | null } ] in image pixels.
	 */
	function placeText( text, det, w, h ) {
		const typed = String( text || '' ).normalize( 'NFC' ).split( /\r?\n/ ).map( s => s.replace( /\s+/g, ' ' ).trim() ).filter( Boolean );
		if ( ! typed.length ) return [];
		det = ( det || [] ).filter( l => l && l.bbox && l.bbox.x1 > l.bbox.x0 && l.bbox.y1 > l.bbox.y0 && squash( l.text ) );

		// No recognised lines (typed by hand, e.g. a handwritten page): lay
		// the lines down the page in reading order.
		if ( ! det.length ) {
			const mx = w * 0.06, my = h * 0.06;
			const lh = Math.min( ( h - 2 * my ) / typed.length, h / 18 );
			return typed.map( ( t, i ) => ( { text: t, bbox: { x0: mx, y0: my + i * lh, x1: w - mx, y1: my + ( i + 0.8 ) * lh }, words: null } ) );
		}

		const match = alignLines( typed, det );
		const avgH = det.reduce( ( s, l ) => s + ( l.bbox.y1 - l.bbox.y0 ), 0 ) / det.length;
		const left = Math.min.apply( null, det.map( l => l.bbox.x0 ) );
		const right = Math.max.apply( null, det.map( l => l.bbox.x1 ) );
		const out = typed.map( ( t, i ) => {
			if ( match[ i ] < 0 ) return { text: t, bbox: null, words: null };
			const d = det[ match[ i ] ];
			const tw = t.split( ' ' );
			const dw = ( d.words || [] ).filter( x => x && x.bbox && squash( x.text ) );
			const words = tw.length > 1 && tw.length === dw.length ? tw.map( ( x, k ) => ( { text: x, bbox: box( dw[ k ].bbox ) } ) ) : null;
			return { text: t, bbox: box( d.bbox ), words };
		} );

		// Lines added during correction: share the space between the
		// neighbouring placed lines, or stack below the previous one.
		for ( let i = 0; i < out.length; ) {
			if ( out[ i ].bbox ) { i++; continue; }
			let k = i;
			while ( k < out.length && ! out[ k ].bbox ) k++;
			const n = k - i;
			const prev = i > 0 ? out[ i - 1 ].bbox : null;
			const next = k < out.length ? out[ k ].bbox : null;
			const top = prev ? prev.y1 : Math.max( 0, ( next ? next.y0 : h * 0.06 ) - n * avgH * 1.4 );
			const bottom = next ? next.y0 : Math.min( h, top + n * avgH * 1.4 );
			const band = bottom - top;
			const step = band >= n * avgH * 0.6 ? band / n : avgH * 1.2;
			const lh = Math.min( avgH, step * 0.85 );
			for ( let j = 0; j < n; j++ ) {
				const y0 = Math.min( h - lh, top + j * step + ( step - lh ) / 2 );
				out[ i + j ].bbox = { x0: left, y0: Math.max( 0, y0 ), x1: right, y1: Math.max( 0, y0 ) + lh };
			}
			i = k;
		}
		return out;
	}

	// ── PDF assembly ────────────────────────────────────────────────────────

	function contentStream( lines, k, pw, ph ) {
		const ops = [ 'q ' + num( pw ) + ' 0 0 ' + num( ph ) + ' 0 0 cm /Im1 Do Q' ];
		if ( ! lines.length ) return ops.join( '\n' );
		ops.push( 'BT', '3 Tr' );
		const show = ( str, x, base, fs, width ) => {
			const units = str.length;
			if ( ! units || width <= 0 || fs <= 0 ) return;
			const tz = Math.max( 1, Math.min( 2000, ( 100 * width ) / ( GLYPH_W * fs * units ) ) );
			ops.push( '1 0 0 1 ' + num( x ) + ' ' + num( base ) + ' Tm /F1 ' + num( fs ) + ' Tf ' + num( tz ) + ' Tz <' + hex16( str ) + '> Tj' );
		};
		lines.forEach( l => {
			const b = l.bbox;
			const fs = Math.max( 1, ( b.y1 - b.y0 ) * k );
			const base = ph - b.y1 * k;
			if ( l.words && l.words.length ) {
				l.words.forEach( ( wd, i ) => {
					const isLast = i === l.words.length - 1;
					const x = wd.bbox.x0 * k;
					// A trailing space, stretched over the gap to the next word,
					// keeps words apart when the text is copied.
					const right = isLast ? wd.bbox.x1 * k : Math.max( wd.bbox.x1, l.words[ i + 1 ].bbox.x0 ) * k;
					show( isLast ? wd.text : wd.text + ' ', x, base, fs, right - x );
				} );
			} else {
				show( l.text, b.x0 * k, base, fs, ( b.x1 - b.x0 ) * k );
			}
		} );
		ops.push( 'ET' );
		return ops.join( '\n' );
	}

	/**
	 * pages: [ { jpeg: Uint8Array, lines: placed lines (image pixels) } ]
	 * info:  { title, author, subject, keywords, lang, creator }
	 */
	function build( { pages, info = {} } ) {
		if ( ! pages || ! pages.length ) throw new Error( 'There are no pages to put in the PDF.' );
		const parts = [];
		const offsets = [];
		let size = 0;
		const push = u => { parts.push( u ); size += u.length; };
		const str = s => push( latin1( s ) );
		const objects = []; // functions writing object i+1
		const add = fn => { objects.push( fn ); return objects.length; };
		const stream = ( dict, data ) => () => {
			str( '<< ' + dict + ' /Length ' + data.length + ' >>\nstream\n' );
			push( data );
			str( '\nendstream' );
		};

		const catalogId = add( null );
		const pagesId = add( null );
		const fontFile = b64bytes( GLYPHLESS_TTF );
		const fontFileId = add( stream( '/Length1 ' + fontFile.length, fontFile ) );
		const descId = add( () => str( '<< /Type /FontDescriptor /FontName /GlyphLessFont /Flags 5 /FontBBox [0 0 500 1000] /ItalicAngle 0 /Ascent 1000 /Descent -1 /CapHeight 1000 /StemV 80 /FontFile2 ' + fontFileId + ' 0 R >>' ) );
		const cidMapId = add( stream( '/Filter /FlateDecode', b64bytes( CIDMAP_Z ) ) );
		const cidFontId = add( () => str( '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /GlyphLessFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' + descId + ' 0 R /DW 500 /CIDToGIDMap ' + cidMapId + ' 0 R >>' ) );
		const toUniId = add( stream( '', latin1( TO_UNICODE ) ) );
		const fontId = add( () => str( '<< /Type /Font /Subtype /Type0 /BaseFont /GlyphLessFont /Encoding /Identity-H /DescendantFonts [' + cidFontId + ' 0 R] /ToUnicode ' + toUniId + ' 0 R >>' ) );

		const pageIds = [];
		pages.forEach( pg => {
			const jpeg = pg.jpeg;
			const ji = jpegInfo( jpeg );
			// Size the page as if printed about A4 wide (never larger than 1 px = 1 pt).
			const dpi = Math.max( 72, ji.w / 8.27 );
			const k = 72 / dpi;
			const pw = ji.w * k, ph = ji.h * k;
			const cs = ji.comps === 1 ? '/DeviceGray' : ji.comps === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
			const imgId = add( stream( '/Type /XObject /Subtype /Image /Width ' + ji.w + ' /Height ' + ji.h + ' /ColorSpace ' + cs + ' /BitsPerComponent 8 /Filter /DCTDecode', jpeg ) );
			// UTF-16 code units go straight into the content stream as hex.
			const cont = latin1( contentStream( pg.lines || [], k, pw, ph ) );
			const contId = add( stream( '', cont ) );
			const pageId = add( () => str( '<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + num( pw ) + ' ' + num( ph ) + '] /Contents ' + contId + ' 0 R /Resources << /XObject << /Im1 ' + imgId + ' 0 R >> /Font << /F1 ' + fontId + ' 0 R >> >> >>' ) );
			pageIds.push( pageId );
		} );

		const now = new Date();
		const infoParts = [ '/Producer ' + pdfText( info.creator || 'OCR Studio' ), '/Creator ' + pdfText( info.creator || 'OCR Studio' ), '/CreationDate ' + pdfDate( now ), '/ModDate ' + pdfDate( now ) ];
		if ( info.title ) infoParts.push( '/Title ' + pdfText( info.title ) );
		if ( info.author ) infoParts.push( '/Author ' + pdfText( info.author ) );
		if ( info.subject ) infoParts.push( '/Subject ' + pdfText( info.subject ) );
		if ( info.keywords ) infoParts.push( '/Keywords ' + pdfText( info.keywords ) );
		const infoId = add( () => str( '<< ' + infoParts.join( ' ' ) + ' >>' ) );

		objects[ catalogId - 1 ] = () => str( '<< /Type /Catalog /Pages ' + pagesId + ' 0 R' + ( info.lang && /^[a-zA-Z-]{2,12}$/.test( info.lang ) ? ' /Lang (' + info.lang + ')' : '' ) + ( info.title ? ' /ViewerPreferences << /DisplayDocTitle true >>' : '' ) + ' >>' );
		objects[ pagesId - 1 ] = () => str( '<< /Type /Pages /Kids [' + pageIds.map( id => id + ' 0 R' ).join( ' ' ) + '] /Count ' + pageIds.length + ' >>' );

		str( '%PDF-1.5\n%\xe2\xe3\xcf\xd3\n' );
		objects.forEach( ( fn, i ) => {
			offsets[ i ] = size;
			str( ( i + 1 ) + ' 0 obj\n' );
			fn();
			str( '\nendobj\n' );
		} );
		const xref = size;
		let x = 'xref\n0 ' + ( objects.length + 1 ) + '\n0000000000 65535 f \n';
		offsets.forEach( o => { x += String( o ).padStart( 10, '0' ) + ' 00000 n \n'; } );
		str( x + 'trailer\n<< /Size ' + ( objects.length + 1 ) + ' /Root ' + catalogId + ' 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n' );

		const outBytes = new Uint8Array( size );
		let p = 0;
		parts.forEach( u => { outBytes.set( u, p ); p += u.length; } );
		return outBytes;
	}

	window.SearchablePDF = { placeText, build, jpegInfo, similarity };
} )();
