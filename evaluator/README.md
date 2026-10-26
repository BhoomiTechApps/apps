# Evaluator PWA (v16.8.0)

## Changelog 16.8.0: organisation servers, community lists, browser extension, hosting

**Organisation servers** (`server/`, provider `org`). A school, college or group can hold the AI and Tavily
keys on a small relay server; members connect with the server's address and an access code and need no keys.
Per-code daily allowances, a server-wide ceiling, allowed origins, a model allowlist, searches only within the
trusted domains sent, requests rebuilt field by field. Runs on Node.js 18+ (`server/node.mjs`, no packages) or
Cloudflare Workers (`server/worker.mjs`, optional KV for counts). Full guide: `server/README.md`.
In the app: Settings › AI model and search › *Your organisation's server*; the setup guide offers it on its
first page; the usage line shows what is left today. New settings-file keys: `org`, `listCatalogs`.

**Hosting your own copy** (`config.js`). Plain data, no secrets: `server` makes the setup guide greet people
with the organisation's name and ask only for a code; `listCatalogs` adds catalogues of community lists.
See *Hosting Evaluator* below.

**Community source lists** (`js/lists.js`, `community/`). Settings › *Community lists* shows catalogues
(`community/index.json` comes with the app; more from `config.js` or added by address). Every website is shown
before anything is added; updates are offered when a list's date changes, and only add. Any topic can be shared
as a list (link `#list=` or a file). Three lists come with the app: Indian fact-checkers, Indian official
statistics, Assam and Northeast India. `community/validate.mjs` checks list files and writes `index.json`;
format and how to run a catalogue: `community/README.md`.

**Browser extension** (`extension/`, Manifest V3; Chrome, Edge, Brave, Firefox 121+). Right-click a selection
to check it as a claim, or a page or link to find claims in it; the toolbar button sends a screenshot of the
tab to the claim finder. The app accepts `?claim=` (fills in the statement) besides `?text=` and `?url=`, and a
screenshot by `postMessage` from the extension's helper on its own pages. Guide: `extension/README.md`.

**Fixed**: requests to a model server on this computer (Ollama, LM Studio, or an organisation server on
localhost) were refused by Chrome, because they declared the wrong network address space (`local` instead of
`loopback`).

Help has three new sections; all new text is in Assamese and Bengali too.

## Hosting Evaluator

Evaluator is a set of static files: any web server or static host can serve it (GitHub Pages, Netlify,
Cloudflare Pages, an ordinary web server). It must be served over **https** (or from `localhost`), since
installing, offline use and the settings file all need a secure page. Nothing on the host needs a database or
a server-side language.

- Upload everything except `server/`, `extension/` and `serve.js` (they are harmless if uploaded, but unused).
- `config.js` is the only file to edit: the organisation server's address and name, and catalogues of
  community lists. It holds no secrets.
- After changing any file, people get the new version the next time they open the app (the service worker
  fetches app files from the network first).
- To give members access without their own keys, run the organisation server (`server/README.md`) and add
  the app's address to its `ALLOWED_ORIGINS`.

## Changelog 16.7.0: sharing, citations, second opinions, batch checking, class mode

No server is involved in any of this: links carry their data inside them (`#report=`, `#class=`,
`#submission=`; JSON, deflate-raw compressed, base64url, with an uncompressed fallback), and everything else
stays in each person's browser.

**Under every result** (second row of buttons; `js/share.js`, `js/cite.js`, `js/compare.js`):
- **Share link**: the whole result in the link. Opens read only for anyone, without keys, with a banner and
  *Save to my recent results*. Everything arriving by link or file is rebuilt field by field
  (`sanitizeResult`: allowed values only, URLs through `safeUrl`, numbers clamped, text escaped on output).
- **Save as web page**: one self-contained HTML file (colours, links, no scripts). *Download for Word* now
  shares the same export code.
- **Cite sources**: APA 7, MLA 9, Chicago, BibTeX and RIS (Zotero, Mendeley, EndNote). No invented authors or
  dates: the result's date is used as the access date, site names are trimmed from page titles, local files are
  cited as unpublished documents. Copy or download.
