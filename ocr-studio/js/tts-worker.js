/**
 * OCR Studio — machine voice worker.
 *
 * Runs a VITS text-to-speech voice (for example Meta's MMS Bengali voice,
 * converted with voice-tools/convert_voice.py) with ONNX Runtime Web, away
 * from the page so the app stays responsive. The voice and the runtime are
 * downloaded once and kept in the "ocr-studio-voices" cache, so the voice
 * works offline afterwards and survives app updates.
 *
 * Messages in:   { type: 'load', voiceUrl }
 *                { type: 'speak', job, text, voiceUrl }
 *                { type: 'stop', job }
 * Messages out:  { type: 'progress', loaded, total }
 *                { type: 'ready', job, url, voice }
 *                { type: 'chunk', job, index, total, samples, sr }
 *                { type: 'done', job }
 *                { type: 'error', job, message }
 */
/* global ort */
'use strict';

const ORT_DIR = new URL( '../vendor/tts/ort/', self.location.href ).href;
const VOICE_CACHE = 'ocr-studio-voices-v1';
const MAX_CHARS = 200;      // longest piece synthesised at once
const FIRST_CHARS = 90;     // a short first piece, so sound starts sooner
const PAUSE_S = 0.3;        // silence after a sentence
const BREATH_S = 0.1;       // silence where a long sentence was cut

importScripts( ORT_DIR + 'ort.wasm.min.js' );
const ENGINE_BYTES = 13961845; // ort-wasm-simd-threaded.wasm
// Several cores when the page is cross-origin isolated (the service worker
// arranges this); one core otherwise, for example on the very first visit.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max( 1, Math.min( 4, navigator.hardwareConcurrency || 1 ) ) : 1;
ort.env.wasm.proxy = false;

let session = null;
let voice = null;
let voiceUrl = null;
let loading = null;
let stopJob = -1;

// ── Download with progress, kept in the voice cache ─────────────────────────

async function openCache() {
	try { return self.caches ? await caches.open( VOICE_CACHE ) : null; } catch ( e ) { return null; }
}

async function fetchCached( url, onChunk, networkFirst ) {
	const cache = await openCache();
	if ( networkFirst ) {
		try {
			const res = await fetch( url, { cache: 'no-cache' } );
			if ( res.ok ) {
				const buf = await res.arrayBuffer();
				if ( cache ) { try { await cache.put( url, new Response( buf.slice( 0 ) ) ); } catch ( e ) { /* ignore */ } }
				return buf;
			}
		} catch ( e ) { /* offline: use the copy on this device */ }
	}
	const hit = cache && await cache.match( url );
	if ( hit ) {
		const buf = await hit.arrayBuffer();
		if ( onChunk ) onChunk( buf.byteLength );
		return buf;
	}
	const res = await fetch( url, { cache: 'no-cache' } );
	if ( ! res.ok ) throw new Error( 'Could not download ' + url.split( '/' ).pop() + ' (' + res.status + ').' );
	let buf;
	if ( res.body && onChunk ) {
		const reader = res.body.getReader();
		const parts = [];
		let size = 0;
		for ( ;; ) {
			const { done, value } = await reader.read();
			if ( done ) break;
			parts.push( value );
			size += value.byteLength;
			onChunk( value.byteLength );
		}
		const all = new Uint8Array( size );
		let at = 0;
		for ( const p of parts ) { all.set( p, at ); at += p.byteLength; }
		buf = all.buffer;
	} else {
		buf = await res.arrayBuffer();
		if ( onChunk ) onChunk( buf.byteLength );
	}
	if ( cache ) {
		try {
			await cache.put( url, new Response( buf, { headers: { 'Content-Type': res.headers.get( 'Content-Type' ) || 'application/octet-stream' } } ) );
		} catch ( e ) { /* out of storage: the voice still works this time */ }
	}
	return buf;
}

// The engine's module (.mjs) and code (.wasm) are fetched here and handed to
// ONNX Runtime directly, so it works whatever file types the web server
// announces (many local servers do not know .mjs), and offline from the cache.
let engineReady = false;

async function prepareEngine( report ) {
	if ( engineReady ) return;
	const mjs = await fetchCached( ORT_DIR + 'ort-wasm-simd-threaded.mjs' );
	const wasm = await fetchCached( ORT_DIR + 'ort-wasm-simd-threaded.wasm', report );
	ort.env.wasm.wasmPaths = { mjs: URL.createObjectURL( new Blob( [ mjs ], { type: 'text/javascript' } ) ) };
	ort.env.wasm.wasmBinary = new Uint8Array( wasm );
	engineReady = true;
}

