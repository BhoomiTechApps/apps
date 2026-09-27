# Media Map (standalone app)

A Progressive Web App for pinning photos, video, audio, PDF documents, links and notes to places on a map, on top of your own GeoJSON map layers. It needs no login and has no server-side part: everything is saved on the device.

## Where the data goes

On first launch the app asks where to save. There are two options.

**A folder you choose.** This works in Chrome and Edge on Windows, macOS, Linux and ChromeOS. The folder looks like this:

```
Media Map/
├── mediamap.json          ← the index: every place, with links to its files and URLs
├── mediamap.backup.json   ← the previous version of the index (written on each save)
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
- If you pick a folder that already holds a `mediamap.json`, the app opens that map.
- You can copy, sync (Drive, Dropbox, OneDrive) or back up the folder like any other. If you edit `mediamap.json` by hand while the app is open, the app picks up the change when you switch back to it.

**Inside the app.** This is the browser's private storage, and it's used on Android, iPhone/iPad and Firefox, where web apps can't write to a folder you pick. The layout is identical, but the folder is hidden. **Settings → Export backup** produces a `.zip` of the same folder. **Settings → Move to a folder** copies everything out on browsers that support folders.

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
        "colorBy": "landuse", "label": "name", "useFileStyle": true
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
- `layers` lists the map layers from top to bottom. `colorBy` and `label` name a GeoJSON property, or are `""`. `dash` is `solid`, `dashed` or `dotted`.
- Files from earlier versions (formats 1 to 3) open without changes and are saved as version 4 from then on. An older copy of the app refuses to open version 3 data rather than silently dropping fields.
- Unknown fields are dropped on load. Entries with invalid coordinates are skipped.

## Features

- **Map:** Leaflet with grouped pins, colour-coded by kind (photo, video, audio, note). The tile server is configurable. Any basemap address is accepted: XYZ (`{z}/{x}/{y}`, `{s}`), TMS (`{-y}`), Bing-style quadkeys (`{q}`), WMTS names (`{TileMatrix}/{TileRow}/{TileCol}`), bounding-box templates (`{bbox-epsg-3857}`), plain WMS or WMTS service addresses, and ArcGIS MapServer links. `http://` and scheme-less addresses are allowed too, and unknown placeholders are left as they are.
- **Adding places:** tap the map, search for a place (OpenStreetMap Nominatim), use your GPS location, or let a geotagged photo place itself.
- **Typed coordinates:** enter a location as decimal degrees (`26.1445, 91.7362`) or degrees/minutes/seconds (`26°08′40″N 91°44′10″E`). Hemisphere letters are understood, and longitude-first pairs are detected and swapped.
- **Media:** attach a photo, video, audio file or PDF from the device, which is copied into `media/`. Large photos are shrunk to 2560 px unless you turn that off.
- **PDF documents:** the place shows a preview of the first page plus the page count. **Open document** opens a full-screen reader with page navigation, zoom and download. PDF links on the web get the same preview when the website allows it. The reader is bundled PDF.js, so it works offline.
- **Text entries:** a place can be just a name and description. Each place also has a notes log of dated entries you can add, edit and delete without opening the edit form. Notes are searchable from the places list.
- **Map layers (GeoJSON):** add layers from a file, from a web address, or through Import. Each layer is saved in `layers/` and drawn under your places. Per layer you can set:
  - line colour, width, opacity and dash style, fill colour and opacity, and point size;
  - **colour by data**, using a property: text values get distinct colours (12 most common), numbers are split into 5 ranges;
  - **labels** from a property, for layers with up to 2,000 features;
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
- **Class packs:** a teacher sets up forms, map layers and the map view, then uses **Settings → Class pack → Create a class pack**. The pack gets a title and instructions, and can optionally include sample places. Students import it: they get the forms and layers, are offered the pack's map, and see the instructions (which stay available in Settings). Students later send back **Export backup**; the teacher imports each one to combine everyone's work, and the list can be searched by student name.
- **Save an area before fieldwork:** Settings → Offline map. Zoom to the study area, choose the level of detail (the tile count and size are shown), and save. Saved areas are kept separately from the automatic cache and never trimmed, so they're there when you reach the site with no signal. With the free OpenStreetMap map, only small areas (up to 300 tiles) can be saved, downloaded slowly, as its usage policy asks. With your own tile server, areas up to 20,000 tiles can be saved.
- **Browsing:** a searchable list of places, and edit and delete. Deleting a place removes its file; replacing a file removes the old one.
- **Backups:** export as `.zip` and import from a backup `.zip` or a `mediamap.json`. Backups include layer files. Imports merge places and layers by ID and keep the newer copy of each.
- **Moving from the plugin:** the JSON export from the Media Map WordPress plugin can be imported directly. Rejected submissions are skipped.
- **Offline:** works fully offline after the first visit. Map areas you've viewed are cached, up to a tile limit you can set.
- **Sharing into the app:** once installed on Android, other apps can "Share → Media Map" a link, and it opens the add form.
- **Updates:** you get an update prompt when a new version is deployed.
- **Settings → Check files:** reports files that are missing from the folder and unused files in `media/`, `layers/` and `forms/`, which you can delete from there.

## Hosting

A PWA has to be served over **HTTPS**; `http://localhost` also works for testing. Upload the contents of this folder to any static web host, either at the root or in a sub-folder. All paths are relative, so no configuration is needed. Suitable hosts include GitHub Pages, Netlify, Cloudflare Pages, or a folder on your existing web server (for example `https://bhoomitechfoundation.org/map-app/`).

To test locally:

```
cd mediamap-pwa
python3 -m http.server 8080
# open http://localhost:8080
```

Once it's online, open the address in a browser and install it:

- **Chrome/Edge:** use the install icon in the address bar, or **Settings → Install app** inside Media Map.
- **Android:** use the "Install app" prompt.
- **iPhone/iPad:** Share → Add to Home Screen.

### Releasing an update

Change `VERSION` in `sw.js` whenever any file changes. Installed copies download the new version in the background and show **Update now**. If you add new files, add them to the `SHELL` list in `sw.js`.

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
- **Place search and automatic place names:** `nominatim.openstreetmap.org`, limited to one request per second.
- **Embedded players, linked images and linked PDFs:** only when you open a place that has a link.
- **Layers added from a web address:** downloaded once, then kept in `layers/`.

## Files

```
index.html               app shell
manifest.webmanifest     install metadata, icons, share target
sw.js                    service worker (offline shell + map tile cache)
js/basemap.js            basemap URL handling (XYZ, TMS, quadkey, WMS, WMTS, ArcGIS)
css/app.css
js/app.js                UI, map, forms, import/export
js/store.js              folder / app storage, mediamap.json read-write
js/media.js              media-type detection, embeds, EXIF GPS, photo resizing
js/coords.js             typed-coordinate parser (decimal, DMS, hemisphere letters)
js/pdf.js                PDF preview and full-screen reader
js/layers.js             GeoJSON layers: validation, styling, legend, layer panel
js/forms.js              forms library, sandboxed form window, output capture
js/reports.js            printable map and list, CSV and GeoJSON export
js/offline.js            saving map areas for offline fieldwork
js/zip.js                backup .zip writer/reader (no dependencies)
vendor/                  Leaflet 1.9.4, Leaflet.markercluster 1.5.3, PDF.js 4.10 (legacy build)
fonts/                   Atkinson Hyperlegible (OFL)
icons/
```
