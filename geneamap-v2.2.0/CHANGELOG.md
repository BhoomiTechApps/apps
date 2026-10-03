# GeneaMap changelog

## 2.2.0 — Fits any container

### New features
- **Fits whatever box it is placed in.** The app now sizes itself to its container (an iframe, a panel, a widget area) instead of the browser window, from a full screen down to about 240 × 200. It never scrolls the page and nothing spills outside the box.
- **Layout follows the container's own size:** two columns when there is room; controls under the tree in narrow boxes; two columns again in wide, low boxes; a compact header and footer in low boxes; and in very small boxes the controls start folded to a single toolbar row (search, add, connect).
- **Stays centred when the container is resized:** the part of the tree in the middle of the canvas stays in the middle.
- **Opens sensibly in a different-sized box:** the saved view remembers the canvas size; if the app opens in a container of a clearly different size, it fits the whole tree to it instead of reusing a view that would show only a corner.
- **Full screen** button under View, to enlarge the app from a small box.

### Bug fixes
- "Add person" and "Connect" no longer get clipped in a narrow controls column; they switch to icons.
- The canvas is measured again after the controls fold away at start-up, so the first fit uses the real canvas size.

### Design and other changes
- Layout breakpoints are now container queries instead of screen-size media queries; only touch, hover, reduced-motion and print rules still look at the device.

---

## 2.1.0 — BhoomiTech frame and themes

### New features
- **Two-column layout:** the family tree fills the larger left column; all controls sit in a column on the right. On phones and portrait tablets the controls move under the tree and can be folded down to their toolbar; landscape phones keep both columns.
- **Grouped controls:** a fixed toolbar (Undo, Redo, Add person, Connect, Search) above scrollable accordion sections: Add a person, Map and file, Import and export, Tools, View, Legend and Shortcuts. Open sections are remembered on each device. The legend and the shortcut list now live in the panel instead of on the canvas.
- **Interface theme:** Light ("Stone", the default) and Dark ("Graphite"), under **View → Interface theme** or the **T** key. A previous "Auto" choice becomes Light.
- **Copy and paste menu:** right-clicking a text field shows a small menu with only Copy and Paste.
- **Version shown** at the top right of the frame.

### Bug fixes
- Pressing Enter in the search box no longer opens the found person for editing (the next keystrokes used to land in the Name field).
- Pressing Escape in the search box no longer clears the current selection.
- The dark theme had a self-referencing shadow colour, so shadows were dropped.
- "No connection found" in the Relationship finder referred to a colour that did not exist.
- Primary buttons turned pale on hover with white text that was hard to read; search highlights had low contrast.
- Canvas positions stay correct when the window is resized without the canvas changing size.

### Design and other changes
- BhoomiTech frame: 10px border, header with name and version, inset stage, credit line.
- Matte surfaces with fine grooves instead of border lines, recessed fields, raised buttons and cards, corners of 4px or less, one gold accent, sentence-case labels.
- Person cards are raised plates with a coloured top edge per gender; relationship paths are highlighted in violet so they never clash with the gold selection.
- Every emoji in the interface, menus, messages and PNG export replaced with consistent line icons; messages show a coloured stripe for success, warning or error.
- Onest typeface bundled in `assets/vendor/onest/` (SIL OFL); Google Fonts requests removed, so the app makes no outside requests.
- The minimap is now a switch under View; the separate legend setting was removed.
- Faster: moving around the tree saves only the view instead of the whole tree; all code runs inside one closure, which also lets the minifier shrink `code.min.js` (about 5 KB smaller despite the new features).
- **Code access:** the browser's context menu is blocked; F12, Ctrl+U and the developer-tools shortcuts, or opening the developer tools, return the page to `index.html`; typing the address of a script or stylesheet returns to `index.html` (service worker, plus the included `.htaccess` on Apache); app data and functions can no longer be reached from the console. This is a deterrent: anything a browser runs can still be read with enough effort. The editable `dev/` copy is not restricted so it can be debugged; `.htaccess` blocks `dev/` on the server.

---

## 2.0.0 — responsive rewrite

## Responsive & touch
- Full Pointer Events support: one-finger pan, two-finger pinch-zoom, drag nodes, long-press (≈0.5 s) for context menus, double-tap to edit / add a person at that spot.
- Toolbar collapses to icons on tablets; on phones the File/Fit actions move into the drawer, the sidebar becomes a slide-over panel with a scrim, and modals become bottom sheets.
- Uses 100dvh and safe-area insets (notches, home indicator); larger hit targets and 16px inputs on touch screens (no iOS zoom-on-focus).
- Short-landscape, reduced-motion, print, and keyboard focus-visible styles.

