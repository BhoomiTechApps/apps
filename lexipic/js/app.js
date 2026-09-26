/**
 * LexiPic PWA — main app.
 *
 * Offline-first port of the LexiPic WordPress plugin front end
 * (public/js/lexipic-app.js). Data lives in IndexedDB on the device; see
 * AUDIT.md for the bugs fixed and features added during the port.
 */

import * as DB from './db.js';
import * as IME from './ime.js';
import * as XFER from './transfer.js';

const MAX_IMAGE_DIM   = 960;   // plugin used 400px; photos were hard to read
const IMAGE_QUALITY   = 0.82;
const MAX_REC_SECONDS = 30;

// ── Tiny helpers ──────────────────────────────────────────────────────────

const $  = ( sel, ctx = document ) => ctx.querySelector( sel );
const $$ = ( sel, ctx = document ) => Array.from( ctx.querySelectorAll( sel ) );

function h( tag, attrs = {}, ...children ) {
	const el = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( attrs || {} ) ) {
		if ( v === null || v === undefined || v === false ) continue;
		if ( k === 'class' ) el.className = v;
		else if ( k === 'text' ) el.textContent = v;
		else if ( k.startsWith( 'on' ) && typeof v === 'function' ) el.addEventListener( k.slice( 2 ), v );
		else if ( k === 'dataset' ) Object.assign( el.dataset, v );
		else el.setAttribute( k, v === true ? '' : v );
	}
	for ( const c of children.flat() ) {
		if ( c === null || c === undefined || c === false ) continue;
		el.append( c instanceof Node ? c : document.createTextNode( String( c ) ) );
	}
	return el;
}

function icon( name ) {
	const svg = document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' );
	svg.setAttribute( 'class', 'ic' );
	svg.setAttribute( 'aria-hidden', 'true' );
	const use = document.createElementNS( 'http://www.w3.org/2000/svg', 'use' );
	use.setAttribute( 'href', '#i-' + name );
	svg.append( use );
	return svg;
}

function iconBtn( name, label, onclick, cls = '' ) {
	return h( 'button', { type: 'button', class: 'icon-btn ' + cls, title: label, 'aria-label': label, onclick }, icon( name ) );
}

function fmtTime( s ) {
	s = Math.max( 0, Math.floor( s ) );
	return Math.floor( s / 60 ) + ':' + String( s % 60 ).padStart( 2, '0' );
}

function fmtBytes( n ) {
	if ( ! n ) return '0 MB';
	if ( n < 1024 * 1024 ) return Math.round( n / 1024 ) + ' KB';
	if ( n < 1024 * 1024 * 1024 ) return ( n / 1048576 ).toFixed( 1 ) + ' MB';
	return ( n / 1073741824 ).toFixed( 2 ) + ' GB';
}

let toastTimer = null;
function toast( msg, opts = {} ) {
	const el = $( '#toast' ), act = $( '#toast-action' );
	$( '#toast-msg' ).textContent = msg;
	el.className = 'toast' + ( opts.error ? ' error' : '' );
	if ( opts.action ) {
		act.textContent = opts.action;
		act.hidden = false;
		act.onclick = () => { el.hidden = true; opts.onAction && opts.onAction(); };
	} else {
		act.hidden = true;
		act.onclick = null;
	}
	el.hidden = false;
	clearTimeout( toastTimer );
	if ( opts.timeout !== 0 ) {
		toastTimer = setTimeout( () => { el.hidden = true; }, opts.timeout || ( opts.action ? 7000 : 3500 ) );
	}
}

function downloadBlob( blob, filename ) {
	const url = URL.createObjectURL( blob );
	const a = h( 'a', { href: url, download: filename } );
	document.body.append( a );
	a.click();
	a.remove();
	// Revoking immediately (as the plugin did) can cancel the download in some browsers.
	setTimeout( () => URL.revokeObjectURL( url ), 30000 );
}

async function shareOrDownload( blob, filename, preferShare ) {
	const file = new File( [ blob ], filename, { type: 'application/json' } );
	if ( preferShare && navigator.canShare && navigator.canShare( { files: [ file ] } ) ) {
		try {
			await navigator.share( { files: [ file ], title: filename } );
			return;
		} catch ( e ) {
			if ( e.name === 'AbortError' ) return;
		}
	}
	downloadBlob( blob, filename );
}

// ── State ─────────────────────────────────────────────────────────────────

const state = {
	sets:        [],
	languages:   [],
	currentSet:  null,
	entries:     [],
	objectUrls:  [],
	engine:      null,
	engineLang:  null,
	editingId:   null,
	editingEntry: null,
	photoBlob:   null,
	audioBlob:   null,
	grid:        false,
	tab:         'archive',
};

// ── Tabs ──────────────────────────────────────────────────────────────────

function switchTab( key ) {
	state.tab = key;
	$$( '.tab' ).forEach( ( b ) => {
		const on = b.dataset.tab === key;
		b.classList.toggle( 'active', on );
		b.setAttribute( 'aria-selected', on ? 'true' : 'false' );
	} );
	$$( '.panel' ).forEach( p => { p.hidden = p.dataset.panel !== key; } );
	if ( key !== 'add' ) stopRecording();
	if ( key === 'settings' ) refreshSettings();
	if ( key === 'add' ) updateAddHeader();
	window.scrollTo( 0, 0 );
}

$$( '.tab' ).forEach( b => b.addEventListener( 'click', () => switchTab( b.dataset.tab ) ) );