- **About the evidence** (Summary and Detailed views): pieces of evidence, websites, primary vs secondary;
  warns when one side rests on a single website or nothing is a primary source; shows your own notes on each
  website from Trusted sources.
- **Second opinion**: another provider or model judges the same statement, reusing the saved evidence where it
  can (`runAnalysis({ use })`). Shows *Agrees / Partly agrees / Disagrees* by distance on the verdict scale, and
  claim by claim in Verify. Kept with the result (`second`); the second result is saved to Recent results.

**Check several claims at once** (Trace; `js/batch.js`). Up to 20 claims, one per line, run one after
another with one mode, or the button the claim finder suggested for each (*Check all these claims*). Stop
works between and during claims. A scorecard lists every verdict, links to each result, and downloads as CSV.

**Class** (new page; `js/classroom.js`). Teachers make an assignment (title, instructions, a topic and its
websites, claims, mode or students' choice) and send it as a link or file. Students join (the topic and
websites are added like a starter pack), check each claim with their own keys, write their own conclusion for
each, and send their work back as a link (if it fits) or a file. Teachers see a grid of verdicts and
conclusions per student and claim, open any result read only, and download the grid as CSV.

Help has three new sections; all new text is in Assamese and Bengali too. Download file names are plain ASCII.

## Changelog 16.6.0: claim finder, local models, accessibility

**Claim finder** (Trace › "Find claims in a text, link or screenshot"; `js/claims.js`). Picks the claims worth
checking out of:
- *Text*: an article, post or WhatsApp forward in any language (up to 20,000 characters);
- *Web link*: read with Tavily Extract using your Tavily key (1 credit per 5 pages); the page is only where the
  claims come from, never evidence;
- *Screenshot*: chosen, pasted (Ctrl+V) or dropped; your AI model reads it (needs a model that can see images,
  such as Gemini). The text read from the picture is shown.
Each claim is rewritten to stand on its own, keeps the material's language, and comes with a suggested button.
Picking one fills in the statement and highlights that button.
On Android, the installed app is a **share target**: Share from WhatsApp or a browser › Evaluator opens the
finder with the text or link (`share_target` in the manifest).

**Models on your own computer** (provider "On this computer (Ollama, LM Studio)"; settings `localUrl`, default
`http://localhost:11434/v1`). Any OpenAI-compatible local server. Settings has the address, presets and
**Test connection**; the setup guide offers it under "Another provider"; Help › "Using a model on your own
computer" covers `OLLAMA_ORIGINS`, LM Studio's CORS switch and Chrome's local-network permission. Requests to
local addresses get `targetAddressSpace: 'local'` and a longer time limit (12 minutes); `<think>` blocks from
reasoning models are removed. With a topic of only local folders, nothing leaves the computer.

**Accessibility.**
- Automated audit (axe-core, WCAG 2.1 A/AA and best practice) on every screen, in English, Assamese and
  Bengali, light and dark: no violations. Colours were adjusted to meet 4.5:1 contrast; switched-off sources
  are shown in the muted colour instead of faded.
- **Text size**: Normal / Large / Larger (Settings › Language and appearance; `textSize` 100/115/130).
- **Listen**: reads the verdict and summary (or the Simple version) aloud with the device's voices, in the
  right language; Assamese falls back to a Bengali voice, and the app says when a voice is missing.
- Skip link, page landmarks, a new result is announced to screen readers and receives focus, the model's
  writing carries its own `lang`, keyboard-operable tabs in the claim finder, visible focus everywhere.

Translations for all of this are in `i18n/as.js` and `i18n/bn.js`.

## Changelog 16.5.0: Assamese and Bengali

**Interface languages.** English, অসমীয়া (Assamese) and বাংলা (Bengali). Choose from the globe menu in the
header or Settings › Language and appearance. The choice is saved in the settings file (`"language": "en" | "as" | "bn"`),
and the page reloads in the new language. Menus, buttons, messages, errors, the setup guide, starter packs,
result labels and all of Help are translated. Source names, domains and model names stay in English on purpose.

**Language of new results** (Settings › Language and appearance; `"resultLanguage"` in the settings file):
"Same as the interface" (default), or a fixed language. The AI model is asked to write summaries, points,
reasoning and Simple view in that language; JSON keys, verdict values and source markers stay as they are, and
searches are still made in English, since most trusted sources are English. A statement typed in Assamese or
Bengali is understood; the search planner translates its key terms. The footnote says which language a result
was written in. Earlier results are not changed. The examples carry a Simple version in all three languages.

