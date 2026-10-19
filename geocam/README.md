# GeoCam — PWA video + GPS recorder

Records camera video (with audio) and a GPS track at the same time, stores both on the
device, and exports them as `geocam-<timestamp>.mp4|webm` + `geocam-<timestamp>.geojson`.

## Run it

Camera and geolocation only work in a **secure context** (HTTPS or `localhost`).

```bash
cd geocam
python3 -m http.server 8080        # or: npx serve .
# open http://localhost:8080
```

To test on a phone you need HTTPS — deploy the folder as-is to GitHub Pages, Netlify,
Cloudflare Pages, or tunnel your local server (e.g. `cloudflared tunnel --url http://localhost:8080`).
Then use the browser's "Install app" / "Add to Home Screen".

## Using it in remote places without internet

The app needs internet **only once**, to install. After that it runs with no network at all.
Recording, GPS, storage, playback and Save all work offline.

**Before you leave (with internet):**
1. Open the app URL and wait for the green badge: **"✓ Ready to use without internet"**.
2. Install it: Android Chrome → menu → *Install app*; iPhone Safari → Share → *Add to Home Screen*.
   On iOS, installing matters: Safari can clear data for sites that are *not* on the home screen.
3. Tap **Start camera** once and allow camera, microphone and location, so you aren't asked for
   permissions in the field.
4. Test it: turn on airplane mode, re-enable Location, launch from the home-screen icon and record a
   short clip.

**In the field:**
- GPS comes from satellites and needs no internet. Without mobile data, though, the phone can't
  download satellite assistance data, so the **first fix can take 30 s to several minutes**. Stand in
  open sky while the HUD shows "acquiring satellites…". Opening the app with internet shortly before
  you go out pre-loads that data and speeds this up.
- Airplane mode is fine, but on some phones it also switches Location off. Turn Location back on.
- On Android, set Location to use GPS (not "Wi-Fi/network only").
- You can start recording before the first fix. The video records, and the track begins when
  satellites are found. If the signal drops (dense forest, gorges), the HUD shows "signal lost" and
  the track resumes when it returns.
- Battery: the screen, camera and GPS all stay on. Carry a power bank.
- **Save** works offline (downloads or a chosen folder). **Share** only works offline with apps that
  don't need the network, such as Files or Gallery.

## Mobile-network location fallback (optional)

Turn on **"Use mobile network location when GPS is weak or unavailable"** in the app. It
remembers the setting.

- **How it works:** web apps can't read cell towers directly. Instead the app runs a second, low-power
  location request, and the phone (Android or iOS) answers it from cell towers and Wi-Fi rather than
  satellites.
- **When it's used:** GPS fixes are always recorded. A network fix is added to the track only when GPS
  has had no fix for 10 s, or when GPS accuracy is worse than your threshold (20/50/100/250 m) *and* the
  network fix is more accurate.
- **Labels:** each point carries `source: "gps"` or `"network"`, so you can filter or style them when
  mapping. Note that this records which request delivered the fix, and the phone may blend sources
  internally. `accuracy` is the true quality indicator.
- **Limits:**
  - It needs mobile signal. On most phones it also needs **mobile data**, because the tower lookup
    happens on Google's or Apple's servers. With signal but no data, it may only work from the
    phone's cached tower data, or not at all.
  - Where there's no signal at all, it can't help. That's GPS-only territory.
  - Accuracy is usually 100 m–2 km in rural areas, versus 3–10 m for GPS.
  - On Android, enable *Google Location Accuracy* (or *Improve location accuracy*) in location
    settings, or network location is off.
- **True cell triangulation:** reading tower IDs and signal strengths yourself, then looking them up in
  an offline database such as OpenCelliD, isn't possible from a browser. It would need a native wrapper
  (Capacitor/Android) with a phone-state plugin.

## How storage works

- While recording, video is emitted in 1-second chunks and each chunk is written to
  **IndexedDB** immediately; every GPS fix is written as it arrives. Long recordings never
  sit in RAM, and if the app crashes the session shows up as "interrupted — recoverable".
- `navigator.storage.persist()` is requested so the browser doesn't evict data.
- **Save** writes the two files to the device:
  - Desktop Chrome/Edge: pick a folder once; files are written straight into it.
  - Android / iOS / Firefox: regular downloads (Android → Downloads; iOS → Files prompt).
- **Share** opens the OS share sheet (save to Gallery/Photos, Drive, etc.).

## GeoJSON format

A `FeatureCollection` with one `LineString` feature (`Point` if one fix, `null` if none).
Per-point arrays in `properties` line up 1:1 with `geometry.coordinates`:

| property         | meaning                                              |
|------------------|------------------------------------------------------|
| `coordTimes`     | ISO timestamps (togeojson/Mapbox convention)         |
| `source`         | `"gps"` or `"network"` (cell/Wi-Fi fallback)         |
| `videoOffsetMs`  | ms since the first video frame — seek the video here |
| `accuracy`       | horizontal accuracy (m)                              |
| `altitudeAccuracy`, `speed` (m/s), `heading` (°) | may be `null` |

Coordinates are `[lon, lat, alt]` when every fix has altitude, otherwise `[lon, lat]`.
`properties.video` holds the matching video filename.

## Known platform limits

- **Keep the app in the foreground.** Browsers pause geolocation (and often the camera)
  when the page is hidden or the screen locks. The app holds a Screen Wake Lock while
  recording to prevent auto-lock.
- iOS Safari records **MP4**; Chrome/Edge record MP4 on recent versions, else **WebM**.
  WebM files from MediaRecorder lack a duration header, so some players can't seek until
  fully loaded — remux with `ffmpeg -i in.webm -c copy out.webm` if needed.
- GPS rate is decided by the device (typically ~1 Hz with good sky view).
- Browser storage quota is a share of free disk space; the app shows usage. Save and
  delete old recordings to free space.
