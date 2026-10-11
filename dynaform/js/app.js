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

	var APP_VERSION = "1.4.0";
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
		signature: "Signature",
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
		var clean = { twoColumn: !! schema.twoColumn, keepResponses: schema.keepResponses !== false, questions: [] };
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
				list = Array.isArray( list ) ? list : [];
				// 1.4: every form gets a lasting key that travels with its copies,
				// so responses from any device can be matched to it.
				var changed = false;
				list.forEach( function ( f ) {
					if ( f && ! f.key ) {
						f.key = "k" + uid() + uid();
						changed = true;
					}
				} );
				if ( changed ) {
					try {
						localStorage.setItem( STORE_KEY, JSON.stringify( list ) );
					} catch ( e2 ) {}
				}
				return list;
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
		create: function ( title, schema, key ) {
			var now = Date.now();
			var form = {
				id: uid(),
				key: typeof key === "string" && /^[A-Za-z0-9_-]{6,80}$/.test( key ) ? key : "k" + uid() + uid(),
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
		return { title: form.title, key: form.key || null, questions: form.schema.questions, twoColumn: !! form.schema.twoColumn, keepResponses: form.schema.keepResponses !== false };
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
		var json = JSON.stringify( { v: 1, t: form.title, k: form.key || undefined, q: form.schema.questions, c: form.schema.twoColumn ? 1 : 0, r: form.schema.keepResponses === false ? 0 : 1 } );
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
			return { title: cleanText( data.t ) || "Untitled Form", key: typeof data.k === "string" ? data.k : null, schema: sanitizeSchema( { questions: data.q, twoColumn: data.c, keepResponses: data.r !== 0 } ) };
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
				"<p class=\"dynaform-standalone-footer\">This is a standalone, offline copy of this form. Filling it in and submitting generates a PDF locally in your browser; nothing is uploaded anywhere. The PDF also carries the answers as data, so whoever collects the PDFs can add them to the form&#39;s response table in DynaForm.</p>\n" +
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
		var data = { format: "dynaform-form", version: 1, title: form.title, key: form.key, questions: form.schema.questions, twoColumn: !! form.schema.twoColumn, keepResponses: form.schema.keepResponses !== false };
		downloadBlob( new Blob( [ JSON.stringify( data, null, 2 ) ], { type: "application/json" } ), slugify( form.title ) + ".dynaform.json" );
	}

	function exportBackup() {
		var forms = Store.all().map( function ( f ) {
			return { title: f.title, key: f.key, questions: f.schema.questions, twoColumn: !! f.schema.twoColumn, keepResponses: f.schema.keepResponses !== false };
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
				var schema = it.schema || { questions: it.questions, twoColumn: it.twoColumn, keepResponses: it.keepResponses };
				Store.create( it.title, schema, it.key );
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

		app.setAttribute( "data-view", view === "edit" && arg ? "builder" : view === "fill" || view === "f" ? "fill" : view === "responses" && arg ? "responses" : "home" );
		if ( view === "edit" && arg ) {
			renderBuilder( arg );
		} else if ( view === "responses" && arg ) {
			renderResponses( arg );
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
				'<p class="dash-sub">Build a form, then fill it in here or share it. Each submission is saved as a PDF on the device that filled it in, and can be gathered into a response table.</p></div>' +
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
			'<p class="privacy-note">Forms and responses are stored only in this browser on this device; nothing is uploaded. Use <strong>Back up all</strong> (forms) and <strong>Responses › Export</strong> now and then, and before clearing browser data or switching phones.</p>';

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
						'<span class="dfb-card-resp" data-key="' + escapeHtml( form.key ) + '"></span>' +
					"</div>" +
				"</div>" +
				'<div class="dfb-card-actions">' +
					'<a class="dfb-btn dfb-btn-primary" href="#/fill/' + encodeURIComponent( form.id ) + '">Fill in</a>' +
					'<a class="dfb-btn" href="#/edit/' + encodeURIComponent( form.id ) + '">Edit</a>' +
					'<a class="dfb-btn" href="#/responses/' + encodeURIComponent( form.id ) + '">' + ICONS.table + "Responses</a>" +
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
					Store.create( form.title + " (copy)", form.schema ); // a copy is a new form, with its own key
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
		listEl.querySelectorAll( ".dfb-card-resp" ).forEach( function ( el ) {
			Responses.count( el.getAttribute( "data-key" ) ).then( function ( n ) {
				el.textContent = n ? ", " + n + ( n === 1 ? " response" : " responses" ) : "";
			} ).catch( function () {} );
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
			keepResponses: form.schema.keepResponses !== false,
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
						'<a class="dfb-btn" href="#/responses/' + encodeURIComponent( form.id ) + '">' + ICONS.table + "Responses</a>" +
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
						'<div class="dfb-row dfb-inline">' +
							'<label><input type="checkbox" id="df-keep-responses"> Keep a copy of each response on the device that fills it in, for the response table</label>' +
						"</div>" +
						'<p class="dfb-description">Turn this off for sensitive forms. Every PDF still carries its answers, so the organiser can import the PDFs into the table instead.</p>' +
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
		var keepEl = document.getElementById( "df-keep-responses" );
		keepEl.checked = state.keepResponses;
		keepEl.addEventListener( "change", function () {
			state.keepResponses = keepEl.checked;
			persist();
		} );

		var saveTimer = null;
		function persist( immediate ) {
			clearTimeout( saveTimer );
			var doSave = function () {
				form.title = cleanText( els.title.value ) || "Untitled Form";
				form.schema = sanitizeSchema( { questions: state.questions, twoColumn: state.twoColumn, keepResponses: state.keepResponses } );
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
		var keep = form.schema.keepResponses !== false && !! form.key;
		var holder = document.createElement( "div" );
		holder.className = "dynaform-embed";
		holder.id = "dynaform-" + ( form.id || "shared" );
		container.appendChild( holder );
		if ( ! window.Dynaform || ! window.jspdf ) {
			holder.innerHTML = '<p class="dfb-empty">The PDF engine didn\'t load. Reload the app while online once so it can be stored for offline use.</p>';
			return;
		}
		window.Dynaform.mount( holder, formPayload( form ), {
			notice: keep ? "A copy of each response is kept on this device for the form's response table. Nothing is uploaded." : "",
			onSubmitted: function ( result ) {
				if ( keep && result && result.record ) {
					Responses.add( result.record, "Filled in on this device", "" ).catch( function () {
						toast( "The PDF was made, but the response could not be added to the table on this device.", "bad" );
					} );
				}
				if ( onSubmitted ) {
					onSubmitted( result );
				}
			},
		} );
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
				'<a class="dfb-btn dfb-btn-small" href="#/responses/' + encodeURIComponent( form.id ) + '">' + ICONS.table + "Responses</a>" +
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
			// Counter of PDFs made here (the response itself is kept by Responses, if the form allows).
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
					var f = Store.create( shared.title, shared.schema, shared.key );
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
	 * Responses (1.4): kept in this browser (IndexedDB), read back from
	 * PDFs or response files, shown as a table and summary, exported as
	 * a spreadsheet (CSV), data (JSON) or map points (GeoJSON).
	 * ============================================================= */

	var Responses = ( function () {
		var dbp = null;
		function db() {
			if ( dbp ) {
				return dbp;
			}
			dbp = new Promise( function ( resolve, reject ) {
				var r = indexedDB.open( "dynaform", 1 );
				r.onupgradeneeded = function () {
					var st = r.result.createObjectStore( "responses", { keyPath: "id" } );
					st.createIndex( "key", "key" );
				};
				r.onsuccess = function () {
					resolve( r.result );
				};
				r.onerror = function () {
					reject( r.error );
				};
			} );
			dbp.catch( function () {
				dbp = null;
			} );
			return dbp;
		}
		function tx( mode, fn ) {
			return db().then( function ( d ) {
				return new Promise( function ( resolve, reject ) {
					var t = d.transaction( "responses", mode );
					var req = fn( t.objectStore( "responses" ) );
					t.oncomplete = function () {
						resolve( req && typeof req === "object" && "result" in req ? req.result : req );
					};
					t.onerror = function () {
						reject( t.error );
					};
					t.onabort = function () {
						reject( t.error || new Error( "aborted" ) );
					};
				} );
			} );
		}
		return {
			add: function ( rec, source, file, keyOverride ) {
				requestPersistence();
				var row = { id: keyOverride ? rec.id + "@" + keyOverride : rec.id, key: keyOverride || ( rec.form && rec.form.key ) || "", savedAt: Date.now(), source: source || "", file: file || "", rec: rec };
				return tx( "readwrite", function ( s ) {
					return s.put( row );
				} );
			},
			has: function ( id ) {
				return tx( "readonly", function ( s ) {
					return s.count( id );
				} ).then( function ( n ) {
					return n > 0;
				} );
			},
			list: function ( key ) {
				return tx( "readonly", function ( s ) {
					return s.index( "key" ).getAll( key );
				} );
			},
			count: function ( key ) {
				return tx( "readonly", function ( s ) {
					return s.index( "key" ).count( key );
				} );
			},
			remove: function ( id ) {
				return tx( "readwrite", function ( s ) {
					return s.delete( id );
				} );
			},
			removeAll: function ( key ) {
				return tx( "readwrite", function ( s ) {
					var r = s.index( "key" ).getAllKeys( key );
					r.onsuccess = function () {
						r.result.forEach( function ( id ) {
							s.delete( id );
						} );
					};
					return null;
				} );
			},
		};
	} )();

	/* Columns: the form's questions as they are now, then any questions
	   that only older responses have (the form was edited since). */
	function qKey( type, text, seen ) {
		var k = type + "|" + text;
		seen[ k ] = ( seen[ k ] || 0 ) + 1;
		return k + "|" + seen[ k ];
	}
	function buildColumns( form, rows ) {
		var cols = [];
		var have = {};
		var seen = {};
		form.schema.questions.forEach( function ( q ) {
			if ( q.type === "pagebreak" ) {
				return;
			}
			var k = qKey( q.type, q.text, seen );
			have[ k ] = true;
			cols.push( { key: k, type: q.type, text: q.text, options: q.options || [], old: false } );
		} );
		rows.forEach( function ( row ) {
			var s2 = {};
			( row.rec.answers || [] ).forEach( function ( a ) {
				var k = qKey( a.type, a.q, s2 );
				if ( ! have[ k ] ) {
					have[ k ] = true;
					cols.push( { key: k, type: a.type, text: a.q, options: [], old: true } );
				}
			} );
		} );
		return cols;
	}
	function answerMap( rec ) {
		var m = {};
		var seen = {};
		( rec.answers || [] ).forEach( function ( a ) {
			m[ qKey( a.type, a.q, seen ) ] = a.value;
		} );
		return m;
	}
	function isBlank( v ) {
		return v === "" || v === null || v === undefined || v === false || ( Array.isArray( v ) && ! v.length );
	}
	function cellText( type, v ) {
		if ( isBlank( v ) ) {
			return "";
		}
		if ( type === "gps" && typeof v === "object" ) {
			return v.lat + ", " + v.lng + ( v.acc != null ? " (±" + v.acc + " m)" : "" );
		}
		if ( type === "signature" ) {
			return v ? "Signed" : "";
		}
		if ( Array.isArray( v ) ) {
			return v.join( "; " );
		}
		return String( v );
	}
	function stamp( iso ) {
		var d = new Date( iso );
		if ( isNaN( d ) ) {
			return String( iso || "" );
		}
		var p = function ( n ) {
			return String( n ).padStart( 2, "0" );
		};
		return d.getFullYear() + "-" + p( d.getMonth() + 1 ) + "-" + p( d.getDate() ) + " " + p( d.getHours() ) + ":" + p( d.getMinutes() );
	}
	function csvCell( v ) {
		var s = String( v == null ? "" : v );
		return /[",\r\n]/.test( s ) || /^[=+\-@]/.test( s ) ? '"' + ( /^[=+\-@]/.test( s ) ? "'" : "" ) + s.replace( /"/g, '""' ) + '"' : s;
	}
	function toCsv( form, cols, rows ) {
		var head = [ "Response ID", "Submitted", "Source" ];
		cols.forEach( function ( c ) {
			if ( c.type === "gps" ) {
				head.push( c.text + " (latitude)", c.text + " (longitude)", c.text + " (accuracy m)" );
			} else {
				head.push( c.text + ( c.old ? " (earlier version)" : "" ) );
			}
		} );
		var lines = [ head.map( csvCell ).join( "," ) ];
		rows.forEach( function ( row ) {
			var m = answerMap( row.rec );
			var line = [ row.rec.id, stamp( row.rec.submittedAt ), row.source + ( row.file ? ": " + row.file : "" ) ];
			cols.forEach( function ( c ) {
				var v = m[ c.key ];
				if ( c.type === "gps" ) {
					var g = v && typeof v === "object" ? v : {};
					line.push( g.lat != null ? g.lat : "", g.lng != null ? g.lng : "", g.acc != null ? g.acc : "" );
				} else if ( c.type === "number" ) {
					line.push( isBlank( v ) ? "" : v );
				} else {
					line.push( cellText( c.type, v ) );
				}
			} );
			lines.push( line.map( csvCell ).join( "," ) );
		} );
		return "﻿" + lines.join( "\r\n" ) + "\r\n";
	}
	function toGeoJson( form, cols, rows ) {
		var gpsCol = cols.filter( function ( c ) {
			return c.type === "gps";
		} )[ 0 ];
		var feats = [];
		rows.forEach( function ( row ) {
			var m = answerMap( row.rec );
			var g = gpsCol && m[ gpsCol.key ];
			if ( ! g || typeof g !== "object" || ! isFinite( g.lat ) || ! isFinite( g.lng ) ) {
				return;
			}
			var props = { response_id: row.rec.id, submitted: stamp( row.rec.submittedAt ) };
			cols.forEach( function ( c ) {
				if ( c !== gpsCol ) {
					props[ c.text ] = c.type === "number" && ! isBlank( m[ c.key ] ) ? m[ c.key ] : cellText( c.type, m[ c.key ] );
				}
			} );
			props[ gpsCol.text + " accuracy (m)" ] = g.acc != null ? g.acc : null;
			feats.push( { type: "Feature", geometry: { type: "Point", coordinates: [ Number( g.lng ), Number( g.lat ) ] }, properties: props } );
		} );
		return { type: "FeatureCollection", name: form.title, features: feats };
	}
	function sortRows( rows ) {
		return rows.sort( function ( a, b ) {
			return String( b.rec.submittedAt ).localeCompare( String( a.rec.submittedAt ) );
		} );
	}

	function renderResponses( id ) {
		var form = Store.get( id );
		if ( ! form ) {
			renderMissing();
			return;
		}
		document.title = "Responses: " + form.title + " · DynaForm PDF";
		var view = getPrefs().respView === "summary" ? "summary" : "table";
		app.innerHTML =
			'<div class="fill-top">' +
				'<a class="dfb-back" href="#/">' + ICONS.back + "Your forms</a>" +
				'<span class="fill-count"></span>' +
				'<a class="dfb-btn dfb-btn-small" href="#/edit/' + encodeURIComponent( form.id ) + '">Edit form</a>' +
				'<a class="dfb-btn dfb-btn-small dfb-btn-primary" href="#/fill/' + encodeURIComponent( form.id ) + '">Fill in</a>' +
			"</div>" +
			'<div class="resp">' +
				'<div class="resp-head"><div><h1>' + escapeHtml( form.title ) + '</h1><p class="dash-sub" id="resp-count">Loading responses…</p></div>' +
				'<div class="resp-tools">' +
					'<button type="button" class="dfb-btn" id="resp-import">' + ICONS.upload + "Add PDFs or files</button>" +
					'<div class="menu"><button type="button" class="dfb-btn" aria-haspopup="true" aria-expanded="false" id="resp-export-btn">' + ICONS.download + "Export</button>" +
						'<div class="menu-list" role="menu" hidden>' +
							'<button type="button" role="menuitem" data-act="csv">' + ICONS.sheet + "Spreadsheet (.csv, opens in Excel)</button>" +
							'<button type="button" role="menuitem" data-act="json">' + ICONS.code + "Response data (.json), to merge on another device</button>" +
							'<button type="button" role="menuitem" data-act="geojson" id="resp-geo-item">' + ICONS.pin + "GPS locations (.geojson), for GeoViewer or QGIS</button>" +
							"<hr>" +
							'<button type="button" role="menuitem" class="is-danger" data-act="clear">' + ICONS.trash + "Delete all responses on this device</button>" +
						"</div></div>" +
				"</div></div>" +
				'<p class="resp-note">Responses filled in on this device are added automatically' + ( form.schema.keepResponses === false ? " (turned off for this form)" : "" ) + '. To bring in responses from other phones, use <strong>Add PDFs or files</strong> with the PDFs people sent you, or with a response file exported on another device. Nothing is uploaded.</p>' +
				'<div class="resp-bar">' +
					'<div class="resp-tabs" role="tablist"><button type="button" role="tab" data-view="table">' + ICONS.table + 'Table</button><button type="button" role="tab" data-view="summary">' + ICONS.chart + "Summary</button></div>" +
					'<input type="text" class="resp-search" id="resp-search" placeholder="Search responses…" aria-label="Search responses" autocomplete="off" spellcheck="false">' +
				"</div>" +
				'<div id="resp-body"></div>' +
			"</div>" +
			'<input type="file" id="resp-file" accept=".pdf,.json,application/pdf,application/json" multiple hidden>';

		var rows = [];
		var cols = [];
		var body = document.getElementById( "resp-body" );
		var search = document.getElementById( "resp-search" );
		var fileIn = document.getElementById( "resp-file" );

		function setView( v ) {
			view = v;
			setPref( "respView", v );
			app.querySelectorAll( ".resp-tabs [data-view]" ).forEach( function ( b ) {
				b.setAttribute( "aria-selected", b.getAttribute( "data-view" ) === v ? "true" : "false" );
			} );
			search.hidden = v !== "table";
			draw();
		}
		app.querySelectorAll( ".resp-tabs [data-view]" ).forEach( function ( b ) {
			b.addEventListener( "click", function () {
				setView( b.getAttribute( "data-view" ) );
			} );
		} );
		var sTimer = null;
		search.addEventListener( "input", function () {
			clearTimeout( sTimer );
			sTimer = setTimeout( draw, 120 );
		} );

		function load() {
			return Responses.list( form.key ).then( function ( list ) {
				rows = sortRows( list || [] );
				cols = buildColumns( form, rows );
				document.getElementById( "resp-count" ).textContent = rows.length ? rows.length + ( rows.length === 1 ? " response" : " responses" ) + " on this device" : "No responses on this device yet";
				document.getElementById( "resp-geo-item" ).hidden = ! cols.some( function ( c ) {
					return c.type === "gps";
				} );
				draw();
			} ).catch( function () {
				body.innerHTML = '<div class="dfb-empty"><strong>Responses can\'t be stored in this browser</strong>Private or locked-down browser windows often block storage. Open DynaForm in a normal window.</div>';
			} );
		}

		function draw() {
			if ( ! rows.length ) {
				body.innerHTML = '<div class="dfb-empty"><strong>No responses yet</strong>Fill in the form on this device, or add the PDFs that respondents sent you.</div>';
				return;
			}
			if ( view === "summary" ) {
				drawSummary();
			} else {
				drawTable();
			}
		}

		function drawTable() {
			var words = search.value.toLowerCase().normalize( "NFKC" ).trim().split( /\s+/ ).filter( Boolean );
			var shown = 0;
			var html = '<div class="resp-scroll"><table class="resp-table"><thead><tr><th>#</th><th>Submitted</th>';
			cols.forEach( function ( c ) {
				html += "<th" + ( c.old ? ' class="is-old" title="Only in responses to an earlier version of the form"' : "" ) + ">" + escapeHtml( c.text ) + "</th>";
			} );
			html += '<th>Source</th><th><span class="sr-only">Delete</span></th></tr></thead><tbody>';
			rows.forEach( function ( row, i ) {
				var m = answerMap( row.rec );
				var cells = cols.map( function ( c ) {
					return cellText( c.type, m[ c.key ] );
				} );
				var hay = ( stamp( row.rec.submittedAt ) + " " + cells.join( " " ) + " " + row.source + " " + row.file ).toLowerCase().normalize( "NFKC" );
				if ( words.length && ! words.every( function ( w ) {
					return hay.indexOf( w ) >= 0;
				} ) ) {
					return;
				}
				shown++;
				html += '<tr><td class="resp-n">' + ( rows.length - i ) + "</td><td>" + escapeHtml( stamp( row.rec.submittedAt ) ) + "</td>";
				cells.forEach( function ( txt, ci ) {
					var c = cols[ ci ];
					html += "<td" + ( c.type === "number" ? ' class="is-num"' : "" ) + ">" + ( txt ? escapeHtml( txt ) : '<span class="resp-blank">–</span>' ) + "</td>";
				} );
				html += '<td class="resp-src">' + escapeHtml( row.source ) + ( row.file ? '<br><span class="resp-file">' + escapeHtml( row.file ) + "</span>" : "" ) + "</td>" +
					'<td><button type="button" class="dfb-btn dfb-btn-small dfb-btn-icon dfb-btn-danger" data-del="' + escapeHtml( row.id ) + '" aria-label="Delete this response">' + ICONS.trash + "</button></td></tr>";
			} );
			html += "</tbody></table></div>";
			if ( words.length ) {
				html = '<p class="resp-filtered">' + shown + " of " + rows.length + " responses match</p>" + html;
			}
			body.innerHTML = html;
			body.querySelectorAll( "[data-del]" ).forEach( function ( b ) {
				b.addEventListener( "click", function () {
					if ( window.confirm( "Delete this response from this device? Its PDF, wherever it was saved, is not affected." ) ) {
						Responses.remove( b.getAttribute( "data-del" ) ).then( load );
					}
				} );
			} );
		}

		function drawSummary() {
			var html = '<div class="resp-summary">';
			cols.forEach( function ( c ) {
				var vals = rows.map( function ( r ) {
					return answerMap( r.rec )[ c.key ];
				} );
				var answered = vals.filter( function ( v ) {
					return ! isBlank( v );
				} );
				html += '<section class="resp-card"><h3>' + escapeHtml( c.text ) + ( c.old ? ' <span class="resp-old">earlier version</span>' : "" ) + "</h3>" +
					'<p class="resp-meta">' + escapeHtml( TYPE_LABELS[ c.type ] || c.type ) + " · " + answered.length + " of " + rows.length + " answered</p>";
				if ( c.type === "radio" || c.type === "dropdown" || c.type === "checkbox" ) {
					var counts = {};
					( c.options || [] ).forEach( function ( o ) {
						counts[ o ] = 0;
					} );
					answered.forEach( function ( v ) {
						( Array.isArray( v ) ? v : [ v ] ).forEach( function ( o ) {
							counts[ o ] = ( counts[ o ] || 0 ) + 1;
						} );
					} );
					var keys = Object.keys( counts ).sort( function ( a, b ) {
						return counts[ b ] - counts[ a ];
					} );
					var max = Math.max.apply( null, keys.map( function ( k ) {
						return counts[ k ];
					} ).concat( [ 1 ] ) );
					html += '<div class="resp-bars">' + keys.map( function ( k ) {
						var pct = answered.length ? Math.round( 100 * counts[ k ] / answered.length ) : 0;
						return '<div class="resp-bar-row"><span class="resp-bar-label">' + escapeHtml( k ) + '</span><span class="resp-bar-track"><span class="resp-bar-fill" style="width:' + ( 100 * counts[ k ] / max ).toFixed( 1 ) + '%"></span></span><span class="resp-bar-n">' + counts[ k ] + " (" + pct + "%)</span></div>";
					} ).join( "" ) + "</div>";
					if ( c.type === "checkbox" ) {
						html += '<p class="resp-meta">Several answers can be ticked, so percentages add up to more than 100.</p>';
					}
				} else if ( c.type === "number" ) {
					var nums = answered.map( Number ).filter( isFinite );
					if ( nums.length ) {
						var sum = nums.reduce( function ( a, b ) {
							return a + b;
						}, 0 );
						var f = function ( n ) {
							return Number( n.toFixed( 4 ) ).toLocaleString();
						};
						html += '<dl class="resp-stats"><div><dt>Lowest</dt><dd>' + f( Math.min.apply( null, nums ) ) + "</dd></div><div><dt>Highest</dt><dd>" + f( Math.max.apply( null, nums ) ) + "</dd></div><div><dt>Average</dt><dd>" + f( sum / nums.length ) + "</dd></div><div><dt>Total</dt><dd>" + f( sum ) + "</dd></div></dl>";
					}
				} else if ( c.type === "date" ) {
					var ds = answered.map( String ).sort();
					if ( ds.length ) {
						html += '<dl class="resp-stats"><div><dt>Earliest</dt><dd>' + escapeHtml( ds[ 0 ] ) + "</dd></div><div><dt>Latest</dt><dd>" + escapeHtml( ds[ ds.length - 1 ] ) + "</dd></div></dl>";
					}
				} else if ( c.type === "gps" ) {
					html += '<p class="resp-meta">' + answered.length + ( answered.length === 1 ? " location" : " locations" ) + ' recorded. Use Export › GPS locations to open them on a map.</p>';
				} else if ( c.type === "image" || c.type === "signature" ) {
					html += '<p class="resp-meta">' + answered.length + ( c.type === "signature" ? " signed" : " with a photo" ) + ". " + ( c.type === "signature" ? "Signatures" : "Photos" ) + " are in each response's PDF.</p>";
				} else {
					var freq = {};
					answered.forEach( function ( v ) {
						var s = String( v ).trim();
						freq[ s ] = ( freq[ s ] || 0 ) + 1;
					} );
					var top = Object.keys( freq ).filter( function ( k ) {
						return freq[ k ] > 1;
					} ).sort( function ( a, b ) {
						return freq[ b ] - freq[ a ];
					} ).slice( 0, 5 );
					if ( top.length ) {
						html += '<p class="resp-meta">Most common answers</p><ul class="resp-top">' + top.map( function ( k ) {
							return "<li>" + escapeHtml( k ) + " <span>" + freq[ k ] + "×</span></li>";
						} ).join( "" ) + "</ul>";
					}
				}
				html += "</section>";
			} );
			body.innerHTML = html + "</div>";
		}

		bindMenu( app.querySelector( ".resp-tools .menu" ), function ( act ) {
			var base = slugify( form.title );
			if ( ! rows.length && act !== "clear" ) {
				toast( "There are no responses to export yet." );
				return;
			}
			if ( act === "csv" ) {
				downloadBlob( new Blob( [ toCsv( form, cols, rows ) ], { type: "text/csv;charset=utf-8" } ), base + "-responses.csv" );
			} else if ( act === "json" ) {
				var data = { format: "dynaform-responses", v: 1, exported: new Date().toISOString(), form: { key: form.key, title: form.title, questions: form.schema.questions }, responses: rows.map( function ( r ) {
					return r.rec;
				} ) };
				downloadBlob( new Blob( [ JSON.stringify( data, null, 1 ) ], { type: "application/json" } ), base + "-responses.json" );
			} else if ( act === "geojson" ) {
				var gj = toGeoJson( form, cols, rows );
				if ( ! gj.features.length ) {
					toast( "No response has a GPS location yet." );
					return;
				}
				downloadBlob( new Blob( [ JSON.stringify( gj ) ], { type: "application/geo+json" } ), base + "-locations.geojson" );
			} else if ( act === "clear" ) {
				if ( rows.length && window.confirm( "Delete all " + rows.length + " responses to this form from this device? The PDFs, wherever they were saved, are not affected. Export first if you may need them." ) ) {
					Responses.removeAll( form.key ).then( function () {
						toast( "Responses deleted" );
						load();
					} );
				}
			}
		} );

		document.getElementById( "resp-import" ).addEventListener( "click", function () {
			fileIn.click();
		} );
		fileIn.addEventListener( "change", function () {
			var files = Array.prototype.slice.call( fileIn.files || [] );
			fileIn.value = "";
			if ( files.length ) {
				importResponses( files );
			}
		} );

		function importResponses( files ) {
			toast( "Reading " + files.length + ( files.length === 1 ? " file…" : " files…" ) );
			var found = [];
			var noData = [];
			Promise.all( files.map( function ( file ) {
				var isPdf = /\.pdf$/i.test( file.name ) || file.type === "application/pdf";
				return ( isPdf ? file.arrayBuffer().then( function ( buf ) {
					var rec = window.Dynaform && window.Dynaform.readResponseFromPdf( buf );
					if ( rec ) {
						found.push( { rec: rec, source: "PDF", file: file.name } );
					} else {
						noData.push( file.name );
					}
				} ) : file.text().then( function ( text ) {
					var data = JSON.parse( text );
					var list = data && data.format === "dynaform-responses" && Array.isArray( data.responses ) ? data.responses : data && data.format === "dynaform-response" ? [ data ] : [];
					if ( ! list.length ) {
						noData.push( file.name );
					}
					list.forEach( function ( rec ) {
						if ( rec && rec.id && Array.isArray( rec.answers ) ) {
							found.push( { rec: rec, source: "Response file", file: file.name } );
						}
					} );
				} ) ).catch( function () {
					noData.push( file.name );
				} );
			} ) ).then( function () {
				var mine = found.filter( function ( f ) {
					return f.rec.form && f.rec.form.key === form.key;
				} );
				var other = found.filter( function ( f ) {
					return ! ( f.rec.form && f.rec.form.key === form.key );
				} );
				var titles = other.map( function ( f ) {
					return f.rec.form && f.rec.form.title || "an unknown form";
				} ).filter( function ( v, i, a ) {
					return a.indexOf( v ) === i;
				} );
				if ( other.length && window.confirm( other.length + ( other.length === 1 ? " response comes" : " responses come" ) + " from a different form (" + titles.slice( 0, 3 ).join( ", " ) + "). This can happen with a copy of the form made before version 1.4, or after it was duplicated. Add " + ( other.length === 1 ? "it" : "them" ) + " to this form's table anyway?" ) ) {
					mine = mine.concat( other.map( function ( f ) {
						f.override = true;
						return f;
					} ) );
				}
				var added = 0;
				var dup = 0;
				return mine.reduce( function ( p, f ) {
					return p.then( function () {
						return Responses.has( f.override ? f.rec.id + "@" + form.key : f.rec.id ).then( function ( yes ) {
							if ( yes ) {
								dup++;
								return null;
							}
							added++;
							return Responses.add( f.rec, f.source, f.file, f.override ? form.key : null );
						} );
					} );
				}, Promise.resolve() ).then( function () {
					var msg = [];
					msg.push( added + ( added === 1 ? " response added" : " responses added" ) );
					if ( dup ) {
						msg.push( dup + " already in the table" );
					}
					if ( noData.length ) {
						msg.push( noData.length + ( noData.length === 1 ? " file had" : " files had" ) + " no DynaForm response data" );
					}
					toast( msg.join( "; " ) + ".", added ? "ok" : "" );
					load();
				} );
			} ).catch( function ( err ) {
				toast( "Could not read the files (" + err.message + ").", "bad" );
			} );
		}

		setView( view );
		load();
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
