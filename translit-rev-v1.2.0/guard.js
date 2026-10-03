/* guard.js - right-click rules and the text area's own menu.
 *
 *  - The browser's right-click menu is switched off everywhere on the page (and long-press callouts on iOS, via styles.css).
 *  - In the text area a small menu with only Copy and Paste opens instead: right-click, the keyboard's Menu key or
 *    Shift+F10. Like the OCR button it never takes keyboard focus from the text area, so a half-typed word stays put
 *    until you paste. Arrow keys, Enter and Escape work while it is open.
 *  - On phones and tablets (touch-only screens) the text area keeps the system's own long-press selection toolbar,
 *    because a web page cannot change what that toolbar shows.
 *  - The keyboard shortcuts that open the developer tools or view-source are swallowed.
 *
 *  This is a deterrent, not protection: the browser has to download app.js and styles.css to run the app, so they can
 *  always be read with the browser's own menus. Opening a .js or .css address directly is sent back to index.html by
 *  sw.js (and by serve.js / the server rules in README.md).
 *
 *  It is loaded first and depends on nothing else, so the rules hold even if the transliteration engine fails to load.
 */
( function () {
	'use strict';

	const ta = document.getElementById( 'text' );
	const host = document.querySelector( '.tr-frame' ) || document.body;   // inside the frame, so the theme tokens apply
	const MAC = /Mac|iPhone|iPad|iPod/.test( navigator.platform || navigator.userAgent );
	const MOD = MAC ? '\u2318' : 'Ctrl+';
	const touchOnly = () => matchMedia( '(pointer: coarse)' ).matches && ! matchMedia( '(any-pointer: fine)' ).matches;

	let lastPointer = { type: 'mouse', at: 0 };
	let menu = null, items = [], note = null, active = -1, saved = { s: 0, e: 0 };

	// ── developer tools / view-source shortcuts ──
	function isDevShortcut( e ) {
		const c = e.code, mod = e.ctrlKey || e.metaKey;
		if ( e.key === 'F12' ) return true;
		if ( mod && e.shiftKey && ( c === 'KeyI' || c === 'KeyJ' || c === 'KeyC' || c === 'KeyK' ) ) return true;   // DevTools, console, inspector
		if ( e.metaKey && e.altKey && ( c === 'KeyI' || c === 'KeyJ' || c === 'KeyC' || c === 'KeyU' ) ) return true; // the same on macOS
		if ( mod && ! e.shiftKey && ! e.altKey && c === 'KeyU' ) return true;                                       // view-source
		return false;
	}

	// ── the menu ──
	function build() {
		menu = document.createElement( 'div' );
		menu.className = 'tr-menu';
		menu.id = 'tr-menu';
		menu.setAttribute( 'role', 'menu' );
		menu.setAttribute( 'aria-label', 'Text' );
		menu.hidden = true;
		menu.innerHTML =
			'<div class="tr-menu-item" role="menuitem" id="tr-menu-copy" data-act="copy"><span>Copy</span><span class="tr-menu-key">' + MOD + 'C</span></div>' +
			'<div class="tr-menu-item" role="menuitem" id="tr-menu-paste" data-act="paste"><span>Paste</span><span class="tr-menu-key">' + MOD + 'V</span></div>' +
			'<div class="tr-menu-note" role="status" hidden></div>';
		items = Array.from( menu.querySelectorAll( '.tr-menu-item' ) );
		note = menu.querySelector( '.tr-menu-note' );

		// Pressing on the menu must not move focus out of the text area.
		menu.addEventListener( 'pointerdown', ( e ) => e.preventDefault() );
		menu.addEventListener( 'mousedown', ( e ) => e.preventDefault() );
		menu.addEventListener( 'click', ( e ) => {
			const item = e.target.closest( '.tr-menu-item' );
			if ( item ) run( item );
		} );
		menu.addEventListener( 'pointermove', ( e ) => {
			const item = e.target.closest( '.tr-menu-item' );
			setActive( item ? items.indexOf( item ) : -1 );
		} );
		menu.addEventListener( 'pointerleave', () => setActive( -1 ) );
		host.appendChild( menu );
	}

	const isOpen = () => !! menu && ! menu.hidden;
	const enabled = ( item ) => item.getAttribute( 'aria-disabled' ) !== 'true';

	function setActive( i ) {
		active = i;
		items.forEach( ( it, k ) => it.classList.toggle( 'active', k === i && enabled( it ) ) );
		if ( i >= 0 ) ta.setAttribute( 'aria-activedescendant', items[ i ].id ); else ta.removeAttribute( 'aria-activedescendant' );
	}

	function move( step ) {
		const usable = items.map( ( it, k ) => enabled( it ) ? k : -1 ).filter( ( k ) => k >= 0 );
		if ( ! usable.length ) return;
		const at = usable.indexOf( active );
		setActive( usable[ at < 0 ? ( step > 0 ? 0 : usable.length - 1 ) : ( at + step + usable.length ) % usable.length ] );
	}

	function open( x, y, fromKeyboard ) {
		if ( ! menu ) build();
		saved = { s: ta.selectionStart, e: ta.selectionEnd };
		items[ 0 ].setAttribute( 'aria-disabled', String( saved.s === saved.e ) );   // Copy needs a selection
		items[ 1 ].setAttribute( 'aria-disabled', 'false' );
		note.hidden = true; note.textContent = '';
		menu.hidden = false;
		place( x, y );
		setActive( -1 );
		if ( fromKeyboard ) move( 1 );
		ta.setAttribute( 'aria-haspopup', 'menu' );
		ta.setAttribute( 'aria-controls', menu.id );
	}

	function place( x, y ) {
		const vw = document.documentElement.clientWidth, vh = window.innerHeight, w = menu.offsetWidth, h = menu.offsetHeight;
		if ( x + w > vw - 4 ) x = Math.max( 4, x - w );
		if ( y + h > vh - 4 ) y = Math.max( 4, y - h );
		menu.style.transform = 'translate(' + Math.round( x ) + 'px,' + Math.round( y ) + 'px)';
	}

	function close() {
		if ( ! isOpen() ) return;
		menu.hidden = true;
		setActive( -1 );
	}

	function hint( text ) {
		note.textContent = text; note.hidden = false;
		const r = menu.getBoundingClientRect();
		place( r.left, r.top );
	}

	function run( item ) {
		if ( ! enabled( item ) ) return;
		if ( item.dataset.act === 'copy' ) copy(); else paste();
	}

	async function copy() {
		const s = saved.s, e = saved.e, text = ta.value.slice( s, e );
		close();
		if ( ! text ) return;
		try {
			await navigator.clipboard.writeText( text );
		} catch ( err ) {                                // no Clipboard API (plain http) or it was refused
			ta.focus(); ta.setSelectionRange( s, e );
			try { document.execCommand( 'copy' ); } catch ( _ ) { /* nothing more to try */ }
		}
	}

	async function paste() {
		let text;
		try {
			if ( ! navigator.clipboard || ! navigator.clipboard.readText ) throw new Error( 'no clipboard' );
			text = await navigator.clipboard.readText();     // the browser may ask the person first
		} catch ( err ) {
			hint( 'The browser did not allow pasting from this menu. Press ' + MOD + 'V instead.' );
			return;
		}
		close();
		if ( ! text ) return;
		const len = ta.value.length, s = Math.min( saved.s, len ), e = Math.min( saved.e, len );
		ta.focus( { preventScroll: true } );
		ta.setRangeText( text, s, e, 'end' );
		// Hand it to app.js exactly like a keyboard paste, so it is transliterated and saved.
		ta.dispatchEvent( new InputEvent( 'input', { bubbles: true, inputType: 'insertFromPaste', data: text } ) );
	}

	// ── events ──
	addEventListener( 'pointerdown', ( e ) => {
		lastPointer = { type: e.pointerType || 'mouse', at: Date.now() };
		if ( isOpen() && ! menu.contains( e.target ) ) close();
	}, true );

	document.addEventListener( 'contextmenu', ( e ) => {
		if ( isOpen() && menu.contains( e.target ) ) { e.preventDefault(); return; }
		if ( e.target !== ta || ta.disabled ) { e.preventDefault(); close(); return; }

		const touch = e.pointerType === 'touch' || e.pointerType === 'pen' ||
			( lastPointer.type !== 'mouse' && Date.now() - lastPointer.at < 2000 && e.button !== 2 );
		if ( touch && touchOnly() ) { close(); return; }          // phone / tablet: keep the system selection toolbar

		e.preventDefault();
		const fromKeyboard = ! touch && e.button !== 2;
		const r = ta.getBoundingClientRect();
		const inside = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
		if ( fromKeyboard || ! inside ) open( r.left + 18, r.top + 18, true );
		else open( e.clientX, e.clientY, false );
	}, true );

	document.addEventListener( 'keydown', ( e ) => {
		if ( isDevShortcut( e ) ) { e.preventDefault(); e.stopPropagation(); return; }
		if ( ! isOpen() ) return;
		switch ( e.key ) {
			case 'Escape': e.preventDefault(); close(); return;
			case 'ArrowDown': e.preventDefault(); move( 1 ); return;
			case 'ArrowUp': e.preventDefault(); move( -1 ); return;
			case 'Home': e.preventDefault(); setActive( -1 ); move( 1 ); return;
			case 'End': e.preventDefault(); setActive( -1 ); move( -1 ); return;
			case 'Enter': case ' ':
				if ( active >= 0 ) { e.preventDefault(); run( items[ active ] ); return; }
				close(); return;
			case 'Shift': case 'Control': case 'Alt': case 'Meta': case 'ContextMenu': case 'F10': return;
			default: close();                                    // any other key closes the menu and does its usual job
		}
	}, true );

	ta.addEventListener( 'scroll', close );
	ta.addEventListener( 'input', close );
	addEventListener( 'resize', close );
	addEventListener( 'blur', close );
	// Dragging an image or the page's text out of the app is not needed either.
	document.addEventListener( 'dragstart', ( e ) => { if ( e.target !== ta ) e.preventDefault(); } );
} )();