// Arrow-key navigation between tabs (WAI-ARIA tabs pattern).
$( '.tabs' ).addEventListener( 'keydown', ( e ) => {
	if ( e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' ) return;
	const tabs = $$( '.tab' );
	const i = tabs.findIndex( t => t.dataset.tab === state.tab );
	const next = tabs[ ( i + ( e.key === 'ArrowRight' ? 1 : tabs.length - 1 ) ) % tabs.length ];
	switchTab( next.dataset.tab );
	next.focus();
} );

// ── Languages ─────────────────────────────────────────────────────────────

function langLabel( code ) {
	const l = state.languages.find( x => x.code === code );
	return l ? l.label : code;
}

async function refreshLanguages() {
	state.languages = await DB.getLanguages();
	const def = await DB.getSetting( 'default_language', 'bpm' );
	const fill = ( sel, value, extra ) => {
		const prev = value ?? sel.value;
		sel.replaceChildren( ...( extra || [] ), ...state.languages.map( l => h( 'option', { value: l.code, text: l.label } ) ) );
		if ( prev && $$( 'option', sel ).some( o => o.value === prev ) ) sel.value = prev;
	};
	fill( $( '#set-language' ), $( '#set-language' ).value || def );
	fill( $( '#set-edit-language' ) );
	fill( $( '#try-lang' ), $( '#try-lang' ).value || def );
	fill( $( '#lang-clone' ), '', [ h( 'option', { value: '', text: 'Bundled default files' } ) ] );
}

// ── Sets ──────────────────────────────────────────────────────────────────

async function refreshSets() {
	state.sets = await DB.getSets();
	const sel = $( '#set-select' );
	sel.replaceChildren(
		h( 'option', { value: '', text: state.sets.length ? 'Choose a set' : 'No sets yet' } ),
		...state.sets.map( s => h( 'option', { value: s.id, text: s.name + ' (' + s.entry_count + ')' } ) )
	);
	sel.value = state.currentSet ? String( state.currentSet.id ) : '';
	renderSetList();
}

function renderSetList() {
	const list = $( '#set-list' );
	$( '#set-list-empty' ).hidden = state.sets.length > 0;
	const canShare = !! ( navigator.canShare && navigator.share );
	list.replaceChildren( ...state.sets.map( ( s ) => {
		const isCurrent = state.currentSet && state.currentSet.id === s.id;
		return h( 'li', { class: 'set-item' + ( isCurrent ? ' current' : '' ) },
			h( 'button', { type: 'button', class: 'set-meta', title: 'Open ' + s.name, onclick: async () => { await selectSet( s.id ); switchTab( 'archive' ); } },
				h( 'span', { class: 'set-name', text: s.name } ),
				h( 'span', { class: 'set-sub', text: s.entry_count + ( s.entry_count === 1 ? ' word, ' : ' words, ' ) + langLabel( s.language ) } )
			),
			h( 'div', { class: 'set-actions' },
				iconBtn( 'edit', 'Edit ' + s.name, () => openSetDialog( s ) ),
				iconBtn( 'down', 'Export ' + s.name, () => exportSet( s, false ) ),
				canShare ? iconBtn( 'share', 'Share ' + s.name, () => exportSet( s, true ) ) : null,
				iconBtn( 'trash', 'Delete ' + s.name, () => removeSet( s ), 'del' )
			)
		);
	} ) );
}

async function selectSet( id, { silent = false } = {} ) {
	const set = id ? await DB.getSet( Number( id ) ) : null;
	if ( state.editingId && ( ! set || set.id !== state.editingEntry.set_id ) ) cancelEdit();
	state.currentSet = set || null;
	$( '#set-select' ).value = set ? String( set.id ) : '';
	await DB.setSetting( 'last_set', set ? set.id : null );
	history.replaceState( null, '', set ? '#set=' + encodeURIComponent( set.slug ) : location.pathname + location.search );
	$( '#archive-filter' ).value = '';
	await loadEngineFor( set ? set.language : null );
	await loadEntries();
	renderSetList();
	updateAddHeader();
	if ( ! silent && set ) document.title = set.name + ' — LexiPic';
}

$( '#set-select' ).addEventListener( 'change', e => selectSet( e.target.value ) );

$( '#create-set-btn' ).addEventListener( 'click', async () => {
	const name = $( '#set-name' ).value.trim();
	const lang = $( '#set-language' ).value || 'bpm';
	if ( ! name ) { toast( 'Give the set a name first.', { error: true } ); $( '#set-name' ).focus(); return; }
	try {
		const set = await DB.createSet( name, lang );
		await DB.setSetting( 'default_language', lang );
		$( '#set-name' ).value = '';
		await refreshSets();
		await selectSet( set.id );
		toast( 'Created “' + set.name + '”. Add its first word.' );
		switchTab( 'add' );
	} catch ( e ) {
		toast( 'Could not create the set: ' + e.message, { error: true } );
	}
} );
$( '#set-name' ).addEventListener( 'keydown', e => { if ( e.key === 'Enter' ) $( '#create-set-btn' ).click(); } );

function openSetDialog( set ) {
	const dlg = $( '#set-dialog' );
	$( '#set-edit-name' ).value = set.name;
	$( '#set-edit-language' ).value = set.language;
	dlg.returnValue = '';
	dlg.onclose = async () => {
		if ( dlg.returnValue !== 'save' ) return;
		try {
			const updated = await DB.updateSet( set.id, { name: $( '#set-edit-name' ).value, language: $( '#set-edit-language' ).value } );
			await refreshSets();
			if ( state.currentSet && state.currentSet.id === set.id ) await selectSet( updated.id );
			toast( 'Saved set.' );
		} catch ( e ) {
			toast( e.message, { error: true } );
		}
	};
	dlg.showModal();
}

async function removeSet( set ) {
	const n = set.entry_count;
	if ( ! confirm( 'Delete “' + set.name + '” and its ' + n + ' word' + ( n === 1 ? '' : 's' ) + '? Export it first if you might need it. This cannot be undone.' ) ) return;
	await DB.deleteSet( set.id );
	if ( state.currentSet && state.currentSet.id === set.id ) await selectSet( null );
	await refreshSets();
	toast( 'Deleted “' + set.name + '”.' );
}

async function exportSet( set, share ) {
	try {
		toast( 'Preparing export…', { timeout: 0 } );
		const data = await XFER.buildSetExport( set.id );
		const blob = new Blob( [ JSON.stringify( data ) ], { type: 'application/json' } );
		$( '#toast' ).hidden = true;
		await shareOrDownload( blob, XFER.exportFilename( set.slug ), share );
	} catch ( e ) {
		toast( 'Export failed: ' + e.message, { error: true } );
	}
}

$( '#backup-btn' ).addEventListener( 'click', async () => {
	try {
		toast( 'Preparing backup…', { timeout: 0 } );
		const data = await XFER.buildFullBackup();
		const blob = new Blob( [ JSON.stringify( data ) ], { type: 'application/json' } );
		$( '#toast' ).hidden = true;
		await shareOrDownload( blob, XFER.exportFilename( 'backup' ), false );
		await DB.setSetting( 'last_backup', new Date().toISOString() );
	} catch ( e ) {
		toast( 'Backup failed: ' + e.message, { error: true } );
	}
} );

$( '#import-input' ).addEventListener( 'change', async ( e ) => {
	const file = e.target.files[ 0 ];
	e.target.value = '';
	if ( ! file ) return;
	try {
		toast( 'Importing…', { timeout: 0 } );
		const res = await XFER.importFile( file );
		await refreshLanguages();
		await refreshSets();
		if ( res.sets[ 0 ] ) await selectSet( res.sets[ 0 ].id );
		const setsMsg = res.sets.length > 1 ? ' into ' + res.sets.length + ' sets' : '';
		toast( 'Imported ' + res.imported + ' word' + ( res.imported === 1 ? '' : 's' ) + setsMsg + '.' +
			( res.warnings.length ? ' ' + res.warnings.join( ' ' ) : '' ), { timeout: res.warnings.length ? 10000 : 4000 } );
	} catch ( err ) {
		toast( 'Import failed: ' + err.message, { error: true } );
	}
} );

// ── Archive ───────────────────────────────────────────────────────────────

const slider = $( '#slider' );
const player = new Audio();
let playingBtn = null;

player.addEventListener( 'ended', () => setPlaying( null ) );
player.addEventListener( 'pause', () => setPlaying( null ) );
player.addEventListener( 'error', () => {
	setPlaying( null );
	toast( 'This recording cannot play in this browser. Older .webm files may not play on iPhone or iPad.', { error: true } );
} );

function setPlaying( btn ) {
	if ( playingBtn ) {
		playingBtn.classList.remove( 'playing' );
		playingBtn.replaceChildren( icon( 'play' ) );
	}
	playingBtn = btn;
	if ( btn ) {
		btn.classList.add( 'playing' );
		btn.replaceChildren( icon( 'stop' ) );
	}
}

function play( url, btn ) {
	if ( playingBtn === btn ) { player.pause(); return; }
	player.pause();
	player.src = url;
	player.currentTime = 0;
	player.play().then( () => setPlaying( btn ) ).catch( ( e ) => {
		if ( e.name !== 'AbortError' ) toast( 'Could not play the recording.', { error: true } );
	} );
}

function revokeUrls() {
	state.objectUrls.forEach( u => URL.revokeObjectURL( u ) );
	state.objectUrls = [];
}

function objUrl( blob ) {
	const u = URL.createObjectURL( blob );
	state.objectUrls.push( u );
	return u;
}

async function loadEntries() {
	state.entries = state.currentSet ? await DB.getEntries( state.currentSet.id ) : [];
	renderCards();
}

function renderCards() {
	player.pause();
	revokeUrls();
	const filter = $( '#archive-filter' ).value.trim().toLowerCase();
	const list = filter
		? state.entries.filter( e => [ e.word_script, e.word_roman, e.description ].some( v => ( v || '' ).toLowerCase().includes( filter ) ) )
		: state.entries;

	const hasSet = !! state.currentSet;
	$( '#archive-tools' ).hidden = ! hasSet || state.entries.length === 0;
	const emptyAct = $( '#archive-empty-action' );
	emptyAct.hidden = true;

	if ( ! hasSet || list.length === 0 ) {
		$( '#deck' ).hidden = true;
		$( '#deck-count' ).textContent = '';
		$( '#archive-empty' ).hidden = false;
		if ( ! hasSet ) {
			$( '#archive-empty-title' ).textContent = state.sets.length ? 'No set chosen' : 'Start your archive';
			$( '#archive-empty-body' ).textContent = state.sets.length
				? 'Pick a set from the menu above.'
				: 'Create a set for a group of words, like “Kitchen items” or “Family terms”.';
			emptyAct.textContent = state.sets.length ? 'Manage sets' : 'Create a set';
			emptyAct.hidden = false;
			emptyAct.onclick = () => { switchTab( 'sets' ); $( '#set-name' ).focus(); };
		} else if ( state.entries.length === 0 ) {
			$( '#archive-empty-title' ).textContent = 'This set is empty';
			$( '#archive-empty-body' ).textContent = 'Add the first word with a photo and a recording.';
			emptyAct.textContent = 'Add a word';
			emptyAct.hidden = false;
			emptyAct.onclick = () => switchTab( 'add' );
		} else {
			$( '#archive-empty-title' ).textContent = 'No matches';
			$( '#archive-empty-body' ).textContent = 'No word in this set matches “' + filter + '”.';
		}
		return;
	}

	$( '#archive-empty' ).hidden = true;
	$( '#deck' ).hidden = false;
	$( '#deck' ).classList.toggle( 'grid', state.grid );

	slider.replaceChildren( ...list.map( ( e ) => {
		const word = e.word_script || e.word_roman || '';
		const playBtn = h( 'button', {
			type: 'button', class: 'play',
			'aria-label': 'Play ' + word,
			disabled: e.audio ? null : true,
		}, icon( 'play' ) );
		if ( e.audio ) {
			const url = objUrl( e.audio );
			playBtn.addEventListener( 'click', () => play( url, playBtn ) );
		}
		return h( 'article', { class: 'card', role: 'listitem', dataset: { id: e.id } },
			h( 'div', { class: 'card-photo' },
				e.image ? h( 'img', { src: objUrl( e.image ), alt: word, loading: 'lazy', decoding: 'async' } ) : icon( 'image' ),
				playBtn
			),
			h( 'div', { class: 'card-body' },
				h( 'p', { class: 'card-word', lang: state.currentSet.language === 'bpm' ? 'bpy' : state.currentSet.language, text: e.word_script || e.word_roman } ),
				e.word_script && e.word_roman ? h( 'p', { class: 'card-roman', text: e.word_roman } ) : null,
				e.description ? h( 'p', { class: 'card-desc', text: e.description } ) : null
			),
			h( 'div', { class: 'card-foot' },
				iconBtn( 'edit', 'Edit ' + word, () => startEdit( e.id ) ),
				iconBtn( 'trash', 'Delete ' + word, () => removeEntry( e.id ), 'del' )
			)
		);
	} ) );
	slider.scrollLeft = 0;
	requestAnimationFrame( updateDeckNav );
}

function cardStep() {
	const card = $( '.card', slider );
	if ( ! card ) return 0;
	return card.getBoundingClientRect().width + ( parseFloat( getComputedStyle( slider ).columnGap ) || 0 );
}

function updateDeckNav() {
	const cards = $$( '.card', slider ).length;
	if ( ! cards ) return;
	if ( state.grid ) {
		$( '#deck-count' ).textContent = cards + ( cards === 1 ? ' word' : ' words' );
		return;
	}
	const step = cardStep() || 1;
	const i = Math.min( cards - 1, Math.round( slider.scrollLeft / step ) );
	$( '#deck-count' ).textContent = ( i + 1 ) + ' of ' + cards;
	$( '#prev-btn' ).disabled = slider.scrollLeft <= 5;
	$( '#next-btn' ).disabled = slider.scrollLeft >= slider.scrollWidth - slider.clientWidth - 5;
}

let navRaf = 0;
slider.addEventListener( 'scroll', () => { cancelAnimationFrame( navRaf ); navRaf = requestAnimationFrame( updateDeckNav ); } );
window.addEventListener( 'resize', updateDeckNav );
$( '#prev-btn' ).addEventListener( 'click', () => slider.scrollBy( { left: -cardStep() } ) );
$( '#next-btn' ).addEventListener( 'click', () => slider.scrollBy( { left: cardStep() } ) );
slider.addEventListener( 'keydown', ( e ) => {
	if ( state.grid ) return;
	if ( e.key === 'ArrowRight' ) { slider.scrollBy( { left: cardStep() } ); e.preventDefault(); }
	if ( e.key === 'ArrowLeft' ) { slider.scrollBy( { left: -cardStep() } ); e.preventDefault(); }
	if ( e.key === ' ' || e.key === 'Enter' ) {
		if ( e.target !== slider ) return;
		const step = cardStep() || 1;
		const card = $$( '.card', slider )[ Math.round( slider.scrollLeft / step ) ];
		const btn = card && $( '.play', card );
		if ( btn && ! btn.disabled ) { btn.click(); e.preventDefault(); }
	}
} );

$( '#archive-filter' ).addEventListener( 'input', renderCards );

$( '#view-toggle' ).addEventListener( 'click', async () => {
	state.grid = ! state.grid;
	$( '#view-toggle' ).setAttribute( 'aria-pressed', state.grid ? 'true' : 'false' );
	await DB.setSetting( 'grid', state.grid );
	renderCards();
} );

async function removeEntry( id ) {
	const entry = await DB.getEntry( id );
	if ( ! entry ) return;
	if ( ! confirm( 'Delete “' + ( entry.word_script || entry.word_roman ) + '”?' ) ) return;
	await DB.deleteEntry( id );
	if ( state.editingId === id ) cancelEdit();
	await loadEntries();
	await refreshSets();
	toast( 'Deleted “' + ( entry.word_script || entry.word_roman ) + '”.', {
		action: 'Undo',
		onAction: async () => {
			await DB.saveEntry( entry );
			await loadEntries();
			await refreshSets();
		},
	} );
}

// ── IME ───────────────────────────────────────────────────────────────────

async function loadEngineFor( lang ) {
	state.engineLang = lang;
	state.engine = null;
	if ( ! lang ) return;
	try {
		const eng = await IME.getEngine( lang );
		if ( state.engineLang === lang ) state.engine = eng;
	} catch ( e ) {
		console.error( e );
		toast( 'The keyboard for this language could not load. You can still type in both fields.', { error: true } );
	}
}

const romanInput  = $( '#roman-input' );
const scriptInput = $( '#script-input' );

// Plugin bug fix: typing in the Roman field used to overwrite the Roman
// field itself with native script. Now each field only drives the other.
romanInput.addEventListener( 'input', ( e ) => {
	if ( e.isComposing || ! state.engine ) return;
	scriptInput.value = state.engine.forward( romanInput.value );
} );
scriptInput.addEventListener( 'input', ( e ) => {
	if ( e.isComposing || ! state.engine ) return;
	romanInput.value = state.engine.reverse( scriptInput.value.normalize( 'NFC' ) );
} );
scriptInput.addEventListener( 'compositionend', () => scriptInput.dispatchEvent( new Event( 'input' ) ) );

// ── Add / edit: photo ─────────────────────────────────────────────────────

function loadImage( file ) {
	return new Promise( ( resolve, reject ) => {
		const url = URL.createObjectURL( file );
		const img = new Image();
		img.onload  = () => { URL.revokeObjectURL( url ); resolve( img ); };
		img.onerror = () => { URL.revokeObjectURL( url ); reject( new Error( 'This image format cannot be opened here. Try a JPEG or PNG.' ) ); };
		img.src = url;
	} );
}

/**
 * Downscale anything drawable (an <img> or a live <video>) to a JPEG Blob.
 */
function toJpeg( source, w, hgt ) {
	const scale = Math.min( 1, MAX_IMAGE_DIM / w, MAX_IMAGE_DIM / hgt );
	const cw = Math.max( 1, Math.round( w * scale ) ), ch = Math.max( 1, Math.round( hgt * scale ) );
	const canvas = document.createElement( 'canvas' );
	canvas.width = cw; canvas.height = ch;
	const ctx = canvas.getContext( '2d' );
	// Transparent PNGs turned black when flattened to JPEG in the plugin.
	ctx.fillStyle = '#fff';
	ctx.fillRect( 0, 0, cw, ch );
	ctx.drawImage( source, 0, 0, cw, ch );
	return new Promise( ( resolve, reject ) => {
		canvas.toBlob( b => ( b ? resolve( b ) : reject( new Error( 'Could not process the image.' ) ) ), 'image/jpeg', IMAGE_QUALITY );
	} );
}

async function processPhoto( file ) {
	if ( file.type && ! file.type.startsWith( 'image/' ) ) throw new Error( 'That file is not an image.' );
	const img = await loadImage( file );
	return toJpeg( img, img.naturalWidth, img.naturalHeight );
}

let photoUrl = null;
function showPhoto( blob ) {
	state.photoBlob = blob;
	if ( photoUrl ) URL.revokeObjectURL( photoUrl );
	photoUrl = blob ? URL.createObjectURL( blob ) : null;
	const img = $( '#photo-preview' );
	img.hidden = ! blob;
	if ( blob ) img.src = photoUrl; else img.removeAttribute( 'src' );
}

async function usePhotoFile( file ) {
	if ( ! file ) return;
	try {
		showPhoto( await processPhoto( file ) );
		setStatus( '', '' );
	} catch ( err ) {
		setStatus( err.message, 'error' );
	}
}

for ( const id of [ '#photo-camera', '#photo-file' ] ) {
	$( id ).addEventListener( 'change', ( e ) => {
		const file = e.target.files[ 0 ];
		e.target.value = '';
		usePhotoFile( file );
	} );
}

// Drag-and-drop and paste (handy on computers).
const photoDrop = $( '#photo-drop' );
photoDrop.addEventListener( 'dragover', ( e ) => { e.preventDefault(); photoDrop.classList.add( 'dragging' ); } );
photoDrop.addEventListener( 'dragleave', () => photoDrop.classList.remove( 'dragging' ) );
photoDrop.addEventListener( 'drop', ( e ) => {
	e.preventDefault();
	photoDrop.classList.remove( 'dragging' );
	usePhotoFile( Array.from( e.dataTransfer.files ).find( f => f.type.startsWith( 'image/' ) ) );
} );
document.addEventListener( 'paste', ( e ) => {
	if ( state.tab !== 'add' ) return;
	const item = Array.from( e.clipboardData ? e.clipboardData.items : [] ).find( i => i.type.startsWith( 'image/' ) );
	if ( item ) { e.preventDefault(); usePhotoFile( item.getAsFile() ); }
} );

// ── Add / edit: camera ────────────────────────────────────────────────────
// Phones and tablets: the file input's capture attribute opens the native
// camera app (better focus, flash and resolution). Computers ignore capture
// and just show a file picker, so there we open a live camera view instead.

const cam = { stream: null, devices: [], index: 0 };
const camDialog = $( '#camera-dialog' );
const camVideo  = $( '#camera-video' );
const camMsg    = $( '#camera-msg' );
const nativeCapture = () => window.matchMedia( '(pointer: coarse)' ).matches;

function stopCamera() {
	if ( cam.stream ) cam.stream.getTracks().forEach( t => t.stop() );
	cam.stream = null;
	camVideo.srcObject = null;
}

async function startCamera( deviceId ) {
	stopCamera();
	$( '#camera-shutter' ).disabled = true;
	camMsg.textContent = 'Starting camera…';
	const video = deviceId
		? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
		: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };
	try {
		cam.stream = await navigator.mediaDevices.getUserMedia( { video, audio: false } );
	} catch ( e ) {
		camMsg.textContent = e.name === 'NotAllowedError'
			? 'Camera access is blocked. Allow it in the browser’s site settings, or close this and use Choose image.'
			: e.name === 'NotFoundError' || e.name === 'OverconstrainedError'
				? 'No camera was found. Close this and use Choose image instead.'
				: e.name === 'NotReadableError'
					? 'The camera is in use by another app. Close that app and try again.'
					: 'The camera could not start: ' + e.message;
		return;
	}
	if ( ! camDialog.open ) { stopCamera(); return; }
	camVideo.srcObject = cam.stream;
	const track = cam.stream.getVideoTracks()[ 0 ];
	const facing = track.getSettings ? track.getSettings().facingMode : undefined;
	// Mirror the preview for front/web cameras so framing feels natural; the
	// saved photo is never mirrored.
	camVideo.classList.toggle( 'mirror', facing !== 'environment' );
	try {
		cam.devices = ( await navigator.mediaDevices.enumerateDevices() ).filter( d => d.kind === 'videoinput' );
		const current = track.getSettings ? track.getSettings().deviceId : null;
		const i = cam.devices.findIndex( d => d.deviceId === current );
		if ( i >= 0 ) cam.index = i;
	} catch ( e ) { cam.devices = []; }
	$( '#camera-switch' ).hidden = cam.devices.length < 2;
	camVideo.onloadedmetadata = () => {
		camMsg.textContent = '';
		$( '#camera-shutter' ).disabled = false;
		$( '#camera-shutter' ).focus();
	};
}

