// =============================================================================
// LexiPic Kiosk — Heritage Language Archive
// Application script
//
// Structurally mirrors the MediaMap kiosk-map app: an IndexedDB-backed
// store of "things to browse" (here, LexiPic word sets, instead of map
// layers), a password-gated admin accordion for import/manage/settings/
// backup, and a fullscreen kiosk view with a swipeable word-card archive
// and an idle auto-return-to-sets timeout. The map + GeoJSON specifics
// from the original are replaced with LexiPic's set/entry data model
// throughout.
// =============================================================================

// --- 1. DB PIPELINE MANAGEMENT DRIVER ---
const DB_NAME = 'LexipicKioskDB';
const DB_VERSION = 1;
const STORE_NAME = 'sets';
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
                db.createObjectStore(STORE_NAME, { keyPath: 'slug' });
            }
            if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
                db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

// Defaults used until the admin changes them via Kiosk Settings.
const DEFAULT_KIOSK_SETTINGS = {
    idleTimeSeconds: 90,
    autoplayAudio: false
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

/**
 * Save a newly-imported set. `slug` is the object store's keyPath, so a
 * collision with an existing set (re-importing the same export) makes
 * this an overwrite, not a duplicate — entries and metadata are simply
 * replaced wholesale with the freshly-imported version.
 */
async function saveSet(setRecord) {
    const existing = await getAllSets();
    const already = existing.find(s => s.slug === setRecord.slug);
    const maxOrder = existing.reduce((max, s) => Math.max(max, typeof s.order === 'number' ? s.order : 0), -1);
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put({
            slug: setRecord.slug,
            name: setRecord.name,
            language: setRecord.language,
            languageLabel: setRecord.languageLabel,
            entries: setRecord.entries,
            active: already ? already.active : true,
            // New sets are placed on top (highest order = shown last in
            // the admin list); a re-import of an existing set keeps its
            // original position rather than jumping to the end.
            order: already ? already.order : maxOrder + 1
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

async function getAllSets() {
    const db = await initDB();
    const sets = await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    // Backfill: defensive default-filling for any record missing fields
    // introduced after it was first saved, so ordering/active state are
    // well-defined from the very first read without a DB version bump.
    let needsBackfill = false;
    sets.forEach((set, i) => {
        if (typeof set.order !== 'number') {
            set.order = i;
            needsBackfill = true;
        }
        if (typeof set.active !== 'boolean') {
            set.active = true;
            needsBackfill = true;
        }
        if (!Array.isArray(set.entries)) {
            set.entries = [];
            needsBackfill = true;
        }
    });
    if (needsBackfill) {
        await Promise.all(sets.map(set => persistSetFields(set.slug, {
            order: set.order,
            active: set.active,
            entries: set.entries
        })));
    }

    sets.sort((a, b) => a.order - b.order);
    return sets;
}

/** Persist one or more fields on a single set record (merge, not replace). */
async function persistSetFields(slug, fields) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(slug);
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

/** Persist just the `order` field for one set record (used for backfill and reordering). */
async function persistSetOrder(slug, order) {
    return persistSetFields(slug, { order });
}

/**
 * Swap the order of two sets (used by the move up/down buttons). Reads
 * the current order values fresh rather than trusting stale UI state, so
 * rapid clicks can't desync the stored order from what's on screen.
 */
async function swapSetOrder(slugA, slugB) {
    const sets = await getAllSets();
    const a = sets.find(s => s.slug === slugA);
    const b = sets.find(s => s.slug === slugB);
    if (!a || !b) return;
    await Promise.all([
        persistSetOrder(a.slug, b.order),
        persistSetOrder(b.slug, a.order)
    ]);
}

async function updateSetStatus(slug, active) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(slug);
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

/** Delete a single set record by its slug (used by the per-set delete button). */
async function deleteSet(slug) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.delete(slug);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

/**
 * Rename a set. `slug` is the object store's keyPath, so a record can't
 * be renamed in place — this reads the full existing record, writes it
 * back under a freshly-slugified key (preserving every other field:
 * entries, language, active, order), then deletes the old key. Returns
 * false without making any change if the new name is empty or the
 * resulting slug collides with another set.
 */
async function renameSet(oldSlug, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) return false;

    const sets = await getAllSets();
    const existing = sets.find(s => s.slug === oldSlug);
    if (!existing) return false;

    const newSlug = slugify(trimmed);
    if (newSlug !== oldSlug && sets.some(s => s.slug === newSlug)) return false; // name clash

    const renamed = { ...existing, slug: newSlug, name: trimmed };
    const db = await initDB();
    await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(renamed);
        if (newSlug !== oldSlug) store.delete(oldSlug);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
    return true;
}

function slugify(text) {
    return String(text)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'set';
}

/**
 * Backup format: a single JSON document containing every set record and
 * the kiosk settings, versioned so a future schema change can detect and
 * handle older backup files gracefully instead of guessing.
 */
const BACKUP_FORMAT_VERSION = 1;

async function buildBackupPayload() {
    const sets = await getAllSets();
    const settings = await getKioskSettings();
    return {
        backupFormatVersion: BACKUP_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        sets,
        settings
    };
}

/**
 * Restore from a previously-downloaded backup payload. Replaces all
 * current sets and settings with the backup's contents (this is a full
 * restore, not a merge) — the caller is expected to confirm with the
 * admin before calling this, since it's destructive to whatever is
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
    if (!Array.isArray(payload.sets)) {
        throw new Error('Backup file is missing its "sets" array.');
    }
    const invalidSet = payload.sets.find(s => !s || typeof s.slug !== 'string' || !s.slug.trim());
    if (invalidSet) {
        throw new Error('Backup file contains a set with no valid identifier.');
    }

    await flushDB();
    const db = await initDB();
    await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        payload.sets.forEach(set => {
            store.put({
                slug: set.slug,
                name: set.name || set.slug,
                language: set.language || '',
                languageLabel: set.languageLabel || set.language || '',
                entries: Array.isArray(set.entries) ? set.entries : [],
                active: !!set.active,
                order: typeof set.order === 'number' ? set.order : 0
            });
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });

    if (payload.settings && typeof payload.settings === 'object') {
        await saveKioskSettings(payload.settings);
    }

    return payload.sets.length;
}

// --- 2. LEXIPIC EXPORT NORMALIZATION MODULE ---
// LexiPic's REST export (Lexipic_File_Handler::build_export) shape:
//   {
//     lexipic_version: "1.1.0",
//     set: { name, slug, language },
//     entries: [
//       { id, word_script, word_roman, description, image, audio, image_mime, audio_mime }
//     ]
//   }
// image/audio are base64 data-URIs, making the export fully self-contained
// — no network calls needed to view it offline on a kiosk. This module
// also tolerates the legacy flat-array PWA format, the same way LexiPic's
// own Lexipic_File_Handler::import_json() does on the server side.
const LexipicNormalizer = {
    /**
     * @param {object|array} rawInput  Parsed JSON from an uploaded file.
     * @return {{ name, slug, language, entries }} or throws on bad input.
     */
    process(rawInput) {
        let setMeta = { name: '', slug: '', language: 'bpm' };
        let rawEntries = [];

        if (rawInput && Array.isArray(rawInput.entries)) {
            // Current plugin export format.
            setMeta.name = rawInput.set && rawInput.set.name ? rawInput.set.name : 'Imported Set';
            setMeta.slug = rawInput.set && rawInput.set.slug ? rawInput.set.slug : slugify(setMeta.name);
            setMeta.language = rawInput.set && rawInput.set.language ? rawInput.set.language : 'bpm';
            rawEntries = rawInput.entries;
        } else if (Array.isArray(rawInput)) {
            // Legacy flat-array PWA format — no set metadata at all.
            setMeta.name = 'Imported Set ' + new Date().toISOString().slice(0, 10);
            setMeta.slug = slugify(setMeta.name);
            setMeta.language = 'bpm';
            rawEntries = rawInput;
        } else {
            throw new Error('This file doesn\u2019t look like a LexiPic export.');
        }

        const entries = rawEntries.map((e, i) => ({
            id: e.id || i,
            word_script: e.word_script || e.heritage || '',
            word_roman: e.word_roman || e.transliteration || '',
            description: e.description || '',
            image: e.image || '',
            audio: e.audio || ''
        })).filter(e => e.word_script || e.word_roman || e.image);

        return {
            name: setMeta.name,
            slug: setMeta.slug,
            language: setMeta.language,
            languageLabel: LANGUAGE_LABELS[setMeta.language] || setMeta.language.toUpperCase(),
            entries
        };
    }
};

// Mirrors LexiPic's Lexipic_IME_Manager::default_languages() registry, so
// a kiosk import shows a familiar, human-readable language name instead
// of a bare code, without needing to call back into a WordPress site.
// Any code not in this list simply falls back to its uppercased form.
const LANGUAGE_LABELS = {
    bpm: 'Bishnupriya Manipuri (ইমার ঠার)',
    as: 'Assamese (অসমীয়া)',
    bn: 'Bengali (বাংলা)'
};

// --- 3. KIOSK IDLE TIMER + HEARTBEAT ---
// Same accurate-drift-free heartbeat design as kiosk-map: one steady
// setInterval recomputes "time since last activity" from a timestamp
// rather than counting a number down directly, so the idle check can't
// drift out of sync with wall-clock time.
let KIOSK_IDLE_TIME = DEFAULT_KIOSK_SETTINGS.idleTimeSeconds * 1000;
let lastActivityTime = Date.now();
let idleCheckInterval = null;
let kioskAutoplayAudio = DEFAULT_KIOSK_SETTINGS.autoplayAudio;

/**
 * Apply a new idle timeout (in seconds) at runtime. Called once at boot
 * with the persisted setting, and again immediately whenever the admin
 * adjusts the slider, so a change takes effect without needing a reload.
 */
function setIdleTimeSeconds(seconds) {
    KIOSK_IDLE_TIME = Math.max(5, Math.round(seconds)) * 1000;
}

function setAutoplayAudio(enabled) {
    kioskAutoplayAudio = !!enabled;
}

// Fired globally across the window scope
function handleUserActivity() {
    lastActivityTime = Date.now();
}

// Independent, steady heartbeat clock running once per second
function startKioskHeartbeat() {
    if (idleCheckInterval) clearInterval(idleCheckInterval);

    idleCheckInterval = setInterval(() => {
        const timeSinceLastActivity = Date.now() - lastActivityTime;

        // If threshold exceeded, enforce standard system security lock down procedures
        if (timeSinceLastActivity >= KIOSK_IDLE_TIME) {
            document.getElementById('admin-password').value = '';
            evaluateAccordionState();
            returnToSetsScreen();
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

// --- 4. SCREEN NAVIGATION (Sets grid <-> Word archive) ---
let currentSetSlug = null;
let currentCardIndex = 0;

function showSetsScreen() {
    document.getElementById('screen-sets').classList.remove('lp-screen-hidden');
    document.getElementById('screen-archive').classList.remove('lp-screen-active');
    document.getElementById('screen-archive').classList.add('translate-x-full');
    document.getElementById('back-to-sets-btn').style.display = 'none';
    currentSetSlug = null;
}

function showArchiveScreen() {
    document.getElementById('screen-sets').classList.add('lp-screen-hidden');
    document.getElementById('screen-archive').classList.remove('translate-x-full');
    document.getElementById('screen-archive').classList.add('lp-screen-active');
    document.getElementById('back-to-sets-btn').style.display = 'inline-flex';
}

function returnToSetsScreen() {
    if (currentSetSlug !== null) {
        showSetsScreen();
    }
}

document.getElementById('back-to-sets-btn').addEventListener('click', () => {
    handleUserActivity();
    showSetsScreen();
});

// --- 5. SET GRID RENDERING ---
/**
 * Redraw the kiosk-facing grid of set tiles from whatever sets are
 * currently marked active, in stored order. Mirrors
 * redrawActiveLayersInOrder() from kiosk-map: read the full list once,
 * filter to active, render.
 */
function renderSetsGrid(sets) {
    const grid = document.getElementById('sets-grid');
    const empty = document.getElementById('sets-empty');
    const activeSets = sets.filter(s => s.active);

    if (activeSets.length === 0) {
        grid.innerHTML = '';
        empty.style.display = 'flex';
        return;
    }
    empty.style.display = 'none';

    grid.innerHTML = activeSets.map(set => {
        const count = set.entries.length;
        return `
        <div class="lp-set-tile" data-slug="${escHtml(set.slug)}" role="button" tabindex="0" aria-label="Open ${escHtml(set.name)}">
            <div class="lp-set-tile-icon"><span class="material-icons">menu_book</span></div>
            <div class="lp-set-tile-name">${escHtml(set.name)}</div>
            <div class="lp-set-tile-meta"><span class="material-icons" style="font-size:13px;">translate</span>${escHtml(set.languageLabel || set.language || '')}</div>
            <div class="lp-set-tile-count"><span class="material-icons" style="font-size:16px;">collections_bookmark</span>${count} word${count === 1 ? '' : 's'}</div>
        </div>`;
    }).join('');

    $$('.lp-set-tile', grid).forEach(tile => {
        const open = () => {
            handleUserActivity();
            openSetArchive(tile.dataset.slug);
        };
        tile.addEventListener('click', open);
        tile.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(); });
    });
}

async function openSetArchive(slug) {
    const sets = await getAllSets();
    const set = sets.find(s => s.slug === slug);
    if (!set) return;

    currentSetSlug = slug;
    currentCardIndex = 0;

    document.getElementById('archive-set-title').innerText = set.name;
    document.getElementById('archive-set-meta').innerText =
        `${set.languageLabel || set.language || ''} · ${set.entries.length} word${set.entries.length === 1 ? '' : 's'}`;

    renderCards(set.entries);
    showArchiveScreen();

    if (kioskAutoplayAudio && set.entries[0]) {
        playAudio(set.entries[0].audio);
    }
}

// --- 6. ARCHIVE CARDS (SLIDER) ---
// Tracks the entries currently shown in the slider, so the single,
// boot-time-attached scroll listener below always has the right list to
// compute progress against without needing to re-attach itself per render.
let currentEntries = [];

function renderCards(entries) {
    const slider = document.getElementById('lp-archive-slider');
    if (!slider) return;

    if (!entries || entries.length === 0) {
        slider.innerHTML = '';
        updateNavButtons();
        updateProgressUI(0, 0);
        return;
    }

    slider.innerHTML = entries.map((e, i) => {
        const label = e.word_script || e.word_roman || '';
        const sub = (e.word_script && e.word_roman) ? `<div class="lp-roman-display">${escHtml(e.word_roman)}</div>` : '';
        const desc = e.description ? `<p class="lp-card-desc">${escHtml(e.description)}</p>` : '';
        const imgBlock = e.image
            ? `<img src="${escHtml(e.image)}" alt="${escHtml(label)}" loading="lazy">`
            : `<div class="lp-card-no-img"><span class="material-icons" style="font-size:48px;">image</span><span class="text-xs">No image</span></div>`;

        return `
        <div class="lp-card-slot">
            <div class="lp-card" role="listitem" data-index="${i}" tabindex="0">
                <div class="lp-card-media">${imgBlock}</div>
                <div class="lp-card-body">
                    <div class="lp-script-display">${escHtml(label)}</div>
                    ${sub}
                    ${desc}
                    ${e.audio ? `
                    <div class="lp-card-actions">
                        <button class="lp-play-btn" data-audio="${escHtml(e.audio)}" aria-label="Play audio for ${escHtml(label)}">
                            <span class="material-icons" style="font-size:18px;">volume_up</span> Play
                        </button>
                    </div>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');

    // Tapping anywhere on a card plays its audio (same action as the
    // dedicated Play button) — there's no separate detail view to open,
    // so the whole card itself is the tap target.
    $$('.lp-card', slider).forEach((card, i) => {
        card.addEventListener('click', () => {
            handleUserActivity();
            playAudio(entries[i].audio);
        });
    });

    $$('.lp-play-btn', slider).forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleUserActivity();
            playAudio(btn.dataset.audio);
        });
    });

    // currentEntries is read by the slider's single, boot-time-attached
    // scroll listener (see section 7) — re-pointing this reference here
    // (rather than re-attaching a new listener every render) avoids
    // stacking duplicate scroll handlers each time a set is opened.
    currentEntries = entries;

    updateNavButtons();
    updateProgressUI(1, entries.length);
}

function playAudio(dataUri) {
    if (!dataUri) return;
    new Audio(dataUri).play().catch(() => {});
}

function updateProgressUI(current, total) {
    const el = document.getElementById('archive-progress');
    if (el) el.innerText = total > 0 ? `${current} / ${total}` : '0 / 0';
}

let scrollSettleTimeout = null;

function updateProgressFromScroll(total) {
    const slider = document.getElementById('lp-archive-slider');
    if (!slider || total === 0) return;
    const slot = $('.lp-card-slot', slider);
    if (!slot) return;
    const width = slot.offsetWidth;
    if (width === 0) return;
    const index = Math.min(Math.max(Math.round(slider.scrollLeft / width), 0), total - 1);

    if (index !== currentCardIndex) {
        currentCardIndex = index;
        updateProgressUI(currentCardIndex + 1, total);
    }

    // Autoplay only once the swipe has actually settled on a card, not on
    // every intermediate scroll tick — otherwise it would re-fire dozens
    // of times during a single smooth-scroll animation.
    clearTimeout(scrollSettleTimeout);
    scrollSettleTimeout = setTimeout(() => {
        if (kioskAutoplayAudio && currentEntries[currentCardIndex]) {
            playAudio(currentEntries[currentCardIndex].audio);
        }
    }, 150);
}

// --- 7. SLIDER NAV ---
function cardWidth() {
    const slider = document.getElementById('lp-archive-slider');
    const slot = slider ? $('.lp-card-slot', slider) : null;
    if (!slot) return 0;
    return slot.offsetWidth;
}

document.getElementById('lp-next-btn').addEventListener('click', () => {
    handleUserActivity();
    document.getElementById('lp-archive-slider').scrollBy({ left: cardWidth(), behavior: 'smooth' });
});
document.getElementById('lp-prev-btn').addEventListener('click', () => {
    handleUserActivity();
    document.getElementById('lp-archive-slider').scrollBy({ left: -cardWidth(), behavior: 'smooth' });
});

// Attached once (not inside renderCards) so re-opening sets never stacks
// duplicate scroll handlers on this persistent slider element.
document.getElementById('lp-archive-slider').addEventListener('scroll', () => {
    updateNavButtons();
    updateProgressFromScroll(currentEntries.length);
});

function updateNavButtons() {
    const slider = document.getElementById('lp-archive-slider');
    if (!slider) return;
    const atStart = slider.scrollLeft <= 5;
    const atEnd = slider.scrollLeft >= slider.scrollWidth - slider.clientWidth - 5;
    document.getElementById('lp-prev-btn').style.display = atStart ? 'none' : 'flex';
    document.getElementById('lp-next-btn').style.display = atEnd ? 'none' : 'flex';
}

// --- 8. DOM HELPERS ---
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// --- 9. ADMIN PANEL: IMPORT ---
/**
 * Build a small human-readable preview of a chosen LexiPic export — set
 * name, language, entry count, and a few sample words — so the admin can
 * see what they're about to load before committing it, instead of
 * uploading blind and only finding out from the resulting archive.
 */
function renderUploadPreview(normalized) {
    const previewEl = document.getElementById('upload-preview');
    previewEl.classList.remove('hidden');

    const sampleRows = normalized.entries.slice(0, 3).map(e =>
        `<li class="truncate">${escHtml(e.word_script || e.word_roman || '(untitled)')}${e.word_roman && e.word_script ? ' — ' + escHtml(e.word_roman) : ''}</li>`
    ).join('');

    previewEl.innerHTML = `
        <p class="text-slate-300 font-semibold mb-1 truncate">${escHtml(normalized.name)}</p>
        <div class="flex flex-wrap gap-1.5 mb-2">
            <span class="bg-indigo-950 text-indigo-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-900">${normalized.entries.length} word${normalized.entries.length === 1 ? '' : 's'}</span>
            <span class="bg-slate-800 text-slate-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-700">${escHtml(normalized.languageLabel)}</span>
        </div>
        ${sampleRows ? `<ul class="text-slate-400 space-y-0.5">${sampleRows}${normalized.entries.length > 3 ? `<li class="text-slate-500">&hellip; and ${normalized.entries.length - 3} more</li>` : ''}</ul>` : ''}
    `;
}

// Cache of the most recently parsed+normalized file — re-used by the
// upload button so the file isn't re-read/re-parsed a second time on click.
let pendingUpload = null;

document.getElementById('json-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const previewEl = document.getElementById('upload-preview');
    pendingUpload = null;
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';

    if (!file) {
        document.getElementById('file-label').innerText = 'Select LexiPic JSON File';
        return;
    }
    document.getElementById('file-label').innerText = file.name;

    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const rawJson = JSON.parse(ev.target.result);
            const normalized = LexipicNormalizer.process(rawJson);
            pendingUpload = normalized;
            renderUploadPreview(normalized);
        } catch (err) {
            pendingUpload = null;
            previewEl.classList.remove('hidden');
            previewEl.innerHTML = `<p class="text-rose-400">${escHtml(err.message || 'Couldn\u2019t parse this file as a LexiPic export.')}</p>`;
        }
    };
    reader.readAsText(file);
});

