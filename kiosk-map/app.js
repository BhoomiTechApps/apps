// =============================================================================
// MediaMap PWA Overlay — Kiosk Edition
// Application script
// =============================================================================

// --- 1. DB PIPELINE MANAGEMENT DRIVER ---
const DB_NAME = 'MapDataPWA';
const DB_VERSION = 2; // v2 adds the 'settings' store (idle timer, bounds lock)
const STORE_NAME = 'layers';
const SETTINGS_STORE_NAME = 'settings';
const SETTINGS_KEY = 'kiosk'; // single row holding all kiosk-wide settings

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'groupName' });
            }
            if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
                db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

// Defaults used until the admin changes them via Map & Kiosk Settings.
const DEFAULT_KIOSK_SETTINGS = {
    idleTimeSeconds: 90,
    lockBoundsToData: false
};

async function getKioskSettings() {
    const db = await initDB();
    const record = await new Promise((resolve, reject) => {
        const transaction = db.transaction(SETTINGS_STORE_NAME, 'readonly');
        const store = transaction.objectStore(SETTINGS_STORE_NAME);
        const request = store.get(SETTINGS_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return Object.assign({}, DEFAULT_KIOSK_SETTINGS, record || {});
}

async function saveKioskSettings(settings) {
    const current = await getKioskSettings();
    const merged = Object.assign({}, current, settings, { id: SETTINGS_KEY });
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(SETTINGS_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(SETTINGS_STORE_NAME);
        store.put(merged);
        transaction.oncomplete = () => resolve(merged);
        transaction.onerror = () => reject(transaction.error);
    });
}

// Default styling applied to a layer's polylines/polygons until the
// user customises it via the per-layer "Style" modal.
const DEFAULT_SHAPE_STYLE = {
    fillColor: '#4f46e5',
    fillOpacity: 0.35,
    lineColor: '#4f46e5',
    lineWeight: 3,
    label: '',
    labelColor: '#1e293b',
    labelSize: 14
};

async function saveLayer(groupName, points, shapes = []) {
    const existing = await getAllLayers();
    const maxOrder = existing.reduce((max, l) => Math.max(max, typeof l.order === 'number' ? l.order : 0), -1);
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        // New layers are placed on top (highest order = drawn last = on top).
        store.put({
            groupName,
            data: points,
            shapes,
            shapeStyle: { ...DEFAULT_SHAPE_STYLE },
            active: true,
            order: maxOrder + 1
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

async function getAllLayers() {
    const db = await initDB();
    const layers = await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    // Backfill: layers saved before layer-ordering / shape-styling
    // existed are missing those fields. Fill them in based on sensible
    // defaults so ordering and styling are well-defined from the very
    // first read, without needing a DB version bump or migration step.
    let needsBackfill = false;
    layers.forEach((layer, i) => {
        if (typeof layer.order !== 'number') {
            layer.order = i;
            needsBackfill = true;
        }
        if (!Array.isArray(layer.shapes)) {
            layer.shapes = [];
            needsBackfill = true;
        }
        if (!layer.shapeStyle || typeof layer.shapeStyle !== 'object') {
            layer.shapeStyle = { ...DEFAULT_SHAPE_STYLE };
            needsBackfill = true;
        }
    });
    if (needsBackfill) {
        await Promise.all(layers.map(layer => persistLayerFields(layer.groupName, {
            order: layer.order,
            shapes: layer.shapes,
            shapeStyle: layer.shapeStyle
        })));
    }

    layers.sort((a, b) => a.order - b.order);
    return layers;
}

/** Persist one or more fields on a single layer record (merge, not replace). */
async function persistLayerFields(groupName, fields) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(groupName);
        request.onsuccess = () => {
            const record = request.result;
            if (record) {
                Object.assign(record, fields);
                store.put(record);
            }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

/** Persist just the `order` field for one layer record (used for backfill and reordering). */
async function persistLayerOrder(groupName, order) {
    return persistLayerFields(groupName, { order });
}

/** Persist the shape style object for one layer record (used by the styling modal). */
async function persistLayerShapeStyle(groupName, shapeStyle) {
    return persistLayerFields(groupName, { shapeStyle });
}

/**
 * Swap the order of two layers (used by the move up/down buttons). Reads
 * the current order values fresh rather than trusting stale UI state, so
 * rapid clicks can't desync the stored order from what's on screen.
 */
async function swapLayerOrder(groupNameA, groupNameB) {
    const layers = await getAllLayers();
    const a = layers.find(l => l.groupName === groupNameA);
    const b = layers.find(l => l.groupName === groupNameB);
    if (!a || !b) return;
    await Promise.all([
        persistLayerOrder(a.groupName, b.order),
        persistLayerOrder(b.groupName, a.order)
    ]);
}

async function updateLayerStatus(groupName, active) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(groupName);
        request.onsuccess = () => {
            const record = request.result;
            if (record) {
                record.active = active;
                store.put(record);
            }
        };
        transaction.oncomplete = () => resolve();
    });
}

async function flushDB() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.clear();
        transaction.oncomplete = () => resolve();
    });
}

/** Delete a single layer record by its groupName (used by the per-layer delete button). */
async function deleteLayer(groupName) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.delete(groupName);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

/**
 * Rename a layer. groupName is the object store's keyPath, so a record
 * can't be renamed in place — this reads the full existing record,
 * writes it back under the new key (preserving every other field:
 * data, shapes, shapeStyle, active, order), then deletes the old key.
 * Returns false without making any change if the new name is empty,
 * unchanged, or already used by another layer.
 */
async function renameLayer(oldGroupName, newGroupName) {
    const trimmed = (newGroupName || '').trim();
    if (!trimmed || trimmed === oldGroupName) return false;

    const layers = await getAllLayers();
    const existing = layers.find(l => l.groupName === oldGroupName);
    if (!existing) return false;
    if (layers.some(l => l.groupName === trimmed)) return false; // name clash

    const renamed = { ...existing, groupName: trimmed };
    const db = await initDB();
    await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(renamed);
        store.delete(oldGroupName);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
    return true;
}

/**
 * Backup format: a single JSON document containing every layer record
 * and the kiosk settings, versioned so a future schema change can detect
 * and handle older backup files gracefully instead of guessing.
 */
const BACKUP_FORMAT_VERSION = 1;

async function buildBackupPayload() {
    const layers = await getAllLayers();
    const settings = await getKioskSettings();
    return {
        backupFormatVersion: BACKUP_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        layers,
        settings
    };
}

/**
 * Restore from a previously-downloaded backup payload. Replaces all
 * current layers and settings with the backup's contents (this is a
 * full restore, not a merge) — the caller is expected to confirm with
 * the admin before calling this, since it's destructive to whatever is
 * currently loaded.
 *
 * Validates the overall shape before touching the database, so a
 * malformed or unrelated JSON file fails loudly with a clear error
 * rather than partially overwriting existing data.
 */
