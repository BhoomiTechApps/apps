/**
 * docfile.js - reading and writing the text as a file on the device.
 *
 * Pure helpers, no DOM (unit-tested in tests/docfile.test.js); files.js does the buttons, pickers and dialogs.
 *
 *   - Files are plain text, UTF-8, no byte-order mark, so any editor on any system opens them.
 *   - Opening accepts UTF-8 (with or without a BOM) and UTF-16 with a BOM; Windows / old Mac line endings become "\n".
 *   - Anything else (a Word file, an image, text in a legacy 8-bit encoding) is refused with a message, never loaded as garbage.
 */
( function ( root, factory ) {
	if ( typeof module === 'object' && module.exports ) { module.exports = factory(); } else { root.DocFile = factory(); }
}( typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	const MAX_BYTES = 4 * 1024 * 1024;     // far more than anyone types; keeps the copy kept on the device within the browser's limit
	const EXT = '.txt';

	/**
	 * Bytes of a file -> its text.
	 * @param {Uint8Array} bytes
	 * @return {{text: string}|{error: string}}
	 */
	function decode( bytes ) {
		if ( bytes.length > MAX_BYTES ) return { error: 'too-big' };
		let enc = 'utf-8', start = 0;
		if ( bytes[ 0 ] === 0xEF && bytes[ 1 ] === 0xBB && bytes[ 2 ] === 0xBF ) start = 3;
		else if ( bytes[ 0 ] === 0xFF && bytes[ 1 ] === 0xFE ) { enc = 'utf-16le'; start = 2; }
		else if ( bytes[ 0 ] === 0xFE && bytes[ 1 ] === 0xFF ) { enc = 'utf-16be'; start = 2; }
		let text;
		try {
			text = new TextDecoder( enc, { fatal: true } ).decode( bytes.subarray( start ) );
		} catch ( e ) {
			return { error: 'not-text' };
		}
		// A NUL or other control characters (apart from tab, newline, carriage return, form feed) mean a binary file.
		if ( /[\u0000-\u0008\u000E-\u001F]/.test( text ) ) return { error: 'not-text' };
		return { text: normalize( text ) };
	}

	/** Windows (\r\n) and old Mac (\r) line endings -> \n, the text area's own. */
	function normalize( text ) {
		return text.replace( /\r\n?/g, '\n' );
	}

	/** Text -> UTF-8 bytes for the file. */
	function encode( text ) {
		return new TextEncoder().encode( normalize( text ) );
	}

	/**
	 * A short fingerprint of the text: it tells whether the text still matches what was last saved or opened,
	 * without keeping a second copy of it. FNV-1a over the UTF-16 code units, plus the length.
	 */
	function signature( text ) {
		let h = 0x811c9dc5;
		for ( let i = 0; i < text.length; i++ ) {
			h ^= text.charCodeAt( i );
			h = Math.imul( h, 0x01000193 ) >>> 0;
		}
		return text.length.toString( 36 ) + '-' + h.toString( 36 );
	}

	const pad = ( n ) => ( n < 10 ? '0' : '' ) + n;

	/** The name offered for a new file: translit-2026-10-11.txt */
	function defaultName( date ) {
		const d = date || new Date();
		return 'translit-' + d.getFullYear() + '-' + pad( d.getMonth() + 1 ) + '-' + pad( d.getDate() ) + EXT;
	}

	/**
	 * A name typed by the person -> a safe file name ending in .txt, or '' if nothing usable is left.
	 * Keeps any script (Bengali names are fine); drops characters no system allows in a file name.
	 */
	function cleanName( input ) {
		let n = String( input == null ? '' : input )
			.replace( /[\u0000-\u001F\u007F/\\:*?"<>|]+/g, ' ' )
			.replace( /\s+/g, ' ' )
			.trim()
			.replace( /[. ]+$/, '' );
		if ( /\.txt$/i.test( n ) ) n = n.slice( 0, -EXT.length );
		n = n.replace( /^[. ]+/, '' ).replace( /[. ]+$/, '' );
		if ( ! n ) return '';
		if ( n.length > 120 ) n = n.slice( 0, 120 ).trim();
		return n + EXT;
	}

	/** The part of a file name before .txt, for selecting it in a name box. */
	function stem( name ) {
		return /\.txt$/i.test( name ) ? name.slice( 0, -EXT.length ) : name;
	}

	const MESSAGES = {
		'too-big': 'This file is too large to open here (the limit is 4 MB).',
		'not-text': 'This is not a plain text file the app can read. Open a .txt file saved as UTF-8 (the app saves files that way).',
	};
	const message = ( code ) => MESSAGES[ code ] || 'The file could not be opened.';

	return { decode, encode, normalize, signature, defaultName, cleanName, stem, message, MAX_BYTES };
} ) );
