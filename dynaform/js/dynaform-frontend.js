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
				html += '<option value="">-- Select --</option>';
				( q.options || [] ).forEach( function ( opt ) {
					html += '<option value="' + escapeAttr( opt ) + '">' + escapeHtml( opt ) + "</option>";
				} );
				html += "</select>";
				break;
			case "gps":
				html += '<div class="dynaform-gps-row">';
				html += '<button type="button" class="dynaform-btn dynaform-btn-secondary dynaform-gps-btn">' + escapeHtml( t( "getLocation", "Get Current Location" ) ) + "</button>";
				html += '<input type="text" id="' + fid + '-lat" placeholder="Latitude" readonly>';
				html += '<input type="text" id="' + fid + '-lng" placeholder="Longitude" readonly>';
				html += '<input type="text" id="' + fid + '-acc" placeholder="Accuracy (m)" readonly>';
				html += "</div>";
				break;
			case "image":
				html += '<input type="file" id="' + fid + '" accept="image/*" ' + reqAttr + ">";
				html += '<img class="dynaform-image-preview" alt="">';
				break;
		}

		html += '<span class="dynaform-error"></span>';
		html += "</div>";
		return html;
	};

	DynaformInstance.prototype.bindEvents = function () {
		var self = this;

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
			var entry = { type: q.type, question: q.text, text: "", imageFile: null };

			switch ( q.type ) {
				case "text":
				case "textarea":
				case "date":
				case "email":
				case "phone": {
					var el = document.getElementById( fid );
					entry.text = el && el.value.trim() ? el.value.trim() : t( "notAnswered", "Not answered" );
					break;
				}
				case "number": {
					var elN = document.getElementById( fid );
					entry.text = elN && elN.value !== "" ? elN.value : t( "notAnswered", "Not answered" );
					break;
				}
				case "dropdown": {
					var elD = document.getElementById( fid );
					entry.text = elD && elD.value ? elD.value : t( "notAnswered", "Not answered" );
					break;
				}
				case "radio": {
					var block = self.formEl.querySelector( '.dynaform-question[data-index="' + index + '"]' );
					var checked = block.querySelector( 'input[type="radio"]:checked' );
					entry.text = checked ? checked.value : t( "notAnswered", "Not answered" );
					break;
				}
				case "checkbox": {
					var blockC = self.formEl.querySelector( '.dynaform-question[data-index="' + index + '"]' );
					var vals = [];
					blockC.querySelectorAll( 'input[type="checkbox"]:checked' ).forEach( function ( c ) {
						vals.push( c.value );
					} );
					entry.text = vals.length ? vals.join( ", " ) : t( "notAnswered", "Not answered" );
					break;
				}
				case "gps": {
					var lat = document.getElementById( fid + "-lat" );
					var lng = document.getElementById( fid + "-lng" );
					var acc = document.getElementById( fid + "-acc" );
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
					} else {
						entry.text = t( "noImage", "No image uploaded" );
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

		this.loadImages( answers ).then( function ( answersWithImages ) {
			var result = self.buildPdf( answersWithImages );
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
	 * Build a clean, readable, single-file PDF: title, timestamp, then
	 * each question with its answer, wrapping text and embedding photos
	 * inline. Entirely local — jsPDF runs in the browser.
	 */
	DynaformInstance.prototype.buildPdf = function ( answers ) {
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

		function ensureSpace( needed ) {
			if ( y + needed > pageHeight - marginBottom ) {
				pdf.addPage();
				y = marginTop;
			}
		}

		pdf.setFont( "NotoSansBengali", "normal" );
		pdf.setFontSize( 16 );
		var titleLines = pdf.splitTextToSize( this.schema.title || "", usableWidth );
		pdf.text( titleLines, pageWidth / 2, y, { align: "center" } );
		y += titleLines.length * 7 + 3;

		pdf.setFontSize( 10 );
		pdf.setTextColor( 110 );
		pdf.text( new Date().toLocaleString(), pageWidth / 2, y, { align: "center" } );
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
			var qLines = pdf.splitTextToSize( qNo + ". " + entry.question, usableWidth );
			ensureSpace( qLines.length * 6 + 8 );
			pdf.setFont( "NotoSansBengali", "normal" );
			pdf.text( qLines, marginLeft, y );
			y += qLines.length * 6 + 3;

			if ( entry.type === "image" && entry.dataUrl ) {
				var maxImgWidth = usableWidth * 0.6;
				var maxImgHeight = 80;
				var ratio = Math.min( maxImgWidth / entry.imgWidth, maxImgHeight / entry.imgHeight, 1 );
				var w = entry.imgWidth * ratio;
				var h = entry.imgHeight * ratio;
				ensureSpace( h + 6 );
				var format = /png/i.test( entry.dataUrl.substring( 0, 30 ) ) ? "PNG" : "JPEG";
				try {
					pdf.addImage( entry.dataUrl, format, marginLeft, y, w, h );
				} catch ( e ) {
					pdf.text( entry.text, marginLeft, y + 5 );
				}
				y += h + 8;
			} else {
				pdf.setFontSize( 11 );
				var ansLines = pdf.splitTextToSize( String( entry.text ), usableWidth - 4 );
				ensureSpace( ansLines.length * 6 + 6 );
				pdf.setFillColor( 246, 248, 250 );
				pdf.rect( marginLeft, y - 4.5, usableWidth, ansLines.length * 6 + 4, "F" );
				pdf.text( ansLines, marginLeft + 2, y );
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

		var safeTitle = ( this.schema.title || "response" ).replace( /[^\p{L}\p{M}\p{N}]+/gu, "_" ).replace( /^_+|_+$/g, "" );
		var filename = ( safeTitle || "response" ) + "-" + Date.now() + ".pdf";
		return { blob: pdf.output( "blob" ), filename: filename };
	};

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
