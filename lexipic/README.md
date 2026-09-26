# LexiPic PWA 2.0.0

Offline-first Progressive Web App version of the LexiPic WordPress plugin (1.2.2). Record heritage-language words with a photo, a voice recording, native script and Roman transliteration. Everything is stored on the device; nothing is sent to a server.

See `AUDIT.md` for the bugs found in the plugin, what was fixed in this port, and known limitations.

## Deploy

It is a static site with no build step. Upload the folder to any static host that serves **HTTPS** (microphone access and the service worker both require it):

- **GitHub Pages:** push the folder contents to a repository and enable Pages. Relative paths mean it works from a subpath such as `https://<org>.github.io/lexipic/`.
- **Netlify / Cloudflare Pages / any web server:** upload the folder as-is.

Serve `manifest.webmanifest` as `application/manifest+json` if your server allows it (most do by default).

For local testing, `localhost` counts as secure:

```
cd lexipic-pwa
python3 -m http.server 8080
# open http://localhost:8080
```

## Releasing an update

Change `VERSION` in `sw.js` (and `APP_VERSION` in `js/transfer.js`) on every release. Installed copies will show "A new version of LexiPic is ready" with an Update button.

## Files

| Path | Purpose |
|---|---|
| `index.html` | App shell, icon sprite, Content-Security-Policy |
| `css/app.css` | Styles (light and dark) |
| `js/app.js` | UI: archive, add/edit, sets, settings, install, updates |
| `js/db.js` | IndexedDB storage (sets, entries, languages, keyboard files, backups) |
| `js/ime.js` | Per-language keyboard files, validation, backups, engine wiring |
| `js/transfer.js` | Export, import (plugin, legacy prototype, full backup) |
| `js/engine.js` | CompLing AI transliteration engine, unchanged from the plugin |
| `ime/default/` | Bundled keyboard files, unchanged from the plugin |
| `sw.js` | Service worker (offline app shell, font caching) |
| `manifest.webmanifest`, `icons/` | Install metadata and icons |

## Moving data between the plugin and the app

- **Plugin → app:** in WordPress, Sets tab → Save to Disk. In the app, Sets → Import file.
- **App → plugin:** in the app, Sets → the download icon on a set. In WordPress, Sets tab → Load from Disk.
- **Device → device:** Sets → Back up everything, then Import file on the other device. The backup includes custom languages and keyboard files.

## Browser support

Current Chrome, Edge, Firefox and Safari (desktop and mobile). Dictation appears only in browsers that support the Web Speech API and needs a connection; recording, typing and transliteration work offline everywhere.
