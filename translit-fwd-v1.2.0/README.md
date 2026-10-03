# Roman → Bengali PWA

A one-screen progressive web app: a full-width text area where you type in Roman letters and get Bengali script as you type. It installs like an app and works offline. It uses the `translit-js-forward` package for the transliteration.

## Using it

Type `ami tomay bhalobashi` and the text turns into আমি তমায় ভালবাশি as you go.

* The word you are typing is converted live; **space, Enter, moving the caret or tapping elsewhere** finishes it.
* **Backspace while typing a word removes one Roman letter** and re-converts the word (so `bangla` → `bangl` → `bang`, not half a Bengali conjunct).
* Finished words are ordinary Bengali text: edit them like any text. Pasted text is converted as a whole; pasted Bengali is left alone.
* On phone keyboards that compose the word before committing it, the word stays Roman until you press space (or accept a suggestion), then it converts.
* What you typed is kept on the device between visits.
* **Right-click is off everywhere** except in the text area, where a small menu offers only **Copy** and **Paste**. It also opens with the keyboard's Menu key or Shift+F10 (arrow keys, Enter, Esc). Like the chart window, it never takes focus from the text area. Pasted Roman text is converted, as with Ctrl+V. On phones and tablets the text area keeps the system's long-press toolbar, which a web page cannot change.
* **The বর্ণমালা button** (top right) opens a chart of every Roman key, in barnamala order: vowels with their matras, the consonants by বর্গ, then digits, punctuation and signs. It is a small window that floats above the text: drag it by its title bar, scroll it, close it with **×** (or the button). It cannot be resized, always stays on top, and **never takes keyboard focus from the text area**, so you can keep typing (even a half-typed word) while you click, drag or scroll it. Its position is remembered. A key shown struck through is listed in the map but never produces that letter.

## Run it

```
node serve.js            # then open http://localhost:8080
```

Service workers only run on `http://localhost` or **HTTPS**, so opening `index.html` from disk will not give you offline support. To deploy, upload the folder to any static host over HTTPS (Netlify, GitHub Pages, Cloudflare Pages, your own server). It works from a sub-folder too (all paths are relative). `serve.js` and `tests/` are not needed on the server.

To install: Chrome/Edge show an install icon in the address bar; Android Chrome: menu → *Install app*; iPhone Safari: Share → *Add to Home Screen*. The first visit needs to be online so the app can cache itself.

## What is in the folder

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | The page: the BhoomiTech frame (name and version at top right, credit line underneath) around the app bar, one text area filling the stage, and the chart window. Light "Stone" matte theme. |
| `guard.js` | Turns the right-click menu off, shows the text area's Copy / Paste menu, and swallows the DevTools / view-source shortcuts. Loaded first and depends on nothing. |
| `version.js` | The app's name and version (`APP_VERSION`). The frame header shows it and `sw.js` names its cache after it. |
| `vendor/onest/` | The Onest variable typeface (SIL OFL, see `OFL.txt`) for the interface; bundled, so no font is loaded from the internet. |
| `app.js` | Connects the text area to the transliterator, opens the chart window, saves the text, registers the service worker. |
| `inplace.js` | The "type Roman, get Bengali" logic (pure, no DOM; unit-tested). |
| `barnamala.js` | Builds the barnamala chart from the map inside the engine (pure, no DOM; unit-tested). Nothing to edit when the map changes. |
| `panel.js` | The floating window: dragging, staying inside the screen, keeping keyboard focus in the text area. |
| `vendor/translit-forward.min.js` | **The transliteration engine, copied from `translit-js-forward/dist/translit-forward.min.js`.** The page, `sw.js` and the tests all use this file. |
| `vendor/translit-forward.js` | The readable (unminified) copy of the same engine, for reference. The app does not use it. |
| `fixes.js` | Two corrections applied on top of the engine when the app starts (see *Corrections to the engine*). |
| `sw.js` | Service worker: offline cache + background updates. |
| `manifest.webmanifest`, `icons/` | What makes it installable. |
| `serve.js`, `tests/` | Local server and the unit tests (`node tests/inplace.test.js`, `node tests/barnamala.test.js`, `node tests/fixes.test.js`). |

### What is used from `translit-js-forward`

**One file:** `dist/translit-forward.min.js`. Everything else in that package is for building, testing or reference and is not needed at runtime: `src/`, `scripts/`, `tests/`, `data/` (the map, settings and snippets are already compiled into the bundle), `examples/`, `package.json`, the `.mjs` build and the unminified build.

## Updating the transliteration

