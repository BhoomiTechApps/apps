/**
 * OCR Studio 2.0 — offline recognition, exports, source details,
 * collection (corpus), custom language models, keyboard, image enhancement.
 *
 * Works alongside app.js (file loading, PDF paging, deskew, perspective,
 * recording). Everything stays on the device.
 */
/* global Tesseract, pdfDoc, currentPage, currentFile, showToast, renderPage, processImage, exitPerspectiveMode, CPLAI_ENGINE, lucide, ZipWriter */
( function () {
	'use strict';

	const APP_VERSION = '2.0.0';
	const ENGINE_LABEL = 'Tesseract 5 LSTM (tesseract.js 5.1.1, tessdata 4.0.0 best_int)';
	const abs = p => new URL( p, location.href ).href;
	const TESS_PATHS = {
		workerPath: abs( 'vendor/tesseract/worker.min.js' ),
		corePath:   abs( 'vendor/tesseract/core' ),
		langPath:   abs( 'vendor/tesseract/lang' ),
	};
	const BUILTIN = { ben: 'Bengali', asm: 'Assamese', eng: 'English' };
	const OFFLINE_FILES = [
		'vendor/tesseract/worker.min.js',
		'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
		'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
		'vendor/tesseract/lang/ben.traineddata.gz',
		'vendor/tesseract/lang/asm.traineddata.gz',
		'vendor/tesseract/lang/eng.traineddata.gz',
	];
	const RIGHTS_LABEL = {
		unknown: 'Permission not yet known',
		'public-domain': 'Public domain',
		permission: 'Used with permission',
		'open-licence': 'Open licence',
		'community-only': 'Community use only',
	};

	const $ = id => document.getElementById( id );
	const output = $( 'output' );

	const state = {
		worker: null,
		workerLang: null,
		result: null,   // last recognition: { page, fileName, lang, rawText, lines, pdf, snapshot, confidence, at }
		audio: null,    // { blob, url, page }
		source: {},
		sourceKey: null,
		busy: false,
	};

	// ── Helpers ─────────────────────────────────────────────────────────────

	function download( blob, name ) {
		const url = URL.createObjectURL( blob );
		const a = document.createElement( 'a' );
		a.href = url;
		a.download = name;
		document.body.appendChild( a );
		a.click();
		a.remove();
		setTimeout( () => URL.revokeObjectURL( url ), 30000 );
	}

	function slug( s ) {
		return String( s || '' ).normalize( 'NFC' ).trim()
			.replace( /\.[a-z0-9]{2,5}$/i, '' )
			.replace( /[^\p{L}\p{M}\p{N}]+/gu, '-' )
			.replace( /^-+|-+$/g, '' )
			.slice( 0, 60 ) || 'page';
	}

	function currentPageNo() {
		return typeof pdfDoc !== 'undefined' && pdfDoc ? currentPage : 1;
	}

	function fileName() {
		return typeof currentFile !== 'undefined' && currentFile ? currentFile.name : '';
	}

	function baseName( page ) {
		return slug( state.source.title || fileName() || 'page' ) + '_p' + String( page ).padStart( 3, '0' );
	}

	function cloneCanvas( src ) {
		const c = document.createElement( 'canvas' );
		c.width = src.width;
		c.height = src.height;
		c.getContext( '2d' ).drawImage( src, 0, 0 );
		return c;
	}

	function canvasBlob( c, type, q ) {
		return new Promise( ( res, rej ) => c.toBlob( b => ( b ? res( b ) : rej( new Error( 'Could not encode image.' ) ) ), type, q ) );
	}

	function esc( s ) {
		return String( s ).replace( /[&<>"']/g, ch => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ ch ] ) );
	}

	function refreshIcons() {
		if ( window.lucide ) lucide.createIcons();
	}

	// ── IndexedDB ───────────────────────────────────────────────────────────

	let dbp = null;
	function db() {
		if ( dbp ) return dbp;
		dbp = new Promise( ( res, rej ) => {
			const r = indexedDB.open( 'ocr-studio', 1 );
			r.onupgradeneeded = () => {
				const d = r.result;
				d.createObjectStore( 'collection', { keyPath: 'id', autoIncrement: true } );
				d.createObjectStore( 'models', { keyPath: 'code' } );
				d.createObjectStore( 'sources', { keyPath: 'key' } );
			};
			r.onsuccess = () => res( r.result );
			r.onerror = () => rej( r.error );
		} );
		return dbp;
	}
	async function tx( store, mode, fn ) {
		const d = await db();
		return new Promise( ( res, rej ) => {
			const t = d.transaction( store, mode );
			const out = fn( t.objectStore( store ) );
			t.oncomplete = () => res( out && 'result' in out ? out.result : out );
			t.onerror = () => rej( t.error );
			t.onabort = () => rej( t.error || new Error( 'Storage error' ) );
		} );
	}
	const dbGet    = ( s, k ) => tx( s, 'readonly', o => o.get( k ) );
	const dbAll    = s => tx( s, 'readonly', o => o.getAll() );
	const dbPut    = ( s, v ) => tx( s, 'readwrite', o => o.put( v ) );
	const dbDel    = ( s, k ) => tx( s, 'readwrite', o => o.delete( k ) );
	const dbClear  = s => tx( s, 'readwrite', o => o.clear() );
	const dbCount  = s => tx( s, 'readonly', o => o.count() );

	// ── Recognition (bundled engine, reusable worker) ───────────────────────
	// The original app called Tesseract.recognize() per page, which re-created
	// the engine every time and downloaded it plus the language models from a
	// CDN. Now the engine and models ship with the app and one worker is reused.

	function setProgress( text, pct ) {
		const bar = $( 'ocrProgress' ), label = $( 'progressText' );
		bar.style.display = 'inline-block';
		label.style.display = 'inline-block';
		if ( pct !== undefined ) bar.value = pct;
		label.innerText = text;
	}

	function hideProgress( delay ) {
		setTimeout( () => {
			$( 'ocrProgress' ).style.display = 'none';
			$( 'progressText' ).style.display = 'none';
		}, delay || 0 );
	}

	const STATUS = {
		'loading tesseract core': 'Loading engine…',
		'initializing tesseract': 'Starting…',
		'initializing api': 'Starting…',
		'loading language traineddata': 'Loading language…',
		'initialized api': 'Ready',
	};

	// Tesseract.js reads models from its own cache (idb-keyval: database
	// "keyval-store", store "keyval", key "./<code>.traineddata") before
	// fetching. Custom models are placed there so they load by code, exactly
	// like a built-in language. (Passing { code, data } objects directly hits
	// a bug in tesseract.js 5.1.1, which names the language after its data.)
	function keyvalPut( key, value ) {
		return new Promise( ( res, rej ) => {
			const r = indexedDB.open( 'keyval-store' );
			r.onupgradeneeded = () => { if ( ! r.result.objectStoreNames.contains( 'keyval' ) ) r.result.createObjectStore( 'keyval' ); };
			r.onsuccess = () => {
				const d = r.result;
				if ( ! d.objectStoreNames.contains( 'keyval' ) ) { d.close(); rej( new Error( 'Model cache unavailable' ) ); return; }
				const t = d.transaction( 'keyval', 'readwrite' );
				if ( value === undefined ) t.objectStore( 'keyval' ).delete( key ); else t.objectStore( 'keyval' ).put( value, key );
				t.oncomplete = () => { d.close(); res(); };
				t.onerror = () => { d.close(); rej( t.error ); };
			};
			r.onerror = () => rej( r.error );
		} );
	}

	async function getWorker( langStr ) {
		if ( state.worker && state.workerLang === langStr ) return state.worker;
		if ( state.worker ) {
			try { await state.worker.terminate(); } catch ( e ) { /* ignore */ }
			state.worker = null;
		}
		for ( const code of langStr.split( '+' ) ) {
			if ( BUILTIN[ code ] ) continue;
			const m = await dbGet( 'models', code );
			if ( ! m ) throw new Error( 'The language model "' + code + '" is not installed on this device.' );
			await keyvalPut( './' + code + '.traineddata', new Uint8Array( m.data ) );
		}
		// tesseract.js swallows initialisation errors and never settles the
		// createWorker() promise; surface them through errorHandler instead.
		let fail, dead = false;
		const failed = new Promise( ( _, rej ) => { fail = rej; } );
		failed.catch( () => {} );
		const created = Tesseract.createWorker( langStr, 1, Object.assign( {}, TESS_PATHS, {
			gzip: true,
			cacheMethod: 'readOnly',  // read custom models from the cache; built-ins come from the app's offline files
			workerBlobURL: false,     // same-origin worker, so the service worker serves its files offline
			logger: ( m ) => {
				if ( dead ) return; // a failed worker may still report progress
				if ( m.status === 'recognizing text' ) setProgress( Math.round( m.progress * 100 ) + '%', Math.round( m.progress * 100 ) );
				else if ( STATUS[ m.status ] ) setProgress( STATUS[ m.status ] );
			},
			errorHandler: ( e ) => {
				dead = true;
				const msg = String( e && e.message ? e.message : e );
				fail( new Error( /initiali[sz]ation failed/i.test( msg )
					? 'The language model could not be loaded. If it is a custom model, the file may be damaged or not a Tesseract 4/5 LSTM model.'
					: msg ) );
			},
		} ) );
		const w = await Promise.race( [ created, failed ] );
		state.worker = w;
		state.workerLang = langStr;
		state.workerFailed = failed;
		return w;
	}

	function collectLines( data ) {
		if ( Array.isArray( data.lines ) && data.lines.length ) {
			return data.lines.map( l => ( { text: ( l.text || '' ).replace( /\s+$/, '' ), bbox: l.bbox } ) );
		}
		const out = [];
		( data.blocks || [] ).forEach( b => ( b.paragraphs || [] ).forEach( p => ( p.lines || [] ).forEach( l => out.push( { text: ( l.text || '' ).replace( /\s+$/, '' ), bbox: l.bbox } ) ) ) );
		return out;
	}

	window.runRecognition = async function () {
		if ( state.busy ) return;
		const canvas = $( 'canvas' );
		if ( ! canvas.width || ! canvas.height ) { showToast( 'Choose a file first.' ); return; }
		const lang = $( 'lang' ).value;
		state.busy = true;
		$( 'startBtn' ).disabled = true;
		setProgress( 'Starting…', 0 );
		try {
			const w = await getWorker( lang );
			const snapshot = cloneCanvas( canvas );
			const page = currentPageNo();
			const { data } = await Promise.race( [
				w.recognize( snapshot, { pdfTitle: state.source.title || fileName() || 'OCR Studio' }, { text: true, blocks: true, pdf: true } ),
				state.workerFailed,
			] );
			state.result = {
				page,
				fileName: fileName(),
				lang,
				rawText: ( data.text || '' ).replace( /\s+$/, '' ),
				lines: collectLines( data ),
				pdf: data.pdf ? new Uint8Array( data.pdf ) : null,
				snapshot,
				confidence: Math.round( data.confidence || 0 ),
				at: new Date().toISOString(),
			};
			output.value = state.result.rawText;
			if ( state.audio && state.audio.page !== page ) {
				discardAudio( true );
				showToast( 'The recording belonged to another page and was removed.' );
			}
			setProgress( 'Done!', 100 );
			hideProgress( 2000 );
			updateTextStatus();
		} catch ( e ) {
			console.error( e ); // eslint-disable-line no-console
			setProgress( 'Failed', 0 );
			hideProgress( 3000 );
			showToast( 'Recognition failed: ' + ( e && e.message ? e.message : e ) );
			if ( state.worker ) { try { await state.worker.terminate(); } catch ( err ) { /* ignore */ } }
			state.worker = null;
		} finally {
			state.busy = false;
			$( 'startBtn' ).disabled = false;
		}
	};

	// ── Line alignment (training data) ──────────────────────────────────────

	function alignment() {
		if ( ! state.result ) return { ok: false, reason: 'Run OCR on this page first.' };
		const detected = state.result.lines.filter( l => l.text.trim() && l.bbox );
		const typed = output.value.normalize( 'NFC' ).split( /\r?\n/ ).map( s => s.trim() ).filter( Boolean );
		if ( ! detected.length ) return { ok: false, reason: 'No text lines were detected on this page.' };
		if ( detected.length !== typed.length ) {
			return {
				ok: false, detected: detected.length, typed: typed.length,
				reason: 'The page has ' + detected.length + ' printed lines but the text has ' + typed.length + '. Keep one line of text per printed line to export training lines.',
			};
		}
		return { ok: true, pairs: detected.map( ( l, i ) => ( { bbox: l.bbox, text: typed[ i ] } ) ) };
	}

	async function lineImages( pairs, snapshot ) {
		const out = [];
		for ( const p of pairs ) {
			const pad = 4;
			const x0 = Math.max( 0, p.bbox.x0 - pad ), y0 = Math.max( 0, p.bbox.y0 - pad );
			const x1 = Math.min( snapshot.width, p.bbox.x1 + pad ), y1 = Math.min( snapshot.height, p.bbox.y1 + pad );
			if ( x1 <= x0 || y1 <= y0 ) continue;
			const c = document.createElement( 'canvas' );
			c.width = x1 - x0;
			c.height = y1 - y0;
			c.getContext( '2d' ).drawImage( snapshot, x0, y0, c.width, c.height, 0, 0, c.width, c.height );
			out.push( { png: await canvasBlob( c, 'image/png' ), text: p.text } );
		}
		return out;
	}

	function updateTextStatus() {
		const el = $( 'textStatus' );
		const chars = output.value.replace( /\s/g, '' ).length;
		if ( ! state.result ) {
			el.textContent = chars ? chars.toLocaleString() + ' characters (typed)' : '';
			return;
		}
		const a = alignment();
		const edited = output.value.normalize( 'NFC' ) !== state.result.rawText.normalize( 'NFC' );
		el.innerHTML = '';
		const parts = [
			'Page ' + state.result.page,
			chars.toLocaleString() + ' characters',
			'confidence ' + state.result.confidence + '%',
			edited ? 'corrected' : 'not yet corrected',
		];
		el.append( parts.join( ', ' ) + '. ' );
		const span = document.createElement( 'span' );
		span.className = a.ok ? 'ok' : 'warn';
		span.textContent = a.ok
			? 'Training lines ready (' + a.pairs.length + ').'
			: ( a.detected ? 'Text has ' + a.typed + ' lines, page has ' + a.detected + ': training lines need one text line per printed line.' : '' );
		el.append( span );
	}

	output.addEventListener( 'input', () => {
		clearTimeout( updateTextStatus.t );
		updateTextStatus.t = setTimeout( updateTextStatus, 250 );
	} );

	// ── Records (what gets saved / collected) ───────────────────────────────

	async function buildRecord( { withPdf = true } = {} ) {
		const text = output.value.normalize( 'NFC' ).replace( /\s+$/, '' );
		const r = state.result;
		if ( ! text.trim() && ! r ) throw new Error( 'There is nothing to save yet. Run OCR or type the text first.' );
		const page = r ? r.page : currentPageNo();
		const canvas = $( 'canvas' );
		const snapshot = r ? r.snapshot : ( canvas.width ? cloneCanvas( canvas ) : null );
		const a = alignment();
		const lines = a.ok && r ? await lineImages( a.pairs, r.snapshot ) : [];
		const meta = {
			title: state.source.title || '',
			author: state.source.author || '',
			year: state.source.year || '',
			edition: state.source.edition || '',
			publisher: state.source.publisher || '',
			language: state.source.language || '',
			script: state.source.script || 'Beng',
			rights: state.source.rights || 'unknown',
			rights_label: RIGHTS_LABEL[ state.source.rights || 'unknown' ],
			digitised_by: state.source.contributor || '',
			place: state.source.place || '',
			notes: state.source.notes || '',
			file_name: r ? r.fileName : fileName(),
			file_page: page,
			method: r ? 'ocr' : 'manual transcription',
			ocr: r ? {
				engine: ENGINE_LABEL,
				languages: r.lang,
				mean_confidence: r.confidence,
				recognised_at: r.at,
			} : null,
			proofread: r ? text !== r.rawText.normalize( 'NFC' ) : true,
			characters: text.replace( /\s/g, '' ).length,
			unicode: 'UTF-8, NFC',
			training_lines: lines.length,
			has_recording: !! ( state.audio && state.audio.page === page ),
			app: 'OCR Studio ' + APP_VERSION,
			saved_at: new Date().toISOString(),
		};
		return {
			base: baseName( page ),
			page,
			meta,
			text,
			rawText: r ? r.rawText : '',
			image: snapshot && snapshot.width ? await canvasBlob( snapshot, 'image/jpeg', 0.92 ) : null,
			audio: state.audio && state.audio.page === page ? state.audio.blob : null,
			pdf: withPdf && r && r.pdf ? new Blob( [ r.pdf ], { type: 'application/pdf' } ) : null,
			lines,
		};
	}

	async function addRecordToZip( zip, rec, folder ) {
		const f = folder ? folder + '/' : '';
		if ( rec.image ) await zip.add( f + 'page.jpg', rec.image );
		await zip.add( f + 'text.txt', rec.text + '\n' );
		if ( rec.rawText ) await zip.add( f + 'recognised.txt', rec.rawText + '\n' );
		if ( rec.audio ) await zip.add( f + 'reading.wav', rec.audio );
		if ( rec.pdf ) await zip.add( f + 'searchable.pdf', rec.pdf );
		await zip.add( f + 'metadata.json', JSON.stringify( rec.meta, null, 2 ) + '\n' );
		for ( let i = 0; i < rec.lines.length; i++ ) {
			const n = rec.base + '_' + String( i + 1 ).padStart( 3, '0' );
			await zip.add( f + 'training/' + n + '.png', rec.lines[ i ].png );
			await zip.add( f + 'training/' + n + '.gt.txt', rec.lines[ i ].text + '\n' );
		}
	}

	// ── Save dialog ─────────────────────────────────────────────────────────

	window.openSave = function () {
		const a = alignment();
		$( 'saveLinesNote' ).textContent = a.ok
			? a.pairs.length + ' line images paired with your corrected text, in the format used to train Tesseract models (tesstrain).'
			: a.reason;
		$( 'saveLinesBtn' ).disabled = ! a.ok;
		const hasPdf = !! ( state.result && state.result.pdf );
		$( 'savePdfBtn' ).disabled = ! hasPdf;
		$( 'savePdfNote' ).textContent = hasPdf
			? 'The page image with a hidden, searchable text layer. The layer holds the machine-recognised text, before your corrections.'
			: 'Run OCR on this page first.';
		$( 'saveDialog' ).showModal();
	};

	window.saveText = function () {
		const text = output.value.normalize( 'NFC' );
		if ( ! text.trim() ) { showToast( 'There is no text to save.' ); return; }
		const page = state.result ? state.result.page : currentPageNo();
		download( new Blob( [ text.replace( /\s+$/, '' ) + '\n' ], { type: 'text/plain;charset=utf-8' } ), baseName( page ) + '.txt' );
		$( 'saveDialog' ).close();
	};

	window.savePdf = function () {
		if ( ! state.result || ! state.result.pdf ) { showToast( 'Run OCR on this page first.' ); return; }
		download( new Blob( [ state.result.pdf ], { type: 'application/pdf' } ), baseName( state.result.page ) + '.pdf' );
		$( 'saveDialog' ).close();
	};

	window.saveBundle = async function () {
		try {
			const rec = await buildRecord();
			const zip = new ZipWriter();
			await addRecordToZip( zip, rec, rec.base );
			download( zip.toBlob(), rec.base + '.zip' );
			$( 'saveDialog' ).close();
		} catch ( e ) {
			showToast( e.message );
		}
	};

	window.saveTrainingLines = async function () {
		const a = alignment();
		if ( ! a.ok ) { showToast( a.reason ); return; }
		const lines = await lineImages( a.pairs, state.result.snapshot );
		const zip = new ZipWriter();
		const base = baseName( state.result.page );
		for ( let i = 0; i < lines.length; i++ ) {
			const n = base + '_' + String( i + 1 ).padStart( 3, '0' );
			await zip.add( n + '.png', lines[ i ].png );
			await zip.add( n + '.gt.txt', lines[ i ].text + '\n' );
		}
		download( zip.toBlob(), base + '_training.zip' );
		$( 'saveDialog' ).close();
	};

	// ── Recording (from app.js) ─────────────────────────────────────────────

	window.onRecordingReady = function ( blob ) {
		discardAudio( true );
		state.audio = { blob, url: URL.createObjectURL( blob ), page: state.result ? state.result.page : currentPageNo() };
		$( 'audioPreview' ).src = state.audio.url;
		$( 'audioBar' ).style.display = 'flex';
		showToast( 'Recording kept with this page. It is included in the bundle and collection.' );
		updateTextStatus();
	};

	window.downloadAudio = function () {
		if ( state.audio ) download( state.audio.blob, baseName( state.audio.page ) + '_reading.wav' );
	};

	function discardAudio( silent ) {
		if ( state.audio ) URL.revokeObjectURL( state.audio.url );
		state.audio = null;
		$( 'audioPreview' ).removeAttribute( 'src' );
		$( 'audioBar' ).style.display = 'none';
		if ( silent !== true ) showToast( 'Recording discarded.' );
	}
	window.discardAudio = discardAudio;

	// ── Source details ──────────────────────────────────────────────────────

	function sourceKeyFor( file ) {
		return file ? file.name + '|' + file.size : 'no-file';
	}

	function renderSourceSummary() {
		const s = state.source, el = $( 'sourceSummary' );
		el.innerHTML = '';
		if ( ! s.title && ! s.author ) {
			el.innerHTML = '<i data-lucide="info"></i><span>Add source details (title, author, year, permission) so this text can be credited and reused properly.</span>';
			el.classList.add( 'empty' );
		} else {
			const who = [ s.author, s.year ].filter( Boolean ).join( ', ' );
			el.innerHTML = '<i data-lucide="book-open"></i><span><strong>' + esc( s.title || 'Untitled' ) + '</strong>' + ( who ? ', ' + esc( who ) : '' ) +
				'. <em class="rights rights--' + esc( s.rights || 'unknown' ) + '">' + esc( RIGHTS_LABEL[ s.rights || 'unknown' ] ) + '</em></span>';
			el.classList.remove( 'empty' );
		}
		refreshIcons();
	}

	window.openSource = function () {
		const f = $( 'sourceForm' );
		for ( const el of f.elements ) {
			if ( el.name ) el.value = state.source[ el.name ] || ( el.name === 'script' ? 'Beng' : el.name === 'rights' ? 'unknown' : '' );
		}
		$( 'sourceDialog' ).showModal();
	};

	$( 'sourceDialog' ).addEventListener( 'close', async () => {
		if ( $( 'sourceDialog' ).returnValue !== 'save' ) return;
		const data = {};
		for ( const el of $( 'sourceForm' ).elements ) if ( el.name ) data[ el.name ] = el.value.trim();
		state.source = data;
		try {
			await dbPut( 'sources', { key: state.sourceKey || 'no-file', data } );
			localStorage.setItem( 'ocr-studio:last-source', JSON.stringify( { contributor: data.contributor, language: data.language, script: data.script } ) );
		} catch ( e ) { /* storage unavailable */ }
		renderSourceSummary();
		showToast( 'Source details saved.' );
	} );

	window.onFileLoaded = async function ( file ) {
		state.result = null;
		discardAudio( true );
		output.value = '';
		state.sourceKey = sourceKeyFor( file );
		let saved = null;
		try { saved = await dbGet( 'sources', state.sourceKey ); } catch ( e ) { /* ignore */ }
		if ( saved ) {
			state.source = saved.data;
		} else {
			// Carry over who is digitising and the usual language/script.
			let last = {};
			try { last = JSON.parse( localStorage.getItem( 'ocr-studio:last-source' ) || '{}' ); } catch ( e ) { /* ignore */ }
			state.source = { contributor: last.contributor || '', language: last.language || '', script: last.script || 'Beng', rights: 'unknown' };
		}
		renderSourceSummary();
		updateTextStatus();
	};

	// ── Collection ──────────────────────────────────────────────────────────

	async function refreshCollectionCount() {
		try { $( 'collectionCount' ).textContent = await dbCount( 'collection' ); } catch ( e ) { /* ignore */ }
	}

	window.addToCollection = async function () {
		try {
			const rec = await buildRecord();
			rec.added = new Date().toISOString();
			await dbPut( 'collection', rec );
			await refreshCollectionCount();
			showToast( 'Added page ' + rec.page + ' to the collection (' + $( 'collectionCount' ).textContent + ' pages).' );
			if ( navigator.storage && navigator.storage.persist ) navigator.storage.persist().catch( () => {} );
		} catch ( e ) {
			showToast( e.name === 'QuotaExceededError' ? 'This device is out of storage space. Export and clear the collection.' : e.message );
		}
	};

	window.openCollection = async function () {
		const items = await dbAll( 'collection' );
		const list = $( 'collectionList' );
		list.innerHTML = '';
		$( 'collectionEmpty' ).style.display = items.length ? 'none' : '';
		$( 'exportCollectionBtn' ).disabled = ! items.length;
		for ( const it of items ) {
			const li = document.createElement( 'li' );
			const flags = [
				it.meta.characters.toLocaleString() + ' characters',
				it.meta.proofread ? 'corrected' : 'not corrected',
				it.lines.length ? it.lines.length + ' training lines' : '',
				it.audio ? 'recording' : '',
			].filter( Boolean ).join( ', ' );
			li.innerHTML = '<div class="ci-main"><strong>' + esc( it.meta.title || it.meta.file_name || 'Untitled' ) + '</strong>, page ' + it.page +
				'<small>' + esc( flags ) + '. <em class="rights rights--' + esc( it.meta.rights ) + '">' + esc( it.meta.rights_label ) + '</em></small></div>';
			const del = document.createElement( 'button' );
			del.className = 'icon-btn';
			del.title = 'Remove from collection';
			del.innerHTML = '<i data-lucide="trash-2"></i>';
			del.onclick = async () => { await dbDel( 'collection', it.id ); await refreshCollectionCount(); window.openCollection(); };
			li.appendChild( del );
			list.appendChild( li );
		}
		refreshIcons();
		if ( ! $( 'collectionDialog' ).open ) $( 'collectionDialog' ).showModal();
	};

	window.exportCollection = async function () {
		const items = await dbAll( 'collection' );
		if ( ! items.length ) return;
		const btn = $( 'exportCollectionBtn' );
		btn.disabled = true;
		try {
			const zip = new ZipWriter();
			const corpus = [], jsonl = [];
			let restricted = 0;
			for ( let i = 0; i < items.length; i++ ) {
				const it = items[ i ];
				const folder = 'pages/' + String( i + 1 ).padStart( 4, '0' ) + '_' + it.base;
				await addRecordToZip( zip, it, folder );
				for ( let j = 0; j < it.lines.length; j++ ) {
					const n = String( i + 1 ).padStart( 4, '0' ) + '_' + it.base + '_' + String( j + 1 ).padStart( 3, '0' );
					await zip.add( 'training/' + n + '.png', it.lines[ j ].png );
					await zip.add( 'training/' + n + '.gt.txt', it.lines[ j ].text + '\n' );
				}
				corpus.push( it.text );
				jsonl.push( JSON.stringify( Object.assign( { id: i + 1, folder, text: it.text }, it.meta ) ) );
				if ( it.meta.rights === 'community-only' ) restricted++;
			}
			await zip.add( 'corpus.txt', corpus.join( '\n\n' ) + '\n' );
			await zip.add( 'corpus.jsonl', jsonl.join( '\n' ) + '\n' );
			await zip.add( 'README.txt', [
				'OCR Studio collection export (' + new Date().toISOString() + ')',
				'',
				'corpus.txt    All page texts (UTF-8, Unicode NFC), one page after another.',
				'corpus.jsonl  One JSON object per page: text plus source details and permission.',
				'pages/        One folder per page: page image, corrected text, machine-recognised',
				'              text, reading (WAV, if recorded), searchable PDF, metadata.json.',
				'training/     Line images (.png) with their corrected text (.gt.txt), in the',
				'              format used by tesstrain to train Tesseract models.',
				'',
				restricted ? 'NOTE: ' + restricted + ' page(s) are marked "Community use only". Do not publish or share them outside the community.' : 'Check each page\'s "rights" field before publishing.',
				'',
			].join( '\n' ) );
			download( zip.toBlob(), 'ocr-collection_' + new Date().toISOString().slice( 0, 10 ) + '.zip' );
		} catch ( e ) {
			showToast( 'Export failed: ' + e.message );
		} finally {
			btn.disabled = false;
		}
	};

	window.clearCollection = async function () {
		const n = await dbCount( 'collection' );
		if ( ! n || ! confirm( 'Remove all ' + n + ' pages from the collection on this device? Export it first if you need it.' ) ) return;
		await dbClear( 'collection' );
		await refreshCollectionCount();
		window.openCollection();
	};

	// ── Language models ─────────────────────────────────────────────────────

	async function refreshLanguageSelect() {
		const sel = $( 'lang' );
		const keep = localStorage.getItem( 'ocr-studio:lang' ) || sel.value;
		sel.querySelectorAll( 'optgroup' ).forEach( g => g.remove() );
		let models = [];
		try { models = await dbAll( 'models' ); } catch ( e ) { /* ignore */ }
		if ( models.length ) {
			const g = document.createElement( 'optgroup' );
			g.label = 'Your models';
			for ( const m of models ) {
				g.appendChild( new Option( m.label, m.code ) );
				g.appendChild( new Option( m.label + ' + English', m.code + '+eng' ) );
			}
			sel.appendChild( g );
		}
		if ( Array.from( sel.options ).some( o => o.value === keep ) ) sel.value = keep;
	}

	$( 'lang' ).addEventListener( 'change', () => localStorage.setItem( 'ocr-studio:lang', $( 'lang' ).value ) );

	window.openModels = async function () {
		const list = $( 'modelList' );
		list.innerHTML = '';
		for ( const [ code, label ] of Object.entries( BUILTIN ) ) {
			const li = document.createElement( 'li' );
			li.innerHTML = '<div class="ci-main"><strong>' + label + '</strong><small>' + code + ', built in, works offline</small></div>';
			list.appendChild( li );
		}
		for ( const m of await dbAll( 'models' ) ) {
			const li = document.createElement( 'li' );
			li.innerHTML = '<div class="ci-main"><strong>' + esc( m.label ) + '</strong><small>' + esc( m.code ) + ', ' + ( m.size / 1048576 ).toFixed( 1 ) + ' MB, added ' + esc( m.added.slice( 0, 10 ) ) + '</small></div>';
			const del = document.createElement( 'button' );
			del.className = 'icon-btn';
			del.title = 'Remove model';
			del.innerHTML = '<i data-lucide="trash-2"></i>';
			del.onclick = async () => {
				if ( ! confirm( 'Remove the ' + m.label + ' model from this device?' ) ) return;
				await dbDel( 'models', m.code );
				await keyvalPut( './' + m.code + '.traineddata', undefined ).catch( () => {} );
				if ( state.workerLang && state.workerLang.split( '+' ).includes( m.code ) ) { await state.worker.terminate(); state.worker = null; state.workerLang = null; }
				await refreshLanguageSelect();
				window.openModels();
			};
			li.appendChild( del );
			list.appendChild( li );
		}
		refreshIcons();
		if ( ! $( 'modelsDialog' ).open ) $( 'modelsDialog' ).showModal();
	};

	window.addModel = async function () {
		const code = $( 'modelCode' ).value.trim().toLowerCase();
		const label = $( 'modelLabel' ).value.trim() || code;
		const file = $( 'modelFile' ).files[ 0 ];
		if ( ! /^[a-z][a-z0-9_]{1,19}$/.test( code ) ) { showToast( 'Use 2–20 lowercase letters, digits or _ for the code.' ); return; }
		if ( BUILTIN[ code ] ) { showToast( '"' + code + '" is a built-in language.' ); return; }
		if ( ! file ) { showToast( 'Choose a .traineddata file.' ); return; }
		const buf = new Uint8Array( await file.arrayBuffer() );
		const gz = buf[ 0 ] === 0x1f && buf[ 1 ] === 0x8b;
		if ( ! gz && buf.length < 50000 ) { showToast( 'That does not look like a Tesseract model file.' ); return; }
		await dbPut( 'models', { code, label, data: buf.buffer, size: buf.length, added: new Date().toISOString() } );
		if ( state.workerLang && state.workerLang.split( '+' ).includes( code ) ) { await state.worker.terminate(); state.worker = null; state.workerLang = null; }
		$( 'modelCode' ).value = ''; $( 'modelLabel' ).value = ''; $( 'modelFile' ).value = '';
		await refreshLanguageSelect();
		$( 'lang' ).value = code;
		localStorage.setItem( 'ocr-studio:lang', code );
		window.openModels();
		showToast( 'Added ' + label + '. It is now selected; run OCR to test it.' );
	};

	// ── Eastern Nagari keyboard (transcribing handwriting) ──────────────────
	// Handwritten Eastern Nagari is beyond the recognition models, so the
	// realistic help is fast manual transcription beside the zoomable image.

	let kbEngine = null;
	async function loadKeyboard() {
		if ( kbEngine ) return kbEngine;
		const get = n => fetch( 'js/ime/' + n ).then( r => r.json() );
		const [ forward, reverse, hooks, settings ] = await Promise.all( [ 'forwardMap.json', 'reverseMap.json', 'defaults.json', 'js-engine-settings.default.json' ].map( get ) );
		const nameOf = b => ( /function\s+([A-Za-z0-9_$]+)\s*\(/.exec( b || '' ) || [] )[ 1 ];
		const buckets = { pre: [], loop: [], post: [] };
		hooks.filter( h => h.direction === 'forward' && h.is_active && buckets[ h.hook_stage ] && nameOf( h.js_body ) )
			.sort( ( a, b ) => ( a.sort_order || 0 ) - ( b.sort_order || 0 ) )
			.forEach( h => { try { buckets[ h.hook_stage ].push( new Function( h.js_body + '\nreturn ' + nameOf( h.js_body ) + ';' )() ); } catch ( e ) { /* skip */ } } ); // eslint-disable-line no-new-func
		const maps = { forward, reverse };
		kbEngine = t => ( t ? CPLAI_ENGINE.bpmTransliterate( t, 'forward', maps, buckets.pre, buckets.loop, buckets.post, {}, settings ).output : '' );
		return kbEngine;
	}

	window.toggleKeyboard = async function () {
		const bar = $( 'keyboardBar' ), btn = $( 'keyboardBtn' );
		const show = bar.style.display === 'none';
		bar.style.display = show ? '' : 'none';
		btn.setAttribute( 'aria-pressed', show ? 'true' : 'false' );
		btn.classList.toggle( 'active', show );
		if ( show ) {
			try { await loadKeyboard(); } catch ( e ) { showToast( 'The keyboard could not load.' ); }
			$( 'kbRoman' ).focus();
		}
	};

	function insertAtCursor( str ) {
		const s = output.selectionStart ?? output.value.length, e = output.selectionEnd ?? s;
		output.setRangeText( str, s, e, 'end' );
		output.dispatchEvent( new Event( 'input' ) );
	}

	window.insertFromKeyboard = function ( newline ) {
		const roman = $( 'kbRoman' ).value;
		const script = kbEngine ? kbEngine( roman ) : roman;
		if ( script ) insertAtCursor( script + ( newline ? '\n' : ' ' ) );
		else if ( newline ) insertAtCursor( '\n' );
		$( 'kbRoman' ).value = '';
		$( 'kbPreview' ).textContent = '';
		$( 'kbRoman' ).focus();
	};

	$( 'kbRoman' ).addEventListener( 'input', () => {
		$( 'kbPreview' ).textContent = kbEngine ? kbEngine( $( 'kbRoman' ).value ) : '';
	} );
	$( 'kbRoman' ).addEventListener( 'keydown', ( e ) => {
		if ( e.key === 'Enter' ) { e.preventDefault(); window.insertFromKeyboard( e.shiftKey ); }
	} );

	// ── Image enhancement ───────────────────────────────────────────────────

	window.enhanceCanvas = function ( blackWhite ) {
		const c = $( 'canvas' );
		if ( ! c.width ) { showToast( 'Choose a file first.' ); return; }
		const ctx = c.getContext( '2d' );
		const img = ctx.getImageData( 0, 0, c.width, c.height );
		const d = img.data, n = d.length / 4;
		const gray = new Uint8ClampedArray( n ), hist = new Uint32Array( 256 );
		for ( let i = 0, p = 0; i < n; i++, p += 4 ) {
			const g = ( 0.299 * d[ p ] + 0.587 * d[ p + 1 ] + 0.114 * d[ p + 2 ] ) | 0;
			gray[ i ] = g;
			hist[ g ]++;
		}
		let map;
		if ( blackWhite ) {
			// Otsu's threshold.
			let sum = 0; for ( let t = 0; t < 256; t++ ) sum += t * hist[ t ];
			let sumB = 0, wB = 0, best = 0, thr = 128;
			for ( let t = 0; t < 256; t++ ) {
				wB += hist[ t ]; if ( ! wB ) continue;
				const wF = n - wB; if ( ! wF ) break;
				sumB += t * hist[ t ];
				const mB = sumB / wB, mF = ( sum - sumB ) / wF, between = wB * wF * ( mB - mF ) * ( mB - mF );
				if ( between > best ) { best = between; thr = t; }
			}
			map = t => ( t > thr ? 255 : 0 );
		} else {
			// Stretch the 1st–99th percentile to full range.
			let lo = 0, hi = 255, acc = 0;
			for ( let t = 0; t < 256; t++ ) { acc += hist[ t ]; if ( acc > n * 0.01 ) { lo = t; break; } }
			acc = 0;
			for ( let t = 255; t >= 0; t-- ) { acc += hist[ t ]; if ( acc > n * 0.01 ) { hi = t; break; } }
			const span = Math.max( 1, hi - lo );
			map = t => ( ( t - lo ) * 255 ) / span;
		}
		const lut = new Uint8ClampedArray( 256 );
		for ( let t = 0; t < 256; t++ ) lut[ t ] = map( t );
		for ( let i = 0, p = 0; i < n; i++, p += 4 ) {
			const v = lut[ gray[ i ] ];
			d[ p ] = d[ p + 1 ] = d[ p + 2 ] = v;
		}
		ctx.putImageData( img, 0, 0 );
		showToast( blackWhite ? 'Converted to black and white.' : 'Contrast enhanced.' );
	};

	window.resetImage = async function () {
		if ( typeof exitPerspectiveMode === 'function' ) exitPerspectiveMode( false );
		if ( typeof pdfDoc !== 'undefined' && pdfDoc ) await renderPage( currentPage );
		else if ( typeof currentFile !== 'undefined' && currentFile ) await processImage( currentFile );
		showToast( 'Image reset.' );
	};

	// ── Offline readiness + service worker ──────────────────────────────────

	async function checkOffline() {
		const el = $( 'offlineStatus' );
		if ( ! ( 'caches' in window ) || ! ( 'serviceWorker' in navigator ) ) { el.textContent = ''; return; }
		let ready = 0;
		for ( const f of OFFLINE_FILES ) if ( await caches.match( f, { ignoreSearch: true } ) ) ready++;
		if ( ready === OFFLINE_FILES.length ) {
			el.textContent = 'Works offline';
			el.className = 'offline-status ready';
		} else {
			el.textContent = 'Preparing offline use…';
			el.className = 'offline-status pending';
			setTimeout( checkOffline, 3000 );
		}
	}

	if ( 'serviceWorker' in navigator ) {
		let reloading = false;
		navigator.serviceWorker.addEventListener( 'controllerchange', () => {
			if ( reloading ) return;
			reloading = true;
			location.reload();
		} );
		window.addEventListener( 'load', () => {
			navigator.serviceWorker.register( './service-worker.js' ).then( ( reg ) => {
				const offer = w => {
					showToast( 'A new version is ready. Tap here to update.', 0 );
					const t = document.getElementById( 'toast' );
					t.style.pointerEvents = 'auto';
					t.style.cursor = 'pointer';
					t.onclick = () => w.postMessage( { type: 'SKIP_WAITING' } );
				};
				if ( reg.waiting && navigator.serviceWorker.controller ) offer( reg.waiting );
				reg.addEventListener( 'updatefound', () => {
					const w = reg.installing;
					if ( w ) w.addEventListener( 'statechange', () => { if ( w.state === 'installed' && navigator.serviceWorker.controller ) offer( w ); } );
				} );
				checkOffline();
			} ).catch( e => console.warn( 'Service worker not registered', e ) ); // eslint-disable-line no-console
		} );
	}

	// ── Boot ────────────────────────────────────────────────────────────────

	renderSourceSummary();
	refreshLanguageSelect();
	refreshCollectionCount();
	window.onFileLoaded( null );
}() );
