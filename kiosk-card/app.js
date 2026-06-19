// =============================================================================
// LexiPic Kiosk PWA — app.js
//
// Two source modes, chosen once and remembered across reloads:
//
//   URL mode  — displays a remote web page directly in a fullscreen
//               iframe (e.g. a LexiPic Kiosk WordPress site's own
//               kiosk page, like https://yoursite.com/?lexipic_kiosk=1
//               or a dedicated /kiosk/ URL). This PWA does not parse
//               or fetch JSON from it — it just shows the page, like a
//               kiosk browser pointed at a URL. If the page fails to
//               load (offline, DNS error, etc.) a small retry screen
//               appears and the app keeps attempting to reload it
//               automatically until it succeeds. The URL is saved in
//               localStorage and restored automatically on every reload.
//
//   USB mode  — user picks the "lexipic-kiosk-data" directory via the
//               File System Access API (showDirectoryPicker). The
//               directory must contain settings.json and one .json
//               file per set, in this app's own data format. This
//               mode renders its own tile grid + card slider UI
//               entirely client-side — no network needed at all. The
//               directory HANDLE itself (not just its name) is saved
//               in IndexedDB, since handles are structured-cloneable
//               but not JSON-serialisable. On reload the app re-opens
//               that saved handle and silently re-checks permission;
//               if the browser already granted it earlier, this needs
//               no user interaction at all. If permission was revoked
//               or the handle is unreadable, the setup screen asks for
//               a single tap to re-grant access — never the full
//               folder picker again unless the handle is gone entirely.
//
// SECURITY — URL allowlist + setup PIN (see REST-SPEC.md):
//   Any URL someone tries to save in URL mode is checked against a
//   domain allowlist fetched from ALLOWLIST_ENDPOINT (hosted on the
//   WordPress LexiPic Kiosk plugin). Only an exact hostname match is
//   accepted — no wildcards. Changing an ALREADY-configured source
//   (URL or USB) additionally requires a PIN, verified by calling
//   PIN_VERIFY_ENDPOINT — the SAME hashed, rate-limited PIN endpoint
//   the WordPress plugin already uses for its own on-screen kiosk
//   admin panel. There is no separate plaintext PIN for the PWA; both
//   the domain list and the PIN are managed entirely from wp-admin
//   without ever touching the kiosk's files. First-ever setup on a
//   fresh kiosk is not PIN-gated (nothing to protect yet). The
//   allowlist check fails CLOSED at save time: if the endpoint can't
//   be reached and nothing is cached from a previous successful
//   fetch, the action is blocked rather than allowed through
//   unchecked. The PIN check has no offline cache at all (caching a
//   PIN, even hashed, on the kiosk device would defeat the point of
//   reusing a server-verified endpoint) — it always requires network.
//
//   This is about INTEGRITY, not secrecy — the allowlist itself is not
//   meant to be secret, but a saved source must never keep displaying
//   once it's no longer approved, even if someone bypassed the save-
//   time UI check directly (e.g. via DevTools). So the saved URL is
//   re-validated against the live allowlist on every boot, and again
//   every few minutes while the kiosk is running (see
//   ALLOWLIST_RECHECK_MS) — a revoked or forcibly-injected URL won't
//   survive a reload, and won't stay up indefinitely even if injected
//   while already running. Unlike the save-time check, re-validation
//   does NOT fail closed on an unreachable endpoint — a network blip
//   must not turn into a full kiosk outage for a legitimately-saved
//   URL; it only rejects when the allowlist was actually reachable
//   and explicitly does not include the current domain. When a
//   periodic recheck DOES find a revoked URL, a short on-screen
//   countdown warns before disconnecting, and the check itself is
//   skipped if the iframe was loaded/reloaded too recently (our best
//   available proxy for "someone's likely engaged with it" — we can't
//   see clicks inside a cross-origin iframe).
//
// No server. No PHP. Just open index.html.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// 0. CONSTANTS + STATE
// ---------------------------------------------------------------------------
const STORAGE_KEY      = 'lexipic_source';      // localStorage key (mode + URL, when applicable)
const DB_NAME           = 'LexipicKioskDB';
const DB_VERSION        = 3; // bumped: v2 dbs lack the allowlist-cache store
const STORE_HANDLES    = 'dir-handles';          // stores the USB FileSystemDirectoryHandle itself
const STORE_ALLOWLIST  = 'allowlist-cache';      // caches the last-fetched domain allowlist + PIN
const HANDLE_KEY       = 'lexipic-kiosk-data';   // fixed key — only one USB source at a time
const ALLOWLIST_KEY    = 'lexipic-kiosk-allowlist'; // fixed key — single cached allowlist record
const IFRAME_RETRY_MS  = 8000; // retry interval after the iframe page fails to load

// Set this to your WordPress site's allowlist REST endpoint. See
// REST-SPEC.md for the exact response shape this URL must return.
// Leave blank to disable URL-mode source changes entirely until
// configured (the setup screen will explain why).
const ALLOWLIST_ENDPOINT = 'https://bishnupriyamanipurisahityasabha.com/wp-json/lexipic-kiosk/v1/allowlist';

// PIN verification reuses the WordPress LexiPic Kiosk plugin's EXISTING
// kiosk-admin PIN (hashed, rate-limited server-side) rather than a
// second plaintext PIN — see REST-SPEC.md section 2. Same site as
// ALLOWLIST_ENDPOINT; update both together if the site ever changes.
const PIN_VERIFY_ENDPOINT = 'https://bishnupriyamanipurisahityasabha.com/wp-json/lexipic-kiosk/v1/pin/verify';

