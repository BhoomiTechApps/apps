/**
 * HTML forms that produce their own output (for example a PDF built in the
 * browser). A form is opened for a place in a sandboxed frame; whatever file
 * the form tries to download is caught and attached to that place instead.
 *
 * Works with forms as they are: nothing needs to change in the form. The
 * bridge below intercepts the usual ways a page hands over a file:
 *   <a download> clicks, a.click(), a.dispatchEvent(click) (FileSaver/jsPDF),
 *   window.open(blob or data URL) and navigator.share({ files }).
 */
import * as S from './store.js';

const esc = s => String( s ?? '' ).replace( /[&<>"']/g, c => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } )[ c ] );
const $ = ( sel, root = document ) => root.querySelector( sel );

/* ------------------------------------------------------------------ */
/* Bridge: runs inside the form, before the form's own scripts.        */
/* ------------------------------------------------------------------ */
function bridgeScript( place, prefill ) {
    const data = JSON.stringify( { place, prefill } ).replace( /</g, '\\u003c' );
    return `<script>(function () {
    "use strict";
    var CFG = ${ data };
    window.MediaMapPlace = CFG.place;
    var post = function ( msg ) { msg.mediamapForm = 1; try { parent.postMessage( msg, "*" ); } catch ( e ) {} };
    var blobs = new Map(), sent = new WeakSet();
    var origCreate = URL.createObjectURL;
    URL.createObjectURL = function ( obj ) {
        var url = origCreate.apply( URL, arguments );
        if ( obj instanceof Blob ) blobs.set( url, obj );
        return url;
    };
    function send( blob, name ) {
        if ( ! blob || sent.has( blob ) ) return;
        sent.add( blob );
        post( { type: "output", blob: blob, name: name || "", mime: blob.type || "" } );
        dirty = false;
        setTimeout( prefill, 250 );
    }
    function fromHref( href, name ) {
        if ( ! href ) return false;
        var b = blobs.get( href );
        if ( b ) { send( b, name ); return true; }
        if ( /^data:/i.test( href ) ) {
            fetch( href ).then( function ( r ) { return r.blob(); } ).then( function ( b ) { send( b, name ); } );
            return true;
        }
        return false;
    }
    function fromAnchor( a ) {
        if ( ! a || a.tagName !== "A" ) return false;
        if ( ! a.hasAttribute( "download" ) && ! blobs.has( a.href ) && ! /^data:/i.test( a.href ) ) return false;
        return fromHref( a.href, a.getAttribute( "download" ) || "" );
    }
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if ( fromAnchor( this ) ) return; return origClick.apply( this, arguments ); };
    var origDispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function ( ev ) {
        if ( ev && ev.type === "click" && this instanceof HTMLAnchorElement && fromAnchor( this ) ) return false;
        return origDispatch.apply( this, arguments );
    };
    document.addEventListener( "click", function ( e ) {
        var a = e.target && e.target.closest ? e.target.closest( "a" ) : null;
        if ( a && fromAnchor( a ) ) e.preventDefault();
    }, true );
    var origOpen = window.open;
    window.open = function ( u ) {
        if ( typeof u === "string" && fromHref( u, "" ) ) return null;
        return origOpen ? origOpen.apply( window, arguments ) : null;
    };
    try {
        Object.defineProperty( navigator, "share", { configurable: true, value: function ( d ) {
            if ( d && d.files && d.files.length ) { for ( var i = 0; i < d.files.length; i++ ) send( d.files[ i ], d.files[ i ].name ); return Promise.resolve(); }
            return Promise.reject( new Error( "Sharing isn't available here." ) );
        } } );
        Object.defineProperty( navigator, "canShare", { configurable: true, value: function ( d ) { return !! ( d && d.files ); } } );
    } catch ( e ) {}

    /* Fill empty latitude / longitude fields with the place's position. */
    function prefill() {
        if ( ! CFG.prefill || ! CFG.place ) return;
        var inputs = document.querySelectorAll( "input" );
        for ( var i = 0; i < inputs.length; i++ ) {
            var el = inputs[ i ];
            if ( [ "text", "number", "search", "" ].indexOf( el.type ) < 0 || el.value ) continue;
            var k = ( ( el.id || "" ) + " " + ( el.name || "" ) + " " + ( el.placeholder || "" ) + " " + ( el.getAttribute( "aria-label" ) || "" ) ).toLowerCase();
            if ( /(^|[^a-z])(lat|latitude)([^a-z]|$)/.test( k ) ) el.value = CFG.place.lat;
            else if ( /(^|[^a-z])(lng|lon|long|longitude)([^a-z]|$)/.test( k ) ) el.value = CFG.place.lng;
        }
    }
    window.addEventListener( "load", function () { setTimeout( prefill, 0 ); setTimeout( prefill, 400 ); } );
    document.addEventListener( "reset", function () { setTimeout( prefill, 0 ); }, true );

    var dirty = false;
    document.addEventListener( "input", function () { if ( ! dirty ) { dirty = true; post( { type: "dirty", dirty: true } ); } }, true );
    document.addEventListener( "reset", function () { dirty = false; post( { type: "dirty", dirty: false } ); }, true );
    document.addEventListener( "contextmenu", function ( e ) {
        if ( ! ( e.target.closest && e.target.closest( "input, textarea, [contenteditable]" ) ) ) e.preventDefault();
    } );
    window.addEventListener( "error", function ( e ) { post( { type: "error", message: String( e.message || "Script error" ) } ); } );
})();<\/script>`;
}

function inject( html, script ) {
    const m = /<head[^>]*>/i.exec( html );
    if ( m ) return html.slice( 0, m.index + m[ 0 ].length ) + script + html.slice( m.index + m[ 0 ].length );
    const h = /<html[^>]*>/i.exec( html );
    if ( h ) return html.slice( 0, h.index + h[ 0 ].length ) + '<head>' + script + '</head>' + html.slice( h.index + h[ 0 ].length );
    return script + html;
}

const titleOf = html => {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec( html );
    if ( ! m ) return '';
    const t = document.createElement( 'textarea' );
    t.innerHTML = m[ 1 ].trim();
    return t.value.slice( 0, 200 );
};

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */
/**
 * @param ctx { getStore(), getIndex(), mutate(fn), toast(msg, opts), onAttached(entryId), confirm(msg) }
 */
export function createForms( ctx ) {
    /* ---------- library ---------- */
    async function addFormFile( file ) {
        if ( file.size > 25 * 1024 * 1024 ) throw new Error( 'Forms over 25 MB aren’t supported.' );
        const html = await file.text();
        if ( ! /<(html|form|script|body)[\s>]/i.test( html ) ) throw new Error( 'This doesn’t look like an HTML form.' );
        const st = ctx.getStore();
        const name = titleOf( html ) || file.name.replace( /\.html?$/i, '' ) || 'Form';
        const path = await st.freeMediaPath( file.name.replace( /\.html?$/i, '' ) + '.html', S.FORM_DIR );
        await st.write( path, new Blob( [ html ], { type: 'text/html' } ) );
        const form = S.cleanForm( { id: S.newId(), name, file: path } );
        try {
            await ctx.mutate( ix => { ix.forms = [ ...( ix.forms || [] ), form ]; } );
        } catch ( err ) {
            await st.remove( path ).catch( () => {} );
            throw err;
        }
        return form;
    }

    /** Opens a file chooser for a form; resolves with the new form or null. Must run from a click. */
    function pickForm() {
        return new Promise( resolve => {
            const input = document.createElement( 'input' );
            input.type = 'file';
            input.accept = '.html,.htm,text/html';
            input.addEventListener( 'change', async () => {
                const file = input.files && input.files[ 0 ];
                if ( ! file ) { resolve( null ); return; }
                try {
                    const form = await addFormFile( file );
                    ctx.toast( `Added the form “${ form.name }”.` );
                    resolve( form );
                } catch ( err ) {
                    ctx.toast( `Couldn’t add ${ file.name }: ${ err.message }`, { long: true } );
                    resolve( null );
                }
            } );
            input.click();
        } );
    }

    function renderSettings( box ) {
        const forms = ctx.getIndex().forms || [];
        box.innerHTML = `
            <h3>Forms</h3>
            <p>Add an HTML form that creates its own file, such as a PDF. Open it from a place with <strong>Fill in a form</strong>, and whatever it produces is saved to that place.</p>
            ${ forms.length ? `<ul class="form-list">${ forms.map( f => `
                <li data-id="${ esc( f.id ) }">
                    <span class="form-name">${ esc( f.name ) }</span>
                    <label class="check small"><input type="checkbox" data-prefill ${ f.prefillLocation ? 'checked' : '' }> Fill in latitude and longitude fields from the place</label>
                    <span class="form-btns">
                        <button type="button" class="btn-link" data-rename>Rename</button>
                        <button type="button" class="btn-link danger" data-delete>Delete</button>
                    </span>
                </li>` ).join( '' ) }</ul>` : '' }
            <div class="actions"><button type="button" class="btn" data-add-form>Add form (.html)</button></div>`;
        $( '[data-add-form]', box ).addEventListener( 'click', async () => { if ( await pickForm() ) renderSettings( box ); } );
        box.querySelectorAll( '.form-list li' ).forEach( li => {
            const id = li.dataset.id;
            const update = fn => ctx.mutate( ix => {
                const f = ( ix.forms || [] ).find( x => x.id === id );
                if ( f ) { fn( f ); f.updated = new Date().toISOString(); }
            } ).catch( err => ctx.toast( 'Could not save: ' + err.message, { long: true } ) );
            $( '[data-prefill]', li ).addEventListener( 'change', e => update( f => { f.prefillLocation = e.target.checked; } ) );
            $( '[data-rename]', li ).addEventListener( 'click', async () => {
                const f = ( ctx.getIndex().forms || [] ).find( x => x.id === id );
                const name = f && prompt( 'Form name', f.name );
                if ( ! name || ! name.trim() ) return;
                await update( x => { x.name = name.trim().slice( 0, 200 ); } );
                renderSettings( box );
            } );
            $( '[data-delete]', li ).addEventListener( 'click', async () => {
                const f = ( ctx.getIndex().forms || [] ).find( x => x.id === id );
                if ( ! f || ! ctx.confirm( `Delete the form “${ f.name }”? Responses already saved to places are kept.` ) ) return;
                try {
                    await ctx.mutate( ix => { ix.forms = ( ix.forms || [] ).filter( x => x.id !== id ); } );
                    await ctx.getStore().remove( f.file ).catch( () => {} );
                    ctx.toast( 'Form deleted.' );
                    renderSettings( box );
                } catch ( err ) {
                    ctx.toast( 'Could not delete: ' + err.message, { long: true } );
                }
            } );
        } );
    }

    /* ---------- saving what a form produces ---------- */
    async function saveOutput( entryId, form, blob, name ) {
        const st = ctx.getStore();
        let fname = String( name || '' ).split( /[\\/]/ ).pop().trim();
        const isPdf = blob.type === 'application/pdf' || /\.pdf$/i.test( fname );
        if ( ! fname ) fname = ( form ? form.name : 'attachment' ) + ( isPdf ? '.pdf' : '' );
        if ( isPdf && ! /\.pdf$/i.test( fname ) ) fname += '.pdf';
        // Start the name with the place's name so the file is easy to identify
        // anywhere (e.g. "Kamakhya-gate_mapmedia_demo-1790482932340.pdf").
        const entry = ctx.getIndex().entries.find( x => x.id === entryId );
        const prefix = S.safeFileName( entry ? ( entry.place || `place-${ entry.lat.toFixed( 5 ) }_${ entry.lng.toFixed( 5 ) }` ) : '', 60 );
        fname = S.safeFileName( fname );
        if ( prefix && ! fname.toLowerCase().startsWith( prefix.toLowerCase() ) ) fname = `${ prefix }_${ fname }`;
        const path = await st.freeMediaPath( fname );
        await st.write( path, blob );
        const now = new Date().toISOString();
        const att = {
            id: S.newId(), path, name: fname,
            mime: blob.type || ( isPdf ? 'application/pdf' : '' ),
            size: blob.size,
            form: form ? { id: form.id, name: form.name } : null,
            created: now,
        };
        try {
            await ctx.mutate( ix => {
                const e = ix.entries.find( x => x.id === entryId );
                if ( ! e ) throw new Error( 'This place no longer exists.' );
                e.attachments.push( att );
                e.updated = now;
            } );
        } catch ( err ) {
            await st.remove( path ).catch( () => {} );
            throw err;
        }
        ctx.onAttached( entryId );
        return att;
    }

    /* ---------- the form window ---------- */
    async function openForm( form, entry ) {
        let html;
        try { html = await ( await ctx.getStore().getFile( form.file ) ).text(); }
        catch { ctx.toast( `The form file ${ form.file } is missing from the data folder.`, { long: true } ); return; }

        const returnFocus = document.activeElement;
        const place = { id: entry.id, lat: entry.lat, lng: entry.lng, place: entry.place };
        const el = document.createElement( 'div' );
        el.className = 'formv';
        el.setAttribute( 'role', 'dialog' );
        el.setAttribute( 'aria-modal', 'true' );
        el.setAttribute( 'aria-label', form.name );
        el.innerHTML = `
            <div class="formv-bar">
                <button type="button" class="icon-btn" data-close aria-label="Close form">
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="m18.3 7.1-1.4-1.4-4.9 4.9-4.9-4.9-1.4 1.4 4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9z"/></svg>
                </button>
                <span class="formv-title"><strong>${ esc( form.name ) }</strong><span>for ${ esc( entry.place || 'this place' ) }</span></span>
                <span class="formv-count" data-count hidden></span>
            </div>
            <p class="formv-status" data-status role="status" aria-live="polite">Submit the form and its file is saved to this place.</p>
            <iframe class="formv-frame" title="${ esc( form.name ) }"
                sandbox="allow-scripts allow-forms allow-modals allow-popups"
                allow="geolocation; camera; microphone"></iframe>`;
        document.body.append( el );
        const frame = $( 'iframe', el );
        const status = $( '[data-status]', el );
        const count = $( '[data-count]', el );
        let saved = 0, dirty = false, closed = false, busy = Promise.resolve();

        const close = () => {
            if ( closed ) return;
            if ( dirty && ! ctx.confirm( 'Close the form? What you’ve entered hasn’t been submitted.' ) ) return;
            closed = true;
            window.removeEventListener( 'message', onMessage );
            document.removeEventListener( 'keydown', onKey, true );
            el.remove();
            returnFocus && returnFocus.focus && returnFocus.focus();
            if ( saved ) ctx.toast( saved === 1 ? `1 response saved to ${ entry.place || 'the place' }.` : `${ saved } responses saved to ${ entry.place || 'the place' }.` );
        };
        const onKey = e => { if ( e.key === 'Escape' ) { e.stopPropagation(); close(); } };
        const onMessage = e => {
            if ( e.source !== frame.contentWindow || ! e.data || ! e.data.mediamapForm ) return;
            const d = e.data;
            if ( d.type === 'dirty' ) { dirty = !! d.dirty; return; }
            if ( d.type === 'output' && d.blob instanceof Blob ) {
                dirty = false;
                status.textContent = 'Saving the response…';
                status.className = 'formv-status';
                busy = busy.then( async () => {
                    try {
                        const att = await saveOutput( entry.id, form, d.blob, d.name );
                        saved++;
                        count.hidden = false;
                        count.textContent = `${ saved } saved`;
                        status.textContent = `Saved “${ att.name }” to ${ entry.place || 'this place' }. You can fill in the form again or close it.`;
                        status.className = 'formv-status is-ok';
                    } catch ( err ) {
                        status.textContent = 'The response couldn’t be saved: ' + err.message;
                        status.className = 'formv-status is-err';
                    }
                } );
            }
        };
        window.addEventListener( 'message', onMessage );
        document.addEventListener( 'keydown', onKey, true );
        $( '[data-close]', el ).addEventListener( 'click', close );
        frame.srcdoc = inject( html, bridgeScript( place, form.prefillLocation ) );
        $( '[data-close]', el ).focus();
    }

    /** Opens the chooser (or the only form) for a place; offers to add one when there are none. */
    async function fillIn( entry, formId ) {
        let forms = ctx.getIndex().forms || [];
        let form = forms.find( f => f.id === formId ) || ( forms.length === 1 ? forms[ 0 ] : null );
        if ( ! forms.length ) {
            form = await pickForm();
            if ( ! form ) return;
        }
        if ( form ) openForm( form, entry );
    }

    return { addFormFile, pickForm, renderSettings, openForm, fillIn, saveOutput };
}
