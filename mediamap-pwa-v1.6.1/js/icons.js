/* Media Map — interface icons.
 *
 * One table of line icons for the whole interface (BhoomiTech spec): 24×24 viewBox, no fill,
 * stroke = currentColor at 1.7, round caps and joins. index.html carries the same paths for the
 * icons it shows before the script runs; keep the two in step.
 * Map pins are not here: they are markers, drawn in app.js.
 */
export const ICONS = {
    pin:      '<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>',
    folder:   '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    list:     '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" stroke-width="2.4"/>',
    layers:   '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.2 8.5 4.3 8.5-4.3"/>',
    settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    locate:   '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
    plus:     '<path d="M12 5v14M5 12h14"/>',
    minus:    '<path d="M5 12h14"/>',
    close:    '<path d="M6 6l12 12M18 6 6 18"/>',
    back:     '<path d="M14.5 6 8.5 12l6 6"/>',
    up:       '<path d="m6 14.5 6-6 6 6"/>',
    down:     '<path d="m6 9.5 6 6 6-6"/>',
    chevron:  '<path d="m6 9.5 6 6 6-6"/>',
    fit:      '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    download: '<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 19.5h14"/>',
    doc:      '<path d="M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M13.5 3.5V8.5h5M9 13h6M9 16.5h6"/>',
};

/** The icon as an inline SVG string, `size` pixels square. */
export function icon( name, size = 20, cls = '' ) {
    return `<svg class="ico${ cls ? ' ' + cls : '' }" viewBox="0 0 24 24" width="${ size }" height="${ size }" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ ICONS[ name ] || '' }</svg>`;
}