let sourceConfig     = null;  // { mode:'url', url } | { mode:'usb', dirHandle, dirName }
let kioskAutoplay    = false;
let KIOSK_IDLE_MS    = 90000;
let lastActivity     = Date.now();
let idleInterval     = null;
let currentEntries   = [];
let currentSetSlug   = null;
let currentCardIdx   = 0;
let cardRenderToken  = 0;
let iframeRetryTimer = null;
let lastLoadErrors    = []; // sets listed in settings.json that failed to load this boot

// ---------------------------------------------------------------------------
// 1. SCREEN ELEMENTS
// ---------------------------------------------------------------------------
const setupScreen   = document.getElementById('screen-setup');
const iframeScreen  = document.getElementById('screen-iframe');
const kioskRoot      = document.getElementById('kiosk-root');
const changeSourceBtn = document.getElementById('btn-change-source');

function hideAllScreens() {
    setupScreen.style.display = 'none';
    iframeScreen.style.display = 'none';
    kioskRoot.classList.remove('visible');
    changeSourceBtn.classList.remove('visible');
}

function showSetupScreen(errorMsg) {
    stopKioskHeartbeat();
    stopIframeRetry();
    stopAllowlistWatchdog();
    hideAllScreens();
    setupScreen.style.display = 'flex';
    if (errorMsg) setSetupStatus(errorMsg, false);
}

function showIframeScreen() {
    hideAllScreens();
    iframeScreen.style.display = 'block';
    changeSourceBtn.classList.add('visible');
}

function showKioskRoot() {
    hideAllScreens();
    kioskRoot.classList.add('visible');
    changeSourceBtn.classList.add('visible');
}

// ---------------------------------------------------------------------------
// 2. MODE TABS (setup screen)
// ---------------------------------------------------------------------------
document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.mode));
});

function activateTab(mode) {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    document.querySelectorAll('.setup-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + mode));
}

function setSetupStatus(msg, isOk) {
    const el = document.getElementById('setup-status');
    el.textContent = msg;
    el.className = 'setup-status' + (isOk ? ' ok' : '');
}

// ---------------------------------------------------------------------------
// 3. URL MODE — iframe display
// ---------------------------------------------------------------------------

document.getElementById('btn-start-url').addEventListener('click', async () => {
    const url = document.getElementById('input-url').value.trim();
    if (!url) { setSetupStatus('Please enter a URL.', false); return; }
    try { new URL(url); } catch (_) { setSetupStatus('That doesn\'t look like a valid URL.', false); return; }

    setSetupStatus('Checking this URL is approved…', true);
    const check = await checkUrlAllowed(url);
    if (!check.allowed) {
        // If verification failed because the allowlist is unreachable
        // (not because the domain was actively rejected), and a USB
        // source was configured previously on this device, offer to
        // fall back to that rather than leaving a dead end.
        const unreachable = check.reason.startsWith('Could not verify');
        if (unreachable) {
            let hadUsb = false;
            try { hadUsb = !!(await loadDirHandle()); } catch (_) {}
            if (hadUsb) {
                setSetupStatus(check.reason + ' Switching to your saved USB folder instead…', true);
                activateTab('usb');
                await restoreUsbSource();
                return;
            }
        }
        setSetupStatus(check.reason, false);
        return;
    }

    saveSourceAndBoot({ mode: 'url', url });
});

function bootUrlMode() {
    showIframeScreen();
    loadIframe();
}

function loadIframe() {
    stopIframeRetry();
    const iframe   = document.getElementById('kiosk-iframe');
    const errorBox = document.getElementById('iframe-error');

    errorBox.style.display = 'none';
    iframe.style.display = 'block';

    let settled = false;

    const onLoad = () => {
        settled = true;
        iframe.removeEventListener('load', onLoad);
        iframe.removeEventListener('error', onError);
        handleUserActivity();
    };

    const onError = () => {
        if (settled) return;
        settled = true;
        iframe.removeEventListener('load', onLoad);
        iframe.removeEventListener('error', onError);
        showIframeError('Connection failed. Retrying…');
        scheduleIframeRetry();
    };

    iframe.addEventListener('load', onLoad);
    iframe.addEventListener('error', onError);

    // Many cross-origin load failures (DNS down, refused connection) don't
    // fire iframe 'error' reliably across browsers, so also race a timeout:
    // if neither load nor error fired within a few seconds, assume failure.
    setTimeout(() => {
        if (!settled) {
            // We can't always tell if a cross-origin iframe truly loaded vs
            // is just slow, so only treat as failure if navigator says we're
            // offline — otherwise give it more time silently.
            if (!navigator.onLine) {
                settled = true;
                iframe.removeEventListener('load', onLoad);
                iframe.removeEventListener('error', onError);
                showIframeError('No internet connection. Retrying…');
                scheduleIframeRetry();
            }
        }
    }, 6000);

    iframe.src = sourceConfig.url;
}

function showIframeError(msg) {
    document.getElementById('kiosk-iframe').style.display = 'none';
    document.getElementById('iframe-error-msg').textContent = msg;
    document.getElementById('iframe-error').style.display = 'flex';
}

function scheduleIframeRetry() {
    stopIframeRetry();
    iframeRetryTimer = setTimeout(() => {
        if (sourceConfig && sourceConfig.mode === 'url') loadIframe();
    }, IFRAME_RETRY_MS);
}

function stopIframeRetry() {
    if (iframeRetryTimer) { clearTimeout(iframeRetryTimer); iframeRetryTimer = null; }
}

// Reload immediately when the browser regains connectivity.
window.addEventListener('online', () => {
    if (sourceConfig && sourceConfig.mode === 'url' && iframeScreen.style.display === 'block') {
        loadIframe();
    }
});

// ---------------------------------------------------------------------------
// 4. USB MODE — native kiosk UI
// ---------------------------------------------------------------------------

/**
 * FileSystemDirectoryHandle can't go in localStorage (not JSON-able), but
 * it IS structured-cloneable, so IndexedDB can store it directly. This is
 * what lets USB mode survive a page refresh without re-opening the folder
 * picker every time — only a one-tap permission re-grant is needed.
 *
 * Also doubles as the cache for the remote URL allowlist + setup PIN
 * (see ALLOWLIST_ENDPOINT), so URL-mode source changes still work
 * briefly offline using the last successfully-fetched copy.
 *
 * Self-healing: if a database from an older build of this app already
 * exists locally missing one of these stores (onupgradeneeded only runs
 * when DB_VERSION increases), this detects that and transparently
 * deletes + recreates the database rather than failing every save/load
 * forever.
 */
function openAppDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_HANDLES))   db.createObjectStore(STORE_HANDLES);
            if (!db.objectStoreNames.contains(STORE_ALLOWLIST)) db.createObjectStore(STORE_ALLOWLIST);
        };
        req.onsuccess = () => {
            const db = req.result;
            if (db.objectStoreNames.contains(STORE_HANDLES) && db.objectStoreNames.contains(STORE_ALLOWLIST)) {
                resolve(db);
                return;
            }
            // Stale DB from an old build, somehow still missing a store
            // even after the version bump above — nuke and rebuild once.
            db.close();
            const del = indexedDB.deleteDatabase(DB_NAME);
            del.onsuccess = () => openAppDB().then(resolve, reject);
            del.onerror   = () => reject(del.error);
        };
    });
}

