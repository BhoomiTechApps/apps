/**
 * Reports: a printable map (print or "Save as PDF" from the browser) and
 * spreadsheet / GIS exports of all places.
 */
import { createBasemap } from './basemap.js';

const esc = s => String( s ?? '' ).replace( /[&<>"']/g, c => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } )[ c ] );
const $ = ( sel, root = document ) => root.querySelector( sel );
const iso = d => ( d || '' ).slice( 0, 10 );
const isoTime = d => ( d || '' ).slice( 0, 16 ).replace( 'T', ' ' );

/**
 * @param ctx { map, layers, getIndex(), getSettings(), types, download(blob, name), toast, openSheet, closeSheet, fmtDate }
 */
export function createReports( ctx ) {
    const sorted = list => [ ...list ].sort( ( a, b ) => a.created.localeCompare( b.created ) );
    const stamp = () => new Date().toISOString().slice( 0, 10 );
    const baseName = () => {
        const idx = ctx.getIndex();
        const t = ( idx.pack && idx.pack.title ) || 'media-map';
        return t.normalize( 'NFC' ).replace( /[^\p{L}\p{M}\p{N}]+/gu, '-' ).replace( /^-|-$/g, '' ).slice( 0, 60 ) || 'media-map';
    };

    /* ------------------------------------------------------------------ */
    /* CSV (opens in Excel, Google Sheets, LibreOffice)                    */
    /* ------------------------------------------------------------------ */
    function rowsFor( entries ) {
        return sorted( entries ).map( ( e, i ) => ( {
            number: i + 1,
            place: e.place,
            latitude: e.lat,
            longitude: e.lng,
            kind: ( ctx.types[ e.type ] || ctx.types.text ).label,
            added: isoTime( e.created ),
            updated: isoTime( e.updated ),
            added_by: e.author,
            description: e.description,
            link: e.url,
            file: e.file ? e.file.path : '',
            notes_count: e.notes.length,
            notes: e.notes.map( n => `${ isoTime( n.created ) }: ${ n.text }` ).join( '\n' ),
            attachments_count: e.attachments.length,
            attachments: e.attachments.map( a => a.path ).join( '\n' ),
            forms: [ ...new Set( e.attachments.filter( a => a.form ).map( a => a.form.name ) ) ].join( '; ' ),
            id: e.id,
        } ) );
    }

    function csvCell( v ) {
        if ( typeof v === 'number' ) return String( v );
        let s = String( v ?? '' );
        // Stop spreadsheet apps treating text as a formula.
        if ( /^[=+\-@\t\r]/.test( s ) ) s = "'" + s;
        return /[",\r\n]/.test( s ) ? `"${ s.replace( /"/g, '""' ) }"` : s;
    }

    function exportCSV() {
        const entries = ctx.getIndex().entries;
        if ( ! entries.length ) { ctx.toast( 'There are no places to export yet.' ); return; }
        const rows = rowsFor( entries );
        const cols = Object.keys( rows[ 0 ] );
        const text = '\ufeff' + [ cols.join( ',' ), ...rows.map( r => cols.map( c => csvCell( r[ c ] ) ).join( ',' ) ) ].join( '\r\n' ) + '\r\n';
        ctx.download( new Blob( [ text ], { type: 'text/csv;charset=utf-8' } ), `${ baseName() }-places-${ stamp() }.csv` );
        ctx.toast( `Exported ${ rows.length } places as a spreadsheet (CSV).` );
    }

    function exportGeoJSON() {
        const entries = ctx.getIndex().entries;
        if ( ! entries.length ) { ctx.toast( 'There are no places to export yet.' ); return; }
        const fc = {
            type: 'FeatureCollection',
            name: baseName() + '-places',
            features: sorted( entries ).map( ( e, i ) => ( {
                type: 'Feature',
                id: e.id,
                geometry: { type: 'Point', coordinates: [ e.lng, e.lat ] },
                properties: {
                    number: i + 1,
                    place: e.place,
                    kind: ( ctx.types[ e.type ] || ctx.types.text ).label,
                    added: e.created,
                    updated: e.updated,
                    added_by: e.author,
                    description: e.description,
                    link: e.url,
                    file: e.file ? e.file.path : '',
                    notes: e.notes.map( n => ( { date: n.created, text: n.text } ) ),
                    attachments: e.attachments.map( a => a.path ),
                },
            } ) ),
        };
        ctx.download( new Blob( [ JSON.stringify( fc, null, 1 ) ], { type: 'application/geo+json' } ), `${ baseName() }-places-${ stamp() }.geojson` );
        ctx.toast( `Exported ${ fc.features.length } places as GeoJSON.` );
    }

    /* ------------------------------------------------------------------ */
    /* Printable map                                                       */
    /* ------------------------------------------------------------------ */
    function showPrint( backTo ) {
        const idx = ctx.getIndex();
        const st = ctx.getSettings();
        const hasLayers = ( idx.layers || [] ).some( l => l.visible );
        const body = ctx.openSheet( 'print', 'Print or save as PDF', `
            <p class="muted">Makes an A4 landscape page with the map and a key, followed by a numbered list of the places. Choose <strong>Save as PDF</strong> in the print window to keep a file.</p>
            <label class="lbl">Title<input type="text" class="field" data-title maxlength="120" value="${ esc( ( idx.pack && idx.pack.title ) || 'Media Map' ) }"></label>
            <label class="lbl">Prepared by<input type="text" class="field" data-by maxlength="120" value="${ esc( st.author || '' ) }"></label>
            <fieldset class="opts">
                <legend>Places to include</legend>
                <label class="check"><input type="radio" name="p-area" value="all" checked> All places (${ idx.entries.length })</label>
                <label class="check"><input type="radio" name="p-area" value="view"> Only places in the part of the map on screen now</label>
            </fieldset>
            <fieldset class="opts">
                <legend>In the list</legend>
                <label class="check"><input type="checkbox" data-desc checked> Descriptions</label>
                <label class="check"><input type="checkbox" data-notes checked> Notes</label>
                <label class="check"><input type="checkbox" data-att checked> Attachment and form file names</label>
                <label class="check"><input type="checkbox" data-coords checked> Coordinates</label>
                ${ hasLayers ? '<label class="check"><input type="checkbox" data-layers checked> Show map layers on the map</label>' : '' }
            </fieldset>
            <p class="muted small">Map areas you haven’t viewed before need an internet connection to print.</p>
            <div class="actions wrap">
                <button type="button" class="btn btn-primary" data-print>Print</button>
            </div>`, { backTo } );
        if ( ! body ) return;
        $( '[data-print]', body ).addEventListener( 'click', async e => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = 'Preparing…';
            try {
                await print( {
                    title: $( '[data-title]', body ).value.trim() || 'Media Map',
                    by: $( '[data-by]', body ).value.trim(),
                    area: $( 'input[name="p-area"]:checked', body ).value,
                    desc: $( '[data-desc]', body ).checked,
                    notes: $( '[data-notes]', body ).checked,
                    att: $( '[data-att]', body ).checked,
                    coords: $( '[data-coords]', body ).checked,
                    layers: !! ( $( '[data-layers]', body ) && $( '[data-layers]', body ).checked ),
                } );
            } catch ( err ) {
                ctx.toast( 'Could not prepare the page: ' + err.message, { long: true } );
            } finally {
                btn.disabled = false;
                btn.textContent = 'Print';
            }
        } );
    }

    async function print( o ) {
        const idx = ctx.getIndex();
        const st = ctx.getSettings();
        const viewBounds = ctx.map.getBounds();
        let entries = sorted( idx.entries );
        if ( o.area === 'view' ) entries = entries.filter( e => viewBounds.contains( [ e.lat, e.lng ] ) );

        document.getElementById( 'print-root' )?.remove();
        const root = document.createElement( 'div' );
        root.id = 'print-root';
        root.setAttribute( 'aria-hidden', 'true' );
        const typesUsed = [ ...new Set( entries.map( e => e.type ) ) ];
        const date = new Date().toLocaleDateString( undefined, { day: 'numeric', month: 'long', year: 'numeric' } );
        root.innerHTML = `
            <section class="p-page">
                <header class="p-head">
                    <h1>${ esc( o.title ) }</h1>
                    <p>${ o.by ? `Prepared by ${ esc( o.by ) }, ` : '' }${ esc( date ) }. ${ entries.length } ${ entries.length === 1 ? 'place' : 'places' }.</p>
                </header>
                <div class="p-body">
                    <div class="p-map" id="print-map"></div>
                    <aside class="p-key">
                        <h2>Key</h2>
                        <ul class="p-types">${ typesUsed.map( t => `<li><span class="p-dot" style="background:${ ( ctx.types[ t ] || ctx.types.text ).color }"></span>${ esc( ( ctx.types[ t ] || ctx.types.text ).label ) }</li>` ).join( '' ) }</ul>
                        <div data-layer-key></div>
                        <p class="p-note">Numbers on the map match the list of places.</p>
                    </aside>
                </div>
            </section>
            ${ entries.length ? `
            <section class="p-list">
                <h2>Places</h2>
                <table>
                    <thead><tr><th>No.</th><th>Place</th>${ o.coords ? '<th>Coordinates</th>' : '' }<th>Details</th></tr></thead>
                    <tbody>${ entries.map( ( e, i ) => {
                        const t = ctx.types[ e.type ] || ctx.types.text;
                        const bits = [];
                        if ( o.desc && e.description ) bits.push( `<p class="p-desc">${ esc( e.description.length > 1200 ? e.description.slice( 0, 1200 ) + '…' : e.description ) }</p>` );
                        if ( e.url ) bits.push( `<p class="p-small">Link: ${ esc( e.url ) }</p>` );
                        if ( o.notes && e.notes.length ) bits.push( `<ul class="p-notes">${ e.notes.map( n => `<li><strong>${ esc( ctx.fmtDate( n.created ) ) }:</strong> ${ esc( n.text ) }</li>` ).join( '' ) }</ul>` );
                        if ( o.att && ( e.attachments.length || e.file ) ) {
                            const names = [ e.file && e.file.path, ...e.attachments.map( a => a.path + ( a.form ? ` (form “${ a.form.name }”)` : '' ) ) ].filter( Boolean );
                            bits.push( `<p class="p-small">Files: ${ names.map( esc ).join( '; ' ) }</p>` );
                        }
                        return `<tr>
                            <td><span class="p-num" style="background:${ t.color }">${ i + 1 }</span></td>
                            <td><strong>${ esc( e.place || 'Untitled place' ) }</strong><br><span class="p-small">${ esc( t.label ) }, ${ esc( ctx.fmtDate( e.created ) ) }${ e.author ? `, ${ esc( e.author ) }` : '' }</span></td>
                            ${ o.coords ? `<td class="p-coords">${ e.lat.toFixed( 5 ) },<br>${ e.lng.toFixed( 5 ) }</td>` : '' }
                            <td>${ bits.join( '' ) || '<span class="p-small">—</span>' }</td>
                        </tr>`;
                    } ).join( '' ) }</tbody>
                </table>
            </section>` : '' }`;
        document.body.append( root );

        const pm = L.map( 'print-map', {
            zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false,
            doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false,
            zoomSnap: 0.25, fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false,
        } );
        pm.attributionControl.setPrefix( false );
        const tiles = createBasemap( st.tileUrl, { maxZoom: st.maxZoom, attribution: st.attribution, crossOrigin: 'anonymous' } );

        const bounds = L.latLngBounds( entries.map( e => [ e.lat, e.lng ] ) );
        let tidyLabels = null;
        if ( o.layers ) {
            const { bounds: lb, legend, tidy } = ctx.layers.addToMap( pm );
            tidyLabels = tidy;
            if ( o.area === 'all' && lb.isValid() ) bounds.extend( lb );
            if ( legend ) $( '[data-layer-key]', root ).innerHTML = `<h3>Layers</h3><ul class="legend-print">${ legend }</ul>`;
        }
        entries.forEach( ( e, i ) => {
            const t = ctx.types[ e.type ] || ctx.types.text;
            L.marker( [ e.lat, e.lng ], {
                interactive: false, keyboard: false,
                icon: L.divIcon( { className: 'p-pin', html: `<span class="p-num" style="background:${ t.color }">${ i + 1 }</span>`, iconSize: [ 24, 24 ], iconAnchor: [ 12, 12 ] } ),
            } ).addTo( pm );
        } );

        if ( o.area === 'view' ) pm.fitBounds( viewBounds );
        else if ( bounds.isValid() ) pm.fitBounds( bounds.pad( 0.08 ), { maxZoom: 17 } );
        else pm.fitBounds( viewBounds );

        await new Promise( resolve => {
            const t = setTimeout( resolve, 12000 );
            tiles.once( 'load', () => { clearTimeout( t ); setTimeout( resolve, 300 ); } );
            tiles.addTo( pm );
        } );
        if ( tidyLabels ) tidyLabels();

        const cleanup = () => {
            window.removeEventListener( 'afterprint', cleanup );
            setTimeout( () => { pm.remove(); root.remove(); }, 500 );
        };
        window.addEventListener( 'afterprint', cleanup );
        window.print();
        // Some mobile browsers don't fire afterprint; tidy up later anyway.
        setTimeout( () => { if ( document.body.contains( root ) ) cleanup(); }, 120000 );
    }

    return { exportCSV, exportGeoJSON, showPrint, rowsFor };
}