document.getElementById('btn-upload').addEventListener('click', async () => {
    const fileInput = document.getElementById('json-file');
    const statusEl = document.getElementById('upload-status');

    if (!fileInput.files[0]) {
        AdminUI.status(statusEl, 'Please choose a LexiPic export file first.', { tone: 'error' });
        return;
    }

    if (!pendingUpload) {
        AdminUI.status(statusEl, 'Still reading the file — try again in a moment.', { tone: 'error' });
        return;
    }

    if (pendingUpload.entries.length === 0) {
        AdminUI.status(statusEl, 'No valid word entries could be found in this file.', { tone: 'error' });
        return;
    }

    try {
        await saveSet(pendingUpload);
        await refreshSetsUI(document.getElementById('set-search').value);

        fileInput.value = '';
        document.getElementById('file-label').innerText = 'Select LexiPic JSON File';
        document.getElementById('upload-preview').classList.add('hidden');
        const importedName = pendingUpload.name;
        pendingUpload = null;

        AdminUI.status(statusEl, `Set "${importedName}" loaded successfully.`, { tone: 'ok' });
    } catch (err) {
        AdminUI.status(statusEl, 'Something went wrong while saving this set.', { tone: 'error' });
        console.error(err);
    }
});

// --- Set search/filter ---
document.getElementById('set-search').addEventListener('input', (e) => {
    refreshSetsUI(e.target.value);
});