async function restoreFromBackupPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Backup file is not a valid JSON object.');
    }
    if (!Array.isArray(payload.layers)) {
        throw new Error('Backup file is missing its "layers" array.');
    }
    const invalidLayer = payload.layers.find(l => !l || typeof l.groupName !== 'string' || !l.groupName.trim());
    if (invalidLayer) {
        throw new Error('Backup file contains a layer with no valid name.');
    }

    await flushDB();
    const db = await initDB();
    await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        payload.layers.forEach(layer => {
            store.put({
                groupName: layer.groupName,
                data: Array.isArray(layer.data) ? layer.data : [],
                shapes: Array.isArray(layer.shapes) ? layer.shapes : [],
                shapeStyle: layer.shapeStyle && typeof layer.shapeStyle === 'object' ? layer.shapeStyle : { ...DEFAULT_SHAPE_STYLE },
                active: !!layer.active,
                order: typeof layer.order === 'number' ? layer.order : 0
            });
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });

    if (payload.settings && typeof payload.settings === 'object') {
        await saveKioskSettings(payload.settings);
    }

    return payload.layers.length;
}

// --- 2. AUTOMATIC NORMALIZATION MODULE ---
const DataNormalizationModule = {
    /**
     * Accepts any of:
     *   - a plain array of submission objects (the MediaMap plugin export)
     *   - { data: [...] }
     *   - a GeoJSON FeatureCollection: { type: "FeatureCollection", features: [...] }
     *   - a single GeoJSON Feature: { type: "Feature", geometry: {...}, properties: {...} }
     *   - a bare GeoJSON geometry: { type: "Point"/"Polygon"/etc., coordinates: [...] }
     *
     * Returns { points, shapeFeatures }:
     *   points        — the existing flat marker-item shape (lat/lng/place_name/media_type/...)
     *   shapeFeatures — raw GeoJSON Features with LineString/Polygon/MultiLineString/
     *                   MultiPolygon geometry, kept in GeoJSON form (untouched) so
     *                   Leaflet's L.geoJSON() can render them directly. Point/
     *                   MultiPoint geometries become `points` instead, never shapes.
     */
    process(rawInput) {
        let pointSources = [];
        let shapeFeatures = [];

        if (Array.isArray(rawInput)) {
            pointSources = rawInput;
        } else if (this.isGeoJSON(rawInput)) {
            const split = this.flattenGeoJSON(rawInput);
            pointSources = split.points;
            shapeFeatures = split.shapes;
        } else if (rawInput.data && Array.isArray(rawInput.data)) {
            pointSources = rawInput.data;
        } else if (Array.isArray(rawInput.features)) {
            // Untyped { features: [...] } wrapper (no formal "type":
            // "FeatureCollection" tag) — tolerate it the same way as a
            // real FeatureCollection for backward compatibility.
            const split = this.flattenGeoJSON({ type: 'FeatureCollection', features: rawInput.features });
            pointSources = split.points;
            shapeFeatures = split.shapes;
        }

        const points = pointSources.map(item => {
            const source = item.properties ? item.properties : item;

            let latVal = item.lat ?? source.lat;
            let lngVal = item.lng ?? source.lng;

            // Geometry already resolved to a flat lat/lng pair by
            // flattenGeoJSON() below, but also tolerate a raw Point
            // geometry slipping through directly (e.g. a single
            // bare-geometry GeoJSON object with no properties wrapper).
            if ((latVal === undefined || lngVal === undefined) && item.geometry && item.geometry.type === 'Point') {
                const coords = item.geometry.coordinates;
                if (Array.isArray(coords) && coords.length >= 2) {
                    lngVal = coords[0];
                    latVal = coords[1];
                }
            }

            return {
                id: source.id || Math.random().toString(36).substr(2, 9),
                lat: parseFloat(latVal),
                lng: parseFloat(lngVal),
                place_name: source.place_name || source.name || "Unknown Location",
                media_type: (source.media_type || this.detectMediaType(source.media_url)).toLowerCase(),
                media_url: source.media_url || "",
                description: source.description || source.desc || ""
            };
        }).filter(item => !isNaN(item.lat) && !isNaN(item.lng));

        return { points, shapeFeatures };
    },

    /** True for any of the GeoJSON shapes this module accepts. */
    isGeoJSON(rawInput) {
        if (!rawInput || typeof rawInput !== 'object') return false;
        const shapeTypes = ['FeatureCollection', 'Feature', 'Point', 'MultiPoint',
            'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'];
        return shapeTypes.includes(rawInput.type);
    },

    /**
     * Split a GeoJSON document into point pseudo-items (same handling as
     * before — Point/MultiPoint become markers) and shape features
     * (LineString/Polygon/MultiLineString/MultiPolygon, kept as raw
     * GeoJSON Features for Leaflet to render directly). A
     * GeometryCollection is unwrapped one level so its member geometries
     * each get routed the same way.
     */
    flattenGeoJSON(rawInput) {
        let features;
        if (rawInput.type === 'FeatureCollection') {
            features = Array.isArray(rawInput.features) ? rawInput.features : [];
        } else if (rawInput.type === 'Feature') {
            features = [rawInput];
        } else {
            // Bare geometry object (Point/Polygon/etc.) with no Feature wrapper.
            features = [{ type: 'Feature', geometry: rawInput, properties: {} }];
        }

        const points = [];
        const shapes = [];
        const SHAPE_GEOMETRY_TYPES = ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

        const handleGeometry = (geom, props) => {
            if (!geom) return;

            if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
                points.push({ geometry: geom, properties: props });
            } else if (geom.type === 'MultiPoint' && Array.isArray(geom.coordinates)) {
                // One marker per point in the multi-point set, sharing the
                // same properties (place name, media, etc.).
                geom.coordinates.forEach(coords => {
                    points.push({ geometry: { type: 'Point', coordinates: coords }, properties: props });
                });
            } else if (SHAPE_GEOMETRY_TYPES.includes(geom.type)) {
                shapes.push({ type: 'Feature', geometry: geom, properties: props });
            } else if (geom.type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
                geom.geometries.forEach(g => handleGeometry(g, props));
            }
        };

        features.forEach(feature => {
            handleGeometry(feature.geometry, feature.properties || {});
        });

        // Resolve points into a flat lat/lng so the main process() mapper
        // above can treat these exactly like plugin-exported rows.
        const resolvedPoints = points.map(item => ({
            ...item,
            lat: item.geometry.coordinates[1],
            lng: item.geometry.coordinates[0]
        }));

        return { points: resolvedPoints, shapes };
    },

    detectMediaType(url) {
        if (!url) return 'text';
        if (url.includes('youtube.com') || url.includes('youtu.be')) return 'video';
        if (url.match(/^https?:\/\/(www\.)?google\.com\/maps\/embed/)) return 'streetview';
        if (url.match(/\.(jpeg|jpg|gif|png|webp)$/i)) return 'image';
        if (url.match(/\.(mp3|wav|ogg)$/i)) return 'audio';
        if (url.match(/\.(mp4|webm)$/i)) return 'video';
        return 'text';
    }
};

