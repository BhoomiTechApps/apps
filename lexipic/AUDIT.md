# LexiPic 1.2.2 → PWA 2.0.0: pre-conversion audit

This records what was found in the WordPress plugin before porting, what the PWA does about each item, and what still needs attention. Items marked **Plugin only** live in server code the PWA no longer has; they still apply if the plugin stays in service.

## 1. Critical functional bugs (fixed in the PWA)

**F1. Entries could not be saved in Firefox, and often not in Safari.** Audio recording was started from inside the speech-recognition button. Where `SpeechRecognition` does not exist (Firefox), the button was disabled, so no audio could be recorded, and saving requires audio. The recorder was also hard-coded to `audio/webm`, which throws on Safari versions without WebM recording; the catch block then told the user "Microphone access denied", which was wrong. *PWA:* recording is its own control, the container format is negotiated with `MediaRecorder.isTypeSupported()` (WebM/Opus, then MP4/AAC, then Ogg), and errors say what actually happened.

**F2. Recordings were cut short and the microphone stayed on.** The recorder stopped the moment recognition returned a result, often mid-word, and the `MediaStream` tracks were never stopped, so the browser's mic indicator stayed lit. *PWA:* the user stops the recording (auto-stop at 30 s), the mic is released on stop and when the app is hidden, and a playback control lets the contributor check the take before saving.

**F3. "Listening…" could stick forever.** No `onend` handler: if recognition ended without a result, the button never reset and no audio was produced. *PWA:* dictation is a separate, optional button with `onend`/`onerror` handling and specific messages (no speech, blocked, unsupported locale, offline).

**F4. Typing in the Roman field replaced it with native script.** The handler wrote the forward transliteration back into `romanInput` as well as `scriptInput`, and restored a caret position that no longer matched. *PWA:* Roman drives script and script drives Roman; neither overwrites itself. IME composition events are respected.

**F5. The keyboard ignored the set's language.** Each set stores a language, but the IME maps and speech locale were always the site-wide default. *PWA:* both follow the selected set.

## 2. Security issues (Plugin only)

**S1. Stored XSS through the image endpoint (high).** `decode_image()` accepts any MIME type from the data URI, `sanitize_mime_type()` lets `text/html` through, and `serve_image()` echoes the stored bytes with that `Content-Type` from the site's own origin. Any logged-in user, including a subscriber on a site with open registration, can POST `image: "data:text/html;base64,…"` and send an admin the image URL. Fix: whitelist `image/jpeg|png|webp|gif`, verify with `getimagesizefromstring()`, and send `X-Content-Type-Options: nosniff` and `Content-Disposition: inline`. *PWA:* import applies the same whitelist (tested: an HTML payload posing as a photo is dropped).

**S2. Tab access control is only cosmetic.** `can_write()` returns `is_user_logged_in()`. The per-tab username lists only hide the UI; every REST write (create set, add entry, import, export) is open to any account. Fix: check the `tab_access` lists (or a custom capability) in the permission callbacks.

**S3. Any logged-in user can delete any entry.** `delete_entry` has no ownership or capability check, unlike `delete_set`.

**S4. Audio bypasses the "public archive" setting.** Files sit in `wp-content/uploads/lexipic/` with guessable names (`audio_{id}_{time}`), and `GET /sets/{id}/entries` returns the absolute server path in `audio_path`. Fix: stop returning `audio_path`, add `Deny from all` / nginx rules for the folder, and serve only through the REST route.

**S5. No payload size limits** on base64 image/audio, and no check that audio is audio.

**S6. `Cache-Control: public` on images** from archives that may be private, so shared caches or CDNs can serve them to logged-out visitors.

## 3. Other bugs

