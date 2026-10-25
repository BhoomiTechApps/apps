# Lekhoni 5.0.3

- **Table resizing:** drag any column or row border inside a table. Columns keep at least 4 mm; rows never shrink below their text. Sizes are saved with the document, scale with the table when the box is resized, and are part of undo.
- **New logo:** a feather quill in an inkpot, used in the toolbar, browser tab, and install icons (including maskable icons for Android).
- **Version shown** next to the name in the top-left (v5.0.3), taken from the same constant the service worker uses.

# Lekhoni 5.0.2

## Toolbar & panels
- Top bar holds only document-wide actions, each with an icon **and** a label, grouped under captions: Project (Open, Save, Close), Output (Print, PDF), Edit (Undo, Redo), Insert (Text, Image, Table · Box, Circle, Star, Line), Typing (বাংলা / অসমীয়া, Phonetic), View (Zoom, Panel).
- New Properties panel on the right with tabs:
  - **Text** — font, size, add font file, bold/italic/underline, colour, alignment, line/letter spacing, indent.
  - **Shape** — fill, outline colour, outline width.
  - **Arrange** — bring to front, send to back, hide, show, delete.
  - **Page** — template, page setup, ruler units, keyboard shortcuts.
- The panel switches to the right tab when you select or place an object (it stays put while you're on Page), and shows a hint when nothing applicable is selected.
- Panel can be hidden with the Panel button; the choice and last tab are remembered.
- Save status now sits under the app name; the bar fits on one row down to 1024 px wide.
- Clearer icons (star, arrange, visibility, page setup) and plain-language labels throughout.

# Lekhoni 5.0.1

## Phonetic typing
- Words convert live as you type; roman letters never stay on the page when you click, use arrow keys or switch boxes.
- Backspace steps back through the word being typed (খা → খ → ক).
- Typing over a selection replaces it.
- Enter inserts one line break (was two). Existing documents are cleaned up on load.
- Paste is plain text (no foreign formatting).
- `k'Sh` → ক‌ষ (ZWNJ mid-word); a trailing or leading ' is an ordinary quote mark.
- Ctrl+Z inside text uses the browser's text undo, which now works with phonetic input.
- Ctrl+M toggles phonetic typing. Native IMEs (composition input) are left alone.
- Language buttons switch ৰ/র through the map's `lang_overrides`.

## Saving & undo
- Saves to IndexedDB (no 5 MB localStorage limit, so images no longer fill storage). Old localStorage documents migrate automatically.
- Pending changes are saved when the tab is hidden or closed.
- Each discrete action (move, hide, delete, style…) is its own undo step; typing is grouped per pause.
- Undo history stores each image once instead of copying it per step.
- Photos larger than 3000 px are downscaled on import.

## Editor
- Only the current page is drawn on screen (pages were stacked with no gap).
- Print and Export to PDF output every page, one per sheet (was only the first page).
- Hidden boxes stay visible as faint outlines so they can be selected and shown again; they are not printed.
- Zoom scrolls correctly at every level; Ctrl+wheel zooms.
- Drag, resize and guides use pointer events (touch and pen work).
- Typography inputs (line height, tracking, indent) show the selected box's values.
- Table font family/size can be changed; table font size now applies; columns are even.
- Images keep their proportions; double-click replaces an image.
- Column guides are drawn for two- and three-column templates and boxes snap to them.
- Opening a .pub registers its custom fonts, resets to page 1 and clears undo history.
- Open/Save work without the File System Access API (Firefox, Safari).
- Text loaded from .pub files is sanitized (no scripts or event handlers).
- Closing a project now actually clears the saved document.

## Offline
- One version string (5.0.1) across index.html and the service worker; all scripts, including the hooks, are precached.
- index.html and the transliteration map are network-first, so map fixes reach users on the next online load (the old data cache never updated).
