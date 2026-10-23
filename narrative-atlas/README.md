# Narrative Atlas 2.0.0 — Progressive Web App

Paste a passage of research (a migration history, an account of a community's origins, a travel narrative) and get a map plotted as narrated, with period-appropriate routes and a critical review that flags where the narrative departs from established history.

Developed by Shankar Sinha for BhoomiTech Heritage and Development Foundation under CDEP.

Narrative Atlas is a standalone progressive web app: `index.html`, a web app manifest (`manifest.webmanifest`) and a service worker (`sw.js`). There is no server-side code. Every setting, API key, reference file, place-name list and cached place lookup is saved in the browser on the user's own device, and requests go from that device straight to the services the user chose (the AI provider, Wikidata, OpenStreetMap Nominatim, Tavily, the map tiles).

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The app |
| `manifest.webmanifest` | Web app manifest: name, icons, colours, standalone display |
| `sw.js` | Service worker: offline copy of the app, updates, sends direct visits to code files back to `index.html` |
| `icons/` | App icons (SVG, 192, 512, maskable 512, Apple touch icon) |
| `assets/guard.min.js` | Loaded first: developer-tools and source-view guard |
| `assets/app.min.js`, `assets/app.min.css` | The app's scripts and styles (minified) |
| `assets/vendor/` | Leaflet 1.9.4, Leaflet.PolylineDecorator, pdf.js, mammoth, the Onest typeface |
| `assets/data/` | Natural Earth river network (route shaping), place-name list template |
| `.htaccess` | Server rules for Apache / LiteSpeed |
| `nginx.conf.example` | The same rules for nginx |

## Deploy

1. Upload the whole folder to any web host that serves static files over **HTTPS** (service workers and installation require HTTPS; `localhost` also works for testing). It can sit at the site root or in a sub-folder such as `/narrative-atlas/`; all paths are relative.
2. Open `index.html` in a browser. The service worker registers on the first visit and keeps an offline copy.
3. Install: Chrome, Edge and Android show "Install app"; on iPhone and iPad use Share → "Add to Home Screen". The app also offers an install button in its toolbar and in Settings → About and install when the browser allows it.
4. Each user opens **Settings** (gear button), chooses an AI provider, enters their key and clicks "Test connection".

After uploading a new version, open the app once: the service worker fetches the new version and uses it the next time the app opens. The header shows the running version (v2.0.0).

## Embedding in another page

The app fills whatever box it is shown in, from a phone-sized box to a full screen. To place it in another page, use an iframe and give the box a size:

```html
<div style="height: 85vh; border-radius: 4px; overflow: hidden">
  <iframe src="/narrative-atlas/index.html" title="Narrative Atlas"
    style="width: 100%; height: 100%; border: 0; display: block"
    allow="fullscreen; clipboard-read; clipboard-write; local-network-access" allowfullscreen></iframe>
</div>
```

Optional URL parameters: `?theme=dark` (or `light`, the default) and `?basemap=osm|opentopo|esri_phys|carto_light` set the starting theme and basemap until the user picks their own. Inside an iframe, the toolbar's install button opens the app in its own window, where it can be installed.

## Settings (saved on the device)

* **AI provider** — provider, API key, model ("Fetch models"), backup model, base URL for local and custom providers, "Test connection", maximum text length, and which providers appear in the AI menu beside Draw map.
* **Review and sources** — flag historical doubts, check against sources, Tavily API key, trusted-websites list (add, edit, import, export, reset; compatible with BhoomiTech Evaluator's trusted-sources JSON).
* **Historical routes** — on / optional / off, route shape, elevation tiles.
* **Map and place names** — default basemap, custom tile URL and attribution, Nominatim contact email, Wikidata, place-name lists (gazetteers), lookup cache.
* **Display** — interface theme: Light "Stone" (default) or Dark "Graphite"; the notice under the text box.
* **Data on this device** — save settings to a file (optionally with keys) and load them on another device, ask the browser to keep the data, reset, delete everything.

## AI providers

Requests go directly from the browser to the provider.

* Free, on your own computer: **Ollama** (start it with `OLLAMA_ORIGINS` set to the app's address, or `*`), **LM Studio** (switch on "Enable CORS").
* Free tier: Google Gemini, Groq, Cerebras, Mistral AI, OpenRouter, GitHub Models.
* Paid: Anthropic Claude, OpenAI, DeepSeek, Perplexity Sonar, xAI Grok, Together AI.
* Any OpenAI-compatible endpoint that accepts requests from web pages (CORS).

A provider that refuses requests made directly from web pages is reported in plain words, and another can be chosen.

## Code protection

* Right-click is switched off throughout the app. In text fields (the research text, search boxes, settings fields) a small menu offers only **Copy** and **Paste**.
* F12, Ctrl/Cmd+Shift+I, J, C or K (developer tools and console), Ctrl/Cmd+U (page source) and Ctrl/Cmd+S (save page) send the app back to `index.html`. Opening the developer tools by any other route also returns to `index.html`, and the app stays covered while they are open.
* Opening `sw.js` or any file under `assets/` ending in `.js` or `.css` directly in the browser goes back to `index.html`: through the service worker in every browser once the app has been opened, and on the server through `.htaccess` (Apache, LiteSpeed) or `nginx.conf.example`.
* Scripts and styles are minified.

Browsers always give a determined person a way to read the code they run, so these measures keep casual inspection out; they do not make the code secret. API keys are never part of the code: each user enters their own, and they stay on that user's device.

## Privacy

The text goes from the user's device to the AI provider they configured. Place names go to OpenStreetMap Nominatim and Wikidata; with "Check against sources", short search queries go to Tavily. Map tiles come from the chosen tile provider. The host serving the app receives only the requests for the app's own files.

## Fair use of free services

* Nominatim: at most one request per second, one at a time, results cached on the device for 30 days (all handled by the app). Users should enter a contact email in Settings → Map and place names.
* The public OpenStreetMap and OpenTopoMap tile servers are for light use; for heavy use set a custom tile URL (MapTiler, Stadia Maps, Thunderforest…).

## Limits

* Identifying historical places is hard; always check the Places list.
* Region extents are circles, not historical boundaries. Shaped routes use today's terrain and rivers.
* The critical review and the reconstructed routes reflect the AI's general knowledge and can be wrong; treat them as prompts for checking.
* Settings are per browser and per device; use Settings → Data on this device to carry them across.

## Licences

Narrative Atlas: GPL-2.0-or-later. Leaflet (BSD-2-Clause), Leaflet.PolylineDecorator (MIT), pdf.js (Apache-2.0), mammoth (BSD-2-Clause), Onest typeface (SIL OFL 1.1, `assets/vendor/onest/OFL.txt`), Natural Earth rivers (public domain).

## Changelog

### 2.0.0
* Narrative Atlas is now a standalone progressive web app with a web app manifest and a service worker; the WordPress plugin is no longer needed.
* All settings, keys, reference files and place-name lists are saved on the user's device; settings files carry them to another device.
* Requests go straight from the device to the AI provider, gazetteers and Tavily.
* The app fits any box it is embedded in.
* Light "Stone" is the default theme, with a toolbar toggle; Dark "Graphite" remains available.
* No right-click except Copy / Paste in text fields; developer tools, console, page source and direct visits to code files return to `index.html`.
* Unticking every trusted website no longer searches all of them.