function openCamera() {
	if ( nativeCapture() || ! navigator.mediaDevices || ! navigator.mediaDevices.getUserMedia ) {
		$( '#photo-camera' ).click();
		return;
	}
	if ( ! window.isSecureContext ) { setStatus( 'The camera needs a secure (https://) address.', 'error' ); return; }
	camDialog.showModal();
	startCamera( null );
}

$( '#take-photo-btn' ).addEventListener( 'click', openCamera );
$( '#camera-close' ).addEventListener( 'click', () => camDialog.close() );
camDialog.addEventListener( 'close', stopCamera );
$( '#camera-switch' ).addEventListener( 'click', () => {
	if ( cam.devices.length < 2 ) return;
	cam.index = ( cam.index + 1 ) % cam.devices.length;
	startCamera( cam.devices[ cam.index ].deviceId );
} );
$( '#camera-shutter' ).addEventListener( 'click', async () => {
	const w = camVideo.videoWidth, hgt = camVideo.videoHeight;
	if ( ! w || ! hgt ) return;
	try {
		showPhoto( await toJpeg( camVideo, w, hgt ) );
		setStatus( '', '' );
		camDialog.close();
	} catch ( e ) {
		camMsg.textContent = e.message;
	}
} );

// Hide "Take photo" on computers that have no camera at all.
if ( ! nativeCapture() && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices ) {
	navigator.mediaDevices.enumerateDevices().then( ( list ) => {
		if ( ! list.some( d => d.kind === 'videoinput' ) ) $( '#take-photo-btn' ).hidden = true;
	} ).catch( () => {} );
}