// --- 3. MEDIA EMBED RESOLUTION MODULE ---
// Ported from the MediaMap WordPress plugin's frontend.js (getEmbedUrl) so
// the kiosk plays the same range of platforms the plugin's own info panel
// and lightbox already handle smoothly: YouTube, Vimeo, Dailymotion,
// Twitch, TikTok, Streamable, Loom, Spotify, SoundCloud, plus direct
// self-hosted media files. Anything not recognised here falls back to
// "open the original link" instead of silently failing to play.
const MediaEmbedModule = {
    /**
     * Resolve a playable embed/source URL for a given media type + URL.
     * Returns one of:
     *   { kind: 'iframe', src: <url> }   — platform player embed
     *   { kind: 'file',   src: <url> }   — direct, playable media file
     *   null                              — no safe embed available
     */
    resolve(type, url) {
        if (!url) return null;

        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }

        // YouTube
        const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
        if (yt) return { kind: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}?autoplay=1&rel=0` };

        // Vimeo
        const vm = url.match(/vimeo\.com\/(\d+)/);
        if (vm) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vm[1]}?autoplay=1` };

        // Dailymotion
        const dm = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
        if (dm) return { kind: 'iframe', src: `https://www.dailymotion.com/embed/video/${dm[1]}?autoplay=1` };

        // Twitch — clips, VODs, and live channels each use a different
        // embed path, and each requires a "parent" param naming this
        // site's domain or Twitch will refuse to render the iframe.
        const parent = encodeURIComponent(window.location.hostname || 'localhost');
        const twClip = url.match(/(?:clips\.twitch\.tv\/|twitch\.tv\/[^/]+\/clip\/)([A-Za-z0-9_-]+)/);
        if (twClip) return { kind: 'iframe', src: `https://clips.twitch.tv/embed?clip=${twClip[1]}&parent=${parent}` };
        const twVod = url.match(/twitch\.tv\/videos\/(\d+)/);
        if (twVod) return { kind: 'iframe', src: `https://player.twitch.tv/?video=${twVod[1]}&parent=${parent}&autoplay=true` };
        const twChannel = url.match(/twitch\.tv\/([A-Za-z0-9_]+)\/?(?:$|\?)/);
        if (twChannel && host === 'twitch.tv') return { kind: 'iframe', src: `https://player.twitch.tv/?channel=${twChannel[1]}&parent=${parent}&autoplay=true` };

        // TikTok — the numeric post id maps directly to a static player URL.
        const tt = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
        if (tt) return { kind: 'iframe', src: `https://www.tiktok.com/player/v1/${tt[1]}` };

        // Streamable
        const sm = url.match(/streamable\.com\/([A-Za-z0-9]+)/);
        if (sm && !/^(e|o|s)$/.test(sm[1])) return { kind: 'iframe', src: `https://streamable.com/e/${sm[1]}?autoplay=1` };

        // Loom
        const lm = url.match(/loom\.com\/share\/([A-Za-z0-9]+)/);
        if (lm) return { kind: 'iframe', src: `https://www.loom.com/embed/${lm[1]}` };

        // Spotify
        const sp = url.match(/open\.spotify\.com\/(track|episode|playlist|album|show)\/([A-Za-z0-9]+)/);
        if (sp) return { kind: 'iframe', src: `https://open.spotify.com/embed/${sp[1]}/${sp[2]}` };

        // SoundCloud
        if (host === 'soundcloud.com') {
            return { kind: 'iframe', src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&color=1abc9c` };
        }

        // Google Maps Street View — the bare src URL copied from Google
        // Maps' own Share > Embed a map dialog (host google.com or
        // www.google.com, path starting /maps/embed). This is Google's
        // own keyless, publicly-shareable embed format, used as-is
        // rather than re-derived from coordinates. Strictly validated
        // (host + path, not just a loose string match) so a malformed
        // or unrelated URL falls through to "open the original link"
        // instead of being trusted as a Street View embed.
        if (type === 'streetview') {
            let parsed;
            try { parsed = new URL(url); } catch (e) { return null; }
            const isGoogleHost = parsed.hostname === 'google.com' || parsed.hostname === 'www.google.com';
            if (isGoogleHost && parsed.pathname.startsWith('/maps/embed')) {
                return { kind: 'iframe', src: url };
            }
            return null;
        }

        // Direct, self-hosted media files (e.g. example.com/clip.mp4) are
        // not a platform "embed" but ARE a real, playable source for a
        // native <video>/<audio> tag.
        const cleanPath = url.split('?')[0].split('#')[0];
        const ext = cleanPath.split('.').pop().toLowerCase();
        if (type === 'video' && ['mp4', 'webm', 'ogv', 'mov'].includes(ext)) return { kind: 'file', src: url };
        if (type === 'audio' && ['mp3', 'wav', 'flac', 'aac', 'oga', 'm4a', 'opus', 'wma'].includes(ext)) return { kind: 'file', src: url };

        // Everything else (Twitter/X, Reddit, Instagram, Facebook,
        // Bandcamp, Rumble, Odysee, Wistia, Brightcove, etc.) needs an
        // oEmbed round-trip or platform JS embed snippet to resolve a
        // real embed URL — neither of which this kiosk calls out for.
        // Returning null lets the caller fall back to "open the
        // original link" instead of rendering a blank/erroring player.
        return null;
    }
};

// --- 4. MARKER ICON MODULE ---
// Hardcoded, self-contained SVG pins — one look per media type — so a
// kiosk visitor can tell at a glance, before tapping anything, whether a
// pin holds a video, an audio clip, an image, or a text note. No external
// icon font or network request is involved: each glyph is inline path
// data baked into this file, so markers always render correctly even if
// a kiosk machine has no internet access beyond the local map tiles.
const MarkerIconModule = {
    // One entry per media_type. `color` is the pin's fill, `glyph` is the
    // inline SVG path drawn in white inside the pin's head, `label` is a
    // short fallback word used in tooltips for anything left unmatched.
    TYPES: {
        video: {
            color: '#e11d48', // rose-600
            label: 'Video',
            // Camera/play glyph (16x16)
            glyph: '<path d="M1 3.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Zm9.5 2 4-2.2v9.4l-4-2.2v-5Z"/>'
        },
        audio: {
            color: '#7c3aed', // violet-600
            label: 'Audio',
            // Microphone glyph (16x16)
            glyph: '<path d="M8 1.5a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 8 1.5Zm-4.25 6.75a.75.75 0 0 1 .75.75 3.5 3.5 0 0 0 7 0 .75.75 0 0 1 1.5 0 5 5 0 0 1-4.25 4.94v1.31h1.25a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5h1.25v-1.31A5 5 0 0 1 3 9a.75.75 0 0 1 .75-.75Z"/>'
        },
        image: {
            color: '#d97706', // amber-600
            label: 'Image',
            // Photo/mountain glyph (16x16)
            glyph: '<path d="M2 2.5h12A1.5 1.5 0 0 1 15.5 4v8A1.5 1.5 0 0 1 14 13.5H2A1.5 1.5 0 0 1 .5 12V4A1.5 1.5 0 0 1 2 2.5Zm.5 9.5h11l-3.6-4.6a.5.5 0 0 0-.77-.03L6.8 10.2 5.06 8.32a.5.5 0 0 0-.74.02L2.5 11v1Zm3-6a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/>'
        },
        text: {
            color: '#475569', // slate-600
            label: 'Note',
            // Document/lines glyph (16x16)
            glyph: '<path d="M3.5 1.5h6l3 3v9a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm5.5.9V4.5a.5.5 0 0 0 .5.5h2.1l-2.6-2.6ZM5 8h6v1H5V8Zm0 2.5h6v1H5v-1ZM5 5.5h3v1H5v-1Z"/>'
        },
        streetview: {
            color: '#0891b2', // cyan-600
            label: 'Street View',
            // 360-degree panorama glyph: an ellipse (ground plane) with a
            // small pin/eye marker, evoking a panoramic ground-level view
            // distinct from the rectangular video/photo glyphs above.
            glyph: '<path d="M8 9.8c3.6 0 6.5-1 6.5-2.3S11.6 5.2 8 5.2 1.5 6.2 1.5 7.5 4.4 9.8 8 9.8Zm0-3.4c.9 0 1.6.5 1.6 1.1S8.9 7.6 8 7.6s-1.6-.5-1.6-1.1.7-1.1 1.6-1.1Zm0-5.1a2.6 2.6 0 0 0-2.6 2.6c0 1.9 2.6 4.9 2.6 4.9s2.6-3 2.6-4.9A2.6 2.6 0 0 0 8 1.3Zm0 3.6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/>'
        }
    },

    /**
     * Build a Leaflet divIcon for the given media type. Falls back to the
     * "text" pin for any type that isn't one of the four hardcoded above,
     * so an unrecognised/missing media_type still renders a sensible pin
     * instead of breaking marker creation.
     */
    build(type) {
        const def = this.TYPES[type] || this.TYPES.text;
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="32" height="42">
                <path d="M16 0C7.163 0 0 7.163 0 16c0 10 10 20 16 26 6-6 16-16 16-26C32 7.163 24.837 0 16 0z"
                      fill="${def.color}" stroke="rgba(15,23,42,0.35)" stroke-width="1.5"/>
                <g transform="translate(8,7)" fill="#ffffff">${def.glyph}</g>
            </svg>`;

        return L.divIcon({
            html: svg,
            className: `mediamap-marker-icon mediamap-marker-${type}`,
            iconSize: [32, 42],
            iconAnchor: [16, 42],
            popupAnchor: [0, -42]
        });
    },

    /** Human-readable label for tooltips/badges, e.g. "Video". */
    labelFor(type) {
        return (this.TYPES[type] || this.TYPES.text).label;
    }
};

