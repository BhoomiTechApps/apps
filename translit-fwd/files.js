/* files.js - New, Open, Save and Save as: the text as a file on the device, so work can be saved and carried on later.
 *
 *  Two ways of reaching files, picked by what the browser offers:
 *
 *   - Chrome / Edge on a computer (File System Access API): Open and Save use the system's file dialogs, and Save writes
 *     straight back into the file that was opened or saved last (the browser asks once to allow editing it).
 *     Save as always asks where to save.
 *   - Everywhere else (Safari, Firefox, phones): Open uses the system's file chooser; Save downloads the file
 *     (to Downloads, or wherever the browser asks), asking for a name the first time. Save as always asks for a name.
 *
 *  The file name and whether the text has changes not yet saved to it are shown at the top left of the frame and
 *  in the window title. New, Open, a dropped file or a file opened with the installed app ask first when there are
 *  such changes. Shortcuts: Ctrl/Cmd+O open, Ctrl/Cmd+S save, Ctrl/Cmd+Shift+S save as.
 *
 *  Nothing is kept in the browser: the app always opens with an empty text. Reloading or closing it while there are
 *  unsaved changes makes the browser ask first ("Leave site?"); the update button asks in the app's own dialog.
 *
 *  Files are plain UTF-8 text (.txt); reading and writing them is in docfile.js.
 */
