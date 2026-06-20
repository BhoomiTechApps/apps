// =============================================================================
// MediaMap Kiosk PWA — app.js
//
// Two source modes, chosen once and remembered across reloads (same
// architecture as the sibling LexiPic Kiosk PWA):
//
//   URL mode  — displays a remote web page directly in a fullscreen
//               iframe (e.g. a MediaMap Kiosk WordPress site's own
//               kiosk page, like https://yoursite.com/?mediamap_kiosk=1
//               or a dedicated /map-kiosk/ URL). This PWA does not parse
//               or fetch JSON from it — it just shows the page, like a
//               kiosk browser pointed at a URL. If the page fails to
//               load (offline, DNS error, etc.) a small retry screen
//               appears and the app keeps attempting to reload it
//               automatically until it succeeds. The URL is saved in
//               localStorage and restored automatically on every reload.
//
//   USB mode  — user picks the "mediamap-kiosk-data" directory via the
//               File System Access API (showDirectoryPicker). The
//               directory must contain settings.json and one JSON/
//               GeoJSON file per layer, in the same import format the
//               MediaMap Kiosk plugin's own importer accepts. This mode
//               renders its own read-only Leaflet map entirely client-
//               side — no network needed for the layer data itself
//               (the basemap tiles still require a connection). The
//               directory HANDLE itself (not just its name) is saved in
//               IndexedDB, since handles are structured-cloneable but
//               not JSON-serialisable. On reload the app re-opens that
//               saved handle and silently re-checks permission; if the
//               browser already granted it earlier, this needs no user
//               interaction at all. If permission was revoked or the
//               handle is unreadable, the setup screen asks for a
//               single tap to re-grant access — never the full folder
//               picker again unless the handle is gone entirely.
//
// SECURITY — URL allowlist + setup PIN (see REST-SPEC.md):
//   Any URL someone tries to save in URL mode is checked against a
//   domain allowlist fetched from ALLOWLIST_ENDPOINT (hosted on the
//   WordPress MediaMap Kiosk plugin). Only an exact hostname match is
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
//   while already running.
//
// No server. No PHP. Just open index.html.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// 0. CONSTANTS + STATE
// ---------------------------------------------------------------------------
const STORAGE_KEY      = 'mediamap_source';        // localStorage key (mode + URL, when applicable)
const DB_NAME          = 'MediaMapKioskPwaDB';
const DB_VERSION       = 1;
const STORE_HANDLES    = 'dir-handles';             // stores the USB FileSystemDirectoryHandle itself
const STORE_ALLOWLIST  = 'allowlist-cache';         // caches the last-fetched domain allowlist + PIN
const HANDLE_KEY       = 'mediamap-kiosk-data';     // fixed key — only one USB source at a time
const ALLOWLIST_KEY    = 'mediamap-kiosk-allowlist'; // fixed key — single cached allowlist record
const IFRAME_RETRY_MS  = 8000; // retry interval after the iframe page fails to load

// Set this to your WordPress site's allowlist REST endpoint. See
// REST-SPEC.md for the exact response shape this URL must return.
// Leave blank to disable URL-mode source changes entirely until
// configured (the setup screen will explain why).
const ALLOWLIST_ENDPOINT = 'https://bishnupriyamanipurisahityasabha.com/wp-json/mediamap-kiosk/v1/allowlist';

// PIN verification reuses the WordPress MediaMap Kiosk plugin's EXISTING
// kiosk-admin PIN (hashed, rate-limited server-side) rather than a
// second plaintext PIN — see REST-SPEC.md section 2. Same site as
// ALLOWLIST_ENDPOINT; update both together if the site ever changes.
const PIN_VERIFY_ENDPOINT = 'https://bishnupriyamanipurisahityasabha.com/wp-json/mediamap-kiosk/v1/pin/verify';

let sourceConfig      = null;  // { mode:'url', url } | { mode:'usb', dirHandle, dirName }
let iframeRetryTimer  = null;
let lastLoadErrors    = []; // layers listed in settings.json that failed to load this boot
let lastActivityTime  = Date.now(); // shared by the allowlist watchdog's quiet period and the USB idle timer

