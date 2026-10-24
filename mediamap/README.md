# Media Map (standalone app)

A Progressive Web App for pinning photos, video, audio, PDF documents, links and notes to places on a map, on top of your own GeoJSON map layers. It needs no login and has no server-side part: everything is saved on the device.

## Look and feel

Media Map uses the BhoomiTech frame and matte themes shared with the foundation's other apps: the app sits inside a frame with its name and running version at the top right and the credit line underneath.

- **Interface theme:** Light ("Stone", warm grey paper) is the default; Dark ("Graphite") is in **Settings → Appearance**. The choice is saved on the device and applies to every map. Map tiles are never recoloured.
- **One visit in a theme:** add `?theme=dark` or `?theme=light` to the app's address (for example in a link you share). It doesn't change the saved choice.
- **Settings** is an accordion: each section shows a short summary, and the sections you leave open stay open next time.
- **Right-click** is off everywhere in the app. In a text field a small menu offers only **Copy** and **Paste** (also with the Menu key or Shift+F10). The same applies inside the form window. On phones and tablets, text fields keep the system's own long-press toolbar, which a web page can't change.

## Where the data goes

On first launch the app asks where to save. There are two options.

**A folder you choose.** This works in Chrome and Edge on Windows, macOS, Linux and ChromeOS. The folder looks like this:

```
Media Map/
├── mediamap.json          ← the index: every place, with links to its files and URLs
├── mediamap.backup.json   ← the previous version of the index (written on each save)
├── settings.json          ← this map's own settings: basemap, pin grouping, photo size, last view
├── media/
│   ├── 2026-09-27_temple-gate.jpg
│   ├── 2026-09-27_river-sounds.m4a
│   └── 2026-09-27_survey-report.pdf
├── layers/
│   └── 2026-09-27_ward-boundaries.geojson
└── forms/
    └── 2026-09-28_site-survey.html
```

- If you pick an empty folder, the data goes straight into it.
- If you pick a folder that already contains other files, the app creates a `Media Map` sub-folder inside it.
- If you pick a folder that already holds a `mediamap.json` or `settings.json`, the app opens that map, with its own basemap and view.
- You can copy, sync (Drive, Dropbox, OneDrive) or back up the folder like any other. If you edit `mediamap.json` by hand while the app is open, the app picks up the change when you switch back to it.

**Inside the app.** This is the browser's private storage, and it's used on Android, iPhone/iPad and Firefox, where web apps can't write to a folder you pick. The layout is identical, but the folder is hidden. **Settings → Export backup** produces a `.zip` of the same folder. **Settings → Move to a folder** copies everything out on browsers that support folders.

## `settings.json` format

Every data folder has its own `settings.json`, so each map keeps its own background map and opens where you left it. Switching folders switches the settings with it.

```json
{
  "format": "media-map-settings",
  "version": 1,
  "updated": "2026-09-30T10:15:00.000Z",
  "basemap": {
    "tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    "attribution": "&copy; OpenStreetMap contributors",
    "maxZoom": 19
  },
  "cluster": true,
  "shrinkPhotos": true,
  "view": { "lat": 26.1445, "lng": 91.7362, "zoom": 14 }
}
```

- `basemap` accepts any address the Map settings accept (see Features below). `cluster` is **Group nearby pins**; `shrinkPhotos` is **Shrink large photos**; `view` is the last map position, or `null`.
- The file is created the first time a folder is opened. A new folder, or one made by version 1.4 or earlier, starts from the settings last used on the device.
- You can edit it by hand. Missing or invalid fields keep their current value; a file that can't be read is reported and left alone until you next change a setting. Changes made while the app is open are picked up when you switch back to it (the map doesn't move, though; the new `view` is used next time the folder is opened).
- **Your name** and the offline tile limit are not in this file. They belong to the person and the device, so they apply to every folder.
- **Export backup** includes `settings.json`. Importing a backup uses its settings only when the current map is empty (restoring); combining other people's backups never changes your basemap. A `settings.json` file on its own can also be imported, which asks first.

## `mediamap.json` format

