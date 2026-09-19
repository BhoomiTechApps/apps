# Roman → Bengali PWA

A one-screen progressive web app: a full-width text area where you type in Roman letters and get Bengali script as you type. It installs like an app and works offline. It uses the `translit-js-forward` package for the transliteration.

## Using it

Type `ami tomay bhalobashi` and the text turns into আমি তমায় ভালবাশি as you go.

* The word you are typing is converted live; **space, Enter, moving the caret or tapping elsewhere** finishes it.
* **Backspace while typing a word removes one Roman letter** and re-converts the word (so `bangla` → `bangl` → `bang`, not half a Bengali conjunct).
* Finished words are ordinary Bengali text: edit them like any text. Pasted text is converted as a whole; pasted Bengali is left alone.
* On phone keyboards that compose the word before committing it, the word stays Roman until you press space (or accept a suggestion), then it converts.
* What you typed is kept on the device between visits.

## Run it

```
node serve.js            # then open http://localhost:8080
```

Service workers only run on `http://localhost` or **HTTPS**, so opening `index.html` from disk will not give you offline support. To deploy, upload the folder to any static host over HTTPS (Netlify, GitHub Pages, Cloudflare Pages, your own server). It works from a sub-folder too (all paths are relative). `serve.js` and `tests/` are not needed on the server.

To install: Chrome/Edge show an install icon in the address bar; Android Chrome: menu → *Install app*; iPhone Safari: Share → *Add to Home Screen*. The first visit needs to be online so the app can cache itself.

## What is in the folder

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | The page: header + one text area filling the screen. |
| `app.js` | Connects the text area to the transliterator, saves the text, registers the service worker. |
| `inplace.js` | The "type Roman, get Bengali" logic (pure, no DOM; unit-tested). |
| `vendor/translit-forward.js` | **The transliteration engine, copied from `translit-js-forward/dist/`.** |
| `sw.js` | Service worker: offline cache + background updates. |
| `manifest.webmanifest`, `icons/` | What makes it installable. |
| `serve.js`, `tests/` | Local server and the unit test (`node tests/inplace.test.js`). |

### What is used from `translit-js-forward`

**One file:** `dist/translit-forward.js`. Everything else in that package is for building, testing or reference and is not needed at runtime: `src/`, `scripts/`, `tests/`, `data/` (the map, settings and snippets are already compiled into the bundle), `examples/`, `package.json`, the `.mjs` build and the minified build. If you prefer the smaller `dist/translit-forward.min.js`, save it as `vendor/translit-forward.js` (the name is what the app refers to).

## Updating the transliteration

The map, settings and snippets are inside `vendor/translit-forward.js`. When you rebuild the package (for example with the TransLit-Lab Parity add-on), **replace that one file** and upload. Each time the app is opened, the service worker re-checks its code files in the background; a changed file replaces the cached copy and the app shows an **"Update ready – tap to reload"** button. You do not need to change anything in `sw.js`, and a long `Cache-Control` on your server does not delay it (the check bypasses the browser's HTTP cache).

Edit `sw.js` only if you **add, rename or delete files** (update the lists at the top) and bump `VERSION` so old caches are dropped.

## Known limits

* **Undo (Ctrl/Cmd+Z) does nothing.** The app rewrites the text area's content as you type, which clears the browser's undo history (in Chrome, pressing Ctrl+Z leaves the text as it is; typing carries on normally).
* Once a word is finished (you pressed space), Backspace edits the Bengali text as it stands; it cannot bring the word's Roman letters back.
* Typing in the middle of a finished word starts a new word at the caret.
* There is no copy/clear button; use your device's select-all and copy.
* Tested in headless Chrome (real typing, simulated IME composition, offline, install checks). **Not tested on a real Android or iOS device or in Safari/Firefox.**

## License

`vendor/translit-forward.js` is GPL-2.0-or-later (see `vendor/LICENSE`); publishing this app distributes it, so publish the app's source under a compatible licence.
