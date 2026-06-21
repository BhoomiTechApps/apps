# Vendored third-party assets

Everything in this folder is bundled locally instead of loaded from a
CDN, on purpose: this PWA's whole reason to exist is running on a kiosk
that may have **no internet connection at all**, including on the very
first time it's ever set up. A CDN-loaded library only works offline
*after* a service worker has successfully cached it once — which means
the very first boot, on a kiosk that has never had connectivity, would
fail before that cache ever gets populated. Vendoring removes that
dependency entirely: these files ship in the app package itself, so
USB mode works from boot #1, with zero network, every time.

(This bit Map mode specifically: before this fix, the entire "select
your USB folder" flow would complete successfully — picking the
folder, reading settings.json, reading every layer file — and then
fail at the very last step with `ReferenceError: L is not defined`,
because Leaflet had no local fallback. The folder-selection flow looks
identical online or offline; only the map library it needs at the end
ever depended on a connection that doesn't necessarily exist on a
freshly unboxed kiosk.)

## What's here

- `leaflet/` — Leaflet 1.9.4 (CSS, JS, marker icon images). Sourced
  from the `leaflet` npm package, which mirrors the same files the
  `unpkg.com/leaflet@1.9.4/dist/...` CDN URLs used to serve.
- `leaflet.markercluster/` — leaflet.markercluster 1.5.3 (JS plugin +
  its base structural CSS only). Sourced from the
  `leaflet.markercluster` npm package, MIT licensed. We deliberately
  do **not** vendor the package's `MarkerCluster.Default.css` — its
  green/yellow/orange bullseye theme is replaced with kiosk-branded
  indigo cluster bubbles styled in `kiosk.css` (`.mediamap-cluster-*`
  classes), built via `iconCreateFunction` in app.js
  (`buildClusterIcon`). Only `MarkerCluster.css` (transitions/spiderfy
  geometry, no colors) is needed alongside that.
