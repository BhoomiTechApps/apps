/**
 * OCR Studio — page clean-up before recognition, for poor print and scans.
 *
 * The scan is measured first (line spacing, stroke thickness, paper
 * evenness, ink contrast, specks) and only the clean-up that suits it is
 * applied, on a copy sent to the recognition engine. The picture on screen is
 * never changed.
 *
 *   • Background flattening — divides out shadows, yellowing and gradients
 *                               (faded print, uneven paper, phone photos).
 *   • Text-size normalising  — enlarges small or low-resolution text so lines
 *                               land near the size the models were trained on.
 *   • Ink thickening          — darkens thin, faint or blurred strokes a little.
 *   • Smoothing               — a 3×3 median that removes specks on broken print.
 *
 * Tested on degraded copies of a Bishnupriya Manipuri page (low resolution,
 * blur + JPEG, faded on uneven paper, ink bleed, broken print with specks,
 * phone-photo shadow). Black-and-white conversion, speck removal on a
 * black-and-white page, stroke thinning and sharpening all made recognition
 * worse there and are not used: Tesseract's own conversion does better.
 *
 * Pure canvas/array code, no dependencies. Exposes window.OCRPrep.
 */
( function ( root ) {
	'use strict';

	const DEFAULTS = {
		flatten: true,
		targetPitch: 0,     // line spacing (px) after rescaling; 0 = keep size
		median: false,
		ink: 0,             // 0–1: how much to thicken thin or faint strokes
	};

	// ── Basic image helpers (grey Float32Array, w, h) ────────────────────────
	function toGray( canvas ) {
		const w = canvas.width, h = canvas.height;
		const d = canvas.getContext( '2d' ).getImageData( 0, 0, w, h ).data;
		const g = new Float32Array( w * h );
		for ( let i = 0, p = 0; i < g.length; i++, p += 4 ) {
			// Transparent pixels count as paper.
			const a = d[ p + 3 ] / 255;
			g[ i ] = ( 0.299 * d[ p ] + 0.587 * d[ p + 1 ] + 0.114 * d[ p + 2 ] ) * a + 255 * ( 1 - a );
		}
		return { g, w, h };
	}

	function toCanvas( { g, w, h } ) {
		const c = document.createElement( 'canvas' );
		c.width = w; c.height = h;
		const ctx = c.getContext( '2d' );
		const img = ctx.createImageData( w, h );
		const d = img.data;
		for ( let i = 0, p = 0; i < g.length; i++, p += 4 ) {
			const v = g[ i ] < 0 ? 0 : g[ i ] > 255 ? 255 : g[ i ];
			d[ p ] = d[ p + 1 ] = d[ p + 2 ] = v; d[ p + 3 ] = 255;
		}
		ctx.putImageData( img, 0, 0 );
		return c;
	}

	function resize( im, s ) {
		const src = toCanvas( im );
		const w = Math.max( 1, Math.round( im.w * s ) ), h = Math.max( 1, Math.round( im.h * s ) );
		const c = document.createElement( 'canvas' );
		c.width = w; c.height = h;
		const ctx = c.getContext( '2d' );
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage( src, 0, 0, w, h );
		return toGray( c );
	}

	// Box blur via a summed-area table (also gives local mean/variance).
	function integral( g, w, h, sq ) {
		const I = new Float64Array( ( w + 1 ) * ( h + 1 ) );
		for ( let y = 0; y < h; y++ ) {
			let row = 0;
			for ( let x = 0; x < w; x++ ) {
				const v = g[ y * w + x ];
				row += sq ? v * v : v;
				I[ ( y + 1 ) * ( w + 1 ) + x + 1 ] = I[ y * ( w + 1 ) + x + 1 ] + row;
			}
		}
		return I;
	}
	function boxSum( I, w, x0, y0, x1, y1 ) { // inclusive-exclusive
		const W = w + 1;
		return I[ y1 * W + x1 ] - I[ y0 * W + x1 ] - I[ y1 * W + x0 ] + I[ y0 * W + x0 ];
	}

	// Brightness at fraction f of the values in g that satisfy keep(v).
	function quantile( g, f, keep ) {
		const hist = new Uint32Array( 256 );
		let n = 0;
		for ( let i = 0; i < g.length; i++ ) { const v = g[ i ]; if ( keep && ! keep( v ) ) continue; hist[ v < 0 ? 0 : v > 255 ? 255 : v | 0 ]++; n++; }
		let acc = 0;
		for ( let t = 0; t < 256; t++ ) { acc += hist[ t ]; if ( acc > n * f ) return t; }
		return 255;
	}

	function otsu( g ) {
		const hist = new Uint32Array( 256 );
		for ( let i = 0; i < g.length; i++ ) hist[ g[ i ] < 0 ? 0 : g[ i ] > 255 ? 255 : g[ i ] | 0 ]++;
		let sum = 0; for ( let t = 0; t < 256; t++ ) sum += t * hist[ t ];
		let sumB = 0, wB = 0, best = 0, thr = 128;
		for ( let t = 0; t < 256; t++ ) {
			wB += hist[ t ]; if ( ! wB ) continue;
			const wF = g.length - wB; if ( ! wF ) break;
			sumB += t * hist[ t ];
			const mB = sumB / wB, mF = ( sum - sumB ) / wF, between = wB * wF * ( mB - mF ) * ( mB - mF );
			if ( between > best ) { best = between; thr = t; }
		}
		return thr;
	}

	// ── Background flattening ────────────────────────────────────────────
	// Paper brightness is estimated as the local maximum over blocks a little
	// larger than a letter, smoothed; dividing by it removes shading.
	function flatten( im ) {
		const { g, w, h } = im;
		const B = Math.max( 8, Math.round( Math.min( w, h ) / 40 ) );
		const bw = Math.ceil( w / B ), bh = Math.ceil( h / B );
		const blk = new Float32Array( bw * bh );
		for ( let by = 0; by < bh; by++ ) for ( let bx = 0; bx < bw; bx++ ) {
			// 90th percentile of the block, robust to specks of white noise.
			const vals = [];
			for ( let y = by * B; y < Math.min( h, by * B + B ); y += 2 ) for ( let x = bx * B; x < Math.min( w, bx * B + B ); x += 2 ) vals.push( g[ y * w + x ] );
			vals.sort( ( a, b ) => a - b );
			blk[ by * bw + bx ] = vals[ Math.floor( vals.length * 0.9 ) ] || 255;
		}
		// Spread the brightest neighbours (blocks fully covered by text are too dark).
		const blk2 = new Float32Array( blk.length );
		for ( let by = 0; by < bh; by++ ) for ( let bx = 0; bx < bw; bx++ ) {
			let m = 0;
			for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) {
				const yy = by + dy, xx = bx + dx;
				if ( yy >= 0 && yy < bh && xx >= 0 && xx < bw ) m = Math.max( m, blk[ yy * bw + xx ] );
			}
			blk2[ by * bw + bx ] = m;
		}
		// Smooth and upsample bilinearly.
		const sm = new Float32Array( blk2.length );
		for ( let by = 0; by < bh; by++ ) for ( let bx = 0; bx < bw; bx++ ) {
			let s = 0, n = 0;
			for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) {
				const yy = by + dy, xx = bx + dx;
				if ( yy >= 0 && yy < bh && xx >= 0 && xx < bw ) { s += blk2[ yy * bw + xx ]; n++; }
			}
			sm[ by * bw + bx ] = s / n;
		}
		const out = new Float32Array( w * h );
		for ( let y = 0; y < h; y++ ) {
			const fy = Math.min( bh - 1, Math.max( 0, y / B - 0.5 ) ), y0 = Math.floor( fy ), y1 = Math.min( bh - 1, y0 + 1 ), ty = fy - y0;
			for ( let x = 0; x < w; x++ ) {
				const fx = Math.min( bw - 1, Math.max( 0, x / B - 0.5 ) ), x0 = Math.floor( fx ), x1 = Math.min( bw - 1, x0 + 1 ), tx = fx - x0;
				const bg = ( sm[ y0 * bw + x0 ] * ( 1 - tx ) + sm[ y0 * bw + x1 ] * tx ) * ( 1 - ty ) + ( sm[ y1 * bw + x0 ] * ( 1 - tx ) + sm[ y1 * bw + x1 ] * tx ) * ty;
				out[ y * w + x ] = Math.min( 255, ( g[ y * w + x ] / Math.max( 1, bg ) ) * 255 );
			}
		}
		// Stretch so the darkest ink reaches black.
		const sorted = Float32Array.from( out.filter( ( _, i ) => i % 7 === 0 ) ).sort();
		const lo = sorted[ Math.floor( sorted.length * 0.005 ) ] || 0;
		const span = Math.max( 30, 250 - lo );
		for ( let i = 0; i < out.length; i++ ) out[ i ] = Math.min( 255, Math.max( 0, ( out[ i ] - lo ) * 255 / span ) );
		return { g: out, w, h };
	}

	// ── Line spacing (text size) ─────────────────────────────────────────
	// Autocorrelation of the row ink profile; the first strong peak is the
	// distance between baselines.
	function linePitch( im ) {
		const { g, w, h } = im;
		const thr = otsu( g );
		const prof = new Float32Array( h );
		for ( let y = 0; y < h; y++ ) { let n = 0; for ( let x = 0; x < w; x++ ) if ( g[ y * w + x ] < thr ) n++; prof[ y ] = n; }
		let mean = 0; for ( let y = 0; y < h; y++ ) mean += prof[ y ]; mean /= h;
		for ( let y = 0; y < h; y++ ) prof[ y ] -= mean;
		const maxLag = Math.min( Math.floor( h / 2 ), 400 );
		const ac = new Float32Array( maxLag + 1 );
		for ( let lag = 0; lag <= maxLag; lag++ ) { let s = 0; for ( let y = 0; y + lag < h; y++ ) s += prof[ y ] * prof[ y + lag ]; ac[ lag ] = s / ( h - lag ); }
		if ( ac[ 0 ] <= 0 ) return 0;
		let best = 0;
		for ( let lag = 6; lag < maxLag; lag++ ) {
			if ( ac[ lag ] > ac[ lag - 1 ] && ac[ lag ] >= ac[ lag + 1 ] && ac[ lag ] > 0.3 * ac[ 0 ] ) { best = lag; break; }
		}
		return best;
	}

	// ── Connected components on a black-and-white image ──────────────────────
	function components( im ) {
		const { g, w, h } = im;
		const lab = new Int32Array( w * h ).fill( -1 );
		const comps = [];
		const stack = new Int32Array( w * h );
		for ( let i = 0; i < w * h; i++ ) {
			if ( g[ i ] !== 0 || lab[ i ] !== -1 ) continue;
			const id = comps.length;
			let sp = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
			stack[ sp++ ] = i; lab[ i ] = id;
			while ( sp ) {
				const p = stack[ --sp ], x = p % w, y = ( p / w ) | 0;
				area++;
				if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y;
				for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) {
					const xx = x + dx, yy = y + dy;
					if ( xx < 0 || yy < 0 || xx >= w || yy >= h ) continue;
					const q = yy * w + xx;
					if ( g[ q ] === 0 && lab[ q ] === -1 ) { lab[ q ] = id; stack[ sp++ ] = q; }
				}
			}
			comps.push( { area, x0, y0, x1, y1 } );
		}
		return { lab, comps };
	}

	// Stroke width ≈ 2 × ink area ÷ ink edge length.
	function strokeWidth( im ) {
		const { g, w, h } = im;
		let area = 0, edge = 0;
		for ( let y = 0; y < h - 1; y++ ) for ( let x = 0; x < w - 1; x++ ) {
			const a = g[ y * w + x ] === 0;
			if ( a ) area++;
			if ( a !== ( g[ y * w + x + 1 ] === 0 ) ) edge++;
			if ( a !== ( g[ ( y + 1 ) * w + x ] === 0 ) ) edge++;
		}
		return edge ? 2 * area / edge : 0;
	}
	// ── Grey-level filters (work on the grey page; Tesseract does its own
	// black-and-white conversion, which beats a local threshold here) ─────
	// 3×3 minimum (thicker ink), done as row then column passes.
	function darken3( im ) {
		const { g, w, h } = im;
		const t = new Float32Array( w * h ), out = new Float32Array( w * h );
		for ( let y = 0; y < h; y++ ) {
			const r = y * w;
			for ( let x = 0; x < w; x++ ) {
				let m = g[ r + x ];
				if ( x > 0 && g[ r + x - 1 ] < m ) m = g[ r + x - 1 ];
				if ( x < w - 1 && g[ r + x + 1 ] < m ) m = g[ r + x + 1 ];
				t[ r + x ] = m;
			}
		}
		for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
			const i = y * w + x;
			let m = t[ i ];
			if ( y > 0 && t[ i - w ] < m ) m = t[ i - w ];
			if ( y < h - 1 && t[ i + w ] < m ) m = t[ i + w ];
			out[ i ] = m;
		}
		return { g: out, w, h };
	}
	// 3×3 median with a fixed sorting network (19 compare-swaps).
	function median3( im ) {
		const { g, w, h } = im;
		const out = Float32Array.from( g ), p = new Float32Array( 9 );
		const S = ( a, b ) => { if ( p[ a ] > p[ b ] ) { const t = p[ a ]; p[ a ] = p[ b ]; p[ b ] = t; } };
		for ( let y = 1; y < h - 1; y++ ) for ( let x = 1; x < w - 1; x++ ) {
			const i = y * w + x;
			p[ 0 ] = g[ i - w - 1 ]; p[ 1 ] = g[ i - w ]; p[ 2 ] = g[ i - w + 1 ];
			p[ 3 ] = g[ i - 1 ];     p[ 4 ] = g[ i ];     p[ 5 ] = g[ i + 1 ];
			p[ 6 ] = g[ i + w - 1 ]; p[ 7 ] = g[ i + w ]; p[ 8 ] = g[ i + w + 1 ];
			S( 1, 2 ); S( 4, 5 ); S( 7, 8 ); S( 0, 1 ); S( 3, 4 ); S( 6, 7 ); S( 1, 2 ); S( 4, 5 ); S( 7, 8 );
			S( 0, 3 ); S( 5, 8 ); S( 4, 7 ); S( 3, 6 ); S( 1, 4 ); S( 2, 5 ); S( 4, 7 ); S( 4, 2 ); S( 6, 4 ); S( 4, 2 );
			out[ i ] = p[ 4 ];
		}
		return { g: out, w, h };
	}
	function blend( a, b, t ) { const out = new Float32Array( a.g.length ); for ( let i = 0; i < out.length; i++ ) out[ i ] = a.g[ i ] * ( 1 - t ) + b.g[ i ] * t; return { g: out, w: a.w, h: a.h }; }
	// ── Measuring the scan ───────────────────────────────────────────────────
	// pitch: line spacing (px); stroke: ink stroke width ÷ line spacing;
	// unevenness: spread of paper brightness across the page (0–1);
	// contrast: paper minus ink brightness (0–255); specks: share of ink blobs
	// that are tiny and isolated.
	function measure( canvas, cache ) {
		const full = toGray( canvas );
		if ( cache ) cache.raw = full;
		// Big pages are measured on a reduced copy: the proportions are the same.
		const f = Math.min( 1, Math.sqrt( 3e6 / ( full.w * full.h ) ) );
		const raw = f < 1 ? resize( full, f ) : full;
		const flat = flatten( raw );
		if ( cache && f === 1 ) cache.flat = flat;
		const pitch = linePitch( flat );
		const thr = otsu( flat.g );
		const bw = { g: flat.g.map( v => ( v < thr ? 0 : 255 ) ), w: flat.w, h: flat.h };
		const stroke = pitch ? strokeWidth( bw ) / pitch : 0;
		// Paper and ink levels on the original.
		const t0 = otsu( raw.g );
		const isPaper = v => v >= t0, isInk = v => v < t0;
		const contrast = quantile( raw.g, 0.5, isPaper ) - quantile( raw.g, 0.5, isInk );
		const unevenness = ( quantile( raw.g, 0.95, isPaper ) - quantile( raw.g, 0.05, isPaper ) ) / 255;
		let specks = 0;
		if ( pitch ) {
			const { comps } = components( bw );
			const tiny = Math.max( 3, ( pitch * 0.06 ) ** 2 );
			const n = comps.filter( c => c.area < tiny ).length;
			specks = comps.length ? n / comps.length : 0;
		}
		return { pitch: Math.round( pitch / f ), stroke: Math.round( stroke * 1000 ) / 1000, contrast: Math.round( contrast ), unevenness: Math.round( unevenness * 100 ) / 100, specks: Math.round( specks * 100 ) / 100 };
	}

	// ── Choosing the clean-up from the measurements ──────────────────────────
	// Thresholds were set on test scans: low resolution, blur + JPEG, faded on
	// uneven paper, ink bleed, broken print with specks, phone-photo shadow.
	function recipe( m ) {
		const r = { flatten: m.contrast < 170 || m.unevenness > 0.2, targetPitch: 0, median: false, ink: 0, kind: [] };
		if ( r.flatten ) r.kind.push( m.contrast < 80 ? 'faded' : 'uneven paper' );
		// Specks: smoothing alone; flattening first makes the specks darker.
		if ( m.specks > 0.3 ) { r.flatten = false; r.median = true; r.kind = [ 'specks / broken print' ]; return r; }
		// Heavy (bled) ink: thinning and enlarging both made it worse.
		if ( m.stroke > 0.14 ) { r.kind.push( 'heavy ink' ); return r; }
		if ( m.pitch && m.pitch < 34 ) { r.targetPitch = 44; r.kind.push( m.pitch < 22 ? 'low resolution' : 'small text' ); }
		r.ink = 0.5;
		return r;
	}
	// Manual choices, for when the automatic one is wrong for a book.
	const PRESETS = {
		faded:  m => ( { flatten: true, targetPitch: m.pitch && m.pitch < 34 ? 44 : 0, ink: 0.5, kind: [ 'faded / uneven (chosen)' ] } ),
		lowres: () => ( { flatten: true, targetPitch: 44, ink: 0.5, kind: [ 'low resolution (chosen)' ] } ),
		heavy:  () => ( { flatten: true, targetPitch: 0, ink: 0, kind: [ 'heavy ink (chosen)' ] } ),
		specks: () => ( { flatten: false, targetPitch: 0, median: true, kind: [ 'specks / broken print (chosen)' ] } ),
	};

	/**
	 * prepare( canvas, mode ) — mode is 'auto' or a PRESETS key.
	 * Returns { canvas, scale, info }: a cleaned copy for recognition, how much
	 * it was enlarged (to map word boxes back), and what was measured and done.
	 */
	function prepare( canvas, mode ) {
		const info = { steps: [] };
		const cache = {};
		info.measured = measure( canvas, cache );
		const o = Object.assign( {}, DEFAULTS, PRESETS[ mode ] ? PRESETS[ mode ]( info.measured ) : recipe( info.measured ) );
		info.kind = o.kind;
		let im = cache.raw;
		if ( o.flatten ) { im = cache.flat || flatten( im ); info.steps.push( 'background evened' ); }
		let scale = 1;
		const pitch = info.measured.pitch;
		if ( o.targetPitch && pitch >= 8 ) {
			// Keep the copy under about 12 megapixels (memory and recognition time).
			let s = Math.min( o.targetPitch / pitch, Math.sqrt( 12e6 / ( im.w * im.h ) ), 4 );
			if ( s > 1.15 ) {
				im = resize( im, s );
				scale = im.w / canvas.width;
				info.steps.push( 'enlarged ×' + ( Math.round( scale * 10 ) / 10 ) );
			}
		}
		if ( o.median ) { im = median3( im ); info.steps.push( 'specks smoothed' ); }
		if ( o.ink > 0 ) { im = blend( im, darken3( im ), o.ink ); info.steps.push( 'ink strengthened' ); }
		return { canvas: toCanvas( im ), scale, info };
	}

	// ── Skew (for Deskew) ────────────────────────────────────────────────────
	//
	// Measured on a small copy whose background has been evened out (so faded
	// print, yellowed paper and shadows don't matter), with the ink threshold
	// chosen from the page itself (Otsu) and the outer margins left out (dark
	// page edges, scanner lids and book gutters would otherwise look like lines).
	// The angle is the one at which the text lines give the sharpest row
	// profile. It is reported as unreliable when the best angle sits at the end
	// of the range or hardly beats the page as it is.
	const SKEW_RANGE = 15;   // degrees either way

	function otsu( vals ) {
		const hist = new Uint32Array( 256 );
		for ( const v of vals ) hist[ v < 0 ? 0 : v > 255 ? 255 : v | 0 ]++;
		let sum = 0; for ( let t = 0; t < 256; t++ ) sum += t * hist[ t ];
		let sumB = 0, wB = 0, best = -1, thr = 128;
		for ( let t = 0; t < 256; t++ ) {
			wB += hist[ t ]; if ( ! wB ) continue;
			const wF = vals.length - wB; if ( ! wF ) break;
			sumB += t * hist[ t ];
			const mB = sumB / wB, mF = ( sum - sumB ) / wF, between = wB * wF * ( mB - mF ) * ( mB - mF );
			if ( between > best ) { best = between; thr = t; }
		}
		return thr;
	}

	// Where the picture is paper: blocks whose brightest tenth is light. Dark
	// scanner borders, table tops and deep shadows are left out, together with
	// a strip of one block round them (their edges would look like lines).
	function paperMask( { g, w, h } ) {
		const B = Math.max( 8, Math.round( Math.min( w, h ) / 40 ) );
		const bw = Math.ceil( w / B ), bh = Math.ceil( h / B );
		const light = new Uint8Array( bw * bh );
		for ( let by = 0; by < bh; by++ ) for ( let bx = 0; bx < bw; bx++ ) {
			const vals = [];
			for ( let y = by * B; y < Math.min( h, by * B + B ); y += 2 ) for ( let x = bx * B; x < Math.min( w, bx * B + B ); x += 2 ) vals.push( g[ y * w + x ] );
			vals.sort( ( a, b ) => a - b );
			light[ by * bw + bx ] = ( vals[ Math.floor( vals.length * 0.9 ) ] || 0 ) > 110 ? 1 : 0;
		}
		const ok = new Uint8Array( bw * bh );
		for ( let by = 0; by < bh; by++ ) for ( let bx = 0; bx < bw; bx++ ) {
			let all = 1;
			for ( let dy = -1; dy <= 1 && all; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) {
				const yy = by + dy, xx = bx + dx;
				if ( yy >= 0 && yy < bh && xx >= 0 && xx < bw && ! light[ yy * bw + xx ] ) { all = 0; break; }
			}
			ok[ by * bw + bx ] = all;
		}
		return ( x, y ) => ok[ Math.floor( y / B ) * bw + Math.floor( x / B ) ] === 1;
	}

	function skew( canvas ) {
		let im = toGray( canvas );
		const s = Math.min( 1, 1200 / Math.max( im.w, im.h ) );
		if ( s < 1 ) im = resize( im, s );
		const paper = paperMask( im );
		im = flatten( im );
		const { g, w, h } = im;
		const mx = Math.round( w * 0.07 ), my = Math.round( h * 0.07 );
		const inner = [];
		for ( let y = my; y < h - my; y += 2 ) for ( let x = mx; x < w - mx; x += 2 ) if ( paper( x, y ) ) inner.push( g[ y * w + x ] );
		if ( inner.length < 1000 ) return { angle: 0, reliable: false, reason: 'no text' };
		// Ink must be clearly darker than the paper even on a clean page.
		const thr = Math.min( otsu( inner ), 200 );
		const xs = [], ys = [];
		for ( let y = my; y < h - my; y++ ) for ( let x = mx; x < w - mx; x++ ) {
			if ( g[ y * w + x ] < thr && paper( x, y ) ) { xs.push( x - w / 2 ); ys.push( y - h / 2 ); }
		}
		const n = xs.length;
		if ( n < 200 || n > ( w - 2 * mx ) * ( h - 2 * my ) * 0.5 ) return { angle: 0, reliable: false, reason: 'no text' };
		const rows = new Float64Array( h * 2 + 8 );
		const score = ( deg ) => {
			const r = deg * Math.PI / 180, c = Math.cos( r ), sn = Math.sin( r );
			rows.fill( 0 );
			for ( let i = 0; i < n; i++ ) rows[ Math.round( ys[ i ] * c - xs[ i ] * sn + h ) ]++;
			let q = 0; for ( let i = 0; i < rows.length; i++ ) q += rows[ i ] * rows[ i ];
			return q;
		};
		let best = 0, bestScore = -1;
		for ( let a = -SKEW_RANGE; a <= SKEW_RANGE + 1e-9; a += 0.5 ) {
			const q = score( a );
			if ( q > bestScore ) { bestScore = q; best = a; }
		}
		const coarse = best;
		for ( let a = coarse - 0.45; a <= coarse + 0.45 + 1e-9; a += 0.05 ) {
			const q = score( a );
			if ( q > bestScore ) { bestScore = q; best = a; }
		}
		best = Math.round( best * 10 ) / 10;
		const flat = score( 0 );
		if ( Math.abs( best ) >= SKEW_RANGE - 0.25 ) return { angle: best, reliable: false, reason: 'out of range' };
		if ( best !== 0 && bestScore < flat * 1.03 ) return { angle: 0, reliable: true, reason: 'not clearly tilted' };
		return { angle: best, reliable: true };
	}

	root.OCRPrep = { prepare, measure, recipe, PRESETS, skew };
}( typeof self !== 'undefined' ? self : this ) );