// ── Add / edit: recording ─────────────────────────────────────────────────
// Plugin bugs fixed here: recording was tied to speech recognition (so no
// audio could be captured in Firefox/Safari, which blocked saving entirely),
// the MIME type was hard-coded to audio/webm (throws on iOS Safari), audio
// was cut off as soon as recognition returned, and the microphone was never
// released.

const rec = { mr: null, stream: null, chunks: [], timer: null, started: 0, previewUrl: null };

function pickMime() {
	if ( ! window.MediaRecorder || ! MediaRecorder.isTypeSupported ) return '';
	return [ 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac' ]
		.find( t => MediaRecorder.isTypeSupported( t ) ) || '';
}

function showAudio( blob ) {
	state.audioBlob = blob;
	if ( rec.previewUrl ) URL.revokeObjectURL( rec.previewUrl );
	rec.previewUrl = blob ? URL.createObjectURL( blob ) : null;
	const a = $( '#rec-preview' );
	a.hidden = ! blob;
	if ( blob ) a.src = rec.previewUrl; else a.removeAttribute( 'src' );
	$( '#rec-label' ).textContent = blob ? 'Record again' : 'Record';
	$( '#rec-time' ).hidden = !! blob;
}

function setRecUi( on ) {
	$( '#rec-btn' ).setAttribute( 'aria-pressed', on ? 'true' : 'false' );
	$( '#rec-label' ).textContent = on ? 'Stop' : ( state.audioBlob ? 'Record again' : 'Record' );
	$( '#rec-time' ).hidden = ! on && !! state.audioBlob;
	if ( on ) $( '#rec-preview' ).hidden = true;
}

async function startRecording() {
	if ( ! window.isSecureContext ) { setStatus( 'Recording needs a secure (https://) address.', 'error' ); return; }
	if ( ! navigator.mediaDevices || ! navigator.mediaDevices.getUserMedia || ! window.MediaRecorder ) {
		setStatus( 'This browser cannot record audio. Try a current Chrome, Edge, Firefox or Safari.', 'error' );
		return;
	}
	try {
		rec.stream = await navigator.mediaDevices.getUserMedia( { audio: { echoCancellation: true, noiseSuppression: true } } );
	} catch ( e ) {
		const msg = e.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in the browser’s site settings, then try again.'
			: e.name === 'NotFoundError' ? 'No microphone was found.'
			: 'The microphone could not start: ' + e.message;
		setStatus( msg, 'error' );
		return;
	}
	const mime = pickMime();
	try {
		rec.mr = new MediaRecorder( rec.stream, mime ? { mimeType: mime } : undefined );
	} catch ( e ) {
		releaseMic();
		setStatus( 'Recording is not supported here: ' + e.message, 'error' );
		return;
	}
	rec.chunks = [];
	rec.mr.ondataavailable = ( ev ) => { if ( ev.data && ev.data.size ) rec.chunks.push( ev.data ); };
	rec.mr.onstop = () => {
		const type = ( rec.mr.mimeType || mime || 'audio/webm' ).split( ';' )[ 0 ];
		const blob = new Blob( rec.chunks, { type } );
		releaseMic();
		clearInterval( rec.timer );
		setRecUi( false );
		if ( blob.size < 800 ) { setStatus( 'The recording was empty. Try again.', 'error' ); return; }
		showAudio( blob );
		setStatus( '', '' );
	};
	rec.mr.start( 250 );
	rec.started = Date.now();
	$( '#rec-time' ).textContent = '0:00';
	setRecUi( true );
	rec.timer = setInterval( () => {
		const s = ( Date.now() - rec.started ) / 1000;
		$( '#rec-time' ).textContent = fmtTime( s );
		if ( s >= MAX_REC_SECONDS ) stopRecording();
	}, 250 );
}

function releaseMic() {
	if ( rec.stream ) rec.stream.getTracks().forEach( t => t.stop() );
	rec.stream = null;
}

function stopRecording() {
	if ( rec.mr && rec.mr.state !== 'inactive' ) rec.mr.stop();
}

$( '#rec-btn' ).addEventListener( 'click', () => {
	if ( rec.mr && rec.mr.state === 'recording' ) stopRecording();
	else startRecording();
} );

document.addEventListener( 'visibilitychange', () => { if ( document.hidden ) { stopRecording(); stopDictation(); if ( camDialog.open ) camDialog.close(); } } );

// ── Add / edit: dictation (optional, online) ──────────────────────────────

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if ( SR ) {
	$( '#dictate-btn' ).hidden = false;
	$( '#dictate-btn' ).addEventListener( 'click', () => {
		if ( recognition ) { stopDictation(); return; }
		if ( ! navigator.onLine ) { setStatus( 'Dictation needs an internet connection. Type the word instead.', 'error' ); return; }
		const lang = state.languages.find( l => l.code === ( state.currentSet && state.currentSet.language ) );
		recognition = new SR();
		recognition.lang = ( lang && lang.speech_locale ) || 'bn-IN';
		recognition.interimResults = false;
		recognition.maxAlternatives = 1;
		recognition.onresult = ( ev ) => {
			// Plugin lower-cased the transcript; that corrupts Latin-script languages.
			const text = ev.results[ 0 ][ 0 ].transcript.replace( /[.।!?]+$/u, '' ).trim();
			scriptInput.value = text;
			scriptInput.dispatchEvent( new Event( 'input' ) );
		};
		recognition.onerror = ( ev ) => {
			if ( ev.error === 'no-speech' ) setStatus( 'No speech was heard. Try again.', 'error' );
			else if ( ev.error === 'not-allowed' ) setStatus( 'Microphone access is blocked for dictation.', 'error' );
			else if ( ev.error === 'language-not-supported' ) setStatus( 'Dictation does not support ' + recognition.lang + ' in this browser.', 'error' );
			else if ( ev.error !== 'aborted' ) setStatus( 'Dictation failed (' + ev.error + ').', 'error' );
		};
		// Plugin had no onend, so the button stayed on "Listening…" forever
		// when nothing was recognised.
		recognition.onend = () => { recognition = null; $( '#dictate-btn' ).classList.remove( 'listening' ); };
		try {
			recognition.start();
			$( '#dictate-btn' ).classList.add( 'listening' );
		} catch ( e ) {
			recognition = null;
			setStatus( 'Dictation could not start.', 'error' );
		}
	} );
}

function stopDictation() {
	if ( recognition ) try { recognition.stop(); } catch ( e ) { /* already stopped */ }
}

// ── Add / edit: save ──────────────────────────────────────────────────────

function setStatus( msg, type ) {
	const el = $( '#entry-status' );
	el.textContent = msg;
	el.className = 'status' + ( type ? ' ' + type : '' );
}

function updateAddHeader() {
	const sub = $( '#add-sub' );
	sub.replaceChildren();
	if ( state.currentSet ) {
		sub.append( state.editingId ? 'In ' : 'Adding to ', h( 'strong', { text: state.currentSet.name } ), ', in ' + langLabel( state.currentSet.language ) );
	} else {
		sub.textContent = 'Choose or create a set first.';
	}
	$( '#add-title' ).textContent = state.editingId ? 'Edit word' : 'New word';
	$( '#save-entry-btn' ).textContent = state.editingId ? 'Save changes' : 'Add to archive';
	$( '#cancel-edit-btn' ).hidden = ! state.editingId;
	$( '#save-entry-btn' ).disabled = ! state.currentSet;
}

function resetForm() {
	stopRecording();
	romanInput.value = '';
	scriptInput.value = '';
	$( '#desc-input' ).value = '';
	showPhoto( null );
	showAudio( null );
	state.editingId = null;
	state.editingEntry = null;
	updateAddHeader();
}

async function startEdit( id ) {
	const e = await DB.getEntry( id );
	if ( ! e ) return;
	resetForm();
	state.editingId = id;
	state.editingEntry = e;
	romanInput.value  = e.word_roman || '';
	scriptInput.value = e.word_script || '';
	$( '#desc-input' ).value = e.description || '';
	showPhoto( e.image || null );
	showAudio( e.audio || null );
	setStatus( '', '' );
	switchTab( 'add' );
}

function cancelEdit() {
	resetForm();
	setStatus( '', '' );
}

$( '#cancel-edit-btn' ).addEventListener( 'click', () => { cancelEdit(); switchTab( 'archive' ); } );

$( '#save-entry-btn' ).addEventListener( 'click', async () => {
	if ( ! state.currentSet ) { setStatus( 'Choose or create a set first.', 'error' ); return; }
	if ( rec.mr && rec.mr.state === 'recording' ) { setStatus( 'Stop the recording first.', 'error' ); return; }
	const word_script = scriptInput.value.trim();
	const word_roman  = romanInput.value.trim();
	const missing = [];
	if ( ! word_script ) missing.push( 'the word in script' );
	if ( ! state.audioBlob ) missing.push( 'a recording' );
	if ( missing.length ) { setStatus( 'Add ' + missing.join( ' and ' ) + ' before saving.', 'error' ); return; }

	const btn = $( '#save-entry-btn' );
	btn.disabled = true;
	try {
		const base = state.editingEntry || { set_id: state.currentSet.id };
		const saved = await DB.saveEntry( Object.assign( {}, base, {
			word_script,
			word_roman,
			description: $( '#desc-input' ).value,
			image: state.photoBlob,
			audio: state.audioBlob,
		} ) );
		const wasEdit = !! state.editingId;
		resetForm();
		await loadEntries();
		await refreshSets();
		if ( wasEdit ) {
			toast( 'Saved “' + saved.word_script + '”.' );
			switchTab( 'archive' );
			const idx = state.entries.findIndex( x => x.id === saved.id );
			if ( idx > 0 ) requestAnimationFrame( () => { slider.scrollLeft = idx * cardStep(); } );
		} else {
			setStatus( 'Added “' + saved.word_script + '”. Ready for the next word.', 'success' );
			romanInput.focus();
		}
		maybeRequestPersist();
	} catch ( e ) {
		setStatus( 'Could not save: ' + ( e.name === 'QuotaExceededError' ? 'this device is out of storage space.' : e.message ), 'error' );
	} finally {
		btn.disabled = ! state.currentSet;
	}
} );

// ── Settings ──────────────────────────────────────────────────────────────

async function refreshSettings() {
	// Storage.
	const info = $( '#storage-info' );
	const persistBtn = $( '#persist-btn' );
	if ( navigator.storage && navigator.storage.estimate ) {
		const est = await navigator.storage.estimate();
		const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
		const lastBackup = await DB.getSetting( 'last_backup' );
		info.textContent = 'Using ' + fmtBytes( est.usage ) + ( est.quota ? ' of about ' + fmtBytes( est.quota ) + ' available' : '' ) + '. ' +
			( persisted ? 'The browser will not clear this data on its own.' : 'The browser may clear this data if the device runs low on space.' ) + ' ' +
			( lastBackup ? 'Last backup: ' + new Date( lastBackup ).toLocaleDateString() + '.' : 'You have not backed up yet — use Sets → Back up everything.' );
		persistBtn.hidden = persisted || ! navigator.storage.persist;
	} else {
		info.textContent = 'Storage details are not available in this browser. Back up regularly from the Sets tab.';
	}
	renderLanguages();
	updateTry();
}

$( '#persist-btn' ).addEventListener( 'click', async () => {
	const ok = await navigator.storage.persist();
	toast( ok ? 'Your archive is now protected from automatic cleanup.' : 'The browser declined. Installing the app usually allows it.' , { error: ! ok } );
	refreshSettings();
} );

let persistAsked = false;
async function maybeRequestPersist() {
	if ( persistAsked || ! navigator.storage || ! navigator.storage.persist ) return;
	persistAsked = true;
	try { if ( ! ( await navigator.storage.persisted() ) ) await navigator.storage.persist(); } catch ( e ) { /* ignore */ }
}

function renderLanguages() {
	$( '#lang-list' ).replaceChildren( ...state.languages.map( l => h( 'li', { class: 'lang-item' },
		h( 'div', { class: 'lang-meta' },
			h( 'div', { class: 'lang-name', text: l.label } ),
			h( 'div', { class: 'lang-sub', text: 'Code ' + l.code + ', dictation ' + l.speech_locale + ( l.builtin ? ', built in' : '' ) } )
		),
		h( 'div', { class: 'lang-actions' },
			iconBtn( 'edit', 'Keyboard files for ' + l.label, () => openLangDialog( l ) ),
			l.builtin ? null : iconBtn( 'trash', 'Remove ' + l.label, () => removeLanguage( l ), 'del' )
		)
	) ) );
}

$( '#add-lang-btn' ).addEventListener( 'click', async () => {
	const code   = $( '#lang-code' ).value.trim().toLowerCase();
	const label  = $( '#lang-label' ).value.trim();
	const locale = $( '#lang-locale' ).value.trim() || 'bn-IN';
	const clone  = $( '#lang-clone' ).value;
	if ( ! /^[a-z][a-z0-9_]{1,19}$/.test( code ) ) { toast( 'Use 2–20 lowercase letters, digits or underscores for the code, starting with a letter.', { error: true } ); return; }
	if ( state.languages.some( l => l.code === code ) ) { toast( 'The code “' + code + '” is already in use.', { error: true } ); return; }
	if ( ! label ) { toast( 'Give the language a name.', { error: true } ); return; }
	if ( ! /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test( locale ) ) { toast( 'Dictation locale should look like bn-IN or as-IN.', { error: true } ); return; }
	await DB.putLanguage( { code, label, speech_locale: locale, builtin: false } );
	if ( clone ) await IME.cloneFiles( clone, code );
	[ '#lang-code', '#lang-label', '#lang-locale' ].forEach( s => { $( s ).value = ''; } );
	await refreshLanguages();
	renderLanguages();
	toast( 'Added ' + label + '.' );
} );

async function removeLanguage( l ) {
	const n = await DB.countSetsUsingLanguage( l.code );
	if ( n ) { toast( n + ' set' + ( n === 1 ? ' uses' : 's use' ) + ' ' + l.label + '. Change their language first.', { error: true } ); return; }
	if ( ! confirm( 'Remove ' + l.label + ' and its keyboard files?' ) ) return;
	await DB.deleteLanguage( l.code );
	IME.invalidate( l.code );
	await refreshLanguages();
	renderLanguages();
	toast( 'Removed ' + l.label + '.' );
}

async function openLangDialog( l ) {
	$( '#lang-dialog-title' ).textContent = 'Keyboard files — ' + l.label;
	await renderLangFiles( l );
	$( '#lang-dialog' ).showModal();
}

async function renderLangFiles( l ) {
	const wrap = $( '#lang-files' );
	const rows = [];
	for ( const key of Object.keys( IME.FILE_KEYS ) ) {
		const override = await DB.getImeOverride( l.code, key );
		const backups  = await DB.getImeBackups( l.code, key );
		const input = h( 'input', { type: 'file', accept: '.json,application/json', hidden: true } );
		input.addEventListener( 'change', async () => {
			const f = input.files[ 0 ];
			input.value = '';
			if ( ! f ) return;
			try {
				const res = await IME.replaceFile( l.code, key, f );
				afterImeChange( l );
				toast( 'Replaced ' + IME.FILE_LABELS[ key ].toLowerCase() + '.' + ( res.warnings.length ? ' ' + res.warnings.join( ' ' ) : '' ), { timeout: res.warnings.length ? 9000 : 3500 } );
				renderLangFiles( l );
			} catch ( e ) {
				toast( e.message, { error: true } );
			}
		} );
		rows.push( h( 'div', { class: 'file-row' },
			h( 'div', { class: 'file-row-head' },
				h( 'span', { class: 'file-name', text: IME.FILE_LABELS[ key ] } ),
				h( 'span', { class: 'badge' + ( override ? ' custom' : '' ), text: override ? 'Custom' + ( override.filename ? ': ' + override.filename : '' ) : 'Bundled default' } )
			),
			h( 'div', { class: 'row-actions' },
				h( 'label', { class: 'btn btn-quiet btn-sm' }, icon( 'up' ), 'Replace', input ),
				h( 'button', { type: 'button', class: 'btn btn-quiet btn-sm', onclick: async () => {
					const data = await IME.getActiveFile( l.code, key );
					downloadBlob( new Blob( [ JSON.stringify( data, null, 2 ) ], { type: 'application/json' } ), l.code + '-' + IME.FILE_KEYS[ key ] );
				} }, icon( 'down' ), 'Download' ),
				override ? h( 'button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: async () => {
					if ( ! confirm( 'Go back to the bundled default? The custom file is kept as a backup.' ) ) return;
					await IME.revertToDefault( l.code, key );
					afterImeChange( l );
					renderLangFiles( l );
				} }, icon( 'restore' ), 'Use default' ) : null
			),
			backups.length ? h( 'details', { class: 'backups' },
				h( 'summary', { text: backups.length + ' earlier version' + ( backups.length === 1 ? '' : 's' ) } ),
				h( 'ul', {}, ...backups.map( b => h( 'li', {},
					h( 'span', { text: new Date( b.created_at ).toLocaleString() + ( b.filename ? ' (' + b.filename + ')' : '' ) } ),
					h( 'button', { type: 'button', class: 'btn btn-quiet btn-sm', onclick: async () => {
						await IME.restoreBackup( l.code, key, b.id );
						afterImeChange( l );
						toast( 'Restored.' );
						renderLangFiles( l );
					} }, 'Restore' )
				) ) )
			) : null
		) );
	}
	wrap.replaceChildren( ...rows );
}

