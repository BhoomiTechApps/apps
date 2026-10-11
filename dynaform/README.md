# DynaForm PDF — Progressive Web App (v1.4.0)

The DynaForm PDF WordPress plugin (v1.1.1), rebuilt as an installable,
fully offline web app. No WordPress, PHP, database or login is needed.

Like the plugin, **responses are never uploaded**: on Submit the
respondent's browser validates the answers, builds the PDF (text, GPS,
photos, signatures, Bengali-script text via the bundled Noto Sans Bengali
font) and saves it to their device.

Since 1.4.0 every PDF also carries its answers as data, so the organiser
can drop the PDFs people send them (by WhatsApp, email, pen drive…) into
the form's **Responses** screen and get one table, a summary, and CSV /
JSON / GeoJSON exports, all on their own device.

## Deploying

It's a folder of static files. Upload it to any HTTPS host, for example:

- a sub-folder of your existing WordPress site (e.g. `https://example.org/dynaform/`)
- GitHub Pages, Netlify, Cloudflare Pages, Vercel

HTTPS is required for installing and for offline mode (plain `http://` only
works on `localhost`). All paths are relative, so any sub-folder works.

To try it locally: `python3 -m http.server 8000` in this folder, then open
http://localhost:8000.

## Plugin feature → PWA equivalent

