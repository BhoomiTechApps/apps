# GeneaMap — responsive rewrite

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
