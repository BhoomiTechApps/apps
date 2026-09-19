// Run:  node tests/inplace.test.js
const path = require( 'path' );
const T = require( path.join( __dirname, '../vendor/translit-forward.js' ) );
const InPlace = require( path.join( __dirname, '../inplace.js' ) );

let pass = 0, fail = 0;
const check = ( name, ok, detail ) => { if ( ok ) pass++; else { fail++; console.log( 'FAIL', name, detail || '' ); } };
const j = JSON.stringify;

/** A text area that edits the way a browser does, then hands the result to InPlace. */
class FakeTextarea {
	constructor() { this.value = ''; this.caret = 0; this.ip = InPlace.create( T.transliterate ); this.ip.reset( '' ); }
	_after( inputType, composing ) {
		const r = this.ip.update( this.value, this.caret, inputType, composing );
		if ( r.changed ) { this.value = r.value; this.caret = r.caret; }
		this.ip.selection( this.caret, this.caret );   // the browser fires selectionchange
	}
	type( s, inputType = 'insertText' ) { this.value = this.value.slice( 0, this.caret ) + s + this.value.slice( this.caret ); this.caret += s.length; this._after( inputType ); return this; }
	typeAll( s ) { for ( const ch of Array.from( s ) ) this.type( ch ); return this; }
	backspace() {
		if ( this.caret === 0 ) return this;
		const cp = Array.from( this.value.slice( 0, this.caret ) ).pop();      // a browser deletes one code point / cluster
		this.value = this.value.slice( 0, this.caret - cp.length ) + this.value.slice( this.caret ); this.caret -= cp.length;
		this._after( 'deleteContentBackward' ); return this;
	}
	moveCaret( pos ) { this.caret = pos; this.ip.selection( pos, pos ); return this; }
	replaceSelection( from, to, s, inputType = 'insertText' ) { this.value = this.value.slice( 0, from ) + s + this.value.slice( to ); this.caret = from + s.length; this._after( inputType ); return this; }
}
const typed = s => new FakeTextarea().typeAll( s ).value;

// 1. Typing one character at a time gives the same result as transliterating the whole string
const fixtures = require( './phrases.json' );
let mismatches = [];
for ( const s of fixtures ) {
	const want = T.transliterate( s ), got = typed( s );
	if ( got !== want ) mismatches.push( [ s, want, got ] );
}
console.log( `[1] typing ${fixtures.length} fixture strings char by char: ${fixtures.length - mismatches.length} identical to whole-string transliteration, ${mismatches.length} differ` );
mismatches.slice( 0, 6 ).forEach( m => console.log( '     ', j( m[ 0 ] ), '\n        whole:', j( m[ 1 ] ), '\n        typed:', j( m[ 2 ] ) ) );