// --- 5. CONTROLLERS AND INTERACTION ROUTINES ---
let map, mapLayers = {};

// Kiosk Core Timing Configurations
// KIOSK_IDLE_TIME is configurable from the Map & Kiosk Settings panel
// (persisted in the 'settings' store) — this default is only used until
// settings have loaded, or for a brand-new kiosk with no saved value yet.
let KIOSK_IDLE_TIME = DEFAULT_KIOSK_SETTINGS.idleTimeSeconds * 1000;
let remainingSeconds = KIOSK_IDLE_TIME / 1000;
let lastActivityTime = Date.now();
let countdownInterval = null;

/**
 * Apply a new idle timeout (in seconds) at runtime. Called once at boot
 * with the persisted setting, and again immediately whenever the admin
 * adjusts the slider, so a change takes effect without needing a reload.
 */
function setIdleTimeSeconds(seconds) {
    KIOSK_IDLE_TIME = Math.max(5, Math.round(seconds)) * 1000;
    // Re-baseline so the new timeout doesn't immediately fire (or read as
    // already-expired) for activity that happened under the old timeout.
    remainingSeconds = KIOSK_IDLE_TIME / 1000;
    updateCountdownUI();
}

function updateCountdownUI() {
    const display = document.getElementById('lightbox-countdown');
    if (display) {
        display.querySelector('span:not(.material-icons)').innerText = `Auto-closes in ${remainingSeconds}s`;
    }
}

// Fired globally across the window scope
function handleUserActivity() {
    lastActivityTime = Date.now();

    // Instantly restore seconds bounds on interface text nodes
    if (remainingSeconds < (KIOSK_IDLE_TIME / 1000)) {
        remainingSeconds = KIOSK_IDLE_TIME / 1000;
        updateCountdownUI();
    }
}

// Independent, steady heartbeat clock running once per second
function startKioskHeartbeat() {
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        const timeSinceLastActivity = Date.now() - lastActivityTime;

        // Calculate accurate remaining time
        const calculatedRemaining = Math.max(0, Math.ceil((KIOSK_IDLE_TIME - timeSinceLastActivity) / 1000));

        if (calculatedRemaining !== remainingSeconds) {
            remainingSeconds = calculatedRemaining;
            updateCountdownUI();
        }

        // If threshold exceeded, enforce standard system security lock down procedures
        if (timeSinceLastActivity >= KIOSK_IDLE_TIME) {
            closeLightbox();
            document.getElementById('admin-password').value = '';
            evaluateAccordionState();
            lastActivityTime = Date.now(); // Reset baseline to prevent looping calls
        }
    }, 1000);
}

function evaluateAccordionState() {
    const pwdInput = document.getElementById('admin-password').value;
    const accordion = document.getElementById('admin-accordion');

    if (pwdInput === "admin") {
        accordion.style.maxHeight = "900px";
    } else {
        accordion.style.maxHeight = "0px";
    }
}

// Default view used on first load before any data exists, and as the
// fallback when every layer is toggled off (so the map never has to
// guess a position once there's nothing to bound to).
const KIOSK_HOME_VIEW = { center: [26.1805, 91.7539], zoom: 8 };