| Plugin | PWA |
| --- | --- |
| Form Studio page (`[dynaform_studio]`) | Home screen: "Your forms" |
| Custom post type + admin-ajax save | Forms saved in the browser (localStorage), autosaved as you edit |
| `[dynaform id="…"]` shortcode | **Fill in** button, or **Share as link** |
| Download standalone HTML | Same, built on-device (works offline) |
| Per-user ownership / roles | Not needed: each device has its own forms |
| — | Import / export a form as `.json`, "Back up all" |
| — | Install to home screen, works with no signal |
| — | ↑/↓ reorder buttons (drag-and-drop doesn't work on touch screens) |

### Share links

The whole form definition (questions only) is compressed into the part of
the URL after `#`, which browsers never send to the server. Anyone who
opens the link can fill in the form, and save it to their own forms list.

## Changes to the form engine (`js/dynaform-frontend.js`)

- Photos are downscaled to max 1600 px and re-encoded as JPEG before going
  into the PDF. Phone photos used to make multi-MB PDFs, and WebP images
  failed to embed.
- After submitting, **Save PDF again** and (where supported) **Share PDF**
  buttons appear. On iPhone home-screen apps, Share is the reliable way to
  get the PDF into Files, WhatsApp, etc.
- PDF filenames keep Bengali vowel signs (they were being stripped).
- `window.Dynaform.mount(el, schema, opts)` API; the `data-dynaform`
  auto-init still works, so exported HTML files behave as before.

## Interface themes

The app uses the BhoomiTech frame and two matte themes: **Light "Stone"**
(default) and **Dark "Graphite"**. The sun/moon switch in the app bar
changes it, and the choice is remembered on that device. Add
`?theme=dark` or `?theme=light` to the address to override it for one
visit (e.g. a kiosk link). "Download offline HTML" uses whichever theme is
showing when you download, and embeds the Onest font so it works offline.

## Right-click and code protection (`js/guard.js`)

- Right-click is off everywhere. In text boxes it opens a small menu with
  only **Copy** and **Paste** (Paste asks for clipboard permission the
  first time; if refused, Ctrl+V / ⌘V still works).
- F12, Ctrl+Shift+I/J/C/K/E, ⌘⌥I/J/C/U and Ctrl+U (view source) return the
  page to `index.html`; Ctrl+S is blocked. Opening the developer tools
  (detected by a debugger pause, or by the viewport shrinking on desktop)
  also returns to `index.html`.
- Opening a `.js`, `.css`, `.json` or similar file directly in a browser
  tab redirects to `index.html` (service worker, plus `.htaccess` on
  Apache hosts for first-time visitors).

This deters casual copying; it is not real protection. Anything a browser
runs can still be fetched with other tools. While you work on the code,
set `GUARD_DEVTOOLS = false` at the top of `js/guard.js`.

## Changelog

### 1.4.0
New features
- **Responses screen** for every form (button on each form card, in the builder and on the fill page): a table of all responses with search as you type, a Summary tab (answer counts and percentages, lowest/highest/average/total for numbers, earliest/latest dates, GPS/photo/signature counts, most common text answers), and per-response delete.
- Responses filled in on the organiser's device are kept automatically. A per-form switch in the builder ("Keep a copy of each response on this device") turns this off for sensitive forms.
- **Every PDF carries its answers** as embedded data (XMP metadata, `DFRESP1` marker). **Add PDFs or files** reads any number of response PDFs at once and adds them to the table; duplicates are skipped. PDFs from a different form are flagged before they are added.
- **Export**: spreadsheet (`.csv`, UTF-8, opens in Excel; GPS split into latitude/longitude/accuracy), response data (`.json`, to merge on another device with Add PDFs or files) and GPS locations (`.geojson`, for GeoViewer, DrawGeo or QGIS).
- Each form has a lasting key that travels with share links, `.json` exports and offline HTML, so responses always match up with their form, even after the form is edited. Questions removed in a later edit stay in the table as "earlier version" columns.
- **Signature question type**: sign with a finger, stylus or mouse; Clear button; can be required. The signature is cropped and placed in the PDF above a line with the signing date.

Fixes
- **Bengali / Assamese text in PDFs is now fully shaped** (conjuncts, vowel signs, reph, ৰ ৱ). Lines in Indic scripts are drawn by the browser's own text engine with the bundled Noto Sans Bengali font and placed in the PDF as sharp images, with an invisible text layer underneath so the PDF stays searchable and copyable. Latin-only lines are unchanged.
- CSV exports guard against spreadsheet formula injection.


### 1.3.1
Design and other changes
- The app now fits the window (or the iframe it is embedded in): the frame header, app bar and credit line stay in place and the content scrolls inside the frame.
- On wide screens the form builder's question panel and question list each scroll on their own, so long forms never push the panel out of reach.
- Menus, the share dialog and the right-click menu scroll when the window is short. The offline HTML form scrolls inside its frame too.
- In very short windows (under 460px tall, e.g. a phone on its side) the whole page scrolls instead, so there is always room to work.

### 1.3.0
New features
- Light "Stone" and Dark "Graphite" themes with a switch in the app bar; Light is the default. `?theme=` override.
- Custom right-click menu (Copy / Paste) in text boxes; right-click disabled elsewhere.
- Developer-tools and view-source attempts return to `index.html`; code files can't be opened directly in a tab.

Design and other changes
- Every screen (and the offline HTML) sits in the BhoomiTech frame with the running version and credit line.
- Grooves, wells and plates instead of borders; muga-gold accent; corners 4px at most.
- Bundled Onest typeface (no font requests to other sites).
- Inline line icons replace text arrows and symbols; labels in sentence case.
- The app no longer exposes `window.DynaformApp` to the console.

## Releasing an update

Edit files, change `APP_VERSION` in `js/app.js`, then change
`CACHE_VERSION` in `sw.js` to match (e.g. `dynaform-v1.4.0`).
Installed copies see an "Update now" banner the next time they open online.

## Things to know

- Forms and responses live in one browser on one device. Clearing site
  data deletes them, so use **Back up all** and **Responses › Export**
  regularly. The app asks the browser for persistent storage.
- Bengali-script lines in the PDF are images with an invisible text layer.
  They print and zoom cleanly; text selection on those lines may not line
  up exactly with the glyphs. Very old browsers without `FontFace` fall
  back to the previous (unshaped) text.
- Responses can only be read back from PDFs made by DynaForm 1.4.0 or
  later. PDFs from older versions, or PDFs that were printed and scanned,
  don't carry the data.
- Very long forms produce long share links; for those, send the `.json`
  export or the offline HTML file instead.

License: GPLv2 or later, as the original plugin. jsPDF is MIT; Noto Sans
Bengali and Onest are SIL OFL 1.1 (`fonts/onest/OFL.txt`).