// --- 10. ADMIN PANEL: ACTIVE SAVED SETS LIST ---
/**
 * Redraw the admin's set-management list (checkboxes, rename/reorder/
 * delete) and then redraw the kiosk-facing grid to match. Mirrors
 * refreshLayersUI() from kiosk-map.
 */
async function refreshSetsUI(filterText = '') {
    const sets = await getAllSets(); // already sorted by `order` ascending, full unfiltered list
    const container = document.getElementById('sets-list');
    container.innerHTML = '';

    if (sets.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-500 italic">No sets loaded yet.</p>`;
        renderSetsGrid(sets); // clears the kiosk grid too
        return;
    }

    const needle = filterText.trim().toLowerCase();
    const visibleSets = needle
        ? sets.filter(s => s.name.toLowerCase().includes(needle))
        : sets;

    if (visibleSets.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-500 italic">No sets match "${escHtml(filterText.trim())}".</p>`;
        // The search box only hides rows — it never changes what's
        // actually active/shown on the kiosk grid, so that's left as-is.
        return;
    }

    visibleSets.forEach((set) => {
        // Reorder buttons operate on the full, unfiltered order — "up"
        // always means "swap with whichever set is one position above
        // it in storage", regardless of whether a search filter is
        // currently hiding rows in between.
        const fullIndex = sets.indexOf(set);
        const isFirst = fullIndex === 0;
        const isLast = fullIndex === sets.length - 1;

        const safeId = set.slug.replace(/[^a-zA-Z0-9-_]/g, '-');
        const count = set.entries.length;

        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-2 bg-slate-800 rounded-lg border border-slate-700 gap-2";
        div.innerHTML = `
            <div class="flex items-center space-x-2 truncate min-w-0">
                <input type="checkbox" id="chk-${safeId}" ${set.active ? 'checked' : ''} class="w-4 h-4 text-indigo-600 bg-slate-900 border-slate-700 rounded focus:ring-indigo-500 focus:ring-offset-slate-900 flex-none">
                <span class="text-xs font-medium text-slate-200 truncate">${escHtml(set.name)}</span>
            </div>
            <div class="flex items-center space-x-1 flex-none">
                <span class="bg-indigo-950 text-indigo-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-900">${count} word${count === 1 ? '' : 's'}</span>
                <button type="button" id="rename-${safeId}" title="Rename set" class="material-icons text-sm text-slate-300 hover:text-white leading-none p-0.5 rounded hover:bg-slate-700/60">edit</button>
                <button type="button" id="up-${safeId}" title="Move set up" ${isFirst ? 'disabled' : ''} class="material-icons text-sm text-slate-300 hover:text-white disabled:text-slate-600 disabled:cursor-not-allowed leading-none p-0.5 rounded hover:bg-slate-700/60 disabled:hover:bg-transparent">arrow_upward</button>
                <button type="button" id="down-${safeId}" title="Move set down" ${isLast ? 'disabled' : ''} class="material-icons text-sm text-slate-300 hover:text-white disabled:text-slate-600 disabled:cursor-not-allowed leading-none p-0.5 rounded hover:bg-slate-700/60 disabled:hover:bg-transparent">arrow_downward</button>
                <button type="button" id="delete-${safeId}" title="Delete set" class="material-icons text-sm text-rose-400 hover:text-rose-300 leading-none p-0.5 rounded hover:bg-rose-950/40">delete</button>
            </div>
        `;

        container.appendChild(div);

        const chk = document.getElementById(`chk-${safeId}`);
        if (chk) {
            chk.addEventListener('change', async (e) => {
                await updateSetStatus(set.slug, e.target.checked);
                renderSetsGrid(await getAllSets());
            });
        }

        const renameBtn = document.getElementById(`rename-${safeId}`);
        if (renameBtn) {
            renameBtn.addEventListener('click', async () => {
                const newName = await AdminUI.prompt('New name for this set:', {
                    title: 'Rename Set',
                    defaultValue: set.name,
                    confirmLabel: 'Rename',
                    validate: (value) => {
                        if (!value) return 'Set name can\u2019t be empty.';
                        const newSlug = slugify(value);
                        if (newSlug !== set.slug && sets.some(s => s.slug === newSlug)) {
                            return 'Another set already has that name.';
                        }
                        return null;
                    }
                });
                if (newName === null) return; // cancelled
                const renamed = await renameSet(set.slug, newName);
                if (renamed) {
                    await refreshSetsUI(document.getElementById('set-search').value);
                }
            });
        }

        const upBtn = document.getElementById(`up-${safeId}`);
        if (upBtn && !isFirst) {
            upBtn.addEventListener('click', async () => {
                const above = sets[fullIndex - 1];
                await swapSetOrder(set.slug, above.slug);
                await refreshSetsUI(document.getElementById('set-search').value);
            });
        }

        const downBtn = document.getElementById(`down-${safeId}`);
        if (downBtn && !isLast) {
            downBtn.addEventListener('click', async () => {
                const below = sets[fullIndex + 1];
                await swapSetOrder(set.slug, below.slug);
                await refreshSetsUI(document.getElementById('set-search').value);
            });
        }

        const deleteBtn = document.getElementById(`delete-${safeId}`);
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                const confirmed = await AdminUI.confirm(
                    `Delete the set "${set.name}"? This removes its ${count} word${count === 1 ? '' : 's'} permanently.`,
                    { title: 'Delete Set', confirmLabel: 'Delete', danger: true }
                );
                if (!confirmed) return;
                await deleteSet(set.slug);
                if (currentSetSlug === set.slug) showSetsScreen();
                await refreshSetsUI(document.getElementById('set-search').value);
            });
        }
    });

    renderSetsGrid(sets);
}