async function saveDirHandle(handle) {
    const db = await openAppDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_HANDLES, 'readwrite');
        tx.objectStore(STORE_HANDLES).put(handle, HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
    });
}

async function loadDirHandle() {
    const db = await openAppDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_HANDLES, 'readonly').objectStore(STORE_HANDLES).get(HANDLE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => reject(req.error);
    });
}

async function clearDirHandle() {
    const db = await openAppDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_HANDLES, 'readwrite');
        tx.objectStore(STORE_HANDLES).delete(HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
    });
}

/**
 * Checks/requests read permission on a previously-saved handle. Browsers
 * intentionally don't auto-grant this across reloads for security — but
 * if the user already granted it earlier in this browser, 'granted' often
 * comes back immediately with no visible prompt. Otherwise this resolves
 * to a single permission dialog rather than the full directory picker.
 */
async function ensureHandlePermission(handle) {
    const opts = { mode: 'read' };
    if (await handle.queryPermission(opts) === 'granted') return true;
    if (await handle.requestPermission(opts) === 'granted') return true;
    return false;
}

// ---------------------------------------------------------------------------
// 4b. URL SECURITY — domain allowlist + setup PIN
// ---------------------------------------------------------------------------
//
// Both the allowlist and the PIN come from one remote endpoint hosted on
// the WordPress LexiPic Kiosk plugin (see REST-SPEC.md). This means
// updating either is just a wp-admin edit — no kiosk file changes, no
// redeploying the PWA. The last successful response is cached in
// IndexedDB so a brief network blip doesn't block a legitimate source
// change; if nothing has ever been cached and the endpoint can't be
// reached, the operation is blocked rather than allowed through
// unchecked (fail closed, never fail open).

async function saveAllowlistCache(data) {
    const db = await openAppDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ALLOWLIST, 'readwrite');
        tx.objectStore(STORE_ALLOWLIST).put(data, ALLOWLIST_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
    });
}

async function loadAllowlistCache() {
    const db = await openAppDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_ALLOWLIST, 'readonly').objectStore(STORE_ALLOWLIST).get(ALLOWLIST_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => reject(req.error);
    });
}

/**
 * Fetches the allowlist+PIN endpoint, caching on success and falling
 * back to the cached copy on any failure. Returns null only if neither
 * a fresh fetch nor a cached copy is available — callers must treat
 * null as "verification impossible" and fail closed accordingly.
 */
async function getAllowlistData() {
    if (!ALLOWLIST_ENDPOINT) return loadAllowlistCache().catch(() => null);

    try {
        const res = await fetch(ALLOWLIST_ENDPOINT, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data || !Array.isArray(data.domains)) throw new Error('Malformed response');
        await saveAllowlistCache(data).catch(() => {}); // cache failure shouldn't block using the fresh data
        return data;
    } catch (err) {
        console.warn('Allowlist fetch failed, trying cache:', err.message);
        return loadAllowlistCache().catch(() => null);
    }
}

/**
 * Checks a candidate URL's hostname against the allowlist. Returns
 * { allowed: bool, reason?: string }. Fails closed: any inability to
 * verify (no endpoint configured, fetch failed AND no cache) results
 * in allowed:false with an explanatory reason.
 */
async function checkUrlAllowed(candidateUrl) {
    let hostname;
    try { hostname = new URL(candidateUrl).hostname.toLowerCase(); }
    catch (_) { return { allowed: false, reason: 'That doesn\'t look like a valid URL.' }; }

    const data = await getAllowlistData();
    if (!data) {
        return {
            allowed: false,
            reason: 'Could not verify this URL against the approved list (no connection, and nothing cached yet). Try again once online.',
        };
    }

    const allowedDomains = (data.domains || []).map(d => String(d).toLowerCase());
    if (allowedDomains.includes(hostname)) return { allowed: true };

    return {
        allowed: false,
        reason: `"${hostname}" isn't on the approved domain list. Contact the site administrator to add it.`,
    };
}

