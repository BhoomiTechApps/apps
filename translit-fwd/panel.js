/**
 * panel.js - a small window that floats above the page.
 *
 *   - It is draggable by its title bar and cannot be resized (its size is fixed in styles.css).
 *   - It sits above everything (position: fixed, high z-index) and can only be moved inside the viewport.
 *   - It never takes keyboard focus from the field behind it: clicking, dragging or scrolling the window (or pressing the
 *     button that toggles it) leaves the caret where it was, so the person can keep typing.
 *   - Its position is remembered between visits.
 */
( function ( root, factory ) {
	if ( typeof module === 'object' && module.exports ) { module.exports = factory(); } else { root.FloatPanel = factory(); }
}( typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	/**
	 * @param {Object}      o
	 * @param {HTMLElement} o.panel       The window (start it with the `hidden` attribute).
	 * @param {HTMLElement} o.handle      The title bar: dragging it moves the window.
	 * @param {HTMLElement} [o.close]     Close button.
	 * @param {HTMLElement} [o.toggle]    Button that opens and closes the window (gets aria-expanded).
	 * @param {HTMLElement} o.focusTarget The field that must keep keyboard focus.
	 * @param {HTMLElement} [o.anchor]    First open with no saved position: the window goes just below this element, at the right.
	 * @param {string}      [o.storageKey]
	 * @param {function}    [o.onOpen]    Called each time the window is about to be shown.
	 */
	function create( o ) {
		const panel = o.panel, handle = o.handle, target = o.focusTarget;
		const GAP = 10;
		let pos = null;          // { x, y } of the window's top-left corner, in CSS pixels
		let drag = null;         // { id, dx, dy } while the title bar is being dragged
		let hadFocus = null;     // the target's selection if it had focus when a pointer went down on the window
		let topInset = 0;        // notch / status bar height in an installed app (0 elsewhere)

		// ── where the window may be ──
		function measureTopInset() {
			const p = document.createElement( 'div' );
			p.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px)';
			document.body.appendChild( p );
			const v = parseFloat( getComputedStyle( p ).paddingTop ) || 0;
			p.remove();
			topInset = v;
		}
		function place( x, y ) {
			const vw = document.documentElement.clientWidth, vh = window.innerHeight;
			const minY = topInset;
			x = Math.min( Math.max( 0, x ), Math.max( 0, vw - panel.offsetWidth ) );
			y = Math.min( Math.max( minY, y ), Math.max( minY, vh - panel.offsetHeight ) );
			pos = { x, y };
			panel.style.transform = 'translate(' + Math.round( x ) + 'px,' + Math.round( y ) + 'px)';
		}
		function load() {
			try {
				const p = JSON.parse( localStorage.getItem( o.storageKey ) || 'null' );
				if ( p && isFinite( p.x ) && isFinite( p.y ) ) return p;
			} catch ( e ) { /* blocked or corrupt: use the default */ }
			return null;
		}
		function save() { if ( o.storageKey && pos ) { try { localStorage.setItem( o.storageKey, JSON.stringify( pos ) ); } catch ( e ) { /* full or blocked */ } } }
		function defaultPos() {
			const vw = document.documentElement.clientWidth;
			const top = o.anchor ? o.anchor.getBoundingClientRect().bottom + GAP : GAP;
			return { x: vw - panel.offsetWidth - 16, y: top };
		}

		// ── open / close ──
		function isOpen() { return ! panel.hidden; }
		function open() {
			if ( o.onOpen ) o.onOpen();
			panel.hidden = false;
			measureTopInset();
			const p = pos || load() || defaultPos();      // measured after it is shown, so its size is known
			place( p.x, p.y );
			if ( o.toggle ) o.toggle.setAttribute( 'aria-expanded', 'true' );
		}
		function close() {
			// only a keyboard user can have focus inside the window: send it back to the field
			const inside = panel.contains( document.activeElement );
			panel.hidden = true;
			if ( o.toggle ) o.toggle.setAttribute( 'aria-expanded', 'false' );
			if ( inside ) target.focus( { preventScroll: true } );
		}
		function toggle() { if ( isOpen() ) close(); else open(); }

		// ── keep focus in the field ──
		// A mouse press moves focus on mousedown; cancelling it leaves the caret alone (and keeps a half-typed word live).
		function keepFocus( el ) {
			el.addEventListener( 'mousedown', ( e ) => e.preventDefault() );
			// Safety net for browsers that move focus anyway (a scroll bar, a touch): put it back afterwards.
			el.addEventListener( 'pointerdown', () => {
				hadFocus = document.activeElement === target ? { s: target.selectionStart, e: target.selectionEnd } : null;
			}, true );
			const restore = () => {
				if ( ! hadFocus ) return;
				if ( document.activeElement !== target ) {
					target.focus( { preventScroll: true } );
					try { target.setSelectionRange( hadFocus.s, hadFocus.e ); } catch ( e ) { /* not a text field */ }
				}
			};
			const finish = () => { restore(); setTimeout( () => { restore(); hadFocus = null; }, 0 ); };
			[ 'pointerup', 'mouseup' ].forEach( ( t ) => el.addEventListener( t, restore, true ) );
			[ 'pointercancel', 'click' ].forEach( ( t ) => el.addEventListener( t, finish, true ) );
		}
		// Pressing a key means the mouse interaction is over; never "restore" over a keyboard user's own focus change.
		document.addEventListener( 'keydown', () => { hadFocus = null; }, true );
		keepFocus( panel );
		if ( o.toggle ) { keepFocus( o.toggle ); o.toggle.addEventListener( 'click', toggle ); }
		if ( o.close ) o.close.addEventListener( 'click', close );

		// ── dragging ──
		handle.addEventListener( 'pointerdown', ( e ) => {
			if ( ( e.pointerType === 'mouse' && e.button !== 0 ) || e.target.closest( 'button' ) ) return;
			const r = panel.getBoundingClientRect();
			drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
			panel.classList.add( 'dragging' );
			if ( handle.setPointerCapture ) { try { handle.setPointerCapture( e.pointerId ); } catch ( err ) { /* pointer already gone */ } }
			e.preventDefault();
		} );
		handle.addEventListener( 'pointermove', ( e ) => {
			if ( drag && e.pointerId === drag.id ) place( e.clientX - drag.dx, e.clientY - drag.dy );
		} );
		function endDrag( e ) {
			if ( ! drag || e.pointerId !== drag.id ) return;
			drag = null;
			panel.classList.remove( 'dragging' );
			save();
		}
		[ 'pointerup', 'pointercancel', 'lostpointercapture' ].forEach( ( t ) => handle.addEventListener( t, endDrag ) );

		// a smaller window (rotating a phone, resizing the browser) must not leave the panel out of reach
		window.addEventListener( 'resize', () => { if ( isOpen() && pos ) { measureTopInset(); place( pos.x, pos.y ); } } );

		return { open, close, toggle, isOpen };
	}

	return { create };
} ) );