function afterImeChange( l ) {
	IME.invalidate( l.code );
	if ( state.currentSet && state.currentSet.language === l.code ) loadEngineFor( l.code );
	updateTry();
}

async function updateTry() {
	const lang = $( '#try-lang' ).value;
	const text = $( '#try-input' ).value;
	if ( ! lang ) return;
	const eng = await IME.getEngine( lang );
	const out = eng.forward( text );
	$( '#try-out' ).textContent = out;
	$( '#try-back' ).textContent = text ? 'Back to Roman: ' + eng.reverse( out ) : '';
}
$( '#try-input' ).addEventListener( 'input', updateTry );
$( '#try-lang' ).addEventListener( 'change', updateTry );

// ── Install / offline / updates ───────────────────────────────────────────

let deferredInstall = null;
const standalone = window.matchMedia( '(display-mode: standalone)' ).matches || navigator.standalone;

window.addEventListener( 'beforeinstallprompt', ( e ) => {
	e.preventDefault();
	deferredInstall = e;
	$( '#install-block' ).hidden = false;
	$( '#install-btn' ).hidden = false;
} );
$( '#install-btn' ).addEventListener( 'click', async () => {
	if ( ! deferredInstall ) return;
	deferredInstall.prompt();
	await deferredInstall.userChoice;
	deferredInstall = null;
	$( '#install-block' ).hidden = true;
} );
window.addEventListener( 'appinstalled', () => { $( '#install-block' ).hidden = true; maybeRequestPersist(); } );