```json
{
  "format": "media-map",
  "version": 4,
  "updated": "2026-09-27T10:15:00.000Z",
  "entries": [
    {
      "id": "a1b2c3d4e5f6",
      "lat": 26.1445,
      "lng": 91.7362,
      "place": "Temple gate",
      "description": "Evening prayers.",
      "type": "image",
      "file": {
        "path": "media/2026-09-27_temple-gate.jpg",
        "name": "IMG_2031.jpg",
        "mime": "image/jpeg",
        "size": 834221
      },
      "url": "https://www.youtube.com/watch?v=…",
      "author": "Ria Das (Class 9B)",
      "attachments": [
        { "id": "a4b5c6", "path": "media/2026-09-28_site_survey-1727500000000.pdf", "name": "site_survey-1727500000000.pdf",
          "mime": "application/pdf", "size": 184223, "form": { "id": "f1g2h3", "name": "Site survey" },
          "created": "2026-09-28T09:10:00.000Z" }
      ],
      "notes": [
        { "id": "n1x2y3", "text": "Gate closed for repairs.", "created": "2026-09-28T09:00:00.000Z", "updated": "2026-09-28T09:00:00.000Z" }
      ],
      "created": "2026-09-27T10:12:44.000Z",
      "updated": "2026-09-28T09:00:00.000Z"
    }
  ],
  "layers": [
    {
      "id": "l7k8m9",
      "name": "Ward boundaries",
      "file": "layers/2026-09-27_ward-boundaries.geojson",
      "visible": true,
      "style": {
        "stroke": "#1F6F8B", "weight": 2, "opacity": 0.9, "dash": "solid",
        "fill": "#1F6F8B", "fillOpacity": 0.25, "radius": 6,
        "colorBy": "landuse", "label": "name", "useFileStyle": true, "cluster": true
      },
      "features": 42,
      "created": "2026-09-27T11:00:00.000Z",
      "updated": "2026-09-27T11:05:00.000Z"
    }
  ],
  "forms": [
    { "id": "f1g2h3", "name": "Site survey", "file": "forms/2026-09-28_site-survey.html", "prefillLocation": true,
      "created": "2026-09-28T09:00:00.000Z", "updated": "2026-09-28T09:00:00.000Z" }
  ],
  "pack": {
    "title": "Class 9 river survey",
    "instructions": "1. Visit each sample site…",
    "created": "2026-09-27T08:00:00.000Z",
    "map": { "tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "attribution": "…", "maxZoom": 19, "lat": 26.15, "lng": 91.73, "zoom": 15 }
  }
}
```

- `type` is one of `image`, `video`, `audio`, `document`, `text`.
- `file` is `null` when the place has no local file. `path` is always relative to the data folder.
- `url` is an external reference, or `""` if there isn't one. A place can have a file, a URL, both, or just text.
- `notes` is the place's notes log: dated text entries, oldest first.
- `attachments` holds files saved to the place: form responses (with the form they came from in `form`) and files attached by hand, oldest first.
- `forms` lists the HTML forms available to fill in for any place.
- `author` is the name set in **Settings → Your name** when the place was added.
- `pack` is the class pack this data came from (or was shared as), or `null`.
- `layers` lists the map layers from top to bottom. `colorBy` and `label` name a GeoJSON property, or are `""`. `dash` is `solid`, `dashed` or `dotted`. `cluster` (default `true`) groups the layer's points into clusters when zoomed out.
- Files from earlier versions (formats 1 to 3) open without changes and are saved as version 4 from then on. An older copy of the app refuses to open version 3 data rather than silently dropping fields.
- Unknown fields are dropped on load. Entries with invalid coordinates are skipped.

## Features

