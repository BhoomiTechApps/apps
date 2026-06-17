// =============================================================================
// LexiPic Kiosk — Heritage Language Archive
// Admin UI helpers: inline status messages + confirm/prompt dialogs
//
// Native alert()/confirm() dialogs look out of place on a kiosk (browser
// chrome, can be dismissed by an accidental tap, block the whole page).
// This module gives the rest of the admin panel a consistent, in-panel
// alternative:
//
//   AdminUI.status(containerEl, message, { tone: 'ok'|'error'|'info' })
//   AdminUI.confirm(message, { title, confirmLabel, danger }) -> Promise<boolean>
//   AdminUI.prompt(message, { title, defaultValue, confirmLabel }) -> Promise<string|null>
//
// All dialogs render into #admin-dialog-root (expected to exist in
// index.html as an empty container) and tear themselves down on close.
// Ported verbatim from the MediaMap kiosk-map app — this module has no
// domain-specific knowledge of layers or word sets, so it carries over
// unchanged.
// =============================================================================

const AdminUI = (function () {
    const ROOT_ID = 'admin-dialog-root';

    function getRoot() {
        let root = document.getElementById(ROOT_ID);
        if (!root) {
            root = document.createElement('div');
            root.id = ROOT_ID;
            document.body.appendChild(root);
        }
        return root;
    }

    function escHtmlLocal(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /* ------------------------------------------------------------------
       Inline status messages
       ------------------------------------------------------------------
       A small colored line shown directly under whatever control
       triggered it (upload button, flush button, etc.), instead of a
       blocking alert(). Auto-clears after a few seconds for success/info
       messages; error messages stay until the next action so they don't
       disappear before being read.
    ------------------------------------------------------------------ */
    const statusTimers = new WeakMap();

    function status(containerEl, message, opts = {}) {
        if (!containerEl) return;
        const tone = opts.tone || 'info';
        const toneClass = {
            ok: 'mediamap-status-ok',
            error: 'mediamap-status-error',
            info: 'mediamap-status-info'
        }[tone] || 'mediamap-status-info';

        const icon = { ok: 'check_circle', error: 'error', info: 'info' }[tone] || 'info';

        containerEl.innerHTML = message
            ? `<span class="mediamap-status-line ${toneClass}"><span class="material-icons">${icon}</span>${escHtmlLocal(message)}</span>`
            : '';

        const existingTimer = statusTimers.get(containerEl);
        if (existingTimer) clearTimeout(existingTimer);

        if (message && tone !== 'error') {
            const timer = setTimeout(() => {
                containerEl.innerHTML = '';
            }, 4000);
            statusTimers.set(containerEl, timer);
        }
    }

    /* ------------------------------------------------------------------
       Confirm dialog
    ------------------------------------------------------------------ */
    function confirmDialog(message, opts = {}) {
        return new Promise((resolve) => {
            const root = getRoot();
            const title = opts.title || 'Please confirm';
            const confirmLabel = opts.confirmLabel || 'Confirm';
            const cancelLabel = opts.cancelLabel || 'Cancel';
            const danger = !!opts.danger;

            root.innerHTML = `
                <div id="admin-confirm-backdrop" class="fixed inset-0 bg-slate-900/70 z-[3100] flex items-center justify-center p-4">
                    <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl" role="alertdialog" aria-modal="true" aria-labelledby="admin-confirm-title">
                        <div class="px-5 py-4 border-b border-slate-800">
                            <h2 id="admin-confirm-title" class="text-sm font-bold text-white flex items-center gap-2">
                                <span class="material-icons text-base ${danger ? 'text-rose-400' : 'text-indigo-400'}">${danger ? 'warning' : 'help'}</span>
                                ${escHtmlLocal(title)}
                            </h2>
                        </div>
                        <div class="px-5 py-4">
                            <p class="text-sm text-slate-300 leading-relaxed">${escHtmlLocal(message)}</p>
                        </div>
                        <div class="flex items-center gap-2 px-5 py-4 border-t border-slate-800">
                            <button type="button" id="admin-confirm-yes" class="flex-1 ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white font-medium py-2 rounded-lg text-sm transition">${escHtmlLocal(confirmLabel)}</button>
                            <button type="button" id="admin-confirm-no" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg text-sm transition">${escHtmlLocal(cancelLabel)}</button>
                        </div>
                    </div>
                </div>
            `;

            function cleanup(result) {
                root.innerHTML = '';
                document.removeEventListener('keydown', onKey, true);
                resolve(result);
            }
            function onKey(e) {
                if (e.key === 'Escape') cleanup(false);
                if (e.key === 'Enter') cleanup(true);
            }

            document.getElementById('admin-confirm-yes').addEventListener('click', () => cleanup(true));
            document.getElementById('admin-confirm-no').addEventListener('click', () => cleanup(false));
            document.getElementById('admin-confirm-backdrop').addEventListener('click', (e) => {
                if (e.target.id === 'admin-confirm-backdrop') cleanup(false);
            });
            document.addEventListener('keydown', onKey, true);
        });
    }

    /* ------------------------------------------------------------------
       Prompt dialog (single text field — used for rename)
    ------------------------------------------------------------------ */
    function promptDialog(message, opts = {}) {
        return new Promise((resolve) => {
            const root = getRoot();
            const title = opts.title || 'Enter a value';
            const confirmLabel = opts.confirmLabel || 'Save';
            const defaultValue = opts.defaultValue || '';

            root.innerHTML = `
                <div id="admin-prompt-backdrop" class="fixed inset-0 bg-slate-900/70 z-[3100] flex items-center justify-center p-4">
                    <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="admin-prompt-title">
                        <div class="px-5 py-4 border-b border-slate-800">
                            <h2 id="admin-prompt-title" class="text-sm font-bold text-white">${escHtmlLocal(title)}</h2>
                        </div>
                        <div class="px-5 py-4 space-y-2">
                            <p class="text-xs text-slate-400">${escHtmlLocal(message)}</p>
                            <input type="text" id="admin-prompt-input" value="${escHtmlLocal(defaultValue)}" maxlength="80" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <p id="admin-prompt-error" class="text-xs text-rose-400 hidden"></p>
                        </div>
                        <div class="flex items-center gap-2 px-5 py-4 border-t border-slate-800">
                            <button type="button" id="admin-prompt-yes" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg text-sm transition">${escHtmlLocal(confirmLabel)}</button>
                            <button type="button" id="admin-prompt-no" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg text-sm transition">Cancel</button>
                        </div>
                    </div>
                </div>
            `;

            const input = document.getElementById('admin-prompt-input');
            const errorEl = document.getElementById('admin-prompt-error');
            input.focus();
            input.select();

            function showError(msg) {
                errorEl.textContent = msg;
                errorEl.classList.remove('hidden');
            }

            function cleanup(result) {
                root.innerHTML = '';
                document.removeEventListener('keydown', onKey, true);
                resolve(result);
            }

            function attemptSubmit() {
                const value = input.value.trim();
                if (opts.validate) {
                    const validationError = opts.validate(value);
                    if (validationError) {
                        showError(validationError);
                        return;
                    }
                }
                cleanup(value);
            }

            function onKey(e) {
                if (e.key === 'Escape') cleanup(null);
                if (e.key === 'Enter') attemptSubmit();
            }

            document.getElementById('admin-prompt-yes').addEventListener('click', attemptSubmit);
            document.getElementById('admin-prompt-no').addEventListener('click', () => cleanup(null));
            document.getElementById('admin-prompt-backdrop').addEventListener('click', (e) => {
                if (e.target.id === 'admin-prompt-backdrop') cleanup(null);
            });
            document.addEventListener('keydown', onKey, true);
        });
    }

    return { status, confirm: confirmDialog, prompt: promptDialog };
})();
