# OCR Studio 2.1

Version: 2.1.1

Offline OCR for printed Eastern Nagari (Bengali–Assamese script) and English, for community heritage and corpus work. Everything runs in the browser; nothing is uploaded.

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
  - **Searchable PDF:** the page image with Tesseract's hidden text layer. The layer holds the machine-recognised text, not your corrections.
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

## Deploy

Upload the folder to any HTTPS static host, such as GitHub Pages. Change `CACHE` in `service-worker.js` on each release.

## Licences

Tesseract.js and tesseract.js-core are Apache-2.0 (see `vendor/tesseract/`). The tessdata models are Apache-2.0. PDF.js is Apache-2.0 and Lucide is ISC. Onest is SIL OFL 1.1 (`vendor/onest/OFL.txt`).
