// Run:  node tests/inplace.test.js
const path = require( 'path' );
const R = require( path.join( __dirname, '../vendor/translit-reverse.js' ) );
const InPlace = require( path.join( __dirname, '../inplace.js' ) );

let pass = 0, fail = 0;
const check = ( name, ok, detail ) => { if ( ok ) pass++; else { fail++; console.log( 'FAIL', name, detail || '' ); } };
const j = JSON.stringify;

// Exactly what app.js does: only words containing Bengali script are converted.
const BENGALI = /[\u0964\u0965\u0980-\u09FF]/;
const convert = w => ( BENGALI.test( w ) ? R.transliterate( w ) : w );
// InPlace never lets a word vanish: an empty conversion keeps the word as it was.
const safe = w => { const out = convert( w ); return out === '' && w !== '' ? w : out; };
const perWord = s => s.replace( /\S+/g, w => safe( w ) );

/** A text area that edits the way a browser does, then hands the result to InPlace. */
class FakeTextarea {
	constructor() { this.value = ''; this.caret = 0; this.ip = InPlace.create( convert, { perWord: true } ); this.ip.reset( '' ); }
	_after( inputType, composing ) {
		const r = this.ip.update( this.value, this.caret, inputType, composing );
		if ( r.changed ) { this.value = r.value; this.caret = r.caret; }
		this.ip.selection( this.caret, this.caret );
	}
	type( s, inputType = 'insertText' ) { this.value = this.value.slice( 0, this.caret ) + s + this.value.slice( this.caret ); this.caret += s.length; this._after( inputType ); return this; }
	typeAll( s ) { for ( const ch of Array.from( s ) ) this.type( ch ); return this; }
	backspace() {
		if ( this.caret === 0 ) return this;
		const cp = Array.from( this.value.slice( 0, this.caret ) ).pop();
		this.value = this.value.slice( 0, this.caret - cp.length ) + this.value.slice( this.caret ); this.caret -= cp.length;
		this._after( 'deleteContentBackward' ); return this;
	}
	moveCaret( pos ) { this.caret = pos; this.ip.selection( pos, pos ); return this; }
}
const typed = s => new FakeTextarea().typeAll( s ).value;

// 1. Typing one character at a time == converting word by word (whitespace kept exactly)
const fixtures = require( './phrases.json' );
const bad = fixtures.filter( s => typed( s ) !== perWord( s ) );
console.log( `[1] typing ${fixtures.length} fixture strings char by char: ${fixtures.length - bad.length} identical to word-by-word conversion, ${bad.length} differ` );
bad.slice( 0, 5 ).forEach( s => console.log( '     ', j( s ), '\n        word-by-word:', j( perWord( s ) ), '\n        typed:       ', j( typed( s ) ) ) );
check( 'all fixtures identical', bad.length === 0, bad.length );

