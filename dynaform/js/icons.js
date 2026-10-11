/*
 * DynaForm PDF — the one icon table. Inline SVG line icons, 24×24,
 * stroke = currentColor, rendered at 14–18px by CSS (.df-ico).
 */
( function () {
	"use strict";
	var P = {
		form: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m8.5 13 1.5 1.5 3-3"/><path d="M9 18h6"/>',
		sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
		moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
		more: '<circle cx="5" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="19" cy="12" r="1.1"/>',
		up: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
		down: '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
		back: '<path d="m14.5 18-6-6 6-6"/>',
		copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
		paste: '<path d="M9 3.5h6v3H9z"/><path d="M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
		link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
		download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
		upload: '<path d="M12 15V4M7 9l5-5 5 5M5 20h14"/>',
		archive: '<path d="M4 4h16v5H4z"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
		code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>',
		trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
		pagebreak: '<path d="M4 12h3M10.5 12h3M17 12h3"/><path d="M6 8V4h12v4M6 16v4h12v-4"/>',
		table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10"/>',
		chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
		pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
		sheet: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8 12h8M8 16h8M12 12v8"/>',
	};
	function svg( name ) {
		return P[ name ] ?
			'<svg class="df-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + P[ name ] + "</svg>" :
			"";
	}
	var ICONS = {};
	Object.keys( P ).forEach( function ( k ) {
		ICONS[ k ] = svg( k );
	} );
	window.DF_ICONS = Object.freeze( ICONS );
} )();
