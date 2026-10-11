/*
 * DynaForm PDF — Progressive Web App shell.
 *
 * Replaces the WordPress side of the plugin (custom post type, admin-ajax
 * endpoints, [dynaform_studio] / [dynaform] shortcodes, HTML export) with
 * an on-device equivalent:
 *
 *   #/              Your forms (was: Form Studio dashboard)
 *   #/edit/<id>     Form builder (was: Form Studio builder)
 *   #/fill/<id>     Fill in a form -> PDF (was: [dynaform id="…"])
 *   #/f/<payload>   Fill in a form someone shared as a link
 *
 * Form definitions live in this browser's localStorage. Responses are
 * never stored or sent anywhere: the PDF is built and downloaded locally,
 * exactly as in the plugin.
 */
( function () {
	"use strict";

	var APP_VERSION = "1.3.1";
	var STORE_KEY = "dynaform.forms.v1";
	var PREF_KEY = "dynaform.prefs.v1";
	var app = document.getElementById( "app" );
	var frame = document.getElementById( "df-frame" );
	var ICONS = window.DF_ICONS || {};

	// Frame header shows the running version, from the constant above.
	document.getElementById( "df-frame-ver" ).textContent = "v" + APP_VERSION;
	document.getElementById( "brand-icon" ).outerHTML = ICONS.form || "";

	var TYPE_LABELS = {
		text: "Short answer",
		textarea: "Paragraph",
		date: "Date",
		email: "Email",
		number: "Number",
		phone: "Phone number",
		radio: "Multiple choice",
		checkbox: "Checkbox",
		dropdown: "Dropdown",
		gps: "GPS location",
		image: "Image upload",
		pagebreak: "Page break",
	};
	var ALLOWED_TYPES = Object.keys( TYPE_LABELS );

	/* ===============================================================
	 * Utilities
	 * ============================================================= */

	function escapeHtml( str ) {
		return String( str == null ? "" : str )
			.replace( /&/g, "&amp;" )
			.replace( /</g, "&lt;" )
			.replace( />/g, "&gt;" )
			.replace( /"/g, "&quot;" )
			.replace( /'/g, "&#39;" );
	}

	function uid() {
		if ( window.crypto && crypto.getRandomValues ) {
			var a = new Uint32Array( 2 );
			crypto.getRandomValues( a );
			return a[ 0 ].toString( 36 ) + a[ 1 ].toString( 36 );
		}
		return Math.random().toString( 36 ).slice( 2 ) + Date.now().toString( 36 );
	}

	function slugify( title ) {
		var s = String( title || "" ).replace( /[^\p{L}\p{M}\p{N}]+/gu, "-" ).replace( /^-+|-+$/g, "" ).toLowerCase();
		return s || "dynaform";
	}

	function formatDate( ts ) {
		try {
			return new Date( ts ).toLocaleString( undefined, { dateStyle: "medium", timeStyle: "short" } );
		} catch ( e ) {
			return new Date( ts ).toLocaleString();
		}
	}

	var toastTimer = null;
	function toast( msg, kind ) {
		var el = frame.querySelector( ".toast" );
		if ( ! el ) {
			el = document.createElement( "div" );
			el.setAttribute( "role", "status" );
			frame.appendChild( el );
		}
		el.className = "toast" + ( kind === "ok" ? " is-ok" : kind === "bad" ? " is-bad" : "" );
		el.textContent = msg;
		el.hidden = false;
		clearTimeout( toastTimer );
		toastTimer = setTimeout( function () {
			el.hidden = true;
		}, 2600 );
	}

	function downloadBlob( blob, filename ) {
		var url = URL.createObjectURL( blob );
		var a = document.createElement( "a" );
		a.href = url;
		a.download = filename;
		a.rel = "noopener";
		document.body.appendChild( a );
		a.click();
		document.body.removeChild( a );
		setTimeout( function () {
			URL.revokeObjectURL( url );
		}, 30000 );
	}

	function copyText( text ) {
		if ( navigator.clipboard && navigator.clipboard.writeText ) {
			return navigator.clipboard.writeText( text );
		}
		return new Promise( function ( resolve, reject ) {
			var tmp = document.createElement( "textarea" );
			tmp.value = text;
			tmp.style.position = "fixed";
			tmp.style.opacity = "0";
			document.body.appendChild( tmp );
			tmp.select();
			try {
				document.execCommand( "copy" );
				resolve();
			} catch ( e ) {
				reject( e );
			}
			document.body.removeChild( tmp );
		} );
	}

	function getPrefs() {
		try {
			return JSON.parse( localStorage.getItem( PREF_KEY ) ) || {};
		} catch ( e ) {
			return {};
		}
	}
	function setPref( k, v ) {
		var p = getPrefs();
		p[ k ] = v;
		try {
			localStorage.setItem( PREF_KEY, JSON.stringify( p ) );
		} catch ( e ) {}
	}

	/* ===============================================================
	 * Interface theme: Light "Stone" (default) or Dark "Graphite".
	 * Remembered per device; ?theme=dark|light overrides it for one visit.
	 * ============================================================= */

	var THEMES = [ "light", "dark" ];
	var themeOverride = ( /[?&]theme=(dark|light)\b/.exec( location.search ) || [] )[ 1 ] || null;
	var themeButtons = Array.prototype.slice.call( document.querySelectorAll( "#theme-switch button" ) );
	function currentTheme() {
		return frame.classList.contains( "df-theme-dark" ) ? "dark" : "light";
	}
	function applyTheme( t ) {
		if ( THEMES.indexOf( t ) === -1 ) {
			t = "light";
		}
		frame.classList.remove( "df-theme-light", "df-theme-dark" );
		frame.classList.add( "df-theme-" + t );
		document.documentElement.className = "df-html-" + t;
		var meta = document.getElementById( "theme-color" );
		if ( meta ) {
			meta.content = t === "dark" ? "#1d1e20" : "#d8d5ce";
		}
		themeButtons.forEach( function ( b ) {
			b.setAttribute( "aria-pressed", b.getAttribute( "data-theme" ) === t ? "true" : "false" );
		} );
	}
	themeButtons.forEach( function ( b ) {
		b.innerHTML = b.getAttribute( "data-theme" ) === "dark" ? ICONS.moon : ICONS.sun;
		b.addEventListener( "click", function () {
			var t = b.getAttribute( "data-theme" );
			setPref( "theme", t );
			applyTheme( t );
		} );
	} );
	applyTheme( themeOverride || ( THEMES.indexOf( getPrefs().theme ) !== -1 ? getPrefs().theme : "light" ) );

	/* ===============================================================
	 * Schema sanitising (port of Dynaform_CPT::sanitize_schema)
	 * ============================================================= */

	function cleanText( v ) {
		// Mirrors sanitize_text_field: single line, no tags, trimmed.
		return String( v == null ? "" : v ).replace( /<[^>]*>/g, "" ).replace( /[\r\n\t]+/g, " " ).replace( / {2,}/g, " " ).trim();
	}

	function sanitizeSchema( schema ) {
		schema = schema || {};
		var clean = { twoColumn: !! schema.twoColumn, questions: [] };
		( Array.isArray( schema.questions ) ? schema.questions : [] ).forEach( function ( q ) {
			if ( ! q || ALLOWED_TYPES.indexOf( q.type ) === -1 ) {
				return;
			}
			var item = {
				type: q.type,
				text: q.type === "pagebreak" ? "" : cleanText( q.text ),
				required: !! q.required,
				options: [],
			};
			if ( Array.isArray( q.options ) ) {
				q.options.forEach( function ( o ) {
					var c = cleanText( o );
					if ( c !== "" ) {
						item.options.push( c );
					}
				} );
			}
			if ( item.type === "number" ) {
				item.min = q.min !== null && q.min !== undefined && q.min !== "" && isFinite( q.min ) ? Number( q.min ) : null;
				item.max = q.max !== null && q.max !== undefined && q.max !== "" && isFinite( q.max ) ? Number( q.max ) : null;
			}
			if ( item.type === "date" ) {
				item.minDate = /^\d{4}-\d{2}-\d{2}$/.test( q.minDate || "" ) ? q.minDate : null;
				item.maxDate = /^\d{4}-\d{2}-\d{2}$/.test( q.maxDate || "" ) ? q.maxDate : null;
			}
			clean.questions.push( item );
		} );
		return clean;
	}

	/* ===============================================================
	 * Store (replaces the dynaform custom post type + admin-ajax CRUD)
	 * ============================================================= */

	var memoryFallback = null;
	var Store = {
		all: function () {
			if ( memoryFallback ) {
				return memoryFallback;
			}
			try {
				var raw = localStorage.getItem( STORE_KEY );
				var list = raw ? JSON.parse( raw ) : [];
				return Array.isArray( list ) ? list : [];
			} catch ( e ) {
				memoryFallback = [];
				toast( "This browser is blocking storage. Forms will be lost when you close the app.", "bad" );
				return memoryFallback;
			}
		},
		write: function ( list ) {
			if ( memoryFallback ) {
				memoryFallback = list;
				return;
			}
			try {
				localStorage.setItem( STORE_KEY, JSON.stringify( list ) );
			} catch ( e ) {
				memoryFallback = list;
				toast( "Could not save: this device's storage is full or blocked.", "bad" );
			}
		},
		get: function ( id ) {
			return Store.all().filter( function ( f ) {
				return f.id === id;
			} )[ 0 ] || null;
		},
		save: function ( form ) {
			var list = Store.all();
			var i = list.findIndex( function ( f ) {
				return f.id === form.id;
			} );
			form.modified = Date.now();
			if ( i === -1 ) {
				list.push( form );
			} else {
				list[ i ] = form;
			}
			Store.write( list );
			return form;
		},
		create: function ( title, schema ) {
			var now = Date.now();
			var form = {
				id: uid(),
				title: cleanText( title ) || "Untitled Form",
				schema: sanitizeSchema( schema || { questions: [], twoColumn: false } ),
				created: now,
				modified: now,
				pdfCount: 0,
			};
			Store.save( form );
			requestPersistence();
			return form;
		},
		remove: function ( id ) {
			Store.write( Store.all().filter( function ( f ) {
				return f.id !== id;
			} ) );
		},
	};

	function requestPersistence() {
		// Ask the browser not to evict our data under storage pressure.
		if ( navigator.storage && navigator.storage.persist ) {
			navigator.storage.persisted().then( function ( yes ) {
				if ( ! yes ) {
					navigator.storage.persist();
				}
			} ).catch( function () {} );
		}
	}

	function formPayload( form ) {
		return { title: form.title, questions: form.schema.questions, twoColumn: !! form.schema.twoColumn };
	}

	/* ===============================================================
	 * Share links: the form definition is packed into the URL hash,
	 * so it never touches a server (hash fragments aren't sent).
	 * ============================================================= */

	function bytesToB64url( bytes ) {
		var bin = "";
		for ( var i = 0; i < bytes.length; i += 0x8000 ) {
			bin += String.fromCharCode.apply( null, bytes.subarray( i, i + 0x8000 ) );
		}
		return btoa( bin ).replace( /\+/g, "-" ).replace( /\//g, "_" ).replace( /=+$/, "" );
	}
	function b64urlToBytes( s ) {
		s = s.replace( /-/g, "+" ).replace( /_/g, "/" );
		while ( s.length % 4 ) {
			s += "=";
		}
		var bin = atob( s );
		var out = new Uint8Array( bin.length );
		for ( var i = 0; i < bin.length; i++ ) {
			out[ i ] = bin.charCodeAt( i );
		}
		return out;
	}
	function streamBytes( bytes, stream ) {
		return new Response( new Blob( [ bytes ] ).stream().pipeThrough( stream ) ).arrayBuffer().then( function ( buf ) {
			return new Uint8Array( buf );
		} );
	}

	function encodeForm( form ) {
		var json = JSON.stringify( { v: 1, t: form.title, q: form.schema.questions, c: form.schema.twoColumn ? 1 : 0 } );
		var bytes = new TextEncoder().encode( json );
		if ( typeof CompressionStream === "function" ) {
			return streamBytes( bytes, new CompressionStream( "deflate-raw" ) ).then( function ( z ) {
				return "z" + bytesToB64url( z );
			} ).catch( function () {
				return "b" + bytesToB64url( bytes );
			} );
		}
		return Promise.resolve( "b" + bytesToB64url( bytes ) );
	}

	function decodeForm( payload ) {
		return Promise.resolve().then( function () {
			var kind = payload.charAt( 0 );
			var bytes = b64urlToBytes( payload.slice( 1 ) );
			if ( kind === "z" ) {
				if ( typeof DecompressionStream !== "function" ) {
					throw new Error( "This browser is too old to open compressed form links." );
				}
				return streamBytes( bytes, new DecompressionStream( "deflate-raw" ) );
			}
			if ( kind === "b" ) {
				return bytes;
			}
			throw new Error( "Unrecognised link format." );
		} ).then( function ( bytes ) {
			var data = JSON.parse( new TextDecoder().decode( bytes ) );
			return { title: cleanText( data.t ) || "Untitled Form", schema: sanitizeSchema( { questions: data.q, twoColumn: data.c } ) };
		} );
	}

	function shareUrl( encoded ) {
		return location.href.split( "#" )[ 0 ] + "#/f/" + encoded;
	}

	var shareDialog = document.getElementById( "share-dialog" );
	var shareLinkEl = document.getElementById( "share-link" );
	var shareNativeBtn = document.getElementById( "share-native" );
	var currentShare = null;

	function openShare( form ) {
		encodeForm( form ).then( function ( enc ) {
			var url = shareUrl( enc );
			currentShare = { url: url, title: form.title };
			shareLinkEl.value = url;
			shareNativeBtn.hidden = ! navigator.share;
			if ( shareDialog.showModal ) {
				shareDialog.showModal();
			} else {
				shareDialog.setAttribute( "open", "" );
			}
			shareLinkEl.focus();
			shareLinkEl.select();
		} );
	}
	function closeShare() {
		if ( shareDialog.close ) {
			shareDialog.close();
		} else {
			shareDialog.removeAttribute( "open" );
		}
	}
	document.getElementById( "share-close" ).addEventListener( "click", closeShare );
	document.getElementById( "share-copy" ).addEventListener( "click", function () {
		copyText( shareLinkEl.value ).then( function () {
			toast( "Link copied", "ok" );
		}, function () {
			shareLinkEl.select();
			toast( "Select the link and copy it manually", "bad" );
		} );
	} );
	shareNativeBtn.addEventListener( "click", function () {
		if ( currentShare ) {
			navigator.share( { title: currentShare.title, text: currentShare.title, url: currentShare.url } ).catch( function () {} );
		}
	} );

	/* ===============================================================
	 * Offline HTML export (port of Dynaform_Export::build, client-side)
	 * ============================================================= */

	var assetCache = {};
	function fetchText( path ) {
		if ( assetCache[ path ] ) {
			return Promise.resolve( assetCache[ path ] );
		}
		return fetch( path ).then( function ( r ) {
			if ( ! r.ok ) {
				throw new Error( "Missing " + path );
			}
			return r.text();
		} ).then( function ( t ) {
			assetCache[ path ] = t;
			return t;
		} );
	}
	function fetchDataUri( path, mime ) {
		if ( assetCache[ path ] ) {
			return Promise.resolve( assetCache[ path ] );
		}
		return fetch( path ).then( function ( r ) {
			if ( ! r.ok ) {
				throw new Error( "Missing " + path );
			}
			return r.arrayBuffer();
		} ).then( function ( buf ) {
			assetCache[ path ] = "data:" + mime + ";base64," + bytesToB64( new Uint8Array( buf ) );
			return assetCache[ path ];
		} );
	}
	function bytesToB64( bytes ) {
		var bin = "";
		for ( var i = 0; i < bytes.length; i += 0x8000 ) {
			bin += String.fromCharCode.apply( null, bytes.subarray( i, i + 0x8000 ) );
		}
		return btoa( bin );
	}
	function safeInline( code ) {
		return code.replace( /<\/script/gi, "<\\/script" ).replace( /<\/style/gi, "<\\/style" );
	}

	function exportStandalone( form ) {
		toast( "Preparing offline HTML…" );
		return Promise.all( [
			fetchText( "css/dynaform-frontend.css" ),
			fetchText( "js/vendor/jspdf.umd.min.js" ),
			fetchText( "js/vendor/noto-sans-bengali-normal.js" ),
			fetchText( "js/dynaform-frontend.js" ),
			fetchDataUri( "fonts/onest/onest-latin-wght-normal.woff2", "font/woff2" ),
			fetchDataUri( "fonts/onest/onest-latin-ext-wght-normal.woff2", "font/woff2" ),
		] ).then( function ( parts ) {
			var payload = escapeHtml( JSON.stringify( formPayload( form ) ) );
			var theme = currentTheme();
			var css = parts[ 0 ]
				.replace( "url(../fonts/onest/onest-latin-wght-normal.woff2)", "url(" + parts[ 4 ] + ")" )
				.replace( "url(../fonts/onest/onest-latin-ext-wght-normal.woff2)", "url(" + parts[ 5 ] + ")" );
			var html =
				"<!doctype html>\n<html lang=\"" + escapeHtml( document.documentElement.lang || "en" ) + "\">\n<head>\n" +
				"<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
				"<title>" + escapeHtml( form.title ) + "</title>\n" +
				"<meta name=\"theme-color\" content=\"" + ( theme === "dark" ? "#1d1e20" : "#d8d5ce" ) + "\">\n" +
				"<style>" + safeInline( css ) + "</style>\n" +
				"<style>html,body{margin:0;height:100%;background:" + ( theme === "dark" ? "#151617" : "#c9c6be" ) + ";}body{box-sizing:border-box;padding:12px 10px;}@media(min-width:700px){body{padding:24px 20px;}}@media(max-height:460px){html,body{height:auto;}}</style>\n" +
				"</head>\n<body>\n" +
				"<div class=\"df-frame df-frame-narrow df-frame-fit df-theme-" + theme + "\" id=\"df-frame\">\n" +
				"<div class=\"df-frame-head\"><span class=\"df-frame-brand\">DynaForm PDF <span class=\"df-frame-ver\">v" + APP_VERSION + "</span></span></div>\n" +
				"<div class=\"df-stage\">\n" +
				"<div class=\"dynaform-embed\" data-dynaform=\"" + payload + "\">\n<noscript><p>Please enable JavaScript to fill in this form.</p></noscript>\n</div>\n" +
				"<p class=\"dynaform-standalone-footer\">This is a standalone, offline copy of this form. Filling it in and submitting generates a PDF locally in your browser; nothing is uploaded anywhere.</p>\n" +
				"</div>\n" +
				"<div class=\"df-frame-foot\">Web app developed by <strong>Shankar Sinha</strong> for <strong>BhoomiTech Heritage and Development Foundation</strong> under <strong>CDEP</strong></div>\n" +
				"</div>\n" +
				"<script>" + safeInline( parts[ 1 ] ) + "</script>\n" +
				"<script>" + safeInline( parts[ 2 ] ) + "</script>\n" +
				"<script>" + safeInline( parts[ 3 ] ) + "</script>\n" +
				"</body>\n</html>\n";
			downloadBlob( new Blob( [ html ], { type: "text/html;charset=utf-8" } ), slugify( form.title ) + ".html" );
		} ).catch( function ( err ) {
			toast( "Could not build the HTML file: " + err.message, "bad" );
		} );
	}

	/* ===============================================================
	 * JSON import / export (replaces moving forms between WP sites)
	 * ============================================================= */

	function exportFormJson( form ) {
		var data = { format: "dynaform-form", version: 1, title: form.title, questions: form.schema.questions, twoColumn: !! form.schema.twoColumn };
		downloadBlob( new Blob( [ JSON.stringify( data, null, 2 ) ], { type: "application/json" } ), slugify( form.title ) + ".dynaform.json" );
	}

	function exportBackup() {
		var forms = Store.all().map( function ( f ) {
			return { title: f.title, questions: f.schema.questions, twoColumn: !! f.schema.twoColumn };
		} );
		var data = { format: "dynaform-backup", version: 1, exported: new Date().toISOString(), forms: forms };
		var d = new Date();
		var stamp = d.getFullYear() + "-" + String( d.getMonth() + 1 ).padStart( 2, "0" ) + "-" + String( d.getDate() ).padStart( 2, "0" );
		downloadBlob( new Blob( [ JSON.stringify( data, null, 2 ) ], { type: "application/json" } ), "dynaform-backup-" + stamp + ".json" );
	}

	var importInput = document.getElementById( "import-input" );
	importInput.addEventListener( "change", function () {
		var file = importInput.files && importInput.files[ 0 ];
		importInput.value = "";
		if ( ! file ) {
			return;
		}
		file.text().then( function ( text ) {
			var data = JSON.parse( text );
			var items = [];
			if ( data && Array.isArray( data.forms ) ) {
				items = data.forms;
			} else if ( data && ( Array.isArray( data.questions ) || ( data.schema && Array.isArray( data.schema.questions ) ) ) ) {
				items = [ data ];
			}
			if ( ! items.length ) {
				throw new Error( "no forms found" );
			}
			items.forEach( function ( it ) {
				var schema = it.schema || { questions: it.questions, twoColumn: it.twoColumn };
				Store.create( it.title, schema );
			} );
			toast( items.length === 1 ? "Imported 1 form" : "Imported " + items.length + " forms", "ok" );
			route();
		} ).catch( function ( err ) {
			toast( "That file isn't a DynaForm export (" + err.message + ").", "bad" );
		} );
	} );

	/* ===============================================================
	 * Router
	 * ============================================================= */

	var cleanupFns = [];
	function onCleanup( fn ) {
		cleanupFns.push( fn );
	}

	function route() {
		cleanupFns.splice( 0 ).forEach( function ( fn ) {
			try {
				fn();
			} catch ( e ) {}
		} );
		var hash = location.hash.replace( /^#\/?/, "" );
		var parts = hash.split( "/" );
		var view = parts[ 0 ];
		var arg = decodeURIComponent( parts.slice( 1 ).join( "/" ) );

		app.setAttribute( "data-view", view === "edit" && arg ? "builder" : view === "fill" || view === "f" ? "fill" : "home" );
		if ( view === "edit" && arg ) {
			renderBuilder( arg );
		} else if ( view === "fill" && arg ) {
			renderFill( arg );
		} else if ( view === "f" && arg ) {
			renderShared( arg );
		} else {
			renderDashboard();
		}
		app.scrollTop = 0;
		window.scrollTo( 0, 0 );
		app.focus( { preventScroll: true } );
	}

	function go( hash ) {
		if ( location.hash === hash ) {
			route();
		} else {
			location.hash = hash;
		}
	}

	window.addEventListener( "hashchange", route );

	/* ===============================================================
	 * Dashboard (port of renderDashboard)
	 * ============================================================= */

	function renderDashboard() {
		document.title = "Your forms · DynaForm PDF";
		var forms = Store.all().slice().sort( function ( a, b ) {
			return b.modified - a.modified;
		} );

		app.innerHTML =
			'<div class="dash-head">' +
				"<div><h1>Your forms</h1>" +
				'<p class="dash-sub">Build a form, then fill it in here or share it. Each submission is saved as a PDF on the device that filled it in.</p></div>' +
				'<div class="dash-tools">' +
					'<button type="button" class="dfb-btn" id="dfb-import">' + ICONS.upload + "Import</button>" +
					'<button type="button" class="dfb-btn" id="dfb-backup"' + ( forms.length ? "" : " disabled" ) + ">" + ICONS.archive + "Back up all</button>" +
				"</div>" +
			"</div>" +
			'<form class="dfb-new-form" id="dfb-new">' +
				'<input type="text" id="dfb-new-title" placeholder="Title of your new form" aria-label="New form title" maxlength="200">' +
				'<button type="submit" class="dfb-btn dfb-btn-primary">Create form</button>' +
			"</form>" +
			'<div id="dfb-list"></div>' +
			'<p class="privacy-note">Forms are stored only in this browser on this device. Use <strong>Back up all</strong> now and then, and before clearing browser data or switching phones.</p>';

		document.getElementById( "dfb-new" ).addEventListener( "submit", function ( e ) {
			e.preventDefault();
			var form = Store.create( document.getElementById( "dfb-new-title" ).value );
			go( "#/edit/" + form.id );
		} );
		document.getElementById( "dfb-import" ).addEventListener( "click", function () {
			importInput.click();
		} );
		document.getElementById( "dfb-backup" ).addEventListener( "click", exportBackup );

		var listEl = document.getElementById( "dfb-list" );
		if ( ! forms.length ) {
			listEl.innerHTML = '<div class="dfb-empty"><strong>No forms yet</strong>Type a title above and choose Create form, or import a form someone sent you.</div>';
			return;
		}

		var wrap = document.createElement( "div" );
		wrap.className = "dfb-list";
		listEl.appendChild( wrap );

		forms.forEach( function ( form ) {
			var qCount = form.schema.questions.filter( function ( q ) {
				return q.type !== "pagebreak";
			} ).length;
			var card = document.createElement( "div" );
			card.className = "dfb-card";
			card.innerHTML =
				'<div class="dfb-card-main">' +
					'<div class="dfb-card-title">' + escapeHtml( form.title ) + "</div>" +
					'<div class="dfb-card-meta">' + qCount + ( qCount === 1 ? " question" : " questions" ) +
						", edited " + escapeHtml( formatDate( form.modified ) ) +
						( form.pdfCount ? ", " + form.pdfCount + ( form.pdfCount === 1 ? " PDF" : " PDFs" ) + " made here" : "" ) +
					"</div>" +
				"</div>" +
				'<div class="dfb-card-actions">' +
					'<a class="dfb-btn dfb-btn-primary" href="#/fill/' + encodeURIComponent( form.id ) + '">Fill in</a>' +
					'<a class="dfb-btn" href="#/edit/' + encodeURIComponent( form.id ) + '">Edit</a>' +
					'<div class="menu">' +
						'<button type="button" class="dfb-btn dfb-btn-icon" aria-haspopup="true" aria-expanded="false" aria-label="More actions for ' + escapeHtml( form.title ) + '">' + ICONS.more + "</button>" +
						'<div class="menu-list" role="menu" hidden>' +
							'<button type="button" role="menuitem" data-act="share">' + ICONS.link + "Share as link</button>" +
							'<button type="button" role="menuitem" data-act="html">' + ICONS.download + "Download offline HTML</button>" +
							'<button type="button" role="menuitem" data-act="json">' + ICONS.code + "Export as file (.json)</button>" +
							'<button type="button" role="menuitem" data-act="dup">' + ICONS.copy + "Duplicate</button>" +
							"<hr>" +
							'<button type="button" role="menuitem" class="is-danger" data-act="delete">' + ICONS.trash + "Delete</button>" +
						"</div>" +
					"</div>" +
				"</div>";

			bindMenu( card.querySelector( ".menu" ), function ( act ) {
				if ( act === "share" ) {
					openShare( form );
				} else if ( act === "html" ) {
					exportStandalone( form );
				} else if ( act === "json" ) {
					exportFormJson( form );
				} else if ( act === "dup" ) {
					Store.create( form.title + " (copy)", form.schema );
					toast( "Duplicated", "ok" );
					renderDashboard();
				} else if ( act === "delete" ) {
					if ( window.confirm( 'Delete "' + form.title + '"? This removes it from this device and can\'t be undone.' ) ) {
						Store.remove( form.id );
						toast( "Deleted" );
						renderDashboard();
					}
				}
			} );
			wrap.appendChild( card );
		} );
	}

	var openMenu = null;
	function closeOpenMenu() {
		if ( openMenu ) {
			openMenu.list.hidden = true;
			openMenu.btn.setAttribute( "aria-expanded", "false" );
			openMenu = null;
		}
	}
	document.addEventListener( "click", function ( e ) {
		if ( openMenu && ! openMenu.root.contains( e.target ) ) {
			closeOpenMenu();
		}
	} );
	document.addEventListener( "keydown", function ( e ) {
		if ( e.key === "Escape" && openMenu ) {
			var btn = openMenu.btn;
			closeOpenMenu();
			btn.focus();
		}
	} );
	function bindMenu( root, onAction ) {
		var btn = root.querySelector( "button" );
		var list = root.querySelector( ".menu-list" );
		btn.addEventListener( "click", function () {
			var wasOpen = openMenu && openMenu.root === root;
			closeOpenMenu();
			if ( ! wasOpen ) {
				list.hidden = false;
				btn.setAttribute( "aria-expanded", "true" );
				openMenu = { root: root, btn: btn, list: list };
				var first = list.querySelector( "button" );
				if ( first ) {
					first.focus();
				}
			}
		} );
		list.addEventListener( "click", function ( e ) {
			var item = e.target.closest( "[data-act]" );
			if ( item ) {
				closeOpenMenu();
				onAction( item.getAttribute( "data-act" ) );
			}
		} );
	}

	/* ===============================================================
	 * Builder (port of buildEditor, with autosave + touch reordering)
	 * ============================================================= */

	function renderBuilder( id ) {
		var form = Store.get( id );
		if ( ! form ) {
			renderMissing();
			return;
		}
		document.title = "Edit: " + form.title + " · DynaForm PDF";

		var state = {
			questions: form.schema.questions.slice(),
			twoColumn: !! form.schema.twoColumn,
			editingIndex: null,
		};

		var typeOptions = ALLOWED_TYPES.map( function ( t ) {
			var label = t === "pagebreak" ? "Page break" : t === "dropdown" ? "Dropdown (single select)" : TYPE_LABELS[ t ];
			return '<option value="' + t + '">' + label + "</option>";
		} ).join( "" );

		app.innerHTML =
			'<div class="dfb-builder">' +
				'<div class="dfb-builder-top">' +
					'<a class="dfb-back" href="#/">' + ICONS.back + 'Your forms</a>' +
					'<div class="dfb-builder-actions">' +
						'<span id="dfb-save-status" role="status" aria-live="polite"></span>' +
						'<button type="button" class="dfb-btn" id="dfb-share-btn">' + ICONS.link + "Share as link</button>" +
						'<button type="button" class="dfb-btn" id="dfb-export-btn">' + ICONS.download + "Download offline HTML</button>" +
						'<a class="dfb-btn dfb-btn-primary" id="dfb-fill-btn" href="#/fill/' + encodeURIComponent( form.id ) + '">Fill in</a>' +
					"</div>" +
				"</div>" +
				'<div class="dfb-row">' +
					'<label for="dfb-title">Form title</label>' +
					'<input type="text" id="dfb-title" class="dfb-title-input" placeholder="Form title" maxlength="200">' +
				"</div>" +
				'<div id="dynaform-builder-app">' +
					'<div class="dfb-panel df-scroll-y" tabindex="-1" aria-label="Question editor">' +
						'<h3 id="df-panel-heading">Add a question</h3>' +
						'<div class="dfb-row" id="df-text-row">' +
							'<label for="df-q-text">Question text</label>' +
							'<input type="text" id="df-q-text" placeholder="Enter question">' +
						"</div>" +
						'<div class="dfb-row">' +
							'<label for="df-q-type">Answer type</label>' +
							'<select id="df-q-type">' + typeOptions + "</select>" +
						"</div>" +
						'<div class="dfb-row" id="df-number-range" hidden>' +
							"<label>Allowed range (optional)</label>" +
							'<div class="dfb-pair"><input type="number" id="df-min-value" placeholder="Minimum" aria-label="Minimum"><input type="number" id="df-max-value" placeholder="Maximum" aria-label="Maximum"></div>' +
						"</div>" +
						'<div class="dfb-row" id="df-date-range" hidden>' +
							"<label>Allowed dates (optional)</label>" +
							'<div class="dfb-pair"><input type="date" id="df-min-date" aria-label="Earliest date"><input type="date" id="df-max-date" aria-label="Latest date"></div>' +
						"</div>" +
						'<div class="dfb-row" id="df-options-row" hidden>' +
							'<label for="df-options">Options, one per line</label>' +
							'<textarea id="df-options" placeholder="Option A&#10;Option B"></textarea>' +
						"</div>" +
						'<div class="dfb-row dfb-inline">' +
							'<label><input type="checkbox" id="df-q-required"> Required</label>' +
						"</div>" +
						'<div class="dfb-row dfb-inline">' +
							'<button type="button" class="dfb-btn dfb-btn-primary" id="df-add-question">Add question</button>' +
							'<button type="button" class="dfb-btn" id="df-cancel-edit" hidden>Cancel</button>' +
						"</div>" +
						"<hr>" +
						'<div class="dfb-row dfb-inline">' +
							'<label><input type="checkbox" id="df-two-column"> Two-column layout on wide screens</label>' +
						"</div>" +
					"</div>" +
					'<div class="dfb-preview df-scroll-y" tabindex="-1" aria-label="Questions">' +
						"<h3>Questions</h3>" +
						'<div id="df-question-list" class="dfb-qlist"></div>' +
						'<p class="dfb-description">Drag, or use the arrows, to reorder. This order is used on the form and in the PDF.</p>' +
					"</div>" +
				"</div>" +
			"</div>";

		var els = {
			title: document.getElementById( "dfb-title" ),
			heading: document.getElementById( "df-panel-heading" ),
			textRow: document.getElementById( "df-text-row" ),
			text: document.getElementById( "df-q-text" ),
			type: document.getElementById( "df-q-type" ),
			required: document.getElementById( "df-q-required" ),
			options: document.getElementById( "df-options" ),
			optionsRow: document.getElementById( "df-options-row" ),
			min: document.getElementById( "df-min-value" ),
			max: document.getElementById( "df-max-value" ),
			numberRow: document.getElementById( "df-number-range" ),
			minDate: document.getElementById( "df-min-date" ),
			maxDate: document.getElementById( "df-max-date" ),
			dateRow: document.getElementById( "df-date-range" ),
			addBtn: document.getElementById( "df-add-question" ),
			cancelBtn: document.getElementById( "df-cancel-edit" ),
			twoColumn: document.getElementById( "df-two-column" ),
			list: document.getElementById( "df-question-list" ),
			status: document.getElementById( "dfb-save-status" ),
		};

		els.title.value = form.title;
		els.twoColumn.checked = state.twoColumn;

		var saveTimer = null;
		function persist( immediate ) {
			clearTimeout( saveTimer );
			var doSave = function () {
				form.title = cleanText( els.title.value ) || "Untitled Form";
				form.schema = sanitizeSchema( { questions: state.questions, twoColumn: state.twoColumn } );
				Store.save( form );
				els.status.textContent = "Saved";
				document.title = "Edit: " + form.title + " · DynaForm PDF";
			};
			if ( immediate ) {
				doSave();
			} else {
				els.status.textContent = "Saving…";
				saveTimer = setTimeout( doSave, 400 );
			}
		}
		onCleanup( function () {
			if ( saveTimer ) {
				persist( true );
			}
		} );
		window.addEventListener( "pagehide", flushOnHide );
		onCleanup( function () {
			window.removeEventListener( "pagehide", flushOnHide );
		} );
		function flushOnHide() {
			if ( saveTimer ) {
				persist( true );
			}
		}

		els.title.addEventListener( "input", function () {
			persist();
		} );
		els.twoColumn.addEventListener( "change", function () {
			state.twoColumn = els.twoColumn.checked;
			persist();
		} );
		els.type.addEventListener( "change", updateTypeSpecificFields );
		els.addBtn.addEventListener( "click", onAddOrUpdate );
		els.text.addEventListener( "keydown", function ( e ) {
			if ( e.key === "Enter" && ! e.isComposing ) {
				e.preventDefault();
				onAddOrUpdate();
			}
		} );
		els.cancelBtn.addEventListener( "click", cancelEdit );
		document.getElementById( "dfb-share-btn" ).addEventListener( "click", function () {
			persist( true );
			openShare( form );
		} );
		document.getElementById( "dfb-export-btn" ).addEventListener( "click", function () {
			persist( true );
			exportStandalone( form );
		} );

		updateTypeSpecificFields();
		renderList();

		function updateTypeSpecificFields() {
			var type = els.type.value;
			els.numberRow.hidden = type !== "number";
			els.dateRow.hidden = type !== "date";
			els.optionsRow.hidden = ! ( type === "radio" || type === "checkbox" || type === "dropdown" );
			els.textRow.hidden = type === "pagebreak";
		}

		function onAddOrUpdate() {
			var type = els.type.value;
			var text = els.text.value.trim();
			if ( type !== "pagebreak" && ! text ) {
				toast( "Enter the question text first" );
				els.text.focus();
				return;
			}
			var options = els.options.value.split( "\n" ).map( function ( o ) {
				return o.trim();
			} ).filter( Boolean );
			if ( ( type === "radio" || type === "checkbox" || type === "dropdown" ) && ! options.length ) {
				toast( "Add at least one option, one per line" );
				els.options.focus();
				return;
			}
			var question = {
				type: type,
				text: type === "pagebreak" ? "" : text,
				required: type === "pagebreak" ? false : els.required.checked,
				options: ( type === "radio" || type === "checkbox" || type === "dropdown" ) ? options : [],
			};
			if ( type === "number" ) {
				question.min = els.min.value !== "" ? Number( els.min.value ) : null;
				question.max = els.max.value !== "" ? Number( els.max.value ) : null;
				if ( question.min !== null && question.max !== null && question.min > question.max ) {
					toast( "Minimum is larger than maximum" );
					return;
				}
			}
			if ( type === "date" ) {
				question.minDate = els.minDate.value || null;
				question.maxDate = els.maxDate.value || null;
				if ( question.minDate && question.maxDate && question.minDate > question.maxDate ) {
					toast( "Earliest date is after the latest date" );
					return;
				}
			}

			if ( state.editingIndex !== null ) {
				state.questions[ state.editingIndex ] = question;
				cancelEdit();
			} else {
				state.questions.push( question );
				resetFields();
			}
			renderList();
			persist();
			els.text.focus();
		}

		function resetFields() {
			els.text.value = "";
			els.options.value = "";
			els.min.value = "";
			els.max.value = "";
			els.minDate.value = "";
			els.maxDate.value = "";
			els.required.checked = false;
		}

		function cancelEdit() {
			state.editingIndex = null;
			els.addBtn.textContent = "Add question";
			els.heading.textContent = "Add a question";
			els.cancelBtn.hidden = true;
			resetFields();
			renderList();
		}

		function editQuestion( index ) {
			var q = state.questions[ index ];
			state.editingIndex = index;
			els.text.value = q.text || "";
			els.type.value = q.type;
			updateTypeSpecificFields();
			els.options.value = ( q.options || [] ).join( "\n" );
			els.required.checked = !! q.required;
			els.min.value = q.min !== null && q.min !== undefined ? q.min : "";
			els.max.value = q.max !== null && q.max !== undefined ? q.max : "";
			els.minDate.value = q.minDate || "";
			els.maxDate.value = q.maxDate || "";
			els.addBtn.textContent = "Update question";
			els.heading.textContent = "Edit question " + ( index + 1 );
			els.cancelBtn.hidden = false;
			renderList();
			els.heading.scrollIntoView( { behavior: "smooth", block: "start" } );
			( q.type === "pagebreak" ? els.type : els.text ).focus( { preventScroll: true } );
		}

		function deleteQuestion( index ) {
			if ( ! window.confirm( "Remove this question?" ) ) {
				return;
			}
			state.questions.splice( index, 1 );
			if ( state.editingIndex === index ) {
				cancelEdit();
			} else if ( state.editingIndex !== null && state.editingIndex > index ) {
				state.editingIndex--;
			}
			renderList();
			persist();
		}

		function move( from, to ) {
			if ( to < 0 || to >= state.questions.length || from === to ) {
				return;
			}
			var moved = state.questions.splice( from, 1 )[ 0 ];
			state.questions.splice( to, 0, moved );
			if ( state.editingIndex === from ) {
				state.editingIndex = to;
			} else if ( state.editingIndex !== null ) {
				if ( from < state.editingIndex && to >= state.editingIndex ) {
					state.editingIndex--;
				} else if ( from > state.editingIndex && to <= state.editingIndex ) {
					state.editingIndex++;
				}
			}
			renderList();
			persist();
		}

		function renderList() {
			els.list.innerHTML = "";
			if ( ! state.questions.length ) {
				els.list.innerHTML = '<p class="dfb-empty">No questions yet. Add your first one using the panel.</p>';
				return;
			}
			var n = 0;
			state.questions.forEach( function ( q, index ) {
				var card = document.createElement( "div" );
				card.className = "dfb-qcard" + ( q.type === "pagebreak" ? " dfb-pagebreak-card" : "" ) + ( state.editingIndex === index ? " is-editing" : "" );
				card.draggable = true;
				card.dataset.index = index;
				var body;
				if ( q.type === "pagebreak" ) {
					body = '<div class="dfb-qcard-body">' + ICONS.pagebreak + "Page break</div>";
				} else {
					n++;
					body =
						'<div class="dfb-qcard-body">' +
							"<strong>" + n + ". " + escapeHtml( q.text ) + ( q.required ? " *" : "" ) + "</strong>" +
							'<span class="dfb-qcard-meta">' + TYPE_LABELS[ q.type ] +
								( q.options && q.options.length ? ", " + q.options.length + ( q.options.length === 1 ? " option" : " options" ) : "" ) +
							"</span>" +
						"</div>";
				}
				card.innerHTML = body +
					'<div class="dfb-qcard-actions">' +
						'<button type="button" class="dfb-btn dfb-btn-small dfb-btn-icon" data-act="up" aria-label="Move up"' + ( index === 0 ? " disabled" : "" ) + ">" + ICONS.up + "</button>" +
						'<button type="button" class="dfb-btn dfb-btn-small dfb-btn-icon" data-act="down" aria-label="Move down"' + ( index === state.questions.length - 1 ? " disabled" : "" ) + ">" + ICONS.down + "</button>" +
						'<button type="button" class="dfb-btn dfb-btn-small" data-act="edit">Edit</button>' +
						'<button type="button" class="dfb-btn dfb-btn-small dfb-btn-danger" data-act="delete">Delete</button>' +
					"</div>";
				card.querySelector( ".dfb-qcard-actions" ).addEventListener( "click", function ( e ) {
					var b = e.target.closest( "[data-act]" );
					if ( ! b ) {
						return;
					}
					var act = b.getAttribute( "data-act" );
					if ( act === "up" ) {
						move( index, index - 1 );
					} else if ( act === "down" ) {
						move( index, index + 1 );
					} else if ( act === "edit" ) {
						editQuestion( index );
					} else if ( act === "delete" ) {
						deleteQuestion( index );
					}
				} );
				els.list.appendChild( card );
			} );
			bindDragAndDrop();
		}

		function bindDragAndDrop() {
			var dragged = null;
			els.list.querySelectorAll( ".dfb-qcard" ).forEach( function ( card ) {
				card.addEventListener( "dragstart", function ( e ) {
					dragged = card;
					card.classList.add( "dfb-dragging" );
					try {
						e.dataTransfer.setData( "text/plain", card.dataset.index );
						e.dataTransfer.effectAllowed = "move";
					} catch ( err ) {}
				} );
				card.addEventListener( "dragend", function () {
					card.classList.remove( "dfb-dragging" );
				} );
				card.addEventListener( "dragover", function ( e ) {
					e.preventDefault();
					card.classList.add( "dfb-drag-over" );
				} );
				card.addEventListener( "dragleave", function () {
					card.classList.remove( "dfb-drag-over" );
				} );
				card.addEventListener( "drop", function ( e ) {
					e.preventDefault();
					card.classList.remove( "dfb-drag-over" );
					if ( ! dragged || dragged === card ) {
						return;
					}
					move( parseInt( dragged.dataset.index, 10 ), parseInt( card.dataset.index, 10 ) );
				} );
			} );
		}
	}

	/* ===============================================================
	 * Fill in (replaces the [dynaform id="…"] shortcode)
	 * ============================================================= */

	function mountFill( container, form, onSubmitted ) {
		var holder = document.createElement( "div" );
		holder.className = "dynaform-embed";
		holder.id = "dynaform-" + ( form.id || "shared" );
		container.appendChild( holder );
		if ( ! window.Dynaform || ! window.jspdf ) {
			holder.innerHTML = '<p class="dfb-empty">The PDF engine didn\'t load. Reload the app while online once so it can be stored for offline use.</p>';
			return;
		}
		window.Dynaform.mount( holder, formPayload( form ), { onSubmitted: onSubmitted } );
	}

	function renderFill( id ) {
		var form = Store.get( id );
		if ( ! form ) {
			renderMissing();
			return;
		}
		document.title = form.title + " · DynaForm PDF";
		app.innerHTML =
			'<div class="fill-top">' +
				'<a class="dfb-back" href="#/">' + ICONS.back + 'Your forms</a>' +
				'<span class="fill-count" id="fill-count"></span>' +
				'<a class="dfb-btn dfb-btn-small" href="#/edit/' + encodeURIComponent( form.id ) + '">Edit form</a>' +
			"</div>" +
			'<div class="fill-sheet" id="fill-sheet"></div>';

		var countEl = document.getElementById( "fill-count" );
		function showCount() {
			countEl.textContent = form.pdfCount ? form.pdfCount + ( form.pdfCount === 1 ? " PDF" : " PDFs" ) + " made on this device" : "";
		}
		showCount();

		if ( ! form.schema.questions.length ) {
			document.getElementById( "fill-sheet" ).innerHTML =
				"<h2>" + escapeHtml( form.title ) + "</h2>" +
				'<p class="dfb-empty">This form has no questions yet. <a href="#/edit/' + encodeURIComponent( form.id ) + '">Add some in the editor.</a></p>';
			return;
		}

		mountFill( document.getElementById( "fill-sheet" ), form, function () {
			// Only a counter is kept; the answers themselves are never stored.
			var fresh = Store.get( form.id );
			if ( fresh ) {
				fresh.pdfCount = ( fresh.pdfCount || 0 ) + 1;
				var list = Store.all().map( function ( f ) {
					return f.id === fresh.id ? fresh : f;
				} );
				Store.write( list ); // don't bump "modified"
				form.pdfCount = fresh.pdfCount;
				showCount();
			}
		} );
	}

	function renderShared( payload ) {
		app.innerHTML = '<p class="dfb-description">Opening form…</p>';
		decodeForm( payload ).then( function ( shared ) {
			document.title = shared.title + " · DynaForm PDF";
			var signature = JSON.stringify( [ shared.title, shared.schema ] );
			var existing = Store.all().filter( function ( f ) {
				return JSON.stringify( [ f.title, f.schema ] ) === signature;
			} )[ 0 ];

			app.innerHTML =
				'<div class="banner" style="margin:0 0 16px">' +
					"<p>" + ( existing ?
						"You already have this form saved on this device." :
						"Someone shared this form with you. Save it to use it again later, even offline." ) + "</p>" +
					( existing ?
						'<a class="dfb-btn dfb-btn-small" href="#/fill/' + encodeURIComponent( existing.id ) + '">Open saved copy</a>' :
						'<button type="button" class="dfb-btn dfb-btn-primary dfb-btn-small" id="save-shared">Save to my forms</button>' ) +
				"</div>" +
				'<div class="fill-sheet" id="fill-sheet"></div>';

			var saveBtn = document.getElementById( "save-shared" );
			if ( saveBtn ) {
				saveBtn.addEventListener( "click", function () {
					var f = Store.create( shared.title, shared.schema );
					toast( "Saved to your forms", "ok" );
					go( "#/fill/" + f.id );
				} );
			}
			if ( ! shared.schema.questions.length ) {
				document.getElementById( "fill-sheet" ).innerHTML = '<p class="dfb-empty">This shared form has no questions.</p>';
				return;
			}
			mountFill( document.getElementById( "fill-sheet" ), shared );
		} ).catch( function ( err ) {
			app.innerHTML =
				'<div class="dfb-empty"><strong>This link doesn\'t contain a readable form</strong>' +
				"It may have been cut off when it was copied. Ask the sender to share it again. (" + escapeHtml( err.message ) + ")</div>" +
				'<p><a class="dfb-back" href="#/">' + ICONS.back + 'Your forms</a></p>';
		} );
	}

	function renderMissing() {
		document.title = "Form not found · DynaForm PDF";
		app.innerHTML =
			'<div class="dfb-empty"><strong>Form not found</strong>It may have been deleted, or it was created in a different browser or on another device.</div>' +
			'<p><a class="dfb-back" href="#/">' + ICONS.back + 'Your forms</a></p>';
	}

	/* ===============================================================
	 * PWA plumbing: service worker, updates, install, network status
	 * ============================================================= */

	var netEl = document.getElementById( "net-status" );
	function updateNet() {
		var online = navigator.onLine;
		netEl.textContent = online ? "Online" : "Offline";
		netEl.classList.toggle( "is-offline", ! online );
	}
	window.addEventListener( "online", updateNet );
	window.addEventListener( "offline", updateNet );
	updateNet();

	var isStandalone = window.matchMedia( "(display-mode: standalone)" ).matches || window.navigator.standalone === true;

	var installBtn = document.getElementById( "install-btn" );
	var deferredPrompt = null;
	window.addEventListener( "beforeinstallprompt", function ( e ) {
		e.preventDefault();
		deferredPrompt = e;
		installBtn.hidden = false;
	} );
	installBtn.addEventListener( "click", function () {
		if ( ! deferredPrompt ) {
			return;
		}
		deferredPrompt.prompt();
		deferredPrompt.userChoice.finally( function () {
			deferredPrompt = null;
			installBtn.hidden = true;
		} );
	} );
	window.addEventListener( "appinstalled", function () {
		installBtn.hidden = true;
		toast( "DynaForm installed", "ok" );
	} );

	var isIOS = /iphone|ipad|ipod/i.test( navigator.userAgent ) || ( navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 );
	if ( isIOS && ! isStandalone && ! getPrefs().iosTipDismissed ) {
		var iosBanner = document.getElementById( "ios-install-banner" );
		iosBanner.hidden = false;
		document.getElementById( "ios-install-dismiss" ).addEventListener( "click", function () {
			iosBanner.hidden = true;
			setPref( "iosTipDismissed", true );
		} );
	}

	if ( "serviceWorker" in navigator && ( location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1" ) ) {
		var refreshing = false;
		navigator.serviceWorker.addEventListener( "controllerchange", function () {
			if ( ! refreshing ) {
				refreshing = true;
				location.reload();
			}
		} );
		window.addEventListener( "load", function () {
			navigator.serviceWorker.register( "sw.js" ).then( function ( reg ) {
				function offerUpdate( worker ) {
					var banner = document.getElementById( "update-banner" );
					banner.hidden = false;
					document.getElementById( "update-btn" ).onclick = function () {
						worker.postMessage( { type: "SKIP_WAITING" } );
					};
				}
				if ( reg.waiting && navigator.serviceWorker.controller ) {
					offerUpdate( reg.waiting );
				}
				reg.addEventListener( "updatefound", function () {
					var nw = reg.installing;
					if ( ! nw ) {
						return;
					}
					nw.addEventListener( "statechange", function () {
						if ( nw.state === "installed" ) {
							if ( navigator.serviceWorker.controller ) {
								offerUpdate( nw );
							} else {
								toast( "Ready to work offline", "ok" );
							}
						}
					} );
				} );
				// Check for a new version whenever the app comes back to the foreground.
				document.addEventListener( "visibilitychange", function () {
					if ( document.visibilityState === "visible" && navigator.onLine ) {
						reg.update().catch( function () {} );
					}
				} );
			} ).catch( function () {} );
		} );
	}

	route();
} )();
