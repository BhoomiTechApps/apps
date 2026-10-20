/**
 * PDF display using the bundled PDF.js (loaded on first use, works offline).
 * - renderPreview(): first page + page count, for the details panel
 * - openViewer():   full-screen reader with page navigation and zoom
 */
import { icon } from './icons.js';
const BASE = new URL( '../vendor/pdfjs/', import.meta.url ).href;
let libPromise = null;

function lib() {
    if ( ! libPromise ) {
        libPromise = import( BASE + 'pdf.min.js' ).then( pdfjs => {
            pdfjs.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js';
            return pdfjs;
        } );
        libPromise.catch( () => { libPromise = null; } );
    }
    return libPromise;
}

/** @param {Blob|string} source  a File/Blob, or an https URL (needs CORS) */
async function open( source ) {
    const pdfjs = await lib();
    const params = {
        cMapUrl: BASE + 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: BASE + 'standard_fonts/',
        isEvalSupported: false,
    };
    if ( typeof source === 'string' ) params.url = source;
    else params.data = new Uint8Array( await source.arrayBuffer() );
    const task = pdfjs.getDocument( params );
    task.onPassword = ( update, reason ) => {
        const pw = prompt( reason === 2 ? 'That password is wrong. Try again:' : 'This PDF is protected. Enter its password:' );
        if ( pw === null ) task.destroy(); else update( pw );
    };
    return task.promise;
}

const MAX_PIXELS = 16e6;
async function drawPage( page, canvas, cssWidth ) {
    const base  = page.getViewport( { scale: 1 } );
    const scale = cssWidth / base.width;
    const vp    = page.getViewport( { scale } );
    let dpr = Math.min( window.devicePixelRatio || 1, 2 );
    if ( vp.width * vp.height * dpr * dpr > MAX_PIXELS ) dpr = Math.sqrt( MAX_PIXELS / ( vp.width * vp.height ) );
    canvas.width  = Math.floor( vp.width * dpr );
    canvas.height = Math.floor( vp.height * dpr );
    canvas.style.width  = Math.floor( vp.width ) + 'px';
    canvas.style.height = Math.floor( vp.height ) + 'px';
    const task = page.render( {
        canvasContext: canvas.getContext( '2d' ),
        viewport: vp,
        transform: dpr !== 1 ? [ dpr, 0, 0, dpr, 0, 0 ] : null,
    } );
    await task.promise;
    return task;
}

/**
 * Render page 1 into `box`. Returns the page count, or throws.
 * `onOpen` is called when the preview is clicked.
 */
export async function renderPreview( box, source, { onOpen } = {} ) {
    const doc = await open( source );
    try {
        const page = await doc.getPage( 1 );
        const canvas = document.createElement( 'canvas' );
        canvas.className = 'pdf-thumb';
        const width = Math.min( box.clientWidth || 360, 720 );
        await drawPage( page, canvas, width );
        const btn = document.createElement( 'button' );
        btn.type = 'button';
        btn.className = 'pdf-preview';
        btn.setAttribute( 'aria-label', 'Open document' );
        btn.append( canvas );
        btn.addEventListener( 'click', () => onOpen && onOpen() );
        box.replaceChildren( btn );
        return doc.numPages;
    } finally {
        doc.destroy();
    }
}

/**
 * Full-screen reader. Pages are drawn only as they scroll into view, so
 * long documents open quickly.
 */
