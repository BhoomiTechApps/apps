# OCR Studio 3.0

Version: 3.0.0

Offline OCR for printed Eastern Nagari (Bengali–Assamese script) and English, for community heritage and corpus work. Everything runs in the browser; nothing is uploaded.

## What's new in 3.0.0

### Searchable PDFs now carry your corrected text

- **Searchable PDF** (Save menu, page bundle and collection) is now made by OCR Studio itself instead of by the recognition engine. Its hidden text layer is **your proofread text**, not the raw machine reading, so searching, copying and screen readers give the corrected words. Before 3.0 the layer held the uncorrected text.
- Each corrected word is placed over its printed word. When a line's words were changed (joined, split, added), the line is spread over the printed line; lines you added or removed are matched up automatically with the lines on the page.
- Pages typed by hand (handwritten pages, or text typed without running OCR) can now be saved as searchable PDFs too; the text is laid down the page in reading order.
- Eastern Nagari text keeps its logical Unicode order, so conjuncts, vowel signs, ৰ and ৱ copy out exactly as typed.
- The PDF's properties hold the source details: title and page, author, language, year, publisher, permission and who digitised it. Pages marked "Community use only" say so in the PDF too.
- **Collection export** adds a `pdf/` folder with **one searchable PDF per source** (book, magazine or file), its pages in page order. A whole book digitised page by page comes out as one proofread, searchable PDF.
- Pages added to the collection with earlier versions are exported the same way; their corrected text is laid down the page.
- Recognition is slightly faster, because the engine no longer builds a PDF of its own.
- Service worker cache renamed to `ocr-studio-v3.0.0`.

## What's new in 2.3.0

- **Female voice.** OCR Studio can now use voices made with Coqui TTS, starting with the **Bengali female voice from the SYSPIN project** (IISc Bengaluru). It reads Eastern Nagari text directly, at 22 kHz, and its licence (MIT) has no non-commercial restriction. It is listed first, so it is the default when installed.
- **Voice menu shows only installed voices.** `voices.json` lists both voices; the menu next to Listen shows the ones whose folders are present (or already on the device, when offline), and appears only when there is more than one. The choice is remembered on each device.
- The voice converter (`voice-tools/convert_voice.py`) handles both Hugging Face and Coqui TTS voices, and the Colab notebook makes both voices in one run.
- Service worker cache renamed to `ocr-studio-v2.3.0`.

## What's new in 2.2.1

### Bug fix

- Listen failed with "no available backend found … Failed to fetch dynamically imported module" on web servers that do not send the right file type for `.mjs` files (common with Apache/XAMPP and other local servers). The speech engine's files are now fetched by the app itself, so the server's file types no longer matter. The included `.htaccess` also declares the `.mjs` and `.wasm` types for Apache.
- Service worker cache renamed to `ocr-studio-v2.2.1`, so returning visitors get the fix.

## What's new in 2.2.0

### New feature: Listen (machine voice)

- **Listen** (next to Record) reads the text aloud with a machine voice that runs on the device. Select part of the text to hear only that part. Press again to stop.
- The first time, the app asks before downloading the voice and the speech engine (about 70 MB with the Bengali voice). After that, Listen works offline, and the voice stays on the device across app updates.
- Reading starts after the first short phrase is ready; the rest is prepared while it plays. Pauses fall at sentence ends (। ৷ ? !) and commas. Line breaks inside a paragraph are read as spaces.
- When a reading is finished, a **Machine voice** bar lets you replay it or save it as `…_machine-voice.wav`. Machine readings are never added to page bundles or the collection, so they cannot be mistaken for human recordings in the corpus.
- The voice uses several processor cores where the browser allows it. To make that possible, the service worker marks the app as cross-origin isolated (see "Deploy").
- Several voices can be installed; a voice menu appears next to Listen when there is more than one. See "Machine voice" below.

### Other changes

- Service worker cache renamed to `ocr-studio-v2.2.0`. Voices are kept in a separate cache, `ocr-studio-voices-v1`.

## What's new in 2.1.1

### Design and other changes

- The interface now opens in the **Light** (stone) theme by default. Dark (graphite) is still one tap away on the Dark / Light toggle. Anyone who already picked Dark or Light with the toggle keeps their choice on that device.
- Service worker cache renamed to `ocr-studio-v2.1.1`, so returning visitors are offered the update.

## What's new in 2.1

### New features

- **Dark and light interface.** OCR Studio now uses the BhoomiTech design shared with MediaMap, BT GeoViewer and Guide Tracker: Light "Stone" (default since 2.1.1) and Dark "Graphite", both matte with a muga-gold accent. Switch with the Dark / Light toggle in the controls; the choice is remembered on each device.
  - **Site default:** set `data-default-theme="light"` (the default) or `"dark"` on the `os-frame` element in `index.html`.
  - **Per-link override:** add `?theme=light` or `?theme=dark` to the address, for example to embed or share a light version.
