# Roman → Bengali PWA

A one-screen progressive web app: a full-width text area where you type in Roman letters and get Bengali script as you type. It installs like an app and works offline. It uses the `translit-js-forward` package for the transliteration.

## Using it

Type `ami tomay bhalobashi` and the text turns into আমি তমায় ভালবাশি as you go.

* The word you are typing is converted live; **space, Enter, moving the caret or tapping elsewhere** finishes it.
* **Backspace while typing a word removes one Roman letter** and re-converts the word (so `bangla` → `bangl` → `bang`, not half a Bengali conjunct).
* Finished words are ordinary Bengali text: edit them like any text. Pasted text is converted as a whole; pasted Bengali is left alone.
* On phone keyboards that compose the word before committing it, the word stays Roman until you press space (or accept a suggestion), then it converts.
* What you typed is kept on the device between visits.
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
| `index.html`, `styles.css` | The page: header + one text area filling the screen + the chart window. |
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

Edit `sw.js` only if you **add, rename or delete files** (update the lists at the top) and bump `VERSION` so old caches are dropped.

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
* There is no copy/clear button; use your device's select-all and copy.
* Tested in headless Chrome (real typing, simulated IME composition, offline, install checks). **Not tested on a real Android or iOS device or in Safari/Firefox.**

## License

`vendor/translit-forward.min.js` (and the readable `vendor/translit-forward.js`) is GPL-2.0-or-later (see `vendor/LICENSE`); publishing this app distributes it, so publish the app's source under a compatible licence.
