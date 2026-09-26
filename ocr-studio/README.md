# OCR Studio 2.0

Offline OCR for printed Eastern Nagari (Bengali–Assamese script) and English, for community heritage and corpus work. Everything runs in the browser; nothing is uploaded.

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

Tesseract.js and tesseract.js-core are Apache-2.0 (see `vendor/tesseract/`). The tessdata models are Apache-2.0. PDF.js is Apache-2.0 and Lucide is ISC.