function initMap() {
    map = L.map('map', { zoomControl: false, tap: false }).setView(KIOSK_HOME_VIEW.center, KIOSK_HOME_VIEW.zoom);
    L.control.zoom({ position: 'topright' }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(map);
}

function renderLayerOnMap(layer) {
    const groupName = layer.groupName;
    if (mapLayers[groupName]) {
        map.removeLayer(mapLayers[groupName]);
    }

    // Use a featureGroup rather than a plain layerGroup: featureGroup
    // exposes a working getBounds() that combines bounds across mixed
    // content (point markers + GeoJSON shapes), which fitMapToActiveLayers()
    // below relies on. A plain L.layerGroup() has no getBounds() at all.
    const layerGroup = L.featureGroup();

    // --- Point markers (media pins) ---
    (layer.data || []).forEach(item => {
        const marker = L.marker([item.lat, item.lng], {
            icon: MarkerIconModule.build(item.media_type)
        });

        const typeLabel = MarkerIconModule.labelFor(item.media_type);
        marker.bindTooltip(`${item.place_name} &middot; ${typeLabel}`, { direction: 'top', offset: [0, -38] });
        marker.on('click', () => {
            openLightbox(item);
        });
        layerGroup.addLayer(marker);
    });

    // --- Shapes (polylines / polygons) ---
    const shapes = layer.shapes || [];
    if (shapes.length > 0) {
        const style = layer.shapeStyle || DEFAULT_SHAPE_STYLE;
        const geoJsonLayer = L.geoJSON(shapes, {
            style: () => ({
                color: style.lineColor,
                weight: style.lineWeight,
                fillColor: style.fillColor,
                fillOpacity: style.fillOpacity
            })
        });
        layerGroup.addLayer(geoJsonLayer);

        // A single label for the whole layer. Rather than using the
        // combined bounding box of every shape (which, for a layer with
        // two or more disconnected regions, places the label floating
        // in empty space between them), the label is anchored to the
        // center of whichever individual shape has the largest bounding
        // box — guaranteeing it always sits on top of actual shape
        // geometry rather than a gap.
        if (style.label && style.label.trim()) {
            const labelPoint = findLargestShapeCenter(geoJsonLayer);
            if (labelPoint) {
                const labelIcon = L.divIcon({
                    html: `<span class="mediamap-shape-label" style="color:${escHtml(style.labelColor)};font-size:${parseFloat(style.labelSize) || 14}px;">${escHtml(style.label)}</span>`,
                    className: 'mediamap-shape-label-icon',
                    iconSize: null
                });
                const labelMarker = L.marker(labelPoint, { icon: labelIcon, interactive: false });
                layerGroup.addLayer(labelMarker);
            }
        }
    }

    mapLayers[groupName] = layerGroup;
    map.addLayer(layerGroup);
}

/**
 * Find the center point of the single largest (by bounding-box area)
 * individual sub-layer inside a rendered L.geoJSON layer. Used to place
 * a layer's label on solid shape geometry even when the layer contains
 * several disconnected regions, instead of at the combined bounding
 * box's center (which can fall in empty space between them).
 *
 * Falls back to the overall combined bounds if, for any reason, no
 * individual sub-layer can be measured (e.g. a single shape, where the
 * "largest individual shape" and "combined bounds" are the same thing
 * anyway).
 */
function findLargestShapeCenter(geoJsonLayer) {
    let bestBounds = null;
    let bestArea = -1;

    geoJsonLayer.eachLayer(sublayer => {
        if (typeof sublayer.getBounds !== 'function') return;
        let b;
        try {
            b = sublayer.getBounds();
        } catch (e) {
            return;
        }
        if (!b || !b.isValid()) return;

        const sw = b.getSouthWest();
        const ne = b.getNorthEast();
        // A simple width*height bounding-box area is sufficient for
        // picking "the biggest region" — true geographic/polygon area
        // isn't needed just to choose a sensible label anchor.
        const area = Math.abs(ne.lat - sw.lat) * Math.abs(ne.lng - sw.lng);

        if (area > bestArea) {
            bestArea = area;
            bestBounds = b;
        }
    });

    if (bestBounds) return bestBounds.getCenter();

    // Fallback: combined bounds of the whole geoJsonLayer.
    try {
        const combined = geoJsonLayer.getBounds();
        if (combined && combined.isValid()) return combined.getCenter();
    } catch (e) {
        // no measurable content at all
    }
    return null;
}


async function refreshLayersUI(filterText = '') {
    const layers = await getAllLayers(); // already sorted by `order` ascending, full unfiltered list
    const container = document.getElementById('layers-list');
    container.innerHTML = '';

    if (layers.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-500 italic">No layers loaded yet.</p>`;
        redrawActiveLayersInOrder(layers); // clears any stale markers and resets the view
        return;
    }

    const needle = filterText.trim().toLowerCase();
    const visibleLayers = needle
        ? layers.filter(l => l.groupName.toLowerCase().includes(needle))
        : layers;

    if (visibleLayers.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-500 italic">No layers match "${escHtml(filterText.trim())}".</p>`;
        // The search box only hides rows — it never changes what's
        // actually active/rendered on the map, so the map itself is
        // left exactly as it was rather than being redrawn here.
        return;
    }

    visibleLayers.forEach((layer) => {
        // Reorder buttons operate on the full, unfiltered order — "up"
        // always means "swap with whichever layer is one position
        // above it in storage", regardless of whether a search filter
        // is currently hiding rows in between. This keeps reordering
        // behavior predictable instead of silently reshuffling layers
        // that aren't even visible in a filtered view.
        const fullIndex = layers.indexOf(layer);
        const isFirst = fullIndex === 0;
        const isLast = fullIndex === layers.length - 1;

        // Generate a safe configuration string for special characters or spaces
        const safeId = layer.groupName.replace(/[^a-zA-Z0-9-_]/g, '-');
        const shapeCount = (layer.shapes || []).length;

        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-2 bg-slate-800 rounded-lg border border-slate-700 gap-2";
        div.innerHTML = `
            <div class="flex items-center space-x-2 truncate min-w-0">
                <input type="checkbox" id="chk-${safeId}" ${layer.active ? 'checked' : ''} class="w-4 h-4 text-indigo-600 bg-slate-900 border-slate-700 rounded focus:ring-indigo-500 focus:ring-offset-slate-900 flex-none">
                <span class="text-xs font-medium text-slate-200 truncate">${escHtml(layer.groupName)}</span>
            </div>
            <div class="flex items-center space-x-1 flex-none">
                <span class="bg-indigo-950 text-indigo-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-900">${layer.data.length} pts</span>
                ${shapeCount > 0 ? `<span class="bg-violet-950 text-violet-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-violet-900">${shapeCount} shape${shapeCount === 1 ? '' : 's'}</span>` : ''}
                ${shapeCount > 0 ? `<button type="button" id="style-${safeId}" title="Style this layer's shapes" class="material-icons text-sm text-slate-300 hover:text-white leading-none p-0.5 rounded hover:bg-slate-700/60">palette</button>` : ''}
                <button type="button" id="rename-${safeId}" title="Rename layer" class="material-icons text-sm text-slate-300 hover:text-white leading-none p-0.5 rounded hover:bg-slate-700/60">edit</button>
                <button type="button" id="up-${safeId}" title="Move layer up" ${isFirst ? 'disabled' : ''} class="material-icons text-sm text-slate-300 hover:text-white disabled:text-slate-600 disabled:cursor-not-allowed leading-none p-0.5 rounded hover:bg-slate-700/60 disabled:hover:bg-transparent">arrow_upward</button>
                <button type="button" id="down-${safeId}" title="Move layer down" ${isLast ? 'disabled' : ''} class="material-icons text-sm text-slate-300 hover:text-white disabled:text-slate-600 disabled:cursor-not-allowed leading-none p-0.5 rounded hover:bg-slate-700/60 disabled:hover:bg-transparent">arrow_downward</button>
                <button type="button" id="delete-${safeId}" title="Delete layer" class="material-icons text-sm text-rose-400 hover:text-rose-300 leading-none p-0.5 rounded hover:bg-rose-950/40">delete</button>
            </div>
        `;

        container.appendChild(div);

        // Use robust global matching context instead of inner query selectors
        const chk = document.getElementById(`chk-${safeId}`);
        if (chk) {
            chk.addEventListener('change', async (e) => {
                await updateLayerStatus(layer.groupName, e.target.checked);
                redrawActiveLayersInOrder(await getAllLayers());
            });
        }

        const styleBtn = document.getElementById(`style-${safeId}`);
        if (styleBtn && shapeCount > 0) {
            styleBtn.addEventListener('click', () => {
                LayerStyleModal.open(layer.groupName, layer.shapeStyle || DEFAULT_SHAPE_STYLE, async (newStyle) => {
                    await persistLayerShapeStyle(layer.groupName, newStyle);
                    redrawActiveLayersInOrder(await getAllLayers());
                });
            });
        }

        const renameBtn = document.getElementById(`rename-${safeId}`);
        if (renameBtn) {
            renameBtn.addEventListener('click', async () => {
                const newName = await AdminUI.prompt('New name for this layer:', {
                    title: 'Rename Layer',
                    defaultValue: layer.groupName,
                    confirmLabel: 'Rename',
                    validate: (value) => {
                        if (!value) return 'Layer name can\u2019t be empty.';
                        if (value !== layer.groupName && layers.some(l => l.groupName === value)) {
                            return 'Another layer already has that name.';
                        }
                        return null;
                    }
                });
                if (newName === null) return; // cancelled
                const renamed = await renameLayer(layer.groupName, newName);
                if (renamed) {
                    await refreshLayersUI(document.getElementById('layer-search').value);
                }
            });
        }

        const upBtn = document.getElementById(`up-${safeId}`);
        if (upBtn && !isFirst) {
            upBtn.addEventListener('click', async () => {
                const above = layers[fullIndex - 1];
                await swapLayerOrder(layer.groupName, above.groupName);
                await refreshLayersUI(document.getElementById('layer-search').value);
            });
        }

        const downBtn = document.getElementById(`down-${safeId}`);
        if (downBtn && !isLast) {
            downBtn.addEventListener('click', async () => {
                const below = layers[fullIndex + 1];
                await swapLayerOrder(layer.groupName, below.groupName);
                await refreshLayersUI(document.getElementById('layer-search').value);
            });
        }

        const deleteBtn = document.getElementById(`delete-${safeId}`);
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                const confirmed = await AdminUI.confirm(
                    `Delete the layer "${layer.groupName}"? This removes its ${layer.data.length} point${layer.data.length === 1 ? '' : 's'}${shapeCount > 0 ? ` and ${shapeCount} shape${shapeCount === 1 ? '' : 's'}` : ''} permanently.`,
                    { title: 'Delete Layer', confirmLabel: 'Delete', danger: true }
                );
                if (!confirmed) return;
                await deleteLayer(layer.groupName);
                await refreshLayersUI(document.getElementById('layer-search').value);
            });
        }
    });

    redrawActiveLayersInOrder(layers);
}

