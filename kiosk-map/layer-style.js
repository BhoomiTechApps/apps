// =============================================================================
// MediaMap PWA Overlay — Kiosk Edition
// Layer Style Modal
//
// A small, self-contained module for styling a GeoJSON layer's shapes
// (polylines/polygons): fill color, fill opacity, line color, line
// thickness, and an optional single label (text/color/size) shown at
// the layer's centroid. One style applies to every shape within a
// layer — there is no per-feature styling.
//
// Usage:
//   LayerStyleModal.open(groupName, currentStyle, (newStyle) => { ... });
//
// The modal builds its own DOM into #layer-style-modal-root (expected
// to exist in index.html as an empty container) and tears itself down
// on close, so nothing leaks between opens.
// =============================================================================

const LayerStyleModal = (function () {
    const ROOT_ID = 'layer-style-modal-root';

    function getRoot() {
        let root = document.getElementById(ROOT_ID);
        if (!root) {
            // Defensive fallback: index.html should already declare this
            // container, but create it on the fly rather than failing
            // silently if it's ever missing.
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

    function close() {
        const root = document.getElementById(ROOT_ID);
        if (root) root.innerHTML = '';
        document.removeEventListener('keydown', handleEscapeKey, true);
    }

    function handleEscapeKey(e) {
        if (e.key === 'Escape') close();
    }

    /**
     * Open the styling modal for one layer.
     * @param {string} groupName - the layer's name, shown in the modal title.
     * @param {object} currentStyle - { fillColor, fillOpacity, lineColor, lineWeight, label, labelColor, labelSize }
     * @param {function} onSave - called with the new style object once the user clicks Save.
     */
    function open(groupName, currentStyle, onSave) {
        const style = Object.assign({
            fillColor: '#4f46e5',
            fillOpacity: 0.35,
            lineColor: '#4f46e5',
            lineWeight: 3,
            label: '',
            labelColor: '#1e293b',
            labelSize: 14
        }, currentStyle || {});

        const root = getRoot();
        root.innerHTML = `
            <div id="layer-style-backdrop" class="fixed inset-0 bg-slate-900/70 z-[3000] flex items-center justify-center p-4">
                <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="layer-style-title">
                    <div class="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                        <div>
                            <h2 id="layer-style-title" class="text-sm font-bold text-white">Style Layer Shapes</h2>
                            <p class="text-xs text-slate-400 mt-0.5 truncate max-w-[220px]">${escHtmlLocal(groupName)}</p>
                        </div>
                        <button type="button" id="layer-style-close" class="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800" aria-label="Close">
                            <span class="material-icons text-lg">close</span>
                        </button>
                    </div>

                    <div class="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">

                        <div>
                            <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Fill</p>
                            <div class="flex items-center gap-3">
                                <label class="flex items-center gap-2 text-xs text-slate-300">
                                    <input type="color" id="ls-fill-color" value="${escHtmlLocal(style.fillColor)}" class="w-9 h-9 rounded border border-slate-700 bg-slate-800 cursor-pointer">
                                    Color
                                </label>
                                <div class="flex-1">
                                    <div class="flex items-center justify-between text-xs text-slate-300 mb-1">
                                        <span>Transparency</span>
                                        <span id="ls-fill-opacity-readout">${Math.round(style.fillOpacity * 100)}%</span>
                                    </div>
                                    <input type="range" id="ls-fill-opacity" min="0" max="100" step="5" value="${Math.round(style.fillOpacity * 100)}" class="w-full accent-indigo-500">
                                </div>
                            </div>
                        </div>

                        <div>
                            <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Line</p>
                            <div class="flex items-center gap-3">
                                <label class="flex items-center gap-2 text-xs text-slate-300">
                                    <input type="color" id="ls-line-color" value="${escHtmlLocal(style.lineColor)}" class="w-9 h-9 rounded border border-slate-700 bg-slate-800 cursor-pointer">
                                    Color
                                </label>
                                <div class="flex-1">
                                    <div class="flex items-center justify-between text-xs text-slate-300 mb-1">
                                        <span>Thickness</span>
                                        <span id="ls-line-weight-readout">${parseFloat(style.lineWeight)}px</span>
                                    </div>
                                    <input type="range" id="ls-line-weight" min="1" max="12" step="1" value="${parseFloat(style.lineWeight)}" class="w-full accent-indigo-500">
                                </div>
                            </div>
                        </div>

                        <div>
                            <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Label</p>
                            <input type="text" id="ls-label-text" value="${escHtmlLocal(style.label)}" placeholder="Optional text shown on the map" maxlength="60" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3">
                            <div class="flex items-center gap-3">
                                <label class="flex items-center gap-2 text-xs text-slate-300">
                                    <input type="color" id="ls-label-color" value="${escHtmlLocal(style.labelColor)}" class="w-9 h-9 rounded border border-slate-700 bg-slate-800 cursor-pointer">
                                    Color
                                </label>
                                <div class="flex-1">
                                    <div class="flex items-center justify-between text-xs text-slate-300 mb-1">
                                        <span>Text size</span>
                                        <span id="ls-label-size-readout">${parseFloat(style.labelSize)}px</span>
                                    </div>
                                    <input type="range" id="ls-label-size" min="10" max="32" step="1" value="${parseFloat(style.labelSize)}" class="w-full accent-indigo-500">
                                </div>
                            </div>
                        </div>

                        <div>
                            <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Preview</p>
                            <div class="rounded-lg border border-slate-700 bg-slate-950 h-20 flex items-center justify-center overflow-hidden">
                                <svg id="ls-preview-svg" width="160" height="64" viewBox="0 0 160 64">
                                    <polygon id="ls-preview-shape" points="20,48 60,16 120,16 144,48 100,56 50,56" />
                                    <text id="ls-preview-label" x="80" y="38" text-anchor="middle" dominant-baseline="middle" font-weight="600"></text>
                                </svg>
                            </div>
                        </div>

                    </div>

                    <div class="flex items-center gap-2 px-5 py-4 border-t border-slate-800">
                        <button type="button" id="layer-style-save" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg text-sm transition">Save Style</button>
                        <button type="button" id="layer-style-cancel" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg text-sm transition">Cancel</button>
                    </div>
                </div>
            </div>
        `;

        const els = {
            fillColor: document.getElementById('ls-fill-color'),
            fillOpacity: document.getElementById('ls-fill-opacity'),
            fillOpacityReadout: document.getElementById('ls-fill-opacity-readout'),
            lineColor: document.getElementById('ls-line-color'),
            lineWeight: document.getElementById('ls-line-weight'),
            lineWeightReadout: document.getElementById('ls-line-weight-readout'),
            labelText: document.getElementById('ls-label-text'),
            labelColor: document.getElementById('ls-label-color'),
            labelSize: document.getElementById('ls-label-size'),
            labelSizeReadout: document.getElementById('ls-label-size-readout'),
            previewShape: document.getElementById('ls-preview-shape'),
            previewLabel: document.getElementById('ls-preview-label')
        };

        function updatePreview() {
            els.fillOpacityReadout.innerText = `${els.fillOpacity.value}%`;
            els.lineWeightReadout.innerText = `${els.lineWeight.value}px`;
            els.labelSizeReadout.innerText = `${els.labelSize.value}px`;

            els.previewShape.setAttribute('fill', els.fillColor.value);
            els.previewShape.setAttribute('fill-opacity', String(parseInt(els.fillOpacity.value, 10) / 100));
            els.previewShape.setAttribute('stroke', els.lineColor.value);
            els.previewShape.setAttribute('stroke-width', els.lineWeight.value);

            const labelText = els.labelText.value.trim();
            els.previewLabel.textContent = labelText || '(no label)';
            els.previewLabel.setAttribute('fill', labelText ? els.labelColor.value : '#64748b');
            els.previewLabel.setAttribute('font-size', String(Math.min(parseFloat(els.labelSize.value) || 14, 20)));
        }

        [els.fillColor, els.fillOpacity, els.lineColor, els.lineWeight, els.labelText, els.labelColor, els.labelSize]
            .forEach(el => el.addEventListener('input', updatePreview));
        updatePreview();

        function collectStyle() {
            return {
                fillColor: els.fillColor.value,
                fillOpacity: parseInt(els.fillOpacity.value, 10) / 100,
                lineColor: els.lineColor.value,
                lineWeight: parseFloat(els.lineWeight.value),
                label: els.labelText.value.trim(),
                labelColor: els.labelColor.value,
                labelSize: parseFloat(els.labelSize.value)
            };
        }

        document.getElementById('layer-style-save').addEventListener('click', () => {
            const newStyle = collectStyle();
            close();
            if (typeof onSave === 'function') onSave(newStyle);
        });

        document.getElementById('layer-style-cancel').addEventListener('click', close);
        document.getElementById('layer-style-close').addEventListener('click', close);
        document.getElementById('layer-style-backdrop').addEventListener('click', (e) => {
            if (e.target.id === 'layer-style-backdrop') close();
        });

        document.addEventListener('keydown', handleEscapeKey, true);
    }

    return { open, close };
})();
