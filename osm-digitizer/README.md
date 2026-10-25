# OSM Digitizer 1.2.0 (PWA)

Pick an area, choose layers, and pull vector data from OpenStreetMap, or trace roads, rivers and areas from a map image. Export it as GeoJSON, KML, Shapefile (UTF-8, with .prj) or DXF (UTM metres, one CAD layer per feature type). Every extraction is saved on the device, so you can reopen and export it later without a connection.

## Put it online (needed to install on a phone)

An installable web app has to be served over HTTPS. Any static host works; the two quickest:

**Netlify Drop (no account setup, about 1 minute)**
1. Unzip this folder.
2. Open https://app.netlify.com/drop and drag the `osm-digitizer` folder onto the page.
3. Open the link it gives you on your phone in Chrome, then tap **Install** in the app header (or the browser menu → *Install app* / *Add to Home screen*).

**GitHub Pages**
1. Create a repository and upload the contents of this folder to it.
2. Settings → Pages → Deploy from branch → `main`, root folder.
3. Open `https://<your-username>.github.io/<repo>/`.

## Run it on your computer

```
cd osm-digitizer
python -m http.server 8080
```
Open http://localhost:8080. Installing and offline mode work on localhost too. Opening `index.html` directly from the file manager will not work, because browsers block service workers and some requests on `file://` pages.

## Using it

1. **Area**: search a place (uses its OSM boundary when one exists), draw a box with two taps, or use the current map view. Areas over 400 sq km ask for confirmation; over 3,000 sq km are refused, since the free Overpass servers time out on them.
2. **Layers**: protected-area boundary, buildings, roads and tracks, railways, rivers and streams, water bodies and wetlands, land use and cover, village and place names.
3. **Extract**: tries three public Overpass servers in turn if one is busy. Results show on the map; tap any feature for its tags, length or area.
4. **Export**:
   - GeoJSON: one file, `layer` attribute on every feature, WGS84.
   - KML: one folder per layer, colour-styled, opens in Google Earth.
   - Shapefile: ZIP with `<layer>_line`, `<layer>_polygon`, `<layer>_point` sets, WGS84, UTF-8 (`.cpg`), so Assamese and Bengali names survive.
   - DXF: R12 format in UTM metres (zone picked automatically, e.g. 46N for Assam), layers ROADS, WATER, etc. Place names are written as TEXT.
   On phones, exports open the share sheet (Save to Files, Drive, WhatsApp); on desktop they download.

## Tracing from an image

Choose **Image** in the OSM / Image switch at the top of the panel.

1. **Image**: a PNG or JPG, such as a screenshot, a scanned toposheet or a photo of a printed map. Images larger than 5,000 px on a side are scaled down for processing. Convert PDFs and HEIC photos to PNG or JPG first.
2. **Place it on the map**: tap **Add a point**, tap a sharp spot on the image (road junction, bridge, building corner), then tap the same spot on the map or type its latitude and longitude. Use the Map / Image switch at the top left of the map to move between them.
   - 2 points fix scale and rotation, which is enough for a screenshot of a web map.
   - 3 or more points also correct stretch and skew, which scans and photos need.
   - From 4 points on, each point shows how far off it is, and the app flags a point that doesn't fit.
3. **Colours to trace**: tap **Pick a colour**, then tap the middle of a road, river or lake on the image. Matching pixels are highlighted. Adjust **Match** until they cover the features and little else. Use **+** to add another shade of the same feature (a road and its outline, say). For each colour choose the feature type and whether to trace **Centre-lines** (roads, rivers) or **Outlines** (lakes, buildings, fields). Colours are remembered for your next image.
4. **Trace**: the results appear on the map with the same summary, saving and exports as OpenStreetMap data. Tap any stray piece and choose **Remove from results** before exporting.

**Fine-tune** settings: bridge gaps (closes breaks under labels), ignore specks, trim side spurs, drop label outlines, and straighten lines.

Tips: images with labels hidden trace best. Features of the same colour come out together (a river and a lake drawn in the same blue, for example), so remove what you don't need afterwards. Accuracy depends on the image resolution and your points; the panel shows metres per pixel.

## Notes

- Data © OpenStreetMap contributors, ODbL. Credit OSM on maps or reports you make from it.
- In box mode, features are clipped to the box. In boundary mode, features crossing the boundary are kept whole.
- Map tiles you view are cached (up to about 4,000) for offline use. Clear them under Map view in the panel.
- Please keep requests reasonable: the Overpass and Nominatim servers are free, shared services.

## Theme, basemap and embedding

- Light ("Stone") is the default theme. The sun/moon button switches to Dark ("Graphite"); the choice is remembered on the device.
- Start options in the address: `index.html?theme=dark` or `?basemap=satellite`. A choice the user makes in the app overrides these on that device.
- The app fills whatever window or frame it is in, so it can be embedded with an `<iframe>` of any size (the separate *OSM Digitizer Embed* WordPress plugin does this with a shortcode). Give the iframe `allow="fullscreen; clipboard-read; clipboard-write"` so the full-screen button and the Paste menu work. If your host sends `X-Frame-Options` or a `frame-ancestors` policy, allow the site that embeds it.

## Protection

- Right-click is off; in text fields a small menu offers only Copy and Paste.
- The app code is one minified file. Developer-tool shortcuts, view-source, save-page, an open developer-tools window, or opening a `.js`/`.css` file directly all send the browser back to `index.html` (the direct-file redirect uses the service worker, and on Apache also the included `.htaccess`). This deters casual inspection; it cannot stop a determined person.

## Files

- `index.html`: layout (frame, map, side panel)
- `app.min.js`, `app.min.css`: the app, bundled and minified (editable sources are kept separately)
- `trace.js`, `trace-worker.js`: the image tracer, run off the main thread
- `sw.js`: offline caching
- `.htaccess`: Apache only; sends direct visits to code files back to the app
- `assets/vendor/onest/`: Onest typeface (SIL OFL)
- `lib/`: Leaflet 1.9.4, Turf 6.5.0, proj4 2.9.0, osmtogeojson 3.0.0-beta.5, JSZip 3.10.1 (bundled so the app works offline)

## Changelog

### 1.2.0
**New features**
- Two matte themes, Light "Stone" (default) and Dark "Graphite", with a theme button; the choice is remembered on the device. `?theme=` and `?basemap=` start options.
- BhoomiTech frame with the name and running version at the top and the credit line underneath.
- Fits any window or iframe size, from 320 px phones to wide desktops and short embedded boxes; full-screen button.
- Panel grouped into accordions (collapsed by default, open state remembered), each with a short status. Extract and Trace sit in an action bar that is always visible; Results open by themselves after an extraction or trace.
- Basemap picker, Zoom to area and Zoom to results moved into a Map view section of the panel.
- Right-click turned off; Copy and Paste menu in text fields. Code bundled, minified and guarded (see Protection).

**Bug fixes**
- The first image loaded for tracing was placed off-centre, so taps on it missed.
- The map now resizes when its frame changes size, not only when the window does.

**Design and other changes**
- Onest typeface bundled; the four previous font families removed. Line icons on every button; the data-source dropdown is now a two-way switch. Results and Export merged. Debug logging removed.
