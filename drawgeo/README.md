# DrawGeo PWA (v3.0.0)

Draw lines, areas and points on a map, record GPS walks, and export them as GeoJSON or KML. No server, no account.
Developed by Shankar Sinha for BhoomiTech Heritage and Development Foundation under CDEP.

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

## Files changed

| File | Change |
|---|---|
| `index.html` | Snapping, Walk with GPS, projects, Export KML, area unit and offline controls; help text |
| `app.min.js` | All features above (minified build) |
| `app.min.css` | Styles for the new controls (appended) |
| `sw.js` | Version 3.0.0; keeps and serves saved offline areas |
| `manifest.json` | Description |
