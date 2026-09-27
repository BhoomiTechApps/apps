/**
 * Save the map for an area ahead of fieldwork, so it works with no signal.
 * Tiles go into their own cache ("mm-tiles-saved") which the service worker
 * reads from but never trims, unlike the automatic cache of viewed tiles.
 */
export const SAVED_CACHE = 'mm-tiles-saved';
const AREAS_KEY = 'mediamap_saved_areas';
const $ = ( sel, root = document ) => root.querySelector( sel );

// OpenStreetMap's volunteer-run tile servers forbid bulk downloading, so
// only small areas may be saved from them, slowly.
const LIMITS = {
    osm:   { maxTiles: 300,   concurrency: 2, delay: 150 },
    other: { maxTiles: 20000, concurrency: 6, delay: 0 },
};
const AVG_TILE_KB = 18;

const DETAIL = z => z <= 9 ? 'region' : z <= 11 ? 'district' : z <= 13 ? 'town' : z <= 15 ? 'neighbourhood' : z <= 17 ? 'streets and buildings' : 'finest detail';

function lon2x( lng, z ) {
    const n = 2 ** z;
    return Math.min( n - 1, Math.max( 0, Math.floor( ( lng + 180 ) / 360 * n ) ) );
}
function lat2y( lat, z ) {
    const n = 2 ** z;
    const r = Math.max( -85.0511, Math.min( 85.0511, lat ) ) * Math.PI / 180;
    return Math.min( n - 1, Math.max( 0, Math.floor( ( 1 - Math.log( Math.tan( r ) + 1 / Math.cos( r ) ) / Math.PI ) / 2 * n ) ) );
}
function ranges( b, zMin, zMax ) {
    const west = Math.max( -180, b.getWest() ), east = Math.min( 180, b.getEast() );
    const out = [];
    for ( let z = zMin; z <= zMax; z++ ) {
        out.push( { z, x0: lon2x( west, z ), x1: lon2x( east, z ), y0: lat2y( b.getNorth(), z ), y1: lat2y( b.getSouth(), z ) } );
    }
    return out;
}
export function countTiles( b, zMin, zMax ) {
    return ranges( b, zMin, zMax ).reduce( ( n, r ) => n + ( r.x1 - r.x0 + 1 ) * ( r.y1 - r.y0 + 1 ), 0 );
}
/** Same URL Leaflet builds for a tile, so cached tiles are found again. */
function tileUrl( tpl, z, x, y ) {
    const subs = 'abc';
    return tpl.replace( '{s}', subs[ Math.abs( x + y ) % subs.length ] )
        .replace( '{z}', z ).replace( '{x}', x ).replace( '{y}', y ).replace( '{r}', '' );
}
const isOsm = tpl => { try { return /(^|\.)tile\.openstreetmap\.org$/i.test( new URL( tpl.replace( /\{[^}]+\}/g, 'a' ) ).hostname ); } catch { return false; } };

function loadAreas() { try { return JSON.parse( localStorage.getItem( AREAS_KEY ) || '[]' ); } catch { return []; } }
function saveAreas( a ) { try { localStorage.setItem( AREAS_KEY, JSON.stringify( a ) ); } catch {} }