// --- 11. ADMIN PANEL: KIOSK SETTINGS ---
document.getElementById('idle-timer-range').addEventListener('input', async (e) => {
    const seconds = parseInt(e.target.value, 10);
    document.getElementById('idle-timer-readout').innerText = `${seconds}s`;
    setIdleTimeSeconds(seconds);
    await saveKioskSettings({ idleTimeSeconds: seconds });
});

document.getElementById('autoplay-toggle').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    setAutoplayAudio(enabled);
    await saveKioskSettings({ autoplayAudio: enabled });
    AdminUI.status(document.getElementById('settings-status'),
        enabled ? 'Audio will autoplay when a word card is opened.' : 'Autoplay disabled.',
        { tone: 'ok' });
});

// --- 12. ADMIN PANEL: BACKUP & RESTORE ---
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
        a.download = `lexipic-kiosk-backup-${datePart}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        AdminUI.status(statusEl, `Backup downloaded (${payload.sets.length} set${payload.sets.length === 1 ? '' : 's'}).`, { tone: 'ok' });
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
            `This replaces everything currently loaded with the contents of this backup (${Array.isArray(payload.sets) ? payload.sets.length : '?'} set(s)). This can't be undone.`,
            { title: 'Restore From Backup', confirmLabel: 'Restore', danger: true }
        );
        e.target.value = '';
        if (!confirmed) return;

        try {
            const count = await restoreFromBackupPayload(payload);
            const settings = await getKioskSettings();
            setIdleTimeSeconds(settings.idleTimeSeconds);
            setAutoplayAudio(settings.autoplayAudio);
            document.getElementById('idle-timer-range').value = settings.idleTimeSeconds;
            document.getElementById('idle-timer-readout').innerText = `${settings.idleTimeSeconds}s`;
            document.getElementById('autoplay-toggle').checked = settings.autoplayAudio;

            showSetsScreen();
            await refreshSetsUI(document.getElementById('set-search').value);
            AdminUI.status(statusEl, `Restored ${count} set${count === 1 ? '' : 's'} from backup.`, { tone: 'ok' });
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
        'This permanently deletes every saved set from this kiosk\u2019s local storage. Back up first if you might need this data again.',
        { title: 'Flush System Database', confirmLabel: 'Flush', danger: true }
    );
    if (!confirmed) return;
    await flushDB();
    showSetsScreen();
    await refreshSetsUI();
    AdminUI.status(statusEl, 'All sets have been removed.', { tone: 'ok' });
});

// --- 13. HARDENED WINDOW INTERACTION CAPTURE ENGINE ---
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

// --- 14. BOOT ---
window.addEventListener('DOMContentLoaded', async () => {
    showSetsScreen();

    const settings = await getKioskSettings();
    setIdleTimeSeconds(settings.idleTimeSeconds);
    setAutoplayAudio(settings.autoplayAudio);
    document.getElementById('idle-timer-range').value = settings.idleTimeSeconds;
    document.getElementById('idle-timer-readout').innerText = `${settings.idleTimeSeconds}s`;
    document.getElementById('autoplay-toggle').checked = settings.autoplayAudio;

    await refreshSetsUI();
    startKioskHeartbeat();
});