| # | Where | Problem | PWA |
|---|---|---|---|
| F6 | app.js | `[lexipic set="slug"]` never pre-selected anything: options were matched on `data-slug`, which was never set. | Fixed. Deep links use `#set=slug`, and the last-opened set is remembered. |
| F7 | class-db.php | `language VARCHAR(10)`, but language codes may be 20 characters. Longer codes are truncated and no longer match. | No length limit. **Plugin:** widen to `VARCHAR(20)`. |
| F8 | IME manager | Deleting a language leaves sets pointing at a code that no longer exists. | Blocked while any set uses it. |
| F9 | class-db.php | `CREATE TABLE IF NOT EXISTS` passed to `dbDelta()` and no stored schema version, so the tables can never be migrated. | Versioned IndexedDB upgrades. **Plugin:** plain `CREATE TABLE` plus a `lexipic_db_version` option. |
| F10 | file-handler | `audio/mpeg` is saved with an `.mp4` extension. | N/A (Blobs keep their type). |
| F11 | app.js | `URL.revokeObjectURL()` right after `click()` can cancel the export download. | Revoked after 30 s. |
| F12 | app.js | Transparent PNGs turn black when flattened to JPEG; 400 px cap made photos hard to read. | White fill; 960 px cap. |
| F13 | app.js | Each tap creates a new `Audio`, so recordings overlap. | One shared player with play/stop state. |
| F14 | app.js | Dictation output was lower-cased (harmless for Bengali script, wrong for Latin-script languages) and only `.` was stripped. | No case change; strips `.`, `।`, `!`, `?`. |
| F15 | import | Missing `set.name` raised a PHP notice; entries with no word were imported. | Falls back to the file name; empty entries skipped and reported. |
| F16 | app.js | Hook sort re-looked-up each hook by function name, mis-ordering hooks that share a name. | Sorts on the hook definitions. |
| F17 | IME upload | A hooks file whose JavaScript does not compile was accepted with no warning and silently disabled. | Rejected at upload with the compiler message. |
| F18 | plugin | The REST nonce is baked into the page HTML and into image/audio URLs, so full-page caching serves expired nonces and logged-in users hit 403s after 12 to 24 h. | N/A. **Plugin:** exclude the page from caching or fetch the nonce with AJAX. |

## 4. Enhancements added in the PWA

Works fully offline after the first visit (service worker app shell, fonts cached on first use), installable on Android, desktop and iOS, and in-app update prompt. Photos can come from the camera or the gallery. Photo is now optional (for abstract words such as kinship terms); the word and a recording are still required. Entries can be edited (text, photo or recording), deletions can be undone, and sets can be renamed or have their language changed. The archive has a word filter, a grid view, a "3 of 12" counter, and keyboard navigation (arrow keys, Space to play). Exports can be shared through the system share sheet on phones. "Back up everything" produces one file with all sets plus custom languages and keyboard files, and a restore brings them back. The Settings tab shows storage use and last backup date, requests persistent storage, and has a "Try the keyboard" box for testing uploaded maps. Dark mode, visible focus, reduced-motion support and 44 px touch targets are included.

Export files are identical in shape to the plugin's `/sets/{id}/export`, so sets move between the plugin and the PWA in both directions. The legacy prototype format (`heritage`/`transliteration` arrays) still imports.

## 5. What changes, and known limitations

**Data lives on one device.** No server, no accounts, no multi-user access control, and no sync. Moving data between devices or contributors is done with export/import or the full backup. For a community archive with many contributors, keep the plugin (with section 2 fixed) as the shared store and use the PWA for offline field capture, importing results into WordPress.

**Browsers can clear site data.** The app asks for persistent storage and shows backup status; installing the app makes the request far more likely to be granted. Regular backups are still the real safeguard.

**Audio format depends on the recording device.** Chrome and Firefox record WebM/Opus; Safari records MP4/AAC. Current Safari plays WebM, but older iPhones may not play recordings made on Android. The plugin's FFmpeg MP3 conversion has no in-browser equivalent short of bundling ffmpeg.wasm (about 30 MB), which I left out.

**Dictation needs a connection** in Chrome and Edge because recognition runs on the vendor's servers, and locale support for `bn-IN`/`as-IN` varies. Recording, typing and the IME work offline.

**All three built-in languages use the same Bishnupriya Manipuri maps** (inherited from the plugin). Those maps output Assamese letters such as ৰ and ৱ, so Bengali sets produce ৰ where র is expected. This needs a linguist-authored Bengali map uploaded under Settings → Languages.

**Snippet hooks execute code.** Hook files are compiled with `new Function`, so the Content-Security-Policy must allow `'unsafe-eval'`. The app warns before loading hook files; only accept them from trusted sources.

**Not ported:** the WordPress admin screens (their functions are in Settings), FFmpeg conversion, per-user permissions, and translation files (UI is English only).