The map, settings and snippets are inside `vendor/translit-forward.min.js`. When you rebuild the package (for example with the TransLit-Lab Parity add-on), **replace that one file** and upload. Each time the app is opened, the service worker re-checks its code files in the background; a changed file replaces the cached copy and the app shows an **"Update ready – tap to reload"** button. The barnamala chart is rebuilt from the new map automatically. You do not need to change anything in `sw.js`, and a long `Cache-Control` on your server does not delay it (the check bypasses the browser's HTTP cache).

### Opening code files directly

Opening a `.js`, `.css` or `.map` address as a page (typing it in the address bar, following a link, or `location = 'app.js'` in the console) is redirected to `index.html`. The page's own `<script>` and `<link>` loads are not page navigations, so they are unaffected. This happens in two places:

* **`sw.js`** does it for every visit after the first (once the app is installed in the browser).
* **The server** must do it for the first visit and for reloads that bypass the service worker (Shift+Reload). `serve.js` does this already. On your own server, redirect only requests with the header `Sec-Fetch-Mode: navigate`, and send `Vary: Sec-Fetch-Mode` with code files so caches keep the two answers apart:

```nginx
# nginx: inside the server { } block (change /index.html if the app lives in a sub-folder)
location ~* \.(m?js|css|map)$ {
    add_header Vary "Sec-Fetch-Mode" always;
    if ($http_sec_fetch_mode = "navigate") { return 302 /index.html; }
}
```

```apache
# Apache: .htaccess in the app folder (change /index.html if the app lives in a sub-folder)
RewriteEngine On
RewriteCond %{HTTP:Sec-Fetch-Mode} =navigate
RewriteRule \.(m?js|css|map)$ /index.html [R=302,L]
Header merge Vary "Sec-Fetch-Mode"
```

Plain static hosts that cannot read request headers (for example GitHub Pages) cannot do the server half; there only the service worker redirects.

**What this does not do.** A browser must download the code to run it, so it can always be read: in the DevTools *Sources* and *Network* panels (opened from the browser's menu even with the shortcuts swallowed), with Shift+right-click in Firefox, by saving the page, or with `curl`. These measures stop casual viewing only. The engine is GPL-2.0-or-later, so its source must stay obtainable in any case (see *License*).

Edit `sw.js` only if you **add, rename or delete files** (update the lists at the top). Bump `APP_VERSION` in `version.js` whenever you change the app's own code or styles: the frame header then shows the new version and every user gets a clean cache.

## Look and version

The app sits in the BhoomiTech frame: a warm grey border with the app name and running version at top right (filled in from `version.js`, never typed by hand), the app on an inset plate, and the credit line underneath. It uses the Light "Stone" matte theme from the BhoomiTech design spec: grey-paper surfaces with a faint grain, fine grooves instead of border lines, corners of 4px at most and muga gold as the only accent. It stays light whatever the device's dark-mode setting.

### Changelog

**1.2.0**

* Right-click is off everywhere; the text area has its own menu with only Copy and Paste (`guard.js`). iOS long-press callouts are off outside the text area.
* The keyboard shortcuts for DevTools and view-source (F12, Ctrl/Cmd+Shift+I/J/C/K, Ctrl/Cmd+U, Cmd+Opt+I/J/C/U) do nothing.
* Opening a `.js` or `.css` address directly redirects to `index.html` (`sw.js`, `serve.js`; server rules above).

**1.1.0**

* Design: BhoomiTech frame and the Light "Stone" theme; the writing area is a recessed well, the chart window a raised panel whose consonants sit on small plates; the close button is a line icon; Onest is bundled for the interface (Bengali text still uses the device's Bengali font).
* The app now has a version number (`version.js`), shown in the frame header; the offline cache is named after it.
* Install colours (title bar, splash screen) follow the frame colour.

## Corrections to the engine

`vendor/translit-forward.min.js` is a generated file, so two defects in it are corrected on top of it by `fixes.js` instead of by editing it:

| Typing | The bundle gave | Now |
|---|---|---|
| `ngg` (for example `angga`) | ংগ (the map's `ngg` entry was never reached, because `ng` is matched first) | ঙ্গ |
| `ngu` | ংু (the ng + vowel substitutions have no `ngu`) | ঙু, like `nga`, `ngi`, `nge`, `ngo` |

Each correction is applied only while the defect is still there. Once you fix them in the package itself and replace the vendor file, `fixes.js` does nothing and can be deleted (also from `index.html` and `sw.js`). `node tests/fixes.test.js` checks all of this.

## Known limits

* **Undo (Ctrl/Cmd+Z) does nothing.** The app rewrites the text area's content as you type, which clears the browser's undo history (in Chrome, pressing Ctrl+Z leaves the text as it is; typing carries on normally).
* Once a word is finished (you pressed space), Backspace edits the Bengali text as it stands; it cannot bring the word's Roman letters back.
* Typing in the middle of a finished word starts a new word at the caret.
* The map lists both র and ৰ for `r` and `rr`, and the engine keeps the later one, so `r` always gives the Assamese ৰ (U+09F0) and the Bengali র (U+09B0) cannot be typed. The barnamala chart shows this. Which letter `r` should give is a choice for the map, so it has not been changed.
* `ee` and `oo` only work as independent vowels at the start of a word (`ee` → ই, `oo` → উ). After a consonant they are read as two vowels (`kee` → কেএ); use `i` and `u` there.
* There is no clear or select-all button; use Ctrl/Cmd+A (or the phone's own toolbar) to select everything, then the Copy menu.
* **Paste from the menu** needs the browser's clipboard permission: Chrome asks once, Firefox and Safari show a small *Paste* button to confirm, and on plain `http://` (not localhost) it is unavailable. When it is refused the menu says to use Ctrl/Cmd+V, which always works.
* The Copy / Paste menu, the right-click block and the redirects were tested in headless Chrome 131.
* Tested in headless Chrome (real typing, simulated IME composition, offline, install checks). **Not tested on a real Android or iOS device or in Safari/Firefox.**

## License

`vendor/translit-forward.min.js` (and the readable `vendor/translit-forward.js`) is GPL-2.0-or-later (see `vendor/LICENSE`); publishing this app distributes it, so publish the app's source under a compatible licence.
