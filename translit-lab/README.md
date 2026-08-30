# Transliteration Lab

A local browser-based test module for the CompilingAI WordPress plugin.
Test PHP and JS transliteration logic side-by-side without touching the plugin.

## Requirements

- PHP 8.1+ with a local web server (Apache, Nginx, or `php -S`)
- A modern browser (Chrome, Firefox, Edge)

## Quick Start

```bash
# Navigate to the lab folder
cd translit-lab/

# Start PHP's built-in server
php -S localhost:8181

# Open in browser
open http://localhost:8181
```

## File Structure

```
translit-lab/
├── index.html        ← Main UI (all tabs, editors, test runner)
├── engine.js         ← JS engine (copied from plugin, unmodified)
├── engine.php        ← PHP engine (standalone mirror of class-engine.php)
├── api.php           ← Backend: handles all AJAX calls from the UI
├── forwardMap.json   ← Default forward map (Roman → BPM)
├── reverseMap.json   ← Default reverse map (BPM → Roman)
├── defaults.json     ← Default snippets (copied from plugin)
└── data/             ← Working copies (auto-created on first run)
    ├── snippets.json
    ├── forwardMap.json
    └── reverseMap.json
```

The `data/` folder is auto-created on first run by copying the defaults.
Edits in the UI are saved to `data/` — the root `*.json` files remain
as clean factory defaults for the Reset button.

## Tabs

### ⚡ Test
The main workspace. Three columns:

- **Left** — Snippet list with enable/disable toggles. Enabled snippets
  are passed to both engines on each run.
- **Center** — Input box, direction toggle (Forward / Reverse), Run button,
  and dual engine output panels (JS and PHP) with coloured log traces.
  Press **Ctrl+Enter** inside the input box to run.
- **Right** — Snippet editor. Select a snippet on the left to edit it here,
  or click **+ New** to create a blank one.

### ✂️ Snippets
Full table view of all snippets. Enable/disable, quick-edit (jumps to
Test tab), delete, and add new. **Save All** persists to `data/snippets.json`.

### 🗺️ Maps
Side-by-side JSON editors for the forward and reverse maps.
Use **Validate JSON** before saving. Changes are saved to `data/*.json`.

## Snippet Schema

Each snippet has:

| Field | Values | Notes |
|---|---|---|
| `snippet_key` | string | Unique identifier |
| `label` | string | Display name |
| `hook_stage` | `pre` / `loop` / `post` | When it runs |
| `direction` | `forward` / `reverse` / `both` | Which direction |
| `sort_order` | number | Lower = earlier |
| `is_active` | 0 / 1 | Toggle in UI |
| `js_body` | function string | Full JS function for browser engine |
| `php_body` | JSON rules array | Rule objects for PHP engine |

### JS body format
A complete function expression (not just the body):
```js
function mySnippet(state, config) {
  // modify state.input (pre), state.output (loop/post)
  // push to state.log for trace entries
  return state;
}
```

### PHP body format
A JSON array of rule objects:
```json
[
  { "type": "replace", "from": "from-string", "to": "to-string", "regex": false },
  { "type": "replace", "from": "/pattern/u",  "to": "replacement", "regex": true }
]
```
Loop-stage rules also support context conditions:
- `"context_output_ends_with"` — output must end with this string
- `"context_prev_was_consonant"` — true/false
- `"context_next_token_in"` — section name in the active map

## Engine Behaviour

Both engines implement the same pipeline:

1. **Pre hooks** — run on the raw input string
2. **Forward loop** (4 hardcoded core steps + external loop hooks + default map lookup)
   or **Reverse loop** (loop hooks + default map lookup)
3. **Post hooks** — run on the accumulated output string

When outputs differ between JS and PHP, the UI highlights the
differing characters in red and shows a **≠ diff** badge.

## Reset to Defaults

The **↩ Reset Defaults** button in the header restores `data/snippets.json`,
`data/forwardMap.json`, and `data/reverseMap.json` from the root defaults.