( function () {
	'use strict';

	const TYPES = [ { description: 'Text file', accept: { 'text/plain': [ '.txt' ] } } ];
	const PICKER_ID = 'translit-doc';                 // the system dialog remembers the last folder under this id
	const MAC = /Mac|iPhone|iPad|iPod/.test( navigator.platform || navigator.userAgent );
	const MOD = MAC ? '⌘' : 'Ctrl+';

	/**
	 * @param {object}   o
	 * @param {HTMLTextAreaElement} o.ta
	 * @param {function(string)} o.replace  put new text in the field (and reset the transliteration state)
	 */
	function create( o ) {
		const D = window.DocFile, ta = o.ta;
		const host = document.querySelector( '.tr-frame' ) || document.body;
		const FS = typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';
		const $ = ( id ) => document.getElementById( id );
		const nameEl = $( 'doc-name' ), stateEl = $( 'doc-state' );
		const btn = { new: $( 'new-btn' ), open: $( 'open-btn' ), save: $( 'save-btn' ), saveAs: $( 'saveas-btn' ) };
		const baseTitle = document.title;

		// The document: its file name ('' = never saved), the signature of the text as last saved / opened, the file handle.
		let doc = { name: '', sig: D.signature( '' ), handle: null };
		let busy = false, lastValue = null, dirty = false, flash = '', flashTimer = 0, leaving = false, downloadedAt = 0;

		// ── tooltips with the shortcuts ──
		btn.new.title = 'New: start an empty text';
		btn.open.title = 'Open a text file (' + MOD + 'O)';
		btn.save.title = ( FS ? 'Save to the file' : 'Save: download the text as a file' ) + ' (' + MOD + 'S)';
		btn.saveAs.title = ( FS ? 'Save as a new file' : 'Save as: download under a new name' ) + ' (' + MOD + ( MAC ? '⇧S' : 'Shift+S' ) + ')';

		function setDoc( name, text, handle ) {
			doc = { name, sig: D.signature( text ), handle: handle || null };
			flash = ''; clearTimeout( flashTimer );
			lastValue = null;
			refresh();
		}

		// ── the name and state shown at the top ──
		function refresh() {
			if ( ta.value !== lastValue ) { lastValue = ta.value; dirty = D.signature( lastValue ) !== doc.sig; }
			const name = doc.name || 'Untitled';
			nameEl.textContent = name;
			nameEl.title = doc.name ? name : 'Not saved to a file yet';
			let state = '';
			if ( flash && ! dirty ) state = flash;
			else if ( dirty ) state = doc.name ? 'Edited' : ( ta.value ? 'Not saved' : '' );
			else if ( doc.name ) state = 'Saved';
			stateEl.textContent = state;
			stateEl.className = 'tr-doc-state' + ( dirty && state ? ' dirty' : '' );
			btn.save.classList.toggle( 'dirty', dirty && !! ta.value );
			document.title = ( dirty && ta.value ? '• ' : '' ) + ( doc.name ? doc.name + ' – ' : '' ) + baseTitle;
		}
		function showFlash( text ) {
			flash = text; clearTimeout( flashTimer );
			flashTimer = setTimeout( () => { flash = ''; refresh(); }, 2500 );
			refresh();
		}

		// ── a small dialog in the app's own style ──
		function ask( a ) {
			if ( typeof HTMLDialogElement !== 'function' ) return Promise.resolve( fallbackAsk( a ) );
			return new Promise( ( resolve ) => {
				const d = document.createElement( 'dialog' );
				d.className = 'tr-dialog';
				const f = document.createElement( 'form' );
				f.method = 'dialog';
				const h = document.createElement( 'h2' ); h.textContent = a.title; f.appendChild( h );
				if ( a.text ) { const p = document.createElement( 'p' ); p.textContent = a.text; f.appendChild( p ); }
				let input = null;
				if ( a.input != null ) {
					const l = document.createElement( 'label' );
					l.innerHTML = '<span>File name</span>';
					input = document.createElement( 'input' );
					Object.assign( input, { type: 'text', value: a.input, spellcheck: false, autocomplete: 'off' } );
					input.setAttribute( 'autocapitalize', 'off' );
					l.appendChild( input ); f.appendChild( l );
				}
				const row = document.createElement( 'div' );
				row.className = 'tr-dialog-btns';
				// The first button is the default one (Enter); CSS shows the row right-to-left so it sits on the right.
				a.buttons.forEach( ( b, i ) => {
					const el = document.createElement( 'button' );
					el.value = b.value; el.textContent = b.label;
					el.className = i === 0 ? 'primary' : ( b.quiet ? 'quiet' : '' );
					row.appendChild( el );
				} );
				f.appendChild( row ); d.appendChild( f );
				d.addEventListener( 'close', () => {
					const v = d.returnValue || null;
					d.remove();
					ta.focus( { preventScroll: true } );
					resolve( input ? ( v ? input.value : null ) : v );
				} );
				host.appendChild( d );
				d.returnValue = '';
				d.showModal();
				if ( input ) { input.focus(); input.setSelectionRange( 0, D.stem( input.value ).length ); }
				else row.firstChild.focus();
			} );
		}
		function fallbackAsk( a ) {                               // very old browsers without <dialog>
			if ( a.input != null ) return prompt( a.title, a.input );
			if ( a.buttons.length === 1 ) { alert( a.title + '\n\n' + ( a.text || '' ) ); return a.buttons[ 0 ].value; }
			return confirm( a.title + '\n\n' + ( a.text || '' ) ) ? a.buttons[ 0 ].value : null;
		}
		const tell = ( title, text ) => ask( { title, text, buttons: [ { label: 'OK', value: 'ok' } ] } );

		// ── before the text is replaced: offer to save changes that are not in a file yet ──
		const unsaved = () => { refresh(); return dirty && !! ta.value; };

		async function okToReplace( leave ) {
			if ( ! unsaved() ) return true;
			const what = doc.name ? '“' + doc.name + '” has changes that are not saved to the file.'
				: 'This text is not saved to a file yet.';
			const v = await ask( {
				title: leave ? 'Save your changes before reloading?' : 'Save your changes first?',
				text: what + ' If you go on without saving, they are lost.',
				buttons: [ { label: 'Save', value: 'save' }, { label: 'Don’t save', value: 'discard', quiet: true }, { label: 'Cancel', value: 'cancel' } ],
			} );
			if ( v === 'save' ) return save( false );
			return v === 'discard';
		}

		// ── New ──
		async function newDoc() {
			if ( ! await okToReplace() ) return;
			o.replace( '' );
			setDoc( '', '', null );
			ta.focus();
		}

		// ── Open ──
		const picker = document.createElement( 'input' );
		Object.assign( picker, { type: 'file', accept: '.txt,text/plain', hidden: true } );
		picker.addEventListener( 'change', () => { const f = picker.files && picker.files[ 0 ]; if ( f ) load( f, null ); } );
		host.appendChild( picker );

		async function open() {
			if ( ! await okToReplace() ) return;
			if ( ! FS ) { picker.value = ''; picker.click(); return; }
			let handle;
			try {
				[ handle ] = await window.showOpenFilePicker( { types: TYPES, id: PICKER_ID, multiple: false } );
			} catch ( e ) {
				if ( e.name !== 'AbortError' ) { picker.value = ''; picker.click(); }   // e.g. blocked in a frame: use the plain chooser
				return;
			}
			try { await load( await handle.getFile(), handle ); } catch ( e ) { tell( 'The file could not be opened', e.message ); }
		}

		async function load( file, handle ) {
			if ( file.size > D.MAX_BYTES ) { tell( 'The file could not be opened', D.message( 'too-big' ) ); return false; }
			const r = D.decode( new Uint8Array( await file.arrayBuffer() ) );
			if ( r.error ) { tell( 'The file could not be opened', D.message( r.error ) ); return false; }
			o.replace( r.text );
			setDoc( file.name || D.defaultName(), r.text, handle );
			ta.focus( { preventScroll: true } );
			ta.setSelectionRange( r.text.length, r.text.length );
			ta.scrollTop = ta.scrollHeight;                          // carry on where the text ends
			showFlash( 'Opened' );
			return true;
		}

		// ── Save / Save as ──
		async function writable( handle ) {
			try {
				const opt = { mode: 'readwrite' };
				if ( ( await handle.queryPermission( opt ) ) === 'granted' ) return true;
				return ( await handle.requestPermission( opt ) ) === 'granted';
			} catch ( e ) { return false; }
		}

		/** @return {Promise<boolean>} true if the text is now in a file */
		async function save( as ) {
			const text = ta.value;
			if ( FS ) {
				let handle = as ? null : doc.handle;
				if ( handle && ! await writable( handle ) ) handle = null;     // permission refused: ask where to save instead
				if ( ! handle ) {
					try {
						handle = await window.showSaveFilePicker( { suggestedName: doc.name || D.defaultName(), types: TYPES, id: PICKER_ID } );
					} catch ( e ) {
						if ( e.name === 'AbortError' ) return false;
						return download( as, text );                               // e.g. blocked in a frame
					}
				}
				try {
					const w = await handle.createWritable();
					await w.write( new Blob( [ D.encode( text ) ], { type: 'text/plain' } ) );
					await w.close();
				} catch ( e ) {
					tell( 'The file could not be saved', ( e && e.message ) || 'The browser did not allow writing to it.' );
					return false;
				}
				setDoc( handle.name, text, handle );
				showFlash( 'Saved' );
				return true;
			}
			return download( as, text );
		}

		async function download( as, text ) {
			let name = doc.name;
			if ( as || ! name ) {
				const typed = await ask( {
					title: as ? 'Save as' : 'Save',
					text: 'The text is saved as a plain text file in your downloads.',
					input: name || D.defaultName(),
					buttons: [ { label: 'Save', value: 'save' }, { label: 'Cancel', value: 'cancel' } ],
				} );
				if ( typed == null ) return false;
				name = D.cleanName( typed ) || D.defaultName();
			}
			const url = URL.createObjectURL( new Blob( [ D.encode( text ) ], { type: 'text/plain;charset=utf-8' } ) );
			const a = document.createElement( 'a' );
			a.href = url; a.download = name; a.hidden = true;
			host.appendChild( a ); a.click(); a.remove();
			setTimeout( () => URL.revokeObjectURL( url ), 60000 );
			downloadedAt = Date.now();
			setDoc( name, text, null );
			showFlash( 'Downloaded' );
			return true;
		}

		// ── one action at a time ──
		const run = ( fn ) => async ( ...args ) => {
			if ( busy ) return;
			busy = true;
			try { await fn( ...args ); } finally { busy = false; refresh(); }
		};
		const doNew = run( newDoc ), doOpen = run( open ), doSave = run( () => save( false ) ), doSaveAs = run( () => save( true ) );

		// The buttons must not take focus from the text area on mouse down (a half-typed word stays live until the action).
		Object.values( btn ).forEach( ( b ) => b.addEventListener( 'mousedown', ( e ) => e.preventDefault() ) );
		btn.new.addEventListener( 'click', doNew );
		btn.open.addEventListener( 'click', doOpen );
		btn.save.addEventListener( 'click', doSave );
		btn.saveAs.addEventListener( 'click', doSaveAs );

		document.addEventListener( 'keydown', ( e ) => {
			if ( ! ( e.ctrlKey || e.metaKey ) || e.altKey || e.isComposing ) return;
			if ( document.querySelector( 'dialog.tr-dialog[open]' ) ) return;
			if ( e.code === 'KeyS' ) { e.preventDefault(); ( e.shiftKey ? doSaveAs : doSave )(); }
			else if ( e.code === 'KeyO' && ! e.shiftKey ) { e.preventDefault(); doOpen(); }
		} );

		// ── a file dropped on the window opens it ──
		const hasFiles = ( e ) => e.dataTransfer && Array.from( e.dataTransfer.types || [] ).includes( 'Files' );
		document.addEventListener( 'dragover', ( e ) => { if ( hasFiles( e ) ) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } } );
		document.addEventListener( 'drop', ( e ) => {
			if ( ! hasFiles( e ) ) return;
			e.preventDefault();
			const item = Array.from( e.dataTransfer.items || [] ).find( ( it ) => it.kind === 'file' );
			const file = e.dataTransfer.files[ 0 ];
			if ( ! file ) return;
			// Chrome can hand over the file itself, so Save writes back into it; this must be asked for during the drop.
			const handleP = FS && item && item.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch( () => null ) : Promise.resolve( null );
			run( async () => {
				const handle = await handleP;
				if ( ! await okToReplace() ) return;
				await load( file, handle && handle.kind === 'file' ? handle : null );
			} )();
		} );

		// ── the installed app opened from a .txt file ("Open with") ──
		if ( 'launchQueue' in window && window.LaunchParams && 'files' in window.LaunchParams.prototype ) {
			window.launchQueue.setConsumer( ( params ) => {
				const handle = params.files && params.files[ 0 ];
				if ( ! handle || handle.kind !== 'file' ) return;
				run( async () => { if ( await okToReplace() ) await load( await handle.getFile(), handle ); } )();
			} );
		}

		// ── reloading or closing the app with unsaved changes ──
		// Browsers only allow their own fixed question here ("Leave site? Changes you made may not be saved"), and only
		// once the page has been used; the app's dialog cannot be shown while a page is closing.
		addEventListener( 'beforeunload', ( e ) => {
			if ( leaving || ! unsaved() ) return;
			e.preventDefault();
			e.returnValue = '';
		} );

		/** Before the app itself reloads (the update button): ask in the app's dialog, then let it go without the browser's. */
		async function confirmLeave() {
			if ( busy ) return false;
			busy = true;
			try {
				const ok = await okToReplace( true );
				if ( ok ) leaving = true;
				// A download that has just started must not be cut off by the reload.
				const wait = 1500 - ( Date.now() - downloadedAt );
				if ( ok && wait > 0 ) await new Promise( ( r ) => setTimeout( r, wait ) );
				return ok;
			} finally { busy = false; refresh(); }
		}

		refresh();
		return { refresh, confirmLeave };
	}

	window.Files = { create };
} )();