async function loadVoice( url ) {
	if ( session && voiceUrl === url ) return voice;
	if ( loading && voiceUrl === url ) return loading;
	voiceUrl = url;
	loading = ( async () => {
		session = null;
		const meta = JSON.parse( new TextDecoder().decode( await fetchCached( url, null, true ) ) );
		if ( ! meta.vocab || ! Array.isArray( meta.files ) || ! meta.files.length ) throw new Error( 'This voice folder is incomplete (voice.json).' );
		const total = ( meta.bytes || 0 ) + ( engineReady ? 0 : ENGINE_BYTES );
		let loaded = 0;
		const report = n => {
			loaded += n;
			self.postMessage( { type: 'progress', loaded, total } );
		};
		await prepareEngine( report );
		const parts = [];
		for ( const f of meta.files ) parts.push( new Uint8Array( await fetchCached( new URL( f, url ).href, report ) ) );
		let model = parts[ 0 ];
		if ( parts.length > 1 ) {
			model = new Uint8Array( parts.reduce( ( s, p ) => s + p.byteLength, 0 ) );
			let at = 0;
			for ( const p of parts ) { model.set( p, at ); at += p.byteLength; }
		}
		session = await ort.InferenceSession.create( model, { executionProviders: [ 'wasm' ], graphOptimizationLevel: 'all' } );
		voice = prepare( meta );
		return voice;
	} )();
	try {
		return await loading;
	} catch ( e ) {
		voiceUrl = null;
		throw e;
	} finally {
		loading = null;
	}
}

// ── Letters to model input (matches the Hugging Face VITS tokenizer) ────────

function prepare( meta ) {
	const vocab = meta.vocab;
	return {
		name: meta.name || meta.id || 'Voice',
		licence: meta.licence || '',
		credit: meta.credit || '',
		language: meta.language || '',
		sr: meta.sampling_rate || 16000,
		vocab,
		multi: Object.keys( vocab ).filter( k => Array.from( k ).length > 1 ).sort( ( a, b ) => b.length - a.length ),
		space: Object.prototype.hasOwnProperty.call( vocab, ' ' ) ? vocab[ ' ' ] : -1,
		addBlank: meta.add_blank !== false,
		blank: meta.blank_id || 0,
		bos: meta.bos_id == null ? null : meta.bos_id,
		eos: meta.eos_id == null ? null : meta.eos_id,
		lower: meta.normalize !== false,
		subs: meta.substitutions || {},
		rules: meta.rules || 'hf',
		cleaner: meta.cleaner || 'basic',
	};
}

function has( o, k ) { return Object.prototype.hasOwnProperty.call( o, k ); }

// A letter the voice does not know: try its decomposed form, then a
// substitution (ৰ → র …); otherwise it is skipped.
function fallback( c, ids ) {
	const V = voice.vocab;
	const d = Array.from( c.normalize( 'NFD' ) );
	if ( d.length > 1 && d.every( x => has( V, x ) ) ) { d.forEach( x => ids.push( V[ x ] ) ); return; }
	if ( has( voice.subs, c ) ) Array.from( voice.subs[ c ] ).forEach( x => { if ( has( V, x ) ) ids.push( V[ x ] ); } );
}

function withBlanks( ids ) {
	let out = ids;
	if ( voice.addBlank ) {
		out = new Array( ids.length * 2 + 1 ).fill( voice.blank );
		ids.forEach( ( id, k ) => { out[ 2 * k + 1 ] = id; } );
	}
	if ( voice.bos != null && voice.eos != null ) out = [ voice.bos, ...out, voice.eos ];
	return BigInt64Array.from( out, BigInt );
}