/**
 * Remove every layer currently on the map and re-add the active ones in
 * stored order (lowest order first), so later/"higher" layers draw on
 * top of earlier ones — and so the up/down reorder buttons visibly
 * change marker stacking, not just list position. Finishes by fitting
 * the map view to the combined bounds of everything just drawn, so the
 * map is bound to the loaded data by default instead of sitting on a
 * fixed, possibly-empty view.
 */
function redrawActiveLayersInOrder(layers) {
    Object.keys(mapLayers).forEach(key => map.removeLayer(mapLayers[key]));
    mapLayers = {};

    layers.forEach(layer => {
        if (layer.active) {
            renderLayerOnMap(layer);
        }
    });

    fitMapToActiveLayers();
}

/**
 * Fit the map's view to the combined bounds of every currently rendered
 * (active) layer — point markers and shapes (polylines/polygons) alike.
 * Falls back to the kiosk's default home view when there is no active
 * data to bound to, so the map never collapses to an invalid/empty
 * bounds state. When kioskLockBoundsToData is enabled, also constrains
 * panning/zooming to that same extent so a kiosk visitor can't scroll
 * away to an unrelated part of the world map.
 */
let kioskLockBoundsToData = DEFAULT_KIOSK_SETTINGS.lockBoundsToData;

function setLockBoundsToData(enabled) {
    kioskLockBoundsToData = !!enabled;
    fitMapToActiveLayers(); // re-apply/clear the lock against the current view immediately
}

function fitMapToActiveLayers() {
    const groups = Object.values(mapLayers);
    if (groups.length === 0) {
        map.setMaxBounds(null);
        map.setMinZoom(0);
        map.setView(KIOSK_HOME_VIEW.center, KIOSK_HOME_VIEW.zoom);
        return;
    }

    // Each entry in mapLayers is an L.featureGroup (not a plain
    // layerGroup — see renderLayerOnMap), whose getBounds() already
    // knows how to combine bounds across whatever mix of markers,
    // polylines, and polygons it contains.
    let bounds = null;
    groups.forEach(group => {
        if (typeof group.getBounds !== 'function') return;
        let groupBounds;
        try {
            groupBounds = group.getBounds();
        } catch (e) {
            return; // empty group with nothing addable to bounds
        }
        if (!groupBounds || !groupBounds.isValid()) return;
        bounds = bounds ? bounds.extend(groupBounds) : groupBounds;
    });

    if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });

        if (kioskLockBoundsToData) {
            // Pad the lock itself a bit more generously than the initial
            // fit padding, so the data isn't pinned exactly at the edge
            // of what's pannable — a visitor can nudge slightly around
            // the data without it feeling like a hard wall right at the
            // markers/shapes themselves.
            const padded = bounds.pad(0.5);
            map.setMaxBounds(padded);
            // getBoundsZoom can return 0 (or, in degenerate cases, a
            // non-finite value) if the map container hasn't been laid
            // out yet — clamp to the map's own configured minZoom (or 1)
            // so a lock can never leave the kiosk stuck unable to zoom
            // out at all.
            const computedMinZoom = map.getBoundsZoom(padded, true);
            map.setMinZoom(Number.isFinite(computedMinZoom) && computedMinZoom > 0 ? computedMinZoom : 1);
        } else {
            map.setMaxBounds(null);
            map.setMinZoom(0);
        }
    } else {
        map.setMaxBounds(null);
        map.setMinZoom(0);
        map.setView(KIOSK_HOME_VIEW.center, KIOSK_HOME_VIEW.zoom);
    }
}

