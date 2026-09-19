/* Bengali -> Roman text area. Wires the DOM to InPlace (inplace.js) and TranslitReverse (vendor/). */
( function () {
	'use strict';

	const KEY = 'translit-reverse-pwa:text';   // its own key: the forward app may live on the same origin
	const ta = document.getElementById( 'text' );
	const statusEl = document.getElementById( 'status' );

	if ( ! window.TranslitReverse || ! window.InPlace ) {
		ta.disabled = true; ta.placeholder = 'The transliteration engine did not load. Reload the page.';
		return;
	}
	// Only words that contain Bengali script are converted (the danda U+0964/U+0965 counts). The engine lower-cases and trims
	// everything it sees, so Roman words the user types or pastes are left exactly as they are.
	const BENGALI = /[\u0964\u0965\u0980-\u09FF]/;
	const convert = ( word ) => ( BENGALI.test( word ) ? TranslitReverse.transliterate( word ) : word );
	// perWord: pasted / committed chunks are converted one word at a time so every space and newline is kept (the engine trims).
	const ip = InPlace.create( convert, { perWord: true } );

	// ── restore what was typed last time ──
	try { ta.value = localStorage.getItem( KEY ) || ''; } catch ( e ) { /* private mode: start empty */ }
	ip.reset( ta.value );
	ta.setSelectionRange( ta.value.length, ta.value.length );

	// ── typing ──
	let composing = false;
	function apply( inputType ) {
		const r = ip.update( ta.value, ta.selectionStart, inputType, composing );
		if ( r.changed ) { ta.value = r.value; ta.setSelectionRange( r.caret, r.caret ); }
		scheduleSave();
	}
	ta.addEventListener( 'input', ( e ) => apply( e.inputType ) );
	// Phone keyboards compose the word before committing it: leave it alone until they do, then convert it.
	ta.addEventListener( 'compositionstart', () => { composing = true; } );
	ta.addEventListener( 'compositionend', () => { composing = false; setTimeout( () => apply( 'compositionend' ), 0 ); } );
	// Moving the caret, selecting, or leaving the field finishes the word being typed.
	document.addEventListener( 'selectionchange', () => { if ( document.activeElement === ta ) ip.selection( ta.selectionStart, ta.selectionEnd ); } );
	ta.addEventListener( 'blur', () => ip.selection( -1, -1 ) );

	// ── keep the text between visits ──
	let timer = 0;
	function save() { clearTimeout( timer ); try { localStorage.setItem( KEY, ta.value ); } catch ( e ) { /* storage full / blocked */ } }
	function scheduleSave() { clearTimeout( timer ); timer = setTimeout( save, 300 ); }
	addEventListener( 'pagehide', save );
	document.addEventListener( 'visibilitychange', () => { if ( document.hidden ) save(); } );

	// ── offline support + updates ──
	function say( text, action ) {
		statusEl.hidden = ! text; statusEl.textContent = text || '';
		statusEl.classList.toggle( 'action', !! action );
		statusEl.onclick = action || null;
	}
	if ( ! ( 'serviceWorker' in navigator ) ) return;

	let hadController = !! navigator.serviceWorker.controller;
	navigator.serviceWorker.register( './sw.js' ).catch( () => say( '' ) );
	navigator.serviceWorker.ready.then( () => say( 'Works offline' ) );
	// A newer copy of the app (or of the transliteration bundle) was downloaded in the background.
	navigator.serviceWorker.addEventListener( 'message', ( e ) => {
		if ( e.data && e.data.type === 'UPDATED' ) { save(); say( 'Update ready - tap to reload', () => location.reload() ); }
	} );
	// A new service worker took over.
	navigator.serviceWorker.addEventListener( 'controllerchange', () => {
		if ( hadController ) { save(); say( 'Update ready - tap to reload', () => location.reload() ); }
		hadController = true;
	} );
} )();