// 2. Concrete behaviours
check( 'typing a phrase', typed( 'ami tomay bhalobashi' ) === 'আমি তমায় ভালবাশি', typed( 'ami tomay bhalobashi' ) );
check( 'punctuation converts (danda)', typed( 'ami.' ) === T.transliterate( 'ami.' ) );
check( 'digits convert', typed( '1947' ) === '১৯৪৭' );
{ // backspace removes ONE ROMAN LETTER and re-converts
	for ( const w of [ 'bangla', 'bhalobashi', 'sOnar', 'krrishno', 'ongko', 'kkh' ] ) {
		for ( let k = 1; k < w.length; k++ ) {
			const ta = new FakeTextarea().typeAll( w ); for ( let i = 0; i < k; i++ ) ta.backspace();
			const want = T.transliterate( w.slice( 0, w.length - k ) );
			check( `backspace x${k} after "${w}"`, ta.value === want, `${j( ta.value )} != ${j( want )}` );
		}
		const ta = new FakeTextarea().typeAll( w ); for ( let i = 0; i < w.length; i++ ) ta.backspace();
		check( `backspace to empty after "${w}"`, ta.value === '' && ta.caret === 0, j( ta.value ) );
	}
}
{ // a committed word is ordinary text: backspace edits it natively
	const ta = new FakeTextarea().typeAll( 'ami tomay' );
	const before = ta.value; ta.type( ' ' ).backspace();      // type space, delete space
	check( 'space then backspace restores text', ta.value === before, j( ta.value ) );
	ta.typeAll( 'x' ); check( 'typing after that starts a new token', ta.value === before + T.transliterate( 'x' ), j( ta.value ) );
}
{ // moving the caret ends the token; typing elsewhere starts a new one
	const ta = new FakeTextarea().typeAll( 'bangla' ); const w = ta.value;
	ta.moveCaret( 0 ).typeAll( 'ami' );
	check( 'insert at start leaves the committed word alone', ta.value === T.transliterate( 'ami' ) + w, j( ta.value ) );
	ta.moveCaret( ta.value.length ).type( ' ' ).typeAll( 'ke' );
	check( 'append after moving back to the end', ta.value === T.transliterate( 'ami' ) + w + ' ' + T.transliterate( 'ke' ), j( ta.value ) );
}
{ // paste converts the whole chunk, and does not become a token
	const ta = new FakeTextarea().typeAll( 'ami ' ); ta.type( 'tumi bhalo', 'insertFromPaste' );
	check( 'paste is converted as a whole', ta.value === 'আমি ' + T.transliterate( 'tumi bhalo' ), j( ta.value ) );
	ta.typeAll( 'x' ); check( 'typing after a paste starts a fresh token', ta.value.endsWith( T.transliterate( 'x' ) ) && ! ta.ip.state().pending.roman.includes( 'bhalo' ) );
	const p2 = new FakeTextarea().type( 'সোনার বাংলা', 'insertFromPaste' ); check( 'pasting Bengali text leaves it unchanged', p2.value === 'সোনার বাংলা' );
}
{ // selection replaced by a typed character
	const ta = new FakeTextarea().typeAll( 'bangla ' ); const w = T.transliterate( 'bangla' );
	ta.replaceSelection( 0, w.length, 'a' ); check( 'replacing a selection starts a new token', ta.value === T.transliterate( 'a' ) + ' ', j( ta.value ) );
}
{ // phone keyboards: text is composed (left untouched) and converted when the keyboard commits it
	const ta = new FakeTextarea();
	for ( const c of [ 'b', 'ba', 'ban', 'bang', 'bangl', 'bangla' ] ) {
		ta.value = c; ta.caret = c.length;
		const r = ta.ip.update( ta.value, ta.caret, 'insertCompositionText', true );
		check( `composing "${c}" is left alone`, r.changed === false && ta.value === c );
	}
	ta._after( 'compositionend', false );
	check( 'composed word converted on commit', ta.value === 'বাংলা', j( ta.value ) );
	ta.value += ' '; ta.caret = ta.value.length; ta._after( 'insertText' );
	ta.value = ta.value + 'ami'; ta.caret = ta.value.length; ta._after( 'compositionend' );
	check( 'second composed word', ta.value === 'বাংলা ' + T.transliterate( 'ami' ), j( ta.value ) );
	const t2 = new FakeTextarea(); t2.value = 'bangla '; t2.caret = 7; t2._after( 'compositionend' );
	check( 'composition committed together with its space', t2.value === 'বাংলা ', j( t2.value ) );
}
{ // undo / redo are never converted
	const ta = new FakeTextarea().typeAll( 'ami' ); ta.value = ''; ta.caret = 0; ta._after( 'historyUndo' );
	check( 'undo accepted as is', ta.value === '' ); ta.value = 'ami'; ta.caret = 3; ta._after( 'historyRedo' ); check( 'redo accepted as is (not converted)', ta.value === 'ami' );
}
{ // whitespace, newlines
	const ta = new FakeTextarea().typeAll( 'ami' ).type( '\n' ).typeAll( 'tumi' );
	check( 'newline commits the token', ta.value === T.transliterate( 'ami' ) + '\n' + T.transliterate( 'tumi' ), j( ta.value ) );
	const t2 = new FakeTextarea().typeAll( '   ' ); check( 'leading spaces untouched', t2.value === '   ' );
}
{ // odd input never throws and never loses text
	const ta = new FakeTextarea(); let threw = false;
	try { ta.typeAll( 'a😀b' ).typeAll( '\u200d\u200c' ).typeAll( 'x' ); ta.type( '😀😀', 'insertFromPaste' ); } catch ( e ) { threw = e; }
	check( 'emoji / zero-width characters do not throw', ! threw, String( threw ) );
	check( 'emoji survive', ta.value.includes( '😀' ) );
}
{ // repeated characters (diff ambiguity)
	const ta = new FakeTextarea().typeAll( 'aaa' ); check( 'aaa', ta.value === T.transliterate( 'aaa' ), j( ta.value ) );
	ta.backspace(); check( 'aaa then backspace = aa', ta.value === T.transliterate( 'aa' ), j( ta.value ) );
}
// 3. Random editing sessions vs a simple model: type letters, spaces and backspaces; the text must equal the per-word transliteration
{
	let seed = 7; const rnd = () => ( seed = ( seed * 1664525 + 1013904223 ) >>> 0 ) / 4294967296;
	const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ\'`^~.,0123456789'.split( '' );
	let bad = 0, n = 300;
	for ( let i = 0; i < n; i++ ) {
		const ta = new FakeTextarea(); const model = []; let cur = '';
		const ops = 5 + Math.floor( rnd() * 40 );
		for ( let k = 0; k < ops; k++ ) {
			const r = rnd();
			if ( r < 0.68 ) { const ch = letters[ Math.floor( rnd() * letters.length ) ]; ta.type( ch ); cur += ch; }
			else if ( r < 0.82 ) { ta.type( ' ' ); model.push( cur ); cur = ''; model.push( ' ' ); }
			else if ( cur.length ) { ta.backspace(); cur = Array.from( cur ).slice( 0, -1 ).join( '' ); }
		}
		model.push( cur );
		const want = model.map( m => m === ' ' ? ' ' : T.transliterate( m ) ).join( '' );
		if ( ta.value !== want ) { bad++; if ( bad <= 3 ) console.log( '     random session differs:', j( model ), '\n        want', j( want ), '\n        got ', j( ta.value ) ); }
	}
	check( `random typing sessions (${n}) equal the per-word model`, bad === 0, `${bad} differ` );
}
console.log( `\n${fail ? 'FAILED' : 'OK'} - ${pass} checks passed, ${fail} failed` );
process.exit( fail ? 1 : 0 );