- **Frame.** Every screen sits in the BhoomiTech frame, with the app name and running version at the top right and the credit line underneath.
- **Copy and Paste menu.** Right-clicking in a text field (the extracted text, the keyboard box, the source and model fields) shows a small menu with only Copy and Paste. Right-click is off everywhere else.
- **Code protection.** Developer-tools, view-source and save-page shortcuts, developer tools found open, opening a script or style file directly, and fetching those files from the console all return to `index.html`. Text in the extracted-text box is kept and restored. See "Code protection" below for what this can and cannot do.
- The controls panel remembers whether it was open or closed.

### Bug fixes

- Messages shown while a dialog was open appeared behind the dialog. They now show on top of it.
- "Choose a file first" and similar warnings used browser pop-ups that blocked the page; they are now messages at the bottom of the screen.

### Design and other changes

- Onest typeface bundled in `vendor/onest/` (SIL Open Font License); no font is loaded from the internet.
- Grooves, recessed fields and raised buttons replace border lines; corners are 4px at most; labels in sentence case.
- Perspective handles and outline use the gold accent; the page image itself is never recoloured.
- Icon-only buttons have spoken labels for screen readers; keyboard focus is visible; animations stop when the device asks for reduced motion.
- Debug logging removed from the shipped scripts.
- Service worker cache renamed to `ocr-studio-v2.1.0`, so returning visitors are offered the update.
- Optional `.htaccess` for Apache hosts (see "Code protection").

## Code protection

`js/protect.js` and the service worker discourage casual copying of the app's JavaScript and CSS. They cannot make the code secret: a browser must download the code to run it, so anyone determined can still read it (for example with JavaScript switched off, a download tool, or by deactivating breakpoints in developer tools). Treat it as a deterrent, not security.

- Opening `app.js`, `style.css` or any other file directly in the address bar returns to `index.html` once the app has been opened once (the service worker handles it). On Apache hosts, the included `.htaccess` does the same on the very first visit; GitHub Pages ignores it.
- To debug the app yourself, remove the `<script src="js/protect.js">` line from `index.html` (and reload twice so the service worker picks up the change).
- On phones and tablets, long-pressing text shows the system's own text toolbar, which web pages cannot replace.

## What's new in 2.0

- **Fully offline recognition.** The Tesseract engine and the Bengali, Assamese and English models (`vendor/tesseract/`, about 14 MB) ship with the app and are precached by the service worker. Version 1 downloaded them from jsdelivr on first use, so OCR failed offline. The header shows "Works offline" once everything is cached.
- **Faster.** One recognition worker is reused across pages. Version 1 rebuilt the whole engine for every page.
- **Saving and exporting** (download button):
  - **Text file:** corrected Unicode text (UTF-8, NFC).
  - **Searchable PDF:** the page image with Tesseract's hidden text layer. The layer holds the machine-recognised text, not your corrections. *(Since 3.0 the layer holds your corrected text.)*
  - **Page bundle (.zip):** page image, corrected text, recognised text, reading (WAV), searchable PDF, `metadata.json`, and training lines.
  - **Training lines (.zip):** line images with corrected text (`.png` + `.gt.txt`, the tesstrain format).
- **Collection.** "Add" keeps pages on the device. The collection exports as one corpus: `corpus.txt`, `corpus.jsonl` (text plus source details per page), `pages/` and `training/`.
- **Source details.** Title, author, year, edition, publisher or source, language, script, permission, digitised by, place, notes. These are remembered per file and written into every export. Pages marked "Community use only" are flagged in the collection README.
- **Custom language models.** You can add a Tesseract `.traineddata` (or `.gz`) file, for example a Bishnupriya Manipuri model trained from this app's training lines. Damaged or unsuitable files are reported instead of hanging.
- **Handwriting.** No available model reads handwritten Eastern Nagari reliably, so version 2 speeds up manual transcription instead. The keyboard button opens a Roman-to-script keyboard (the LexiPic Bishnupriya Manipuri rules) that types into the text beside the zoomable page.
- **Image tools:** Enhance (greyscale and contrast stretch), B/W (Otsu threshold) and Reset, alongside Deskew and Perspective.
- **Recordings** now stay with the page (playback, save, bundle and collection) instead of downloading immediately.
- **Fixes:**
  - The language selector was hidden on phones.
  - Firefox recording failed because the microphone sample rate did not match.
  - Long messages were cut off.
  - The old service worker cache never updated. Updates are now offered with a tap.

## Training a model for your language