export async function openViewer( source, { title = 'Document', downloadName = '', onError } = {} ) {
    const returnFocus = document.activeElement;
    const el = document.createElement( 'div' );
    el.className = 'pdfv';
    el.setAttribute( 'role', 'dialog' );
    el.setAttribute( 'aria-modal', 'true' );
    el.setAttribute( 'aria-label', title );
    el.innerHTML = `
        <div class="pdfv-bar">
            <button type="button" class="icon-btn" data-close aria-label="Close">
                ${ icon( 'close', 22 ) }
            </button>
            <span class="pdfv-title"></span>
            <span class="pdfv-page" aria-live="polite">Opening…</span>
            <span class="pdfv-tools">
                <button type="button" class="icon-btn" data-prev aria-label="Previous page">${ icon( 'up', 22 ) }</button>
                <button type="button" class="icon-btn" data-next aria-label="Next page">${ icon( 'down', 22 ) }</button>
                <button type="button" class="icon-btn" data-out aria-label="Zoom out">${ icon( 'minus', 22 ) }</button>
                <button type="button" class="pdfv-zoom" data-fit aria-label="Fit to width">100%</button>
                <button type="button" class="icon-btn" data-in aria-label="Zoom in">${ icon( 'plus', 22 ) }</button>
                <a class="icon-btn" data-download aria-label="Download" hidden>${ icon( 'download', 22 ) }</a>
            </span>
        </div>
        <div class="pdfv-pages" tabindex="0"></div>`;
    el.querySelector( '.pdfv-title' ).textContent = title;
    ( document.getElementById( 'mm-frame' ) || document.body ).append( el );   // inside the frame: its theme applies
    const pagesEl = el.querySelector( '.pdfv-pages' );
    const pageLbl = el.querySelector( '.pdfv-page' );
    const zoomLbl = el.querySelector( '[data-fit]' );
    el.querySelector( '[data-close]' ).focus();

    let doc = null, zoom = 1, closed = false, observer = null, current = 1, onResize = () => {};
    const slots = [];
    let blobUrl = '';
    if ( typeof source !== 'string' ) {
        blobUrl = URL.createObjectURL( source );
        const a = el.querySelector( '[data-download]' );
        a.href = blobUrl;
        a.download = downloadName || 'document.pdf';
        a.hidden = false;
    } else {
        const a = el.querySelector( '[data-download]' );
        a.href = source;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute( 'aria-label', 'Open original' );
        a.hidden = false;
    }

    const close = () => {
        if ( closed ) return;
        closed = true;
        observer && observer.disconnect();
        slots.forEach( s => s.task && s.task.cancel && s.task.cancel() );
        doc && doc.destroy();
        blobUrl && setTimeout( () => URL.revokeObjectURL( blobUrl ), 1000 );
        document.removeEventListener( 'keydown', onKey, true );
        window.removeEventListener( 'resize', onResize );
        el.remove();
        returnFocus && returnFocus.focus && returnFocus.focus();
    };
    const onKey = e => {
        if ( e.key === 'Escape' ) { e.stopPropagation(); close(); }
        else if ( ( e.key === '+' || e.key === '=' ) && ! e.ctrlKey && ! e.metaKey ) setZoom( zoom * 1.25 );
        else if ( e.key === '-' && ! e.ctrlKey && ! e.metaKey ) setZoom( zoom / 1.25 );
    };
    document.addEventListener( 'keydown', onKey, true );
    el.querySelector( '[data-close]' ).addEventListener( 'click', close );

    try {
        doc = await open( source );
    } catch ( err ) {
        close();
        onError && onError( err );
        return;
    }
    if ( closed ) { doc.destroy(); return; }

    const first = await doc.getPage( 1 );
    const ratio = first.getViewport( { scale: 1 } ).height / first.getViewport( { scale: 1 } ).width;
    const fitWidth = () => Math.min( pagesEl.clientWidth - 24, 1100 );

    for ( let i = 1; i <= doc.numPages; i++ ) {
        const slot = document.createElement( 'div' );
        slot.className = 'pdfv-slot';
        slot.dataset.page = i;
        slot.style.aspectRatio = `1 / ${ ratio }`;
        pagesEl.append( slot );
        slots.push( { el: slot, drawnAt: 0, task: null } );
    }

    const draw = async s => {
        const width = Math.round( fitWidth() * zoom );
        if ( s.drawnAt === width || closed ) return;
        s.drawnAt = width;
        s.el.style.width = width + 'px';
        try {
            const page = await doc.getPage( +s.el.dataset.page );
            const canvas = document.createElement( 'canvas' );
            s.task && s.task.cancel && s.task.cancel();
            const vp = page.getViewport( { scale: 1 } );
            s.el.style.aspectRatio = `${ vp.width } / ${ vp.height }`;
            s.task = await drawPage( page, canvas, width );
            if ( s.drawnAt === width && ! closed ) s.el.replaceChildren( canvas );
        } catch ( err ) {
            if ( err && err.name !== 'RenderingCancelledException' ) s.drawnAt = 0;
        }
    };

    const visible = new Set();
    observer = new IntersectionObserver( entries => {
        for ( const e of entries ) {
            const s = slots[ +e.target.dataset.page - 1 ];
            if ( e.isIntersecting ) { visible.add( s ); draw( s ); } else visible.delete( s );
        }
    }, { root: pagesEl, rootMargin: '600px 0px' } );
    slots.forEach( s => { s.el.style.width = fitWidth() + 'px'; observer.observe( s.el ); } );

    const updatePage = () => {
        const mid = pagesEl.scrollTop + pagesEl.clientHeight / 3;
        let n = 1;
        for ( const s of slots ) { if ( s.el.offsetTop <= mid ) n = +s.el.dataset.page; else break; }
        current = n;
        pageLbl.textContent = `Page ${ n } of ${ doc.numPages }`;
    };
    pagesEl.addEventListener( 'scroll', updatePage, { passive: true } );
    updatePage();

    const goTo = n => {
        n = Math.max( 1, Math.min( doc.numPages, n ) );
        slots[ n - 1 ].el.scrollIntoView( { block: 'start' } );
    };
    el.querySelector( '[data-prev]' ).addEventListener( 'click', () => goTo( current - 1 ) );
    el.querySelector( '[data-next]' ).addEventListener( 'click', () => goTo( current + 1 ) );

    const setZoom = z => {
        const keep = current;
        zoom = Math.max( 0.5, Math.min( 4, z ) );
        zoomLbl.textContent = Math.round( zoom * 100 ) + '%';
        const w = Math.round( fitWidth() * zoom ) + 'px';
        slots.forEach( s => { s.el.style.width = w; } );
        goTo( keep );
        visible.forEach( draw );
    };
    el.querySelector( '[data-in]' ).addEventListener( 'click', () => setZoom( zoom * 1.25 ) );
    el.querySelector( '[data-out]' ).addEventListener( 'click', () => setZoom( zoom / 1.25 ) );
    zoomLbl.addEventListener( 'click', () => setZoom( 1 ) );
    let resizeT;
    onResize = () => { clearTimeout( resizeT ); resizeT = setTimeout( () => ! closed && setZoom( zoom ), 200 ); };
    window.addEventListener( 'resize', onResize );
}