- **Map:** Leaflet with grouped pins, colour-coded by kind (photo, video, audio, note). The tile server is configurable per data folder (saved in its `settings.json`). Any basemap address is accepted: XYZ (`{z}/{x}/{y}`, `{s}`), TMS (`{-y}`), Bing-style quadkeys (`{q}`), WMTS names (`{TileMatrix}/{TileRow}/{TileCol}`), bounding-box templates (`{bbox-epsg-3857}`), plain WMS or WMTS service addresses, and ArcGIS MapServer links. `http://` and scheme-less addresses are allowed too, and unknown placeholders are left as they are.
- **Adding places:** tap the map, search, use your GPS location, or let a geotagged photo place itself.
- **Search:** the place search in the add/edit form and the search box in the places list look in three places, and always show the results in this order:
  1. **Your places** (the loaded points): name, description, link, file name, notes, attachments and author. Name matches come first.
  2. **Map layers that are switched on:** every property of every feature in the visible GeoJSON layers. Features whose title (the popup title, the label field, or a `name`/`title` property) matches come before matches in other fields. Hidden layers are not searched.
  3. **OpenStreetMap** (Nominatim), from 3 letters and only when online, preferring places near the part of the map on screen.

  In the form, choosing a result moves the pin there and names the place after it; for a line or an area the pin goes to its middle. In the places list, a layer result zooms to the feature, outlines it briefly and opens its popup, and an OpenStreetMap result shows a marker with **Add a place here**. Your places and map layers are searched offline too.
- **Typed coordinates:** enter a location as decimal degrees (`26.1445, 91.7362`) or degrees/minutes/seconds (`26°08′40″N 91°44′10″E`). Hemisphere letters are understood, and longitude-first pairs are detected and swapped.
- **Media:** attach a photo, video, audio file or PDF from the device, which is copied into `media/`. Large photos are shrunk to 2560 px unless you turn that off.
- **PDF documents:** the place shows a preview of the first page plus the page count. **Open document** opens a full-screen reader with page navigation, zoom and download. PDF links on the web get the same preview when the website allows it. The reader is bundled PDF.js, so it works offline.
- **Text entries:** a place can be just a name and description. Each place also has a notes log of dated entries you can add, edit and delete without opening the edit form. Notes are searchable from the places list.
- **Map layers (GeoJSON):** add layers from a file, from a web address, or through Import. Each layer is saved in `layers/` and drawn under your places. Per layer you can set:
  - line colour, width, opacity and dash style, fill colour and opacity, and point size;
  - **colour by data**, using a property: text values get distinct colours (12 most common), numbers are split into 5 ranges;
  - **point clusters** when zoomed out: nearby points merge into a numbered bubble in the layer's colour, and split apart as you zoom in (can be turned off per layer);
  - **labels** from a property. Labels that would overlap each other or a cluster are hidden until you zoom in, on screen and on the printed map. Clustered points are always labelled; lines and areas are labelled for layers with up to 2,000 features;
  - **file colours**, if the file itself has `stroke`, `fill` or `marker-color` properties.

  Changes preview live and Cancel reverts them. Layers can be reordered, hidden or zoomed to, and a legend is shown on the map. Tapping a feature shows its properties. Files that aren't in longitude/latitude (WGS 84) are rejected with an explanation.
- **Links:** YouTube, Vimeo, Spotify and SoundCloud links play inline. Direct image, video and audio links display inline. Any other link is shown as a card.
- **Forms:** add an HTML form that produces its own file, such as the standalone PDF-generating forms. Open a place, choose **Fill in a form**, fill it in and submit. The file the form would have downloaded is saved to that place instead, and is listed under **Forms and attachments** with the form's name and the time. Details:
  - The form can be submitted several times in a row; each response is saved separately.
  - Empty latitude/longitude fields in the form are filled from the place (this can be turned off per form).
  - The form runs in a sandbox, so it can't read your other places or files. It works offline if the form itself is self-contained.
  - **Attach file** adds a PDF or any other file you already have, such as a form filled in outside the app.
  - Forms are managed in **Settings → Forms**.