// --- 6. LIGHTBOX ---
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderMediaStatus(mediaBox, iconName, message, linkUrl, isError) {
    const linkHtml = linkUrl
        ? `<a href="${escHtml(linkUrl)}" target="_blank" rel="noopener">Open original link &#8599;</a>`
        : '';
    mediaBox.innerHTML = `
        <div class="media-status${isError ? ' media-status-error' : ''}">
            <span class="material-icons">${iconName}</span>
            <p class="text-xs">${escHtml(message)}</p>
            ${linkHtml}
        </div>`;
}

function openLightbox(item) {
    const container = document.getElementById('lightbox');
    const mediaBox = document.getElementById('lightbox-media');
    const wrapper = document.getElementById('lightbox-content-wrapper');

    document.getElementById('lightbox-title').innerText = item.place_name;
    document.getElementById('lightbox-coords').innerText = `${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}`;
    document.getElementById('lightbox-desc').innerText = item.description || "No description provided.";
    document.getElementById('lightbox-type').innerText = MarkerIconModule.labelFor(item.media_type);

    mediaBox.innerHTML = '';

    if (item.media_type === 'video') {
        const embed = MediaEmbedModule.resolve('video', item.media_url);
        if (!embed) {
            renderMediaStatus(mediaBox, 'play_circle', 'This video can\u2019t be played in the kiosk.', item.media_url, true);
        } else if (embed.kind === 'file') {
            mediaBox.innerHTML = `<video src="${escHtml(embed.src)}" controls autoplay playsinline></video>`;
        } else {
            mediaBox.innerHTML = `<iframe src="${escHtml(embed.src)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
        }
    } else if (item.media_type === 'audio') {
        const embed = MediaEmbedModule.resolve('audio', item.media_url);
        if (!embed) {
            renderMediaStatus(mediaBox, 'audiotrack', 'This audio can\u2019t be played in the kiosk.', item.media_url, true);
        } else if (embed.kind === 'file') {
            mediaBox.innerHTML = `
                <div class="flex flex-col items-center w-full px-6">
                    <span class="material-icons text-6xl text-indigo-400 mb-4">audiotrack</span>
                    <audio src="${escHtml(embed.src)}" controls autoplay></audio>
                </div>`;
        } else {
            // SoundCloud / Spotify — platform iframe player.
            mediaBox.innerHTML = `<iframe src="${escHtml(embed.src)}" frameborder="0" allow="autoplay"></iframe>`;
        }
    } else if (item.media_type === 'image') {
        mediaBox.innerHTML = `<img src="${escHtml(item.media_url)}" alt="${escHtml(item.place_name)}" class="w-full h-full object-contain" />`;
    } else if (item.media_type === 'streetview') {
        const embed = MediaEmbedModule.resolve('streetview', item.media_url);
        if (!embed) {
            renderMediaStatus(mediaBox, 'streetview', 'This Street View link isn\u2019t valid.', item.media_url, true);
        } else {
            mediaBox.innerHTML = `<iframe src="${escHtml(embed.src)}" frameborder="0" style="border:0" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
        }
    } else {
        mediaBox.innerHTML = `
            <div class="text-center p-6 text-slate-400">
                <span class="material-icons text-5xl mb-2">article</span>
                <p class="text-xs">Document/Text Point Map View</p>
            </div>`;
    }

    container.classList.remove('hidden');
    setTimeout(() => {
        container.classList.remove('opacity-0');
        wrapper.classList.remove('scale-95');
    }, 10);

    handleUserActivity();
}

function closeLightbox() {
    const container = document.getElementById('lightbox');
    const wrapper = document.getElementById('lightbox-content-wrapper');
    container.classList.add('opacity-0');
    wrapper.classList.add('scale-95');
    setTimeout(() => {
        container.classList.add('hidden');
        document.getElementById('lightbox-media').innerHTML = '';
    }, 300);
}

// --- 7. HARDENED WINDOW INTERACTION CAPTURE ENGINE ---
window.addEventListener('click', handleUserActivity, true);
window.addEventListener('keydown', handleUserActivity, true);
window.addEventListener('mousedown', handleUserActivity, true);
window.addEventListener('touchstart', handleUserActivity, true);
window.addEventListener('touchmove', handleUserActivity, true);

let mouseMoveTimeout;
window.addEventListener('mousemove', () => {
    if (!mouseMoveTimeout) {
        mouseMoveTimeout = setTimeout(() => {
            handleUserActivity();
            mouseMoveTimeout = null;
        }, 200);
    }
}, true);

document.getElementById('admin-password').addEventListener('input', evaluateAccordionState);

/**
 * Build a small human-readable preview of what a JSON/GeoJSON file
 * contains — counts plus a few sample rows — so the admin can see what
 * they're about to load before committing to it, instead of uploading
 * blind and only finding out from the resulting map.
 */
function renderUploadPreview(points, shapeFeatures) {
    const previewEl = document.getElementById('upload-preview');
    const totalPoints = points.length;
    const totalShapes = shapeFeatures.length;

    if (totalPoints === 0 && totalShapes === 0) {
        previewEl.classList.remove('hidden');
        previewEl.innerHTML = `<p class="text-rose-400">No usable points or shapes were found in this file.</p>`;
        return;
    }

    const sampleRows = points.slice(0, 3).map(p =>
        `<li class="truncate">&bull; ${escHtml(p.place_name)} <span class="text-slate-500">(${p.media_type})</span></li>`
    ).join('');

    previewEl.classList.remove('hidden');
    previewEl.innerHTML = `
        <div class="flex items-center gap-2 mb-1.5">
            <span class="bg-indigo-950 text-indigo-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-900">${totalPoints} point${totalPoints === 1 ? '' : 's'}</span>
            ${totalShapes > 0 ? `<span class="bg-violet-950 text-violet-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-violet-900">${totalShapes} shape${totalShapes === 1 ? '' : 's'}</span>` : ''}
        </div>
        ${sampleRows ? `<ul class="text-slate-400 space-y-0.5">${sampleRows}${totalPoints > 3 ? `<li class="text-slate-500">&hellip; and ${totalPoints - 3} more</li>` : ''}</ul>` : ''}
    `;
}

