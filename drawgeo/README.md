# DrawGeo PWA (v3.1.0)

Draw lines, areas and points on a map, open and edit GeoJSON files and their attribute tables, record GPS walks, and export them as GeoJSON or KML. No server, no account.
Developed by Shankar Sinha for BhoomiTech Heritage and Development Foundation under CDEP.

## Changelog 3.1.0

**Edit GeoJSON files in place**

- **GeoJSON file** section at the top of the panel: Open file…, Save, Save as…, Close file. A file can also be dropped
  on the map, or, in the installed app, opened from the computer's file manager (DrawGeo registers for .geojson).
- **Save writes back to the same file** in Chrome and Edge (File System Access). The first Save may ask for
  permission. Firefox and Safari can't write to files, so Save downloads a new copy with the same name.
  `Ctrl+S` saves, `Ctrl+Shift+S` saves as. Save map as file… turns drawn work into a linked file.
- **What is kept:** feature order; top-level members such as `name`, `crs` and `bbox` (recomputed if shapes
  changed); feature `id`s; full coordinate precision and heights (Z); property order and types (numbers stay
  numbers, true/false stay true/false, lists and objects stay JSON); the file's layout (compact, one feature per
  line, or indented). Features with no map shape (null geometry, GeometryCollection) are not shown but are written
  back unchanged. MultiPoint features are shown, and saved, as separate points.
- Files are not renamed or re-numbered: names may repeat, and no `id`/`name` fields are added. New shapes drawn into
  an open file get the file's fields (empty), a `name` in the label field, and the next numeric `id` when the file
  uses them.
- **Label shapes by** any field. **Keep measurement fields up to date** is on when the file already has
  `area_m2`/`perimeter_m`/`length_m`/`bearing_deg`, and off otherwise so the file's fields are left alone.
- Files in projected coordinates (for example UTM) are refused with a note to re-export as EPSG:4326.
- Unsaved changes are autosaved as before; after a reload, restoring them also relinks the file (Chrome/Edge).

**Attribute table** (Table button on the map, or under GeoJSON file or Features)

- Docked under the map, resizable by dragging its top edge. Shows every feature, including drawn ones; renders
  only the rows on screen, so files with tens of thousands of features stay quick.
- Spreadsheet keys: arrows, Tab, Page Up/Down, Home/End; type to replace a cell, Enter/F2/double-click to change
  it, Enter and Tab save and move on, Esc cancels, Delete empties it. Values are checked against the field type.
- Select rows by clicking, Shift-click (range), Ctrl-click, the row checkboxes, Shift+arrows or Ctrl+A. Selection
  is shared with the map: selected shapes turn blue, and Ctrl/Shift-click on the map adds to the selection.
- Search any value, or filter by one field: `area_m2 > 1000`, `village = Majuli`, `owner != empty`,
  `name ~ plot`. Selected and On screen filters. Click a header to sort.
- Field menu (▾ or right-click a header): sort, rename, change type (text, number, yes/no) with conversion,
  label the map, set a value, delete. Add field (name, type, starting value).
- Set value applies one value to the selected features, the rows shown or every feature.
- Ctrl+C copies a cell, or selected rows with field names (tab-separated, pastes into Excel/Sheets); Ctrl+V pastes
  a block from a spreadsheet, or fills one value into all selected rows.
- Delete features, Zoom to selection, and Edit shape (moves the points of just that feature, with Done/Cancel on
  the map; much faster than Move points on big files).
- Undo and redo (Ctrl+Z, Ctrl+Y) for every table change, deletion and shape edit.
- **Form** view shows one feature at a time with previous/next (Page Up/Down); it is the default on phones.
- Right-click a row: zoom, edit shape, open in form, copy, delete.

**Other changes**

- The Features list shows up to 500 entries (filter to find others), so large files open and respond
  quickly; the attribute table always shows them all.
- Map labels are escaped, so a field value can't inject HTML.
- Import GeoJSON file is now "Add features from a GeoJSON file" to make clear it merges into the map.
- Help updated.

## Files changed in 3.1.0

| File | Change |
|---|---|
| `index.html` | GeoJSON file section, map bar, attribute table panel, help text |
| `app.min.js` | File open/save, attribute table, form, undo, single-shape editing (minified build) |
| `app.min.css` | Styles for the above (appended), light and dark, phone layout |
| `sw.js` | Version 3.1.0 |
| `manifest.json` | Description; opens .geojson files from the operating system |

## Changelog 3.0.0

**New features**

- **Measurement fields.** Every shape carries fields that are added and kept up to date automatically, according to
  its geometry type:
  - Areas: `area_m2` (square metres) and `perimeter_m` (metres).
  - Lines: `length_m` (metres) and `bearing_deg` (direction from the first point to the last, in degrees clockwise
    from true north, 0–360).
  - Points: no measurement fields.
  Distances are geodesic (on the Earth's surface). The fields are recalculated when a shape is drawn, moved, extended
  with "Continue last line", imported, recorded on a walk or opened from a project, and are written to GeoJSON, KML
  and saved projects. While drawing or moving points, a live readout at the top of the map shows the area and
  perimeter, or the length and bearing. The Features list shows them under each name.
- **Area unit** (Map view): automatic, m², hectares, acres, km² or bigha-katha-lessa (Assam: 1 bigha = 5 katha =
  100 lessa = 14,400 sq ft). This changes only how areas are shown; files always store `area_m2`.
- **Export KML** for Google Earth, next to Export GeoJSON. Lines, areas and points go into separate folders with
  styles; every field (including the measurements) is kept as ExtendedData, and a readable summary of the
  measurements is in each placemark's description. The file is named after the project.
- **Several projects.** Save project, Save as new, and Open project, which lists every project saved in this
  browser with Open, Rename and Delete. The project that is open is shown in the panel and in the section header.
  The single project kept by version 2.1 becomes "My project" automatically.
- **Snapping (optional)**, under Draw: Off by default. When on, new points, moved points and line extensions stick
  to the nearest point of another shape within 14 px, or else to its nearest edge. A gold ring shows the snap target.
- **Walk with GPS.** Start walk records your position as you walk a path or boundary. Readings worse than the chosen
  accuracy (±10, ±20 or ±50 m, or any) are skipped, and a point is added only after you move the chosen spacing
  (2, 5, 10 or 20 m). Pause skips a stretch. Finish as line or Finish as area; the shape gets the measurement
  fields plus `method`, `gps_points`, `gps_mean_accuracy_m`, `recorded_from` and `recorded_to`. The screen is kept on
  while recording where the browser allows it, and an unfinished walk is offered again after a reload.
- **Save an area for offline use (optional)**, under Map view. Saves the basemap for the area on screen at a chosen
  level of detail, listed with Show and Delete. Up to 300 tiles per area for OpenStreetMap (downloaded slowly, as its
  usage policy asks) and up to 3,000 for Esri. Google maps can't be saved. Saved areas never expire; the service
  worker reads them before the automatic two-week cache of viewed areas.

**Other changes**

- OpenStreetMap (Streets) remains the default basemap; the Google basemaps remain available.
- Help text updated for the new features.

## Files changed in 3.0.0

| File | Change |
|---|---|
| `index.html` | Snapping, Walk with GPS, projects, Export KML, area unit and offline controls; help text |
| `app.min.js` | All features above (minified build) |
| `app.min.css` | Styles for the new controls (appended) |
| `sw.js` | Version 3.0.0; keeps and serves saved offline areas |
| `manifest.json` | Description |
