/**
 * inplace.js - convert what is typed or pasted inside ONE text area, in place (Roman -> Bengali, or Bengali -> Roman:
 * it only calls the `transliterate` function you give it).
 *
 * Pure logic, no DOM: feed it the text area's new value after every edit and it tells you what the
 * value (and caret) should be. It works like an input method:
 *
 *   - The word being typed (a run of non-whitespace) is a "token". Its Roman source is remembered and the
 *     text area shows transliterate(roman). Each new character re-converts the whole token, so word-final
 *     rules etc. are always right.
 *   - Backspace at the end of the token removes ONE ROMAN LETTER (not one Bengali code point) and re-converts.
 *   - Whitespace, moving the caret, leaving the field or editing elsewhere COMMITS the token: from then on
 *     it is ordinary Bengali text that you edit normally.
 *   - Pasted text, drops and text committed by a phone keyboard's composition are converted as a whole.
 *   - Undo/redo and edits while a composition is in progress are never converted mid-way.
 */
( function ( root, factory ) {
	if ( typeof module === 'object' && module.exports ) { module.exports = factory(); } else { root.InPlace = factory(); }
}( typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	const HAS_TEXT = /\S/;
	const HAS_SPACE = /\s/;

	/**
	 * The single edit that turns string a into string b. When the caret (end of the edit in b) is known it
	 * settles ambiguity such as typing "a" next to another "a".
	 */
	function diff( a, b, caret ) {
		const max = Math.min( a.length, b.length );
		let p = 0;
		while ( p < max && a.charCodeAt( p ) === b.charCodeAt( p ) ) p++;
		let s = 0;
		while ( s < max - p && a.charCodeAt( a.length - 1 - s ) === b.charCodeAt( b.length - 1 - s ) ) s++;

		if ( typeof caret === 'number' && caret >= 0 && caret <= b.length && b.length - s !== caret ) {
			const tail = b.slice( caret );
			if ( a.length >= tail.length && a.endsWith( tail ) ) {
				const aEnd = a.length - tail.length;
				const pMax = Math.min( aEnd, caret );
				let p2 = 0;
				while ( p2 < pMax && a.charCodeAt( p2 ) === b.charCodeAt( p2 ) ) p2++;
				return { start: p2, removed: a.slice( p2, aEnd ), inserted: b.slice( p2, caret ) };
			}
		}
		return { start: p, removed: a.slice( p, a.length - s ), inserted: b.slice( p, b.length - s ) };
	}

	function dropLastChar( s ) {
		return Array.from( s ).slice( 0, -1 ).join( '' );
	}

	/**
	 * @param {function(string): string} transliterate
	 * @param {{perWord?: boolean}} [options]  perWord: convert pasted / committed chunks one whitespace-separated word at a
	 *        time, so every space, tab and newline stays exactly as it was (needed when the engine trims its input).
	 */
	function create( transliterate, options ) {
		const perWord = !! ( options && options.perWord );
		// A conversion must never make a word disappear: if the engine returns nothing, the word stays as it was.
		// (That also keeps every typed character visible, so Backspace always has something to delete.)
		const convertWord = ( w ) => { const out = transliterate( w ); return out === '' && w !== '' ? w : out; };
		const convertChunk = perWord ? ( s ) => s.replace( /\S+/g, convertWord ) : convertWord;
		let value = '';        // what the text area held after our last update
		let pending = null;    // { start, roman, len }: the token, shown converted at [start, start + len)

		function reset( v ) { value = v || ''; pending = null; }

		/** Show `roman` as the pending token, in place of whatever the browser just inserted. */
		function showToken( before, after, start, roman ) {
			const converted = convertWord( roman );
			pending = { start, roman, len: converted.length };
			value = before + converted + after;
			return { value, caret: start + converted.length, changed: true };
		}

		function accept( newValue, caret ) {
			pending = null;
			value = newValue;
			return { value, caret, changed: false };
		}

		/**
		 * @param {string}  newValue   the text area's value after the browser's edit
		 * @param {number}  caret      selectionStart after the edit
		 * @param {string}  [inputType] InputEvent.inputType ('insertText', 'deleteContentBackward',
		 *                              'insertFromPaste', ...); pass 'compositionend' for text a keyboard committed
		 * @param {boolean} [composing] true while an IME composition is in progress
		 * @return {{value: string, caret: number, changed: boolean}} changed = write value/caret back into the field
		 */
		function update( newValue, caret, inputType, composing ) {
			if ( composing ) return { value: newValue, caret, changed: false };   // `value` stays as it was before the composition
			if ( newValue === value ) return { value, caret, changed: false };
			if ( inputType && /^history/.test( inputType ) ) return accept( newValue, caret );   // undo / redo

			const d = diff( value, newValue, caret );
			const before = newValue.slice( 0, d.start );
			const after  = newValue.slice( d.start + d.inserted.length );
			const typing = inputType === undefined || inputType === 'insertText';

			// ── deletion ──
			if ( d.inserted === '' ) {
				if ( pending ) {
					const ps = pending.start, pe = ps + pending.len;
					const rs = d.start, re = d.start + d.removed.length;
					const backspace = ( inputType === undefined || inputType === 'deleteContentBackward' ) && d.removed.length <= 3;
					if ( backspace && rs >= ps && re === pe ) {
						const roman = dropLastChar( pending.roman );
						if ( roman === '' ) {
							const res = accept( value.slice( 0, ps ) + value.slice( pe ), ps );
							return { value: res.value, caret: ps, changed: true };
						}
						return showToken( value.slice( 0, ps ), value.slice( pe ), ps, roman );
					}
				}
				return accept( newValue, caret );
			}

			// ── insertion / replacement ──
			const removedSomething = d.removed !== '';
			if ( ! HAS_TEXT.test( d.inserted ) ) return accept( newValue, caret );     // spaces / newlines: commit, keep as typed

			if ( typing && ! HAS_SPACE.test( d.inserted ) ) {
				if ( ! removedSomething && pending && d.start === pending.start + pending.len ) {
					return showToken( newValue.slice( 0, pending.start ), after, pending.start, pending.roman + d.inserted );   // extend the token
				}
				return showToken( before, after, d.start, d.inserted );                    // start a new token
			}

			// paste, drop, keyboard-committed text, or a chunk containing spaces: convert as a whole and commit
			const converted = convertChunk( d.inserted );
			pending = null;
			value = before + converted + after;
			return { value, caret: before.length + converted.length, changed: true };
		}

		/** The user moved the caret / selected text: the token is finished. */
		function selection( start, end ) {
			if ( pending && ( start !== end || start !== pending.start + pending.len ) ) pending = null;
		}

		return { reset, update, selection, state: () => ( { value, pending: pending && { ...pending } } ) };
	}

	return { create, diff };
} ) );
