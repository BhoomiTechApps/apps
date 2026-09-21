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
| `যারগা` | zar‌ga (ZWNJ after the `r`) |
| `ধ্বনি` | dhwoni |
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
* **The OCR button** (top right) opens the OCR page (https://bhoomitechapps.github.io/apps/ocr/) in its own small browser window, in the top right corner of this one, so you can read text from a picture and paste it here. It is a normal pop-up window, not a frame: move it and resize it like any other window. Clicking the button again brings the window to the front instead of reloading it, so work in it is not lost. It needs an internet connection, and your browser must allow pop-ups for this site (on a phone it opens as a new tab).

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
| `mapping.js` | **The data**: whole words, silent-`o` fragments, ব-phala bases, conjunct spellings. Edit this file to change the output. |
| `rules.js` | The glue that applies `mapping.js` on top of the bundle (no pronunciation logic). Loaded after the bundle; the page uses `window.TranslitEngine`. |
| `tools/compare.js` | Compares your input and expected text and prints paste-ready `words` rows. |
| `vendor/translit-reverse.min.js` | **The transliteration engine, copied from `translit-js-reverse/dist/translit-reverse.min.js`** (package version 1.0.1). |
| `sw.js` | Service worker: offline cache + background updates. |
| `manifest.webmanifest`, `icons/` | What makes it installable. |
| `serve.js`, `tests/` | Local server and the unit tests (`node tests/inplace.test.js`, `node tests/rules.test.js`; `tests/samples/` holds the reference text). |

### What is used from `translit-js-reverse`

**One file:** `dist/translit-reverse.min.js`. Everything else in that package is for building, testing or reference and is not needed at runtime: `src/`, `scripts/`, `tests/`, `data/` (the map, settings and snippets are already compiled into the bundle), `examples/`, `package.json`, the `.mjs` build and the unminified build. The page loads it as `vendor/translit-reverse.min.js`, and `sw.js` and the tests use the same name.

## The Bishnupriya mapping (`mapping.js`)

The plain bundle puts an `o` after every bare consonant and only drops a word-final one, so `যারগা` came out as `zaroga`. Rather than teach the engine pronunciation logic (a general rule over-deletes: it turned `ঘটনা` into `ghotna` and `সময়ে` into `somye`), the app is **mapping first**: you list what you want, and `rules.js` (a small glue file with no pronunciation logic) looks it up. Add a row to `mapping.js`, reload, done. Anything not listed is exactly what the plain bundle gives.

`mapping.js` has four lists:

| List | What a row means | Example |
|---|---|---|
| `words` | this whole Bengali word gives exactly this Roman text (case, spaces and ZWNJ kept). Wins over everything else. | `'যদিশৈমিঙাল': 'zodishoi mingal'` |
| `silent_o` | the **first** consonant of the fragment is bare and its `o` is dropped and replaced by `silent_mark` (ZWNJ). Notation from the pattern study: `-XY` X at the end of a word, `-XY-` inside a word, `XY-` at the start, `XY` the whole word. A single letter, like `-থ`, is a final consonant. | `'-রমা'`: `পৃথিবীরমা` → `prithibir‌ma` |
| `ba_phala_w` | base + `্ব` is written with `w` | `ত` `ধ` `স`: `ত্ব` = `tw`, `ধ্ব` = `dhw`, `স্ব` = `sw` (`স্বাধীনতা` → `swadhinota`). Other bases, like `দ্ব`, keep `b`. |
| `conjuncts` | a conjunct spelling that replaces the engine's own (the inherent `o` still follows) | `'জ্ঞ': 'gy'` |

Details worth knowing:
* A fragment only fires on a **bare** consonant. A conjunct is never touched (`বর্ষ` stays `borsho`), and neither is the tail of one.
* `ৰ` (Assamese ra) counts as `র` when matching.
* An explicit apostrophe after the consonant (`পথ'`) shows the `o` and wins over the mapping, as it always did.
* Words, fragments and the ব-phala list use the letters as written; keys must be typed the same way as the text you convert.
* `silent_mark: ''` drops the `o` without writing anything.

### Checking a text against what you expect
```
node tools/compare.js input.txt expected.txt          # the app's engine
node tools/compare.js input.txt expected.txt --plain  # the plain bundle, to see what the mapping has to cover
```
It lines your input up with your expected Roman text word by word (an input word may match up to three expected words, for splits), prints every word that differs, and prints a ready-to-paste line for `words`. The revised sample (`tests/samples/`) is a permanent test: the whole text must come out exactly as expected, pasted and typed. `tests/samples/reverseMap.json` is the Lab's reverse map: the test fails if the map the app runs with ever gains, loses or changes a row (the order of rows does not matter).

### Limits
* Fragments match letters, not meaning: a fragment fires in **every** word that contains it, not only the word you took it from (`-শ` gives `pash‌` and also any other word ending in a bare `শ`). Make the fragment longer, or add a `words` row, when a fragment fires where it should not.
* The final-consonant rows (`-থ -ঠ -শ -ষ -ঙ`) cover what the sample showed. `-খ`, `-ঘ` and the others are not listed, so `দুঃখ` keeps `du:kho`.
* The old `জ+গ` special case inside the bundle (`ৰাজগ` → `rajgo`) is still there and applies first.
* While a word is being typed the guess can change once more letters arrive (`যারগ` shows `zarog`, then `যারগা` shows `zar‌ga`), like `banglo` → `bangla`.
* If the TransLit-Lab later gets these rules built in, delete `mapping.js`, `rules.js` and their lines in `index.html`, `app.js` and `sw.js`. Each snippet in `rules.js` is a self-contained function, so it can also be pasted into the Lab as `js_body` (hooks: pre 1, 3, 4 and post 100, 901). The keys, sort orders and private-use characters are the Lab's own, so the two are interchangeable.

## Updating the transliteration

The map, settings and snippets are inside `vendor/translit-reverse.min.js`. When you rebuild the package (for example with the TransLit-Lab Parity add-on), **replace that one file** and upload. Each time the app is opened the service worker re-checks its code files in the background; a changed file replaces the cached copy and the app shows an **"Update ready – tap to reload"** button. You do not need to change `sw.js`, and a long `Cache-Control` on your server does not delay it.

**Rebuilding the bundle from the Lab is safe with `rules.js` in place.** Its snippet keys and sort orders are the Lab's (`rev_pre_words` 1, `rev_pre_ba_phala_w` 3, `rev_pre_silent_o` 4, `rev_post_strip_virama` 100, `rev_post_restore_mapping` 901). If the bundle already carries a snippet with one of those keys, `rules.js` does not add its own copy, so nothing is applied twice, and a snippet you switched off in the Lab stays off. The bundle's copy then uses the Lab's own word and fragment lists, not `mapping.js`.

`rules.js` needs the bundle's `create()` and `getDefaults()` (present in 1.0.x) and is loaded after it. It also removes any virama (`্`) left in the output, so a bundle rebuilt from a Lab whose reverse map lost its `্` → `""` row (the Lab's Maps import drops rows with an empty Roman value) still gives `protha`, not `p্rotha`. `mapping.js` and `rules.js` have their own lines in `sw.js` and are re-checked on every open like the other code files.