if ( ! standalone && /iphone|ipad|ipod/i.test( navigator.userAgent ) ) {
	$( '#install-block' ).hidden = false;
	$( '#install-hint' ).textContent = 'To install on iPhone or iPad, open this page in Safari, tap Share, then “Add to Home Screen”.';
}

function updateOnline() { $( '#offline-pill' ).hidden = navigator.onLine; }
window.addEventListener( 'online', updateOnline );
window.addEventListener( 'offline', updateOnline );

function registerSW() {
	if ( ! ( 'serviceWorker' in navigator ) ) return;
	let reloading = false;
	navigator.serviceWorker.addEventListener( 'controllerchange', () => {
		if ( reloading ) return;
		reloading = true;
		location.reload();
	} );
	navigator.serviceWorker.register( 'sw.js' ).then( ( reg ) => {
		const offer = ( worker ) => toast( 'A new version of LexiPic is ready.', {
			action: 'Update', timeout: 0,
			onAction: () => worker.postMessage( { type: 'SKIP_WAITING' } ),
		} );
		if ( reg.waiting && navigator.serviceWorker.controller ) offer( reg.waiting );
		reg.addEventListener( 'updatefound', () => {
			const w = reg.installing;
			w && w.addEventListener( 'statechange', () => {
				if ( w.state === 'installed' && navigator.serviceWorker.controller ) offer( w );
			} );
		} );
	} ).catch( e => console.warn( 'LexiPic: service worker not registered', e ) );
}