- **Your name:** set it in Settings and it's saved with every place you add. It appears on the place, in the list (which you can search by name), in printouts and in exports, so combined class work stays attributed.
- **Print or save as PDF:** an A4 landscape page with the map, numbered pins, a key for pin kinds and map layers, and your title and name. It's followed by a numbered table of places with descriptions, notes, file names and coordinates, each of which you can switch on or off. You can include all places, or only those in the part of the map on screen.
- **Spreadsheet and GIS export:** CSV (UTF-8, opens in Excel, Google Sheets and LibreOffice, including Assamese/Bengali text) or GeoJSON (for QGIS and other GIS software). Both include number, place, coordinates, kind, dates, author, description, link, notes and attachment file names.
- **Kiosk:** **Settings → Kiosk → Export for kiosk** makes the `mediamap-kiosk-data` folder that the MediaMap Kiosk app opens in its USB mode (see *Kiosk export* below).
- **Class packs:** a teacher sets up forms, map layers and the map view, then uses **Settings → Class pack → Create a class pack**. The pack gets a title and instructions, and can optionally include sample places. Students import it: they get the forms and layers, are offered the pack's map, and see the instructions (which stay available in Settings). Students later send back **Export backup**; the teacher imports each one to combine everyone's work, and the list can be searched by student name.
- **Save an area before fieldwork:** Settings → Offline map. Zoom to the study area, choose the level of detail (the tile count and size are shown), and save. Saved areas are kept separately from the automatic cache and never trimmed, so they're there when you reach the site with no signal. With the free OpenStreetMap map, only small areas (up to 300 tiles) can be saved, downloaded slowly, as its usage policy asks. With your own tile server, areas up to 20,000 tiles can be saved.
- **Browsing:** a searchable list of places, and edit and delete. Deleting a place removes its file; replacing a file removes the old one.
- **Backups:** export as `.zip` and import from a backup `.zip` or a `mediamap.json`. Backups include layer files. Imports merge places and layers by ID and keep the newer copy of each.
- **Moving from the plugin:** the JSON export from the Media Map WordPress plugin can be imported directly. Rejected submissions are skipped.
- **Offline:** works fully offline after the first visit. Map areas you've viewed are cached, up to a tile limit you can set.
- **Sharing into the app:** once installed on Android, other apps can "Share → Media Map" a link, and it opens the add form.
- **Updates:** you get an update prompt when a new version is deployed.
- **Settings → Check files:** reports files that are missing from the folder and unused files in `media/`, `layers/` and `forms/`, which you can delete from there.

## Kiosk export

The MediaMap Kiosk app shows a read-only, touch-screen map from a folder on a USB drive, with no internet needed for the data. **Settings → Kiosk → Export for kiosk** writes that folder from the map that's open:

- **Save to a USB drive or folder…** (Chrome and Edge on a computer): pick the USB drive, and a `mediamap-kiosk-data` folder is made on it. Picking a folder that is already called `mediamap-kiosk-data` writes into it.
- **Download as .zip** (every browser): unzip it onto the USB drive so that the `mediamap-kiosk-data` folder is on it.

On the kiosk, choose **USB Drive → Select folder…** and pick `mediamap-kiosk-data`.

```
mediamap-kiosk-data/
├── settings.json                        ← the kiosk's settings and its list of layers
├── places.json                          ← the places, as rows of the WordPress plugin's JSON export
├── 2026-09-27_ward-boundaries.geojson   ← each chosen map layer
├── 2026-09-27_temple-gate.jpg           ← photos, video, audio and PDFs of the places
└── 2026-09-27_survey-report.pdf
```

- **What's included:** the places (as the top layer, named after the class pack or "Places" unless you name it) and the map layers you tick (the visible ones are ticked to start with). You can add each place's notes and its author to its description. The kiosk options are the idle time (after it, the open place closes and the whole map shows again) and keeping visitors within the area of the data.
- **Files** are copied to the top of the folder, because the kiosk can't open sub-folders, under names that are unique even on drives that ignore upper and lower case.
- **Links** are converted to what the kiosk plays: YouTube, Vimeo, Spotify, SoundCloud, Dailymotion, Twitch, TikTok, Streamable and Loom links, direct image, video, audio and PDF links, and Street View as a Google embed address. Street View links with only a location (no panorama) can't be shown on the kiosk unless a Maps Embed API key is set; they, and other links, are written into the description as text.
- **Map layers** keep their line colour and width, fill colour and opacity, and point grouping. Points in a layer get a title, description and media for the kiosk's info card from the layer's popup settings: the title field, the visible fields as "field: value" lines, and the first photo, video, audio or Street View link. Properties called `place_name`, `description` or `media_url` that a file already has are kept.
- **Not carried over:** the background map (the kiosk uses its own), colour by data, dashed lines, labels, the file's own colours, forms and attached files.
- **Exporting again** to the same folder replaces the files, and removes the files the previous Media Map export wrote that are no longer needed; other files in the folder are left alone. `settings.json` lists the files it wrote (`exportedFiles`) for this.
- `places.json` can be imported back into Media Map like any WordPress plugin export (without its local files).