// 2. Concrete behaviours
check( 'typing a phrase', typed( 'আমার সোনার বাংলা' ) === 'amar sonar bangla', typed( 'আমার সোনার বাংলা' ) );
check( 'typing (conjuncts)', typed( 'বিষ্ণুপ্রিয়া মনিপুরি' ) === 'bishnupriya monipuri', typed( 'বিষ্ণুপ্রিয়া মনিপুরি' ) );
check( 'Bengali digits and danda', typed( '১৯৪৭ সালে।' ) === perWord( '১৯৪৭ সালে।' ) && typed( '১৯৪৭' ) === '1947' );
check( 'a lone danda converts', typed( '।' ) === R.transliterate( '।' ), j( typed( '।' ) ) );
{ // live romanisation while a word is being typed; backspace removes one BENGALI character of the source
	const w = 'বাংলা'; const ta = new FakeTextarea().typeAll( w );
	check( 'full word', ta.value === 'bangla' );
	for ( let k = 1; k < Array.from( w ).length; k++ ) {
		const t2 = new FakeTextarea().typeAll( w ); for ( let i = 0; i < k; i++ ) t2.backspace();
		const want = safe( Array.from( w ).slice( 0, Array.from( w ).length - k ).join( '' ) );
		check( `backspace x${k} after ${w}`, t2.value === want, `${j( t2.value )} != ${j( want )}` );
	}
	const t3 = new FakeTextarea().typeAll( w ); for ( let i = 0; i < 5; i++ ) t3.backspace(); check( 'backspace to empty', t3.value === '' && t3.caret === 0, j( t3.value ) );
	const t4 = new FakeTextarea().typeAll( 'কৃষ্ণ' ); const src = 'কৃষ্ণ'; t4.backspace(); check( 'backspace drops the last code point (ণ) of কৃষ্ণ', t4.value === safe( 'কৃষ্' ), j( t4.value ) );
}
{ // words the engine would turn into nothing (a standalone অ / ও) stay visible instead of vanishing
	check( 'engine turns a lone অ into nothing (the reason for this test)', R.transliterate( 'অ' ) === '' && R.transliterate( 'ও' ) === '' );
	const a = new FakeTextarea().typeAll( 'অ' ); check( 'typing অ keeps it visible', a.value === 'অ', j( a.value ) );
	a.typeAll( 'স' ); check( 'অ then স converts (os)', a.value === 'os', j( a.value ) );
	a.backspace(); check( 'backspace brings the visible অ back', a.value === 'অ', j( a.value ) );
	a.backspace(); check( 'backspace again empties the field', a.value === '' && a.caret === 0, j( a.value ) );
	const s = new FakeTextarea().typeAll( 'আমি ও তুমি' ); check( 'a standalone ও is not deleted from a sentence', s.value === 'ami ও tumi', j( s.value ) );
	const p = new FakeTextarea().type( 'আমি ও তুমি ', 'insertFromPaste' ); check( 'pasted sentence keeps ও and its spaces', p.value === 'ami ও tumi ', j( p.value ) );
	const lone = new FakeTextarea().type( 'a ', 'insertText' ).typeAll( '্' ); check( 'a lone virama stays visible', lone.value === 'a ্', j( lone.value ) );
}
{ // Roman text is never touched: case kept, nothing lowercased
	check( 'typed Roman stays as typed', typed( 'Hello World, OK?' ) === 'Hello World, OK?', j( typed( 'Hello World, OK?' ) ) );
	const ta = new FakeTextarea().type( 'Hello WORLD', 'insertFromPaste' ); check( 'pasted Roman untouched', ta.value === 'Hello WORLD', j( ta.value ) );
	const t2 = new FakeTextarea().typeAll( 'Dhaka ' ).typeAll( 'ঢাকা' ); check( 'Roman then Bengali', t2.value === 'Dhaka ' + R.transliterate( 'ঢাকা' ), j( t2.value ) );
	const t3 = new FakeTextarea().type( 'Mixed বাংলা Text', 'insertFromPaste' ); check( 'mixed paste: only the Bengali word converts', t3.value === 'Mixed bangla Text', j( t3.value ) );
}
{ // WHITESPACE IS PRESERVED (the engine itself trims)
	const p = s => new FakeTextarea().type( s, 'insertFromPaste' ).value;
	check( 'paste keeps a trailing space', p( 'বাংলা ' ) === 'bangla ', j( p( 'বাংলা ' ) ) );
	check( 'paste keeps a trailing newline', p( 'আমি\n' ) === 'ami\n', j( p( 'আমি\n' ) ) );
	check( 'paste keeps leading blank lines', p( '\n\nআমি' ) === '\n\nami', j( p( '\n\nআমি' ) ) );
	check( 'paste keeps multi-line text and double spaces', p( 'আমি  তুমি\nসে' ) === 'ami  tumi\nse', j( p( 'আমি  তুমি\nসে' ) ) );
	check( 'paste keeps tabs', p( 'আমি\tতুমি' ) === 'ami\ttumi', j( p( 'আমি\tতুমি' ) ) );
	check( 'a single-letter word on a new line (engine quirk avoided)', p( 'জসড়ফঁ\nপ' ) === perWord( 'জসড়ফঁ\nপ' ) && p( 'আম\nপ' ).endsWith( '\np' ), j( p( 'আম\nপ' ) ) );
	const ta = new FakeTextarea().typeAll( 'আমি ' ); check( 'typed space is kept', ta.value === 'ami ', j( ta.value ) );
	ta.typeAll( 'তুমি' ); check( 'next word after the space', ta.value === 'ami tumi', j( ta.value ) );
}
{ // phone keyboards: composed word left alone, converted (with its space intact) on commit
	const ta = new FakeTextarea();
	for ( const c of [ 'ব', 'বা', 'বাং', 'বাংল', 'বাংলা' ] ) { ta.value = c; ta.caret = c.length; const r = ta.ip.update( ta.value, ta.caret, 'insertCompositionText', true ); check( `composing ${c} is left alone`, r.changed === false && ta.value === c ); }
	ta._after( 'compositionend', false ); check( 'composed word converted on commit', ta.value === 'bangla', j( ta.value ) );
	const t2 = new FakeTextarea(); t2.value = 'বাংলা '; t2.caret = 6; t2._after( 'compositionend' ); check( 'commit WITH its space keeps the space', t2.value === 'bangla ', j( t2.value ) );
	t2.value += 'আমি '; t2.caret = t2.value.length; t2._after( 'compositionend' ); check( 'second committed word, glued to nothing', t2.value === 'bangla ami ', j( t2.value ) );
}
{ // caret movement, undo, odd input
	const ta = new FakeTextarea().typeAll( 'বাংলা' ); const w = ta.value; ta.moveCaret( 0 ).typeAll( 'আমি' );
	check( 'insert at start leaves the finished word alone', ta.value === R.transliterate( 'আমি' ) + w, j( ta.value ) );
	const u = new FakeTextarea().typeAll( 'আমি' ); u.value = ''; u.caret = 0; u._after( 'historyUndo' ); check( 'undo accepted as is', u.value === '' );
	let threw = false; const o = new FakeTextarea(); try { o.typeAll( 'ক😀খ' ).typeAll( '\u200d\u200c' ).typeAll( '্' ); o.type( '😀😀', 'insertFromPaste' ); } catch ( e ) { threw = e; }
	check( 'emoji / zero-width / lone virama do not throw', ! threw, String( threw ) ); check( 'emoji survive', o.value.includes( '😀' ) );
}
// 3. Random editing sessions against a simple model (Bengali source, backspace drops one source code point)
{
	let seed = 11; const rnd = () => ( seed = ( seed * 1664525 + 1013904223 ) >>> 0 ) / 4294967296;
	const cons = Array.from( 'কখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহড়ঢ়য়' ), matra = Array.from( 'ািীুূৃেৈোৌ' ), sign = Array.from( 'ংঃঁ্' ), digit = Array.from( '০১২৩৪৫৬৭৮৯' ), vow = Array.from( 'অআইঈউঊঋএঐওঔ' ), latin = Array.from( 'abXY,.' ), punct = [ '।' ];
	const first = [ ...cons, ...vow, ...digit, ...latin ], any = [ ...cons, ...cons, ...matra, ...matra, ...sign, ...digit, ...vow, ...latin, ...punct ];
	let badN = 0; const N = 400;
	for ( let i = 0; i < N; i++ ) {
		const ta = new FakeTextarea(), model = [], ops_log = []; let cur = '';
		const ops = 5 + Math.floor( rnd() * 40 );
		for ( let k = 0; k < ops; k++ ) {
			const r = rnd();
			if ( r < 0.70 ) { const pool = cur === '' ? first : any; const ch = pool[ Math.floor( rnd() * pool.length ) ]; ta.type( ch ); cur += ch; ops_log.push( ch ); }
			else if ( r < 0.84 ) { ta.type( ' ' ); model.push( cur, ' ' ); cur = ''; ops_log.push( '_' ); }
			else if ( cur.length ) { ta.backspace(); cur = Array.from( cur ).slice( 0, -1 ).join( '' ); ops_log.push( '<' ); }
		}
		model.push( cur );
		const want = model.map( m => m === ' ' ? ' ' : safe( m ) ).join( '' );
		if ( ta.value !== want ) { badN++; if ( badN <= 3 ) console.log( '     ops (_=space, <=backspace):', j( ops_log.join( ' ' ) ), '\n     differs:', j( model ), '\n        want', j( want ), '\n        got ', j( ta.value ) ); }
	}
	check( `random Bengali typing sessions (${N}) equal the per-word model`, badN === 0, badN + ' differ' );
}
console.log( `\n${fail ? 'FAILED' : 'OK'} - ${pass} checks passed, ${fail} failed` );
process.exit( fail ? 1 : 0 );
