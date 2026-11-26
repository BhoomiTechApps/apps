# Kiosk Card (LexiPic Kiosk) 1.4.0

A display-only Progressive Web App for LexiPic word sets. It shows sets full screen on a touch-screen kiosk as tiles, then as swipeable word cards with a photo, the word in script and in Roman letters, a note, a **Play** button for the recording and an optional link button. Visitors can browse and listen; they cannot record, edit or delete anything.

It has no server-side part. Open `index.html` from any https host (or `http://localhost` for testing).

## Sources

The app shows one of two sources, chosen on the setup screen the first time it opens and remembered on every start.

- **USB Drive:** a `lexipic-kiosk-data` folder picked with **Select folder…**. Needs Chrome or Edge 86+ (File System Access API). Works with no internet. After a restart the same folder is reopened automatically; if the browser wants permission again, **Reconnect to saved USB folder** asks for it with one tap.
- **Remote URL:** a kiosk web page (for example a LexiPic Kiosk WordPress site's kiosk page) shown full screen in a frame. Needs a connection; if the page can't be reached, a retry screen appears and the app tries again every 8 seconds. The page's site must be on the kiosk site's approved list (below).

## Kiosk site

The **kiosk site** is the WordPress site running the LexiPic Kiosk plugin. It supplies the list of approved pages for Remote URL and the kiosk PIN. **Nothing is built in**: it is empty on a new kiosk and is set under **Kiosk site** at the bottom of the setup card.

- Enter the site's address, for example `https://example.org` or `example.org` (`https://` is added). If WordPress is in a sub-folder, include it: `https://example.org/wp`. A pasted REST address (`…/wp-json/…`) is cut back to the site.
- Only `https://` is accepted, except `http://localhost` and `http://127.0.0.1` for testing.
- **Save kiosk site** first checks that `<site>/wp-json/lexipic-kiosk/v1/allowlist` answers like the plugin; if it doesn't, nothing is saved.
- **Clear** removes it (after a confirmation).
- The address is saved on this device only (`localStorage`, key `lexipic_kiosk_site`). The approved list it returns is cached on the device; the cache is emptied whenever the site changes.

What the kiosk site changes:

| | No kiosk site | Kiosk site set |
|---|---|---|
| USB Drive | Works | Works |
| Remote URL | Can't be used ("Set the kiosk site first") | Only pages on the site's approved list |
| **⚙ source** (change source) | Opens setup directly, no PIN | Asks for the site's kiosk PIN |
| Changing or clearing the kiosk site | No PIN (nothing to check yet) | Asks for the **current** site's PIN (not asked again if it was entered in the last 2 minutes) |

A saved Remote URL source is re-checked against the approved list on every start and every 5 minutes; if its domain has been removed, a 10-second warning appears and the kiosk disconnects. If the kiosk site is cleared or changed, a saved Remote URL source is dropped and must be entered again.

### The kiosk site's REST endpoints

Both are provided by the LexiPic Kiosk WordPress plugin, relative to the kiosk site:

- `GET <site>/wp-json/lexipic-kiosk/v1/allowlist` → `{ "domains": [ "example.org", "museum.example.org" ] }`. Hostnames are matched exactly (no wildcards). If the list can't be fetched and nothing is cached, saving a Remote URL is refused (fails closed); a source that was already approved keeps running through a network blip.
- `POST <site>/wp-json/lexipic-kiosk/v1/pin/verify` with `{ "pin": "…" }` → HTTP 200 if correct, any other status if not, 429 when rate-limited ("Too many attempts"). The PIN is never stored on the kiosk, so every PIN check needs a connection.

The approved domains and the PIN are managed in wp-admin; nothing on the kiosk needs editing.

## The `lexipic-kiosk-data` folder

```
lexipic-kiosk-data/
├── settings.json          which sets to show, their names and groups, kiosk options
├── bm-dom-animal.json     one LexiPic set export per set, named <slug>.json
├── bm-fish.json
├── bm-fruits.json
└── bm-vegetable.json
```

`settings.json`:

```json
{
  "layers": [
    { "slug": "bm-dom-animal", "name": "Domestic Animals", "enabled": true, "group": "Livestock" },
    { "slug": "bm-fruits",     "name": "Fruits",           "enabled": true, "group": "Food Habit" }
  ],
  "kiosk": { "idle_time_seconds": 30, "autoplay_audio": false }
}
```

- `slug` is the file name without `.json`; it must match exactly, including case.
- `name` replaces the set's own name on screen; `group` is the heading the tile appears under; `"enabled": false` hides a set.
- `idle_time_seconds` (default 90, at least 5): after this long with no touch, the kiosk returns to the sets screen.
- `autoplay_audio`: play the first word's recording when a set opens.

Set files are LexiPic exports (LexiPic app 2.x or the WordPress plugin), unchanged. Photos and recordings may be embedded `data:` URIs or file names in the same folder (`"image": "cat.jpg"`). `link` (http/https only) and `link_label` add a link button next to **Play**; without `link_label` the button reads "More". A set listed in `settings.json` whose file is missing or unreadable is named in a banner on the sets screen.

A sample folder (Bishnupriya Manipuri: domestic animals, fishes, fruits, vegetables) is included as `lexipic-kiosk-data/`.

## Kiosk behaviour

- Right-click and long press are blocked (except inside a Remote URL page).
- The manifest opens the installed app full screen.
- Material Icons are bundled (`vendor/material-icons/`), so icons work offline from the first start. The Fraunces heading font loads from Google Fonts when online and falls back to a plain serif otherwise.

## Releasing an update

Change `APP_VERSION` at the top of `app.js` (shown on the setup card) and `CACHE_NAME` in `sw.js`, so installed kiosks fetch the new files.

## Files

| Path | Purpose |
|---|---|
| `index.html` | Setup card, URL frame, sets and card screens |
| `app.js` | Sources, kiosk site, allowlist and PIN checks, USB reading, tiles, cards, idle timer |
| `kiosk.css` | Styles |
| `sw.js` | Service worker (offline app shell) |
| `manifest.json`, `icons/` | Install metadata |
| `vendor/material-icons/` | Bundled icon font (Apache 2.0) |
| `lexipic-kiosk-data/` | Sample data folder |

## Changelog

### 1.4.0

- **Kiosk site is no longer built in.** The WordPress site that supplies the approved-page list and the PIN was fixed in `app.js`. It is now empty by default and set under **Kiosk site** on the setup card; both REST addresses are derived from it.
- Saving a kiosk site checks that the LexiPic Kiosk plugin answers there first. Changing or clearing an existing kiosk site needs that site's PIN.
- With no kiosk site, Remote URL is unavailable and changing the source isn't PIN-protected (there is no PIN to check); USB Drive works as before.
- Changing or clearing the kiosk site empties the cached approved list and drops a saved Remote URL source.
- The version is shown on the setup card.

### 1.3.0

- Link button on word cards (`link` and `link_label` in set files, from LexiPic 2.3.3 or the Kiosk Card plugin 1.5.0+).
