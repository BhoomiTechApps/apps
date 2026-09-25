# DynaForm PDF — Progressive Web App (v1.2.0)

The DynaForm PDF WordPress plugin (v1.1.1), rebuilt as an installable,
fully offline web app. No WordPress, PHP, database or login is needed.

Like the plugin, **responses are never uploaded or stored anywhere**: on
Submit the respondent's browser validates the answers, builds the PDF
(text, GPS, photos, Bengali-script text via the bundled Noto Sans Bengali
font) and saves it to their device.

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

## Releasing an update

Edit files, then change `CACHE_VERSION` in `sw.js` (e.g. `dynaform-v1.2.1`).
Installed copies see an "Update now" banner the next time they open online.

## Things to know

- Forms live in one browser on one device. Clearing site data deletes them,
  so use **Back up all** regularly. The app asks the browser for persistent
  storage to reduce the risk of eviction.
- Bengali-script text in the PDF is not fully shaped (jsPDF limitation,
  same as the plugin): pre-base vowel signs like ি can appear after the
  consonant. The on-screen form is unaffected.
- Very long forms produce long share links; for those, send the `.json`
  export or the offline HTML file instead.

License: GPLv2 or later, as the original plugin. jsPDF is MIT; Noto Sans
Bengali is SIL OFL 1.1.
