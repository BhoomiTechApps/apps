# Bengali → Roman PWA

A one-screen progressive web app: a full-width text area where you type or paste Bengali script and get Roman letters. It installs like an app and works offline. It uses the `translit-js-reverse` package for the transliteration. It is the mirror of the Roman → Bengali app and can be installed next to it.

## Using it

Paste Bengali text, or type it with a Bengali keyboard, and it turns into Roman letters:

| You enter | You get |
|---|---|
| `বাংলা` | bangla |
| `আমার সোনার বাংলা` | amar sonar bangla |
| `বিষ্ণুপ্রিয়া মনিপুরি` | bishnupriya monipuri |
| `ভারত` | bharot |
| `ক্ষ` | kkho |
| `১৯৪৭ সালে` | 1947 sale |
| `শান্তি` | shanti |
| `আমি ও তুমি` | ami ও tumi |

* The word you are typing is converted live; **space, Enter, moving the caret or tapping elsewhere** finishes it. A word that is still incomplete shows its best guess so far (for example `বাংল` shows `banglo` until you type the final `া`).
* **Backspace while typing a word removes one Bengali character** and re-converts the word. Finished words are ordinary text.
* **Pasted text is converted word by word and every space, tab and newline is kept exactly.** (The engine on its own trims whitespace, which would glue pasted words together, so the app converts each word separately.)
* **Only words that contain Bengali script are converted.** Roman words, numbers and emoji you type or paste are left exactly as they are, capital letters included (the engine would lower-case them).
* **A word is never deleted by the conversion.** If the engine has no output for a word it stays as written. This currently happens for a standalone `ও` and `অ` (see *Known limits*).
* On phone keyboards that compose the word before committing it, the word stays Bengali until you press space (or accept a suggestion), then it converts.
* What is in the box is kept on the device between visits.

You need a way to enter Bengali (a Bengali keyboard on your phone, or an input method on your computer), or paste it from elsewhere.

## Run it

```
node serve.js            # then open http://localhost:8080
```

Service workers only run on `http://localhost` or **HTTPS**, so opening `index.html` from disk will not give you offline support. To deploy, upload the folder to any static host over HTTPS. It works from a sub-folder too (all paths are relative), and it can live on the same domain as the Roman → Bengali app: the two use different cache names and storage keys, so they do not interfere. `serve.js` and `tests/` are not needed on the server.

To install: Chrome/Edge show an install icon in the address bar; Android Chrome: menu → *Install app*; iPhone Safari: Share → *Add to Home Screen*. The first visit needs to be online so the app can cache itself.

## What is in the folder

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | The page: header + one text area filling the screen. |
| `app.js` | Connects the text area to the transliterator, saves the text, registers the service worker. |
| `inplace.js` | The in-place conversion logic (pure, no DOM; unit-tested). Same module as the other app, plus a word-by-word mode. |
| `vendor/translit-reverse.js` | **The transliteration engine, copied from `translit-js-reverse/dist/`** (package version 1.0.1). |
| `sw.js` | Service worker: offline cache + background updates. |
| `manifest.webmanifest`, `icons/` | What makes it installable. |
| `serve.js`, `tests/` | Local server and the unit test (`node tests/inplace.test.js`). |

### What is used from `translit-js-reverse`

**One file:** `dist/translit-reverse.js`. Everything else in that package is for building, testing or reference and is not needed at runtime: `src/`, `scripts/`, `tests/`, `data/` (the map, settings and snippets are already compiled into the bundle), `examples/`, `package.json`, the `.mjs` build and the minified build. To use the minified file instead, save it as `vendor/translit-reverse.js`.

## Updating the transliteration

The map, settings and snippets are inside `vendor/translit-reverse.js`. When you rebuild the package (for example with the TransLit-Lab Parity add-on), **replace that one file** and upload. Each time the app is opened the service worker re-checks its code files in the background; a changed file replaces the cached copy and the app shows an **"Update ready – tap to reload"** button. You do not need to change `sw.js`, and a long `Cache-Control` on your server does not delay it.

Edit `sw.js` only if you **add, rename or delete files** (update the lists at the top) and bump `VERSION`.

## Known limits

* **A standalone `ও` or `অ` is not converted.** The Lab's `rev_post_clean_o_vowels` snippet removes the `o` of a word that is only `ও`/`অ`, so the engine returns nothing for it (`আমি ও তুমি` gives `ami  tumi`, with the word missing). The app keeps such a word visible in Bengali instead of deleting it. The cause is the pattern `(?<![^aeiouy ]{2})`, which lets the `o` be removed at the start of a word; adding `(?<=\S)` in front of the trailing-`o` pattern fixes it (in a test on 4,333 inputs it changed only these standalone cases). Rebuild the package after changing the snippet and replace `vendor/translit-reverse.js`.
* **Undo (Ctrl/Cmd+Z) does nothing**, because the app rewrites the text area's content as you type (which clears the browser's undo history).
* Once a word is finished (you pressed space), Backspace edits the Roman text as it stands; it cannot bring the Bengali back.
* Typing in the middle of a finished word starts a new word at the caret.
* Bengali `র` and Assamese `ৰ` both give `r`; other letters that share a Roman spelling cannot be told apart, so this is not exactly reversible.
* There is no copy/clear button; use your device's select-all and copy.
* Tested in headless Chrome (real typing, simulated IME composition, offline, install checks). **Not tested on a real Android or iOS device or in Safari/Firefox.**

## License

`vendor/translit-reverse.js` is GPL-2.0-or-later (see `vendor/LICENSE`); publishing this app distributes it, so publish the app's source under a compatible licence.
