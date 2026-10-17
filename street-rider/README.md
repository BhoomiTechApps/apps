# Street Journey Lite (PWA)

A slim, installable version of the Street Journey plugin. No WordPress, no server code. It's plain static files.

## What it does
1. **Basemap**: choose from 12 presets (CARTO, OpenStreetMap, Google, Esri, Stadia, OpenTopoMap). The app remembers your choice.
2. **Points file**: open a `.json` / `.geojson` file from your device. Files you open stay in the browser so you can pick them again later, even offline.
3. **Stops and ride**: tap points in the list or on the map, in the order you want to visit them, then press Play. The route follows real roads (public OSRM). If you're offline or OSRM fails, it uses straight lines. At each stop a card shows the point's name and photo.
4. **Follow**: the target button keeps the motorcycle centred. Dragging the map while it plays also stops following.
5. **Speed**: slider from 1× to 250× (1× = 60 km/h). You can change it during the ride.
6. **Cursor**: a golden-yellow motorcycle seen from above, with a black outline, that turns to match the road.

Also included: a seek bar, a choice of pause length at each stop, and keyboard shortcuts (Space = play/pause, F = follow, +/− = speed). The screen stays awake while the ride plays. Map tiles you've already viewed are cached for offline use.

## JSON formats accepted
```json
{ "route": "My route", "points": [ { "lat": 26.14, "lng": 91.73, "label": "Place", "img": "https://…/photo.jpg", "thumb": "https://…/sm.jpg" } ] }
```
The app also accepts:
- a plain array of points
- a GeoJSON FeatureCollection of Points
- `[lat, lng]` pairs

Other key names it understands: `lat`/`latitude`, `lng`/`lon`/`longitude`, `label`/`name`/`title`, `img`/`image`/`imageUrl`/`photo`/`src`, `thumb`/`thumbnail`.

## Deploy
Upload the folder to any HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages, or a subfolder of your own site). Service workers need HTTPS, or `localhost` for testing.

Local test: `python3 -m http.server 8080` inside the folder, then open http://localhost:8080.

After changing any file, bump `VERSION` in `sw.js` so installed copies update.

## Notes
- **Stadia** tiles work on `localhost` without a key. On a real domain, register that domain (free) at stadiamaps.com.
- **Google** tiles are loaded straight from Google's tile servers, the same way the plugin does it. Google's terms don't permit this outside their official APIs, so think twice before using it publicly.
- **Routing** uses the public OSRM demo server, which is meant for light use. Change `OSRM` at the top of `app.js` to point at your own server.