async function setIdFromHash() {
	const m = /[#&]set=([^&]+)/.exec( location.hash );
	if ( ! m ) return null;
	const s = await DB.getSetBySlug( decodeURIComponent( m[ 1 ] ) );
	if ( ! s ) toast( 'That set is not on this device.', { error: true } );
	return s ? s.id : null;
}

window.addEventListener( 'hashchange', async () => {
	const id = await setIdFromHash();
	if ( id && ( ! state.currentSet || state.currentSet.id !== id ) ) {
		await selectSet( id );
		switchTab( 'archive' );
	}
} );

// ── Boot ──────────────────────────────────────────────────────────────────

async function boot() {
	$( '#version' ).textContent = 'LexiPic ' + XFER.APP_VERSION + '. Your data stays on this device.';
	updateOnline();
	try {
		await DB.open();
	} catch ( e ) {
		$( '#archive-empty-title' ).textContent = 'Storage is unavailable';
		$( '#archive-empty-body' ).textContent = e.message + ' Private browsing modes can block storage.';
		return;
	}
	state.grid = !! ( await DB.getSetting( 'grid', false ) );
	$( '#view-toggle' ).setAttribute( 'aria-pressed', state.grid ? 'true' : 'false' );
	await refreshLanguages();
	await refreshSets();

	// Deep link #set=<slug> (the plugin's [lexipic set="slug"] preload never
	// worked: options were matched on a data-slug attribute that was never set).
	let target = await setIdFromHash();
	if ( ! target ) target = await DB.getSetting( 'last_set' );
	if ( target && state.sets.some( s => s.id === target ) ) await selectSet( target );
	else renderCards();
	updateAddHeader();
	const tab = new URLSearchParams( location.search ).get( 'tab' );
	if ( tab && [ 'archive', 'add', 'sets', 'settings' ].includes( tab ) ) switchTab( tab );
	registerSW();
}

boot();