/**
 * Verifies an entered PIN by calling the WordPress plugin's EXISTING
 * kiosk-admin PIN endpoint (hashed server-side, rate-limited) instead
 * of comparing a plaintext value fetched alongside the allowlist. This
 * needs network access every time — unlike the allowlist, the PIN
 * check has no offline cache, since caching a PIN (even hashed) on the
 * kiosk device would reintroduce exactly the weakness reusing this
 * endpoint was meant to avoid. Returns { ok: bool, reason?: string }.
 */
async function checkSetupPin(enteredPin) {
    if (!PIN_VERIFY_ENDPOINT) {
        return { ok: false, reason: 'PIN verification isn\'t configured on this kiosk.' };
    }

    try {
        const res = await fetch(PIN_VERIFY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: enteredPin }),
        });

        if (res.status === 429) {
            return { ok: false, reason: 'Too many attempts. Please wait a minute and try again.' };
        }
        if (!res.ok) {
            return { ok: false, reason: 'Incorrect PIN.' };
        }

        return { ok: true };
    } catch (err) {
        console.warn('PIN verify request failed:', err.message);
        return { ok: false, reason: 'Could not verify the PIN right now (no connection). Try again once online.' };
    }
}

/**
 * True if a source has already been configured at least once on this
 * device. Used to decide whether the PIN gate applies — first-ever
 * setup never requires a PIN, only CHANGING an existing source does.
 */
function hasExistingSource() {
    return !!localStorage.getItem(STORAGE_KEY);
}

/**
 * Shows a small inline PIN prompt and resolves true/false based on
 * the result. Reuses the setup-status styling for error feedback.
 */
