# Evaluator PWA (v16.3.3)

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
- `sw.js`, `manifest.webmanifest` – installable/offline support
- `serve.js` – local test server (`node serve.js [port]`); not needed on the real server
- other `js/`, `lib/`, `vendor/`, `styles.css` – unchanged app code (WordPress sync removed from store.js)