**How it works.** `js/i18n.js` loads the language file (`i18n/as.js` or `i18n/bn.js`) before the page is drawn,
translates the page, and watches for text the app adds later (whole sentences, so word order stays natural).
Code uses `tr('… {name} …', { name })` and `trn(n, one, many)`. Anything marked `translate="no"` (statements,
the model's writing, source titles) is never touched. Browser `alert`/`confirm` messages are translated too.
Text with no translation simply shows in English.

**Font.** Noto Sans Bengali (SIL OFL, `vendor/noto-bengali/`) is bundled for Bengali-script text, so it looks the
same on every device and works offline. Latin text keeps Onest.

**Please have the translations reviewed by native speakers** before wide release, especially Assamese.
They are in `i18n/as.js` and `i18n/bn.js`: English on the left, translation on the right; keep `{placeholders}`
and HTML tags exactly as they are.

## Changelog 16.4.0: getting started

**Setup guide.** On first visit (when no keys are set up) a step-by-step guide opens:
1. *AI model*: choose Gemini (recommended, free), Groq or another provider. Short instructions with a link
   to each provider's key page. A pasted key is recognised by its prefix (for example a Groq key pasted into
   the Gemini box offers to switch to Groq) and **tested before it is saved** with a free read-only request
   (a model list, or Tavily's usage). If the provider's default model isn't offered to that key, a suitable
   one is chosen from the list.
2. *Search*: the Tavily key, tested the same way, or the model's own search for Claude and OpenAI. Can be
   skipped for local-files-only use.
3. *Topics*: tick starter packs to add, then "Try a first claim" fills in an example claim and topic.
"Later" is remembered; the guide stays available from the Trace page (while setup is unfinished), the scope
line, Settings › AI model and search › *Open the setup guide*, and Help › Quick start.

**Starter packs** (`packs.json`, Settings › Starter packs). Eight one-click topics with trusted websites:
South Asian history, World history, Indian law and policy, Health and medicine, Economics and development,
Climate and environment, News fact-checks, Mathematics and logic. Adding a pack creates its topic (or reuses
one with the same name), adds missing sites and maps sites you already have. Nothing is removed and sites
you switched off stay off. Edit `packs.json` to change or add packs.

**Examples** (`samples.json`). Five prepared results, one per kind of analysis, open from the empty result
pane without any key. They were built by the app's own pipeline from sources checked by hand on 26 October
2026, and every citation passed the app's check. Each is labelled as an example, and *Run this claim
myself* fills it in and runs it live (or opens the setup guide first).

**Simple view.** Results now have *Simple / Summary / Detailed*. Simple is a plain-words version (headline,
short explanation with source numbers, "the catch", what to check next), written by the model from the
finished result only, in one small extra request (using the fast model if one is set). It is kept with the
result in Recent results, so it is made once, and included in *Copy as text*. The chosen view is remembered.
For Support and Challenge, the headline rates that side's case rather than declaring the statement true.

Files: new `js/onboarding.js`, `packs.json`, `samples.json`; changes in `index.html`, `styles.css`,
`js/core.js`, `js/store.js` (`installPack`, `Packs`), `js/results.js` (Simple view), `js/prompts.js`
(`PLAIN_SYSTEM`), `js/manage.js`, `js/settings.js`, `js/main.js`, `sw.js` (new files cached, version bump).

## Changelog 16.3.3

**Design and other changes**
- The interface now starts in the **Light** (stone) theme by default. Dark (graphite) is still available under
  Settings › Appearance. Anyone who already has `"theme": "dark"` in their settings file keeps the dark theme;
  change it to `"light"` there (or pick Light in Settings) to switch.

Progressive Web App version of the Evaluator WordPress plugin. Same interface and features; no server.

## Run it
Serve this folder over HTTPS (or http://localhost for testing), e.g. `node serve.js 8080`, then open http://localhost:8080.
(`python3 -m http.server 8080` also works, but it cannot do the code-file redirect described below.)
Use the browser's "Install app" / "Add to Home Screen" to install.

## Settings file
All API keys and settings live in one file: `Evaluator/evaluator-settings.json`.

- Default location: the app's private folder on the device (created automatically, no prompt).
- Chrome/Edge on a computer: Settings › Settings file › "Choose where to keep it…" puts the
  `Evaluator` folder in a location you pick (e.g. Documents), so you can edit the file directly.
  A mirror copy stays in the app's folder.
- The file is read every time the app opens; every change in Settings is written back at once.
- Edit it in-app (Settings › Settings file › Edit the settings file) or externally, then "Reload from file".
- Invalid JSON never overwrites your file; the last good settings stay in use.

Format:
```json
{
  "keys": { "gemini": "", "groq": "", "openrouter": "", "mistral": "", "openai": "", "anthropic": "", "tavily": "" },
  "provider": "gemini",
  "models": { "gemini": "gemini-2.5-flash" },
  "helperModels": {},
  "search": "tavily",
  "maxSearches": 4,
  "searchFocus": "own",
  "theme": "light",
  "appHeight": 0
}
```
Keys are stored in plain text: keep the file private.

## Right-click and code files (16.3.2)

- **Right-click is off everywhere** in the app. In a text field (the statement box, the settings-file editor,
  the API key boxes and the other text inputs) a small menu offers only **Copy** and **Paste**. It also opens
  with the Menu key or Shift+F10 (arrow keys, Enter, Esc) and never takes focus from the field. Copy is greyed
  out when nothing is selected and for a hidden API key (press Show first); Paste goes through the browser's
  own editing, so the statement box's length limit and undo work as with Ctrl+V. Paste from the menu needs
  clipboard permission (Chrome asks once; Firefox and Safari show a small *Paste* button; unavailable on plain
  `http://` other than localhost); when refused, the menu says to use Ctrl/Cmd+V.
- On phones and tablets text fields keep the system's long-press toolbar, which a web page cannot change.
  Long-press callouts are off elsewhere.
- The DevTools and view-source shortcuts (F12, Ctrl/Cmd+Shift+I/J/C/K, Ctrl/Cmd+U, Cmd+Opt+I/J/C/U) do nothing.
- **Opening a `.js`, `.css` or `.map` address directly** (address bar, a link, or `location = 'js/main.js'` in
  the console) redirects to `index.html`. `sw.js` does this once the app is installed in the browser; the server
  must do it for the first visit and for Shift+Reload. `serve.js` does. On your own server, redirect only
  requests with `Sec-Fetch-Mode: navigate` and send `Vary: Sec-Fetch-Mode` with code files:

```nginx
# nginx, inside server { } (change /index.html if the app lives in a sub-folder)
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

  Static hosts that cannot read request headers (e.g. GitHub Pages) can only rely on the service worker.

**What this does not do.** A browser must download the code to run it, so it can always be read: in the
DevTools *Sources* and *Network* panels (opened from the browser's menu), with Shift+right-click in Firefox,
by saving the page, or with `curl`. These measures stop casual viewing only. pdf.js and mammoth are
open-source (licences in `vendor/`) and their notices must stay available.

## Files
- `index.html` – the app (was templates/app.php)
- `js/settingsfile.js` – the settings file (new)
- `js/providers.js` – direct calls to AI providers and Tavily (port of class-evaluator-providers.php)
- `js/settings.js` – keys, model, search, appearance and settings-file panels
- `js/guard.js` – right-click rules, the Copy / Paste menu, the DevTools-shortcut block (loaded first)
- `js/share.js`, `js/cite.js`, `js/compare.js`, `js/batch.js`, `js/classroom.js` – sharing, citations and
  evidence notes, second opinion, batch checking, class mode (16.7)
- `js/lists.js` – community source lists (16.8); `config.js` – settings for whoever hosts this copy
- `server/` – the organisation server; `community/` – lists and the catalogue checker; `extension/` – the browser
  extension (16.8)
- `sw.js`, `manifest.webmanifest` – installable/offline support
- `serve.js` – local test server (`node serve.js [port]`); not needed on the real server
- other `js/`, `lib/`, `vendor/`, `styles.css` – unchanged app code (WordPress sync removed from store.js)