async function promptForPin() {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'pin-overlay';
        overlay.innerHTML = `
            <div class="pin-card">
                <h3>Enter PIN to change source</h3>
                <input type="password" inputmode="numeric" autocomplete="off" id="pin-input" class="setup-input" placeholder="PIN">
                <div class="pin-actions">
                    <button type="button" id="pin-cancel" class="setup-btn pin-btn-secondary">Cancel</button>
                    <button type="button" id="pin-submit" class="setup-btn">Unlock</button>
                </div>
                <div id="pin-status" class="setup-status"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        const input  = overlay.querySelector('#pin-input');
        const status = overlay.querySelector('#pin-status');
        input.focus();

        const cleanup = (result) => { overlay.remove(); resolve(result); };

        overlay.querySelector('#pin-cancel').addEventListener('click', () => cleanup(false));

        const submit = async () => {
            const pin = input.value.trim();
            if (!pin) { status.textContent = 'Enter a PIN.'; status.className = 'setup-status'; return; }
            status.textContent = 'Checking…';
            status.className = 'setup-status ok';
            const result = await checkSetupPin(pin);
            if (result.ok) { cleanup(true); return; }
            status.textContent = result.reason;
            status.className = 'setup-status';
            input.value = '';
            input.focus();
        };

        overlay.querySelector('#pin-submit').addEventListener('click', submit);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    });
}

document.getElementById('btn-start-usb').addEventListener('click', async () => {
    if (!('showDirectoryPicker' in window)) {
        setSetupStatus('Your browser doesn\'t support the File System Access API. Use Chrome 86+ or Edge 86+.', false);
        return;
    }
    try {
        setSetupStatus('Select your "lexipic-kiosk-data" folder…', true);
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        try { await dirHandle.getFileHandle('settings.json'); }
        catch (_) {
            setSetupStatus('No settings.json found in that folder. Make sure you selected the "lexipic-kiosk-data" directory.', false);
            return;
        }
        setSetupStatus('Loading…', true);
        saveSourceAndBoot({ mode: 'usb', dirHandle, dirName: dirHandle.name });
    } catch (err) {
        if (err.name !== 'AbortError') setSetupStatus('Could not open folder: ' + err.message, false);
        else setSetupStatus('', true);
    }
});

async function bootUsbMode() {
    try {
        const settings = await getKioskSettings();
        setIdleTimeSeconds(settings.idle_time_seconds || 90);
        setAutoplayAudio(!!settings.autoplay_audio);

        const sets = await getAllSets();

        showKioskRoot();
        showSetsScreen();
        renderSetsGrid(sets);
        renderLoadErrorBanner();
        startKioskHeartbeat();
    } catch (err) {
        console.error('Boot error:', err);
        showSetupScreen('Could not load data: ' + (err.message || 'Unknown error'));
    }
}

// ---------------------------------------------------------------------------
// 5. SOURCE CONFIG — save / restore / boot dispatch
// ---------------------------------------------------------------------------

async function saveSourceAndBoot(config) {
    sourceConfig = config;

    const toStore = { mode: config.mode };
    if (config.mode === 'url') toStore.url = config.url;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));

    if (config.mode === 'usb') {
        try { await saveDirHandle(config.dirHandle); }
        catch (err) { console.warn('Could not persist folder handle:', err); }
    } else {
        try { await clearDirHandle(); } catch (_) {}
    }

    await boot();
}

async function restoreAndBoot() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { showSetupScreen(); return; }

    let saved;
    try { saved = JSON.parse(raw); } catch (_) { showSetupScreen(); return; }

    if (saved.mode === 'usb') {
        await restoreUsbSource();
        return;
    }

    sourceConfig = saved;
    document.getElementById('input-url').value = saved.url || '';
    await boot();
}

/**
 * Attempts to restore USB mode from the handle saved in IndexedDB,
 * without showing the folder picker. Falls back to asking the user to
 * re-select only if no handle was saved, or permission is denied.
 */
async function restoreUsbSource() {
    activateTab('usb');

    let handle;
    try { handle = await loadDirHandle(); }
    catch (err) { console.warn('Could not read saved folder handle:', err); }

    if (!handle) {
        showSetupScreen();
        setSetupStatus('Re-select your "lexipic-kiosk-data" folder to continue.', true);
        return;
    }

    showSetupScreen();
    setSetupStatus('Reconnecting to your USB folder…', true);

    const granted = await ensureHandlePermission(handle).catch(() => false);
    if (!granted) {
        setSetupStatus('Tap "Select folder…" to re-grant access to your USB drive.', false);
        return;
    }

    try {
        await handle.getFileHandle('settings.json'); // sanity check it's still the right folder
    } catch (_) {
        setSetupStatus('settings.json is no longer in that folder. Please re-select it.', false);
        await clearDirHandle().catch(() => {});
        return;
    }

    sourceConfig = { mode: 'usb', dirHandle: handle, dirName: handle.name };
    await boot();
}

async function boot() {
    if (sourceConfig.mode === 'url') {
        await bootUrlModeWithRevalidation();
    } else {
        await bootUsbMode();
    }
}

/**
 * URL mode is re-validated against the live allowlist on every boot —
 * not just at the moment a URL is saved. This closes two real gaps:
 *   1. A URL forced into storage by bypassing the UI (e.g. via DevTools,
 *      calling saveSourceAndBoot directly) won't survive a reload.
 *   2. A domain that was approved when saved but later REMOVED from the
 *      allowlist stops being displayed on the next boot, not indefinitely.
 * If the allowlist can't be reached at all (offline, endpoint down) AND
 * nothing is cached, we do NOT block the kiosk from running — that would
 * turn a network hiccup into a full outage for a legitimately-saved,
 * previously-approved URL. We only reject when the allowlist was
 * actually reachable (fresh or cached) and explicitly does not include
 * this domain.
 */
async function bootUrlModeWithRevalidation() {
    const check = await checkUrlAllowed(sourceConfig.url);

    if (!check.allowed && !check.reason.startsWith('Could not verify')) {
        // Allowlist WAS reachable and explicitly rejected this domain —
        // someone bypassed the save-time check, or it was removed since.
        // Don't display it. Clear the bad source and fall back.
        localStorage.removeItem(STORAGE_KEY);
        sourceConfig = null;

        let hadUsb = false;
        try { hadUsb = !!(await loadDirHandle()); } catch (_) {}
        if (hadUsb) {
            activateTab('usb');
            showSetupScreen();
            setSetupStatus('The previously saved URL is no longer approved. Reconnecting to your USB folder instead…', true);
            await restoreUsbSource();
            return;
        }

        activateTab('url');
        showSetupScreen('The previously saved URL is no longer on the approved list. Please enter an approved URL.');
        return;
    }

    bootUrlMode();
    startAllowlistWatchdog();
}

const ALLOWLIST_RECHECK_MS    = 5 * 60 * 1000; // how often to re-check while the iframe is live
const RECHECK_QUIET_PERIOD_MS = 90 * 1000;     // skip a scheduled check if the iframe (re)loaded more recently than this
const DISCONNECT_WARNING_MS   = 10 * 1000;     // countdown shown before actually disconnecting a revoked URL

let allowlistWatchdogTimer = null;
let disconnectCountdownTimer = null;

function startAllowlistWatchdog() {
    stopAllowlistWatchdog();
    allowlistWatchdogTimer = setInterval(async () => {
        if (!sourceConfig || sourceConfig.mode !== 'url') return;

        // We can't see clicks inside the iframe (cross-origin), so the best
        // available proxy for "someone's likely engaged with this" is how
        // recently it was (re)loaded — loadIframe() calls handleUserActivity()
        // on every successful load. If that was recent, skip this cycle
        // rather than interrupting what's probably an active session; the
        // next interval will simply check again later.
        if (Date.now() - lastActivity < RECHECK_QUIET_PERIOD_MS) return;

        const check = await checkUrlAllowed(sourceConfig.url);
        if (!check.allowed && !check.reason.startsWith('Could not verify')) {
            beginDisconnectCountdown();
        }
    }, ALLOWLIST_RECHECK_MS);
}

function stopAllowlistWatchdog() {
    if (allowlistWatchdogTimer) { clearInterval(allowlistWatchdogTimer); allowlistWatchdogTimer = null; }
    cancelDisconnectCountdown();
}

/**
 * Shows a brief on-screen warning over the iframe before actually
 * disconnecting a revoked URL, instead of yanking it away with zero
 * notice. Purely cosmetic softening — the disconnect itself is not
 * delayed beyond DISCONNECT_WARNING_MS, since the integrity guarantee
 * (don't keep showing a revoked URL) matters more than a smooth exit.
 */
function beginDisconnectCountdown() {
    if (disconnectCountdownTimer) return; // already counting down
    stopAllowlistWatchdog(); // no further checks needed; we're already disconnecting

    const banner = document.createElement('div');
    banner.id = 'disconnect-warning';
    banner.innerHTML = `
        <span class="material-icons">link_off</span>
        <div>
            <strong>This page is no longer approved</strong>
            <p>Disconnecting in <span id="disconnect-countdown">${DISCONNECT_WARNING_MS / 1000}</span>s…</p>
        </div>
    `;
    iframeScreen.appendChild(banner);

    let remaining = DISCONNECT_WARNING_MS / 1000;
    const countdownEl = banner.querySelector('#disconnect-countdown');

    disconnectCountdownTimer = setInterval(() => {
        remaining -= 1;
        if (countdownEl) countdownEl.textContent = remaining;
        if (remaining <= 0) {
            clearInterval(disconnectCountdownTimer);
            disconnectCountdownTimer = null;
            disconnectRevokedUrl();
        }
    }, 1000);
}

function cancelDisconnectCountdown() {
    if (disconnectCountdownTimer) { clearInterval(disconnectCountdownTimer); disconnectCountdownTimer = null; }
    const banner = document.getElementById('disconnect-warning');
    if (banner) banner.remove();
}

function disconnectRevokedUrl() {
    localStorage.removeItem(STORAGE_KEY);
    sourceConfig = null;
    activateTab('url');
    showSetupScreen('This URL is no longer on the approved list and has been disconnected. Please enter an approved URL.');
}

// "Change source" button — works from either mode. PIN-gated, since a
// source is already configured and working at this point (first-ever
// setup never reaches this button — there's nothing to "change" yet).
changeSourceBtn.addEventListener('click', async () => {
    if (hasExistingSource()) {
        const granted = await promptForPin();
        if (!granted) return;
    }
    showSetupScreen();
    if (sourceConfig) activateTab(sourceConfig.mode);
});

// ---------------------------------------------------------------------------
// 6. USB MODE DATA — file reading
// ---------------------------------------------------------------------------

async function readJsonFile(dirHandle, filename) {
    const fh   = await dirHandle.getFileHandle(filename);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
}

/**
 * Resolve an image/audio value to a usable src. If it's already a
 * data-URI or remote URL, pass through. If it's a plain filename,
 * read that file from the USB directory and convert to a data-URI.
 */
async function resolveMedia(value, dirHandle) {
    if (!value) return '';
    if (value.startsWith('data:') || value.startsWith('http') || value.startsWith('blob:')) return value;
    try {
        const fh   = await dirHandle.getFileHandle(value);
        const file = await fh.getFile();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    } catch (_) {
        return ''; // File not found — omit silently.
    }
}

const LANG_LABELS = {
    bpm: 'Bishnupriya Manipuri (ইমার ঠার)',
    as:  'Assamese (অসমীয়া)',
    bn:  'Bengali (বাংলা)',
};

async function getKioskSettings() {
    const config = await readJsonFile(sourceConfig.dirHandle, 'settings.json');
    return config.kiosk || { idle_time_seconds: 90, autoplay_audio: false };
}

async function getAllSets() {
    const config = await readJsonFile(sourceConfig.dirHandle, 'settings.json');
    const layers = Array.isArray(config.layers) ? config.layers : [];
    const sets   = [];
    const errors = [];

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (!layer.enabled) continue;
        const slug = layer.slug;
        if (!slug) continue;

        try {
            const set  = await readJsonFile(sourceConfig.dirHandle, slug + '.json');
            const meta = set.set || set;
            const lang = meta.language || 'bpm';
            sets.push({
                slug,
                name:          layer.name || meta.name || slug,
                group:         layer.group || '',
                language:      lang,
                languageLabel: meta.languageLabel || LANG_LABELS[lang] || lang.toUpperCase(),
                entryCount:    Array.isArray(set.entries) ? set.entries.length : 0,
                active:        true,
                order:         i,
            });
        } catch (err) {
            // Most common cause: the filename doesn't exactly match the
            // slug (case, spelling, extra spaces). Surface this instead
            // of silently dropping the tile — a missing tile with no
            // explanation is the hardest kind of bug to self-diagnose.
            const reason = (err && err.name === 'NotFoundError')
                ? `File "${slug}.json" not found in the data folder.`
                : `File "${slug}.json" couldn't be read (${err.message || 'invalid JSON'}).`;
            errors.push({ slug, name: layer.name || slug, reason });
        }
    }

    lastLoadErrors = errors;
    return sets;
}

