/* Roman -> Bengali text area. Wires the DOM to InPlace (inplace.js) and TranslitForward (vendor/). */
( function () {
	'use strict';

	const KEY = 'translit-pwa:text';
	const ta = document.getElementById( 'text' );
	const statusEl = document.getElementById( 'status' );

	if ( ! window.TranslitForward || ! window.InPlace ) {
		ta.disabled = true; ta.placeholder = 'The transliteration engine did not load. Reload the page.';
		document.getElementById( 'chart-btn' ).hidden = true;
		return;
	}
	const ip = InPlace.create( TranslitForward.transliterate );

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
			onOpen: () => { if ( ! chartBuilt ) { chartBody.innerHTML = Barnamala.build( TranslitForward ).html; chartBuilt = true; } },
		} );
	} else {
		chartBtn.hidden = true;
	}

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