Edit `sw.js` only if you **add, rename or delete files** (update the lists at the top) and bump `VERSION` (it is `v4` since `mapping.js` and `rules.js` were added).

## Known limits

* **A standalone `ও` or `অ` is not converted.** The Lab's `rev_post_clean_o_vowels` snippet removes the `o` of a word that is only `ও`/`অ`, so the engine returns nothing for it (`আমি ও তুমি` gives `ami  tumi`, with the word missing). The app keeps such a word visible in Bengali instead of deleting it. The cause is the pattern `(?<![^aeiouy ]{2})`, which lets the `o` be removed at the start of a word; adding `(?<=\S)` in front of the trailing-`o` pattern fixes it (in a test on 4,333 inputs it changed only these standalone cases). Rebuild the package after changing the snippet and replace `vendor/translit-reverse.min.js`.
* **Undo (Ctrl/Cmd+Z) does nothing**, because the app rewrites the text area's content as you type (which clears the browser's undo history).
* Once a word is finished (you pressed space), Backspace edits the Roman text as it stands; it cannot bring the Bengali back.
* Typing in the middle of a finished word starts a new word at the caret.
* Bengali `র` and Assamese `ৰ` both give `r`; other letters that share a Roman spelling cannot be told apart, so this is not exactly reversible.
* There is no copy/clear button; use your device's select-all and copy.
* Tested in headless Chrome (real typing, simulated IME composition, offline, install checks). **Not tested on a real Android or iOS device or in Safari/Firefox.**

## License

`vendor/translit-reverse.min.js` is GPL-2.0-or-later (see `vendor/LICENSE`); publishing this app distributes it, so publish the app's source under a compatible licence.