async function getSetWithEntries(slug) {
    const raw  = await readJsonFile(sourceConfig.dirHandle, slug + '.json');
    const meta = raw.set || raw;
    const lang = meta.language || 'bpm';

    const rawEntries = Array.isArray(raw.entries) ? raw.entries : [];
    const entries = await Promise.all(rawEntries.map(async (e, i) => ({
        id:          e.id ?? i,
        word_script: e.word_script || e.heritage || '',
        word_roman:  e.word_roman  || e.transliteration || '',
        description: e.description || '',
        image:       await resolveMedia(e.image || '', sourceConfig.dirHandle),
        audio:       await resolveMedia(e.audio || '', sourceConfig.dirHandle),
    })));

    const config = await readJsonFile(sourceConfig.dirHandle, 'settings.json');
    const layerOverride = (config.layers || []).find(l => l.slug === slug);

    return {
        slug,
        name:          (layerOverride && layerOverride.name) || meta.name || slug,
        language:      lang,
        languageLabel: meta.languageLabel || LANG_LABELS[lang] || lang.toUpperCase(),
        entries,
    };
}

// ---------------------------------------------------------------------------
// 7. IDLE TIMER (USB mode only — iframe mode has no concept of idle reset)
// ---------------------------------------------------------------------------

function setIdleTimeSeconds(s) { KIOSK_IDLE_MS = Math.max(5, Math.round(s)) * 1000; }
function setAutoplayAudio(b)   { kioskAutoplay = !!b; }
function handleUserActivity()  { lastActivity = Date.now(); }

function startKioskHeartbeat() {
    stopKioskHeartbeat();
    idleInterval = setInterval(() => {
        if (Date.now() - lastActivity >= KIOSK_IDLE_MS) {
            returnToSetsScreen();
            lastActivity = Date.now();
        }
    }, 1000);
}

function stopKioskHeartbeat() {
    if (idleInterval) { clearInterval(idleInterval); idleInterval = null; }
}

// ---------------------------------------------------------------------------
// 8. SCREEN NAVIGATION (USB mode)
// ---------------------------------------------------------------------------