`settings.json` (the kiosk ignores `generator` and `exportedFiles`):

```json
{
  "backupFormatVersion": 1,
  "exportedAt": "2026-10-20T10:15:00.000Z",
  "generator": "Media Map 1.9.0",
  "kiosk": { "idle_time_seconds": 90, "lock_bounds_to_data": false },
  "layers": [
    { "file": "2026-09-27_ward-boundaries.geojson", "name": "Ward boundaries", "type": "shape", "enabled": true,
      "cluster": true, "featureCount": 42, "order": 0,
      "shapeStyle": { "fillColor": "#1F6F8B", "fillOpacity": 0.25, "lineColor": "#1F6F8B", "lineWeight": 2,
                      "label": "", "labelColor": "#1e293b", "labelSize": 14 } },
    { "file": "places.json", "name": "Class 9 river survey", "type": "point", "enabled": true, "cluster": true,
      "featureCount": 12, "order": 1, "shapeStyle": { "…": "…" } }
  ],
  "exportedFiles": [ "2026-09-27_ward-boundaries.geojson", "2026-09-27_temple-gate.jpg", "places.json" ]
}
```

## Hosting

A PWA has to be served over **HTTPS**; `http://localhost` also works for testing. Upload the contents of this folder to any static web host, either at the root or in a sub-folder. All paths are relative, so no configuration is needed. Suitable hosts include GitHub Pages, Netlify, Cloudflare Pages, or a folder on your existing web server (for example `https://bhoomitechfoundation.org/map-app/`).

To test locally:

```
cd mediamap-pwa
node serve.js 8080
# open http://localhost:8080
```