// Coqui TTS voices: the same steps as Coqui's text cleaners and tokenizer.
function tokenizeCoqui( text ) {
	const V = voice.vocab;
	let t = text.normalize( 'NFC' );
	if ( voice.cleaner === 'multilingual' ) {
		t = t.toLowerCase().replace( /;/g, ',' ).replace( /-/g, ' ' ).replace( /:/g, ',' ).replace( /[<>()[\]"]+/g, '' );
	} else {
		t = t.toLowerCase();
	}
	t = t.replace( /\s+/g, ' ' ).trim();
	const ids = [];
	for ( const c of Array.from( t ) ) {
		if ( has( V, c ) ) ids.push( V[ c ] );
		else fallback( c, ids );
	}
	return ids.length ? withBlanks( ids ) : null;
}

function tokenize( text ) {
	if ( voice.rules === 'coqui' ) return tokenizeCoqui( text );
	const V = voice.vocab;
	const chars = Array.from( text.normalize( 'NFC' ) );
	const ids = [];
	for ( let i = 0; i < chars.length; i++ ) {
		let matched = false;
		for ( const k of voice.multi ) {
			const kc = Array.from( k );
			if ( chars.slice( i, i + kc.length ).join( '' ) === k ) {
				ids.push( V[ k ] );
				i += kc.length - 1;
				matched = true;
				break;
			}
		}
		if ( matched ) continue;
		let c = chars[ i ];
		if ( voice.lower ) c = c.toLowerCase();
		if ( has( V, c ) ) { ids.push( V[ c ] ); continue; }
		if ( /\s/.test( c ) ) { if ( voice.space >= 0 ) ids.push( voice.space ); continue; }
		fallback( c, ids );
		// Anything else (punctuation, digits the voice was not trained on) is skipped, as in training.
	}
	const clean = [];
	for ( const id of ids ) {
		if ( id === voice.space && ( ! clean.length || clean[ clean.length - 1 ] === voice.space ) ) continue;
		clean.push( id );
	}
	while ( clean.length && clean[ clean.length - 1 ] === voice.space ) clean.pop();
	if ( ! clean.length ) return null;
	return withBlanks( clean );
}

// ── Sentences ───────────────────────────────────────────────────────────────

// Long sentences are cut at commas and similar marks, or between words.
function splitLong( s, max ) {
	if ( s.length <= max ) return [ s ];
	const out = [];
	let cur = '';
	const add = ( piece ) => {
		if ( cur && ( cur + ' ' + piece ).length > max ) { out.push( cur ); cur = piece; }
		else cur = cur ? cur + ' ' + piece : piece;
	};
	for ( const clause of s.split( /(?<=[,;:—])\s+/ ) ) {
		if ( clause.length <= max ) add( clause );
		else clause.split( /\s+/ ).forEach( add );
	}
	if ( cur ) out.push( cur );
	return out;
}

// Pieces to speak, each with the pause that follows it. Pauses fall at
// sentence ends and blank lines. Single line breaks are only the printed line
// ends (OCR Studio keeps one text line per printed line), so they are read as
// spaces.
function pieces( text ) {
	const out = [];
	text.replace( /\r/g, '' )
		.split( /(?<=[।৷॥?!|])\s*|\n\s*\n+/ )
		.map( s => s.replace( /\s+/g, ' ' ).trim() )
		.filter( Boolean )
		.forEach( ( sentence ) => {
			let parts = splitLong( sentence, MAX_CHARS );
			if ( ! out.length && parts[ 0 ].length > FIRST_CHARS ) {
				const head = splitLong( sentence, FIRST_CHARS )[ 0 ];
				const rest = sentence.slice( head.length ).trim();
				parts = [ head ].concat( rest ? splitLong( rest, MAX_CHARS ) : [] );
			}
			parts.forEach( ( p, k ) => out.push( { text: p, pause: k === parts.length - 1 ? PAUSE_S : BREATH_S } ) );
		} );
	return out;
}

// Lets waiting messages (such as Stop) through between pieces.
const breathe = () => new Promise( r => setTimeout( r, 0 ) );

async function speak( job, text ) {
	const list = pieces( text );
	let spoken = 0;
	for ( let i = 0; i < list.length; i++ ) {
		await breathe();
		if ( stopJob >= job ) return;
		const ids = tokenize( list[ i ].text );
		if ( ! ids ) continue;
		const out = await session.run( { input_ids: new ort.Tensor( 'int64', ids, [ 1, ids.length ] ) } );
		const wave = out[ session.outputNames[ 0 ] ].data;
		if ( stopJob >= job ) return;
		const samples = new Float32Array( wave.length + Math.round( voice.sr * list[ i ].pause ) );
		samples.set( wave );
		self.postMessage( { type: 'chunk', job, index: i, total: list.length, samples, sr: voice.sr }, [ samples.buffer ] );
		spoken++;
	}
	if ( ! spoken ) throw new Error( 'This voice found nothing it can read in the text.' );
	self.postMessage( { type: 'done', job } );
}

// Loading and speaking run one after another (a voice can only speak one
// piece at a time); Stop takes effect at once, between pieces.
let queue = Promise.resolve();

async function handle( m ) {
	try {
		await breathe();
		if ( stopJob >= m.job ) return;
		if ( ! session || voiceUrl !== m.voiceUrl ) {
			const v = await loadVoice( m.voiceUrl );
			self.postMessage( { type: 'ready', job: m.job, url: m.voiceUrl, voice: { name: v.name, licence: v.licence, credit: v.credit, language: v.language, sr: v.sr } } );
		}
		if ( m.type === 'speak' ) await speak( m.job, m.text );
	} catch ( err ) {
		self.postMessage( { type: 'error', job: m.job, message: err && err.message ? err.message : String( err ) } );
	}
}

self.onmessage = ( e ) => {
	const m = e.data || {};
	if ( m.type === 'stop' ) {
		if ( m.job != null ) stopJob = Math.max( stopJob, m.job );
	} else if ( m.type === 'load' || m.type === 'speak' ) {
		queue = queue.then( () => handle( m ) );
	}
};