function showSetsScreen() {
    document.getElementById('screen-sets').classList.remove('lp-screen-hidden');
    document.getElementById('screen-archive').classList.remove('lp-screen-active');
    document.getElementById('back-to-sets-btn').style.display = 'none';
    currentSetSlug = null;
}

function showArchiveScreen() {
    document.getElementById('screen-sets').classList.add('lp-screen-hidden');
    document.getElementById('screen-archive').classList.add('lp-screen-active');
    document.getElementById('back-to-sets-btn').style.display = 'inline-flex';
}

function returnToSetsScreen() {
    if (currentSetSlug !== null) showSetsScreen();
}

document.getElementById('back-to-sets-btn').addEventListener('click', () => {
    handleUserActivity();
    showSetsScreen();
});

// ---------------------------------------------------------------------------
// 9. SETS GRID (USB mode)
// ---------------------------------------------------------------------------

function renderSetsGrid(sets) {
    const grid    = document.getElementById('sets-grid');
    const emptyEl = document.getElementById('sets-empty');
    const active  = sets.filter(s => s.active !== false);

    if (active.length === 0) {
        grid.innerHTML = '';
        emptyEl.style.display = 'flex';
        return;
    }
    emptyEl.style.display = 'none';

    const groupOrder = [];
    const seen = {};
    active.forEach(s => {
        const g = s.group || '';
        if (!seen[g]) { seen[g] = true; groupOrder.push(g); }
    });

    let html = '';
    groupOrder.forEach(group => {
        const groupSets = active.filter(s => (s.group || '') === group);
        if (group) html += `<div class="group-header">${escHtml(group)}</div>`;
        groupSets.forEach(set => {
            const count = typeof set.entryCount === 'number'
                ? set.entryCount
                : (Array.isArray(set.entries) ? set.entries.length : 0);
            html += `
            <div class="lp-set-tile" data-slug="${escHtml(set.slug)}" role="button" tabindex="0" aria-label="Open ${escHtml(set.name)}">
			  <div class="lp-set-tile-header">
                <div class="lp-set-tile-icon"><span class="material-icons">menu_book</span></div>
                <div class="lp-set-tile-name">${escHtml(set.name)}</div>
			  </div>
                <div class="lp-set-tile-meta"><span class="material-icons">translate</span>${escHtml(set.languageLabel || set.language || '')}</div>
                <div class="lp-set-tile-count"><span class="material-icons">collections_bookmark</span>${count} word${count === 1 ? '' : 's'}</div>
            </div>`;
        });
    });

    grid.innerHTML = html;

    grid.querySelectorAll('.lp-set-tile').forEach(tile => {
        const open = () => { handleUserActivity(); openSetArchive(tile.dataset.slug); };
        tile.addEventListener('click', open);
        tile.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
    });
}

/**
 * Shows a small dismissible banner listing any sets from settings.json
 * that failed to load this boot (usually a filename/slug mismatch).
 * Without this, a missing tile is silent and very hard to self-diagnose
 * from the kiosk screen alone.
 */
function renderLoadErrorBanner() {
    const existing = document.getElementById('load-error-banner');
    if (existing) existing.remove();
    if (!lastLoadErrors || lastLoadErrors.length === 0) return;

    const banner = document.createElement('div');
    banner.id = 'load-error-banner';
    banner.innerHTML = `
        <span class="material-icons">error_outline</span>
        <div class="load-error-text">
            <strong>${lastLoadErrors.length} set${lastLoadErrors.length === 1 ? '' : 's'} could not be loaded:</strong>
            ${lastLoadErrors.map(e => `<div>${escHtml(e.name)} — ${escHtml(e.reason)}</div>`).join('')}
        </div>
        <button type="button" aria-label="Dismiss">&times;</button>
    `;
    banner.querySelector('button').addEventListener('click', () => banner.remove());
    document.getElementById('screen-sets').prepend(banner);
}

async function openSetArchive(slug) {
    document.getElementById('archive-set-title-text').textContent = 'Loading…';
    document.getElementById('archive-set-meta').textContent  = '';
    document.getElementById('lp-archive-slider').innerHTML   =
        '<div style="display:flex;align-items:center;justify-content:center;height:100%;"><div class="spinner"></div></div>';
    showArchiveScreen();

    try {
        const set = await getSetWithEntries(slug);
        if (!set) throw new Error('Set not found');

        currentSetSlug = slug;
        currentCardIdx = 0;

        document.getElementById('archive-set-title-text').textContent = set.name;
        document.getElementById('archive-set-meta').textContent  =
            `${set.languageLabel || set.language || ''} · ${set.entries.length} word${set.entries.length === 1 ? '' : 's'}`;

        renderCards(set.entries);
        if (kioskAutoplay && set.entries[0]) playAudio(set.entries[0].audio);
    } catch (err) {
        document.getElementById('archive-set-title-text').textContent = 'Could not load set';
        document.getElementById('archive-set-meta').textContent  = err.message;
        document.getElementById('lp-archive-slider').innerHTML   = '';
    }
}

// ---------------------------------------------------------------------------
// 10. CARD SLIDER (USB mode)
// ---------------------------------------------------------------------------

const FIRST_BATCH = 6;
const CHUNK_SIZE  = 10;