/** @param ctx { map, getSettings(), toast, confirm } */
export function createOffline( ctx ) {
    let running = null;

    function renderSettings( box ) {
        const st = ctx.getSettings();
        const osm = isOsm( st.tileUrl );
        const lim = osm ? LIMITS.osm : LIMITS.other;
        const b = ctx.map.getBounds();
        const z0 = Math.max( 0, Math.floor( ctx.map.getZoom() ) );
        const zMin = Math.max( 0, z0 - 2 );
        const zTop = Math.min( st.maxZoom, z0 + 6 );
        const options = [];
        for ( let z = z0; z <= zTop; z++ ) {
            const n = countTiles( b, zMin, z );
            options.push( { z, n, ok: n <= lim.maxTiles } );
        }
        const firstOk = options.filter( o => o.ok ).pop();
        const areas = loadAreas();
        const saved = areas.reduce( ( n, a ) => n + a.tiles, 0 );

        box.innerHTML = `
            <h4>Save an area before fieldwork</h4>
            <p>Saves the map for the area shown on screen now, so it works with no signal. Zoom the map to your study area first.</p>
            ${ options.length ? `
            <label class="lbl">Detail
                <select class="field" data-zmax>${ options.map( o =>
                    `<option value="${ o.z }"${ o.ok ? '' : ' disabled' }${ firstOk && firstOk.z === o.z ? ' selected' : '' }>Zoom ${ o.z }, ${ DETAIL( o.z ) }: ${ o.n.toLocaleString() } tiles, about ${ Math.max( 1, Math.round( o.n * AVG_TILE_KB / 1024 ) ) } MB${ o.ok ? '' : ' (too large)' }</option>` ).join( '' ) }
                </select>
            </label>` : '' }
            ${ osm ? `<p class="hint">The free OpenStreetMap map allows saving up to ${ LIMITS.osm.maxTiles } tiles at a time, downloaded slowly, to respect its usage policy. For bigger areas, zoom in further or set up your own tile server under Map.</p>` : '' }
            ${ firstOk ? '' : '<p class="notice">The area on screen is too large at this zoom. Zoom in on your study area and try again.</p>' }
            <div class="actions wrap">
                <button type="button" class="btn btn-primary" data-save-area ${ firstOk ? '' : 'disabled' }>Save this area</button>
                <button type="button" class="btn" data-stop hidden>Stop</button>
            </div>
            <div class="area-progress" data-progress hidden><progress max="100" value="0"></progress><span data-progress-text></span></div>
            <p class="muted small" data-saved>${ areas.length ? `${ areas.length } ${ areas.length === 1 ? 'area' : 'areas' } saved, ${ saved.toLocaleString() } tiles.` : 'No areas saved yet.' }
                ${ areas.length ? '<button type="button" class="btn-link danger" data-delete-areas>Delete saved areas</button>' : '' }</p>`;

        $( '[data-save-area]', box )?.addEventListener( 'click', () => start( box, b, zMin, Number( $( '[data-zmax]', box ).value ) ) );
        $( '[data-stop]', box ).addEventListener( 'click', () => { if ( running ) running.abort(); } );
        $( '[data-delete-areas]', box )?.addEventListener( 'click', async () => {
            if ( ! ctx.confirm( 'Delete all saved map areas? The map will then need a connection in those places again.' ) ) return;
            await caches.delete( SAVED_CACHE ).catch( () => {} );
            saveAreas( [] );
            ctx.toast( 'Saved map areas deleted.' );
            renderSettings( box );
        } );
    }

    async function start( box, bounds, zMin, zMax ) {
        if ( running ) return;
        if ( ! navigator.onLine ) { ctx.toast( 'Saving an area needs an internet connection.' ); return; }
        const st = ctx.getSettings();
        const osm = isOsm( st.tileUrl );
        const lim = osm ? LIMITS.osm : LIMITS.other;
        const list = [];
        for ( const r of ranges( bounds, zMin, zMax ) ) {
            for ( let x = r.x0; x <= r.x1; x++ ) for ( let y = r.y0; y <= r.y1; y++ ) list.push( tileUrl( st.tileUrl, r.z, x, y ) );
        }
        if ( list.length > lim.maxTiles ) { ctx.toast( 'That area is too large. Zoom in and try again.' ); return; }
        if ( navigator.storage && navigator.storage.persist ) navigator.storage.persist().catch( () => {} );

        const ctrl = running = new AbortController();
        const btn = $( '[data-save-area]', box ), stop = $( '[data-stop]', box );
        const prog = $( '[data-progress]', box ), bar = $( 'progress', prog ), txt = $( '[data-progress-text]', prog );
        btn.disabled = true; stop.hidden = false; prog.hidden = false;
        const cache = await caches.open( SAVED_CACHE );
        let i = 0, done = 0, failed = 0;
        const show = () => { bar.value = Math.round( done / list.length * 100 ); txt.textContent = `${ done.toLocaleString() } of ${ list.length.toLocaleString() } tiles`; };
        const worker = async () => {
            while ( i < list.length && ! ctrl.signal.aborted ) {
                const url = list[ i++ ];
                try {
                    const have = await caches.match( url, { ignoreVary: true } );
                    if ( have && have.type !== 'opaque' ) {
                        await cache.put( url, have.clone() );
                    } else {
                        const res = await fetch( url, { mode: 'cors', credentials: 'omit', signal: ctrl.signal } );
                        if ( res.ok && res.type === 'cors' ) await cache.put( url, res );
                        else failed++;
                        if ( lim.delay ) await new Promise( r => setTimeout( r, lim.delay ) );
                    }
                } catch ( err ) {
                    if ( err.name !== 'AbortError' ) failed++;
                }
                done++;
                if ( done % 5 === 0 || done === list.length ) show();
            }
        };
        show();
        await Promise.all( Array.from( { length: lim.concurrency }, worker ) );
        running = null;
        const ok = done - failed;
        if ( ok > 0 ) {
            const areas = loadAreas();
            areas.push( { bounds: [ [ bounds.getSouth(), bounds.getWest() ], [ bounds.getNorth(), bounds.getEast() ] ], zMin, zMax, tiles: ok, date: new Date().toISOString() } );
            saveAreas( areas );
        }
        if ( ctrl.signal.aborted ) ctx.toast( `Stopped. ${ ok.toLocaleString() } tiles were saved.` );
        else if ( failed && ! ok ) ctx.toast( 'The map tiles couldn’t be downloaded. This tile server may not allow saving for offline use.', { long: true } );
        else ctx.toast( `Area saved: ${ ok.toLocaleString() } tiles${ failed ? `, ${ failed } couldn’t be downloaded` : '' }. It will show without a connection.`, { long: true } );
        if ( document.body.contains( box ) ) renderSettings( box );
    }

    return { renderSettings, isBusy: () => !! running };
}