// Cache of the most recently parsed+normalized file, keyed by nothing
// more than "the current selection" — re-used by the upload button so
// the file isn't re-read/re-parsed a second time on click.
let pendingUpload = null;

document.getElementById('json-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const previewEl = document.getElementById('upload-preview');
    pendingUpload = null;
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';

    if (!file) {
        document.getElementById('file-label').innerText = 'Select JSON / GeoJSON File';
        return;
    }
    document.getElementById('file-label').innerText = file.name;

    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const rawJson = JSON.parse(ev.target.result);
            const { points, shapeFeatures } = DataNormalizationModule.process(rawJson);
            pendingUpload = { points, shapeFeatures };
            renderUploadPreview(points, shapeFeatures);
        } catch (err) {
            pendingUpload = null;
            previewEl.classList.remove('hidden');
            previewEl.innerHTML = `<p class="text-rose-400">Couldn't parse this file as JSON.</p>`;
        }
    };
    reader.readAsText(file);
});

document.getElementById('btn-upload').addEventListener('click', async () => {
    const groupNameInput = document.getElementById('group-name').value.trim();
    const fileInput = document.getElementById('json-file');
    const statusEl = document.getElementById('upload-status');

    if (!groupNameInput || !fileInput.files[0]) {
        AdminUI.status(statusEl, 'Please choose a file and enter a layer name.', { tone: 'error' });
        return;
    }

    if (!pendingUpload) {
        AdminUI.status(statusEl, 'Still reading the file — try again in a moment.', { tone: 'error' });
        return;
    }

    const { points, shapeFeatures } = pendingUpload;
    if (points.length === 0 && shapeFeatures.length === 0) {
        AdminUI.status(statusEl, 'No valid map nodes could be processed.', { tone: 'error' });
        return;
    }

    try {
        await saveLayer(groupNameInput, points, shapeFeatures);
        await refreshLayersUI(document.getElementById('layer-search').value);

        document.getElementById('group-name').value = '';
        fileInput.value = '';
        document.getElementById('file-label').innerText = 'Select JSON / GeoJSON File';
        document.getElementById('upload-preview').classList.add('hidden');
        pendingUpload = null;

        AdminUI.status(statusEl, `Layer "${groupNameInput}" loaded successfully.`, { tone: 'ok' });
    } catch (err) {
        AdminUI.status(statusEl, 'Something went wrong while saving this layer.', { tone: 'error' });
        console.error(err);
    }
});

// --- Layer search/filter ---
document.getElementById('layer-search').addEventListener('input', (e) => {
    refreshLayersUI(e.target.value);
});

// --- Map & Kiosk Settings ---
document.getElementById('idle-timer-range').addEventListener('input', async (e) => {
    const seconds = parseInt(e.target.value, 10);
    document.getElementById('idle-timer-readout').innerText = `${seconds}s`;
    setIdleTimeSeconds(seconds);
    await saveKioskSettings({ idleTimeSeconds: seconds });
});

document.getElementById('lock-bounds-toggle').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    setLockBoundsToData(enabled);
    await saveKioskSettings({ lockBoundsToData: enabled });
    AdminUI.status(document.getElementById('settings-status'),
        enabled ? 'Pan/zoom is now locked to the loaded data.' : 'Pan/zoom lock removed.',
        { tone: 'ok' });
});

// --- Backup & Restore ---
document.getElementById('btn-backup').addEventListener('click', async () => {
    const statusEl = document.getElementById('backup-status');
    try {
        const payload = await buildBackupPayload();
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const datePart = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `mediamap-kiosk-backup-${datePart}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        AdminUI.status(statusEl, `Backup downloaded (${payload.layers.length} layer${payload.layers.length === 1 ? '' : 's'}).`, { tone: 'ok' });
    } catch (err) {
        AdminUI.status(statusEl, 'Backup failed — see console for details.', { tone: 'error' });
        console.error(err);
    }
});

document.getElementById('restore-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const statusEl = document.getElementById('backup-status');
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
        let payload;
        try {
            payload = JSON.parse(ev.target.result);
        } catch (err) {
            AdminUI.status(statusEl, 'That file isn\u2019t valid JSON.', { tone: 'error' });
            e.target.value = '';
            return;
        }

        const confirmed = await AdminUI.confirm(
            `This replaces everything currently loaded with the contents of this backup (${Array.isArray(payload.layers) ? payload.layers.length : '?'} layer(s)). This can't be undone.`,
            { title: 'Restore From Backup', confirmLabel: 'Restore', danger: true }
        );
        e.target.value = '';
        if (!confirmed) return;

        try {
            const count = await restoreFromBackupPayload(payload);
            const settings = await getKioskSettings();
            setIdleTimeSeconds(settings.idleTimeSeconds);
            setLockBoundsToData(settings.lockBoundsToData);
            document.getElementById('idle-timer-range').value = settings.idleTimeSeconds;
            document.getElementById('idle-timer-readout').innerText = `${settings.idleTimeSeconds}s`;
            document.getElementById('lock-bounds-toggle').checked = settings.lockBoundsToData;

            await refreshLayersUI(document.getElementById('layer-search').value);
            AdminUI.status(statusEl, `Restored ${count} layer${count === 1 ? '' : 's'} from backup.`, { tone: 'ok' });
        } catch (err) {
            AdminUI.status(statusEl, err.message || 'Restore failed — see console for details.', { tone: 'error' });
            console.error(err);
        }
    };
    reader.readAsText(file);
});

document.getElementById('btn-flush').addEventListener('click', async () => {
    const statusEl = document.getElementById('backup-status');
    const confirmed = await AdminUI.confirm(
        'This permanently deletes every saved layer from this kiosk\u2019s local storage. Back up first if you might need this data again.',
        { title: 'Flush System Database', confirmLabel: 'Flush', danger: true }
    );
    if (!confirmed) return;
    await flushDB();
    await refreshLayersUI();
    AdminUI.status(statusEl, 'All layers have been removed.', { tone: 'ok' });
});

document.getElementById('close-lightbox').addEventListener('click', closeLightbox);
document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target === document.getElementById('lightbox')) closeLightbox();
});

window.addEventListener('DOMContentLoaded', async () => {
    initMap();

    const settings = await getKioskSettings();
    setIdleTimeSeconds(settings.idleTimeSeconds);
    setLockBoundsToData(settings.lockBoundsToData);
    document.getElementById('idle-timer-range').value = settings.idleTimeSeconds;
    document.getElementById('idle-timer-readout').innerText = `${settings.idleTimeSeconds}s`;
    document.getElementById('lock-bounds-toggle').checked = settings.lockBoundsToData;

    await refreshLayersUI();
    startKioskHeartbeat();
});