function buildCardHtml(e, i) {
    const label = e.word_script || e.word_roman || '';
    const sub   = (e.word_script && e.word_roman)
        ? `<span class="lp-roman-display">${escHtml(e.word_roman)}</span>` : '';
    const desc  = e.description
        ? `<p class="lp-card-desc">${escHtml(e.description)}</p>` : '';
    const img   = e.image
        ? `<img src="${escHtml(e.image)}" alt="${escHtml(label)}" loading="lazy">`
        : `<div class="lp-card-no-img"><span class="material-icons" style="font-size:48px;">image</span><span style="font-size:12px;">No image</span></div>`;

    return `
    <div class="lp-card-slot">
        <div class="lp-card" role="listitem" data-index="${i}">
            <div class="lp-card-media">${img}</div>
            <div class="lp-card-body">
                <div class="lp-card-title">
                    <span class="lp-script-display">${escHtml(label)}</span>
                    ${sub}
                </div>
                ${desc}
                ${e.audio ? `<div class="lp-card-actions">
                    <button class="lp-play-btn" data-audio="${escHtml(e.audio)}" aria-label="Play audio for ${escHtml(label)}">
                        <span class="material-icons" style="font-size:18px;">volume_up</span> Play
                    </button></div>` : ''}
            </div>
        </div>
    </div>`;
}

function wireCards(container) {
    container.querySelectorAll('.lp-play-btn:not([data-wired])').forEach(btn => {
        btn.dataset.wired = '1';
        btn.addEventListener('click', e => {
            e.stopPropagation();
            handleUserActivity();
            playAudio(btn.dataset.audio);
        });
    });
}

function renderCards(entries) {
    const slider   = document.getElementById('lp-archive-slider');
    const myToken  = ++cardRenderToken;
    currentEntries = entries || [];
    slider.innerHTML = '';

    if (!entries || entries.length === 0) {
        updateNavButtons();
        updateProgressUI(0, 0);
        return;
    }

    const appendRange = (start, end) => {
        slider.insertAdjacentHTML('beforeend',
            entries.slice(start, end).map((e, idx) => buildCardHtml(e, start + idx)).join('')
        );
        wireCards(slider);
    };

    appendRange(0, Math.min(FIRST_BATCH, entries.length));
    updateNavButtons();
    updateProgressUI(1, entries.length);

    if (entries.length > FIRST_BATCH) {
        let next = FIRST_BATCH;
        const chunk = () => {
            if (myToken !== cardRenderToken || next >= entries.length) return;
            appendRange(next, Math.min(next + CHUNK_SIZE, entries.length));
            next += CHUNK_SIZE;
            updateNavButtons();
            if (next < entries.length) scheduleIdle(chunk);
        };
        scheduleIdle(chunk);
    }
}

function scheduleIdle(fn) {
    typeof requestIdleCallback === 'function'
        ? requestIdleCallback(fn, { timeout: 500 })
        : setTimeout(fn, 32);
}

function playAudio(src) {
    if (!src) return;
    new Audio(src).play().catch(() => {});
}

function updateProgressUI(current, total) {
    const el = document.getElementById('archive-progress');
    if (el) el.textContent = total > 0 ? `${current} / ${total}` : '';
}

let scrollSettleTO = null;

function updateProgressFromScroll(total) {
    const slider = document.getElementById('lp-archive-slider');
    if (!slider || total === 0) return;
    const slot = slider.querySelector('.lp-card-slot');
    if (!slot || !slot.offsetWidth) return;
    const idx = Math.min(Math.max(Math.round(slider.scrollLeft / slot.offsetWidth), 0), total - 1);
    if (idx !== currentCardIdx) {
        currentCardIdx = idx;
        updateProgressUI(currentCardIdx + 1, total);
    }
    clearTimeout(scrollSettleTO);
    scrollSettleTO = setTimeout(() => {
        if (kioskAutoplay && currentEntries[currentCardIdx]) {
            playAudio(currentEntries[currentCardIdx].audio);
        }
    }, 150);
}

function cardWidth() {
    const slider = document.getElementById('lp-archive-slider');
    const slot   = slider && slider.querySelector('.lp-card-slot');
    return slot ? slot.offsetWidth : 0;
}

document.getElementById('lp-next-btn').addEventListener('click', () => {
    handleUserActivity();
    document.getElementById('lp-archive-slider').scrollBy({ left: cardWidth(), behavior: 'smooth' });
});
document.getElementById('lp-prev-btn').addEventListener('click', () => {
    handleUserActivity();
    document.getElementById('lp-archive-slider').scrollBy({ left: -cardWidth(), behavior: 'smooth' });
});
document.getElementById('lp-archive-slider').addEventListener('scroll', () => {
    updateNavButtons();
    updateProgressFromScroll(currentEntries.length);
});

function updateNavButtons() {
    const slider = document.getElementById('lp-archive-slider');
    if (!slider) return;
    const atStart = slider.scrollLeft <= 5;
    const atEnd   = slider.scrollLeft >= slider.scrollWidth - slider.clientWidth - 5;
    document.getElementById('lp-prev-btn').style.display = atStart ? 'none' : 'flex';
    document.getElementById('lp-next-btn').style.display = atEnd   ? 'none' : 'flex';
}

// ---------------------------------------------------------------------------
// 11. DOM HELPERS
// ---------------------------------------------------------------------------

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// 12. ACTIVITY CAPTURE (USB mode idle timer)
// ---------------------------------------------------------------------------

['click', 'keydown', 'mousedown', 'touchstart', 'touchmove'].forEach(ev =>
    window.addEventListener(ev, handleUserActivity, { passive: true, capture: true })
);

let mouseMoveTO;
window.addEventListener('mousemove', () => {
    if (!mouseMoveTO) mouseMoveTO = setTimeout(() => {
        handleUserActivity(); mouseMoveTO = null;
    }, 200);
}, { passive: true, capture: true });

// ---------------------------------------------------------------------------
// 13. SERVICE WORKER + BOOT
// ---------------------------------------------------------------------------

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err =>
        console.warn('SW registration failed:', err)
    );
}

window.addEventListener('DOMContentLoaded', () => {
    restoreAndBoot();
});