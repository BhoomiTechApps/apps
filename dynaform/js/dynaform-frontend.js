(function () {
	"use strict";

	var MAX_IMAGE_PX = 1600;
	var i18n = ( window.DynaformFrontendData && window.DynaformFrontendData.i18n ) || {};
	function t( key, fallback ) {
		return i18n[ key ] || fallback || key;
	}

	function autoInit() {
		var containers = document.querySelectorAll( ".dynaform-embed[data-dynaform]" );
		containers.forEach( initForm );
	}
	if ( document.readyState === "loading" ) {
		document.addEventListener( "DOMContentLoaded", autoInit );
	} else {
		autoInit();
	}

	/**
	 * Public API used by the PWA shell: mount a form into any element.
	 * opts.onSubmitted( { blob, filename } ) is called after each PDF.
	 */
	window.Dynaform = {
		mount: function ( container, schema, opts ) {
			return new DynaformInstance( container, schema, opts || {} );
		},
		/* Reads the response data embedded in a DynaForm PDF (or null). */
		readResponseFromPdf: readResponseFromPdf,
		RESPONSE_FORMAT: "dynaform-response",
	};

	function initForm( container ) {
		var schema;
		try {
			schema = JSON.parse( container.getAttribute( "data-dynaform" ) );
		} catch ( e ) {
			container.innerHTML = "<p>Unable to load this form.</p>";
			return;
		}
		container.removeAttribute( "data-dynaform" );
		new DynaformInstance( container, schema );
	}

	/**
	 * One instance = one rendered form + its own PDF generation.
	 */
	function DynaformInstance( container, schema, opts ) {
		this.container = container;
		this.schema = schema;
		this.opts = opts || {};
		this.uid = container.id || ( "df" + Math.random().toString( 36 ).slice( 2 ) );
		this.render();
	}

	DynaformInstance.prototype.fieldId = function ( index ) {
		return this.uid + "-f" + index;
	};

	DynaformInstance.prototype.render = function () {
		var self = this;
		var schema = this.schema;
		var html = "";

		html += '<h2 class="dynaform-title">' + escapeHtml( schema.title || "" ) + "</h2>";
		html += '<form class="dynaform-form ' + ( schema.twoColumn ? "dynaform-two-column" : "" ) + '">';

		schema.questions.forEach( function ( q, index ) {
			html += self.renderQuestion( q, index );
		} );

		html += '<div class="dynaform-actions">';
		html += '<button type="submit" class="dynaform-btn dynaform-submit-btn">' + escapeHtml( t( "submit", "Submit" ) ) + "</button>";
		html += "</div>";
		if ( this.opts.notice ) {
			html += '<p class="dynaform-store-notice">' + escapeHtml( this.opts.notice ) + "</p>";
		}
		html += '<div class="dynaform-notice dynaform-notice-success" data-role="success"><span data-role="success-text"></span>' +
			'<span class="dynaform-pdf-actions">' +
			'<button type="button" class="dynaform-btn dynaform-btn-secondary" data-role="save-again">' + escapeHtml( t( "saveAgain", "Save PDF again" ) ) + '</button>' +
			'<button type="button" class="dynaform-btn dynaform-btn-secondary" data-role="share-pdf" hidden>' + escapeHtml( t( "sharePdf", "Share PDF" ) ) + '</button>' +
			'</span></div>';
		html += '<div class="dynaform-notice dynaform-notice-error" data-role="error"></div>';
		html += "</form>";

		this.container.innerHTML = html;
		this.formEl = this.container.querySelector( "form" );
		this.bindEvents();
	};

	DynaformInstance.prototype.renderQuestion = function ( q, index ) {
		var fid = this.fieldId( index );
		if ( q.type === "pagebreak" ) {
			return '<div class="dynaform-question dynaform-pagebreak" data-index="' + index + '" data-type="pagebreak"></div>';
		}

		var req = q.required ? " *" : "";
		var reqAttr = q.required ? "required" : "";
		var html = '<div class="dynaform-question" data-index="' + index + '" data-type="' + q.type + '" data-required="' + ( q.required ? "1" : "0" ) + '">';
		html += '<label class="dynaform-q-label" for="' + fid + '">' + escapeHtml( q.text ) +
			( req ? '<span class="dynaform-required">' + req + "</span>" : "" ) + "</label>";

		switch ( q.type ) {
			case "text":
				html += '<input type="text" id="' + fid + '" ' + reqAttr + ">";
				break;
			case "textarea":
				html += '<textarea id="' + fid + '" ' + reqAttr + "></textarea>";
				break;
			case "email":
				html += '<input type="email" id="' + fid + '" ' + reqAttr + ">";
				break;
			case "number":
				var minAttr = ( q.min !== null && q.min !== undefined && q.min !== "" ) ? 'min="' + q.min + '"' : "";
				var maxAttr = ( q.max !== null && q.max !== undefined && q.max !== "" ) ? 'max="' + q.max + '"' : "";
				html += '<input type="number" id="' + fid + '" ' + minAttr + " " + maxAttr + " " + reqAttr + ">";
				if ( q.min !== null && q.min !== undefined && q.min !== "" || q.max !== null && q.max !== undefined && q.max !== "" ) {
					html += '<small class="dynaform-hint">' + escapeHtml( t( "range", "Range" ) ) + ": " +
						( q.min !== null && q.min !== undefined && q.min !== "" ? q.min : "-∞" ) + " to " +
						( q.max !== null && q.max !== undefined && q.max !== "" ? q.max : "∞" ) + "</small>";
				}
				break;
			case "date":
				var minD = q.minDate ? 'min="' + q.minDate + '"' : "";
				var maxD = q.maxDate ? 'max="' + q.maxDate + '"' : "";
				html += '<input type="date" id="' + fid + '" ' + minD + " " + maxD + " " + reqAttr + ">";
				if ( q.minDate || q.maxDate ) {
					html += '<small class="dynaform-hint">' + escapeHtml( t( "range", "Range" ) ) + ": " +
						( q.minDate || t( "any", "Any" ) ) + " to " + ( q.maxDate || t( "any", "Any" ) ) + "</small>";
				}
				break;
			case "phone":
				html += '<input type="tel" id="' + fid + '" placeholder="+919401065598" ' + reqAttr + ">";
				break;
			case "radio":
				html += '<div class="dynaform-choice-group">';
				( q.options || [] ).forEach( function ( opt, oi ) {
					html += '<label><input type="radio" name="' + fid + '" value="' + escapeAttr( opt ) + '"> ' + escapeHtml( opt ) + "</label>";
				} );
				html += "</div>";
				break;
			case "checkbox":
				html += '<div class="dynaform-choice-group">';
				( q.options || [] ).forEach( function ( opt, oi ) {
					html += '<label><input type="checkbox" name="' + fid + '" value="' + escapeAttr( opt ) + '"> ' + escapeHtml( opt ) + "</label>";
				} );
				html += "</div>";
				break;
			case "dropdown":
				html += '<select id="' + fid + '" ' + reqAttr + ">";
				html += '<option value="">Select…</option>';
				( q.options || [] ).forEach( function ( opt ) {
					html += '<option value="' + escapeAttr( opt ) + '">' + escapeHtml( opt ) + "</option>";
				} );
				html += "</select>";
				break;
			case "gps":
				html += '<div class="dynaform-gps-row">';
				html += '<button type="button" class="dynaform-btn dynaform-btn-secondary dynaform-gps-btn">' + escapeHtml( t( "getLocation", "Get current location" ) ) + "</button>";
				html += '<input type="text" id="' + fid + '-lat" placeholder="Latitude" readonly>';
				html += '<input type="text" id="' + fid + '-lng" placeholder="Longitude" readonly>';
				html += '<input type="text" id="' + fid + '-acc" placeholder="Accuracy (m)" readonly>';
				html += "</div>";
				break;
			case "image":
				html += '<input type="file" id="' + fid + '" accept="image/*" ' + reqAttr + ">";
				html += '<img class="dynaform-image-preview" alt="">';
				break;
			case "signature":
				html += '<div class="dynaform-sig" data-signed="0">' +
					'<canvas class="dynaform-sig-pad" id="' + fid + '" width="600" height="200" role="img" aria-label="' + escapeAttr( t( "signHere", "Signature pad: sign with your finger, a stylus or the mouse" ) ) + '"></canvas>' +
					'<span class="dynaform-sig-hint">' + escapeHtml( t( "signHint", "Sign above with your finger, a stylus or the mouse" ) ) + "</span>" +
					'<button type="button" class="dynaform-btn dynaform-btn-secondary dynaform-sig-clear">' + escapeHtml( t( "clearSignature", "Clear" ) ) + "</button>" +
					"</div>";
				break;
		}

		html += '<span class="dynaform-error"></span>';
		html += "</div>";
		return html;
	};

	DynaformInstance.prototype.bindEvents = function () {
		var self = this;

		this.formEl.querySelectorAll( ".dynaform-sig" ).forEach( function ( wrap ) {
			initSignaturePad( wrap );
		} );

		this.formEl.querySelectorAll( ".dynaform-gps-btn" ).forEach( function ( btn ) {
			btn.addEventListener( "click", function () {
				self.captureGPS( btn );
			} );
		} );

		this.formEl.querySelectorAll( 'input[type="file"]' ).forEach( function ( input ) {
			input.addEventListener( "change", function () {
				var preview = input.parentElement.querySelector( ".dynaform-image-preview" );
				if ( input.files && input.files[ 0 ] && preview ) {
					var reader = new FileReader();
					reader.onload = function ( e ) {
						preview.src = e.target.result;
						preview.style.display = "block";
					};
					reader.readAsDataURL( input.files[ 0 ] );
				}
			} );
		} );

		this.formEl.querySelector( '[data-role="save-again"]' ).addEventListener( "click", function () {
			if ( self.lastPdf ) {
				downloadBlob( self.lastPdf.blob, self.lastPdf.filename );
			}
		} );
		this.formEl.querySelector( '[data-role="share-pdf"]' ).addEventListener( "click", function () {
			if ( ! self.lastPdf ) {
				return;
			}
			var file = new File( [ self.lastPdf.blob ], self.lastPdf.filename, { type: "application/pdf" } );
			navigator.share( { files: [ file ], title: self.lastPdf.filename } ).catch( function () {} );
		} );

		this.formEl.addEventListener( "submit", function ( e ) {
			e.preventDefault();
			self.handleSubmit();
		} );
	};

	DynaformInstance.prototype.captureGPS = function ( btn ) {
		var block = btn.closest( ".dynaform-question" );
		var index = block.getAttribute( "data-index" );
		var fid = this.fieldId( index );
		if ( ! navigator.geolocation ) {
			alert( t( "geoUnsupported", "Geolocation is not supported by this browser." ) );
			return;
		}
		btn.disabled = true;
		navigator.geolocation.getCurrentPosition(
			function ( pos ) {
				document.getElementById( fid + "-lat" ).value = pos.coords.latitude;
				document.getElementById( fid + "-lng" ).value = pos.coords.longitude;
				document.getElementById( fid + "-acc" ).value = Math.round( pos.coords.accuracy );
				btn.disabled = false;
			},
			function ( err ) {
				alert( t( "geoFailed", "Unable to get location" ) + ": " + err.message );
				btn.disabled = false;
			}
		);
	};

	/**
	 * Validate all fields, matching the semantics of the original PWA.
	 * Returns true if valid, and paints inline errors otherwise.
	 */
	DynaformInstance.prototype.validate = function () {
		var self = this;
		var isValid = true;
		var emailPattern = /^[^ ]+@[^ ]+\.[a-z]{2,3}$/i;
		var phonePattern = /^\+\d{10,15}$/;

		this.formEl.querySelectorAll( ".dynaform-question" ).forEach( function ( block ) {
			var type = block.getAttribute( "data-type" );
			var index = block.getAttribute( "data-index" );
			var required = block.getAttribute( "data-required" ) === "1";
			var errorSpan = block.querySelector( ".dynaform-error" );
			var fid = self.fieldId( index );
			block.classList.remove( "dynaform-invalid" );
			if ( errorSpan ) {
				errorSpan.textContent = "";
			}
			if ( type === "pagebreak" ) {
				return;
			}

			function fail( msg ) {
				isValid = false;
				block.classList.add( "dynaform-invalid" );
				if ( errorSpan ) {
					errorSpan.textContent = msg;
				}
			}

			switch ( type ) {
				case "text":
				case "textarea":
				case "date": {
					var el = document.getElementById( fid );
					if ( required && el && ! el.value.trim() ) {
						fail( t( "required", "This field is required." ) );
					}
					break;
				}
				case "email": {
					var elE = document.getElementById( fid );
					var val = elE ? elE.value.trim() : "";
					if ( required && ! val ) {
						fail( t( "required", "This field is required." ) );
					} else if ( val && ! emailPattern.test( val ) ) {
						fail( t( "invalidEmail", "Please enter a valid email address." ) );
					}
					break;
				}
				case "phone": {
					var elP = document.getElementById( fid );
					var valP = elP ? elP.value.trim() : "";
					if ( required && ! valP ) {
						fail( t( "required", "This field is required." ) );
					} else if ( valP && ! phonePattern.test( valP ) ) {
						fail( t( "invalidPhone", "Please enter a valid phone number, e.g. +919401065598" ) );
					}
					break;
				}
				case "number": {
					var elN = document.getElementById( fid );
					var valN = elN ? elN.value : "";
					if ( required && valN === "" ) {
						fail( t( "required", "This field is required." ) );
						break;
					}
					if ( valN !== "" ) {
						var q = self.schema.questions[ index ];
						var num = parseFloat( valN );
						if ( q.min !== null && q.min !== undefined && q.min !== "" && num < parseFloat( q.min ) ) {
							fail( t( "minValue", "Minimum allowed is" ) + " " + q.min );
						} else if ( q.max !== null && q.max !== undefined && q.max !== "" && num > parseFloat( q.max ) ) {
							fail( t( "maxValue", "Maximum allowed is" ) + " " + q.max );
						}
					}
					break;
				}
				case "dropdown": {
					var elD = document.getElementById( fid );
					if ( required && elD && ! elD.value ) {
						fail( t( "required", "This field is required." ) );
					}
					break;
				}
				case "radio": {
					if ( required ) {
						var checked = block.querySelector( 'input[type="radio"]:checked' );
						if ( ! checked ) {
							fail( t( "required", "This field is required." ) );
						}
					}
					break;
				}
				case "checkbox": {
					if ( required ) {
						var anyChecked = block.querySelector( 'input[type="checkbox"]:checked' );
						if ( ! anyChecked ) {
							fail( t( "required", "This field is required." ) );
						}
					}
					break;
				}
				case "gps": {
					if ( required ) {
						var lat = document.getElementById( fid + "-lat" );
						if ( ! lat || ! lat.value ) {
							fail( t( "required", "This field is required." ) );
						}
					}
					break;
				}
				case "image": {
					if ( required ) {
						var fileEl = document.getElementById( fid );
						if ( ! fileEl || ! fileEl.files || ! fileEl.files.length ) {
							fail( t( "required", "This field is required." ) );
						}
					}
					break;
				}
				case "signature": {
					var sig = block.querySelector( ".dynaform-sig" );
					if ( required && ( ! sig || sig.getAttribute( "data-signed" ) !== "1" ) ) {
						fail( t( "signRequired", "Please sign here." ) );
					}
					break;
				}
			}
		} );

		return isValid;
	};

	/**
	 * Collect answers from the DOM into a flat list of
	 * { question, type, text, imageFile } entries, in question order.
	 */
	DynaformInstance.prototype.collectAnswers = function () {
		var self = this;
		var answers = [];

		this.schema.questions.forEach( function ( q, index ) {
			if ( q.type === "pagebreak" ) {
				answers.push( { type: "pagebreak" } );
				return;
			}
			var fid = self.fieldId( index );
			var entry = { type: q.type, question: q.text, text: "", imageFile: null, value: "" };

			switch ( q.type ) {
				case "text":
				case "textarea":
				case "date":
				case "email":
				case "phone": {
					var el = document.getElementById( fid );
					entry.value = el ? el.value.trim() : "";
					entry.text = entry.value ? entry.value : t( "notAnswered", "Not answered" );
					break;
				}
				case "number": {
					var elN = document.getElementById( fid );
					entry.value = elN && elN.value !== "" && isFinite( elN.value ) ? Number( elN.value ) : "";
					entry.text = elN && elN.value !== "" ? elN.value : t( "notAnswered", "Not answered" );
					break;
				}
				case "dropdown": {
					var elD = document.getElementById( fid );
					entry.value = elD && elD.value ? elD.value : "";
					entry.text = elD && elD.value ? elD.value : t( "notAnswered", "Not answered" );
					break;
				}
				case "radio": {
					var block = self.formEl.querySelector( '.dynaform-question[data-index="' + index + '"]' );
					var checked = block.querySelector( 'input[type="radio"]:checked' );
					entry.value = checked ? checked.value : "";
					entry.text = checked ? checked.value : t( "notAnswered", "Not answered" );
					break;
				}
				case "checkbox": {
					var blockC = self.formEl.querySelector( '.dynaform-question[data-index="' + index + '"]' );
					var vals = [];
					blockC.querySelectorAll( 'input[type="checkbox"]:checked' ).forEach( function ( c ) {
						vals.push( c.value );
					} );
					entry.value = vals;
					entry.text = vals.length ? vals.join( ", " ) : t( "notAnswered", "Not answered" );
					break;
				}
				case "gps": {
					var lat = document.getElementById( fid + "-lat" );
					var lng = document.getElementById( fid + "-lng" );
					var acc = document.getElementById( fid + "-acc" );
					entry.value = ( lat && lat.value && lng && lng.value ) ? { lat: Number( lat.value ), lng: Number( lng.value ), acc: acc && acc.value !== "" ? Number( acc.value ) : null } : "";
					entry.text = ( lat && lat.value && lng && lng.value ) ?
						lat.value + ", " + lng.value + " (" + t( "accuracy", "Accuracy" ) + ": " + ( acc ? acc.value : "?" ) + "m)" :
						t( "notAnswered", "Not answered" );
					break;
				}
				case "image": {
					var fileEl = document.getElementById( fid );
					if ( fileEl && fileEl.files && fileEl.files.length ) {
						entry.imageFile = fileEl.files[ 0 ];
						entry.text = fileEl.files[ 0 ].name;
						entry.value = fileEl.files[ 0 ].name;
					} else {
						entry.text = t( "noImage", "No image uploaded" );
					}
					break;
				}
				case "signature": {
					var pad = document.getElementById( fid );
					var signed = !! ( pad && pad.parentNode.getAttribute( "data-signed" ) === "1" );
					entry.value = signed;
					entry.text = signed ? t( "signed", "Signed" ) : t( "notSigned", "Not signed" );
					if ( signed ) {
						entry.dataUrl = signatureDataUrl( pad );
						entry.imgWidth = pad._dfCrop ? pad._dfCrop.w : pad.width;
						entry.imgHeight = pad._dfCrop ? pad._dfCrop.h : pad.height;
					}
					break;
				}
			}
			answers.push( entry );
		} );

		return answers;
	};

	DynaformInstance.prototype.handleSubmit = function () {
		var self = this;
		var successEl = this.formEl.querySelector( '[data-role="success"]' );
		var errorEl = this.formEl.querySelector( '[data-role="error"]' );
		successEl.style.display = "none";
		errorEl.style.display = "none";

		if ( ! this.validate() ) {
			errorEl.textContent = t( "fixErrors", "Please correct the highlighted fields before submitting." );
			errorEl.style.display = "block";
			var firstInvalid = this.formEl.querySelector( ".dynaform-invalid" );
			if ( firstInvalid ) {
				firstInvalid.scrollIntoView( { behavior: "smooth", block: "center" } );
			}
			return;
		}

		var submitBtn = this.formEl.querySelector( ".dynaform-submit-btn" );
		submitBtn.disabled = true;
		submitBtn.textContent = t( "preparingPdf", "Preparing your PDF…" );

		var answers = this.collectAnswers();
		var record = this.buildRecord( answers );

		ensureShapingFont().then( function () {
			return self.loadImages( answers );
		} ).then( function ( answersWithImages ) {
			var result = self.buildPdf( answersWithImages, record );
			result.record = record;
			self.lastPdf = result;
			downloadBlob( result.blob, result.filename );
			successEl.querySelector( '[data-role="success-text"]' ).textContent = t( "thankYou", "Thank you! Your response has been saved as a PDF and downloaded to your device." );
			var shareBtn = successEl.querySelector( '[data-role="share-pdf"]' );
			try {
				shareBtn.hidden = ! ( navigator.canShare && navigator.canShare( { files: [ new File( [ result.blob ], result.filename, { type: "application/pdf" } ) ] } ) );
			} catch ( e ) {
				shareBtn.hidden = true;
			}
			successEl.style.display = "block";
			if ( typeof self.opts.onSubmitted === "function" ) {
				self.opts.onSubmitted( result );
			}
			submitBtn.disabled = false;
			submitBtn.textContent = t( "submit", "Submit" );
			self.formEl.reset();
			self.formEl.querySelectorAll( ".dynaform-image-preview" ).forEach( function ( img ) {
				img.style.display = "none";
				img.removeAttribute( "src" );
			} );
			self.formEl.querySelectorAll( '[id$="-lat"], [id$="-lng"], [id$="-acc"]' ).forEach( function ( el ) {
				el.value = "";
			} );
			self.formEl.querySelectorAll( ".dynaform-sig" ).forEach( function ( w ) {
				if ( w._dfClear ) {
					w._dfClear();
				}
			} );
		} ).catch( function ( err ) {
			errorEl.textContent = "PDF generation failed: " + err.message;
			errorEl.style.display = "block";
			submitBtn.disabled = false;
			submitBtn.textContent = t( "submit", "Submit" );
		} );
	};

	/**
	 * Read every image answer into a data URL + natural dimensions so
	 * the PDF builder can embed it at the correct aspect ratio.
	 */
	DynaformInstance.prototype.loadImages = function ( answers ) {
		var promises = answers.map( function ( entry ) {
			if ( entry.type !== "image" || ! entry.imageFile ) {
				return Promise.resolve( entry );
			}
			return new Promise( function ( resolve, reject ) {
				var reader = new FileReader();
				reader.onload = function ( e ) {
					var img = new Image();
					img.onload = function () {
						var w = img.naturalWidth;
						var h = img.naturalHeight;
						var scale = Math.min( 1, MAX_IMAGE_PX / Math.max( w, h ) );
						try {
							var canvas = document.createElement( "canvas" );
							canvas.width = Math.max( 1, Math.round( w * scale ) );
							canvas.height = Math.max( 1, Math.round( h * scale ) );
							var ctx = canvas.getContext( "2d" );
							ctx.fillStyle = "#ffffff"; // flatten transparency for JPEG
							ctx.fillRect( 0, 0, canvas.width, canvas.height );
							ctx.drawImage( img, 0, 0, canvas.width, canvas.height );
							entry.dataUrl = canvas.toDataURL( "image/jpeg", 0.85 );
							entry.imgWidth = canvas.width;
							entry.imgHeight = canvas.height;
						} catch ( err ) {
							entry.dataUrl = e.target.result;
							entry.imgWidth = w;
							entry.imgHeight = h;
						}
						resolve( entry );
					};
					img.onerror = function () {
						resolve( entry );
					};
					img.src = e.target.result;
				};
				reader.onerror = function () {
					reject( new Error( "Could not read image file" ) );
				};
				reader.readAsDataURL( entry.imageFile );
			} );
		} );
		return Promise.all( promises );
	};

	/**
	 * The response as data: embedded in the PDF and handed to the app, so
	 * responses can be gathered into a table. Photos are named, not copied;
	 * a signature is recorded as signed / not signed.
	 */
	DynaformInstance.prototype.buildRecord = function ( answers ) {
		var schema = this.schema;
		var n = 0;
		return {
			format: "dynaform-response",
			v: 1,
			id: newId(),
			submittedAt: new Date().toISOString(),
			form: {
				key: schema.key || null,
				title: schema.title || "",
				questions: ( schema.questions || [] ).map( function ( q ) {
					var o = { type: q.type, text: q.text || "" };
					if ( q.options && q.options.length ) {
						o.options = q.options.slice();
					}
					return o;
				} ),
			},
			answers: answers.filter( function ( e ) {
				return e.type !== "pagebreak";
			} ).map( function ( e ) {
				n++;
				return { n: n, type: e.type, q: e.question, value: e.value === undefined ? "" : e.value };
			} ),
		};
	};

	/**
	 * Build a clean, readable, single-file PDF: title, timestamp, then
	 * each question with its answer, wrapping text and embedding photos
	 * and signatures inline. Entirely local: jsPDF runs in the browser.
	 *
	 * Bengali (and other Indic) text is drawn by the browser, which shapes
	 * it correctly, and placed in the PDF as a picture of the line, with
	 * the same text invisibly underneath so it can still be searched and
	 * copied. Other text is ordinary PDF text.
	 */
	DynaformInstance.prototype.buildPdf = function ( answers, record ) {
		var jsPDFCtor = window.jspdf.jsPDF;
		var pdf = new jsPDFCtor( "p", "mm", "a4" );
		var pageWidth = 210;
		var pageHeight = 297;
		var marginLeft = 15;
		var marginRight = 15;
		var marginTop = 20;
		var marginBottom = 20;
		var usableWidth = pageWidth - marginLeft - marginRight;
		var y = marginTop;
		var shaper = makeShaper( pdf );

		function ensureSpace( needed ) {
			if ( y + needed > pageHeight - marginBottom ) {
				pdf.addPage();
				y = marginTop;
			}
		}

		pdf.setFont( "NotoSansBengali", "normal" );
		pdf.setFontSize( 16 );
		var titleLines = shaper.wrap( this.schema.title || "", usableWidth, 16 );
		titleLines.forEach( function ( line, i ) {
			shaper.line( line, pageWidth / 2, y + i * 7, 16, "center", 0 );
		} );
		y += titleLines.length * 7 + 3;

		pdf.setFontSize( 10 );
		pdf.setTextColor( 110 );
		pdf.text( new Date( record ? record.submittedAt : Date.now() ).toLocaleString(), pageWidth / 2, y, { align: "center" } );
		pdf.setTextColor( 0 );
		y += 10;

		var qNo = 1;
		answers.forEach( function ( entry ) {
			if ( entry.type === "pagebreak" ) {
				pdf.addPage();
				y = marginTop;
				return;
			}

			pdf.setFontSize( 11 );
			var qLines = shaper.wrap( qNo + ". " + entry.question, usableWidth, 11 );
			ensureSpace( qLines.length * 6 + 8 );
			pdf.setFont( "NotoSansBengali", "normal" );
			qLines.forEach( function ( line, i ) {
				shaper.line( line, marginLeft, y + i * 6, 11, "left", 0 );
			} );
			y += qLines.length * 6 + 3;

			if ( ( entry.type === "image" || entry.type === "signature" ) && entry.dataUrl ) {
				var isSig = entry.type === "signature";
				var maxImgWidth = isSig ? 70 : usableWidth * 0.6;
				var maxImgHeight = isSig ? 28 : 80;
				var ratio = Math.min( maxImgWidth / entry.imgWidth, maxImgHeight / entry.imgHeight, isSig ? 10 : 1 );
				var w = entry.imgWidth * ratio;
				var h = entry.imgHeight * ratio;
				ensureSpace( h + ( isSig ? 12 : 6 ) );
				var format = /png/i.test( entry.dataUrl.substring( 0, 30 ) ) ? "PNG" : "JPEG";
				try {
					pdf.addImage( entry.dataUrl, format, marginLeft, y - 2, w, h );
				} catch ( e ) {
					pdf.text( entry.text, marginLeft, y + 5 );
				}
				if ( isSig ) {
					pdf.setDrawColor( 150 );
					pdf.setLineWidth( 0.3 );
					pdf.line( marginLeft, y - 2 + h, marginLeft + Math.max( w, 60 ), y - 2 + h );
					pdf.setFontSize( 9 );
					pdf.setTextColor( 110 );
					pdf.text( t( "signedOn", "Signed on" ) + " " + new Date( record ? record.submittedAt : Date.now() ).toLocaleString(), marginLeft, y + h + 3 );
					pdf.setTextColor( 0 );
					y += h + 10;
				} else {
					y += h + 8;
				}
			} else {
				pdf.setFontSize( 11 );
				var ansLines = shaper.wrap( String( entry.text ), usableWidth - 4, 11 );
				ensureSpace( ansLines.length * 6 + 6 );
				pdf.setFillColor( 246, 248, 250 );
				pdf.rect( marginLeft, y - 4.5, usableWidth, ansLines.length * 6 + 4, "F" );
				ansLines.forEach( function ( line, i ) {
					shaper.line( line, marginLeft + 2, y + i * 6, 11, "left", 0 );
				} );
				y += ansLines.length * 6 + 8;
			}
			qNo++;
		} );

		var totalPages = pdf.getNumberOfPages();
		for ( var i = 1; i <= totalPages; i++ ) {
			pdf.setPage( i );
			pdf.setFontSize( 9 );
			pdf.setTextColor( 130 );
			pdf.text( "Page " + i + " of " + totalPages, pageWidth / 2, pageHeight - 10, { align: "center" } );
			pdf.setTextColor( 0 );
		}

		// The answers as data, so DynaForm can read them back from the PDF.
		pdf.setProperties( {
			title: this.schema.title || "DynaForm response",
			subject: "DynaForm response",
			creator: "DynaForm PDF",
			keywords: "dynaform-response",
		} );
		if ( record ) {
			try {
				pdf.addMetadata( "DFRESP1:" + utf8ToB64( JSON.stringify( record ) ) + ":DFEND", "https://bhoomitechfoundation.org/ns/dynaform/1.0/" );
			} catch ( e ) {}
		}

		var safeTitle = ( this.schema.title || "response" ).replace( /[^\p{L}\p{M}\p{N}]+/gu, "_" ).replace( /^_+|_+$/g, "" );
		var filename = ( safeTitle || "response" ) + "-" + Date.now() + ".pdf";
		return { blob: pdf.output( "blob" ), filename: filename };
	};

	/* ---------------------------------------------------------------
	 * Complex-script shaping for the PDF
	 * ------------------------------------------------------------- */

	var SHAPE = { ok: false, promise: null, family: "DFShapeIndic" };
	var INDIC = /[ऀ-෿]/;

	/** Loads the bundled Noto Sans Bengali into the browser for drawing. */
	function ensureShapingFont() {
		if ( SHAPE.promise ) {
			return SHAPE.promise;
		}
		SHAPE.promise = new Promise( function ( resolve ) {
			try {
				if ( ! window.FontFace || ! document.fonts || ! window.jspdf ) {
					return resolve( false );
				}
				var probe = new window.jspdf.jsPDF();
				var b64 = probe.getFileFromVFS && probe.getFileFromVFS( "NotoSansBengali-Regular.ttf" );
				if ( ! b64 ) {
					return resolve( false );
				}
				var bin = atob( b64 );
				var bytes = new Uint8Array( bin.length );
				for ( var i = 0; i < bin.length; i++ ) {
					bytes[ i ] = bin.charCodeAt( i );
				}
				var face = new FontFace( SHAPE.family, bytes.buffer );
				face.load().then( function ( f ) {
					document.fonts.add( f );
					SHAPE.ok = true;
					resolve( true );
				}, function () {
					resolve( false );
				} );
			} catch ( e ) {
				resolve( false );
			}
		} );
		return SHAPE.promise;
	}

	function makeShaper( pdf ) {
		var PX = 12; // pixels per millimetre (about 300 dpi)
		var PT = 0.352778; // millimetres per point
		var canvas = null;
		var ctx = null;
		function needs( s ) {
			return SHAPE.ok && INDIC.test( s );
		}
		function font( sizePt ) {
			return ( sizePt * PT * PX ).toFixed( 2 ) + 'px "' + SHAPE.family + '", "Noto Sans Bengali", "Noto Sans Devanagari", "Noto Sans", system-ui, sans-serif';
		}
		function context() {
			if ( ! ctx ) {
				canvas = document.createElement( "canvas" );
				ctx = canvas.getContext( "2d" );
			}
			return ctx;
		}
		function widthMm( s, sizePt ) {
			var c = context();
			c.font = font( sizePt );
			return c.measureText( s ).width / PX;
		}
		function graphemes( s ) {
			if ( window.Intl && Intl.Segmenter ) {
				return Array.from( new Intl.Segmenter( undefined, { granularity: "grapheme" } ).segment( s ), function ( x ) {
					return x.segment;
				} );
			}
			return Array.from( s );
		}
		function wrap( text, maxMm, sizePt ) {
			text = String( text == null ? "" : text );
			if ( ! needs( text ) ) {
				pdf.setFontSize( sizePt );
				return pdf.splitTextToSize( text, maxMm );
			}
			var out = [];
			text.split( /\r?\n/ ).forEach( function ( para ) {
				var tokens = para.split( /(\s+)/ );
				var line = "";
				tokens.forEach( function ( tok ) {
					if ( tok === "" ) {
						return;
					}
					var cand = line + tok;
					if ( ! line || widthMm( cand.replace( /\s+$/, "" ), sizePt ) <= maxMm ) {
						line = cand;
					} else {
						out.push( line.replace( /\s+$/, "" ) );
						line = tok.replace( /^\s+/, "" );
					}
					// A single word wider than the line: break it between letters.
					while ( widthMm( line, sizePt ) > maxMm && graphemes( line ).length > 1 ) {
						var g = graphemes( line );
						var k = g.length - 1;
						while ( k > 1 && widthMm( g.slice( 0, k ).join( "" ), sizePt ) > maxMm ) {
							k--;
						}
						out.push( g.slice( 0, k ).join( "" ) );
						line = g.slice( k ).join( "" );
					}
				} );
				out.push( line.replace( /\s+$/, "" ) );
			} );
			return out.length ? out : [ "" ];
		}
		function line( s, x, yBase, sizePt, align, grey ) {
			s = String( s == null ? "" : s );
			pdf.setFontSize( sizePt );
			if ( ! needs( s ) ) {
				pdf.text( s, x, yBase, align === "center" ? { align: "center" } : undefined );
				return;
			}
			var c = context();
			c.font = font( sizePt );
			var m = c.measureText( s );
			var fontPx = sizePt * PT * PX;
			var asc = Math.max( m.actualBoundingBoxAscent || 0, fontPx * 0.95 );
			var desc = Math.max( m.actualBoundingBoxDescent || 0, fontPx * 0.4 );
			var pad = Math.ceil( fontPx * 0.2 );
			var left = Math.max( 0, Math.ceil( m.actualBoundingBoxLeft || 0 ) );
			var wPx = Math.ceil( Math.max( m.width, ( m.actualBoundingBoxRight || 0 ) + left ) ) + left + pad * 2;
			var hPx = Math.ceil( asc + desc ) + pad * 2;
			canvas.width = Math.max( 1, wPx );
			canvas.height = Math.max( 1, hPx );
			c.font = font( sizePt );
			c.textBaseline = "alphabetic";
			var v = grey || 0;
			c.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
			c.fillText( s, pad + left, pad + asc );
			var wMm = wPx / PX;
			var hMm = hPx / PX;
			var textW = m.width / PX;
			var x0 = align === "center" ? x - textW / 2 : x;
			var leftMm = x0 - ( pad + left ) / PX;
			var topMm = yBase - ( pad + asc ) / PX;
			try {
				pdf.addImage( canvas.toDataURL( "image/png" ), "PNG", leftMm, topMm, wMm, hMm, undefined, "FAST" );
			} catch ( e ) {
				pdf.text( s, x, yBase, align === "center" ? { align: "center" } : undefined );
				return;
			}
			// Invisible text underneath keeps the line searchable and copyable.
			pdf.text( s, x, yBase, align === "center" ? { align: "center", renderingMode: "invisible" } : { renderingMode: "invisible" } );
		}
		return { wrap: wrap, line: line };
	}

	/* ---------------------------------------------------------------
	 * Signature pad
	 * ------------------------------------------------------------- */

	function initSignaturePad( wrap ) {
		var canvas = wrap.querySelector( "canvas" );
		var ctx = canvas.getContext( "2d" );
		var drawing = false;
		var last = null;
		function clear() {
			ctx.fillStyle = "#ffffff";
			ctx.fillRect( 0, 0, canvas.width, canvas.height );
			wrap.setAttribute( "data-signed", "0" );
		}
		function pos( e ) {
			var r = canvas.getBoundingClientRect();
			return {
				x: ( e.clientX - r.left ) * ( canvas.width / r.width ),
				y: ( e.clientY - r.top ) * ( canvas.height / r.height ),
			};
		}
		clear();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.strokeStyle = "#16213a";
		canvas.addEventListener( "pointerdown", function ( e ) {
			e.preventDefault();
			drawing = true;
			last = pos( e );
			try {
				canvas.setPointerCapture( e.pointerId );
			} catch ( err ) {}
			ctx.beginPath();
			ctx.arc( last.x, last.y, 1.4, 0, Math.PI * 2 );
			ctx.fillStyle = "#16213a";
			ctx.fill();
		} );
		canvas.addEventListener( "pointermove", function ( e ) {
			if ( ! drawing ) {
				return;
			}
			e.preventDefault();
			var p = pos( e );
			var pressure = e.pressure && e.pointerType === "pen" ? e.pressure : 0.5;
			ctx.lineWidth = 2 + pressure * 2.5;
			ctx.beginPath();
			ctx.moveTo( last.x, last.y );
			ctx.lineTo( p.x, p.y );
			ctx.stroke();
			last = p;
			wrap.setAttribute( "data-signed", "1" );
			var block = wrap.closest( ".dynaform-question" );
			if ( block ) {
				block.classList.remove( "dynaform-invalid" );
			}
		} );
		[ "pointerup", "pointercancel", "pointerleave" ].forEach( function ( ev ) {
			canvas.addEventListener( ev, function () {
				drawing = false;
			} );
		} );
		wrap.querySelector( ".dynaform-sig-clear" ).addEventListener( "click", clear );
		wrap._dfClear = clear;
	}

	/** The signature cropped to the ink, on white, as PNG. */
	function signatureDataUrl( canvas ) {
		try {
			var ctx = canvas.getContext( "2d" );
			var d = ctx.getImageData( 0, 0, canvas.width, canvas.height ).data;
			var minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
			for ( var yy = 0; yy < canvas.height; yy++ ) {
				for ( var xx = 0; xx < canvas.width; xx++ ) {
					var i = ( yy * canvas.width + xx ) * 4;
					if ( d[ i ] < 200 || d[ i + 1 ] < 200 || d[ i + 2 ] < 200 ) {
						if ( xx < minX ) { minX = xx; }
						if ( xx > maxX ) { maxX = xx; }
						if ( yy < minY ) { minY = yy; }
						if ( yy > maxY ) { maxY = yy; }
					}
				}
			}
			if ( maxX < 0 ) {
				return canvas.toDataURL( "image/png" );
			}
			var pad = 12;
			minX = Math.max( 0, minX - pad );
			minY = Math.max( 0, minY - pad );
			maxX = Math.min( canvas.width - 1, maxX + pad );
			maxY = Math.min( canvas.height - 1, maxY + pad );
			var out = document.createElement( "canvas" );
			out.width = maxX - minX + 1;
			out.height = maxY - minY + 1;
			out.getContext( "2d" ).drawImage( canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height );
			canvas._dfCrop = { w: out.width, h: out.height };
			return out.toDataURL( "image/png" );
		} catch ( e ) {
			return canvas.toDataURL( "image/png" );
		}
	}

	/* ---------------------------------------------------------------
	 * Response data inside the PDF
	 * ------------------------------------------------------------- */

	function newId() {
		if ( window.crypto && crypto.randomUUID ) {
			return crypto.randomUUID();
		}
		var a = new Uint32Array( 4 );
		( window.crypto || window.msCrypto ).getRandomValues( a );
		return Array.prototype.map.call( a, function ( n ) {
			return ( "00000000" + n.toString( 16 ) ).slice( -8 );
		} ).join( "-" );
	}

	function utf8ToB64( str ) {
		var bytes = new TextEncoder().encode( str );
		var bin = "";
		for ( var i = 0; i < bytes.length; i += 0x8000 ) {
			bin += String.fromCharCode.apply( null, bytes.subarray( i, i + 0x8000 ) );
		}
		return btoa( bin );
	}

	function b64ToUtf8( b64 ) {
		var bin = atob( b64 );
		var bytes = new Uint8Array( bin.length );
		for ( var i = 0; i < bin.length; i++ ) {
			bytes[ i ] = bin.charCodeAt( i );
		}
		return new TextDecoder().decode( bytes );
	}

	function readResponseFromPdf( buffer ) {
		try {
			var text = new TextDecoder( "latin1" ).decode( buffer );
			var m = /DFRESP1:([A-Za-z0-9+\/=\s]+?):DFEND/.exec( text );
			if ( ! m ) {
				return null;
			}
			var rec = JSON.parse( b64ToUtf8( m[ 1 ].replace( /\s+/g, "" ) ) );
			return rec && rec.format === "dynaform-response" && Array.isArray( rec.answers ) ? rec : null;
		} catch ( e ) {
			return null;
		}
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

	function escapeHtml( str ) {
		return String( str == null ? "" : str )
			.replace( /&/g, "&amp;" )
			.replace( /</g, "&lt;" )
			.replace( />/g, "&gt;" )
			.replace( /"/g, "&quot;" );
	}
	function escapeAttr( str ) {
		return escapeHtml( str ).replace( /'/g, "&#39;" );
	}
})();
