# Lekhoni 5.2.0

## Hyperlinks
- **Link text**: highlight words and press Ctrl+K (or Text › Hyperlink…) to link them to a web address, an email address, a phone number, or another page of the document. With nothing highlighted you can type the text to show.
- **Link a whole object** (picture, shape, text box, table) from Arrange › Hyperlink on the whole object.
- Links stay clickable in PDFs made with PDF / Print › Save as PDF, including links that jump to another page.
- With the cursor in a link a small bar shows where it goes (Open · Edit · Remove). Ctrl+click follows a link in the editor.
- Links in opened files are checked: only web, email, phone and page links are kept.

## Text wrap
- Any object can make text flow round it (Frame › Text wrap): **No wrap**, **Wrap round the frame**, **Wrap round the outline** (ellipses, triangles, diamonds, stars) or **Jump** (text stops above and carries on below), with an adjustable offset.
- Text goes round the side with more room; text in linked frames wraps too. A text box can be set to ignore wraps (for captions over pictures).
- Frames with several columns or a rotation don't wrap.

## Text flowing through linked frames
- A story can run from one text frame into others, on the same page or later pages (Frame › Text flow): **Flow into a frame…** (then click an empty frame), **Flow to next page** (makes a matching frame on the next page, adding a page if needed), **Stop flow here**.
- Typing, formatting, find & replace and undo work across the whole story; paragraphs and numbered lists split across frames carry on correctly.
- Small markers show where text flows in and out; the overset + appears only on the last frame.
- Deleting the first frame keeps the story in the frames that remain.

## Selecting several objects, groups
- Shift+click to add or remove objects; drag across an empty part of the page to select everything it touches; Ctrl+A selects everything on the page.
- Move, nudge, scale (corner handle), copy, cut, paste, duplicate, delete, hide/show, lock, change opacity and restack several objects at once.
- **Group** (Ctrl+G) and **Ungroup** (Ctrl+Shift+G). Clicking a group selects it; clicking a text box in it again lets you edit the text.
- Align to each other, to the margins or to the page; **Distribute** three or more objects with equal gaps (or equal centre spacing when they overlap).

## Paragraph-level alignment
- With the cursor in the text, the alignment buttons now change only that paragraph (or every highlighted paragraph). With the box selected but not being edited, they set the whole box.

## Measurement units
- Millimetres, centimetres, inches or points (Page › Units) for the rulers and every length in the panel and Page setup: positions, sizes, margins, gutter, bleed, indents, paragraph spacing, column gaps, inset, offsets. Stored in mm as before.

## Also
- Drop caps keep a whole conjunct (ক্ষ, ত্র…) as the large letter, instead of only its first consonant.
- Hyphenate English words (Text › Spacing).
- More shortcuts: Ctrl+K, Ctrl+A, Ctrl+G, Shift+click, Ctrl+click.

# Lekhoni 5.1.0

A desktop-publishing pass: page setup, typography and object handling brought up to what a layout job needs. Documents from 5.0.x open unchanged.

## Text formatting
- **Format just the highlighted words**: font, size, colour, bold, italic, underline, strikethrough, superscript, subscript and highlight colour apply to the selection; with nothing highlighted they apply to the whole box (as before). The panel shows the formatting at the caret.
- **Real paragraphs**: Enter starts a new paragraph, Shift+Enter breaks the line inside one. First-line indent now applies to every paragraph, not only the first line of the box.
- New paragraph settings: space before / after, left and right indents, word spacing, drop caps (2–4 lines), case (UPPERCASE, lowercase, Title Case, Small Caps).
- **Bulleted and numbered lists**, with Bengali (১, ২, ৩), Western, roman or letter numbering and a choice of bullet.
- **Paragraph styles**: Body text, Heading 1/2, Caption and Quote built in; save your own from any box, update a style to restyle every box that uses it, delete styles.
- Clear formatting; A−/A+ size steps (Ctrl+[ / Ctrl+]); size list of common point sizes.
- **Find & replace** across every page, text box and table cell (match case, whole words; Ctrl+F).

## Text frames
- Columns inside a text box (1–6) with gap; inset; vertical alignment (top / middle / bottom); fill colour and border.
- **Overset mark**: a red + appears when text doesn't fit its frame. *Fit frame to text* sizes the frame to its content.

## Page setup
- Portrait / landscape switch (margins turn with the paper).
- More sizes: A3, A4, A5, A6, B4, B5, Letter, Legal, Tabloid, Executive, 5.5 × 8.5 in and 6 × 9 in book sizes, or custom.
- Page columns and gap set directly (no longer only through templates).
- Page colour; **bleed** and **crop marks** for press printing (the printed sheet grows to fit; bleed shown on screen as a dashed red line).
- Header and footer: left / centre / right / outside / inside alignment, size, colour, rule line, font.
- Page numbers: roman numerals (i, ii / I, II), outside-edge position for books, size and distance from the edge.
- Per page: hide header, footer and number (for chapter openers and covers).
- Pages: duplicate, move up/down (from the Page tab or the page thumbnails).
- Document title, used as the file name when saving.
- Fix: applying a template no longer resets the page to A4 or wipes an existing header/footer.

## Objects
- Exact position and size (X, Y, W, H in mm), rotation, opacity and **lock**.
- Align to page margins or page edges (left, centre, right, top, middle, bottom).
- Bring forward / send backward one step (as well as to front / to back).
- Copy, cut, paste and duplicate objects (Ctrl+C / X / V / D); arrow keys nudge 1 mm (Shift: 5 mm); Shift-drag the corner keeps proportions; Alt-drag turns off snapping. Objects also snap to the page centre.
- Images and shapes drag by their body; text boxes and tables by the tab that appears above them when selected (it no longer covers the first line of text).
- Shapes: change type (rectangle, ellipse, triangle, diamond, star with any number of points, line), no fill, dashed or dotted outlines, rounded corners. Lines can be horizontal, vertical or diagonal and have arrowheads. Shapes are drawn at true size, so outline widths are real points.
- Images: fit inside, fill frame (crop) or stretch; fill and border.
- Tables: insert/delete rows and columns, cell fill and text colour for a cell, row, column or the whole table, cell alignment and vertical alignment, border width/colour and padding. Table frames grow to enclose their rows.

## View & output
- Zoom menu with 50–300%, Fit page and Fit width.
- Backgrounds (page colour, table shading, frame fills) now print.
- The toolbar still fits on one row at 1024 px.

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
