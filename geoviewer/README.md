# GeoViewer PWA (v3.5.0)

View, style and edit GeoJSON and KML maps in the browser. Works offline. No server, no account.
Developed by Shankar Sinha for BhoomiTech Heritage and Development Foundation under CDEP.

## Changelog 3.5.0

**Google Street View in Feature info**

- Street View addresses are shown as a live viewer when you click a feature. They are found in the feature's
  *description* (links, addresses written as plain text, and Google "Embed a map" `<iframe>`s) and in property
  values, including fields holding several addresses such as Google My Maps' `gx_media_links`. When a feature has a
  description, Street View addresses kept in its other properties appear under a *Street View* heading.
- Understood: links shared from Google Maps (`/maps/@lat,lng,3a,…/data=…!1s<panorama>…`), Maps URLs
  (`/maps/@?api=1&map_action=pano&viewpoint=…`), older `?layer=c&cbll=…&cbp=…` links, Street View "Embed a map"
  addresses and Maps Embed API addresses, on any Google country domain. Short `maps.app.goo.gl` links can't be
  read in the browser; in a field or link named for Street View they get an *Open in Google Maps* button.
- Each viewer has *Full screen* and *Google Maps* buttons. The view keeps the heading and tilt of the original link.
- Settings › Google Street View: load viewers straight away (default) or only when you press *Show Street View*;
  and an optional Maps Embed API key. Links with a panorama ID never need a key. Links with only a location use
  Google's older keyless viewer, or the Embed API when a key is set.
- Content Security Policy: `frame-src` now allows `https://www.google.com` and `https://maps.google.com` only
  (was `'none'`). Other embedded pages in descriptions stay blocked.

| File | Change |
|---|---|
| `assets/js/streetview.js` | New: reads Street View addresses and builds the viewers |
| `assets/js/geoviewer.js` | Feature info calls `GVStreetView.enhance()` after drawing; version 3.5.0 |
| `assets/css/geoviewer.css` | Street View styles (appended at the end) |
| `index.html` | CSP `frame-src`, new script, Street View settings, version 3.5.0 |
| `sw.js` | Version 3.5.0; caches `streetview.js` |

## Changelog 3.4.0

**New features**

- **Page margin in Print.** The print preview has a *Margin (mm)* box (0 to 40, default 10). The preview page is the
  full sheet of paper and shows the margin exactly as it will print; the setting is remembered on the device. With
  a 0 mm margin, some printers cut off the edges, as most cannot print right to the edge of the paper.
- **Search the attribute table as you type.** A search box above the table filters the rows instantly while you
  type (in the browser, so it also works offline). Every word you type must appear somewhere in the row, so
  `sacred 12.5` finds rows containing both. Choose a column to search only that column. Matching cells are
  highlighted, the count shows "2 of 40 rows", and **Show on map** (or Enter in the box) zooms to the matching
  features and highlights them. Esc clears the search. Editing a cell re-checks the filter, and the search is kept
  when you switch layers or the table is redrawn.
- **KML import.** Load Google Earth `.kml` files with the Load button, by dropping them on the map, or through
  "Open with GeoViewer" once the app is installed. Placemarks become a normal layer (points, lines, polygons and
  their ExtendedData fields). Saving a KML layer writes a new `.geojson` file; the original `.kml` is never overwritten.
- **Colour by data.** Each layer's style panel has a *Colour by data* section: pick an attribute and show it as
  categories (up to 12 colours, the rest grouped as "Other") or as 5 number ranges (equal intervals or equal counts,
  with six colour ramps). Features with no value are shown in light grey. The setting is saved in projects.
- **Legend.** A legend on the map (bottom right, can be folded) lists the visible layers and their colour classes.
- **Area units.** Settings › Area unit: automatic (m², ha, km²), m², hectares, acres, km², or bigha-katha-lessa
  (Assam: 1 bigha = 5 katha = 100 lessa = 14,400 sq ft). The other units are always shown alongside. Saved area
  GeoJSON includes `area_m2`, `area_ha`, `area_acres`, `area_bigha` and `area_assam`.
- **Area of features.** Clicking a polygon or line now shows its area and perimeter, or its length, in Feature info.
- **Scale bar** on the map (metric).
- **Print / Save as PDF** (header › Print). A preview page with title, subtitle, date, map, north arrow, scale bar,
  legend and credits; A4, A3 or Letter, landscape or portrait. Pan and zoom the map in the preview, then print or
  choose "Save as PDF" as the printer.
- **Offline map areas** (header › Offline). Save the basemap for the area on screen, choosing the level of detail,
  before going into the field. Saved areas are listed with Show and Delete. Up to 300 tiles per area for
  OpenStreetMap (downloaded slowly, as its usage policy asks) and up to 3,000 for Esri and Carto. Google and
  CyclOSM maps can't be saved. The service worker downloads and stores the tiles (cache `gv-area-<id>`); the page
  itself never reads caches, in line with the code-access guard.
- **Compare imagery** (header › Compare). A swipe divider shows two imagery sources side by side, with your layers
  on top:
  - *Sentinel-2 cloudless* yearly mosaics by EOX, 2016–2025, 10 m (2016 CC BY 4.0; later years CC BY-NC-SA 4.0).
  - *Esri World Imagery Wayback*, every earlier release of Esri's detailed imagery since 2014. "Only dates that
    changed here" lists just the releases whose imagery changed at the map centre (Esri's tilemap method, as in
    `@esri/wayback-core`), and picks the oldest and newest for you.
  - Any basemap.
  Drag the round handle (or use the arrow keys); × stops comparing. Credits appear on the map and in printouts.
  Comparison needs an internet connection.

**Design and other changes**

- Routing is marked as optional and online only; the Route section explains that points are sent to the public
  OSRM service.
- OpenStreetMap remains the default basemap. Google basemaps stay available and can be switched off in Settings.
- The Load button and messages mention KML.

## Files added or changed in 3.4.0

| File | Change |
|---|---|
| `index.html` | New header buttons (Print, Offline, Compare), dialogs, area-unit setting, KML in the file picker |
| `assets/js/geoviewer.js` | All features above (minified build) |
| `assets/css/geoviewer.css` | Styles for the new features and for printing (appended at the end) |
| `assets/vendor/togeojson.umd.js` | KML reader, @tmcw/togeojson 7.1.3 (BSD-2-Clause, licence in `assets/vendor/LICENSE-togeojson.txt`) |
| `sw.js` | Version 3.4.0; looks up tiles in saved areas; downloads offline areas on request |
| `manifest.webmanifest` | Opens `.kml` files as well as `.geojson` |
| `.htaccess` | Serves `.kml` with its MIME type |

## Releasing an update

Change `VERSION` in `sw.js`, the `?v=` numbers and the version label in `index.html`, and the
`data-gv-version` value in the script. Installed copies show "A new version of GeoViewer is ready".

## Data sources and terms

- Basemaps: OpenStreetMap, CARTO, Esri, optional Google (unofficial addresses; use in line with Google's terms).
- Sentinel-2 cloudless © EOX IT Services GmbH, contains modified Copernicus Sentinel data. https://s2maps.eu
- World Imagery Wayback © Esri, Maxar, Earthstar Geographics. Subject to Esri's terms of use.
- Street View: Google, shown through Google's embed viewers; use in line with Google's terms.
- Place search: OpenStreetMap Nominatim. Routing: public OSRM service.
