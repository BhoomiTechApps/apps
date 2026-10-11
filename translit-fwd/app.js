/* Roman -> Bengali text area. Wires the DOM to InPlace (inplace.js) and TranslitForward (vendor/). */
( function () {
	'use strict';

	const ta = document.getElementById( 'text' );
	const statusEl = document.getElementById( 'status' );

	if ( ! window.TranslitForward || ! window.InPlace ) {
		ta.disabled = true; ta.placeholder = 'The transliteration engine did not load. Reload the page.';
		document.getElementById( 'chart-btn' ).hidden = true;
		document.getElementById( 'file-tools' ).hidden = true;
		return;
	}
	// The bundled engine plus the corrections in fixes.js (each one applies only while the bundle still has the defect).
	const engine = window.Fixes ? Fixes.apply( TranslitForward ) : TranslitForward;
	const ip = InPlace.create( engine.transliterate );

	// ── always start with an empty text ──
	// Work lives in files on the device (files.js), not in the browser. Copies kept by versions before 1.4.0 are removed.
	try { localStorage.removeItem( 'translit-pwa:text' ); localStorage.removeItem( 'translit-pwa:doc' ); } catch ( e ) { /* blocked */ }
	try { indexedDB.deleteDatabase( 'translit-pwa' ); } catch ( e ) { /* not available */ }
	ta.value = '';                               // also undoes a browser restoring the field's old content on reload
	ip.reset( '' );

	// ── typing ──
	let composing = false;
	function apply( inputType ) {
		const r = ip.update( ta.value, ta.selectionStart, inputType, composing );
		if ( r.changed ) { ta.value = r.value; ta.setSelectionRange( r.caret, r.caret ); }
		if ( files ) files.refresh();
	}
	ta.addEventListener( 'input', ( e ) => apply( e.inputType ) );
	// Phone keyboards compose the word before committing it: leave it alone until they do, then convert it.
	ta.addEventListener( 'compositionstart', () => { composing = true; } );
	ta.addEventListener( 'compositionend', () => { composing = false; setTimeout( () => apply( 'compositionend' ), 0 ); } );
	// Moving the caret, selecting, or leaving the field finishes the word being typed.
	document.addEventListener( 'selectionchange', () => { if ( document.activeElement === ta ) ip.selection( ta.selectionStart, ta.selectionEnd ); } );
	ta.addEventListener( 'blur', () => ip.selection( -1, -1 ) );

	// ── New / Open / Save / Save as: files on the device (files.js, docfile.js) ──
	const fileBtns = document.getElementById( 'file-tools' );
	const files = window.Files && window.DocFile ? Files.create( {
		ta,
		replace: ( text ) => { ta.value = text; ip.reset( text ); },
	} ) : null;
	if ( ! files ) { fileBtns.hidden = true; document.getElementById( 'doc' ).hidden = true; }

	// ── barnamala chart: a small window that hovers over the text area ──
	// It is built from the engine's own map the first time it is opened, and never takes keyboard focus from the text area.
	const chartBtn = document.getElementById( 'chart-btn' );
	if ( window.Barnamala && window.FloatPanel ) {
		const chartBody = document.getElementById( 'chart-body' );
		let chartBuilt = false;
		FloatPanel.create( {
			panel: document.getElementById( 'chart' ),
			handle: document.getElementById( 'chart-bar' ),
			close: document.getElementById( 'chart-close' ),
			toggle: chartBtn,
			focusTarget: ta,
			anchor: document.querySelector( 'header' ),
			storageKey: 'translit-pwa:chart-pos',
			onOpen: () => { if ( ! chartBuilt ) { chartBody.innerHTML = Barnamala.build( engine ).html; chartBuilt = true; } },
		} );
	} else {
		chartBtn.hidden = true;
	}

	// ── offline support + updates ──
	// Reloading for an update first offers to save unsaved work in the app's own dialog (then no browser warning follows).
	const reload = async () => { if ( ! files || await files.confirmLeave() ) location.reload(); };
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
		if ( e.data && e.data.type === 'UPDATED' ) say( 'Update ready - tap to reload', reload );
	} );
	// A new service worker took over.
	navigator.serviceWorker.addEventListener( 'controllerchange', () => {
		if ( hadController ) say( 'Update ready - tap to reload', reload );
		hadController = true;
	} );
} )();
