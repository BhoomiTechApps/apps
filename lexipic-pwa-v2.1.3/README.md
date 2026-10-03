# LexiPic PWA 2.1.3

Offline-first Progressive Web App version of the LexiPic WordPress plugin (1.2.2). Record heritage-language words with a photo, a voice recording, native script and Roman transliteration. Everything is stored on the device; nothing is sent to a server.

See `AUDIT.md` for the bugs found in the plugin, what was fixed in this port, and known limitations.

## Look and feel

LexiPic uses the BhoomiTech frame and matte themes shared with the foundation's other apps: the app sits on an inset stage inside a frame, with its name and running version at the top right and the credit line underneath.

- **Interface theme:** Light ("Stone", warm grey paper) is the default. Dark ("Graphite") is in **Settings → Appearance**; the choice is saved on the device.
- **One visit in a theme:** add `?theme=dark` or `?theme=light` to the address (for example in a link you share). It doesn't change the saved choice.
- **Settings** is an accordion: each section shows a short summary, and the sections you leave open stay open next time.
- Every tab scrolls on its own between the app bar and the tabs, so the header and the tabs are always on screen.
- Fonts are bundled, so nothing is loaded from Google: Onest for the interface and Noto Serif Bengali for the script (both SIL OFL, in `vendor/`).

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

## Right-click and code files

- Right-click is off everywhere. In a text field it opens a small menu with only **Copy** and **Paste** (also the Menu key or Shift+F10). Phones and tablets keep their own long-press toolbar in text fields. The DevTools and view-source shortcuts do nothing. This is `js/guard.js`; its styles are at the end of `css/app.css`, because the Content-Security-Policy doesn't allow injected styles.
- Opening a `.js` or `.css` address goes back to the app, and fetching one from the console gets `index.html`. `sw.js` does this after the first visit; `.htaccess` does it on Apache servers from the first visit. On other hosts, add the same rules (redirect when `Sec-Fetch-Dest` is `document`, refuse when it is `empty`).
- This deters casual copying only: the browser must download the code to run it, so the browser's own menus can still show it.

## Releasing an update

Change `VERSION` in `sw.js` (and `APP_VERSION` in `js/transfer.js`) on every release. Installed copies will show "A new version of LexiPic is ready" with an Update button.

## Files

| Path | Purpose |
|---|---|
| `index.html` | App shell, icon sprite, Content-Security-Policy |
| `css/app.css` | Styles: frame, Light and Dark theme tokens, components, Copy/Paste menu |
| `js/theme.js` | Applies the saved theme before the first paint; `?theme=` override |
| `js/guard.js` | Right-click rules and the text fields' Copy/Paste menu |
| `js/app.js` | UI: archive, add/edit, sets, settings, install, updates |
| `js/db.js` | IndexedDB storage (sets, entries, languages, keyboard files, backups) |
| `js/ime.js` | Per-language keyboard files, validation, backups, engine wiring |
| `js/transfer.js` | Export, import (plugin, legacy prototype, full backup) |
| `js/engine.js` | CompLing AI transliteration engine, unchanged from the plugin |
| `ime/default/` | Bundled keyboard files, unchanged from the plugin |
| `sw.js` | Service worker (offline app shell; code files stay with the app) |
| `vendor/` | Bundled fonts (Onest, Noto Serif Bengali) and their licences |
| `.htaccess` | Code-file rules for Apache servers |
| `manifest.webmanifest`, `icons/` | Install metadata and icons |

## Moving data between the plugin and the app

- **Plugin → app:** in WordPress, Sets tab → Save to Disk. In the app, Sets → Import file.
- **App → plugin:** in the app, Sets → the download icon on a set. In WordPress, Sets tab → Load from Disk.
- **Device → device:** Sets → Back up everything, then Import file on the other device. The backup includes custom languages and keyboard files.

## Browser support

Current Chrome, Edge, Firefox and Safari (desktop and mobile). Dictation appears only in browsers that support the Web Speech API and needs a connection; recording, typing and transliteration work offline everywhere.

## Changelog

### 2.1.3

**Design and other changes**

- The left half of a word card is always white, in both themes, however tall the text side is. The photo fills its width and sits in the middle when the text is taller.
- The groove between the photo and the text is gone.

### 2.1.2

**Design and other changes**

- The photo box on a word card now takes the photo's own shape: a wide photo gives a short box, a tall photo a tall one, with no white bars. A very tall photo is capped at half the screen height, and its box narrows with it, so the card still fits on a phone.
- Grid view photos follow their own shape in the same way.

### 2.1.1

**Design and other changes**

- The word card is split down the middle: the photo on the left, and the word, its Roman spelling, the description and the Edit and Delete buttons on the right.
- The photo sits on white and is shown whole (no cropping), whatever its shape. The play button is in the photo's bottom corner.
- Each card keeps its own height, so a long description no longer stretches the other cards, and the "1 of 3" counter stays just under the card on screen.
- Grid view keeps the stacked layout (its cards are too narrow to split), with the same white, uncropped photo.

### 2.1.0

**New features**

- Interface theme in **Settings → Appearance**: Light ("Stone", the default) or Dark ("Graphite"), saved on the device. `?theme=dark|light` in the address opens one visit in a theme.
- Settings is an accordion with a summary on each section (current theme, storage used, number of languages). Open sections are remembered.

**Bug fixes**

- Settings, Sets and Add scroll inside the app between the header and the tabs, so a long Settings page no longer pushes the tabs or the header off screen.
- Dialogs (keyboard files, edit set, camera) scroll inside themselves when they are taller than the screen.

**Design and other changes**

- The BhoomiTech frame: name and running version at the top right, the app on an inset stage, and the credit line underneath.
- Matte Light and Dark themes built only from design tokens: grooves instead of border lines, recessed input fields, raised cards and buttons, corners of 4px at most and muga gold as the only accent.
- Google Fonts removed. Onest and Noto Serif Bengali are bundled, so the script looks the same offline from the first visit.
- Each word card fits a phone screen with the header, search and tabs visible.