## Bug fixes
- Connection menu no longer destroys the context menu; Connect button state now matches connect mode; handle drag-to-connect works outside connect mode.
- Panning no longer deselects; Delete/Esc no longer fire behind open dialogs.
- Deleting a person removes all orphaned SVG labels.
- Search highlighting no longer corrupts escaped HTML.
- Relationship Finder: fixed off-by-one greats, co-parents mislabelled as siblings, stale references.
- Minimap: HiDPI, correct viewport clamping.
- Service worker: paths are now relative (deploy anywhere), no cache-forever trap, correct offline fallback, update prompt.
- Consistent theme colours in manifest; object URLs no longer revoked before download; merge no longer produces NaN positions.

## Performance
- Single requestAnimationFrame render loop with dirty flags; only links touching moved people are recomputed.
- Nodes positioned with transforms; cached sizes via ResizeObserver; no per-frame layout reads.
- Minimap redraws only when needed; fonts load non-blocking; heavy backdrop blur removed.
- Icons compressed (~200 KB → ~33 KB for the 512px icon).

## New features
- Undo / redo (Ctrl+Z / Ctrl+Y), autosave to the browser with restore on reopen.
- Open/Save via the File System Access API (with download fallback), drag-and-drop a file onto the window, OS file handler for .json/.ged when installed.
- GEDCOM import/export, PNG export, Import & Merge.
- Tidy Layout (generation rows, spouses side by side, animated & undoable).
- Relationship Finder rewrite: cousins N× removed, in-laws, step-relations, plain-words chain, clickable path and on-map highlight.
- Multi-select (Shift-drag marquee, Ctrl+A), arrow-key nudging, quick-add parent/child/spouse/sibling, family-junction lines from couples to children, help panel with shortcuts.

## Development
Edit sources in `dev/` (open `dev/index.html` directly while developing — the service worker is skipped there).
Build the production files at the root with:

    npm i -g terser clean-css-cli   # once
    ./build.sh

This minifies to `code.min.js` / `style.min.css`, generates `index.html`, and bumps the service-worker cache version.

## Colour scheme update
- New clear light theme (default) and a matching dark theme; follows the system setting, or switch with **More → Theme** / the **T** key (Auto → Light → Dark).
- Connection colours use a colour-blind-safe palette with different line styles too: Parent/Child = solid slate, Spouse = orange dashed, Sibling = green dashed, Other = grey dotted.
- People cards are tinted by gender (blue / pink / grey) with a thicker coloured top edge; the legend now explains the card colours.
- Selection is a single indigo accent; relationship paths and search hits are highlighted in amber, so they never clash with link colours.
- PNG exports always use the light palette for printing.

## Relationship rules (live validation)
Every link is checked against the current tree while you connect, edit or change it.

**Blocked (⛔ problems):** linking someone to themselves or linking a pair twice; loops in the family line (becoming your own ancestor); a third parent (use “Other” for step/adoptive parents); a sibling, cousin or other wrong-generation relative as parent; partners who are ancestor/descendant, siblings, or aunt/uncle–niece/nephew; siblings from different generations; parents not older than their child, younger than 10 at the birth, or (mothers) dead before it (fathers get ~1 year); partners where one died before the other was born; a person dying before being born.

**Allowed but flagged (⚠ warnings):** parent aged under 14 or unusually old; first cousins as partners; partnering a partner’s child; siblings with no parents in common, more than two parents between them, a step-parent as sibling, or 35+ years apart; a person living over 120 years.

**Where it shows up**
- Dragging a link: the target turns red if nothing is allowed, and the status bar says which relationships fit.
- Connection picker: impossible choices are struck through with the reason; warnings and tips appear under each option.
- Right-click/long-press menus: “Change to…”, “Swap parent and child” and “Add parent” are disabled with the reason when they’d break a rule.
- Person form: date conflicts appear as you type; saving is blocked only if the edit introduces a new impossibility.
- Tree Check (More → Check Tree, **V**, or the ⚠ chip): lists every problem in the tree, with Show / Remove link / Edit. People and links with problems get a red or amber marker.
- Opened, imported and GEDCOM files are never altered — problems are flagged for review instead.
- Relationships are worked out through parent links, and sibling links count as sharing parents, so rules apply even where parents aren’t recorded.