1. Recognise pages with BN or BN/AS and correct the text, keeping **one line of text per printed line**. The status line shows "Training lines ready" when the lines match.
2. Add the pages to the collection and export it. The `training/` folder holds the line pairs.
3. Train with [tesstrain](https://github.com/tesseract-ocr/tesstrain), fine-tuning from `ben` or `asm`.
4. Load the resulting `.traineddata` under **Language models** and select it.

## Machine voice

Voices are not included in this folder, because they are large and have their own licences. Two are prepared for OCR Studio:

| Folder | Voice | Size | Licence |
|---|---|---|---|
| `ben-syspin-f` | Bengali female, SYSPIN project, IISc Bengaluru (`SYSPIN/vits_Bengali_Female`), 22 kHz | about 60 MB | MIT; trained on the SYSPIN corpus (CC-BY 4.0) |
| `ben-mms` | Bengali, Meta MMS (`facebook/mms-tts-ben`), 16 kHz | about 60 MB | CC-BY-NC 4.0, non-commercial only |

Install them once:

1. Open `voice-tools/convert_voice.ipynb` in Google Colab and choose *Runtime → Run all* (about 10 minutes; no Hugging Face account is needed). It plays a test sentence for each voice and downloads `ben-syspin-f.zip` and `ben-mms.zip`. To make only one, set the other to `False` in the second cell. On a computer, the commands are at the top of `convert_voice.py`.
2. Unzip them into `vendor/tts/voices/`, so that you have `vendor/tts/voices/ben-syspin-f/voice.json` (and `model.onnx.part1`, `model.onnx.part2`), and the same for `ben-mms`.
3. `vendor/tts/voices/voices.json` already lists both. The first one installed in that list is the default; reorder the list to change it.
4. Upload the folder as usual.

**What it sounds like.** The Bengali voices read Eastern Nagari text with Bengali pronunciation, so Bishnupriya Manipuri words will not always sound right. Letters it does not know are replaced (ৰ → র, ৱ → ব) or skipped, and so are digits and punctuation. The app says this when it asks to download a voice, and shows the voice's credit and licence there and on the Machine voice bar.

**A Bishnupriya Manipuri voice.** Recordings made with Record, together with their corrected text, are the training data for a voice of your own: a few hours from one steady reader is a good start. Fine-tune one of the Bengali voices on them (VITS fine-tuning, for example with Hugging Face's `finetune-hf-vits` for the MMS voice, or Coqui TTS for the SYSPIN voice; a female reader suits the SYSPIN voice), convert the result with the same script and `--language bpy`, put it in a new folder such as `vendor/tts/voices/bpy-1/`, and add it to `voices.json`:

```json
{ "voices": [
  { "id": "bpy-1",        "name": "Bishnupriya Manipuri" },
  { "id": "ben-syspin-f", "name": "Bengali female (SYSPIN)" },
  { "id": "ben-mms",      "name": "Bengali (Meta MMS)" }
] }
```

Give a changed voice a new folder name rather than replacing files in an old one, so devices that already have the old voice download the new one.

**Speed.** On a recent phone or laptop, speech is usually made about as fast as it plays or faster. On older devices there may be short gaps between sentences. The first visit after installing or updating uses one processor core; from the next visit the service worker allows several.

## Deploy

Upload the folder to any HTTPS static host, such as GitHub Pages. Change `CACHE` in `service-worker.js` on each release. Keep every file below 100 MB (GitHub Pages' limit); the voice converter already splits the voice into parts.

The service worker adds the cross-origin isolation headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) to everything it serves, which GitHub Pages cannot do itself. This lets the voice use several cores. All of the app's files come from its own site, so nothing else is affected. If you ever load a script, font or image from another site, that site must allow it (CORS or `Cross-Origin-Resource-Policy`), or it will be blocked.

## Licences

Tesseract.js and tesseract.js-core are Apache-2.0 (see `vendor/tesseract/`). The invisible "GlyphLessFont" embedded in searchable PDFs (`js/pdfwriter.js`) comes from Tesseract and is Apache-2.0. The tessdata models are Apache-2.0. PDF.js is Apache-2.0 and Lucide is ISC. Onest is SIL OFL 1.1 (`vendor/onest/OFL.txt`). ONNX Runtime Web 1.29.0 is MIT (`vendor/tts/ort/LICENSE-onnxruntime-web.txt`).

Meta's MMS text-to-speech voices are CC-BY-NC 4.0: free to use with credit, for non-commercial purposes only. The SYSPIN Bengali female voice is MIT-licensed and was trained on the SYSPIN corpus (IISc Bengaluru, CC-BY 4.0); please credit SYSPIN when you publish its readings. The app shows the credit and licence when it asks to download the voice and on the Machine voice bar.