(`python3 -m http.server 8080` also works, but it doesn't do the code-file redirect described below.)

Once it's online, open the address in a browser and install it:

- **Chrome/Edge:** use the install icon in the address bar, or **Settings → Install app** inside Media Map.
- **Android:** use the "Install app" prompt.
- **iPhone/iPad:** Share → Add to Home Screen.

### Releasing an update

Change the version in `js/version.js` whenever any file changes. It is the only place it is set: the frame header shows it and `sw.js` names its caches after it. Installed copies download the new version in the background and show **Update now**. If you add new files, add them to the `SHELL` list in `sw.js`.

### Opening code files directly

Opening a `.js`, `.mjs`, `.css` or `.map` address as a page (typing it in the address bar, following a link, or `location = 'js/app.js'` in the browser console) is redirected to `index.html`. The app's own script and style loads, module imports and the PDF worker are not page loads, so they are unaffected. The DevTools and view-source keyboard shortcuts (F12, Ctrl/Cmd+Shift+I/J/C/K, Ctrl/Cmd+U, Cmd+Opt+I/J/C/U) do nothing.

- `sw.js` does the redirect on every visit once the app has been opened once.
- The **server** must do it for the first visit and for reloads that skip the service worker (Shift+Reload). The included `serve.js` does (`node serve.js 8080` for local testing). On your own server, redirect only requests with the header `Sec-Fetch-Mode: navigate`, and send `Vary: Sec-Fetch-Mode` with code files:

```nginx
# nginx, inside server { } (change the path if the app lives in a sub-folder, e.g. /map-app/index.html)
location ~* \.(m?js|css|map)$ {
    add_header Vary "Sec-Fetch-Mode" always;
    if ($http_sec_fetch_mode = "navigate") { return 302 /index.html; }
}
```

```apache
# Apache: .htaccess in the app folder (change the path if the app lives in a sub-folder)
RewriteEngine On
RewriteCond %{HTTP:Sec-Fetch-Mode} =navigate
RewriteRule \.(m?js|css|map)$ /index.html [R=302,L]
Header merge Vary "Sec-Fetch-Mode"
```

Static hosts that can't read request headers (GitHub Pages, for example) only have the service-worker half.

**What this does not do.** A browser has to download the code to run it, so it can always be read: in the DevTools *Sources* and *Network* panels (opened from the browser's own menu), with Shift+right-click in Firefox, by saving the page, or with `curl`. These measures stop casual viewing only. Leaflet, PDF.js and Onest are open source; their licences in `vendor/` must stay available.

## Browser support

| | Folder you choose | Inside the app | Install |
|---|---|---|---|
| Chrome / Edge (desktop) | Yes | Yes | Yes |
| Chrome (Android) | – | Yes | Yes |
| Safari (iOS / iPadOS 16.4+, macOS) | – | Yes | Add to Home Screen / Dock |
| Firefox | – | Yes | Android only |

On browsers without folder support, export a backup regularly. You can also use **Settings → Protect app data from clean-up**; it is granted automatically once the app is installed on most browsers.

## Network use

The app itself never uploads anything. It only contacts outside services in these cases:

- **Map tiles:** `tile.openstreetmap.org` by default. For heavy use, switch to your own or a commercial tile provider, as the OpenStreetMap tile usage policy asks.
- **Place search and automatic place names:** `nominatim.openstreetmap.org`, limited to one request per second. Searches of your places and map layers stay on the device; only the text you type is sent to OpenStreetMap, together with the edges of the map on screen (to prefer nearby results).
- **Embedded players, linked images and linked PDFs:** only when you open a place that has a link.
- **Google Street View:** `www.google.com`, only when you open a place or layer popup with a Street View link.
- **Layers added from a web address:** downloaded once, then kept in `layers/`.

## Files

```
index.html               app shell
manifest.webmanifest     install metadata, icons, share target
sw.js                    service worker (offline shell + map tile cache, code-file redirect)
serve.js                 local test server (node serve.js [port]); not needed on the real server
js/version.js            the app's version, set in this one place
js/guard.js              right-click rules, the Copy / Paste menu, the DevTools-shortcut block (loaded first)
js/icons.js              the interface's line icons
js/basemap.js            basemap URL handling (XYZ, TMS, quadkey, WMS, WMTS, ArcGIS)
css/app.css
js/app.js                UI, map, forms, import/export
js/store.js              folder / app storage, mediamap.json and settings.json read-write
js/media.js              media-type detection, embeds, EXIF GPS, photo resizing
js/streetview.js         Google Street View links: recognising them and building the viewer address
js/coords.js             typed-coordinate parser (decimal, DMS, hemisphere letters)
js/pdf.js                PDF preview and full-screen reader
js/layers.js             GeoJSON layers: validation, styling, legend, layer panel
js/forms.js              forms library, sandboxed form window, output capture
js/reports.js            printable map and list, CSV and GeoJSON export
js/offline.js            saving map areas for offline fieldwork
js/kiosk.js              the mediamap-kiosk-data folder for the MediaMap Kiosk app
js/zip.js                backup .zip writer/reader (no dependencies)
vendor/                  Leaflet 1.9.4, Leaflet.markercluster 1.5.3, PDF.js 4.10 (legacy build),
                         Onest variable font (SIL OFL, vendor/onest/)
icons/
```

## Changelog

### 1.9.0

**Search across your places, map layers and OpenStreetMap**

- The place search in the add/edit form and the places-list search now look, in this order, in: 1. your places,
  2. the GeoJSON map layers that are switched on (all feature properties), 3. OpenStreetMap (Nominatim). Results
  are grouped under those headings.
- Your places and layer features are found as you type, and offline; OpenStreetMap is asked from 3 letters, when
  online, once you pause typing, and prefers places near the map on screen.
- Matches on a name or title are listed before matches elsewhere in the text.
- In the form, a layer result places the pin on the feature (the middle of a line, a point inside an area) and uses
  its title as the place name. In the places list, a layer result zooms to the feature, outlines it and opens its
  popup; an OpenStreetMap result shows a marker with **Add a place here**.

### 1.8.0

**MediaMap Kiosk support**

- **Settings → Kiosk → Export for kiosk** writes the `mediamap-kiosk-data` folder the MediaMap Kiosk app opens in USB
  mode: `settings.json` with the kiosk options and layer list, `places.json` with the places, the chosen GeoJSON
  layers, and the places' photos, video, audio and PDFs, all at the top of the folder. Save it straight to a USB drive
  (Chrome, Edge) or download it as a .zip.
- Links are converted to forms the kiosk plays (YouTube, Vimeo, Spotify, SoundCloud and others, direct media links,
  Street View as a Google embed address). Layer points get a title, description and media from the layer's popup
  settings. Layer colours and point grouping carry over.
- Exporting again into the same folder removes the files the earlier export no longer needs, and nothing else.
- Importing a kiosk folder's `settings.json` now explains what it is instead of saying it isn't a Media Map file.

### 1.7.0

**Google Street View**

- Street View links are shown as a 360° view you can look around in, both on places (the link of a place) and in
  GeoJSON layer popups. Each view has **Full screen** (the lightbox, nearly the whole screen) and **Open in Google
  Maps**, and keeps the heading and tilt of the original link.
- Understood: links copied from Google Maps (`/maps/@lat,lng,3a,…/data=…!1s<panorama>…`), Maps URLs
  (`/maps/@?api=1&map_action=pano&viewpoint=…`), older `?layer=c&cbll=…` links, Street View "Embed a map" addresses
  and Maps Embed API addresses, on any Google country domain.
- In popups, a field can also hold the `<iframe>` embed code copied from Google Maps, or several links in one value
  (for example Google My Maps' `gx_media_links`); each Street View link in it gets its own view.
- When adding a place, the link hint says "Looks like Google Street View", and the place is typed as a photo.
  Short `maps.app.goo.gl` links can't be read in the browser: the hint explains how to get the full address.
- **Settings → Google Street View:** an optional Maps Embed API key, saved on this device only. Links with a
  panorama ID (anything copied from Google Maps) never need it. Links with only a location use Google's older
  keyless viewer, or the Embed API when a key is set.


### 1.6.2

- Added per-GeoJSON-layer popup configuration: show/hide individual attribute fields, choose a title field, and reorder fields by dragging (with up/down controls as a touch-friendly fallback).
- GeoJSON popup URLs can render directly as images, audio or video; supported services such as YouTube, Vimeo, Spotify and SoundCloud use embedded players where the URL can be resolved.
- Popup configuration is stored with the layer in `mediamap.json`, so it travels with exported backups and class packs.

### 1.6.1

**Bug fixes**

- The Places, Layers and Settings panels (and every other side panel or bottom sheet) scroll vertically whenever their content is taller than the panel, including in browsers that didn't shrink the panel body before.
- On phones the Layers panel opens as tall as Settings and a single layer, so more of the list fits before it scrolls.

### 1.6.0

**New features**

- Interface theme in **Settings → Appearance**: Light ("Stone", the default) or Dark ("Graphite"), saved on the device. `?theme=dark|light` in the address opens one visit in a theme.
- Settings is an accordion with a summary on each section; open sections are remembered.
- Text fields have their own right-click menu with only Copy and Paste, in the app and in the form window. Right-click is off everywhere else.
- Opening a `.js` or `.css` file's address directly goes back to the app (service worker and `serve.js`; server rules above). The DevTools and view-source shortcuts do nothing.

**Bug fixes**

- Opening a code file's address used to show the app with its styles missing (the page was served at the wrong address); it now redirects to `index.html`.
- Text fields no longer show the browser's full menu (with Inspect) on right-click.
- The map attribution no longer runs under the edge of an open side panel on wide screens.

**Design and other changes**

- The BhoomiTech frame: app name and version at top right, credit line underneath. The version comes from `js/version.js`, used by the header and the service worker.
- Matte design: grooves instead of borders, recessed fields, raised buttons and cards, corners of 4px at most, muga gold as the only accent. Coordinates and other values use a monospace font with even-width numbers.
- Map controls are separate plates; popups, the legend and the place window follow the theme; map labels are white on dark glass so they read on any basemap. Map tiles and pin colours are unchanged.
- One set of line icons (`js/icons.js`) replaces the filled icons.
- Onest (bundled, works offline) replaces Atkinson Hyperlegible. Nothing is loaded from Google Fonts.
- The PDF reader and the form window use the theme.

