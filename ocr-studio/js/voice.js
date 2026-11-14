/**
 * OCR Studio 2.2 — Listen: reads the text aloud with a machine voice.
 *
 * The voice runs on this device (js/tts-worker.js). Voices live in
 * vendor/tts/voices/<id>/ and are listed in vendor/tts/voices/voices.json.
 * The first time, the voice and the speech engine are downloaded (after the
 * person agrees) and kept on the device for offline use.
 *
 * Machine readings are never mixed with human recordings: they are saved
 * only on request, as a separate "_machine-voice.wav" file.
 */
/* global showToast, lucide, buildWavBuffer */
( function () {
	'use strict';

	const VOICES_URL = new URL( 'vendor/tts/voices/voices.json', location.href ).href;
	const ENGINE_URL = new URL( 'vendor/tts/ort/ort-wasm-simd-threaded.wasm', location.href ).href;
	const ENGINE_BYTES = 14e6;
	const VOICE_CACHE = 'ocr-studio-voices-v1';
	const PREF = 'ocr-studio:voice';

	const $ = id => document.getElementById( id );
	const output = $( 'output' );

	const st = {
		worker: null,
		voices: null,
		loadedUrl: null,
		job: 0,
		active: false,
		ctx: null,
		sources: [],
		nextTime: 0,
		pcm: [],
		sr: 16000,
		finished: false,
		voiceMeta: null,
		wav: null,
	};

	// ── Button and bar ──────────────────────────────────────────────────────

	function setButton( mode, label ) {
		const b = $( 'listenBtn' );
		if ( ! b ) return;
		const icon = mode === 'idle' ? 'volume-2' : mode === 'loading' ? 'loader-circle' : 'square';
		b.classList.toggle( 'speaking', mode !== 'idle' );
		b.innerHTML = '<i data-lucide="' + icon + '"></i><span>' + label + '</span>';
		b.title = mode === 'idle' ? 'Listen with a machine voice. Select some text to hear only that part.' : 'Stop';
		b.setAttribute( 'aria-label', mode === 'idle' ? 'Listen with a machine voice' : 'Stop listening' );
		if ( window.lucide ) lucide.createIcons();
	}

	function hideBar() {
		if ( st.wav ) URL.revokeObjectURL( st.wav.url );
		st.wav = null;
		const a = $( 'voicePreview' );
		a.pause();
		a.removeAttribute( 'src' );
		$( 'voiceBar' ).style.display = 'none';
	}
	window.closeVoiceBar = hideBar;

	window.downloadVoice = function () {
		if ( ! st.wav ) return;
		const base = typeof window.currentBaseName === 'function' ? window.currentBaseName() : 'page';
		const a = document.createElement( 'a' );
		a.href = st.wav.url;
		a.download = base + '_machine-voice.wav';
		document.body.appendChild( a );
		a.click();
		a.remove();
	};

	// ── Voices ──────────────────────────────────────────────────────────────

	async function listVoices() {
		if ( st.voices ) return st.voices;
		let list = [];
		try {
			const res = await fetch( VOICES_URL, { cache: 'no-cache' } );
			if ( res.ok ) {
				const j = await res.json();
				list = ( Array.isArray( j ) ? j : j.voices || [] )
					.map( v => ( typeof v === 'string' ? { id: v } : v ) )
					.filter( v => v && /^[\w.-]+$/.test( v.id ) )
					.map( v => ( { id: v.id, name: v.name || v.id, url: new URL( v.id + '/voice.json', VOICES_URL ).href } ) );
			}
			// Only voices whose folder is actually there (or already on this device, when offline).
			const present = await Promise.all( list.map( async ( v ) => {
				try { return ( await fetch( v.url, { cache: 'no-cache' } ) ).ok; } catch ( e ) { return false; }
			} ) );
			list = list.filter( ( v, i ) => present[ i ] );
		} catch ( e ) { /* no voices installed */ }
		st.voices = list;
		const sel = $( 'voiceSelect' );
		if ( sel ) {
			sel.innerHTML = list.map( v => '<option value="' + v.id + '">' + v.name.replace( /</g, '&lt;' ) + '</option>' ).join( '' );
			let pref = '';
			try { pref = localStorage.getItem( PREF ) || ''; } catch ( e ) { /* ignore */ }
			if ( list.some( v => v.id === pref ) ) sel.value = pref;
			sel.style.display = list.length > 1 ? '' : 'none';
		}
		return list;
	}

	function chosenVoice() {
		const sel = $( 'voiceSelect' );
		return st.voices.find( v => sel && v.id === sel.value ) || st.voices[ 0 ];
	}

	async function voiceMeta( v ) {
		const res = await fetch( v.url, { cache: 'no-cache' } );
		if ( res.status === 404 ) throw new Error( 'The voice "' + v.name + '" is not installed. Put its folder in vendor/tts/voices/' + v.id + '/ (see "Machine voice" in the README).' );
		if ( ! res.ok ) throw new Error( 'The voice "' + v.name + '" could not be loaded (' + res.status + ').' );
		return res.json();
	}

	async function isOnDevice( v, meta ) {
		try {
			const c = await caches.open( VOICE_CACHE );
			const urls = meta.files.map( f => new URL( f, v.url ).href ).concat( ENGINE_URL );
			const hits = await Promise.all( urls.map( u => c.match( u ) ) );
			return hits.every( Boolean );
		} catch ( e ) {
			return false;
		}
	}

	async function engineOnDevice() {
		try { return !! await ( await caches.open( VOICE_CACHE ) ).match( ENGINE_URL ); } catch ( e ) { return false; }
	}

	function askToDownload( meta ) {
		return new Promise( async ( resolve ) => {
			const d = $( 'voiceDialog' );
			const mb = Math.round( ( ( meta.bytes || 0 ) + ( await engineOnDevice() ? 0 : ENGINE_BYTES ) ) / 1e6 );
			const esc = s => String( s || '' ).replace( /[&<>"]/g, c => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ] );
			$( 'voiceDialogText' ).innerHTML = 'Listening needs a one-time download of the <strong>' + esc( meta.name || meta.id ) +
				'</strong> voice and the speech engine, about <strong>' + mb + ' MB</strong>. After that it works offline on this device.';
			$( 'voiceDialogNote' ).textContent = meta.language === 'bpy'
				? 'This voice was trained on Bishnupriya Manipuri.'
				: 'This voice was trained on another language, so Bishnupriya Manipuri words will not always sound right.';
			$( 'voiceDialogCredit' ).textContent = [ meta.credit && 'Voice: ' + meta.credit, meta.licence && 'Licence: ' + meta.licence ].filter( Boolean ).join( '. ' );
			d.returnValue = '';
			d.addEventListener( 'close', () => resolve( d.returnValue === 'ok' ), { once: true } );
			d.showModal();
		} );
	}

	// ── Worker ──────────────────────────────────────────────────────────────

	function worker() {
		if ( st.worker ) return st.worker;
		st.worker = new Worker( 'js/tts-worker.js' );
		st.worker.onmessage = onWorkerMessage;
		st.worker.onerror = ( e ) => {
			e.preventDefault();
			fail( 'The machine voice could not start in this browser.' );
			st.worker.terminate();
			st.worker = null;
			st.loadedUrl = null;
		};
		return st.worker;
	}

	function onWorkerMessage( e ) {
		const m = e.data || {};
		if ( m.type === 'ready' ) st.loadedUrl = m.url; // the voice stays loaded, even for a cancelled reading
		if ( m.job != null && m.job !== st.job ) return;
		if ( m.type === 'progress' ) {
			if ( st.active && m.total ) setButton( 'loading', 'Voice ' + Math.min( 99, Math.floor( 100 * m.loaded / m.total ) ) + '%' );
		} else if ( m.type === 'ready' ) {
			st.voiceMeta = m.voice;
			if ( st.active ) setButton( 'loading', 'Preparing…' );
		} else if ( m.type === 'chunk' ) {
			if ( ! st.active ) return;
			play( m.samples, m.sr );
			setButton( 'speaking', 'Stop ' + ( m.index + 1 ) + '/' + m.total );
		} else if ( m.type === 'done' ) {
			st.finished = true;
			makeWav();
			if ( ! st.sources.length ) endListening();
		} else if ( m.type === 'error' ) {
			fail( m.message );
		}
	}

	// ── Playback ────────────────────────────────────────────────────────────

	function audioContext() {
		if ( ! st.ctx || st.ctx.state === 'closed' ) {
			const Ctx = window.AudioContext || window.webkitAudioContext;
			st.ctx = new Ctx();
		}
		if ( st.ctx.state === 'suspended' ) st.ctx.resume();
		return st.ctx;
	}

	function play( samples, sr ) {
		st.pcm.push( samples );
		st.sr = sr;
		const ctx = audioContext();
		const buf = ctx.createBuffer( 1, samples.length, sr );
		buf.copyToChannel( samples, 0 );
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.connect( ctx.destination );
		const at = Math.max( ctx.currentTime + 0.05, st.nextTime );
		src.start( at );
		st.nextTime = at + buf.duration;
		st.sources.push( src );
		src.onended = () => {
			st.sources = st.sources.filter( s => s !== src );
			if ( st.finished && ! st.sources.length && st.active ) endListening();
		};
	}

	function makeWav() {
		const n = st.pcm.reduce( ( s, p ) => s + p.length, 0 );
		if ( ! n ) return;
		const pcm16 = new Int16Array( n );
		let at = 0;
		for ( const p of st.pcm ) {
			for ( let i = 0; i < p.length; i++ ) {
				const s = Math.max( -1, Math.min( 1, p[ i ] ) );
				pcm16[ at++ ] = s < 0 ? s * 0x8000 : s * 0x7fff;
			}
		}
		hideBar();
		const blob = new Blob( [ buildWavBuffer( pcm16, st.sr, 1 ) ], { type: 'audio/wav' } );
		st.wav = { blob, url: URL.createObjectURL( blob ) };
		$( 'voicePreview' ).src = st.wav.url;
		const meta = st.voiceMeta || {};
		$( 'voiceBarLabel' ).textContent = 'Machine voice';
		$( 'voiceBar' ).title = [ meta.name, meta.credit, meta.licence && 'Licence: ' + meta.licence ].filter( Boolean ).join( ' · ' );
		$( 'voiceBar' ).style.display = 'flex';
	}

	function stopAudio() {
		for ( const s of st.sources ) {
			try { s.onended = null; s.stop(); } catch ( e ) { /* already stopped */ }
		}
		st.sources = [];
		st.nextTime = 0;
	}

	function endListening() {
		st.active = false;
		setButton( 'idle', 'Listen' );
	}

	function stopListening() {
		if ( ! st.active ) return;
		if ( st.worker ) st.worker.postMessage( { type: 'stop', job: st.job } );
		stopAudio();
		endListening();
	}
	window.stopListening = stopListening;

	function fail( msg ) {
		stopAudio();
		endListening();
		showToast( msg, undefined, 'bad' );
	}

	// ── Listen ──────────────────────────────────────────────────────────────

	function textToRead() {
		const s = output.selectionStart, e = output.selectionEnd;
		if ( e > s && output.value.slice( s, e ).trim() ) return { text: output.value.slice( s, e ), part: true };
		return { text: output.value, part: false };
	}

	window.toggleListen = async function () {
		if ( st.active ) { stopListening(); return; }
		audioContext(); // must start inside the tap, or the browser blocks sound
		const { text, part } = textToRead();
		if ( ! text.trim() ) { showToast( 'There is no text to read.', undefined, 'warn' ); return; }

		// From here on the button is Stop: a second tap cancels, at any step.
		const job = ++st.job;
		st.active = true;
		st.finished = false;
		st.pcm = [];
		stopAudio();
		setButton( 'loading', 'Preparing…' );
		const alive = () => st.active && st.job === job;
		const quit = ( msg, kind ) => {
			if ( ! alive() ) return;
			endListening();
			if ( msg ) showToast( msg, undefined, kind );
		};
		const notHere = 'The voice is not on this device yet. Connect to the internet once to download it.';

		const voices = await listVoices();
		if ( ! alive() ) return;
		if ( ! voices.length ) return quit( 'No machine voice is installed. See "Machine voice" in the README.', 'warn' );
		const v = chosenVoice();
		let meta;
		try {
			meta = await voiceMeta( v );
		} catch ( e ) {
			return quit( navigator.onLine === false ? notHere : e.message, 'bad' );
		}
		if ( ! alive() ) return;
		if ( st.loadedUrl !== v.url && ! await isOnDevice( v, meta ) ) {
			if ( ! alive() ) return;
			if ( navigator.onLine === false ) return quit( notHere, 'warn' );
			const ok = await askToDownload( meta );
			if ( ! alive() ) return;
			if ( ! ok ) return quit();
			audioContext();
		}

		setButton( 'loading', st.loadedUrl === v.url ? 'Preparing…' : 'Loading voice…' );
		if ( part ) showToast( 'Reading the selected text.', 1800, 'info' );
		worker().postMessage( { type: 'speak', job, text, voiceUrl: v.url } );
	};

	// ── Hooks ───────────────────────────────────────────────────────────────

	const sel = $( 'voiceSelect' );
	if ( sel ) {
		sel.addEventListener( 'change', () => {
			try { localStorage.setItem( PREF, sel.value ); } catch ( e ) { /* ignore */ }
			stopListening();
		} );
	}

	const previousFileLoaded = window.onFileLoaded;
	window.onFileLoaded = function ( file ) {
		stopListening();
		hideBar();
		return previousFileLoaded ? previousFileLoaded.apply( this, arguments ) : undefined;
	};

	listVoices();
}() );