// ---------------------------------------------------------------------------
// 1. SCREEN ELEMENTS
// ---------------------------------------------------------------------------
const setupScreen     = document.getElementById('screen-setup');
const iframeScreen    = document.getElementById('screen-iframe');
const kioskRoot       = document.getElementById('kiosk-root');
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

function handleUserActivity() {
    lastActivityTime = Date.now();
    if (remainingSeconds < (KIOSK_IDLE_TIME / 1000)) {
        remainingSeconds = KIOSK_IDLE_TIME / 1000;
        updateCountdownUI();
    }
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
// 4. USB MODE — directory handle persistence
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
        req.onsuccess = () => resolve(req.result);
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
// the WordPress MediaMap Kiosk plugin (see REST-SPEC.md). This means
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
        setSetupStatus('Select your "mediamap-kiosk-data" folder…', true);
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        try { await dirHandle.getFileHandle('settings.json'); }
        catch (_) {
            setSetupStatus('No settings.json found in that folder. Make sure you selected the "mediamap-kiosk-data" directory.', false);
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
        const settings = await getKioskSettingsFromUsb();
        setIdleTimeSeconds(settings.idle_time_seconds || 90);

        const layers = await getAllLayersFromUsb();

        showKioskRoot();
        initMap();
        setLockBoundsToData(!!settings.lock_bounds_to_data);
        redrawActiveLayersInOrder(layers);
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
        setSetupStatus('Re-select your "mediamap-kiosk-data" folder to continue.', true);
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
        if (Date.now() - lastActivityTime < RECHECK_QUIET_PERIOD_MS) return;

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
// 6. USB MODE DATA — file reading + normalization
// ---------------------------------------------------------------------------

async function readJsonFile(dirHandle, filename) {
    const fh   = await dirHandle.getFileHandle(filename);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
}

/**
 * Resolve a media_url value to a usable src. If it's already a data-URI,
 * blob, or remote URL, pass through. If it's a plain filename, read that
 * file from the USB directory and convert to an object URL — mirrors the
 * "filename relative to the data folder" support in the sibling LexiPic
 * Kiosk PWA, extended here to mediamap's image/audio/video media types.
 */
async function resolveMediaUrl(value, dirHandle) {
    if (!value) return '';
    if (value.startsWith('data:') || value.startsWith('http') || value.startsWith('blob:')) return value;
    try {
        const fh   = await dirHandle.getFileHandle(value);
        const file = await fh.getFile();
        return URL.createObjectURL(file);
    } catch (_) {
        return value; // Not a local file either — leave as-is and let it fail visibly in the lightbox.
    }
}

// --- DATA NORMALIZATION MODULE ---
// Ported from the MediaMap Kiosk plugin's MediaMap_Kiosk_Data_Normalizer
// (PHP) / DataNormalizationModule (JS) — same accepted shapes: a plain
// array of point objects, { data: [...] }, or GeoJSON (FeatureCollection/
// Feature/bare geometry). Point/MultiPoint geometries become flat marker
// points; LineString/Polygon/MultiLineString/MultiPolygon geometries are
// kept as raw GeoJSON Features for Leaflet to render directly.
const DataNormalizationModule = {
    process(rawInput) {
        let pointSources = [];
        let shapeFeatures = [];

        if (Array.isArray(rawInput)) {
            pointSources = rawInput;
        } else if (this.isGeoJSON(rawInput)) {
            const split = this.flattenGeoJSON(rawInput);
            pointSources = split.points;
            shapeFeatures = split.shapes;
        } else if (rawInput && rawInput.data && Array.isArray(rawInput.data)) {
            pointSources = rawInput.data;
        } else if (rawInput && Array.isArray(rawInput.features)) {
            const split = this.flattenGeoJSON({ type: 'FeatureCollection', features: rawInput.features });
            pointSources = split.points;
            shapeFeatures = split.shapes;
        }

        const points = pointSources.map(item => {
            const source = item.properties ? item.properties : item;

            let latVal = item.lat ?? source.lat;
            let lngVal = item.lng ?? source.lng;

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
                place_name: source.place_name || source.name || 'Unknown Location',
                media_type: (source.media_type || this.detectMediaType(source.media_url)).toLowerCase(),
                media_url: source.media_url || '',
                description: source.description || source.desc || '',
            };
        }).filter(item => !isNaN(item.lat) && !isNaN(item.lng));

        return { points, shapeFeatures };
    },

    isGeoJSON(rawInput) {
        if (!rawInput || typeof rawInput !== 'object') return false;
        const shapeTypes = ['FeatureCollection', 'Feature', 'Point', 'MultiPoint',
            'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'];
        return shapeTypes.includes(rawInput.type);
    },

    flattenGeoJSON(rawInput) {
        let features;
        if (rawInput.type === 'FeatureCollection') {
            features = Array.isArray(rawInput.features) ? rawInput.features : [];
        } else if (rawInput.type === 'Feature') {
            features = [rawInput];
        } else {
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

        const resolvedPoints = points.map(item => ({
            ...item,
            lat: item.geometry.coordinates[1],
            lng: item.geometry.coordinates[0],
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
    },
};

/**
 * Reads settings.json's top-level "kiosk" block. Mirrors getKioskSettings()
 * in the sibling LexiPic Kiosk PWA.
 */
async function getKioskSettingsFromUsb() {
    const config = await readJsonFile(sourceConfig.dirHandle, 'settings.json');
    return config.kiosk || { idle_time_seconds: 90, lock_bounds_to_data: false };
}

/**
 * Loads every enabled layer listed in settings.json, normalizes each
 * file's contents the same way the WordPress plugin's importer would,
 * and resolves any locally-referenced point media to object URLs.
 * Shaped to match what GET /layers returns from the live plugin
 * (groupName/active/order/shapeStyle/data/shapes), so the rendering
 * code below (ported from the plugin's app.js) works unmodified.
 */
async function getAllLayersFromUsb() {
    const config = await readJsonFile(sourceConfig.dirHandle, 'settings.json');
    const entries = Array.isArray(config.layers) ? config.layers : [];
    const layers = [];
    const errors = [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry.enabled) continue;
        const file = entry.file;
        if (!file) continue;

        try {
            const raw = await readJsonFile(sourceConfig.dirHandle, file);
            const { points, shapeFeatures } = DataNormalizationModule.process(raw);

            const resolvedPoints = await Promise.all(points.map(async p => ({
                ...p,
                media_url: await resolveMediaUrl(p.media_url, sourceConfig.dirHandle),
            })));

            layers.push({
                id: file,
                groupName: entry.name || file,
                active: true,
                order: i,
                shapeStyle: Object.assign({}, DEFAULT_SHAPE_STYLE, entry.shapeStyle || {}),
                data: resolvedPoints,
                shapes: shapeFeatures,
            });
        } catch (err) {
            const reason = (err && err.name === 'NotFoundError')
                ? `File "${file}" not found in the data folder.`
                : `File "${file}" couldn't be read (${err.message || 'invalid JSON'}).`;
            errors.push({ file, name: entry.name || file, reason });
        }
    }

    lastLoadErrors = errors;
    return layers;
}

/**
 * Shows a small dismissible banner listing any layers from settings.json
 * that failed to load this boot (usually a filename mismatch or invalid
 * JSON). Without this, a missing layer is silent and very hard to
 * self-diagnose from the kiosk screen alone.
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
            <strong>${lastLoadErrors.length} layer${lastLoadErrors.length === 1 ? '' : 's'} could not be loaded:</strong>
            ${lastLoadErrors.map(e => `<div>${escHtml(e.name)} — ${escHtml(e.reason)}</div>`).join('')}
        </div>
        <button type="button" aria-label="Dismiss">&times;</button>
    `;
    banner.querySelector('button').addEventListener('click', () => banner.remove());
    document.querySelector('main').prepend(banner);
}

// ---------------------------------------------------------------------------
// 7. MEDIA EMBED RESOLUTION MODULE
// ---------------------------------------------------------------------------
// Pure string/regex logic, no DOM dependency — ported unchanged from the
// MediaMap Kiosk plugin's app.js.
const MediaEmbedModule = {
    resolve(type, url) {
        if (!url) return null;

        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }

        const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
        if (yt) return { kind: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}?autoplay=1&rel=0` };

        const vm = url.match(/vimeo\.com\/(\d+)/);
        if (vm) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vm[1]}?autoplay=1` };

        const dm = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
        if (dm) return { kind: 'iframe', src: `https://www.dailymotion.com/embed/video/${dm[1]}?autoplay=1` };

        const parent = encodeURIComponent(window.location.hostname || 'localhost');
        const twClip = url.match(/(?:clips\.twitch\.tv\/|twitch\.tv\/[^/]+\/clip\/)([A-Za-z0-9_-]+)/);
        if (twClip) return { kind: 'iframe', src: `https://clips.twitch.tv/embed?clip=${twClip[1]}&parent=${parent}` };
        const twVod = url.match(/twitch\.tv\/videos\/(\d+)/);
        if (twVod) return { kind: 'iframe', src: `https://player.twitch.tv/?video=${twVod[1]}&parent=${parent}&autoplay=true` };
        const twChannel = url.match(/twitch\.tv\/([A-Za-z0-9_]+)\/?(?:$|\?)/);
        if (twChannel && host === 'twitch.tv') return { kind: 'iframe', src: `https://player.twitch.tv/?channel=${twChannel[1]}&parent=${parent}&autoplay=true` };

        const tt = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
        if (tt) return { kind: 'iframe', src: `https://www.tiktok.com/player/v1/${tt[1]}` };

        const sm = url.match(/streamable\.com\/([A-Za-z0-9]+)/);
        if (sm && !/^(e|o|s)$/.test(sm[1])) return { kind: 'iframe', src: `https://streamable.com/e/${sm[1]}?autoplay=1` };

        const lm = url.match(/loom\.com\/share\/([A-Za-z0-9]+)/);
        if (lm) return { kind: 'iframe', src: `https://www.loom.com/embed/${lm[1]}` };

        const sp = url.match(/open\.spotify\.com\/(track|episode|playlist|album|show)\/([A-Za-z0-9]+)/);
        if (sp) return { kind: 'iframe', src: `https://open.spotify.com/embed/${sp[1]}/${sp[2]}` };

        if (host === 'soundcloud.com') {
            return { kind: 'iframe', src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&color=1abc9c` };
        }

        if (type === 'streetview') {
            let parsed;
            try { parsed = new URL(url); } catch (e) { return null; }
            const isGoogleHost = parsed.hostname === 'google.com' || parsed.hostname === 'www.google.com';
            if (isGoogleHost && parsed.pathname.startsWith('/maps/embed')) {
                return { kind: 'iframe', src: url };
            }
            return null;
        }

        // Local USB files resolved by resolveMediaUrl() come through as
        // blob:/data: URIs, which have no path extension to sniff — trust
        // the declared media_type for those rather than falling through.
        if (url.startsWith('blob:') || url.startsWith('data:')) {
            if (type === 'video') return { kind: 'file', src: url };
            if (type === 'audio') return { kind: 'file', src: url };
        }

        const cleanPath = url.split('?')[0].split('#')[0];
        const ext = cleanPath.split('.').pop().toLowerCase();
        if (type === 'video' && ['mp4', 'webm', 'ogv', 'mov'].includes(ext)) return { kind: 'file', src: url };
        if (type === 'audio' && ['mp3', 'wav', 'flac', 'aac', 'oga', 'm4a', 'opus', 'wma'].includes(ext)) return { kind: 'file', src: url };

        return null;
    },
};

// ---------------------------------------------------------------------------
// 8. MARKER ICON MODULE
// ---------------------------------------------------------------------------
const MarkerIconModule = {
    TYPES: {
        video: {
            color: '#e11d48',
            label: 'Video',
            glyph: '<path d="M1 3.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Zm9.5 2 4-2.2v9.4l-4-2.2v-5Z"/>',
        },
        audio: {
            color: '#7c3aed',
            label: 'Audio',
            glyph: '<path d="M8 1.5a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 8 1.5Zm-4.25 6.75a.75.75 0 0 1 .75.75 3.5 3.5 0 0 0 7 0 .75.75 0 0 1 1.5 0 5 5 0 0 1-4.25 4.94v1.31h1.25a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5h1.25v-1.31A5 5 0 0 1 3 9a.75.75 0 0 1 .75-.75Z"/>',
        },
        image: {
            color: '#d97706',
            label: 'Image',
            glyph: '<path d="M2 2.5h12A1.5 1.5 0 0 1 15.5 4v8A1.5 1.5 0 0 1 14 13.5H2A1.5 1.5 0 0 1 .5 12V4A1.5 1.5 0 0 1 2 2.5Zm.5 9.5h11l-3.6-4.6a.5.5 0 0 0-.77-.03L6.8 10.2 5.06 8.32a.5.5 0 0 0-.74.02L2.5 11v1Zm3-6a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/>',
        },
        text: {
            color: '#475569',
            label: 'Note',
            glyph: '<path d="M3.5 1.5h6l3 3v9a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm5.5.9V4.5a.5.5 0 0 0 .5.5h2.1l-2.6-2.6ZM5 8h6v1H5V8Zm0 2.5h6v1H5v-1ZM5 5.5h3v1H5v-1Z"/>',
        },
        streetview: {
            color: '#0891b2',
            label: 'Street View',
            glyph: '<path d="M8 9.8c3.6 0 6.5-1 6.5-2.3S11.6 5.2 8 5.2 1.5 6.2 1.5 7.5 4.4 9.8 8 9.8Zm0-3.4c.9 0 1.6.5 1.6 1.1S8.9 7.6 8 7.6s-1.6-.5-1.6-1.1.7-1.1 1.6-1.1Zm0-5.1a2.6 2.6 0 0 0-2.6 2.6c0 1.9 2.6 4.9 2.6 4.9s2.6-3 2.6-4.9A2.6 2.6 0 0 0 8 1.3Zm0 3.6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/>',
        },
    },

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
            popupAnchor: [0, -42],
        });
    },

    labelFor(type) {
        return (this.TYPES[type] || this.TYPES.text).label;
    },
};

// ---------------------------------------------------------------------------
// 9. MAP STATE, IDLE TIMER, HEARTBEAT
// ---------------------------------------------------------------------------
let map, mapLayers = {};
let mapInitialized = false;

const DEFAULT_SHAPE_STYLE = {
    fillColor: '#4f46e5',
    fillOpacity: 0.35,
    lineColor: '#4f46e5',
    lineWeight: 3,
    label: '',
    labelColor: '#1e293b',
    labelSize: 14,
};

let KIOSK_IDLE_TIME = 90 * 1000;
let remainingSeconds = KIOSK_IDLE_TIME / 1000;
let idleInterval = null;

function setIdleTimeSeconds(seconds) {
    KIOSK_IDLE_TIME = Math.max(5, Math.round(seconds)) * 1000;
    remainingSeconds = KIOSK_IDLE_TIME / 1000;
    updateCountdownUI();
}

function updateCountdownUI() {
    const display = document.getElementById('lightbox-countdown');
    if (display) {
        display.querySelector('span:not(.material-icons)').textContent = `Auto-closes in ${remainingSeconds}s`;
    }
}

function startKioskHeartbeat() {
    stopKioskHeartbeat();
    idleInterval = setInterval(() => {
        const timeSinceLastActivity = Date.now() - lastActivityTime;
        const calculatedRemaining = Math.max(0, Math.ceil((KIOSK_IDLE_TIME - timeSinceLastActivity) / 1000));

        if (calculatedRemaining !== remainingSeconds) {
            remainingSeconds = calculatedRemaining;
            updateCountdownUI();
        }

        if (timeSinceLastActivity >= KIOSK_IDLE_TIME) {
            // Reset to a clean overview for the next visitor: close any
            // open lightbox and re-fit the map to the active layers,
            // mirroring how the sibling LexiPic Kiosk PWA returns to its
            // sets grid on idle.
            closeLightbox();
            fitMapToActiveLayers();
            lastActivityTime = Date.now();
        }
    }, 1000);
}

function stopKioskHeartbeat() {
    if (idleInterval) { clearInterval(idleInterval); idleInterval = null; }
}

// ---------------------------------------------------------------------------
// 10. MAP INITIALIZATION
// ---------------------------------------------------------------------------
const KIOSK_HOME_VIEW = { center: [26.1805, 91.7539], zoom: 8 };

function initMap() {
    if (mapInitialized) return;
    mapInitialized = true;

    map = L.map('map', { zoomControl: false, tap: false }).setView(KIOSK_HOME_VIEW.center, KIOSK_HOME_VIEW.zoom);
    L.control.zoom({ position: 'topright' }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    }).addTo(map);

    initMapResizeHandling();
}

// Leaflet measures its container once on creation and then caches that
// size; it never re-measures on its own. A device rotation or the
// mobile browser chrome showing/hiding (resizing the dynamic viewport)
// leaves Leaflet's cached size stale, so tiles/markers only occupy the
// old box until something forces a recalculation. A ResizeObserver on
// the map container, plus listening for visualViewport resizes, covers
// both cases so the map always settles back to the right size on its
// own — ported from the WordPress plugin's equivalent handling (which
// also accounts for its admin accordion, not applicable here).
function initMapResizeHandling() {
    const mapEl = document.getElementById('map');

    if ('ResizeObserver' in window && mapEl) {
        const resizeObserver = new ResizeObserver(() => {
            if (map) map.invalidateSize();
        });
        resizeObserver.observe(mapEl);
    }

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            if (map) map.invalidateSize();
        });
    }
}

// ---------------------------------------------------------------------------
// 11. LAYER RENDERING (ported from the MediaMap Kiosk plugin's app.js)
// ---------------------------------------------------------------------------
function renderLayerOnMap(layer) {
    const groupName = layer.groupName;
    if (mapLayers[groupName]) {
        map.removeLayer(mapLayers[groupName]);
    }

    const layerGroup = L.featureGroup();

    (layer.data || []).forEach(item => {
        const marker = L.marker([item.lat, item.lng], {
            icon: MarkerIconModule.build(item.media_type),
        });

        const typeLabel = MarkerIconModule.labelFor(item.media_type);
        marker.bindTooltip(`${item.place_name} &middot; ${typeLabel}`, { direction: 'top', offset: [0, -38] });
        marker.on('click', () => {
            openLightbox(item);
        });
        layerGroup.addLayer(marker);
    });

    const shapes = layer.shapes || [];
    if (shapes.length > 0) {
        const style = layer.shapeStyle || DEFAULT_SHAPE_STYLE;
        const geoJsonLayer = L.geoJSON(shapes, {
            style: () => ({
                color: style.lineColor,
                weight: style.lineWeight,
                fillColor: style.fillColor,
                fillOpacity: style.fillOpacity,
            }),
        });
        layerGroup.addLayer(geoJsonLayer);

        if (style.label && style.label.trim()) {
            const labelPoint = findLargestShapeCenter(geoJsonLayer);
            if (labelPoint) {
                const labelIcon = L.divIcon({
                    html: `<span class="mediamap-shape-label" style="color:${escHtml(style.labelColor)};font-size:${parseFloat(style.labelSize) || 14}px;">${escHtml(style.label)}</span>`,
                    className: 'mediamap-shape-label-icon',
                    iconSize: null,
                });
                const labelMarker = L.marker(labelPoint, { icon: labelIcon, interactive: false });
                layerGroup.addLayer(labelMarker);
            }
        }
    }

    mapLayers[groupName] = layerGroup;
    map.addLayer(layerGroup);
}

function findLargestShapeCenter(geoJsonLayer) {
    let bestBounds = null;
    let bestArea = -1;

    geoJsonLayer.eachLayer(sublayer => {
        if (typeof sublayer.getBounds !== 'function') return;
        let b;
        try { b = sublayer.getBounds(); } catch (e) { return; }
        if (!b || !b.isValid()) return;

        const sw = b.getSouthWest();
        const ne = b.getNorthEast();
        const area = Math.abs(ne.lat - sw.lat) * Math.abs(ne.lng - sw.lng);

        if (area > bestArea) {
            bestArea = area;
            bestBounds = b;
        }
    });

    if (bestBounds) return bestBounds.getCenter();

    try {
        const combined = geoJsonLayer.getBounds();
        if (combined && combined.isValid()) return combined.getCenter();
    } catch (e) {
        // no measurable content at all
    }
    return null;
}

function redrawActiveLayersInOrder(layers) {
    Object.keys(mapLayers).forEach(key => map.removeLayer(mapLayers[key]));
    mapLayers = {};

    const mapEmpty = document.getElementById('map-empty');
    const activeLayers = (layers || []).filter(l => l.active);

    if (activeLayers.length === 0) {
        mapEmpty.style.display = 'flex';
    } else {
        mapEmpty.style.display = 'none';
    }

    activeLayers.forEach(layer => renderLayerOnMap(layer));

    fitMapToActiveLayers();
}

// ---------------------------------------------------------------------------
// 12. BOUNDS FIT / LOCK
// ---------------------------------------------------------------------------
let kioskLockBoundsToData = false;

function setLockBoundsToData(enabled) {
    kioskLockBoundsToData = !!enabled;
    fitMapToActiveLayers();
}

function fitMapToActiveLayers() {
    const groups = Object.values(mapLayers);
    if (groups.length === 0) {
        map.setMaxBounds(null);
        map.setMinZoom(0);
        map.setView(KIOSK_HOME_VIEW.center, KIOSK_HOME_VIEW.zoom);
        return;
    }

    let bounds = null;
    groups.forEach(group => {
        if (typeof group.getBounds !== 'function') return;
        let groupBounds;
        try { groupBounds = group.getBounds(); } catch (e) { return; }
        if (!groupBounds || !groupBounds.isValid()) return;
        bounds = bounds ? bounds.extend(groupBounds) : groupBounds;
    });

    if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });

        if (kioskLockBoundsToData) {
            const padded = bounds.pad(0.5);
            map.setMaxBounds(padded);
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

// ---------------------------------------------------------------------------
// 13. LIGHTBOX
// ---------------------------------------------------------------------------
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
            <p>${escHtml(message)}</p>
            ${linkHtml}
        </div>`;
}

function openLightbox(item) {
    const container = document.getElementById('lightbox');
    const mediaBox = document.getElementById('lightbox-media');
    const wrapper = document.getElementById('lightbox-content-wrapper');

    document.getElementById('lightbox-title').textContent = item.place_name;
    document.getElementById('lightbox-coords').textContent = `${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}`;
    document.getElementById('lightbox-desc').textContent = item.description || 'No description provided.';
    document.getElementById('lightbox-type').textContent = MarkerIconModule.labelFor(item.media_type);

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
                <div style="display:flex;flex-direction:column;align-items:center;width:100%;padding:0 24px;">
                    <span class="material-icons" style="font-size:3.5rem;color:#a5b4fc;margin-bottom:1rem;">audiotrack</span>
                    <audio src="${escHtml(embed.src)}" controls autoplay></audio>
                </div>`;
        } else {
            mediaBox.innerHTML = `<iframe src="${escHtml(embed.src)}" frameborder="0" allow="autoplay"></iframe>`;
        }
    } else if (item.media_type === 'image') {
        mediaBox.innerHTML = `<img src="${escHtml(item.media_url)}" alt="${escHtml(item.place_name)}">`;
    } else if (item.media_type === 'streetview') {
        const embed = MediaEmbedModule.resolve('streetview', item.media_url);
        if (!embed) {
            renderMediaStatus(mediaBox, 'streetview', 'This Street View link isn\u2019t valid.', item.media_url, true);
        } else {
            mediaBox.innerHTML = `<iframe src="${escHtml(embed.src)}" frameborder="0" style="border:0" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
        }
    } else {
        mediaBox.innerHTML = `
            <div class="media-status">
                <span class="material-icons">article</span>
                <p>Text-only point — no media attached.</p>
            </div>`;
    }

    container.classList.remove('mm-hidden');
    setTimeout(() => {
        container.classList.remove('mm-opacity-0');
        wrapper.classList.remove('mm-scale-95');
    }, 10);

    handleUserActivity();
}

function closeLightbox() {
    const container = document.getElementById('lightbox');
    const wrapper = document.getElementById('lightbox-content-wrapper');
    if (container.classList.contains('mm-hidden')) return;
    container.classList.add('mm-opacity-0');
    wrapper.classList.add('mm-scale-95');
    setTimeout(() => {
        container.classList.add('mm-hidden');
        document.getElementById('lightbox-media').innerHTML = '';
    }, 300);
}

document.getElementById('close-lightbox').addEventListener('click', closeLightbox);
document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target === document.getElementById('lightbox')) closeLightbox();
});

// ---------------------------------------------------------------------------
// 14. ACTIVITY CAPTURE (USB mode idle timer + allowlist watchdog quiet period)
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
// 15. SERVICE WORKER + BOOT
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err =>
        console.warn('SW registration failed:', err)
    );
}

window.addEventListener('DOMContentLoaded', () => {
    restoreAndBoot();
});