- `material-icons/` — the classic "Filled" Material Icons web font
  (CSS trimmed down to just that one style, plus its `.woff2`).
  Sourced from the `material-icons` npm package (a self-hosted
  distribution of Google's Material Icons, Apache 2.0 licensed):
  https://www.npmjs.com/package/material-icons
- `pdfjs/` — PDF.js 5.7.x (`pdf.min.mjs` + `pdf.worker.min.mjs`, **the
  `legacy/build/` variant**, not the main one — see below), plus its
  `standard_fonts/`, `wasm/`, and `iccs/` resource folders. Apache 2.0
  licensed, from Mozilla. Used to render PDF points onto a `<canvas>`
  in the lightbox instead of embedding them in an
  `<iframe src="file.pdf">`, which most mobile browsers (Chrome on
  Android especially, and inconsistently on iOS Safari) don't reliably
  render — they show a blank box or force a download instead. PDF.js
  parses + rasterizes the PDF itself, so it renders identically on
  desktop, Android, and iOS, fully offline — and works the same whether
  the PDF came from a remote URL or a `blob:` object URL (what
  USB mode's `resolveMediaUrl()` returns for a local file).

  **Why the `legacy` build specifically:** the main (non-legacy) build
  of pdfjs-dist 5.7/6.0 calls `Map.prototype.getOrInsertComputed()` —
  a brand-new, not-yet-broadly-supported JS Map method (still a TC39
  proposal) — with no fallback. On any browser without it, every
  render silently throws partway through and the PDF comes out as a
  blank white page with no visible error. This affected even a fairly
  recent desktop Chromium (141) in testing, so it's not just an old-
  browser concern. The `legacy` build includes a polyfill for this and
  renders correctly everywhere; it's otherwise the same renderer.

  **Why the extra resource folders:** `standardFontDataUrl` (→
  `standard_fonts/`) must be set explicitly as of PDF.js v5 — without
  it, text using any non-embedded standard font (very common) silently
  fails to draw, again with no visible error. `wasmUrl`/`iccUrl` (→
  `wasm/`/`iccs/`) cover JBIG2 decoding (common in scanned-document
  compression — kept) and CMYK colour conversion (kept, tiny). All
  three are passed as options in `PdfViewerModule`'s `getDocument()`
  call in app.js, and all three are precached by the service worker
  (see sw.js) so they're available from boot #1 offline.

  **Deliberately NOT vendored, to keep this from ballooning:**
  - `cmaps/` (~1.7MB, 169 files) — covers legacy CJK (Chinese/
    Japanese/Korean) CID-keyed font encodings. Indic-script documents
    (Assamese, Bengali, etc.) render fine via standard embedded
    Unicode fonts without it. `cMapUrl` is simply left unset.
  - `wasm/openjpeg*` (~692KB) — JPEG2000 image decoding. Only matters
    if scanned source material is specifically JP2-encoded, which is
    uncommon. If a specific scan shows up blank/broken, check this.
  - `wasm/quickjs-eval*` (~424KB) — executes embedded PDF JavaScript
    (interactive form calculations, etc.). Irrelevant for display-only
    archival documents with no interactive form logic.

  If any of these turn out to matter for real archive content later,
  copy the relevant files back in, re-add the matching `getDocument()`
  option in app.js, and add the new files to `sw.js`'s `APP_SHELL` +
  bump `CACHE_NAME`. Current footprint of `vendor/pdfjs/`: ~2.9MB.

## Updating

```bash
npm install leaflet@<version>
cp node_modules/leaflet/dist/leaflet.css vendor/leaflet/leaflet.css
cp node_modules/leaflet/dist/leaflet.js  vendor/leaflet/leaflet.js
cp node_modules/leaflet/dist/images/*.png vendor/leaflet/images/

npm install leaflet.markercluster@<version>
cp node_modules/leaflet.markercluster/dist/leaflet.markercluster.js vendor/leaflet.markercluster/leaflet.markercluster.js
cp node_modules/leaflet.markercluster/dist/MarkerCluster.css        vendor/leaflet.markercluster/MarkerCluster.css
# (MarkerCluster.Default.css is intentionally not copied — see above)

npm install material-icons@<version>
cp node_modules/material-icons/iconfont/material-icons.woff2 vendor/material-icons/material-icons.woff2
# material-icons.css is hand-trimmed from the npm package's
# iconfont/material-icons.css — keep only the first @font-face +
# .material-icons block (the "Filled" style); the package also bundles
# Outlined/Round/Sharp/Two-tone variants this app doesn't use.

npm install pdfjs-dist@<version>
cp node_modules/pdfjs-dist/legacy/build/pdf.min.mjs        vendor/pdfjs/pdf.min.mjs
cp node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs vendor/pdfjs/pdf.worker.min.mjs
# NOT node_modules/pdfjs-dist/build/... (the non-legacy build) — see the
# "Why the legacy build specifically" note above; using the wrong one
# makes every PDF render as a blank page with no visible error.
cp node_modules/pdfjs-dist/LICENSE             vendor/pdfjs/LICENSE
cp -r node_modules/pdfjs-dist/standard_fonts/. vendor/pdfjs/standard_fonts/
cp -r node_modules/pdfjs-dist/iccs/.           vendor/pdfjs/iccs/
# wasm/ — copy the whole thing, then delete what we deliberately don't
# vendor (see "Deliberately NOT vendored" above):
cp -r node_modules/pdfjs-dist/wasm/. vendor/pdfjs/wasm/
rm vendor/pdfjs/wasm/openjpeg* vendor/pdfjs/wasm/quickjs-eval* vendor/pdfjs/wasm/LICENSE_OPENJPEG vendor/pdfjs/wasm/LICENSE_PDFJS_OPENJPEG
# cmaps/ is not copied at all — see above.
```

This trim is config-coupled, not just file deletion — if you ever copy
`cmaps/`/`openjpeg*`/`quickjs-eval*` back in, you also need to re-add
the matching option (`cMapUrl`, etc.) to the `getDocument()` call in
app.js, or the files will just sit there unused.

After updating, bump `CACHE_NAME` in `sw.js` so kiosks already running
the service worker actually pick up the new files instead of serving
the old cached versions indefinitely.
