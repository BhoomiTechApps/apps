/* Bengali -> Roman text area. Wires the DOM to InPlace (inplace.js) and TranslitReverse (vendor/). */
( function () {
	'use strict';

	const KEY = 'translit-reverse-pwa:text';   // its own key: the forward app may live on the same origin
	const ta = document.getElementById( 'text' );
	const statusEl = document.getElementById( 'status' );

	// ── OCR: opens the OCR page in its own small browser window ──
	// A separate window (not an iframe), so the page runs normally, with its own permissions.
	const OCR_URL = 'https://bhoomitechapps.github.io/apps/ocr/';
	const ocrBtn = document.getElementById( 'ocr-btn' );
	let ocrWin = null, ocrWatch = 0;

	function flash( text ) {           // show a short message in the header pill, then put back what was there
		const prevText = statusEl.hidden ? '' : statusEl.textContent, prevAction = statusEl.onclick;
		say( text );
		setTimeout( () => { if ( statusEl.textContent === text ) say( prevText, prevAction ); }, 4000 );
	}
	function ocrState( isOpen ) {
		ocrBtn.classList.toggle( 'active', isOpen );
		ocrBtn.title = isOpen ? 'The OCR window is open. Click to bring it to the front' : 'Open the OCR tool in a separate small window';
		clearInterval( ocrWatch );
		// there is no event for "the window was closed", so look now and then while it is open
		if ( isOpen ) ocrWatch = setInterval( () => { if ( ! ocrWin || ocrWin.closed ) { ocrWin = null; ocrState( false ); } }, 500 );
	}
	function ocrOpen() {
		if ( ocrWin && ! ocrWin.closed ) { ocrWin.focus(); return; }          // already open: do not reload it and lose the work in it
		if ( navigator.onLine === false ) { flash( 'OCR needs an internet connection' ); return; }
		// Same size and corner as the chart window in the other app: a tall, narrow window at the top right of this one.
		const sc = window.screen, w = Math.min( 480, sc.availWidth - 32 ), h = Math.min( 680, sc.availHeight - 32 );
		const x0 = sc.availLeft || 0, y0 = sc.availTop || 0;
		const chromeH = window.outerHeight - window.innerHeight;             // this window's title bar and toolbar
		const left = Math.round( Math.min( Math.max( x0, window.screenX + window.outerWidth - w - 16 ), x0 + sc.availWidth - w ) );
		const top = Math.round( Math.min( Math.max( y0, window.screenY + chromeH + document.querySelector( 'header' ).offsetHeight + 10 ), y0 + sc.availHeight - h ) );
		// An empty URL gives back the window from an earlier visit if it is still open (and does not navigate it), else a blank new one.
		const win = window.open( '', 'translit-ocr', 'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top );
		if ( ! win ) { flash( 'Pop-up blocked. Allow pop-ups for this site' ); return; }
		let fresh = false;
		try { fresh = win.location.href === 'about:blank'; } catch ( e ) { /* cross-origin: the OCR page is already in it */ }
		if ( fresh ) {
			try { win.opener = null; } catch ( e ) { /* the OCR page gets no handle on this one */ }
			win.location.href = OCR_URL;
		}
		win.focus();
		ocrWin = win;
		ocrState( true );
	}
	// Pressing the button with the mouse leaves focus (and the caret) in the text area, so typing carries on when you come back.
	ocrBtn.addEventListener( 'mousedown', ( e ) => e.preventDefault() );
	ocrBtn.addEventListener( 'click', ocrOpen );

	if ( ! window.TranslitReverse || ! window.InPlace ) {
		ta.disabled = true; ta.placeholder = 'The transliteration engine did not load. Reload the page.';
		return;
	}
	// Only words that contain Bengali script are converted (the danda U+0964/U+0965 counts). The engine lower-cases and trims
	// everything it sees, so Roman words the user types or pastes are left exactly as they are.
	const BENGALI = /[\u0964\u0965\u0980-\u09FF]/;
	const engine = window.TranslitEngine || TranslitReverse;   // TranslitEngine = bundle + rules.js
	const convert = ( word ) => ( BENGALI.test( word ) ? engine.transliterate( word ) : word );
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
