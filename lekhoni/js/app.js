/**
 * app.js — editor logic for the Bengali/Assamese desktop-publishing PWA.
 *
 * Model: one document = array of pages; each page = array of boxes
 * (text, image, table, shape), positioned/sized in millimetres so print
 * output matches the screen exactly.
 *
 * v5.3.0: Save as Word (.docx), InDesign (.idml) and plain text (.txt) — see js/saveas.js.
 *
 * v5.2.0: hyperlinks, text wrap, text flowing through linked frames, multi-select & groups,
 *         per-paragraph alignment, measurement units, conjunct-safe drop caps.
 *
 * v5.1.0
 *  - Character formatting on highlighted text (font, size, colour, highlight,
 *    bold/italic/underline/strike, super/subscript); box-level otherwise.
 *  - Real paragraphs (Enter) with space before/after, left/right/first-line
 *    indents, lists, drop caps, case, word spacing, paragraph styles.
 *  - Text frames: columns, inset, vertical alignment, fill, border, overset mark.
 *  - Page setup: orientation, more sizes, columns, page colour, bleed and crop
 *    marks, header/footer alignment/size/rule, roman numerals, per-page skip.
 *  - Objects: exact X/Y/W/H, rotation, opacity, lock, align, stacking steps,
 *    copy/paste/duplicate, nudging, more shapes, image fitting, table editing.
 *  - Find & replace, page duplicate/reorder, zoom presets.
 */
(function () {
  "use strict";

  const APP_VERSION = "5.3.4";
  const STORAGE_KEY = "bn-dtp-doc-v1";
  const DEFAULT_PAGE_W_MM = 210, DEFAULT_PAGE_H_MM = 297; // A4
  const MAX_HISTORY = 100;
  const MAX_IMAGE_SIDE = 3000; // px; larger photos are downscaled on import
  const PT_PER_MM = 72 / 25.4;
  const PX_PER_MM = 96 / 25.4; // CSS px per mm at 100% zoom (layout units)
  const DEFAULT_FONT = "'Noto Serif Bengali', serif";

  // Portrait sizes in mm (width, height).
  const PAGE_PRESETS = {
    a3: [297, 420], a4: [210, 297], a5: [148, 210], a6: [105, 148],
    b4: [250, 353], b5: [176, 250],
    letter: [215.9, 279.4], legal: [215.9, 355.6], tabloid: [279.4, 431.8], executive: [184.15, 266.7],
    book55: [139.7, 215.9], book6: [152.4, 228.6],
  };

  const NUM_WORDS = {
    bn: ["", "এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়", "দশ", "এগারো", "বারো", "তেরো", "চৌদ্দ", "পনেরো", "ষোলো", "সতেরো", "আঠারো", "উনিশ", "কুড়ি"],
    as: ["", "এক", "দুই", "তিনি", "চাৰি", "পাঁচ", "ছয়", "সাত", "আঠ", "ন", "দহ", "এঘাৰ", "বাৰ", "তেৰ", "চৈধ্য", "পোন্ধৰ", "ষোল্ল", "সোতৰ", "ওঠৰ", "ঊনৈছ", "বিছ"],
  };

  // Box properties a paragraph style carries.
  const STYLE_PROPS = [
    "fontFamily", "fontSize", "bold", "italic", "underline", "strike", "align", "color",
    "lineHeight", "letterSpacing", "wordSpacing", "indentFirst", "indentLeft", "indentRight",
    "spaceBefore", "spaceAfter", "textCase", "dropCap",
  ];

  // Link targets allowed in documents (opened .pub files are untrusted).
  const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|#page-\d+$)/i;

  // One Bengali/Assamese akshara (consonant cluster with its vowel sign and
  // marks), so a drop cap never splits a conjunct such as ক্ষ.
  const BN_C = "\u0995-\u09B9\u09DC-\u09DF\u09F0\u09F1";
  const AKSHARA_RE = new RegExp(
    `^(?:[${BN_C}]\u09BC?(?:\u09CD\u200D?[${BN_C}]\u09BC?)*(?:[\u09BE-\u09CC\u09D7\u09E2\u09E3]|\u09CD(?![${BN_C}]))*[\u0981-\u0983]*` +
    `|[\u0985-\u0994\u09E0\u09E1][\u0981-\u0983]*|\\P{M}\\p{M}*)`, "u");

  // Lengths are stored in mm; the panel can show them in other units.
  const MM_PER = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 };
  const UNIT_DECIMALS = { mm: 2, cm: 3, in: 3, pt: 1 };
  const UNIT_STEP = { mm: 0.5, cm: 0.05, in: 0.01, pt: 1 };

  const $ = (id) => document.getElementById(id);
  const uid = (p) => p + Math.random().toString(36).slice(2, 10);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round2 = (v) => Math.round(v * 100) / 100;
  const num = (v, fallback) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

  // ── Model ────────────────────────────────────────────────────────────

  function newBox(type, x, y, w, h, tableRows, tableCols) {
    const box = {
      id: uid("b"),
      type,
      x, y, w, h,
      text: type === "text" ? "" : undefined,
      imgSrc: type === "image" ? null : undefined,
      fontFamily: DEFAULT_FONT,
      fontSize: 14,
      bold: false, italic: false, underline: false, strike: false,
      align: "left",
      color: "#1b1d22",
      lineHeight: 1.2,
      letterSpacing: 0,
      wordSpacing: 0,
      indentFirst: 0,
      indentLeft: 0,
      indentRight: 0,
      spaceBefore: 0,
      spaceAfter: 0,
      textCase: "none",
      dropCap: 0,
      olStyle: "bengali",
      ulStyle: "disc",
      rotation: 0,
      opacity: 1,
      locked: false,
      wrap: "none",
      wrapOffset: 3,
      link: null,
    };

    if (type === "text") {
      Object.assign(box, {
        columns: 1, columnGap: 5, inset: 2, valign: "top",
        frameFill: null, frameBorderWidth: 0, frameBorderColor: "#000000",
        ignoreWrap: false, hyphenate: false, next: null,
      });
    }
    if (type === "image") {
      Object.assign(box, { imgFit: "contain", frameFill: null, frameBorderWidth: 0, frameBorderColor: "#000000" });
    }
    if (type === "table") {
      box.rows = tableRows || 3;
      box.cols = tableCols || 3;
      box.cells = [];
      box.borderWidth = 1;
      box.borderColor = "#000000";
      box.cellPadding = 4;
      for (let r = 0; r < box.rows; r++) {
        for (let c = 0; c < box.cols; c++) box.cells.push(newCell(r, c));
      }
    }
    return box;
  }

  function newCell(r, c) {
    return {
      id: uid("cell_"),
      row: r, col: c,
      text: "",
      bgColor: r === 0 ? "#E8E8E8" : "#FFFFFF",
      textColor: "#000000",
      bold: r === 0,
      align: "left",
      valign: "top",
      lineHeight: 1.2, letterSpacing: 0, wordSpacing: 0,
      indentLeft: 0, indentRight: 0, indentFirst: 0,
    };
  }

  function newPage() {
    return { id: uid("p"), boxes: [] };
  }

  function defaultStyles() {
    const base = {
      fontFamily: DEFAULT_FONT, fontSize: 12, bold: false, italic: false, underline: false, strike: false,
      align: "left", color: "#1b1d22", lineHeight: 1.5, letterSpacing: 0, wordSpacing: 0,
      indentFirst: 0, indentLeft: 0, indentRight: 0, spaceBefore: 0, spaceAfter: 2, textCase: "none", dropCap: 0,
    };
    const mk = (id, name, over) => ({ id, name, props: Object.assign({}, base, over) });
    return [
      mk("st-body", "Body text", { align: "justify", indentFirst: 6, spaceAfter: 1 }),
      mk("st-h1", "Heading 1", { fontFamily: "'Noto Sans Bengali', sans-serif", fontSize: 24, bold: true, lineHeight: 1.25, spaceAfter: 3 }),
      mk("st-h2", "Heading 2", { fontFamily: "'Noto Sans Bengali', sans-serif", fontSize: 17, bold: true, lineHeight: 1.3, spaceAfter: 2 }),
      mk("st-caption", "Caption", { fontSize: 9, italic: true, color: "#555555", lineHeight: 1.3, spaceAfter: 0 }),
      mk("st-quote", "Quote", { fontSize: 13, italic: true, indentLeft: 10, indentRight: 10 }),
    ];
  }

  function freshDoc() {
    return {
      title: "",
      pages: [newPage()],
      lang: "bn",
      phonetic: true,
      pageW: DEFAULT_PAGE_W_MM,
      pageH: DEFAULT_PAGE_H_MM,
      margins: { top: 20, right: 18, bottom: 20, left: 18 },
      gutter: { size: 0, mode: "alternate" },
      columns: 1,
      columnGap: 5,
      guides: [],
      showMarginGuides: true,
      pageBg: "#FFFFFF",
      bleed: 0,
      cropMarks: false,
      hfFont: DEFAULT_FONT,
      header: { enabled: false, text: "", showOnFirst: true, align: "center", size: 9, color: "#766B58", rule: false },
      footer: { enabled: false, text: "", showOnFirst: true, align: "center", size: 9, color: "#766B58", rule: false },
      pageNumber: { enabled: false, position: "bottom-center", format: "{page}", style: "native", startAt: 1, size: 9, offset: 8 },
      styles: defaultStyles(),
      customFonts: [],
    };
  }

  /** Strip anything executable from stored rich text (opened .pub files are untrusted). */
  function sanitizeHTML(html) {
    if (!html) return "";
    const tpl = document.createElement("template");
    tpl.innerHTML = String(html);
    tpl.content
      .querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button,textarea,select,svg,math,img,video,audio,source")
      .forEach((n) => n.remove());
    tpl.content.querySelectorAll("*").forEach((n) => {
      for (const a of Array.from(n.attributes)) {
        const name = a.name.toLowerCase();
        if (name.startsWith("on") || name === "contenteditable" ||
            (name === "style" && /url\s*\(|expression\s*\(|@import/i.test(a.value)) ||
            (/^(href|src|xlink:href|action|formaction)$/.test(name) && /^\s*(javascript|vbscript|data):/i.test(a.value)) ||
            (name === "href" && !SAFE_HREF.test(a.value.trim()))) {
          n.removeAttribute(a.name);
        }
      }
      if (n.tagName === "A") n.removeAttribute("target");
    });
    return tpl.innerHTML;
  }

  /**
   * Line breaks typed with Shift+Enter before 5.3.2 were stored as "\n"
   * characters; make them <br> so alignment treats the paragraph as one.
   * (The text shows exactly the same.)
   */
  function newlinesToBr(html) {
    if (!html || html.indexOf("\n") < 0) return html;
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const w = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = w.nextNode())) if (n.data.indexOf("\n") >= 0) nodes.push(n);
    for (const t of nodes) {
      const parts = t.data.split("\n");
      const frag = document.createDocumentFragment();
      parts.forEach((part, i) => {
        if (i) frag.appendChild(document.createElement("br"));
        if (part) frag.appendChild(document.createTextNode(part));
      });
      t.replaceWith(frag);
    }
    return tpl.innerHTML;
  }

  /** Fill in defaults, repair structure, migrate old content, sanitize. */
  function normalizeDoc(raw) {
    const d = freshDoc();
    const doc = raw && typeof raw === "object" ? raw : {};
    if (!Array.isArray(doc.pages) || !doc.pages.length) doc.pages = d.pages;
    if (typeof doc.pageW !== "number" || !(doc.pageW > 0)) doc.pageW = d.pageW;
    if (typeof doc.pageH !== "number" || !(doc.pageH > 0)) doc.pageH = d.pageH;
    if (typeof doc.title !== "string") doc.title = "";
    doc.margins = Object.assign({}, d.margins, doc.margins || {});
    doc.gutter = Object.assign({}, d.gutter, doc.gutter || {});
    if (!(doc.columns >= 1)) doc.columns = 1;
    if (!(doc.columnGap >= 0)) doc.columnGap = 0;
    if (!Array.isArray(doc.guides)) doc.guides = [];
    if (typeof doc.showMarginGuides !== "boolean") doc.showMarginGuides = d.showMarginGuides;
    if (!isHex(doc.pageBg)) doc.pageBg = d.pageBg;
    doc.bleed = clamp(num(doc.bleed, 0), 0, 20);
    doc.cropMarks = !!doc.cropMarks;
    if (typeof doc.hfFont !== "string" || !doc.hfFont) doc.hfFont = d.hfFont;
    // Old documents drew header/footer text in the soft ink colour at 9 pt, centred.
    doc.header = Object.assign({}, d.header, doc.header || {});
    doc.footer = Object.assign({}, d.footer, doc.footer || {});
    // Old documents put page numbers 2 mm from the edge; keep that where it was saved.
    const legacyPN = doc.pageNumber && typeof doc.pageNumber === "object" && doc.pageNumber.offset === undefined;
    doc.pageNumber = Object.assign({}, d.pageNumber, doc.pageNumber || {});
    if (legacyPN) doc.pageNumber.offset = 2;
    if (!Array.isArray(doc.styles)) doc.styles = d.styles;
    doc.styles = doc.styles.filter((s) => s && typeof s.id === "string" && typeof s.name === "string" && s.props && typeof s.props === "object");
    if (!Array.isArray(doc.customFonts)) doc.customFonts = [];
    doc.customFonts = doc.customFonts.filter((f) => f && typeof f.dataUrl === "string" && f.dataUrl.startsWith("data:") && f.family);
    if (doc.lang !== "bn" && doc.lang !== "as") doc.lang = "bn";
    if (typeof doc.phonetic !== "boolean") doc.phonetic = true;

    for (const page of doc.pages) {
      if (!page.id) page.id = uid("p");
      if (!Array.isArray(page.boxes)) page.boxes = [];
      page.skipHF = !!page.skipHF;
      for (const box of page.boxes) {
        if (!box.id) box.id = uid("b");
        if (typeof box.text === "string") {
          // v4 Enter inserted "\n" + <br> (two line breaks); keep one.
          box.text = newlinesToBr(sanitizeHTML(box.text.replace(/\n<br>/g, "<br>")));
        }
        if (box.textCase === undefined) {
          box.textCase = ["uppercase", "lowercase", "capitalize"].includes(box.textTransform) ? box.textTransform : "none";
        }
        // Text boxes from before 5.1 had a fixed 4 mm/2 mm top/bottom inset and none at the sides.
        if (box.type === "text" && box.inset === undefined) box.inset = null;
        if (box.type === "image" && box.imgSrc && !/^data:image\//.test(box.imgSrc)) box.imgSrc = null;
        if (box.link && !(typeof box.link === "string" && SAFE_HREF.test(box.link))) box.link = null;
        if (!["none", "box", "contour", "jump"].includes(box.wrap)) box.wrap = "none";
        if (box.type === "text" && box.dropCap > 1 && typeof box.text === "string") box.text = withDropCap(box.text, true);
        if (box.type === "table") {
          if (!Array.isArray(box.cells)) box.cells = [];
          for (const cell of box.cells) {
            if (typeof cell.text === "string") cell.text = newlinesToBr(sanitizeHTML(cell.text.replace(/\n<br>/g, "<br>")));
          }
        }
      }
    }
    normalizeThreads(doc);
    return doc;
  }

  // ── Persistence: IndexedDB with localStorage fallback ────────────────

  const Store = (() => {
    const DB = "lekhoni", OS = "kv";
    let dbp = null;
    function open() {
      if (!dbp) {
        dbp = new Promise((res, rej) => {
          if (!("indexedDB" in window)) return rej(new Error("IndexedDB unavailable"));
          const r = indexedDB.open(DB, 1);
          r.onupgradeneeded = () => r.result.createObjectStore(OS);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        dbp.catch(() => { dbp = null; });
      }
      return dbp;
    }
    async function get(key) {
      const db = await open();
      return new Promise((res, rej) => {
        const q = db.transaction(OS).objectStore(OS).get(key);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
    }
    async function set(key, value) {
      const db = await open();
      return new Promise((res, rej) => {
        const tx = db.transaction(OS, "readwrite");
        tx.objectStore(OS).put(value, key); // structured clone happens here, synchronously
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
      });
    }
    return { get, set };
  })();

  /** Read the localStorage copy: {t, doc} or a legacy bare doc. */
  function readLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.pages)) return { t: 0, doc: parsed };
      if (parsed && parsed.doc && Array.isArray(parsed.doc.pages)) return parsed;
    } catch (e) { }
    return null;
  }

  function writeLocal(t) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ t, doc }));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ── Undo history (images/fonts stored once, referenced by id) ───────

  const ASSET_KEYS = { imgSrc: 1, dataUrl: 1 };
  const assetIdByStr = new Map();
  const assetById = new Map();
  let assetSeq = 0;

  function snapshot(d) {
    return JSON.stringify(d, (k, v) => {
      if (ASSET_KEYS[k] === 1 && typeof v === "string" && v.length > 512) {
        let id = assetIdByStr.get(v);
        if (!id) {
          id = "\u0000A" + (++assetSeq);
          assetIdByStr.set(v, id);
          assetById.set(id, v);
        }
        return id;
      }
      return v;
    });
  }

  function unsnapshot(s) {
    return JSON.parse(s, (k, v) =>
      typeof v === "string" && v.charCodeAt(0) === 0 && assetById.has(v) ? assetById.get(v) : v
    );
  }

  // ── State ────────────────────────────────────────────────────────────

  const initialLocal = readLocal();
  const doc = normalizeDoc(initialLocal ? initialLocal.doc : null);
  window.doc = doc;

  let currentPageIndex = 0;
  let selectedBoxId = null;
  let activeTool = null;
  let zoom = 1;
  let zoomMode = null; // "fit-page" | "fit-width" | null
  let saveTimer = null;
  let saveSeq = 0;
  let lastSnap = null;
  let printing = false;
  let lastTabFor = null;
  let clipboard = null;   // JSON of a copied box
  let savedSel = null;    // { host, range } — last selection inside a text box or cell
  let activeCell = null;  // { boxId, row, col } — last focused table cell
  let lastDragEnd = 0;
  const selection = new Set();   // every selected object; selectedBoxId is the primary one
  let linkMode = null;           // { fromId } while picking the next frame of a text flow
  const flowParts = new Map();   // frame id → { html, start, len } for text flowing through frames
  let unit = "mm";               // display unit for lengths in the panel
  const history = [];
  let historyIndex = -1;

  // ── DOM refs ─────────────────────────────────────────────────────────

  const pageStage = $("page-stage");
  const pagesRail = $("pages-rail");
  const imageInput = $("image-input");
  const zoomSelect = $("zoom-select");
  const deleteBoxBtn = $("delete-box");
  const fontFamilySel = $("font-family");
  const fontSizeInput = $("font-size");
  const textColorInput = $("text-color");
  const fontInput = $("font-input");
  const propsPanel = $("props-panel");
  const setupOverlay = $("setup-overlay");
  const tableOverlay = $("table-overlay");
  const findOverlay = $("find-overlay");

  // Zoom sizer: the stage is scaled with a transform, which doesn't change its
  // layout size, so a wrapper is sized to the scaled box to give correct scrolling.
  const zoomSizer = document.createElement("div");
  zoomSizer.className = "zoom-sizer";
  pageStage.parentNode.insertBefore(zoomSizer, pageStage);
  zoomSizer.appendChild(pageStage);

  // ── Status bar ───────────────────────────────────────────────────────
  //
  // One row: message · page · selection · words/characters · overset ·
  // size in memory · size on disk · autosave. Items drop off on narrow windows.

  const sbMsg = $("sb-msg"), sbSave = $("sb-save");
  const WARN_RE = /^(Could not|Not saved|Locked|Some of these|A table needs|Pick a|That frame|The text is longer|Phonetic typing unavailable|Select one|Click into|Highlight the text)/;
  let msgTimer = null;
  let disk = null;          // { name, size, snap, downloaded } — the project file last saved or opened

  /** Show a message at the left of the status bar. It dims after a while but stays readable. */
  function note(text) {
    sbMsg.textContent = text;
    sbMsg.title = text;
    sbMsg.classList.toggle("warn", WARN_RE.test(text));
    sbMsg.classList.remove("stale");
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => sbMsg.classList.add("stale"), 8000);
  }
  window.lekhoniNote = note;

  /** Autosave to this browser: "saving" | "saved" | "error". */
  function saveState(state) {
    sbSave.classList.toggle("saving", state === "saving");
    sbSave.classList.toggle("error", state === "error");
    sbSave.textContent = state === "saving" ? "Saving…" : state === "error" ? "Not autosaved — storage full" : "Autosaved";
    scheduleStatus();
  }

  const fmtInt = (n) => n.toLocaleString("en-IN");
  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
    return (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + " MB";
  }
  const TYPE_NAME = { text: "Text box", image: "Picture", table: "Table", shape: "Shape" };
  const SHAPE_NAME = { rectangle: "Rectangle", circle: "Ellipse", ellipse: "Ellipse", polygon: "Triangle", triangle: "Triangle", diamond: "Diamond", star: "Star", line: "Line" };

  let quickQueued = false, statsTimer = null;
  function scheduleStatus() {
    if (!quickQueued) {
      quickQueued = true;
      requestAnimationFrame(() => { quickQueued = false; updateStatusQuick(); });
    }
    clearTimeout(statsTimer);
    statsTimer = setTimeout(updateStatusStats, 700);
  }

  /** Cheap parts: page, selection, overset, disk. */
  function updateStatusQuick() {
    $("sb-page").textContent = `Page ${currentPageIndex + 1} of ${doc.pages.length}`;

    const sel = selectedBoxes();
    let selText = "";
    if (sel.length > 1) selText = `${sel.length} objects selected`;
    else if (sel.length === 1) {
      const b = sel[0];
      const name = b.type === "shape" ? SHAPE_NAME[b.shapeType] || "Shape" : b.type === "table" ? `Table ${b.rows}×${b.cols}` : TYPE_NAME[b.type] || "Object";
      selText = `${name} · ${toU(b.w)} × ${toU(b.h)} ${unit}` + (b.rotation ? ` · ${b.rotation}°` : "") + (b.locked ? " · locked" : "");
    }
    $("sb-sel").textContent = selText;

    const over = pageStage.querySelectorAll(".box.overset").length;
    const ov = $("sb-overset");
    ov.hidden = !over;
    ov.textContent = over ? `⚠ ${over} frame${over === 1 ? "" : "s"} overset` : "";

    const d = $("sb-disk");
    if (!disk) {
      d.textContent = "Not saved to a file";
      d.title = "Save writes a project file (.pub) to your disk; until then your work is kept only in this browser";
      d.classList.remove("sb-disk-mod");
    } else {
      const changed = lastSnap !== disk.snap;
      d.textContent = `On disk ${fmtBytes(disk.size)}` + (changed ? " · changed" : "");
      d.classList.toggle("sb-disk-mod", changed);
      d.title = `${disk.name}${disk.downloaded ? " (downloaded)" : ""} — ${fmtInt(disk.size)} bytes` +
        (changed ? "\nThe document has changed since it was saved to this file. Save (Ctrl+S) to update it." : "\nUp to date");
    }
  }

  let memFor = null, memDoc = 0;
  /** Heavier parts, after typing pauses: words/characters and memory. */
  function updateStatusStats() {
    // Text of every story (linked frames once) and table cell.
    const tpl = document.createElement("template");
    let all = "";
    for (const p of doc.pages) for (const b of p.boxes) {
      const parts = b.type === "text" ? [b.text] : b.type === "table" ? (b.cells || []).map((c) => c.text) : [];
      for (const h of parts) {
        if (!h) continue;
        tpl.innerHTML = String(h).replace(/<br\s*\/?>|<\/(p|div|li|h\d|blockquote)>/gi, "\n$&");
        all += tpl.content.textContent + "\n";
      }
    }
    const noBreaks = all.replace(/\n/g, "");
    const chars = Array.from(noBreaks).length;
    const charsNoSpace = Array.from(noBreaks.replace(/\s/g, "")).length;
    const words = (all.match(/[^\s।॥|,;:!?.“”"'()‘’—–-]+/gu) || []).length;
    let clusters = null;
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      clusters = 0;
      const seg = new Intl.Segmenter(doc.lang === "as" ? "as" : "bn", { granularity: "grapheme" });
      for (const _ of seg.segment(noBreaks.replace(/\s/g, ""))) clusters++; // eslint-disable-line no-unused-vars
    }
    const c = $("sb-count");
    c.textContent = `${fmtInt(words)} words · ${fmtInt(chars)} characters`;
    c.title = `Words: ${fmtInt(words)}\nCharacters (with spaces): ${fmtInt(chars)}\nCharacters (no spaces): ${fmtInt(charsNoSpace)}` +
      (clusters != null ? `\nLetters as you see them (aksharas, no spaces): ${fmtInt(clusters)}` : "") +
      "\nCounts every text box and table cell; header and footer not included.";

    // Size in memory: the document as it stands (what a project file would be now),
    // plus the undo history kept alongside it.
    if (memFor !== lastSnap) { memFor = lastSnap; memDoc = new Blob([JSON.stringify(doc)]).size; }
    let hist = 0;
    for (const h of history) hist += h.length * 2;          // JS strings: 2 bytes a character
    for (const a of assetById.values()) hist += a.length;   // pictures/fonts held once for undo
    const m = $("sb-mem");
    m.textContent = `In memory ${fmtBytes(memDoc)}`;
    const heap = performance && performance.memory ? performance.memory.usedJSHeapSize : 0;
    m.title = `Document: ${fmtBytes(memDoc)} (${fmtInt(memDoc)} bytes) — about the size the project file would be if saved now` +
      `\nUndo history (${history.length} step${history.length === 1 ? "" : "s"}): about ${fmtBytes(hist)}` +
      (heap ? `\nWhole app in the browser: about ${fmtBytes(heap)}` : "");
  }

  // ── Saving ───────────────────────────────────────────────────────────

  function scheduleSave() {
    saveState("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 400);
  }
  window.scheduleSave = scheduleSave;

  /** Save now as its own undo step (for discrete actions, not typing). */
  function commit() {
    flushSave();
  }

  /** Record pending changes in history and persist them now. */
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const snap = snapshot(doc);
    if (snap === lastSnap) {
      saveState("saved");
      return Promise.resolve();
    }
    pushHistory(snap);
    lastSnap = snap;
    return persist();
  }

  function persist() {
    const seq = ++saveSeq;
    const t = Date.now();
    return Store.set(STORAGE_KEY, { t, doc })
      .then(() => {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
        if (seq === saveSeq) saveState("saved");
      })
      .catch(() => {
        if (seq !== saveSeq) return;
        if (writeLocal(t)) saveState("saved");
        else { saveState("error"); note("Could not save in this browser (storage full) — use Save to keep a file"); }
      });
  }

  function flushOnLeave() {
    if (saveTimer) {
      flushSave();
      // IndexedDB may not finish while the page unloads; keep a synchronous copy too.
      writeLocal(Date.now());
    }
  }
  window.addEventListener("pagehide", flushOnLeave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnLeave();
  });

  // ── History ──────────────────────────────────────────────────────────

  function pushHistory(snap) {
    history.splice(historyIndex + 1);
    history.push(snap);
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
    updateUndoRedoButtonState();
  }

  function resetHistory() {
    history.length = 0;
    historyIndex = -1;
    lastSnap = snapshot(doc);
    pushHistory(lastSnap);
  }

  function restoreSnapshot(snap) {
    replaceDoc(unsnapshot(snap), { keepSelection: false });
    lastSnap = snap;
    persist();
    updateUndoRedoButtonState();
  }

  function undo() {
    if (saveTimer) flushSave(); // so the latest edit is the step being undone
    if (historyIndex > 0) restoreSnapshot(history[--historyIndex]);
  }

  function redo() {
    if (saveTimer) flushSave();
    if (historyIndex < history.length - 1) restoreSnapshot(history[++historyIndex]);
  }

  function updateUndoRedoButtonState() {
    $("btn-undo").disabled = historyIndex <= 0;
    $("btn-redo").disabled = historyIndex >= history.length - 1;
  }

  /** Swap the whole document in place (other modules hold a reference to `doc`). */
  function replaceDoc(next, opts) {
    Object.keys(doc).forEach((k) => delete doc[k]);
    Object.assign(doc, next);
    window.doc = doc;
    currentPageIndex = clamp(currentPageIndex, 0, doc.pages.length - 1);
    if (!(opts && opts.keepSelection) || !findBox(selectedBoxId)) setSel([]);
    savedSel = null;
    linkMode = null;
    syncCustomFonts();
    syncLang();
    renderAll();
  }

  // ── Transliteration engine ───────────────────────────────────────────

  function translitReady() {
    return !!(window.Translit && Translit._engine);
  }

  function syncLang() {
    if (window.Translit) Translit.lang = doc.lang;
  }

  function initializeTranslit() {
    if (!window.Translit) {
      console.error("[Lekhoni] Translit engine not loaded. Phonetic typing will not work.");
      return;
    }
    fetch("data/translit-forward-map.json?v=" + APP_VERSION)
      .then((r) => {
        if (!r.ok) throw new Error(r.status + " " + r.statusText);
        return r.json();
      })
      .then((mapData) => {
        Translit.init(mapData);
        syncLang();
      })
      .catch((err) => {
        console.error("[Lekhoni] Could not load transliteration map:", err);
        note("Phonetic typing unavailable (map failed to load)");
      });
  }

  // ── Numbers, templates ───────────────────────────────────────────────

  const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  const toNativeDigits = (n) => String(n).replace(/\d/g, (d) => BENGALI_DIGITS[+d]);

  function toRoman(n) {
    if (!(n > 0 && n < 4000)) return String(n);
    const table = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
      [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
    return out;
  }

  function formatNumber(n, style, lang) {
    if (style === "native") return toNativeDigits(n);
    if (style === "words") {
      const words = NUM_WORDS[lang] || NUM_WORDS.bn;
      return words[n] || toNativeDigits(n);
    }
    if (style === "roman-lower") return toRoman(n).toLowerCase();
    if (style === "roman-upper") return toRoman(n);
    return String(n);
  }

  function fillTemplate(text, idx) {
    const rawNum = (doc.pageNumber.startAt || 1) + idx;
    const style = doc.pageNumber.style || "native";
    const lang = doc.lang || "bn";
    const n = formatNumber(rawNum, style, lang);
    const total = formatNumber(doc.pages.length, style, lang);

    let template = String(text || "").replace(/\{পৃষ্ঠা\}/g, n).replace(/\{মোট\}/g, total);

    if (style === "native" || style === "words") {
      const pageWord = "পৃষ্ঠা";
      const ofWord = lang === "as" ? "ৰ" : "এর";
      if (/Page\s*\{page\}\s*of\s*\{total\}/i.test(template)) return `${total} ${ofWord} ${pageWord} ${n}`;
      template = template.replace(/\bPage\b(?![^{]*\})/gi, pageWord).replace(/\bof\b(?![^{]*\})/gi, ofWord);
    }
    return template.replace(/\{page\}/gi, n).replace(/\{total\}/gi, total);
  }

  // ── Geometry ─────────────────────────────────────────────────────────

  /** Page 1 is a right-hand (recto) page; even indexes are rectos. */
  const isRecto = (idx) => idx % 2 === 0;

  function getEffectiveMargins(pageIndex) {
    const m = { ...doc.margins };
    const g = doc.gutter;
    if (!g || !g.size || g.mode === "none") return m;
    if (g.mode === "left") m.left += g.size;
    else if (g.mode === "right") m.right += g.size;
    else if (g.mode === "alternate") {
      if (isRecto(pageIndex)) m.left += g.size;
      else m.right += g.size;
    }
    return m;
  }

  /** Column edges (mm) between the margins, for guides and snapping. */
  function columnEdges(pageIndex) {
    const cols = doc.columns || 1;
    if (cols < 2) return [];
    const m = getEffectiveMargins(pageIndex);
    const gap = doc.columnGap || 0;
    const colW = (doc.pageW - m.left - m.right - gap * (cols - 1)) / cols;
    const edges = [];
    for (let i = 1; i < cols; i++) {
      const x = m.left + i * colW + (i - 1) * gap;
      edges.push(x, x + gap);
    }
    return edges;
  }

  /** Where objects may go: the page plus any bleed. */
  function pageBounds() {
    const b = doc.bleed || 0;
    return { x0: -b, y0: -b, x1: doc.pageW + b, y1: doc.pageH + b };
  }

  // Printed sheet: the page plus bleed, plus room for crop marks.
  const CROP_LEN = 5; // mm
  const cropOffset = () => Math.max(doc.bleed || 0, 3);
  const printSlug = () => (doc.cropMarks ? cropOffset() + CROP_LEN + 1 : doc.bleed || 0);

  let lastPrintCss = "";
  function setPageSizeForPrint() {
    const s = printSlug();
    const css = `@page { size: ${round2(doc.pageW + 2 * s)}mm ${round2(doc.pageH + 2 * s)}mm; margin: 0; }`;
    if (css === lastPrintCss) return;
    lastPrintCss = css;
    let el = $("print-page-size");
    if (!el) {
      el = document.createElement("style");
      el.id = "print-page-size";
      document.head.appendChild(el);
    }
    el.textContent = css;
  }

  // ── Lookup ───────────────────────────────────────────────────────────

  function findBox(id) {
    if (!id) return null;
    for (const page of doc.pages) {
      const b = page.boxes.find((x) => x.id === id);
      if (b) return b;
    }
    return null;
  }

  function findPageOfBox(id) {
    return doc.pages.find((p) => p.boxes.some((b) => b.id === id));
  }

  const boxEl = (id) => pageStage.querySelector(`.box[data-box-id="${id}"]`);
  const selectedBox = () => findBox(selectedBoxId);
  const pageIndexOf = (id) => doc.pages.findIndex((p) => p.boxes.some((b) => b.id === id));

  function allBoxes() {
    const out = [];
    for (const p of doc.pages) for (const b of p.boxes) out.push(b);
    return out;
  }

  // ── Selection model (several objects, groups) ───────────────────────

  function setSel(ids, primary) {
    selection.clear();
    ids.forEach((i) => selection.add(i));
    selectedBoxId = primary !== undefined ? primary : ids.length ? ids[ids.length - 1] : null;
    if (selectedBoxId) selection.add(selectedBoxId);
  }
  const isMulti = () => selection.size > 1;
  const selectedBoxes = () => Array.from(selection).map(findBox).filter(Boolean);

  function groupMembers(box) {
    if (!box) return [];
    if (!box.groupId) return [box];
    const page = findPageOfBox(box.id);
    return page ? page.boxes.filter((b) => b.groupId === box.groupId) : [box];
  }

  function bounds(boxes) {
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  // ── Text flow: one story running through linked frames ───────────────
  //
  // The story is stored in the first frame (box.text). Each frame's `next`
  // points at the frame the text continues in. On screen the story is split
  // at the last line that fits each frame; the split paragraph halves are
  // marked (data-split / data-cont) so edits can be joined back into one story.

  function prevOf(id) {
    for (const p of doc.pages) for (const b of p.boxes) if (b.next === id) return b;
    return null;
  }

  function threadHead(box) {
    let b = box, p, guard = 0;
    while ((p = prevOf(b.id)) && guard++ < 1000) b = p;
    return b;
  }

  function threadChain(head) {
    const out = [], seen = new Set();
    for (let b = head; b && !seen.has(b.id); b = b.next ? findBox(b.next) : null) {
      seen.add(b.id);
      out.push(b);
    }
    return out;
  }

  const isThreaded = (box) => !!box && box.type === "text" && (!!box.next || !!prevOf(box.id));
  const threadHeads = () => allBoxes().filter((b) => b.type === "text" && b.next && !prevOf(b.id));

  /** Drop broken links, double links and loops (opened files are untrusted). */
  function normalizeThreads(d) {
    const byId = new Map();
    for (const p of d.pages) for (const b of p.boxes) byId.set(b.id, b);
    const hasPrev = new Set();
    for (const b of byId.values()) {
      if (!b.next) continue;
      const n = byId.get(b.next);
      if (b.type !== "text" || !n || n.type !== "text" || n === b || hasPrev.has(b.next)) { b.next = null; continue; }
      hasPrev.add(b.next);
    }
    const reached = new Set();
    for (const b of byId.values()) {
      if (b.type !== "text" || hasPrev.has(b.id)) continue;
      for (let x = b; x && !reached.has(x.id); x = x.next ? byId.get(x.next) : null) reached.add(x.id);
    }
    for (const b of byId.values()) {
      if (b.next && !reached.has(b.id)) b.next = null; // part of a loop
      if (hasPrev.has(b.id) && reached.has(b.id)) b.text = "";   // story lives in the first frame
    }
  }

  /** Remove objects, keeping any story whose first frames go away. */
  function removeBoxes(ids) {
    const rm = new Set(ids);
    for (const head of threadHeads()) {
      const chain = threadChain(head);
      if (!chain.some((b) => rm.has(b.id))) continue;
      const keep = chain.filter((b) => !rm.has(b.id));
      if (!keep.length) continue;
      if (keep[0] !== head) keep[0].text = head.text;
      keep.forEach((b, i) => {
        b.next = keep[i + 1] ? keep[i + 1].id : null;
        if (i) b.text = "";
      });
    }
    for (const p of doc.pages) p.boxes = p.boxes.filter((b) => !rm.has(b.id));
    normalizeThreads(doc);
  }

  function displayHtml(box) {
    if (box.type === "text" && isThreaded(box)) return (flowParts.get(box.id) || {}).html || "";
    return box.text || "";
  }

  /** What an editable writes to: the box itself, or its part of a shared story. */
  function modelFor(box) {
    if (!isThreaded(box)) return box;
    return {
      get text() { return displayHtml(box); },
      set text(v) {
        const fp = flowParts.get(box.id);
        if (fp) fp.html = v; else flowParts.set(box.id, { html: v, start: 0, len: 0 });
        const head = threadHead(box);
        head.text = joinStory(threadChain(head).map((b) => (flowParts.get(b.id) || {}).html || ""));
        scheduleReflow(head);
      },
    };
  }

  function firstChildOf(n) {
    let c = n.firstChild;
    while (c && c.nodeType === 3 && !c.data) c = c.nextSibling;
    return c;
  }
  function lastChildOf(n) {
    let c = n.lastChild;
    while (c && c.nodeType === 3 && !c.data) c = c.previousSibling;
    return c;
  }

  function joinInto(a, b) {
    const last = lastChildOf(a), first = firstChildOf(b);
    if (last && first && last.nodeType === 1 && first.nodeType === 1 && last.nodeName === first.nodeName &&
        last.hasAttribute("data-split") && first.hasAttribute("data-cont")) {
      first.remove();
      last.removeAttribute("data-split");
      joinInto(last, first);
    }
    while (b.firstChild) a.appendChild(b.firstChild);
  }

  /** The frames' pieces back into one story. */
  function joinStory(parts) {
    const holder = document.createElement("div");
    parts.forEach((h, i) => {
      const tpl = document.createElement("template");
      tpl.innerHTML = h || "";
      if (i === 0) holder.appendChild(tpl.content);
      else joinInto(holder, tpl.content);
    });
    holder.querySelectorAll("[data-split],[data-cont]").forEach((e) => {
      e.removeAttribute("data-split");
      e.removeAttribute("data-cont");
    });
    return holder.innerHTML;
  }

  /** Split rich text at a character offset; cut elements are marked so they can be rejoined. */
  function splitHtmlAt(html, k) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    const root = tpl.content;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let pos = 0, n, c = null, o = 0;
    while ((n = walker.nextNode())) {
      if (k < pos + n.length) { c = n; o = k - pos; break; }
      pos += n.length;
    }
    if (!c) return [html, ""];
    // A split at the very start of an element is a split before it.
    while (c !== root && o === 0) {
      const p = c.parentNode;
      o = Array.prototype.indexOf.call(p.childNodes, c);
      c = p;
    }
    const path = [];
    for (let x = c.nodeType === 1 || c.nodeType === 11 ? c : c.parentNode; x && x !== root; x = x.parentNode) path.unshift(x);
    const r1 = document.createRange(), r2 = document.createRange();
    r1.setStart(root, 0); r1.setEnd(c, o);
    r2.setStart(c, o); r2.setEnd(root, root.childNodes.length);
    const f1 = r1.cloneContents(), f2 = r2.cloneContents();
    let a = f1, b = f2;
    path.forEach((orig, i) => {
      a = a && lastChildOf(a);
      b = b && firstChildOf(b);
      if (!a || !b || a.nodeType !== 1 || b.nodeType !== 1) { a = b = null; return; }
      a.setAttribute("data-split", "");
      b.setAttribute("data-cont", "");
      if (orig.nodeName === "OL") {
        const start = parseInt(orig.getAttribute("start"), 10) || 1;
        const lis = a.querySelectorAll(":scope > li").length;
        const liCut = path[i + 1] && path[i + 1].nodeName === "LI";
        b.setAttribute("start", start + lis - (liCut ? 1 : 0));
      }
    });
    const d1 = document.createElement("div"), d2 = document.createElement("div");
    d1.appendChild(f1);
    d2.appendChild(f2);
    return [d1.innerHTML, d2.innerHTML];
  }

  let measureRoot = null;
  function measurePage() {
    if (!measureRoot) {
      measureRoot = document.createElement("div");
      measureRoot.className = "measure-root";
      measureRoot.setAttribute("aria-hidden", "true");
      document.body.appendChild(measureRoot);
    }
    measureRoot.textContent = "";
    const pe = document.createElement("div");
    pe.className = "page";
    pe.style.width = doc.pageW + "mm";
    pe.style.height = doc.pageH + "mm";
    measureRoot.appendChild(pe);
    return pe;
  }

  /** Character offset of the first character that falls outside the frame (null = all fits). */
  function findSplitOffset(el) {
    const frame = el.querySelector(".text-frame"), t = el.querySelector(".box-text");
    const fr = frame.getBoundingClientRect();
    const cs = getComputedStyle(frame);
    const bottom = fr.top + frame.clientTop + frame.clientHeight - parseFloat(cs.paddingBottom) + 0.5;
    const right = fr.left + frame.clientLeft + frame.clientWidth - parseFloat(cs.paddingRight) + 0.5;
    const r = document.createRange();
    const rectOf = (node, i) => {
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      const rs = r.getClientRects();
      return rs.length ? rs[0] : r.getBoundingClientRect();
    };
    const out = (node, i) => {
      // Zero-size characters (ZWNJ, joiners) take the position of the one before.
      for (let j = i; j >= 0 && j > i - 4; j--) {
        const b = rectOf(node, j);
        if (b.width || b.height) return b.bottom > bottom || b.left > right;
      }
      return false;
    };
    const walker = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
    let pos = 0, n;
    while ((n = walker.nextNode())) {
      const L = n.length;
      if (L && out(n, L - 1)) {
        let lo = 0, hi = L - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (out(n, mid)) hi = mid; else lo = mid + 1;
        }
        return pos + lo;
      }
      pos += L;
    }
    return null;
  }

  /** Work out which part of the story each frame of a flow shows. */
  function computeFlow(head) {
    const chain = threadChain(head);
    let rest = head.text || "", start = 0;
    chain.forEach((box, i) => {
      let part = rest, after = "";
      if (i < chain.length - 1 && rest) {
        const page = findPageOfBox(box.id);
        const pe = measurePage();
        const el = renderBox(box, { html: rest, measure: true });
        pe.appendChild(el);
        applyWrapsTo(el, box, page);
        const k = findSplitOffset(el);
        if (k != null) [part, after] = splitHtmlAt(rest, k);
      }
      const len = plainText(part).length;
      flowParts.set(box.id, { html: part, start, len });
      start += len;
      rest = after;
    });
    if (measureRoot) measureRoot.textContent = "";
  }

  function reflowAll() {
    flowParts.clear();
    for (const head of threadHeads()) computeFlow(head);
  }

  const reflowTimers = new Map();
  function scheduleReflow(head) {
    clearTimeout(reflowTimers.get(head.id));
    reflowTimers.set(head.id, setTimeout(() => { reflowTimers.delete(head.id); reflowLive(head); }, 350));
  }

  const CARET_MARK_RE = /<span data-caret=""><\/span>/g;

  /** Re-split a flow in place, keeping the caret where it was in the text. */
  function reflowLive(head) {
    if (!findBox(head.id) || !head.next) return;
    const chain = threadChain(head);
    const active = document.activeElement;
    const host = active && active.classList && active.classList.contains("box-text") ? active : null;
    const hostBox = host && findBox(host.closest(".box")?.dataset.boxId);
    const caretHere = !!hostBox && chain.includes(hostBox);
    const sel = window.getSelection();
    if (caretHere && sel.rangeCount) {
      const r = sel.getRangeAt(0).cloneRange();
      r.collapse(true);
      const m = document.createElement("span");
      m.setAttribute("data-caret", "");
      r.insertNode(m);
      flowParts.set(hostBox.id, Object.assign(flowParts.get(hostBox.id) || {}, { html: host.innerHTML }));
      head.text = joinStory(chain.map((b) => (flowParts.get(b.id) || {}).html || ""));
    }
    computeFlow(head);
    head.text = head.text.replace(CARET_MARK_RE, "");
    let caretFrame = null, caretOffset = 0;
    for (const b of chain) {
      const fp = flowParts.get(b.id);
      const i = fp.html.indexOf('<span data-caret="">');
      if (i >= 0) { caretFrame = b; caretOffset = plainText(fp.html.slice(0, i)).length; }
    }
    for (const b of chain) {
      const el = boxEl(b.id);
      if (!el) continue;
      const t = el.querySelector(".box-text");
      const html = flowParts.get(b.id).html;
      if (t.innerHTML !== html) t.innerHTML = html;
      updateThreadMarks(el, b);
      updateOverset(el, b);
    }
    for (const b of chain) {
      const fp = flowParts.get(b.id);
      fp.html = fp.html.replace(CARET_MARK_RE, "");
    }
    if (caretHere) {
      const m = pageStage.querySelector("[data-caret]");
      if (m) {
        const t = m.closest(".box-text");
        const r = document.createRange();
        r.setStartBefore(m);
        r.collapse(true);
        m.remove();
        t.focus({ preventScroll: true });
        sel.removeAllRanges();
        sel.addRange(r);
      } else if (caretFrame) {
        // The caret's text moved to a frame on another page: follow it.
        goToPage(pageIndexOf(caretFrame.id));
        const t = boxEl(caretFrame.id)?.querySelector(".box-text");
        if (t) {
          t.focus({ preventScroll: true });
          const r = rangeAt(t, caretOffset, 0) || (() => { const x = document.createRange(); x.selectNodeContents(t); x.collapse(false); return x; })();
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
    }
    pageStage.querySelectorAll("[data-caret]").forEach((m) => m.remove());
  }

  function updateThreadMarks(el, box) {
    el.classList.toggle("has-next", !!box.next);
    el.classList.toggle("has-prev", !!prevOf(box.id));
  }

  // ── Drop caps (a real span round the first akshara, so conjuncts stay whole) ──

  function withDropCap(html, on) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    tpl.content.querySelectorAll("span.lk-dc").forEach((sp) => sp.replaceWith(...sp.childNodes));
    tpl.content.normalize();
    if (on) {
      const w = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const i = n.data.search(/\S/);
        if (i < 0) continue;
        const m = n.data.slice(i).match(AKSHARA_RE);
        if (!m) break;
        let len = m[0].length;
        if (/^[“‘"'(\[«]$/u.test(m[0])) {
          const m2 = n.data.slice(i + len).match(AKSHARA_RE);
          if (m2) len += m2[0].length;
        }
        const first = n.splitText(i);
        first.splitText(len);
        const span = document.createElement("span");
        span.className = "lk-dc";
        first.replaceWith(span);
        span.appendChild(first);
        break;
      }
    }
    return tpl.innerHTML;
  }

  // ── Text wrap round objects ──────────────────────────────────────────
  //
  // Text frames get invisible floats (with shape-outside for contours) in
  // front of their text, so lines flow round the objects that overlap them.

  /** Outline of an object in page mm (rotation applied). */
  function outlinePoints(o) {
    const w = o.w, h = o.h;
    let pts;
    const type = o.type === "shape" ? (o.shapeType === "polygon" ? "triangle" : o.shapeType === "ellipse" ? "circle" : o.shapeType) : "box";
    if (type === "circle") {
      pts = [];
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        pts.push([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)]);
      }
    } else if (type === "triangle") pts = [[w / 2, 0], [w, h], [0, h]];
    else if (type === "diamond") pts = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
    else if (type === "star") {
      const n = clamp(Math.round(num(o.starPoints, 5)), 3, 24);
      pts = [];
      for (let i = 0; i < n * 2; i++) {
        const k = i % 2 === 0 ? 1 : 0.4, a = (i * Math.PI) / n - Math.PI / 2;
        pts.push([w / 2 + (w / 2) * k * Math.cos(a), h / 2 + (h / 2) * k * Math.sin(a)]);
      }
    } else pts = [[0, 0], [w, 0], [w, h], [0, h]];
    const rot = ((o.rotation || 0) * Math.PI) / 180;
    const cx = w / 2, cy = h / 2, cos = Math.cos(rot), sin = Math.sin(rot);
    return pts.map(([x, y]) => [o.x + cx + (x - cx) * cos - (y - cy) * sin, o.y + cy + (x - cx) * sin + (y - cy) * cos]);
  }

  function textContentRect(box) {
    const ins = box.inset == null ? { t: 4, r: 0, b: 2, l: 0 } : { t: box.inset, r: box.inset, b: box.inset, l: box.inset };
    const bw = box.frameBorderWidth > 0 ? box.frameBorderWidth / PT_PER_MM : 0;
    return { x: box.x + bw + ins.l, y: box.y + bw + ins.t, w: box.w - 2 * bw - ins.l - ins.r, h: box.h - 2 * bw - ins.t - ins.b };
  }

  function wrapFloats(box, page) {
    const c = textContentRect(box);
    if (!(c.w > 0 && c.h > 0)) return [];
    const items = [];
    for (const o of page.boxes) {
      if (o === box || !o.wrap || o.wrap === "none" || (o.hidden && printing)) continue;
      const pts = outlinePoints(o);
      const off = Math.max(0, num(o.wrapOffset, 3));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const left = Math.min(...xs) - off - c.x, right = Math.max(...xs) + off - c.x;
      const top = Math.max(0, Math.min(...ys) - off - c.y), bottom = Math.min(c.h, Math.max(...ys) + off - c.y);
      if (bottom <= top || right <= 0 || left >= c.w) continue;
      const spaceL = Math.max(0, left), spaceR = Math.max(0, c.w - right);
      let side = "left", width = c.w, full = true;
      if (o.wrap !== "jump" && Math.max(spaceL, spaceR) >= 12) {
        full = false;
        if (spaceL >= spaceR) { side = "right"; width = c.w - spaceL; }
        else { side = "left"; width = Math.min(c.w, right); }
      }
      const contour = o.wrap === "contour" && o.type === "shape" && !full ? { pts, off } : null;
      items.push({ side, top, bottom, width, full, contour });
    }
    items.sort((a, b) => a.top - b.top);
    // Overlapping exclusions on the same side become one.
    const merged = [];
    for (const it of items) {
      const prev = [...merged].reverse().find((m) => m.side === it.side || m.full || it.full);
      if (prev && it.top < prev.bottom && (prev.side === it.side || prev.full || it.full)) {
        prev.bottom = Math.max(prev.bottom, it.bottom);
        prev.width = Math.max(prev.width, it.width);
        prev.full = prev.full || it.full;
        prev.contour = null;
      } else merged.push(Object.assign({}, it));
    }
    const out = [];
    const cursor = { left: 0, right: 0 };
    let lastTop = 0;
    const mkFloat = (side, w, h) => {
      const f = document.createElement("div");
      f.className = "wrap-float";
      f.style.float = side;
      f.style.clear = side;
      f.style.width = Math.max(0, w) + "mm";
      f.style.height = Math.max(0, h) + "mm";
      return f;
    };
    for (const it of merged) {
      const s = it.side;
      const start = Math.max(cursor[s], lastTop);
      if (it.top > start + 0.01) out.push(mkFloat(s, 0, it.top - start));
      const top = Math.max(it.top, start);
      const h = it.bottom - top;
      if (h <= 0) continue;
      const f = mkFloat(s, it.full ? c.w : it.width, h);
      if (it.contour) {
        const fx = s === "left" ? 0 : c.w - it.width;
        const poly = it.contour.pts.map(([x, y]) => `${round2(x - c.x - fx)}mm ${round2(y - c.y - top)}mm`).join(", ");
        f.style.shapeOutside = `polygon(${poly})`;
        f.style.shapeMargin = it.contour.off + "mm";
      }
      out.push(f);
      lastTop = top;
      cursor[s] = top + h;
      if (it.full) cursor.left = cursor.right = top + h;
    }
    return out;
  }

  function applyWrapsTo(el, box, page) {
    const frame = el && el.querySelector(".text-frame");
    if (!frame || !page) return;
    frame.querySelectorAll(".wrap-float").forEach((f) => f.remove());
    const floats = box.ignoreWrap || (box.columns || 1) > 1 || box.rotation ? [] : wrapFloats(box, page);
    frame.classList.toggle("has-wrap", floats.length > 0);
    const t = frame.querySelector(".box-text");
    floats.forEach((f) => frame.insertBefore(f, t));
  }

  function applyPageWraps(pageEl, page) {
    pageEl.querySelectorAll(".box.obj-text").forEach((el) => {
      const box = findBox(el.dataset.boxId);
      if (box) applyWrapsTo(el, box, page);
    });
  }

  /** After objects move or change: re-wrap, re-flow, re-check overset. */
  function refreshLayout() {
    const pageEl = pageStage.querySelector(".page");
    if (!pageEl) return;
    applyPageWraps(pageEl, doc.pages[currentPageIndex]);
    for (const head of threadHeads()) reflowLive(head);
    pageStage.querySelectorAll(".box.obj-text").forEach((el) => {
      const b = findBox(el.dataset.boxId);
      if (b) updateOverset(el, b);
    });
    updateMultiOverlay();
  }

  let liveWrapQueued = false;
  function liveWrap() {
    if (liveWrapQueued) return;
    liveWrapQueued = true;
    requestAnimationFrame(() => {
      liveWrapQueued = false;
      const pageEl = pageStage.querySelector(".page");
      if (!pageEl) return;
      applyPageWraps(pageEl, doc.pages[currentPageIndex]);
      pageStage.querySelectorAll(".box.obj-text").forEach((el) => {
        const b = findBox(el.dataset.boxId);
        if (b) updateOverset(el, b);
      });
    });
  }

  // ── Rendering ────────────────────────────────────────────────────────

  function renderAll() {
    setPageSizeForPrint();
    renderPages();
    renderRail();
    renderToolbarState();
    scheduleStatus();
  }

  function renderPages(allPages) {
    reflowAll();
    hideLinkBubble();
    pageStage.textContent = "";
    if (allPages) {
      const s = printSlug();
      doc.pages.forEach((page, idx) => {
        const sheet = document.createElement("div");
        sheet.className = "print-sheet";
        sheet.id = "page-" + (idx + 1); // target of internal links in the PDF
        sheet.style.width = doc.pageW + 2 * s + "mm";
        sheet.style.height = doc.pageH + 2 * s + "mm";
        const pageEl = renderPage(page, idx);
        pageEl.style.left = s + "mm";
        pageEl.style.top = s + "mm";
        sheet.appendChild(pageEl);
        if (doc.cropMarks) sheet.appendChild(buildCropMarks(s));
        pageStage.appendChild(sheet);
      });
    } else {
      pageStage.appendChild(renderPage(doc.pages[currentPageIndex], currentPageIndex));
    }
    applyZoom();
    if (!allPages) {
      updateMultiOverlay();
      if (window.PublisherFeatures) window.PublisherFeatures.scheduleRender();
      requestAnimationFrame(() => pageStage.querySelectorAll(".box-text").forEach((t) => {
        const el = t.closest(".box");
        const box = el && findBox(el.dataset.boxId);
        if (box) updateOverset(el, box);
      }));
    }
  }

  function renderPage(page, idx) {
    const pageEl = document.createElement("div");
    pageEl.className = "page";
    pageEl.dataset.pageId = page.id;
    pageEl.style.width = doc.pageW + "mm";
    pageEl.style.height = doc.pageH + "mm";
    pageEl.style.background = doc.pageBg || "#FFFFFF";

    if (doc.bleed > 0) {
      const bleed = document.createElement("div");
      bleed.className = "page-bleed";
      bleed.style.inset = `-${doc.bleed}mm`;
      bleed.style.background = doc.pageBg || "#FFFFFF";
      pageEl.appendChild(bleed);
    }
    if (printing) pageEl.style.clipPath = `inset(-${doc.bleed || 0}mm)`;

    if (doc.showMarginGuides) pageEl.appendChild(buildMarginGuide(idx));

    if (page.boxes.length === 0 && !printing) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "এই পাতাটি ফাঁকা — টুলবার থেকে Text বা Image বেছে পাতায় ক্লিক করুন।";
      pageEl.appendChild(hint);
    }

    for (const box of page.boxes) {
      if (box.hidden && printing) continue;
      pageEl.appendChild(renderBox(box));
    }
    applyPageWraps(pageEl, page);

    if (!page.skipHF) {
      if (doc.header.enabled && doc.header.text && (idx !== 0 || doc.header.showOnFirst)) {
        pageEl.appendChild(buildHeaderFooter("page-header", doc.header, fillTemplate(doc.header.text, idx), "top", idx));
      }
      if (doc.footer.enabled && doc.footer.text && (idx !== 0 || doc.footer.showOnFirst)) {
        pageEl.appendChild(buildHeaderFooter("page-footer", doc.footer, fillTemplate(doc.footer.text, idx), "bottom", idx));
      }
      if (doc.pageNumber.enabled) pageEl.appendChild(buildPageNumber(idx));
    }

    pageEl.addEventListener("pointerdown", (e) => {
      if (e.target !== pageEl && !e.target.classList.contains("page-bleed")) return;
      if (linkMode) { cancelLinkMode(); return; }
      if (activeTool) placeBoxAt(page, pageEl, e);
      else startMarquee(e, pageEl, page);
    });
    return pageEl;
  }

  function buildCropMarks(s) {
    const W = doc.pageW + 2 * s, H = doc.pageH + 2 * s;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "crop-marks");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.width = W + "mm";
    svg.style.height = H + "mm";
    const off = cropOffset();
    const x0 = s, y0 = s, x1 = s + doc.pageW, y1 = s + doc.pageH;
    const lines = [];
    for (const [x, sx] of [[x0, -1], [x1, 1]]) {
      for (const [y, sy] of [[y0, -1], [y1, 1]]) {
        lines.push([x + sx * off, y, x + sx * (off + CROP_LEN), y]); // horizontal mark
        lines.push([x, y + sy * off, x, y + sy * (off + CROP_LEN)]); // vertical mark
      }
    }
    for (const [ax, ay, bx, by] of lines) {
      const l = document.createElementNS(SVG_NS, "line");
      l.setAttribute("x1", ax); l.setAttribute("y1", ay);
      l.setAttribute("x2", bx); l.setAttribute("y2", by);
      l.setAttribute("stroke", "#000");
      l.setAttribute("stroke-width", 0.25 / PT_PER_MM);
      svg.appendChild(l);
    }
    return svg;
  }

  function buildMarginGuide(pageIndex) {
    const el = document.createElement("div");
    el.className = "page-margin-guide";
    const m = getEffectiveMargins(pageIndex);
    el.style.inset = `${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm`;
    const inner = doc.pageW - m.left - m.right;
    for (const x of columnEdges(pageIndex)) {
      const line = document.createElement("div");
      line.className = "page-col-guide";
      line.style.left = ((x - m.left) / inner) * 100 + "%";
      el.appendChild(line);
    }
    return el;
  }

  function sideAlign(align, idx) {
    if (align === "outside") return isRecto(idx) ? "right" : "left";
    if (align === "inside") return isRecto(idx) ? "left" : "right";
    return align === "left" || align === "right" ? align : "center";
  }

  function buildHeaderFooter(cls, cfg, text, side, pageIndex) {
    const el = document.createElement("div");
    el.className = cls;
    const inner = document.createElement("div");
    inner.className = "hf-inner";
    inner.textContent = text;
    inner.style.textAlign = sideAlign(cfg.align, pageIndex);
    if (cfg.rule) inner.classList.add(side === "top" ? "rule-below" : "rule-above");
    el.appendChild(inner);
    el.style.fontFamily = doc.hfFont || DEFAULT_FONT;
    el.style.fontSize = (cfg.size || 9) + "pt";
    if (isHex(cfg.color)) el.style.color = cfg.color;
    const m = getEffectiveMargins(pageIndex);
    el.style.left = m.left + "mm";
    el.style.right = m.right + "mm";
    if (side === "top") {
      el.style.top = "0";
      el.style.height = m.top + "mm";
    } else {
      el.style.bottom = "0";
      el.style.height = m.bottom + "mm";
    }
    return el;
  }

  function buildPageNumber(idx) {
    const pn = doc.pageNumber;
    const el = document.createElement("div");
    el.className = "page-number";
    el.textContent = fillTemplate(pn.format || "{page}", idx);
    el.style.fontFamily = doc.hfFont || DEFAULT_FONT;
    el.style.fontSize = (pn.size || 9) + "pt";
    if (isHex(doc.footer.color)) el.style.color = doc.footer.color;
    const m = getEffectiveMargins(idx);
    const [vert, h] = (pn.position || "bottom-center").split("-");
    const horiz = sideAlign(h, idx);
    const off = (pn.offset ?? 8) + "mm";
    if (vert === "top") el.style.top = off;
    else el.style.bottom = off;
    if (horiz === "center") {
      el.style.left = m.left + "mm";
      el.style.right = m.right + "mm";
      el.style.textAlign = "center";
    } else if (horiz === "left") {
      el.style.left = m.left + "mm";
      el.style.textAlign = "left";
    } else {
      el.style.right = m.right + "mm";
      el.style.textAlign = "right";
    }
    return el;
  }

  function applyTextStyle(t, box) {
    t.style.fontFamily = box.fontFamily;
    t.style.fontSize = box.fontSize + "pt";
    t.style.fontWeight = box.bold ? "700" : "400";
    t.style.fontStyle = box.italic ? "italic" : "normal";
    const deco = [box.underline && "underline", box.strike && "line-through"].filter(Boolean).join(" ");
    t.style.textDecoration = deco || "none";
    t.style.textAlign = box.align;
    t.style.color = box.color;
    t.style.lineHeight = box.lineHeight || 1.2;
    t.style.letterSpacing = (box.letterSpacing || 0) + "px";
    t.style.wordSpacing = (box.wordSpacing || 0) + "px";
    t.style.paddingLeft = (box.indentLeft || 0) + "mm";
    t.style.paddingRight = (box.indentRight || 0) + "mm";
    t.style.textIndent = (box.indentFirst || 0) + "mm";
    const tc = box.textCase || "none";
    t.style.textTransform = ["uppercase", "lowercase", "capitalize"].includes(tc) ? tc : "none";
    t.style.fontVariantCaps = tc === "smallcaps" ? "small-caps" : "normal";
    t.style.setProperty("--sp-before", (box.spaceBefore || 0) + "mm");
    t.style.setProperty("--sp-after", (box.spaceAfter || 0) + "mm");
    t.style.setProperty("--ol-style", box.olStyle || "bengali");
    t.style.setProperty("--ul-style", box.ulStyle || "disc");
    t.style.hyphens = box.hyphenate ? "auto" : "manual";
    t.style.webkitHyphens = box.hyphenate ? "auto" : "manual";
    if (box.hyphenate) t.lang = "en"; else t.removeAttribute("lang");
    const dc = box.dropCap || 0;
    t.classList.toggle("dropcap", dc > 1);
    t.style.setProperty("--dc-lines", dc);
    t.style.setProperty("--lh", box.lineHeight || 1.2);
  }

  /** Frame + text styling for a text box, in place (keeps focus and caret). */
  function styleTextBox(el, box) {
    const frame = el.querySelector(".text-frame");
    const t = el.querySelector(".box-text");
    if (!frame || !t) return;
    applyTextStyle(t, box);
    frame.style.padding = box.inset == null ? "4mm 0 2mm 0" : box.inset + "mm";
    frame.style.background = box.frameFill || "transparent";
    frame.style.border = box.frameBorderWidth > 0 ? `${box.frameBorderWidth}pt solid ${box.frameBorderColor || "#000"}` : "none";
    const cols = Math.round(box.columns || 1);
    frame.dataset.valign = cols > 1 ? "top" : box.valign || "top";
    t.classList.toggle("multi-col", cols > 1);
    t.style.columnCount = cols > 1 ? cols : "";
    t.style.columnGap = cols > 1 ? (box.columnGap ?? 5) + "mm" : "";
    updateOverset(el, box);
  }

  /** Mark text frames whose text doesn't fit (the "+" a layout artist looks for). */
  function updateOverset(el, box) {
    if (!el || box.type !== "text") return;
    const frame = el.querySelector(".text-frame");
    const t = el.querySelector(".box-text");
    if (!frame || !t) return;
    if (box.next) { el.classList.remove("overset"); return; } // the rest flows on
    let over;
    if (frame.classList.contains("has-wrap")) {
      const cs = getComputedStyle(frame);
      over = t.offsetTop + t.offsetHeight > frame.clientHeight - parseFloat(cs.paddingBottom) + 1.5;
    } else if ((box.columns || 1) > 1) {
      over = t.scrollWidth > t.clientWidth + 1;
    } else {
      const cs = getComputedStyle(frame);
      const inner = frame.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      over = t.scrollHeight > inner + 1.5;
    }
    if (el.classList.contains("overset") !== over) {
      el.classList.toggle("overset", over);
      scheduleStatus();
    }
  }

  function positionBox(el, box) {
    el.style.left = box.x + "mm";
    el.style.top = box.y + "mm";
    el.style.width = box.w + "mm";
    el.style.height = box.h + "mm";
    el.style.transform = box.rotation ? `rotate(${box.rotation}deg)` : "";
    el.style.setProperty("--obj-opacity", box.opacity ?? 1);
  }

  /** Wire an editable element (text box or table cell) to its model object. */
  function bindEditable(el, model) {
    el.contentEditable = "true";
    el.spellcheck = false;
    el.innerHTML = model.text || "";
    el.addEventListener("input", (e) => {
      model.text = el.innerHTML;
      if (e.inputType && e.inputType.startsWith("history")) phReset(el);
      const bel = el.closest(".box");
      const box = bel && findBox(bel.dataset.boxId);
      if (box) updateOverset(bel, box);
      scheduleSave(); // typing is batched into one undo step per pause
    });
    el.addEventListener("keydown", (e) => onEditableKeydown(e, el));
    el.addEventListener("paste", (e) => onEditablePaste(e, el));
    el.addEventListener("blur", () => phReset(el));
    el.addEventListener("pointerdown", () => phReset(el));
  }

  function focusEnd(el) {
    el.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /**
   * Shared start of a click on an object: link-picking, Ctrl+click to follow
   * a link, Shift+click to add to the selection, and group selection.
   * Returns true when the click was used up.
   */
  function boxPointerPrelude(e, box) {
    if (linkMode) { e.preventDefault(); finishThreadLink(box); return true; }
    if ((e.ctrlKey || e.metaKey) && followLinkAt(e, box)) { e.preventDefault(); return true; }
    if (e.shiftKey) { e.preventDefault(); selectBox(box.id, { toggle: true }); return true; }
    if (box.groupId) {
      const members = groupMembers(box);
      const groupSelected = members.length === selection.size && members.every((m) => selection.has(m.id));
      const direct = selection.size === 1 && selectedBoxId === box.id;
      if (!groupSelected && !direct) {
        selectBox(box.id); // first click: the whole group
        if (box.type === "text" || box.type === "table") e.preventDefault();
        return box.type === "text" || box.type === "table";
      }
      if (groupSelected && (box.type === "text" || box.type === "table") && !e.target.closest(".grip")) {
        selectBox(box.id, { single: true }); // second click: edit inside the group
        return false;
      }
    }
    return false;
  }

  function renderBox(box, opts) {
    const measure = !!(opts && opts.measure);
    const el = document.createElement("div");
    const sel = !measure && selection.has(box.id);
    el.className = "box obj-" + box.type + (sel ? " selected" : "") + (sel && selection.size === 1 ? " primary" : "") +
      (box.hidden ? " is-hidden" : "") + (box.locked ? " is-locked" : "") + (box.groupId ? " in-group" : "");
    el.dataset.boxId = box.id;
    positionBox(el, box);

    const grip = document.createElement("div");
    grip.className = "grip";
    grip.title = box.locked ? "Locked — unlock in Arrange to move" : "Drag to move";
    grip.addEventListener("pointerdown", (e) => startDrag(e, box));
    el.appendChild(grip);

    if (box.type === "text") {
      const frame = document.createElement("div");
      frame.className = "text-frame";
      const t = document.createElement("div");
      t.className = "box-text";
      frame.appendChild(t);
      el.appendChild(frame);
      if (measure) {
        t.innerHTML = opts.html || "";
        styleTextBox(el, box);
        return el;
      }
      bindEditable(t, modelFor(box));
      t.addEventListener("focus", () => {
        if (!(selection.size === 1 && selectedBoxId === box.id)) selectBox(box.id, { single: true });
      });
      t.addEventListener("blur", () => fixDropCapAfterEdit(box, t));
      // Clicks in the empty part of a middle/bottom-aligned frame go to the text.
      frame.addEventListener("pointerdown", (e) => {
        if (e.target !== frame) return;
        e.stopPropagation();
        if (boxPointerPrelude(e, box)) return;
        e.preventDefault();
        focusEnd(t);
      });
      styleTextBox(el, box);
      const mark = document.createElement("div");
      mark.className = "overset-mark";
      mark.textContent = "+";
      mark.title = "More text than fits — enlarge the frame, flow it into another frame, or use Frame › Fit frame to text";
      el.appendChild(mark);
      for (const side of ["in", "out"]) {
        const port = document.createElement("div");
        port.className = "flow-port flow-" + side;
        port.title = side === "in" ? "Text flows in from another frame" : "Text continues in another frame";
        el.appendChild(port);
      }
      updateThreadMarks(el, box);
    } else if (box.type === "table") {
      el.appendChild(renderTable(box));
      el.appendChild(buildTableResizers(box));
      requestAnimationFrame(() => positionTableResizers(el));
    } else if (box.type === "shape") {
      const svg = renderShapeSvg(box);
      svg.addEventListener("pointerdown", (e) => startDrag(e, box));
      el.appendChild(svg);
    } else {
      el.appendChild(renderImage(box));
    }

    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (boxPointerPrelude(e, box)) return;
      if (!selection.has(box.id)) selectBox(box.id);
    });

    if (box.link) {
      const badge = document.createElement("div");
      badge.className = "link-badge";
      badge.title = "Linked to " + linkLabel(box.link) + " — Ctrl+click to follow";
      el.appendChild(badge);
      if (printing) {
        const a = document.createElement("a");
        a.className = "obj-link";
        a.href = box.link;
        el.appendChild(a);
      }
    }

    const handle = document.createElement("div");
    handle.className = "resize-handle";
    handle.title = "Drag to resize (Shift keeps proportions)";
    handle.addEventListener("pointerdown", (e) => startResize(e, box));
    el.appendChild(handle);

    const rot = document.createElement("div");
    rot.className = "rotate-handle";
    rot.title = "Drag to rotate (Shift snaps to 15°) · double-click to straighten";
    rot.innerHTML = '<svg viewBox="0 0 16 16"><path d="M12.6 6.2A5 5 0 1 0 13 9.5"/><path d="M13 3v3.4H9.6"/></svg>';
    rot.addEventListener("pointerdown", (e) => startRotate(e, box));
    rot.addEventListener("dblclick", (e) => { e.stopPropagation(); setRotation(box, 0, true); });
    el.appendChild(rot);

    const lock = document.createElement("div");
    lock.className = "lock-badge";
    lock.title = "Locked";
    lock.innerHTML = '<svg viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="5.5" rx="1"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5"/></svg>';
    el.appendChild(lock);
    return el;
  }

  function renderImage(box) {
    const wrap = document.createElement("div");
    wrap.className = "box-image";
    wrap.style.background = box.frameFill || "transparent";
    wrap.style.border = box.frameBorderWidth > 0 ? `${box.frameBorderWidth}pt solid ${box.frameBorderColor || "#000"}` : "none";
    wrap.addEventListener("pointerdown", (e) => startDrag(e, box));
    if (box.imgSrc) {
      const img = document.createElement("img");
      img.src = box.imgSrc;
      img.alt = "";
      img.draggable = false;
      img.style.objectFit = box.imgFit || "contain";
      wrap.appendChild(img);
      wrap.title = "Drag to move · double-click to replace the image";
      wrap.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        pickImageFor(box.id);
      });
    } else {
      const ph = document.createElement("div");
      ph.className = "placeholder";
      ph.textContent = "ছবি যোগ করতে ক্লিক করুন";
      wrap.appendChild(ph);
      wrap.addEventListener("click", (e) => {
        e.stopPropagation();
        if (Date.now() - lastDragEnd < 300) return; // that was a drag, not a click
        pickImageFor(box.id);
      });
    }
    return wrap;
  }

  function rerenderBox(box) {
    const old = boxEl(box.id);
    if (old) old.replaceWith(renderBox(box));
  }

  function renderTable(box) {
    ensureTableSizes(box);
    const table = document.createElement("table");
    table.className = "box-table";
    table.style.fontSize = box.fontSize + "pt";
    table.style.fontFamily = box.fontFamily;
    const colgroup = document.createElement("colgroup");
    for (let c = 0; c < box.cols; c++) colgroup.appendChild(document.createElement("col"));
    table.appendChild(colgroup);

    const byPos = new Map(box.cells.map((c) => [c.row + "," + c.col, c]));
    for (let r = 0; r < box.rows; r++) {
      const tr = document.createElement("tr");
      for (let c = 0; c < box.cols; c++) {
        let cell = byPos.get(r + "," + c);
        if (!cell) {
          cell = newCell(r, c);
          box.cells.push(cell);
        }
        const td = document.createElement("td");
        td.className = "table-cell";
        td.style.border = box.borderWidth + "px solid " + box.borderColor;
        td.style.padding = box.cellPadding + "px";
        td.style.backgroundColor = cell.bgColor;
        td.style.color = cell.textColor;
        td.style.fontWeight = cell.bold ? "700" : "400";
        td.style.textAlign = cell.align || "left";
        td.style.verticalAlign = cell.valign || "top";
        bindEditable(td, cell);
        // Rows grow with their text, so keep the drag handles on the borders.
        td.addEventListener("input", () => {
          if (fitTableToContent(box)) renderRail();
          positionTableResizers(td.closest(".box"));
        });
        td.addEventListener("focus", () => {
          activeCell = { boxId: box.id, row: r, col: c };
          if (!(selection.size === 1 && selectedBoxId === box.id)) selectBox(box.id, { single: true });
          else renderToolbarState();
        });
        td.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          if (boxPointerPrelude(e, box)) return;
          if (!selection.has(box.id)) selectBox(box.id);
        });
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    applyTableSizes(table, box);
    return table;
  }

  // ── Table column/row sizes ───────────────────────────────────────────
  // Stored as fractions of the box width/height, so resizing the whole
  // table scales its columns and rows proportionally.

  function ensureTableSizes(box) {
    const valid = (a, n) => Array.isArray(a) && a.length === n && a.every((x) => x > 0);
    const even = (n) => Array(n).fill(1 / n);
    if (!valid(box.colWidths, box.cols)) box.colWidths = even(box.cols);
    if (!valid(box.rowHeights, box.rows)) box.rowHeights = even(box.rows);
  }

  function applyTableSizes(table, box) {
    const cols = table.querySelectorAll("col");
    box.colWidths.forEach((f, i) => { if (cols[i]) cols[i].style.width = f * 100 + "%"; });
    box.rowHeights.forEach((f, i) => { if (table.rows[i]) table.rows[i].style.height = f * box.h + "mm"; });
  }

  function buildTableResizers(box) {
    const layer = document.createElement("div");
    layer.className = "tbl-resizers";
    for (let i = 0; i < box.cols - 1; i++) {
      const h = document.createElement("div");
      h.className = "tbl-rz tbl-rz-col";
      h.title = "Drag to resize columns";
      h.addEventListener("pointerdown", (e) => startTableResize(e, box, "col", i));
      layer.appendChild(h);
    }
    for (let i = 0; i < box.rows - 1; i++) {
      const h = document.createElement("div");
      h.className = "tbl-rz tbl-rz-row";
      h.title = "Drag to resize rows";
      h.addEventListener("pointerdown", (e) => startTableResize(e, box, "row", i));
      layer.appendChild(h);
    }
    return layer;
  }

  /** Put each handle on the actual rendered border (rows may have grown with text). */
  function positionTableResizers(el) {
    const table = el && el.querySelector("table.box-table");
    const layer = el && el.querySelector(".tbl-resizers");
    if (!table || !layer || !table.rows.length) return;
    const first = table.rows[0];
    layer.querySelectorAll(".tbl-rz-col").forEach((h, i) => {
      const td = first.cells[i];
      if (!td) return;
      h.style.left = table.offsetLeft + td.offsetLeft + td.offsetWidth + "px";
      h.style.top = table.offsetTop + "px";
      h.style.height = table.offsetHeight + "px";
    });
    layer.querySelectorAll(".tbl-rz-row").forEach((h, i) => {
      const tr = table.rows[i];
      if (!tr) return;
      h.style.top = table.offsetTop + tr.offsetTop + tr.offsetHeight + "px";
      h.style.left = table.offsetLeft + "px";
      h.style.width = table.offsetWidth + "px";
    });
  }

  /** Grow a table's frame to enclose its rows (rows can't shrink below their text). */
  function fitTableToContent(box) {
    const el = boxEl(box.id);
    const table = el && el.querySelector("table.box-table");
    if (!table || !table.rows.length) return false;
    const need = table.offsetHeight / PX_PER_MM;
    if (need <= box.h + 0.2) return false;
    const rowsMm = Array.from(table.rows).map((tr) => tr.offsetHeight / PX_PER_MM);
    const sum = rowsMm.reduce((a, b) => a + b, 0);
    box.h = sum;
    box.rowHeights = rowsMm.map((m) => m / sum);
    positionBox(el, box);
    applyTableSizes(table, box);
    positionTableResizers(el);
    return true;
  }

  /** Smallest height (mm) a table row can take given its text. */
  function minRowHeightMm(tr) {
    if (!tr) return 0;
    const prev = tr.style.height;
    tr.style.height = "0px";
    const px = tr.offsetHeight;
    tr.style.height = prev;
    return px / PX_PER_MM;
  }

  /** Drag the border after column/row `i`: it grows, its neighbour shrinks. */
  function startTableResize(e, box, kind, i) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (selectedBoxId !== box.id) selectBox(box.id);
    const el = boxEl(box.id);
    const table = el.querySelector("table.box-table");
    const handle = e.currentTarget;
    const pxPerMm = el.closest(".page").getBoundingClientRect().width / doc.pageW;
    const isCol = kind === "col";
    const sizes = isCol ? box.colWidths : box.rowHeights;
    const span = isCol ? box.w : box.h;          // mm the fractions refer to
    const a0 = sizes[i], b0 = sizes[i + 1];
    // Columns: at least 4 mm. Rows: at least 4 mm and never shorter than their
    // text (a row can't shrink below its content, it would push the table out).
    let minA = 4, minB = 4;
    if (!isCol) {
      minA = Math.max(4, minRowHeightMm(table.rows[i]));
      minB = Math.max(4, minRowHeightMm(table.rows[i + 1]));
    }
    const pairMm = (a0 + b0) * span;
    if (minA + minB > pairMm) minA = minB = pairMm / 2;
    const minFA = minA / span, minFB = minB / span;
    const start = isCol ? e.clientX : e.clientY;

    handle.classList.add("dragging");
    document.body.classList.add(isCol ? "resizing-col" : "resizing-row");
    trackPointer(e, (ev) => {
      const dMm = ((isCol ? ev.clientX : ev.clientY) - start) / pxPerMm;
      const d = clamp(dMm / span, Math.min(0, minFA - a0), Math.max(0, b0 - minFB));
      sizes[i] = a0 + d;
      sizes[i + 1] = b0 - d;
      applyTableSizes(table, box);
      positionTableResizers(el);
    }, (moved) => {
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing-col", "resizing-row");
      if (moved) commit();
    });
  }

  // ── Shapes (drawn in real millimetres, so strokes and corners are true size) ──

  const SVG_NS = "http://www.w3.org/2000/svg";

  function renderShapeSvg(box) {
    const w = box.w, h = box.h;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "shape-svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "none");

    const mk = (tag, attrs) => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    };
    const swPt = Math.max(0, num(box.strokeWidth, 1));
    const sw = swPt / PT_PER_MM;   // stroke width in mm
    const s = sw / 2;               // keep the stroke inside the frame
    const stroke = box.strokeColor || "#000000";
    const type = box.shapeType === "polygon" ? "triangle" : box.shapeType === "ellipse" ? "circle" : box.shapeType;
    const pts = (arr) => arr.map((p) => p.map((v) => round2(v)).join(",")).join(" ");
    let shape = null;
    const extras = [];

    switch (type) {
      case "rectangle": {
        const r = clamp(num(box.radius, 0), 0, Math.min(w, h) / 2);
        shape = mk("rect", { x: s, y: s, width: Math.max(0, w - sw), height: Math.max(0, h - sw), rx: r, ry: r });
        break;
      }
      case "circle":
        shape = mk("ellipse", { cx: w / 2, cy: h / 2, rx: Math.max(0, w / 2 - s), ry: Math.max(0, h / 2 - s) });
        break;
      case "triangle":
        shape = mk("polygon", { points: pts([[w / 2, s], [w - s, h - s], [s, h - s]]) });
        break;
      case "diamond":
        shape = mk("polygon", { points: pts([[w / 2, s], [w - s, h / 2], [w / 2, h - s], [s, h / 2]]) });
        break;
      case "star": {
        const n = clamp(Math.round(num(box.starPoints, 5)), 3, 24);
        const rx = Math.max(0, w / 2 - s), ry = Math.max(0, h / 2 - s);
        const list = [];
        for (let i = 0; i < n * 2; i++) {
          const k = i % 2 === 0 ? 1 : 0.4;
          const a = (i * Math.PI) / n - Math.PI / 2;
          list.push([w / 2 + rx * k * Math.cos(a), h / 2 + ry * k * Math.sin(a)]);
        }
        shape = mk("polygon", { points: pts(list), "stroke-linejoin": "round" });
        break;
      }
      case "line": {
        const dir = box.lineDir || "up";
        let a = [0, h], b = [w, 0];
        if (dir === "down") { a = [0, 0]; b = [w, h]; }
        else if (dir === "h") { a = [0, h / 2]; b = [w, h / 2]; }
        else if (dir === "v") { a = [w / 2, 0]; b = [w / 2, h]; }
        const ends = box.lineEnds || "none";
        const head = Math.max(2.2, sw * 4.5);
        const arrow = (tip, from) => {
          const dx = tip[0] - from[0], dy = tip[1] - from[1];
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          const bx = tip[0] - ux * head, by = tip[1] - uy * head;
          const hw = head * 0.42;
          extras.push(mk("polygon", { points: pts([tip, [bx - uy * hw, by + ux * hw], [bx + uy * hw, by - ux * hw]]), fill: stroke }));
          return [tip[0] - ux * head * 0.8, tip[1] - uy * head * 0.8];
        };
        let a2 = a, b2 = b;
        if (ends === "end" || ends === "both") b2 = arrow(b, a);
        if (ends === "start" || ends === "both") a2 = arrow(a, b);
        shape = mk("line", { x1: a2[0], y1: a2[1], x2: b2[0], y2: b2[1], "stroke-linecap": box.dash === "dotted" ? "round" : "butt" });
        break;
      }
    }
    if (shape) {
      shape.setAttribute("fill", type === "line" ? "none" : box.fillColor || "none");
      shape.setAttribute("stroke", sw > 0 ? stroke : "none");
      shape.setAttribute("stroke-width", sw);
      const dash = box.dash || (box.strokeDasharray && box.strokeDasharray !== "none" ? "dashed" : "solid");
      if (dash === "dashed") shape.setAttribute("stroke-dasharray", `${round2(Math.max(sw * 4, 1.2))} ${round2(Math.max(sw * 2.5, 0.8))}`);
      else if (dash === "dotted") {
        shape.setAttribute("stroke-dasharray", `0 ${round2(Math.max(sw * 2, 0.6))}`);
        shape.setAttribute("stroke-linecap", "round");
      }
      svg.appendChild(shape);
      extras.forEach((x) => svg.appendChild(x));
    }
    return svg;
  }

  function refreshShape(el, box) {
    const old = el.querySelector("svg.shape-svg");
    if (!old) return;
    const svg = renderShapeSvg(box);
    svg.addEventListener("pointerdown", (e) => startDrag(e, box));
    old.replaceWith(svg);
  }

  // ── Pages rail ───────────────────────────────────────────────────────

  function renderRail() {
    pagesRail.textContent = "";
    const thumbH = Math.round(120 * (doc.pageH / doc.pageW));
    const frag = document.createDocumentFragment();
    doc.pages.forEach((page, idx) => {
      const wrap = document.createElement("div");
      wrap.className = "page-thumb-wrap";

      const thumb = document.createElement("div");
      thumb.className = "page-thumb" + (idx === currentPageIndex ? " current" : "");
      thumb.style.height = thumbH + "px";
      thumb.style.background = doc.pageBg || "#FFFFFF";
      thumb.title = "Page " + (idx + 1);
      for (const box of page.boxes) {
        const mini = document.createElement("div");
        mini.className = "mini-box" + (box.hidden ? " is-hidden" : "");
        mini.style.left = (box.x / doc.pageW) * 100 + "%";
        mini.style.top = (box.y / doc.pageH) * 100 + "%";
        mini.style.width = (box.w / doc.pageW) * 100 + "%";
        mini.style.height = (box.h / doc.pageH) * 100 + "%";
        if (box.rotation) mini.style.transform = `rotate(${box.rotation}deg)`;
        thumb.appendChild(mini);
      }
      thumb.addEventListener("click", () => goToPage(idx));

      const actions = document.createElement("div");
      actions.className = "page-thumb-actions";
      const mkBtn = (label, title, fn, cls) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pta" + (cls ? " " + cls : "");
        b.title = title;
        b.setAttribute("aria-label", title);
        b.textContent = label;
        b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
        actions.appendChild(b);
      };
      if (idx > 0) mkBtn("↑", "Move page " + (idx + 1) + " up", () => movePage(idx, -1));
      if (idx < doc.pages.length - 1) mkBtn("↓", "Move page " + (idx + 1) + " down", () => movePage(idx, 1));
      mkBtn("⧉", "Duplicate page " + (idx + 1), () => duplicatePage(idx));
      mkBtn("×", "Delete page " + (idx + 1), () => deletePage(idx), "danger");
      thumb.appendChild(actions);
      wrap.appendChild(thumb);

      const numEl = document.createElement("div");
      numEl.className = "page-num";
      numEl.textContent = "Page " + (idx + 1) + (page.skipHF ? " ·" : "");
      if (page.skipHF) numEl.title = "No header, footer or number on this page";
      wrap.appendChild(numEl);
      frag.appendChild(wrap);
    });

    const addBtn = document.createElement("button");
    addBtn.className = "add-page-btn";
    addBtn.textContent = "+ Add page";
    addBtn.addEventListener("click", () => {
      doc.pages.splice(currentPageIndex + 1, 0, newPage());
      currentPageIndex++;
      setSel([]);
      commit();
      renderAll();
    });
    frag.appendChild(addBtn);
    pagesRail.appendChild(frag);
    const cur = pagesRail.querySelector(".page-thumb.current");
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
  }

  function goToPage(idx) {
    if (idx === currentPageIndex) return;
    currentPageIndex = clamp(idx, 0, doc.pages.length - 1);
    setSel([]);
    renderAll();
    $("canvas-scroll").scrollTop = 0;
  }

  // ── Zoom ─────────────────────────────────────────────────────────────

  function applyZoom() {
    pageStage.style.transform = zoom === 1 ? "" : `scale(${zoom})`;
    zoomSizer.style.width = pageStage.offsetWidth * zoom + "px";
    zoomSizer.style.height = pageStage.offsetHeight * zoom + "px";
    syncZoomSelect();
  }

  function syncZoomSelect() {
    if (!zoomSelect) return;
    if (zoomMode) { zoomSelect.value = zoomMode; return; }
    const match = Array.from(zoomSelect.options).find((o) => Math.abs(parseFloat(o.value) - zoom) < 0.001);
    if (match) zoomSelect.value = match.value;
    else {
      const custom = $("zoom-custom");
      custom.textContent = Math.round(zoom * 100) + "%";
      zoomSelect.value = "custom";
    }
  }

  function setZoom(z, keepMode) {
    if (!keepMode) zoomMode = null;
    zoom = clamp(+z.toFixed(3), 0.2, 4);
    applyZoom();
  }

  function fitZoom(mode) {
    const sc = $("canvas-scroll");
    const cs = getComputedStyle(sc);
    const availW = sc.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 4;
    const availH = sc.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 4;
    const pw = doc.pageW * PX_PER_MM, ph = doc.pageH * PX_PER_MM;
    zoomMode = mode;
    setZoom(mode === "fit-width" ? availW / pw : Math.min(availW / pw, availH / ph), true);
  }

  zoomSelect.addEventListener("change", () => {
    const v = zoomSelect.value;
    if (v === "fit-page" || v === "fit-width") fitZoom(v);
    else if (v !== "custom") setZoom(parseFloat(v));
  });
  window.addEventListener("resize", () => { if (zoomMode) fitZoom(zoomMode); });

  // ── Properties panel state ───────────────────────────────────────────

  const setVal = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
  const setOn = (id, on) => { const el = $(id); if (el) el.classList.toggle("active", !!on); };
  const setChk = (id, on) => { const el = $(id); if (el) el.checked = !!on; };
  const setDis = (id, off) => { const el = $(id); if (el) el.disabled = !!off; };

  // Lengths: stored in mm, shown in the chosen unit.
  const toU = (mm) => {
    const d = Math.pow(10, UNIT_DECIMALS[unit]);
    return Math.round((mm / MM_PER[unit]) * d) / d;
  };
  const fromU = (v, fallbackMm) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n * MM_PER[unit] : fallbackMm;
  };
  const setLen = (id, mm) => setVal(id, mm == null || mm === "" ? "" : toU(mm));
  const lenOf = (id, fallbackMm) => fromU($(id).value, fallbackMm);

  function applyUnitLabels() {
    document.querySelectorAll(".u").forEach((el) => (el.textContent = unit));
    document.querySelectorAll("input[data-len]").forEach((i) => {
      i.step = UNIT_STEP[unit];
      i.removeAttribute("min");
      i.removeAttribute("max");
    });
  }

  function setUnit(u) {
    if (!MM_PER[u]) return;
    unit = u;
    uiPrefs.unit = u;
    saveUiPrefs();
    applyUnitLabels();
    if (window.PublisherFeatures && window.PublisherFeatures.currentUnit !== u) window.PublisherFeatures.setUnit(u);
    renderToolbarState();
    if (!setupOverlay.hidden) fillSetupForm();
  }
  document.addEventListener("change", (e) => { if (e.target && e.target.id === "unit-selector") setUnit(e.target.value); });

  function renderToolbarState() {
    const multi = isMulti();
    const box = multi ? null : selectedBox();
    const type = multi ? "multi" : box ? box.type : "none";
    propsPanel.dataset.sel = type;
    // Newly selected object (clicked or just placed): show its tab.
    if (box && box.id !== lastTabFor) showTabFor(type);
    lastTabFor = box ? box.id : null;
    const isText = type === "text";
    const isTable = type === "table";
    const isShape = type === "shape";
    const isImage = type === "image";
    const sel = selectedBoxes();

    deleteBoxBtn.disabled = !sel.length || sel.every((b) => b.locked);
    $("btn-delete-obj").disabled = deleteBoxBtn.disabled;
    scheduleStatus();
    setDis("obj-copy", !sel.length);
    setDis("obj-duplicate", !sel.length);
    setDis("obj-paste", !clipboard);

    if (isText || isTable) {
      setVal("font-family", box.fontFamily);
      if (fontFamilySel.value !== box.fontFamily) fontFamilySel.selectedIndex = -1;
      setVal("font-size", box.fontSize);
    }
    if (isText) {
      textColorInput.value = isHex(box.color) ? box.color : "#1b1d22";
      setVal("line-height", box.lineHeight || 1.2);
      setVal("letter-spacing", box.letterSpacing || 0);
      setVal("word-spacing", box.wordSpacing || 0);
      setLen("space-before", box.spaceBefore || 0);
      setLen("space-after", box.spaceAfter || 0);
      setLen("indent-first", box.indentFirst || 0);
      setLen("indent-left", box.indentLeft || 0);
      setLen("indent-right", box.indentRight || 0);
      setVal("text-case", box.textCase || "none");
      setVal("drop-cap", String(box.dropCap || 0));
      setVal("list-style", box.olStyle || "bengali");
      setVal("bullet-style", box.ulStyle || "disc");
      setChk("hyphenate", !!box.hyphenate);
      setOn("style-bold", box.bold);
      setOn("style-italic", box.italic);
      setOn("style-underline", box.underline);
      setOn("style-strike", box.strike);
      setOn("style-sup", false);
      setOn("style-sub", false);
      ["left", "center", "right", "justify"].forEach((a) => setOn("align-" + a, box.align === a));
      renderStyleSelect(box);

      setVal("frame-cols", box.columns || 1);
      setLen("frame-gap", box.columnGap ?? 5);
      setLen("frame-inset", box.inset == null ? "" : box.inset);
      $("frame-inset").placeholder = box.inset == null ? "auto" : "";
      ["top", "middle", "bottom"].forEach((v) => setOn("valign-" + v, (box.valign || "top") === v));
      renderThreadState(box);
    }
    setDis("link-remove", true);
    if (isTable) {
      const cell = activeCellModel(box);
      ["left", "center", "right", "justify"].forEach((a) => setOn("align-" + a, cell && (cell.align || "left") === a));
      ["style-bold", "style-italic", "style-underline", "style-strike", "style-sup", "style-sub"].forEach((id) => setOn(id, false));
      if (cell) {
        $("tbl-cell-fill").value = isHex(cell.bgColor) ? cell.bgColor : "#FFFFFF";
        $("tbl-cell-text").value = isHex(cell.textColor) ? cell.textColor : "#000000";
        setVal("tbl-valign", cell.valign || "top");
      }
      setVal("tbl-border-w", box.borderWidth ?? 1);
      $("tbl-border-c").value = isHex(box.borderColor) ? box.borderColor : "#000000";
      setVal("tbl-pad", box.cellPadding ?? 4);
    }
    if (isText || isImage) {
      setChk("frame-fill-on", !!box.frameFill);
      if (box.frameFill) $("frame-fill").value = box.frameFill;
      setVal("frame-border-w", box.frameBorderWidth || 0);
      $("frame-border-c").value = isHex(box.frameBorderColor) ? box.frameBorderColor : "#000000";
    }
    if (isImage) setVal("image-fit", box.imgFit || "contain");
    if (isShape) {
      const st = box.shapeType === "polygon" ? "triangle" : box.shapeType === "ellipse" ? "circle" : box.shapeType;
      setVal("shape-type", st);
      const fillOn = !!box.fillColor && box.fillColor !== "none";
      setChk("shape-fill-on", fillOn);
      if (fillOn && isHex(box.fillColor)) $("shape-fill-color").value = box.fillColor;
      $("shape-stroke-color").value = isHex(box.strokeColor) ? box.strokeColor : "#000000";
      setVal("shape-stroke-width", box.strokeWidth ?? 1);
      setVal("shape-dash", box.dash || (box.strokeDasharray && box.strokeDasharray !== "none" ? "dashed" : "solid"));
      setLen("shape-radius", box.radius || 0);
      setVal("shape-points", box.starPoints || 5);
      setVal("line-dir", box.lineDir || "up");
      setVal("line-ends", box.lineEnds || "none");
      $("f-radius").hidden = st !== "rectangle";
      $("f-star-points").hidden = st !== "star";
      $("f-line-opts").hidden = st !== "line";
      $("f-shape-fill").hidden = st === "line";
    }
    if (box) {
      const wrap = box.wrap || "none";
      ["none", "box", "contour", "jump"].forEach((w) => setOn("wrap-" + w, wrap === w));
      setDis("wrap-contour", !isShape);
      setLen("wrap-offset", box.wrapOffset ?? 3);
      setChk("wrap-ignore", !!box.ignoreWrap);
      $("obj-link-text").textContent = box.link ? linkLabel(box.link) : "None";
      $("obj-link-text").title = box.link || "";
      setDis("obj-link-remove", !box.link);
    }

    // Arrange: one object, or the bounds of several.
    if (sel.length) {
      const bb = bounds(sel);
      const b0 = multi ? null : box;
      setLen("geo-x", multi ? bb.x0 : b0.x);
      setLen("geo-y", multi ? bb.y0 : b0.y);
      setLen("geo-w", multi ? bb.w : b0.w);
      setLen("geo-h", multi ? bb.h : b0.h);
      setVal("geo-rot", multi ? "" : b0.rotation || 0);
      setVal("geo-opacity", Math.round((sel[0].opacity ?? 1) * 100));
      setChk("geo-lock", sel.every((b) => b.locked));
      ["geo-w", "geo-h", "geo-rot"].forEach((id) => setDis(id, multi));
      $("geo-note").textContent = multi ? `· ${sel.length} objects` : "";
      setDis("layer-show", !sel.some((b) => b.hidden));
      setDis("layer-hide", sel.every((b) => b.hidden));
      setDis("obj-group", !multi);
      setDis("obj-ungroup", !sel.some((b) => b.groupId));
      setDis("obj-dist-h", sel.length < 3);
      setDis("obj-dist-v", sel.length < 3);
      const alignTo = $("align-to");
      alignTo.querySelector('option[value="selection"]').disabled = !multi;
      if (!multi && alignTo.value === "selection") alignTo.value = "margins";
    }

    // Page pane
    setVal("doc-title", doc.title || "");
    setChk("page-skip-hf", !!doc.pages[currentPageIndex].skipHF);
    setChk("view-margins", !!doc.showMarginGuides);
    $("page-up").disabled = currentPageIndex === 0;
    $("page-down").disabled = currentPageIndex >= doc.pages.length - 1;
    $("page-summary").textContent = pageSummary();

    $("lang-bn").classList.toggle("active", doc.lang === "bn");
    $("lang-as").classList.toggle("active", doc.lang === "as");
    $("toggle-phonetic").classList.toggle("active", !!doc.phonetic);
    pageStage.classList.toggle("linking", !!linkMode);
    syncZoomSelect();
    if (isText || isTable) updateCharState();
  }

  function renderThreadState(box) {
    const head = threadHead(box);
    const chain = threadChain(head);
    let msg = "This frame stands alone.";
    if (chain.length > 1) {
      const i = chain.indexOf(box);
      msg = `Frame ${i + 1} of ${chain.length} in this story.`;
      if (box.next) {
        const pi = pageIndexOf(box.next);
        msg += pi === currentPageIndex ? " Continues in another frame on this page." : ` Continues on page ${pi + 1}.`;
      }
    }
    if (linkMode && linkMode.fromId === box.id) msg = "Now click an empty text frame (any page) to continue the text there. Esc cancels.";
    $("thread-status").textContent = msg;
    setDis("thread-link", !!box.next);
    setDis("thread-newpage", !!box.next);
    setDis("thread-unlink", !box.next);
    setOn("thread-link", !!linkMode);
  }

  function pageSummary() {
    const preset = detectPreset();
    const name = preset === "custom" ? `${toU(doc.pageW)} × ${toU(doc.pageH)} ${unit}` : $("page-size-preset").querySelector(`option[value="${preset}"]`).textContent.replace(/\s*\(.*\)$/, "");
    const orient = doc.pageW > doc.pageH ? "landscape" : "portrait";
    const cols = doc.columns > 1 ? `, ${doc.columns} columns` : "";
    return `${name}, ${orient}${cols} · ${doc.pages.length} page${doc.pages.length > 1 ? "s" : ""}`;
  }

  /**
   * Select an object (with the rest of its group). opts.toggle adds/removes it
   * from the selection (Shift+click); opts.single selects it alone even inside a group.
   */
  function selectBox(id, opts) {
    opts = opts || {};
    const box = id && findBox(id);
    if (box && opts.toggle) {
      const members = groupMembers(box).map((b) => b.id);
      const allIn = members.every((m) => selection.has(m));
      const ids = new Set(selection);
      members.forEach((m) => (allIn ? ids.delete(m) : ids.add(m)));
      const arr = Array.from(ids);
      setSel(arr, allIn ? (ids.has(selectedBoxId) ? selectedBoxId : arr[arr.length - 1] || null) : id);
    } else if (box) {
      setSel(opts.single ? [id] : groupMembers(box).map((b) => b.id), id);
    } else {
      setSel([]);
    }
    if (savedSel && (isMulti() || !savedSel.host.isConnected || savedSel.host.closest(".box")?.dataset.boxId !== selectedBoxId)) savedSel = null;
    if (isMulti() && document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
    syncSelectionDom();
    renderToolbarState();
  }

  function syncSelectionDom() {
    const single = selection.size === 1;
    pageStage.querySelectorAll(".box").forEach((el) => {
      const on = selection.has(el.dataset.boxId);
      el.classList.toggle("selected", on);
      el.classList.toggle("primary", on && single);
    });
    updateMultiOverlay();
  }

  /** Dashed frame round several selected objects, with a move tab and a scale handle. */
  function updateMultiOverlay() {
    const pageEl = pageStage.querySelector(".page");
    if (!pageEl) return;
    let ov = pageEl.querySelector(".multi-sel");
    const page = doc.pages[currentPageIndex];
    const boxes = selectedBoxes().filter((b) => page.boxes.includes(b));
    if (boxes.length < 2 || printing) { if (ov) ov.remove(); return; }
    if (!ov) {
      ov = document.createElement("div");
      ov.className = "multi-sel";
      const grip = document.createElement("div");
      grip.className = "grip";
      grip.title = "Drag to move the selection";
      grip.addEventListener("pointerdown", (e) => { const b = selectedBoxes()[0]; if (b) startDrag(e, b, true); });
      const handle = document.createElement("div");
      handle.className = "resize-handle";
      handle.title = "Drag to scale the selection (Shift keeps proportions)";
      handle.addEventListener("pointerdown", startGroupResize);
      ov.append(grip, handle);
      pageEl.appendChild(ov);
    }
    const bb = bounds(boxes);
    ov.style.left = bb.x0 + "mm";
    ov.style.top = bb.y0 + "mm";
    ov.style.width = bb.w + "mm";
    ov.style.height = bb.h + "mm";
    ov.classList.toggle("grouped", boxes.every((b) => b.groupId && b.groupId === boxes[0].groupId));
  }

  // ── Properties panel: tabs ───────────────────────────────────────────

  const UI_PREF_KEY = "lekhoni-ui";
  const uiPrefs = (() => {
    try { return JSON.parse(localStorage.getItem(UI_PREF_KEY)) || {}; } catch (e) { return {}; }
  })();
  const saveUiPrefs = () => {
    try { localStorage.setItem(UI_PREF_KEY, JSON.stringify(uiPrefs)); } catch (e) { }
  };

  const panelTabs = Array.from(propsPanel.querySelectorAll(".ptab"));

  function showTab(name) {
    if (!panelTabs.some((t) => t.dataset.tab === name)) name = "text";
    for (const tab of panelTabs) {
      const on = tab.dataset.tab === name;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on);
    }
    propsPanel.querySelectorAll(".ppane").forEach((p) => (p.hidden = p.dataset.pane !== name));
    uiPrefs.tab = name;
    saveUiPrefs();
  }

  /** On a new selection, jump to the tab that formats it (unless on Page/Arrange). */
  function showTabFor(type) {
    const current = panelTabs.find((t) => t.classList.contains("active"))?.dataset.tab;
    if (current === "page" || current === "arrange") return;
    showTab(type === "text" || type === "table" ? "text" : "frame");
  }

  panelTabs.forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));

  function setPanelVisible(visible) {
    $("workspace").classList.toggle("panel-hidden", !visible);
    $("toggle-panel").classList.toggle("active", visible);
    uiPrefs.panel = visible;
    saveUiPrefs();
    if (zoomMode) requestAnimationFrame(() => fitZoom(zoomMode));
  }
  $("toggle-panel").addEventListener("click", () =>
    setPanelVisible($("workspace").classList.contains("panel-hidden"))
  );

  showTab(uiPrefs.tab === "shape" ? "frame" : uiPrefs.tab || "text");
  setPanelVisible(uiPrefs.panel !== undefined ? uiPrefs.panel : window.innerWidth >= 1000);

  // Buttons in the panel must not steal the text selection.
  propsPanel.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });

  // ── Tools & placing boxes ────────────────────────────────────────────

  const TOOL_IDS = {
    text: "tool-text", image: "tool-image", table: "tool-table",
    rectangle: "tool-rectangle", circle: "tool-circle", star: "tool-star", line: "tool-line",
  };
  const SHAPE_TOOLS = ["rectangle", "circle", "star", "line"];

  function setTool(tool) {
    activeTool = tool || null;
    for (const [k, id] of Object.entries(TOOL_IDS)) $(id).classList.toggle("active", k === activeTool);
    pageStage.classList.toggle("placing", !!activeTool);
  }

  Object.entries(TOOL_IDS).forEach(([tool, id]) => {
    $(id).addEventListener("click", () => setTool(activeTool === tool ? null : tool));
  });

  function placeBoxAt(page, pageEl, evt) {
    const rect = pageEl.getBoundingClientRect();
    const xMm = ((evt.clientX - rect.left) / rect.width) * doc.pageW;
    const yMm = ((evt.clientY - rect.top) / rect.height) * doc.pageH;

    if (activeTool === "table") {
      tableOverlay.hidden = false;
      pendingTableInsert = { page, xMm, yMm };
      $("table-rows").focus();
      return;
    }

    const isShape = SHAPE_TOOLS.includes(activeTool);
    const type = isShape ? "shape" : activeTool;
    const w = isShape ? 60 : activeTool === "text" ? 80 : 60;
    const h = isShape ? (activeTool === "line" ? 10 : 60) : activeTool === "text" ? 30 : 60;
    const box = newBox(type, clamp(xMm - w / 2, 0, doc.pageW - w), clamp(yMm - h / 2, 0, doc.pageH - h), w, h);

    if (type === "text") {
      box.fontFamily = fontFamilySel.value || DEFAULT_FONT;
      box.fontSize = clamp(num(fontSizeInput.value, 14), 4, 400);
    }
    if (isShape) {
      Shapes.initShapeBox(box, activeTool);
      box.dash = "solid";
      if (activeTool === "line") { box.lineDir = "h"; box.lineEnds = "none"; }
      if (activeTool === "star") box.starPoints = 5;
    }

    evt.preventDefault(); // keep focus where we put it below
    page.boxes.push(box);
    setTool(null);
    setSel([box.id]);
    commit();
    renderAll();
    if (box.type === "text") {
      const t = boxEl(box.id)?.querySelector(".box-text");
      if (t) t.focus();
    } else if (box.type === "image") {
      pickImageFor(box.id);
    }
  }

  // ── Drag & resize (pointer events: mouse, touch and pen) ─────────────

  function snapGuides() {
    const m = getEffectiveMargins(currentPageIndex);
    const vertical = [0, m.left, doc.pageW - m.right, doc.pageW, doc.pageW / 2, ...columnEdges(currentPageIndex)];
    const horizontal = [0, m.top, doc.pageH - m.bottom, doc.pageH, doc.pageH / 2];
    for (const g of doc.guides || []) {
      if (g.orientation === "v") vertical.push(g.posMM);
      if (g.orientation === "h") horizontal.push(g.posMM);
    }
    return { vertical, horizontal };
  }

  function trackPointer(e, onMove, onDone) {
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch (err) { }
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return; // a click, not a drag
      moved = true;
      onMove(ev);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      if (moved) lastDragEnd = Date.now();
      onDone(moved);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  function startDrag(e, box, fromOverlay) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!fromOverlay && boxPointerPrelude(e, box)) return;
    if (!selection.has(box.id)) selectBox(box.id);
    const boxes = isMulti() ? selectedBoxes() : [box];
    if (boxes.some((b) => b.locked)) { note("Locked — unlock it in Arrange to move"); return; }
    e.preventDefault();
    const pageEl = pageStage.querySelector(".page");
    const pxPerMm = pageEl.getBoundingClientRect().width / doc.pageW;
    const startX = e.clientX, startY = e.clientY;
    const orig = boxes.map((b) => [b.x, b.y]);
    const bb = bounds(boxes);
    const guides = snapGuides();
    const threshold = 6 / pxPerMm; // ~6 screen px at any zoom
    const B = pageBounds();

    trackPointer(e, (ev) => {
      let dx = clamp((ev.clientX - startX) / pxPerMm, B.x0 - bb.x0, B.x1 - bb.x1);
      let dy = clamp((ev.clientY - startY) / pxPerMm, B.y0 - bb.y0, B.y1 - bb.y1);
      if (!ev.altKey && typeof window.snapToGuides === "function") {
        const p = window.snapToGuides({ x: bb.x0 + dx, y: bb.y0 + dy, w: bb.w, h: bb.h }, guides, threshold);
        dx = p.x - bb.x0;
        dy = p.y - bb.y0;
      }
      boxes.forEach((b, i) => {
        b.x = orig[i][0] + dx;
        b.y = orig[i][1] + dy;
        const el = boxEl(b.id);
        if (el) { el.style.left = b.x + "mm"; el.style.top = b.y + "mm"; }
      });
      updateMultiOverlay();
      liveWrap();
    }, (moved) => {
      if (!moved) return;
      refreshLayout();
      renderRail();
      renderToolbarState();
      commit();
    });
  }

  function startResize(e, box) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (box.locked) { note("Locked — unlock it in Arrange to resize"); return; }
    const el = boxEl(box.id);
    const pxPerMm = el.closest(".page").getBoundingClientRect().width / doc.pageW;
    const startX = e.clientX, startY = e.clientY;
    const origW = box.w, origH = box.h;
    const ratio = origW / origH;
    const b = pageBounds();

    trackPointer(e, (ev) => {
      let w = clamp(origW + (ev.clientX - startX) / pxPerMm, 5, b.x1 - box.x);
      let h = clamp(origH + (ev.clientY - startY) / pxPerMm, 5, b.y1 - box.y);
      if (ev.shiftKey) {
        if (w / ratio > h) h = w / ratio; else w = h * ratio;
        if (box.x + w > b.x1) { w = b.x1 - box.x; h = w / ratio; }
        if (box.y + h > b.y1) { h = b.y1 - box.y; w = h * ratio; }
      }
      box.w = w;
      box.h = h;
      el.style.width = box.w + "mm";
      el.style.height = box.h + "mm";
      redrawGeometry(el, box);
      liveWrap();
    }, (moved) => {
      if (!moved) return;
      refreshLayout();
      renderRail();
      renderToolbarState();
      commit();
    });
  }

  // ── Rotation handle ──────────────────────────────────────────────────

  const normAngle = (r) => { r = r % 360; if (r > 180) r -= 360; if (r <= -180) r += 360; return Math.round(r * 10) / 10; };

  function setRotation(box, deg, done) {
    if (box.locked) { note("Locked — unlock it in Arrange to rotate"); return; }
    box.rotation = normAngle(deg);
    const el = boxEl(box.id);
    if (el) positionBox(el, box);
    setVal("geo-rot", box.rotation);
    if (done) {
      refreshLayout();   // rotated frames stop wrapping text, straight ones start again
      renderRail();
      renderToolbarState();
      commit();
    }
  }

  function startRotate(e, box) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (box.locked) { note("Locked — unlock it in Arrange to rotate"); return; }
    const el = boxEl(box.id);
    if (!el) return;
    // The object turns round its centre (CSS transform-origin), which stays put while rotating.
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const angleAt = (ev) => (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI;
    const a0 = angleAt(e), r0 = box.rotation || 0;
    el.classList.add("rotating");
    trackPointer(e, (ev) => {
      let deg = r0 + angleAt(ev) - a0;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      else if (Math.abs(normAngle(deg) % 90) < 2 || Math.abs(normAngle(deg) % 90) > 88) deg = Math.round(deg / 90) * 90; // gentle snap to square
      setRotation(box, deg, false);
      note("Rotation " + box.rotation + "°");
    }, (moved) => {
      el.classList.remove("rotating");
      if (moved) setRotation(box, box.rotation || 0, true);
    });
  }

  /** Bits of an object that depend on its size. */
  function redrawGeometry(el, box) {
    if (!el) return;
    if (box.type === "table") {
      applyTableSizes(el.querySelector("table.box-table"), box);
      positionTableResizers(el);
    } else if (box.type === "shape") {
      refreshShape(el, box);
    } else if (box.type === "text") {
      updateOverset(el, box);
    }
  }

  /** Scale every selected object from the selection's top-left corner. */
  function startGroupResize(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const boxes = selectedBoxes();
    if (boxes.some((b) => b.locked)) { note("Some of these are locked"); return; }
    const pageEl = pageStage.querySelector(".page");
    const pxPerMm = pageEl.getBoundingClientRect().width / doc.pageW;
    const bb = bounds(boxes);
    const orig = boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
    const B = pageBounds();
    const sx0 = e.clientX, sy0 = e.clientY;
    trackPointer(e, (ev) => {
      let w = clamp(bb.w + (ev.clientX - sx0) / pxPerMm, 5, B.x1 - bb.x0);
      let h = clamp(bb.h + (ev.clientY - sy0) / pxPerMm, 5, B.y1 - bb.y0);
      if (ev.shiftKey) {
        const k = Math.min(w / bb.w, h / bb.h);
        w = bb.w * k;
        h = bb.h * k;
      }
      const kx = w / bb.w, ky = h / bb.h;
      boxes.forEach((b, i) => {
        const o = orig[i];
        b.x = bb.x0 + (o.x - bb.x0) * kx;
        b.y = bb.y0 + (o.y - bb.y0) * ky;
        b.w = Math.max(1, o.w * kx);
        b.h = Math.max(1, o.h * ky);
        const el = boxEl(b.id);
        if (el) { positionBox(el, b); redrawGeometry(el, b); }
      });
      updateMultiOverlay();
      liveWrap();
    }, (moved) => {
      if (!moved) return;
      refreshLayout();
      renderRail();
      renderToolbarState();
      commit();
    });
  }

  /** Rubber-band selection on an empty part of the page. */
  function startMarquee(e, pageEl, page) {
    if (e.button !== 0) return;
    e.preventDefault();
    const a = document.activeElement;
    if (a && a.isContentEditable) a.blur();
    const rect = pageEl.getBoundingClientRect();
    const k = rect.width / doc.pageW;
    const x0 = (e.clientX - rect.left) / k, y0 = (e.clientY - rect.top) / k;
    const base = e.shiftKey ? Array.from(selection) : [];
    let mq = null, x1 = x0, y1 = y0;
    trackPointer(e, (ev) => {
      const r = pageEl.getBoundingClientRect();
      x1 = (ev.clientX - r.left) / k;
      y1 = (ev.clientY - r.top) / k;
      if (!mq) { mq = document.createElement("div"); mq.className = "marquee"; pageEl.appendChild(mq); }
      mq.style.left = Math.min(x0, x1) + "mm";
      mq.style.top = Math.min(y0, y1) + "mm";
      mq.style.width = Math.abs(x1 - x0) + "mm";
      mq.style.height = Math.abs(y1 - y0) + "mm";
    }, (moved) => {
      if (mq) mq.remove();
      if (!moved) { if (!e.shiftKey) selectBox(null); return; }
      const rx0 = Math.min(x0, x1), rx1 = Math.max(x0, x1), ry0 = Math.min(y0, y1), ry1 = Math.max(y0, y1);
      const ids = new Set(base);
      for (const b of page.boxes) {
        if (b.x > rx1 || b.x + b.w < rx0 || b.y > ry1 || b.y + b.h < ry0) continue;
        groupMembers(b).forEach((m) => ids.add(m.id));
      }
      const arr = Array.from(ids);
      setSel(arr, arr[arr.length - 1] || null);
      savedSel = null;
      syncSelectionDom();
      renderToolbarState();
    });
  }

  // ── Phonetic typing (live conversion) ────────────────────────────────
  //
  // Each editable keeps the roman letters of the word being typed (buf) and the
  // script text currently shown for them (out). Every keystroke re-transliterates
  // the whole buffer and replaces `out` in place, so the page only ever shows
  // script. Space, punctuation, arrows, clicks and blur end the word.

  // Keys that continue a word. "'" also continues one, but only mid-word
  // (a leading apostrophe is an ordinary quote mark).
  const PH_WORD_CHAR = /^[a-zA-Z0-9.:^~`$,+]$/;
  const phState = new WeakMap();

  function ph(el) {
    let s = phState.get(el);
    if (!s) phState.set(el, (s = { buf: "", out: "" }));
    return s;
  }

  function phReset(el) {
    const s = phState.get(el);
    if (s) { s.buf = ""; s.out = ""; }
  }

  function renderBuffer(buf) {
    if (!buf) return "";
    let out = Translit.parse(buf);
    // A trailing apostrophe would become an invisible ZWNJ; show it as a
    // quote mark until a letter follows it.
    if (buf.endsWith("'")) out = out.replace(/‌+$/, (m) => "'".repeat(m.length));
    return out;
  }

  /**
   * Range covering the `n` characters of text immediately before the caret
   * (within `el`), plus that text. Null if there aren't that many.
   */
  function textBeforeCaret(el, caret, n) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const segs = [];
    let t;
    while ((t = walker.nextNode())) {
      if (t === caret.startContainer) { segs.push([t, caret.startOffset]); break; }
      if (caret.comparePoint(t, 0) > 0) break;
      segs.push([t, t.length]);
    }
    let need = n, str = "", start = null;
    for (let i = segs.length - 1; i >= 0 && need > 0; i--) {
      const [node, end] = segs[i];
      const take = Math.min(need, end);
      str = node.data.slice(end - take, end) + str;
      need -= take;
      start = [node, end - take];
    }
    if (need > 0) return null;
    const range = document.createRange();
    if (start) range.setStart(start[0], start[1]);
    else range.setStart(caret.startContainer, caret.startOffset);
    range.setEnd(caret.startContainer, caret.startOffset);
    return { range, text: str };
  }

  /** Replace `range` with `text` through the editing pipeline (keeps native undo). */
  function replaceRange(el, range, text) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try {
      if (text) ok = document.execCommand("insertText", false, text);
      else ok = range.collapsed || document.execCommand("delete", false);
    } catch (err) { ok = false; }
    if (ok) return;

    // Fallback for browsers without execCommand support.
    range.deleteContents();
    if (text) {
      const tn = document.createTextNode(text);
      range.insertNode(tn);
      range.setStartAfter(tn);
    }
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function insertLineBreak(el) {
    // Not execCommand("insertLineBreak"): in pre-wrap text Chrome inserts a "\n"
    // character, which its own editing commands then treat as a paragraph end
    // (so justifying a paragraph only reached the part round the caret).
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const br = document.createElement("br");
    range.insertNode(br);
    // A <br> at the very end of a paragraph shows no new line on its own, and the
    // caret would slip back before it: keep the line open with a second <br>.
    let after = br.nextSibling, node = br;
    while (!after && node.parentNode && node.parentNode !== el && !isBlock(node.parentNode)) {
      node = node.parentNode;      // <br> inside a <b>/<span> at the end of the line
      after = node.nextSibling;
    }
    while (after && after.nodeType === 3 && !after.data) after = after.nextSibling;
    if (!after || isBlock(after)) br.after(document.createElement("br"));
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const BLOCK_RE = /^(P|DIV|UL|OL|LI|H[1-6]|BLOCKQUOTE|TABLE)$/;
  const isBlock = (n) => !!n && n.nodeType === 1 && BLOCK_RE.test(n.nodeName);

  /**
   * Text typed before 5.1 (or before the first Enter) sits loose in the box;
   * wrap the run around the caret in a <p> so Enter splits real paragraphs
   * (which take indents and paragraph spacing).
   */
  function wrapLooseLine(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!el.firstChild) {
      const p = document.createElement("p");
      p.appendChild(document.createElement("br"));
      el.appendChild(p);
      const nr = document.createRange();
      nr.setStart(p, 0);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);
      return;
    }
    let node = r.startContainer;
    if (node === el) node = el.childNodes[r.startOffset] || el.childNodes[r.startOffset - 1] || null;
    else while (node && node.parentNode !== el) node = node.parentNode;
    if (!node || isBlock(node)) return;

    let first = node, last = node;
    while (first.previousSibling && !isBlock(first.previousSibling)) first = first.previousSibling;
    while (last.nextSibling && !isBlock(last.nextSibling)) last = last.nextSibling;
    const run = [];
    for (let n = first; n; n = n.nextSibling) { run.push(n); if (n === last) break; }

    // Remember the caret in terms that survive moving the nodes.
    const mapPoint = (c, o) => {
      if (c !== el) return () => [c, o];
      const after = el.childNodes[o] || null;
      const before = o > 0 ? el.childNodes[o - 1] : null;
      return (p) => {
        if (after && run.includes(after)) return [p, run.indexOf(after)];
        if (before && run.includes(before)) return [p, run.indexOf(before) + 1];
        return [el, after ? Array.prototype.indexOf.call(el.childNodes, after) : el.childNodes.length];
      };
    };
    const startAt = mapPoint(r.startContainer, r.startOffset);
    const endAt = mapPoint(r.endContainer, r.endOffset);

    const p = document.createElement("p");
    el.insertBefore(p, first);
    run.forEach((n) => p.appendChild(n));
    const nr = document.createRange();
    const [sc, so] = startAt(p), [ec, eo] = endAt(p);
    nr.setStart(sc, so);
    nr.setEnd(ec, eo);
    sel.removeAllRanges();
    sel.addRange(nr);
  }

  function insertParagraph(el) {
    wrapLooseLine(el);
    let ok = false;
    try { ok = document.execCommand("insertParagraph", false); } catch (err) { }
    if (!ok) insertLineBreak(el);
  }

  function onEditableKeydown(e, el) {
    if (e.isComposing || e.keyCode === 229) return; // native IME in use

    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      phReset(el);
      if (e.shiftKey) insertLineBreak(el);
      else insertParagraph(el);
      return;
    }

    if (!doc.phonetic || !translitReady()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) { phReset(el); return; }

    const s = ph(el);
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const caret = sel.getRangeAt(0);

    if (e.key === "Backspace") {
      if (!s.buf || !caret.collapsed) { phReset(el); return; }
      const prev = textBeforeCaret(el, caret, s.out.length);
      if (!prev || prev.text !== s.out) { phReset(el); return; }
      e.preventDefault();
      s.buf = s.buf.slice(0, -1);
      const out = renderBuffer(s.buf);
      replaceRange(el, prev.range, out);
      s.out = out;
      if (!s.buf) phReset(el);
      return;
    }

    if (e.key.length !== 1) {
      if (/^(Arrow|Home|End|Page|Delete|Tab|Escape)/.test(e.key)) phReset(el);
      return;
    }

    const continuesWord = PH_WORD_CHAR.test(e.key) || (e.key === "'" && s.buf !== "");
    if (!continuesWord) {
      phReset(el); // space/punctuation: let the browser insert it
      return;
    }

    e.preventDefault();
    let target = null;
    if (!caret.collapsed) {
      phReset(el); // typing over a selection starts a new word in its place
      target = caret.cloneRange();
    } else if (s.buf) {
      const prev = textBeforeCaret(el, caret, s.out.length);
      if (prev && prev.text === s.out) target = prev.range;
      else phReset(el); // caret moved or text changed underneath us
    }
    if (!target) target = caret.cloneRange();

    const buf = s.buf + e.key;
    const out = renderBuffer(buf);
    replaceRange(el, target, out);
    s.buf = buf;
    s.out = out;
  }

  function onEditablePaste(e, el) {
    const text = e.clipboardData && e.clipboardData.getData("text/plain");
    if (text == null) return;
    e.preventDefault(); // paste as plain text, not foreign HTML
    phReset(el);
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    // Each line break in the pasted text becomes a real line break (<br>), the
    // same as Shift+Enter, never a hidden "\n" character (which the browser's
    // editing commands treat as the end of a paragraph, breaking Justify).
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    replaceRange(el, sel.getRangeAt(0), lines[0]);
    for (let i = 1; i < lines.length; i++) {
      insertLineBreak(el);
      if (lines[i] && sel.rangeCount) replaceRange(el, sel.getRangeAt(0), lines[i]);
    }
  }

  // ── Selection tracking & character formatting ────────────────────────
  //
  // The last selection inside a text box or cell is remembered, so panel
  // controls (which take focus) can still format exactly the highlighted words.

  const EDITABLE_SEL = ".box-text, .table-cell";
  const editableHost = (node) => {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el ? el.closest(EDITABLE_SEL) : null;
  };

  let charStateQueued = false;
  document.addEventListener("selectionchange", () => {
    const s = window.getSelection();
    if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    const host = editableHost(r.commonAncestorContainer);
    if (!host || !pageStage.contains(host)) return;
    savedSel = { host, range: r.cloneRange() };
    if (!charStateQueued) {
      charStateQueued = true;
      requestAnimationFrame(() => { charStateQueued = false; updateCharState(); });
    }
  });

  /** Saved selection if it is inside the selected object and still on screen. */
  function liveSelection() {
    // Prefer the browser's current selection when the text has focus
    // (selectionchange arrives asynchronously, after fast key presses).
    const ws = window.getSelection();
    if (ws.rangeCount && document.activeElement && document.activeElement.isContentEditable) {
      const r = ws.getRangeAt(0);
      const host = editableHost(r.commonAncestorContainer);
      if (host && host === document.activeElement && pageStage.contains(host)) savedSel = { host, range: r.cloneRange() };
    }
    if (!savedSel || !savedSel.host.isConnected) return null;
    const bel = savedSel.host.closest(".box");
    if (!bel || bel.dataset.boxId !== selectedBoxId) return null;
    return savedSel;
  }
  const hasTextSelection = () => {
    const s = liveSelection();
    return !!s && !s.range.collapsed && s.range.toString().length > 0;
  };

  function activeCellModel(box) {
    if (!box || box.type !== "table" || !activeCell || activeCell.boxId !== box.id) return null;
    return box.cells.find((c) => c.row === activeCell.row && c.col === activeCell.col) || null;
  }

  function cellElement(box, row, col) {
    const table = boxEl(box.id)?.querySelector("table.box-table");
    return table && table.rows[row] ? table.rows[row].cells[col] : null;
  }

  /** The editable the user is working in for the selected object. */
  function currentEditableHost() {
    const box = selectedBox();
    if (!box) return null;
    if (box.type === "text") return boxEl(box.id)?.querySelector(".box-text") || null;
    if (box.type === "table" && activeCell && activeCell.boxId === box.id) return cellElement(box, activeCell.row, activeCell.col);
    return null;
  }

  function selectAllIn(host) {
    const r = document.createRange();
    r.selectNodeContents(host);
    savedSel = { host, range: r };
  }

  function restoreSelection(s) {
    s.host.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(s.range);
  }

  /** Re-read the editable into the model (after DOM fix-ups outside the input event). */
  const syncHost = (host) => host.dispatchEvent(new Event("input", { bubbles: true }));

  /**
   * Run an editing command on the highlighted text. With nothing highlighted,
   * `whole` decides: apply to the whole editable, or do nothing.
   */
  function charCommand(fn, whole) {
    let s = liveSelection();
    if (!s || s.range.collapsed) {
      if (!whole) return false;
      const host = (s && s.host) || currentEditableHost();
      if (!host) return false;
      selectAllIn(host);
      s = savedSel;
    }
    restoreSelection(s);
    try { document.execCommand("styleWithCSS", false, true); } catch (e) { }
    fn(s.host);
    const sel = window.getSelection();
    if (sel.rangeCount) savedSel = { host: s.host, range: sel.getRangeAt(0).cloneRange() };
    syncHost(s.host);
    commit();
    return true;
  }

  const exec = (cmd, val) => () => document.execCommand(cmd, false, val);

  function fontSizeOnSelection(pt) {
    return charCommand((host) => {
      document.execCommand("fontSize", false, "7");
      host.querySelectorAll('font[size="7"]').forEach((f) => {
        f.removeAttribute("size");
        f.style.fontSize = pt + "pt";
      });
      host.querySelectorAll("span, font").forEach((sp) => {
        if (sp.style.fontSize === "xxx-large" || sp.style.fontSize === "-webkit-xxx-large") sp.style.fontSize = pt + "pt";
      });
    }, false);
  }

  /** Show the formatting at the caret (bold on/off, size, font, colour). */
  function updateCharState() {
    const s = liveSelection();
    if (!s || document.activeElement !== s.host) return;
    const r = s.range;
    let node = r.startContainer;
    if (node.nodeType === 1 && node.childNodes[r.startOffset] && !r.collapsed) node = node.childNodes[r.startOffset];
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !s.host.contains(el)) return;
    const cs = getComputedStyle(el);
    let underline = false, strike = false, sup = false, sub = false;
    for (let n = el; n && n !== s.host.parentElement; n = n.parentElement) {
      const c = getComputedStyle(n);
      const line = c.textDecorationLine || c.textDecoration || "";
      if (line.includes("underline")) underline = true;
      if (line.includes("line-through")) strike = true;
      if (c.verticalAlign === "super") sup = true;
      if (c.verticalAlign === "sub") sub = true;
    }
    setOn("style-bold", parseInt(cs.fontWeight, 10) >= 600);
    setOn("style-italic", cs.fontStyle === "italic");
    setOn("style-underline", underline);
    setOn("style-strike", strike);
    setOn("style-sup", sup);
    setOn("style-sub", sub);
    setVal("font-size", Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2);
    const fam = (cs.fontFamily.split(",")[0] || "").replace(/["']/g, "").trim();
    const opt = Array.from(fontFamilySel.options).find((o) => o.value.split(",")[0].replace(/["']/g, "").trim() === fam);
    if (opt && document.activeElement !== fontFamilySel) fontFamilySel.value = opt.value;
    const m = cs.color.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3) textColorInput.value = "#" + m.slice(0, 3).map((v) => (+v | 0).toString(16).padStart(2, "0")).join("");
    if (s.host.classList.contains("box-text")) {
      const block = el.closest("p, li, div:not(.box-text), h1, h2, h3, h4, blockquote") || s.host;
      const ta = getComputedStyle(s.host.contains(block) ? block : s.host).textAlign;
      const a = ta === "center" ? "center" : ta === "right" || ta === "end" ? "right" : ta === "justify" ? "justify" : "left";
      ["left", "center", "right", "justify"].forEach((x) => setOn("align-" + x, a === x));
    }
    const anchor = anchorAtSelection(s);
    setDis("link-remove", !anchor);
    if (anchor && r.collapsed) showLinkBubble(anchor); else hideLinkBubble();
  }

  function anchorAtSelection(s) {
    if (!s) return null;
    const n = s.range.startContainer;
    const el = n.nodeType === 1 ? n : n.parentElement;
    const a = el && el.closest("a[href]");
    return a && s.host.contains(a) ? a : null;
  }

  // ── Pages ────────────────────────────────────────────────────────────

  function deletePage(idx) {
    if (doc.pages.length <= 1) {
      alert("A document needs at least one page.");
      return;
    }
    if (doc.pages[idx].boxes.length && !confirm("Delete this page and everything on it?")) return;
    removeBoxes(doc.pages[idx].boxes.map((b) => b.id));
    doc.pages.splice(idx, 1);
    if (currentPageIndex >= doc.pages.length) currentPageIndex = doc.pages.length - 1;
    else if (currentPageIndex > idx) currentPageIndex--;
    setSel([]);
    commit();
    renderAll();
  }

  function cloneBox(src) {
    const c = JSON.parse(JSON.stringify(src));
    c.id = uid("b");
    if (Array.isArray(c.cells)) c.cells.forEach((cell) => (cell.id = uid("cell_")));
    return c;
  }

  function duplicatePage(idx) {
    const src = doc.pages[idx];
    const groups = new Map();
    const copy = { id: uid("p"), skipHF: !!src.skipHF, boxes: src.boxes.map((b) => {
      const c = cloneBox(cloneForCopy(b));
      if (c.groupId) {
        if (!groups.has(c.groupId)) groups.set(c.groupId, uid("g"));
        c.groupId = groups.get(c.groupId);
      }
      return c;
    }) };
    doc.pages.splice(idx + 1, 0, copy);
    currentPageIndex = idx + 1;
    setSel([]);
    commit();
    renderAll();
    note("Page duplicated");
  }

  function movePage(idx, dir) {
    const to = idx + dir;
    if (to < 0 || to >= doc.pages.length) return;
    const [p] = doc.pages.splice(idx, 1);
    doc.pages.splice(to, 0, p);
    if (currentPageIndex === idx) currentPageIndex = to;
    else if (currentPageIndex === to) currentPageIndex = idx;
    commit();
    renderAll();
  }

  $("page-dup").addEventListener("click", () => duplicatePage(currentPageIndex));
  $("page-up").addEventListener("click", () => movePage(currentPageIndex, -1));
  $("page-down").addEventListener("click", () => movePage(currentPageIndex, 1));
  $("page-skip-hf").addEventListener("change", (e) => changeDoc(() => (doc.pages[currentPageIndex].skipHF = e.target.checked)));
  $("view-margins").addEventListener("change", (e) => changeDoc(() => (doc.showMarginGuides = e.target.checked)));
  $("doc-title").addEventListener("input", (e) => { doc.title = e.target.value; scheduleSave(); });

  // ── Fonts ────────────────────────────────────────────────────────────

  const registeredFonts = new Set();

  function syncCustomFonts() {
    fontFamilySel.querySelectorAll("option[data-custom]").forEach((o) => o.remove());
    for (const font of doc.customFonts) {
      if (!registeredFonts.has(font.family)) {
        registeredFonts.add(font.family);
        try {
          new FontFace(font.family, `url(${font.dataUrl})`).load()
            .then((f) => document.fonts.add(f))
            .catch(() => registeredFonts.delete(font.family));
        } catch (e) { registeredFonts.delete(font.family); }
      }
      const opt = document.createElement("option");
      opt.value = `'${font.family}'`;
      opt.textContent = font.name;
      opt.dataset.custom = "1";
      fontFamilySel.appendChild(opt);
    }
  }

  $("add-font").addEventListener("click", () => fontInput.click());

  fontInput.addEventListener("change", () => {
    const file = fontInput.files && fontInput.files[0];
    fontInput.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const id = uid("f");
      const font = { id, name: file.name.replace(/\.[^.]+$/, ""), family: "CustomFont-" + id, dataUrl: reader.result };
      doc.customFonts.push(font);
      syncCustomFonts();
      fontFamilySel.value = `'${font.family}'`;
      applyToSelected((b) => (b.fontFamily = `'${font.family}'`), { table: true });
      commit();
    };
    reader.readAsDataURL(file);
  });

  // ── Images ───────────────────────────────────────────────────────────

  function pickImageFor(boxId) {
    imageInput.dataset.forBox = boxId;
    imageInput.click();
  }

  /** Read an image file, downscaling very large raster photos. */
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const dataUrl = reader.result;
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(dataUrl);
        const img = new Image();
        img.onerror = () => resolve(dataUrl);
        img.onload = () => {
          const longest = Math.max(img.naturalWidth, img.naturalHeight);
          if (longest <= MAX_IMAGE_SIDE) return resolve(dataUrl);
          const scale = MAX_IMAGE_SIDE / longest;
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(file.type === "image/jpeg"
            ? canvas.toDataURL("image/jpeg", 0.92)
            : canvas.toDataURL("image/png"));
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  imageInput.addEventListener("change", () => {
    const file = imageInput.files && imageInput.files[0];
    const boxId = imageInput.dataset.forBox;
    imageInput.value = "";
    if (!file || !boxId) return;
    note("Loading image…");
    readImage(file).then((src) => {
      const box = findBox(boxId);
      if (!box) return;
      box.imgSrc = src;
      rerenderBox(box);
      renderRail();
      commit();
    }).catch(() => note("Could not read that image"));
  });

  // ── Page setup modal ─────────────────────────────────────────────────

  function detectPreset() {
    const w = Math.min(doc.pageW, doc.pageH), h = Math.max(doc.pageW, doc.pageH);
    for (const [key, [pw, ph]] of Object.entries(PAGE_PRESETS)) {
      if (Math.abs(w - pw) < 0.05 && Math.abs(h - ph) < 0.05) return key;
    }
    return "custom";
  }

  function fillSetupForm() {
    $("page-size-preset").value = detectPreset();
    setLen("page-w", doc.pageW);
    setLen("page-h", doc.pageH);
    const land = doc.pageW > doc.pageH;
    setOn("orient-portrait", !land);
    setOn("orient-landscape", land);
    setLen("margin-top", doc.margins.top);
    setLen("margin-right", doc.margins.right);
    setLen("margin-bottom", doc.margins.bottom);
    setLen("margin-left", doc.margins.left);
    $("margin-guides").checked = !!doc.showMarginGuides;
    setLen("gutter-size", doc.gutter.size || 0);
    $("gutter-mode").value = doc.gutter.mode || "alternate";
    $("page-cols").value = doc.columns || 1;
    setLen("page-col-gap", doc.columnGap ?? 5);
    $("page-bg").value = doc.pageBg || "#FFFFFF";
    setLen("page-bleed", doc.bleed || 0);
    $("page-cropmarks").checked = !!doc.cropMarks;
    for (const k of ["header", "footer"]) {
      const c = doc[k];
      $(k + "-enabled").checked = !!c.enabled;
      $(k + "-text").value = c.text || "";
      $(k + "-first").checked = !!c.showOnFirst;
      $(k + "-align").value = c.align || "center";
      $(k + "-size").value = c.size || 9;
      $(k + "-color").value = isHex(c.color) ? c.color : "#766B58";
      $(k + "-rule").checked = !!c.rule;
    }
    const pn = doc.pageNumber;
    $("pagenum-enabled").checked = !!pn.enabled;
    $("pagenum-position").value = pn.position;
    $("pagenum-format").value = pn.format;
    $("pagenum-style").value = pn.style || "native";
    $("pagenum-start").value = pn.startAt;
    $("pagenum-size").value = pn.size || 9;
    setLen("pagenum-offset", pn.offset ?? 8);
    const hf = $("hf-font");
    hf.textContent = "";
    Array.from(fontFamilySel.options).forEach((o) => hf.appendChild(new Option(o.textContent, o.value)));
    hf.value = doc.hfFont || DEFAULT_FONT;
  }

  function openSetup() {
    fillSetupForm();
    setupOverlay.hidden = false;
  }

  const closeSetup = () => { setupOverlay.hidden = true; };

  $("page-setup").addEventListener("click", openSetup);
  $("setup-close").addEventListener("click", closeSetup);
  setupOverlay.addEventListener("mousedown", (e) => { if (e.target === setupOverlay) closeSetup(); });

  /** Change something on `doc`, then save and redraw. */
  function changeDoc(mutator, debounce) {
    mutator();
    if (debounce) scheduleSave();
    else commit();
    renderAll();
  }

  /** Keep every object reachable after the page shrinks. */
  function keepBoxesOnPage() {
    const b = pageBounds();
    for (const page of doc.pages) {
      for (const box of page.boxes) {
        box.w = Math.min(box.w, b.x1 - b.x0);
        box.h = Math.min(box.h, b.y1 - b.y0);
        box.x = clamp(box.x, b.x0, b.x1 - box.w);
        box.y = clamp(box.y, b.y0, b.y1 - box.h);
      }
    }
    for (const g of doc.guides) {
      const lim = g.orientation === "h" ? doc.pageH : doc.pageW;
      g.posMM = clamp(g.posMM, 0.5, lim - 0.5);
    }
  }

  function setPageSize(w, h) {
    changeDoc(() => {
      doc.pageW = clamp(w, 50, 1000);
      doc.pageH = clamp(h, 50, 1000);
      keepBoxesOnPage();
    });
    fillSetupForm();
    if (zoomMode) fitZoom(zoomMode);
  }

  $("page-size-preset").addEventListener("change", (e) => {
    const v = e.target.value;
    if (v === "custom") return;
    const [pw, ph] = PAGE_PRESETS[v];
    const land = doc.pageW > doc.pageH;
    setPageSize(land ? ph : pw, land ? pw : ph);
  });

  function setOrientation(landscape) {
    if ((doc.pageW > doc.pageH) === landscape) return;
    // Swap side margins with top/bottom so the layout turns with the paper.
    const m = doc.margins;
    doc.margins = landscape
      ? { top: m.left, right: m.top, bottom: m.right, left: m.bottom }
      : { top: m.right, right: m.bottom, bottom: m.left, left: m.top };
    setPageSize(doc.pageH, doc.pageW);
  }
  $("orient-portrait").addEventListener("click", () => setOrientation(false));
  $("orient-landscape").addEventListener("click", () => setOrientation(true));

  function onPageDimsChanged() {
    setPageSize(lenOf("page-w", doc.pageW), lenOf("page-h", doc.pageH));
  }
  $("page-w").addEventListener("change", onPageDimsChanged);
  $("page-h").addEventListener("change", onPageDimsChanged);

  ["margin-top", "margin-right", "margin-bottom", "margin-left"].forEach((id) =>
    $(id).addEventListener("change", () => changeDoc(() => {
      doc.margins = {
        top: clamp(lenOf("margin-top", 0), 0, 200),
        right: clamp(lenOf("margin-right", 0), 0, 200),
        bottom: clamp(lenOf("margin-bottom", 0), 0, 200),
        left: clamp(lenOf("margin-left", 0), 0, 200),
      };
    }))
  );
  $("margin-guides").addEventListener("change", (e) => changeDoc(() => (doc.showMarginGuides = e.target.checked)));
  $("gutter-size").addEventListener("change", (e) => changeDoc(() => (doc.gutter.size = clamp(fromU(e.target.value, 0), 0, 50))));
  $("gutter-mode").addEventListener("change", (e) => changeDoc(() => (doc.gutter.mode = e.target.value || "alternate")));
  $("page-cols").addEventListener("change", (e) => changeDoc(() => (doc.columns = clamp(Math.round(num(e.target.value, 1)), 1, 8))));
  $("page-col-gap").addEventListener("change", (e) => changeDoc(() => (doc.columnGap = clamp(fromU(e.target.value, 5), 0, 50))));
  $("page-bg").addEventListener("input", (e) => changeDoc(() => (doc.pageBg = e.target.value), true));
  $("page-bleed").addEventListener("change", (e) => changeDoc(() => (doc.bleed = clamp(fromU(e.target.value, 0), 0, 20))));
  $("page-cropmarks").addEventListener("change", (e) => changeDoc(() => (doc.cropMarks = e.target.checked)));

  for (const k of ["header", "footer"]) {
    $(k + "-enabled").addEventListener("change", (e) => changeDoc(() => (doc[k].enabled = e.target.checked)));
    $(k + "-text").addEventListener("input", (e) => changeDoc(() => {
      doc[k].text = e.target.value;
      if (e.target.value && !doc[k].enabled) { doc[k].enabled = true; $(k + "-enabled").checked = true; }
    }, true));
    $(k + "-first").addEventListener("change", (e) => changeDoc(() => (doc[k].showOnFirst = e.target.checked)));
    $(k + "-align").addEventListener("change", (e) => changeDoc(() => (doc[k].align = e.target.value)));
    $(k + "-size").addEventListener("change", (e) => changeDoc(() => (doc[k].size = clamp(num(e.target.value, 9), 5, 48))));
    $(k + "-color").addEventListener("input", (e) => changeDoc(() => (doc[k].color = e.target.value), true));
    $(k + "-rule").addEventListener("change", (e) => changeDoc(() => (doc[k].rule = e.target.checked)));
  }
  $("hf-font").addEventListener("change", (e) => changeDoc(() => (doc.hfFont = e.target.value)));
  $("pagenum-enabled").addEventListener("change", (e) => changeDoc(() => (doc.pageNumber.enabled = e.target.checked)));
  $("pagenum-position").addEventListener("change", (e) => changeDoc(() => (doc.pageNumber.position = e.target.value)));
  $("pagenum-format").addEventListener("change", (e) => changeDoc(() => (doc.pageNumber.format = e.target.value)));
  $("pagenum-style").addEventListener("change", (e) => changeDoc(() => (doc.pageNumber.style = e.target.value)));
  $("pagenum-start").addEventListener("change", (e) => changeDoc(() => (doc.pageNumber.startAt = Math.max(1, Math.round(num(e.target.value, 1))))));
  $("pagenum-size").addEventListener("change", (e) => changeDoc(() => (doc.pageNumber.size = clamp(num(e.target.value, 9), 5, 48))));
  $("pagenum-offset").addEventListener("change", (e) => changeDoc(() => (doc.pageNumber.offset = clamp(fromU(e.target.value, 8), 0, 100))));

  // ── Table modal ──────────────────────────────────────────────────────

  let pendingTableInsert = null;

  function closeTableModal() {
    tableOverlay.hidden = true;
    pendingTableInsert = null;
    setTool(null);
  }

  $("table-close").addEventListener("click", closeTableModal);
  $("table-cancel").addEventListener("click", closeTableModal);
  tableOverlay.addEventListener("mousedown", (e) => { if (e.target === tableOverlay) closeTableModal(); });

  $("table-insert").addEventListener("click", () => {
    if (!pendingTableInsert) return;
    const { page, xMm, yMm } = pendingTableInsert;
    const rows = clamp(Number($("table-rows").value) || 3, 1, 100);
    const cols = clamp(Number($("table-cols").value) || 3, 1, 20);
    const w = Math.min(120, doc.pageW);
    const h = Math.min(8 + rows * 8, doc.pageH);
    const box = newBox("table", clamp(xMm - w / 2, 0, doc.pageW - w), clamp(yMm - h / 2, 0, doc.pageH - h), w, h, rows, cols);
    box.fontFamily = fontFamilySel.value || DEFAULT_FONT;
    box.fontSize = clamp(num(fontSizeInput.value, 12), 4, 400);
    page.boxes.push(box);
    setSel([box.id]);
    closeTableModal();
    renderAll();
    fitTableToContent(box);
    renderRail();
    commit();
  });

  // ── Formatting controls (box level) ──────────────────────────────────

  /**
   * Change the type settings of the selected text boxes (and tables, for font
   * family/size). A story flowing through several frames changes in all of them.
   */
  function applyToSelected(mutator, opts) {
    const allowTable = opts && opts.table;
    const targets = new Set();
    for (const b of selectedBoxes()) {
      if (b.type === "text") threadChain(threadHead(b)).forEach((x) => targets.add(x));
      else if (allowTable && b.type === "table") targets.add(b);
    }
    if (!targets.size) return;
    let relayout = false;
    for (const box of targets) {
      mutator(box);
      if (box.type === "text") {
        const el = boxEl(box.id);
        if (el) styleTextBox(el, box);
        if (isThreaded(box) || box.wrap !== "none") relayout = true;
      } else {
        rerenderBox(box);
      }
    }
    if (relayout) refreshLayout();
    renderRail();
    renderToolbarState();
    if (opts && opts.debounce) scheduleSave();
    else commit();
  }

  /** Apply to the active table cell (alignment etc.). */
  function applyToCell(mutator) {
    const box = selectedBox();
    const cell = activeCellModel(box);
    if (!cell) { note("Click into a table cell first"); return; }
    mutator(cell);
    rerenderBox(box);
    commit();
    renderToolbarState();
  }

  const isTableSel = () => selectedBox()?.type === "table";

  fontFamilySel.addEventListener("change", () => {
    const v = fontFamilySel.value;
    if (hasTextSelection()) charCommand(exec("fontName", v), false);
    else applyToSelected((b) => (b.fontFamily = v), { table: true });
  });

  function setFontSize(pt) {
    pt = clamp(pt, 4, 400);
    if (hasTextSelection()) fontSizeOnSelection(pt);
    else applyToSelected((b) => (b.fontSize = pt), { table: true });
    setVal("font-size", pt);
  }
  fontSizeInput.addEventListener("change", () => setFontSize(num(fontSizeInput.value, 14)));

  const SIZE_STEPS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48, 60, 72, 96, 120, 144];
  function stepFontSize(dir) {
    const cur = num(fontSizeInput.value, 14);
    const next = dir > 0 ? SIZE_STEPS.find((s) => s > cur + 0.01) || cur + 12 : [...SIZE_STEPS].reverse().find((s) => s < cur - 0.01) || Math.max(4, cur - 1);
    setFontSize(next);
  }
  $("size-up").addEventListener("click", () => stepFontSize(1));
  $("size-down").addEventListener("click", () => stepFontSize(-1));

  textColorInput.addEventListener("input", () => {
    const v = textColorInput.value;
    if (hasTextSelection() || isTableSel()) {
      // Live preview without an undo step per pixel of the colour picker.
      let s = liveSelection();
      if (!s || s.range.collapsed) {
        const host = currentEditableHost();
        if (!host) return;
        selectAllIn(host);
        s = savedSel;
      }
      restoreSelection(s);
      document.execCommand("styleWithCSS", false, true);
      document.execCommand("foreColor", false, v);
      const sel = window.getSelection();
      if (sel.rangeCount) savedSel = { host: s.host, range: sel.getRangeAt(0).cloneRange() };
    } else {
      applyToSelected((b) => (b.color = v), { debounce: true });
    }
  });

  function toggleChar(prop, cmd) {
    const box = selectedBox();
    if (!box) return;
    if (!isMulti() && (hasTextSelection() || box.type === "table")) charCommand(exec(cmd), true);
    else {
      const v = !box[prop];
      applyToSelected((b) => (b[prop] = v));
    }
    requestAnimationFrame(updateCharState);
  }
  $("style-bold").addEventListener("click", () => toggleChar("bold", "bold"));
  $("style-italic").addEventListener("click", () => toggleChar("italic", "italic"));
  $("style-underline").addEventListener("click", () => toggleChar("underline", "underline"));
  $("style-strike").addEventListener("click", () => toggleChar("strike", "strikeThrough"));
  $("style-sup").addEventListener("click", () => {
    if (!charCommand(exec("superscript"), false)) note("Highlight the text to raise first");
  });
  $("style-sub").addEventListener("click", () => {
    if (!charCommand(exec("subscript"), false)) note("Highlight the text to lower first");
  });

  $("text-highlight").addEventListener("change", (e) => charCommand(exec("hiliteColor", e.target.value), true));
  $("highlight-none").addEventListener("click", () => charCommand(exec("hiliteColor", "transparent"), true));

  /** Remove inline formatting tags/styles from rich text, keeping paragraphs and lists. */
  function stripInline(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    tpl.content.querySelectorAll("b,strong,i,em,u,s,strike,sup,sub,font,span,mark").forEach((n) => n.replaceWith(...n.childNodes));
    tpl.content.querySelectorAll("[style]").forEach((n) => n.removeAttribute("style"));
    return tpl.innerHTML;
  }

  $("clear-format").addEventListener("click", () => {
    const box = selectedBox();
    if (!box) return;
    if (hasTextSelection()) {
      charCommand((host) => {
        document.execCommand("removeFormat");
        document.execCommand("hiliteColor", false, "transparent");
      }, false);
      return;
    }
    if (box.type === "text") {
      box.text = stripInline(box.text);
      rerenderBox(box);
    } else if (box.type === "table") {
      box.cells.forEach((c) => (c.text = stripInline(c.text)));
      rerenderBox(box);
    }
    commit();
    note("Formatting cleared");
  });

  $("text-case").addEventListener("change", (e) => applyToSelected((b) => (b.textCase = e.target.value)));

  const PARA_RE = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/;

  /** Characters of text from the start of `host` to a point (for keeping the caret). */
  function textOffset(host, node, off) {
    const r = document.createRange();
    r.setStart(host, 0);
    try { r.setEnd(node, off); } catch (e) { return 0; }
    return r.toString().length;
  }
  function pointAt(host, k) {
    const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let n, last = null;
    while ((n = w.nextNode())) {
      if (k <= n.length) return [n, k];
      k -= n.length;
      last = n;
    }
    return last ? [last, last.length] : [host, host.childNodes.length];
  }

  /**
   * Align whole paragraphs: the one with the caret, or every paragraph the
   * highlight touches. Loose text (typed before the first Enter) becomes a
   * paragraph first. Line breaks (Shift+Enter) stay inside their paragraph.
   */
  function alignParagraphs(host, align) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const r0 = sel.getRangeAt(0);
    const k0 = textOffset(host, r0.startContainer, r0.startOffset);
    const k1 = textOffset(host, r0.endContainer, r0.endOffset);
    // Every run of loose inline content between blocks → one <p>.
    for (let n = host.firstChild; n; ) {
      if (isBlock(n)) { n = n.nextSibling; continue; }
      const p = document.createElement("p");
      host.insertBefore(p, n);
      while (p.nextSibling && !isBlock(p.nextSibling)) p.appendChild(p.nextSibling);
      n = p.nextSibling;
      if (!p.textContent && !p.querySelector("br,img,span")) p.remove();
    }
    const [sc, so] = pointAt(host, k0), [ec, eo] = pointAt(host, k1);
    const r = document.createRange();
    r.setStart(sc, so);
    r.setEnd(ec, eo);
    sel.removeAllRanges();
    sel.addRange(r);
    // Innermost paragraphs the caret/highlight is in.
    const leaf = (el) => PARA_RE.test(el.nodeName) && !Array.from(el.children).some((c) => PARA_RE.test(c.nodeName));
    const paras = Array.from(host.querySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6,blockquote")).filter(leaf)
      .filter((el) => r.intersectsNode(el));
    if (!paras.length) {
      let n = sc.nodeType === 1 ? sc : sc.parentNode;
      while (n && n !== host && !PARA_RE.test(n.nodeName)) n = n.parentNode;
      if (n && n !== host) paras.push(n);
    }
    for (const el of paras) el.style.textAlign = align;
    host.dispatchEvent(new Event("input", { bubbles: true }));
  }
  ["left", "center", "right", "justify"].forEach((a) =>
    $("align-" + a).addEventListener("click", () => {
      if (isTableSel()) return applyToCell((c) => (c.align = a));
      // Cursor in the text: align just the paragraph(s) it touches.
      const s = liveSelection();
      if (s && document.activeElement === s.host && s.host.classList.contains("box-text")) {
        restoreSelection(s);
        alignParagraphs(s.host, a);
        const sel = window.getSelection();
        if (sel.rangeCount) savedSel = { host: s.host, range: sel.getRangeAt(0).cloneRange() };
        syncHost(s.host);
        commit();
        requestAnimationFrame(updateCharState);
        return;
      }
      applyToSelected((b) => {
        b.align = a;
        // Box-wide alignment replaces paragraph-level alignment.
        if (b.type === "text" && !prevOf(b.id)) {
          const tpl = document.createElement("template");
          tpl.innerHTML = b.text || "";
          tpl.content.querySelectorAll("[style]").forEach((n) => { n.style.textAlign = ""; if (!n.getAttribute("style")) n.removeAttribute("style"); });
          b.text = tpl.innerHTML;
        }
      });
      refreshTextContent();
    })
  );

  /** After a box-level change to stored text: redraw the text of the selected boxes. */
  function refreshTextContent() {
    const heads = new Set();
    for (const b of selectedBoxes()) if (b.type === "text") heads.add(threadHead(b));
    for (const h of heads) {
      if (h.next) reflowLive(h);
      else {
        const t = boxEl(h.id)?.querySelector(".box-text");
        if (t && t.innerHTML !== h.text) t.innerHTML = h.text || "";
        const el = boxEl(h.id);
        if (el) updateOverset(el, h);
      }
    }
  }

  function toggleList(ordered) {
    let s = liveSelection();
    if (!s) {
      const host = currentEditableHost();
      if (!host) { note("Click into the text first"); return; }
      selectAllIn(host);
      s = savedSel;
    }
    restoreSelection(s);
    document.execCommand(ordered ? "insertOrderedList" : "insertUnorderedList");
    syncHost(s.host);
    commit();
  }
  $("list-bullet").addEventListener("click", () => toggleList(false));
  $("list-number").addEventListener("click", () => toggleList(true));
  $("list-style").addEventListener("change", (e) => applyToSelected((b) => (b.olStyle = e.target.value)));
  $("bullet-style").addEventListener("change", (e) => applyToSelected((b) => (b.ulStyle = e.target.value)));

  function bindNum(id, prop, lo, hi, fallback, isLen) {
    $(id).addEventListener("change", (e) =>
      applyToSelected((b) => (b[prop] = clamp(isLen ? fromU(e.target.value, fallback) : num(e.target.value, fallback), lo, hi))));
  }
  bindNum("line-height", "lineHeight", 0.5, 5, 1.2);
  bindNum("letter-spacing", "letterSpacing", -10, 50, 0);
  bindNum("word-spacing", "wordSpacing", -10, 50, 0);
  bindNum("space-before", "spaceBefore", 0, 50, 0, true);
  bindNum("space-after", "spaceAfter", 0, 50, 0, true);
  bindNum("indent-first", "indentFirst", -50, 100, 0, true);
  bindNum("indent-left", "indentLeft", 0, 200, 0, true);
  bindNum("indent-right", "indentRight", 0, 200, 0, true);
  $("drop-cap").addEventListener("change", (e) => {
    const v = +e.target.value || 0;
    applyToSelected((b) => {
      b.dropCap = v;
      if (!prevOf(b.id)) b.text = withDropCap(b.text, v > 1);
    });
    refreshTextContent();
    commit();
  });
  $("hyphenate").addEventListener("change", (e) => applyToSelected((b) => (b.hyphenate = e.target.checked)));

  /** Typing can grow or eat the drop-cap letter; put it back round the first akshara. */
  function fixDropCapAfterEdit(box, t) {
    const head = threadHead(box);
    if (!(head.dropCap > 1) || head !== box) return;
    const fixed = withDropCap(head.text, true);
    if (fixed === head.text) return;
    head.text = fixed;
    if (head.next) reflowLive(head);
    else t.innerHTML = fixed;
    scheduleSave();
  }

  // ── Paragraph styles ─────────────────────────────────────────────────

  function pickStyleProps(box) {
    const out = {};
    for (const k of STYLE_PROPS) out[k] = box[k];
    return out;
  }

  function applyStyleToBox(box, st) {
    for (const k of STYLE_PROPS) if (k in st.props) box[k] = st.props[k];
    box.styleId = st.id;
  }

  function renderStyleSelect(box) {
    const sel = $("para-style");
    sel.textContent = "";
    sel.appendChild(new Option("— No style —", ""));
    for (const st of doc.styles) sel.appendChild(new Option(st.name, st.id));
    const st = box && doc.styles.find((s) => s.id === box.styleId);
    sel.value = st ? st.id : "";
    if (st) {
      const changed = STYLE_PROPS.some((k) => k in st.props && st.props[k] !== box[k]);
      if (changed) sel.options[sel.selectedIndex].textContent = st.name + " (changed)";
    }
    $("style-update").disabled = !st;
    $("style-delete").disabled = !st;
  }

  $("para-style").addEventListener("change", (e) => {
    const st = doc.styles.find((s) => s.id === e.target.value);
    if (st) applyToSelected((b) => applyStyleToBox(b, st));
    else applyToSelected((b) => delete b.styleId);
  });

  $("style-new").addEventListener("click", () => {
    const box = selectedBox();
    if (!box || box.type !== "text") return;
    const name = (prompt("Name for the new paragraph style:", "") || "").trim();
    if (!name) return;
    const st = { id: uid("st-"), name, props: pickStyleProps(box) };
    doc.styles.push(st);
    box.styleId = st.id;
    commit();
    renderToolbarState();
    note(`Style “${name}” saved`);
  });

  $("style-update").addEventListener("click", () => {
    const box = selectedBox();
    const st = box && doc.styles.find((s) => s.id === box.styleId);
    if (!st) return;
    st.props = pickStyleProps(box);
    let n = 0;
    for (const page of doc.pages) for (const b of page.boxes) if (b.styleId === st.id) { applyStyleToBox(b, st); n++; }
    commit();
    renderAll();
    note(`“${st.name}” updated in ${n} box${n === 1 ? "" : "es"}`);
  });

  $("style-delete").addEventListener("click", () => {
    const box = selectedBox();
    const st = box && doc.styles.find((s) => s.id === box.styleId);
    if (!st || !confirm(`Delete the style “${st.name}”? Boxes keep their current look.`)) return;
    doc.styles = doc.styles.filter((s) => s !== st);
    for (const page of doc.pages) for (const b of page.boxes) if (b.styleId === st.id) delete b.styleId;
    commit();
    renderToolbarState();
  });

  // ── Frame tab ────────────────────────────────────────────────────────

  /** Change the selected box of the given types; `live` = colour-picker drag (no undo step). */
  function applyFrame(types, mutator, live) {
    const box = selectedBox();
    if (!box || !types.includes(box.type)) return;
    mutator(box);
    const el = boxEl(box.id);
    if (box.type === "text" && el) styleTextBox(el, box);
    else if (box.type === "shape" && el) refreshShape(el, box);
    else rerenderBox(box);
    if (live) { scheduleSave(); liveWrap(); }
    else { refreshLayout(); commit(); renderToolbarState(); }
  }

  $("frame-cols").addEventListener("change", (e) => applyFrame(["text"], (b) => (b.columns = clamp(Math.round(num(e.target.value, 1)), 1, 6))));
  $("frame-gap").addEventListener("change", (e) => applyFrame(["text"], (b) => (b.columnGap = clamp(fromU(e.target.value, 5), 0, 50))));
  $("frame-inset").addEventListener("change", (e) => applyFrame(["text"], (b) => (b.inset = e.target.value === "" ? null : clamp(fromU(e.target.value, 2), 0, 50))));
  ["top", "middle", "bottom"].forEach((v) => $("valign-" + v).addEventListener("click", () => applyFrame(["text"], (b) => (b.valign = v))));

  $("frame-fit").addEventListener("click", () => {
    const box = selectedBox();
    const el = box && box.type === "text" && boxEl(box.id);
    if (!el) return;
    if (box.next) { note("This frame's text continues in the next frame — fit the last frame instead"); return; }
    const frame = el.querySelector(".text-frame"), t = el.querySelector(".box-text");
    const cs = getComputedStyle(frame);
    const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    let contentPx;
    if ((box.columns || 1) > 1) {
      // Grow until nothing spills into extra columns.
      let lo = 5, hi = pageBounds().y1 - box.y;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        el.style.height = mid + "mm";
        if (t.scrollWidth > t.clientWidth + 1) lo = mid; else hi = mid;
      }
      box.h = hi;
    } else {
      contentPx = t.scrollHeight;
      const maxH = pageBounds().y1 - box.y;
      box.h = clamp((contentPx + chrome) / PX_PER_MM + 0.3, 5, maxH);
      positionBox(el, box);
      // Text re-wraps slightly at the new size; grow in small steps until it fits.
      for (let i = 0; i < 40 && box.h < maxH; i++) {
        updateOverset(el, box);
        if (!el.classList.contains("overset")) break;
        box.h = Math.min(maxH, box.h + 0.5);
        positionBox(el, box);
      }
      if (box.h >= maxH - 0.01) note("The text is longer than the page allows — continue it in another box");
    }
    positionBox(el, box);
    updateOverset(el, box);
    renderRail();
    renderToolbarState();
    commit();
  });

  $("frame-fill-on").addEventListener("change", (e) => applyFrame(["text", "image"], (b) => (b.frameFill = e.target.checked ? $("frame-fill").value : null)));
  $("frame-fill").addEventListener("input", (e) => {
    $("frame-fill-on").checked = true;
    applyFrame(["text", "image"], (b) => (b.frameFill = e.target.value), true);
  });
  $("frame-border-w").addEventListener("change", (e) => applyFrame(["text", "image"], (b) => (b.frameBorderWidth = clamp(num(e.target.value, 0), 0, 20))));
  $("frame-border-c").addEventListener("input", (e) => applyFrame(["text", "image"], (b) => {
    b.frameBorderColor = e.target.value;
    if (!(b.frameBorderWidth > 0)) b.frameBorderWidth = 0.5;
  }, true));

  $("image-fit").addEventListener("change", (e) => applyFrame(["image"], (b) => (b.imgFit = e.target.value)));
  $("image-replace").addEventListener("click", () => { const b = selectedBox(); if (b && b.type === "image") pickImageFor(b.id); });

  $("shape-type").addEventListener("change", (e) => applyFrame(["shape"], (b) => {
    b.shapeType = e.target.value;
    if (b.shapeType === "line" && !b.lineDir) b.lineDir = "up";
  }));
  $("shape-points").addEventListener("change", (e) => applyFrame(["shape"], (b) => (b.starPoints = clamp(Math.round(num(e.target.value, 5)), 3, 24))));
  $("shape-radius").addEventListener("change", (e) => applyFrame(["shape"], (b) => (b.radius = clamp(fromU(e.target.value, 0), 0, 100))));
  $("line-dir").addEventListener("change", (e) => applyFrame(["shape"], (b) => (b.lineDir = e.target.value)));
  $("line-ends").addEventListener("change", (e) => applyFrame(["shape"], (b) => (b.lineEnds = e.target.value)));
  $("shape-fill-on").addEventListener("change", (e) => applyFrame(["shape"], (b) => (b.fillColor = e.target.checked ? $("shape-fill-color").value : "none")));
  $("shape-fill-color").addEventListener("input", (e) => {
    $("shape-fill-on").checked = true;
    applyFrame(["shape"], (b) => (b.fillColor = e.target.value), true);
  });
  $("shape-fill-color").addEventListener("change", () => commit());
  $("shape-stroke-color").addEventListener("input", (e) => applyFrame(["shape"], (b) => (b.strokeColor = e.target.value), true));
  $("shape-stroke-color").addEventListener("change", () => commit());
  $("shape-stroke-width").addEventListener("change", (e) => applyFrame(["shape"], (b) => (b.strokeWidth = clamp(num(e.target.value, 1), 0, 40))));
  $("shape-dash").addEventListener("change", (e) => applyFrame(["shape"], (b) => { b.dash = e.target.value; b.strokeDasharray = "none"; }));
  ["frame-fill", "frame-border-c"].forEach((id) => $(id).addEventListener("change", () => commit()));

  // Text wrap
  ["none", "box", "contour", "jump"].forEach((w) => $("wrap-" + w).addEventListener("click", () => {
    const boxes = selectedBoxes();
    if (!boxes.length) return;
    boxes.forEach((b) => (b.wrap = w === "contour" && b.type !== "shape" ? "box" : w));
    refreshLayout();
    renderToolbarState();
    commit();
  }));
  $("wrap-offset").addEventListener("change", (e) => {
    selectedBoxes().forEach((b) => (b.wrapOffset = clamp(fromU(e.target.value, 3), 0, 50)));
    refreshLayout();
    commit();
  });
  $("wrap-ignore").addEventListener("change", (e) => applyFrame(["text"], (b) => (b.ignoreWrap = e.target.checked)));

  // Text flow between frames
  function cancelLinkMode() {
    linkMode = null;
    renderToolbarState();
  }

  function linkFrames(from, to) {
    const head = threadHead(from);
    if (to.text && plainText(to.text).trim()) {
      // The target's own text joins the end of the story.
      head.text = (head.text || "") + to.text;
    }
    to.text = "";
    from.next = to.id;
    normalizeThreads(doc);
  }

  function finishThreadLink(target) {
    const from = findBox(linkMode && linkMode.fromId);
    linkMode = null;
    if (!from) return renderToolbarState();
    if (target.type !== "text" || target === from) { note("Pick a different text frame"); return renderToolbarState(); }
    if (isThreaded(target)) { note("That frame is already part of a text flow — pick an unlinked frame"); return renderToolbarState(); }
    linkFrames(from, target);
    setSel([from.id]);
    commit();
    renderAll();
    note("Text now flows into that frame");
  }

  $("thread-link").addEventListener("click", () => {
    const box = selectedBox();
    if (!box || box.type !== "text" || box.next) return;
    linkMode = { fromId: box.id };
    renderToolbarState();
    note("Click an empty text frame — switch pages in the left rail if needed. Esc cancels.");
  });

  $("thread-newpage").addEventListener("click", () => {
    const box = selectedBox();
    if (!box || box.type !== "text" || box.next) return;
    const pi = pageIndexOf(box.id);
    if (pi === doc.pages.length - 1) doc.pages.push(newPage());
    const target = newBox("text", box.x, box.y, box.w, box.h);
    for (const k of STYLE_PROPS.concat(["olStyle", "ulStyle", "hyphenate", "columns", "columnGap", "inset", "valign", "frameFill", "frameBorderWidth", "frameBorderColor", "styleId"])) {
      if (k in box) target[k] = box[k];
    }
    doc.pages[pi + 1].boxes.push(target);
    linkFrames(box, target);
    commit();
    renderAll();
    note(`Text continues on page ${pi + 2}`);
  });

  $("thread-unlink").addEventListener("click", () => {
    const box = selectedBox();
    if (!box || !box.next) return;
    const rest = findBox(box.next);
    box.next = null;
    if (rest) rest.text = "";
    normalizeThreads(doc);
    commit();
    renderAll();
    note("Flow stopped — the rest of the text is held in this frame (overset)");
  });

  // ── Table editing ────────────────────────────────────────────────────

  function tableCtx() {
    const box = selectedBox();
    if (!box || box.type !== "table") return null;
    ensureTableSizes(box);
    const ac = activeCell && activeCell.boxId === box.id ? activeCell : { row: 0, col: 0 };
    return { box, row: clamp(ac.row, 0, box.rows - 1), col: clamp(ac.col, 0, box.cols - 1) };
  }

  function finishTableEdit(box, row, col) {
    activeCell = { boxId: box.id, row, col };
    rerenderBox(box);
    fitTableToContent(box);
    renderRail();
    renderToolbarState();
    commit();
    const td = cellElement(box, row, col);
    if (td) focusEnd(td);
  }

  function insertRow(after) {
    const t = tableCtx();
    if (!t) return;
    const { box } = t;
    const at = after ? t.row + 1 : t.row;
    const mm = box.rowHeights.map((f) => f * box.h);
    const newMm = mm.reduce((a, b) => a + b, 0) / mm.length;
    box.cells.forEach((c) => { if (c.row >= at) c.row++; });
    for (let c = 0; c < box.cols; c++) {
      const cell = newCell(at, c);
      const ref = box.cells.find((x) => x.col === c && x.row === (at > 0 ? at - 1 : 1));
      if (ref && !(ref.row === 0 && at > 0)) { cell.bgColor = ref.bgColor; cell.textColor = ref.textColor; cell.bold = ref.bold; }
      if (ref) { cell.align = ref.align; cell.valign = ref.valign; }
      box.cells.push(cell);
    }
    box.rows++;
    mm.splice(at, 0, newMm);
    box.h = mm.reduce((a, b) => a + b, 0);
    box.rowHeights = mm.map((m) => m / box.h);
    finishTableEdit(box, at, t.col);
  }

  function deleteRow() {
    const t = tableCtx();
    if (!t) return;
    const { box, row } = t;
    if (box.rows <= 1) { note("A table needs at least one row"); return; }
    const mm = box.rowHeights.map((f) => f * box.h);
    box.cells = box.cells.filter((c) => c.row !== row);
    box.cells.forEach((c) => { if (c.row > row) c.row--; });
    box.rows--;
    mm.splice(row, 1);
    box.h = Math.max(5, mm.reduce((a, b) => a + b, 0));
    box.rowHeights = mm.map((m) => m / mm.reduce((a, b) => a + b, 0));
    finishTableEdit(box, Math.min(row, box.rows - 1), t.col);
  }

  function insertCol(after) {
    const t = tableCtx();
    if (!t) return;
    const { box } = t;
    const at = after ? t.col + 1 : t.col;
    const fr = box.colWidths.slice();
    fr.splice(at, 0, 1 / box.cols);
    const sum = fr.reduce((a, b) => a + b, 0);
    box.colWidths = fr.map((f) => f / sum);
    box.cells.forEach((c) => { if (c.col >= at) c.col++; });
    for (let r = 0; r < box.rows; r++) {
      const cell = newCell(r, at);
      const ref = box.cells.find((x) => x.row === r && x.col === (at > 0 ? at - 1 : 1));
      if (ref) { cell.bgColor = ref.bgColor; cell.textColor = ref.textColor; cell.bold = ref.bold; cell.align = ref.align; cell.valign = ref.valign; }
      box.cells.push(cell);
    }
    box.cols++;
    finishTableEdit(box, t.row, at);
  }

  function deleteCol() {
    const t = tableCtx();
    if (!t) return;
    const { box, col } = t;
    if (box.cols <= 1) { note("A table needs at least one column"); return; }
    box.cells = box.cells.filter((c) => c.col !== col);
    box.cells.forEach((c) => { if (c.col > col) c.col--; });
    const fr = box.colWidths.slice();
    fr.splice(col, 1);
    const sum = fr.reduce((a, b) => a + b, 0);
    box.colWidths = fr.map((f) => f / sum);
    box.cols--;
    finishTableEdit(box, t.row, Math.min(col, box.cols - 1));
  }

  $("tbl-row-above").addEventListener("click", () => insertRow(false));
  $("tbl-row-below").addEventListener("click", () => insertRow(true));
  $("tbl-col-left").addEventListener("click", () => insertCol(false));
  $("tbl-col-right").addEventListener("click", () => insertCol(true));
  $("tbl-row-del").addEventListener("click", deleteRow);
  $("tbl-col-del").addEventListener("click", deleteCol);

  function scopedCells(t) {
    const scope = $("tbl-scope").value;
    return t.box.cells.filter((c) =>
      scope === "table" ||
      (scope === "row" && c.row === t.row) ||
      (scope === "col" && c.col === t.col) ||
      (scope === "cell" && c.row === t.row && c.col === t.col));
  }

  function cellsChange(mutator, live) {
    const t = tableCtx();
    if (!t) return;
    scopedCells(t).forEach(mutator);
    const el = boxEl(t.box.id);
    if (el) {
      // Update cells in place so the colour picker stays smooth.
      const table = el.querySelector("table.box-table");
      t.box.cells.forEach((c) => {
        const td = table.rows[c.row]?.cells[c.col];
        if (!td) return;
        td.style.backgroundColor = c.bgColor;
        td.style.color = c.textColor;
        td.style.verticalAlign = c.valign || "top";
      });
    }
    if (live) scheduleSave(); else commit();
  }
  $("tbl-cell-fill").addEventListener("input", (e) => cellsChange((c) => (c.bgColor = e.target.value), true));
  $("tbl-cell-text").addEventListener("input", (e) => cellsChange((c) => (c.textColor = e.target.value), true));
  ["tbl-cell-fill", "tbl-cell-text"].forEach((id) => $(id).addEventListener("change", () => commit()));
  $("tbl-valign").addEventListener("change", (e) => cellsChange((c) => (c.valign = e.target.value)));
  $("tbl-border-w").addEventListener("change", (e) => applyFrame(["table"], (b) => (b.borderWidth = clamp(num(e.target.value, 1), 0, 10))));
  $("tbl-border-c").addEventListener("input", (e) => applyFrame(["table"], (b) => (b.borderColor = e.target.value), true));
  $("tbl-border-c").addEventListener("change", () => commit());
  $("tbl-pad").addEventListener("change", (e) => applyFrame(["table"], (b) => (b.cellPadding = clamp(num(e.target.value, 4), 0, 30))));

  // ── Arrange tab ──────────────────────────────────────────────────────

  function applyGeom(mutator, debounce) {
    const box = selectedBox();
    if (!box) return;
    mutator(box);
    const b = pageBounds();
    box.w = clamp(box.w, 5, b.x1 - b.x0);
    box.h = clamp(box.h, 5, b.y1 - b.y0);
    box.x = clamp(box.x, b.x0, b.x1 - box.w);
    box.y = clamp(box.y, b.y0, b.y1 - box.h);
    const el = boxEl(box.id);
    if (el) { positionBox(el, box); redrawGeometry(el, box); }
    afterMove(debounce);
  }

  function afterMove(debounce) {
    if (debounce) liveWrap(); else refreshLayout();
    updateMultiOverlay();
    renderRail();
    renderToolbarState();
    if (debounce) scheduleSave(); else commit();
  }

  /** Move every selected object by dx, dy (mm), keeping them on the page. */
  function moveSelection(dx, dy, debounce) {
    const boxes = selectedBoxes();
    if (!boxes.length) return;
    if (boxes.some((b) => b.locked)) { note("Locked — unlock it in Arrange to move"); return; }
    const bb = bounds(boxes), B = pageBounds();
    dx = clamp(dx, B.x0 - bb.x0, B.x1 - bb.x1);
    dy = clamp(dy, B.y0 - bb.y0, B.y1 - bb.y1);
    boxes.forEach((b) => {
      b.x += dx;
      b.y += dy;
      const el = boxEl(b.id);
      if (el) positionBox(el, b);
    });
    afterMove(debounce);
  }

  $("geo-x").addEventListener("change", (e) => {
    if (isMulti()) moveSelection(fromU(e.target.value, 0) - bounds(selectedBoxes()).x0, 0);
    else applyGeom((b) => (b.x = fromU(e.target.value, b.x)));
  });
  $("geo-y").addEventListener("change", (e) => {
    if (isMulti()) moveSelection(0, fromU(e.target.value, 0) - bounds(selectedBoxes()).y0);
    else applyGeom((b) => (b.y = fromU(e.target.value, b.y)));
  });
  $("geo-w").addEventListener("change", (e) => applyGeom((b) => (b.w = fromU(e.target.value, b.w))));
  $("geo-h").addEventListener("change", (e) => applyGeom((b) => (b.h = fromU(e.target.value, b.h))));
  $("geo-rot").addEventListener("change", (e) => applyGeom((b) => {
    let r = num(e.target.value, 0) % 360;
    if (r > 180) r -= 360;
    if (r < -180) r += 360;
    b.rotation = r;
  }));
  $("geo-opacity").addEventListener("change", (e) => {
    const v = clamp(num(e.target.value, 100), 0, 100) / 100;
    selectedBoxes().forEach((b) => { b.opacity = v; const el = boxEl(b.id); if (el) positionBox(el, b); });
    commit();
  });
  $("geo-lock").addEventListener("change", (e) => {
    const boxes = selectedBoxes();
    if (!boxes.length) return;
    boxes.forEach((b) => { b.locked = e.target.checked; rerenderBox(b); });
    applyPageWraps(pageStage.querySelector(".page"), doc.pages[currentPageIndex]);
    syncSelectionDom();
    commit();
    renderToolbarState();
  });

  function alignObject(how) {
    const boxes = selectedBoxes();
    if (!boxes.length) return;
    if (boxes.some((b) => b.locked)) { note("Some of these are locked"); return; }
    const to = $("align-to").value;
    let L, R, T, Bm;
    if (to === "selection" && boxes.length > 1) {
      const bb = bounds(boxes);
      [L, R, T, Bm] = [bb.x0, bb.x1, bb.y0, bb.y1];
    } else {
      const m = to === "page" ? { top: 0, right: 0, bottom: 0, left: 0 } : getEffectiveMargins(currentPageIndex);
      [L, R, T, Bm] = [m.left, doc.pageW - m.right, m.top, doc.pageH - m.bottom];
    }
    // A group moves as one block.
    const units = new Map();
    boxes.forEach((b) => {
      const k = b.groupId && boxes.filter((x) => x.groupId === b.groupId).length > 1 && to !== "selection" ? b.groupId : b.id;
      if (!units.has(k)) units.set(k, []);
      units.get(k).push(b);
    });
    for (const members of units.values()) {
      const bb = bounds(members);
      let dx = 0, dy = 0;
      if (how === "left") dx = L - bb.x0;
      if (how === "right") dx = R - bb.x1;
      if (how === "hcenter") dx = (L + R) / 2 - (bb.x0 + bb.x1) / 2;
      if (how === "top") dy = T - bb.y0;
      if (how === "bottom") dy = Bm - bb.y1;
      if (how === "vcenter") dy = (T + Bm) / 2 - (bb.y0 + bb.y1) / 2;
      members.forEach((b) => { b.x += dx; b.y += dy; const el = boxEl(b.id); if (el) positionBox(el, b); });
    }
    afterMove(false);
  }
  ["left", "hcenter", "right", "top", "vcenter", "bottom"].forEach((h) =>
    $("obj-align-" + h).addEventListener("click", () => alignObject(h)));

  /** Equal gaps between three or more objects. */
  function distribute(horizontal) {
    const boxes = selectedBoxes();
    if (boxes.length < 3) return;
    if (boxes.some((b) => b.locked)) { note("Some of these are locked"); return; }
    const pos = horizontal ? "x" : "y", size = horizontal ? "w" : "h";
    const sorted = boxes.slice().sort((a, b) => a[pos] - b[pos]);
    const first = sorted[0], last = sorted[sorted.length - 1];
    const span = last[pos] + last[size] - first[pos];
    const used = sorted.reduce((t, b) => t + b[size], 0);
    const gap = (span - used) / (sorted.length - 1);
    if (gap >= 0) {
      let cur = first[pos];
      sorted.forEach((b) => { b[pos] = cur; cur += b[size] + gap; });
    } else {
      // Objects wider than the room between them: space their centres evenly instead.
      const byC = boxes.slice().sort((a, b) => a[pos] + a[size] / 2 - (b[pos] + b[size] / 2));
      const c0 = byC[0][pos] + byC[0][size] / 2, cN = byC[byC.length - 1][pos] + byC[byC.length - 1][size] / 2;
      byC.forEach((b, i) => { b[pos] = c0 + ((cN - c0) * i) / (byC.length - 1) - b[size] / 2; });
    }
    sorted.forEach((b) => { const el = boxEl(b.id); if (el) positionBox(el, b); });
    afterMove(false);
  }
  $("obj-dist-h").addEventListener("click", () => distribute(true));
  $("obj-dist-v").addEventListener("click", () => distribute(false));

  function groupSelection() {
    const boxes = selectedBoxes();
    if (boxes.length < 2) return;
    const page = findPageOfBox(boxes[0].id);
    if (!boxes.every((b) => page.boxes.includes(b))) return;
    const g = uid("g");
    boxes.forEach((b) => (b.groupId = g));
    // Keep the group together in the stacking order, at the topmost member's level.
    const top = Math.max(...boxes.map((b) => page.boxes.indexOf(b)));
    const rest = page.boxes.filter((b) => b.groupId !== g);
    const insertAt = rest.filter((b) => page.boxes.indexOf(b) < top).length;
    rest.splice(insertAt, 0, ...page.boxes.filter((b) => b.groupId === g));
    page.boxes = rest;
    commit();
    renderPages();
    renderToolbarState();
    note(`Grouped ${boxes.length} objects`);
  }
  function ungroupSelection() {
    const boxes = selectedBoxes().filter((b) => b.groupId);
    if (!boxes.length) return;
    boxes.forEach((b) => delete b.groupId);
    commit();
    renderPages();
    renderToolbarState();
    note("Ungrouped");
  }
  $("obj-group").addEventListener("click", groupSelection);
  $("obj-ungroup").addEventListener("click", ungroupSelection);

  /** Stacking for one or many objects, keeping their order among themselves. */
  function restack(how) {
    const page = doc.pages[currentPageIndex];
    const ids = new Set(selectedBoxes().filter((b) => page.boxes.includes(b)).map((b) => b.id));
    if (!ids.size) return;
    const list = page.boxes;
    if (how === "front") page.boxes = list.filter((b) => !ids.has(b.id)).concat(list.filter((b) => ids.has(b.id)));
    else if (how === "back") page.boxes = list.filter((b) => ids.has(b.id)).concat(list.filter((b) => !ids.has(b.id)));
    else if (how === "forward") {
      for (let i = list.length - 2; i >= 0; i--) {
        if (ids.has(list[i].id) && !ids.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
      }
    } else {
      for (let i = 1; i < list.length; i++) {
        if (ids.has(list[i].id) && !ids.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
      }
    }
    renderPages();
    renderRail();
    renderToolbarState();
    commit();
  }
  $("layer-front").addEventListener("click", () => restack("front"));
  $("layer-forward").addEventListener("click", () => restack("forward"));
  $("layer-backward").addEventListener("click", () => restack("backward"));
  $("layer-back").addEventListener("click", () => restack("back"));
  // Hidden boxes stay on screen as faint outlines (and are left out of print),
  // so they can still be selected and shown again.
  function setHidden(v) {
    selectedBoxes().forEach((b) => (b.hidden = v));
    renderPages();
    renderRail();
    renderToolbarState();
    commit();
  }
  $("layer-show").addEventListener("click", () => setHidden(false));
  $("layer-hide").addEventListener("click", () => setHidden(true));

  // Object clipboard (inside Lekhoni; text inside boxes uses the normal clipboard).
  function cloneForCopy(b) {
    const c = JSON.parse(JSON.stringify(b));
    if (c.type === "text" && isThreaded(b)) {
      c.text = displayHtml(b); // a copy of one frame of a story gets that frame's text
      c.next = null;
    }
    return c;
  }

  function copyObject(cut) {
    const boxes = selectedBoxes();
    if (!boxes.length) return;
    clipboard = JSON.stringify(boxes.map(cloneForCopy));
    if (cut) {
      if (boxes.some((b) => b.locked)) { note("Locked objects can't be cut"); return; }
      deleteSelected();
      note("Cut");
    } else {
      note(boxes.length > 1 ? `Copied ${boxes.length} objects` : "Copied");
    }
    renderToolbarState();
  }

  function pasteObjects(list, offset) {
    if (!list || !list.length) return;
    const B = pageBounds();
    const bb = bounds(list);
    const dx = clamp(offset, B.x0 - bb.x0, B.x1 - bb.x1), dy = clamp(offset, B.y0 - bb.y0, B.y1 - bb.y1);
    const groups = new Map();
    const ids = [];
    for (const src of list) {
      const c = cloneBox(src);
      c.locked = false;
      c.next = c.type === "text" ? null : c.next;
      if (c.groupId) {
        if (list.length > 1) {
          if (!groups.has(c.groupId)) groups.set(c.groupId, uid("g"));
          c.groupId = groups.get(c.groupId);
        } else delete c.groupId;
      }
      c.x += dx;
      c.y += dy;
      doc.pages[currentPageIndex].boxes.push(c);
      ids.push(c.id);
    }
    setSel(ids, ids[ids.length - 1]);
    commit();
    renderAll();
  }

  $("obj-copy").addEventListener("click", () => copyObject(false));
  $("obj-paste").addEventListener("click", () => clipboard && pasteObjects(JSON.parse(clipboard), 5));
  $("obj-duplicate").addEventListener("click", () => {
    const boxes = selectedBoxes();
    if (boxes.length) pasteObjects(boxes.map(cloneForCopy), 5);
  });

  function deleteSelected() {
    const boxes = selectedBoxes();
    if (!boxes.length) return;
    const free = boxes.filter((b) => !b.locked);
    if (!free.length) { note("Locked — unlock it in Arrange to delete"); return; }
    removeBoxes(free.map((b) => b.id));
    if (free.length < boxes.length) note("Locked objects were kept");
    setSel([]);
    savedSel = null;
    commit();
    renderAll();
  }
  deleteBoxBtn.addEventListener("click", deleteSelected);
  // Toolbar Delete: mousedown would take focus out of a text box first, which is fine —
  // the selection stays, and the whole object goes.
  $("btn-delete-obj").addEventListener("mousedown", (e) => e.preventDefault());
  $("btn-delete-obj").addEventListener("click", deleteSelected);

  // Hyperlink on a whole object
  $("obj-link-edit").addEventListener("click", () => openLinkDialog("object"));
  $("obj-link-remove").addEventListener("click", () => {
    const box = selectedBox();
    if (!box || !box.link) return;
    box.link = null;
    rerenderBox(box);
    syncSelectionDom();
    commit();
    renderToolbarState();
  });

  // ── Templates ────────────────────────────────────────────────────────

  $("master-page").addEventListener("change", (e) => {
    const name = e.target.value;
    e.target.value = "";
    if (!name) return;
    changeDoc(() => MasterPages.applyMasterPage(doc, MasterPages.createMasterPage(name)));
  });

  // ── Find & replace ───────────────────────────────────────────────────

  let lastMatch = null; // { target, start, len }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function buildMatcher() {
    const q = $("find-text").value;
    if (!q) return null;
    let src = escapeRe(q);
    if ($("find-word").checked) src = `(?<![\\p{L}\\p{M}\\p{N}])${src}(?![\\p{L}\\p{M}\\p{N}])`;
    return new RegExp(src, "gu" + ($("find-case").checked ? "" : "i"));
  }

  /** Every text box and table cell, in reading order. */
  function findTargets() {
    const out = [];
    doc.pages.forEach((page, pi) => page.boxes.forEach((box) => {
      if (box.type === "text") { if (!prevOf(box.id)) out.push({ pi, box, model: box }); }
      else if (box.type === "table") {
        box.cells.slice().sort((a, b) => a.row - b.row || a.col - b.col)
          .forEach((cell) => out.push({ pi, box, model: cell, cell }));
      }
    }));
    return out;
  }

  function plainText(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    return tpl.content.textContent;
  }

  function hostFor(target) {
    if (target.cell) return cellElement(target.box, target.cell.row, target.cell.col);
    return boxEl(target.box.id)?.querySelector(".box-text") || null;
  }

  function textOffsetIn(host, node, offset) {
    const r = document.createRange();
    r.selectNodeContents(host);
    r.setEnd(node, offset);
    return r.toString().length;
  }

  function rangeAt(host, start, len) {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    let pos = 0, t, startSet = false;
    while ((t = walker.nextNode())) {
      const next = pos + t.length;
      if (!startSet && start < next) {
        r.setStart(t, start - pos);
        startSet = true;
      }
      if (startSet && start + len <= next) {
        r.setEnd(t, start + len - pos);
        return r;
      }
      pos = next;
    }
    return null;
  }

  /** For a story in several frames: which frame shows text offset `start`. */
  function resolveFrame(target, start) {
    if (target.cell || !target.box.next) return { target, local: start };
    const chain = threadChain(target.box);
    let frame = chain[chain.length - 1];
    for (const b of chain) {
      const fp = flowParts.get(b.id);
      if (fp && start < fp.start + fp.len) { frame = b; break; }
    }
    const fp = flowParts.get(frame.id) || { start: 0 };
    return { target: { pi: pageIndexOf(frame.id), box: frame }, local: start - fp.start };
  }

  function showMatch(storyTarget, storyStart, len) {
    const { target, local: start } = resolveFrame(storyTarget, storyStart);
    if (target.pi !== currentPageIndex) goToPage(target.pi);
    if (selectedBoxId !== target.box.id) selectBox(target.box.id);
    const host = hostFor(target);
    if (!host) return false;
    const r = rangeAt(host, start, len);
    if (!r) return false;
    savedSel = { host, range: r };
    lastMatch = { target: storyTarget, start: storyStart, len, frame: target, local: start };
    if (window.CSS && CSS.highlights && window.Highlight) {
      CSS.highlights.set("lekhoni-find", new Highlight(r));
    } else {
      restoreSelection(savedSel);
    }
    const rect = r.getBoundingClientRect();
    const sc = $("canvas-scroll"), scr = sc.getBoundingClientRect();
    if (rect.top < scr.top || rect.bottom > scr.bottom) sc.scrollTop += rect.top - scr.top - scr.height / 3;
    return true;
  }

  function clearFindHighlight() {
    if (window.CSS && CSS.highlights) CSS.highlights.delete("lekhoni-find");
  }

  function findNext() {
    const re = buildMatcher();
    const status = $("find-status");
    if (!re) { status.textContent = "Type something to find."; return false; }
    const targets = findTargets();
    if (!targets.length) { status.textContent = "There is no text in this document."; return false; }
    let startIdx = 0, startOff = 0;
    if (lastMatch) {
      const i = targets.findIndex((t) => t.model === lastMatch.target.model);
      if (i >= 0) { startIdx = i; startOff = lastMatch.start + Math.max(1, lastMatch.len); }
    } else {
      startIdx = targets.findIndex((t) => t.pi >= currentPageIndex);
      if (startIdx < 0) startIdx = 0;
    }
    for (let k = 0; k <= targets.length; k++) {
      const i = (startIdx + k) % targets.length;
      const text = plainText(targets[i].model.text);
      re.lastIndex = k === 0 ? startOff : 0;
      const m = re.exec(text);
      if (!m) continue;
      if (k === targets.length && m.index >= startOff) break;
      showMatch(targets[i], m.index, m[0].length);
      status.textContent = `Found on page ${targets[i].pi + 1}.`;
      return true;
    }
    lastMatch = null;
    clearFindHighlight();
    status.textContent = "Not found.";
    return false;
  }

  function replaceOne() {
    const re = buildMatcher();
    if (!re) return;
    if (lastMatch) {
      const host = hostFor(lastMatch.frame);
      const r = host && rangeAt(host, lastMatch.local, lastMatch.len);
      re.lastIndex = 0;
      const m = r && re.exec(r.toString());
      if (m && m.index === 0 && m[0].length === r.toString().length) {
        host.focus({ preventScroll: true });
        replaceRange(host, r, $("replace-text").value);
        lastMatch.len = $("replace-text").value.length;
        commit();
      }
    }
    findNext();
    $("find-text").focus();
  }

  function replaceInHtml(html, re, rep) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    let count = 0, t;
    while ((t = walker.nextNode())) {
      re.lastIndex = 0;
      const out = t.data.replace(re, () => { count++; return rep; });
      if (count) t.data = out;
    }
    return { html: tpl.innerHTML, count };
  }

  function replaceAll() {
    const re = buildMatcher();
    if (!re) return;
    const rep = $("replace-text").value;
    let total = 0;
    for (const t of findTargets()) {
      const { html, count } = replaceInHtml(t.model.text, re, rep);
      if (count) { t.model.text = html; total += count; }
    }
    lastMatch = null;
    clearFindHighlight();
    if (total) { commit(); renderAll(); }
    $("find-status").textContent = total ? `Replaced ${total} occurrence${total === 1 ? "" : "s"}.` : "Not found.";
  }

  function openFind() {
    findOverlay.hidden = false;
    const s = liveSelection();
    const picked = s && !s.range.collapsed ? s.range.toString() : "";
    if (picked && picked.length < 80 && !picked.includes("\n")) $("find-text").value = picked;
    $("find-status").textContent = "";
    $("find-text").focus();
    $("find-text").select();
  }
  function closeFind() {
    findOverlay.hidden = true;
    lastMatch = null;
    clearFindHighlight();
  }
  $("btn-find").addEventListener("click", openFind);
  $("find-close").addEventListener("click", closeFind);
  $("find-next").addEventListener("click", () => findNext());
  $("replace-one").addEventListener("click", replaceOne);
  $("replace-all").addEventListener("click", replaceAll);
  ["find-text", "find-case", "find-word"].forEach((id) => $(id).addEventListener("input", () => { lastMatch = null; clearFindHighlight(); }));
  $("find-text").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findNext(); } });
  $("replace-text").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); replaceOne(); } });

  // ── Hyperlinks ───────────────────────────────────────────────────────

  const linkOverlay = $("link-overlay");
  const linkBubble = $("link-bubble");
  let linkCtx = null; // { mode: "text", host, range, anchor } | { mode: "object", boxId }

  function linkLabel(href) {
    if (!href) return "";
    const m = /^#page-(\d+)$/.exec(href);
    if (m) return "page " + m[1];
    return href.replace(/^mailto:/i, "").replace(/^tel:/i, "☎ ").replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }

  function parseHref(href) {
    if (!href) return { kind: "url", value: "" };
    let m;
    if ((m = /^#page-(\d+)$/.exec(href))) return { kind: "page", value: m[1] };
    if (/^mailto:/i.test(href)) return { kind: "email", value: href.slice(7) };
    if (/^tel:/i.test(href)) return { kind: "tel", value: href.slice(4) };
    return { kind: "url", value: href };
  }

  function hrefFromForm() {
    const kind = $("link-kind").value;
    const v = $("link-target").value.trim();
    if (kind === "page") return "#page-" + $("link-page").value;
    if (!v) return null;
    if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "mailto:" + v : null;
    if (kind === "tel") return /^[+\d][\d\s().-]{2,}$/.test(v) ? "tel:" + v.replace(/[\s().-]/g, "") : null;
    const url = /^https?:\/\//i.test(v) ? v : "https://" + v;
    return /^https?:\/\/[^\s/$.?#]+\.[^\s]+$|^https?:\/\/localhost/i.test(url) ? url : null;
  }

  function syncLinkForm() {
    const kind = $("link-kind").value;
    $("link-page-wrap").hidden = kind !== "page";
    $("link-target-wrap").hidden = kind === "page";
    $("link-target-label").textContent = { url: "Web address", email: "Email address", tel: "Phone number" }[kind] || "";
    $("link-target").placeholder = { url: "example.com/page", email: "name@example.com", tel: "+91 98765 43210" }[kind] || "";
    $("link-error").textContent = "";
  }
  $("link-kind").addEventListener("change", syncLinkForm);

  function openLinkDialog(mode) {
    let href = null;
    if (mode === "text") {
      let s = liveSelection();
      if (!s) {
        const host = currentEditableHost();
        if (!host) { note("Click into the text first"); return; }
        focusEnd(host);
        s = { host, range: window.getSelection().getRangeAt(0).cloneRange() };
      }
      const anchor = anchorAtSelection(s);
      linkCtx = { mode, host: s.host, range: s.range.cloneRange(), anchor };
      href = anchor ? anchor.getAttribute("href") : null;
      $("link-text-wrap").hidden = !!anchor || !s.range.collapsed;
      $("link-text").value = "";
    } else {
      const box = selectedBox();
      if (!box || isMulti()) { note("Select one object to link"); return; }
      linkCtx = { mode, boxId: box.id };
      href = box.link;
      $("link-text-wrap").hidden = true;
    }
    const pageSel = $("link-page");
    pageSel.textContent = "";
    doc.pages.forEach((_, i) => pageSel.appendChild(new Option("Page " + (i + 1), String(i + 1))));
    const p = parseHref(href);
    $("link-kind").value = p.kind;
    $("link-target").value = p.kind === "page" ? "" : p.value;
    if (p.kind === "page") pageSel.value = p.value;
    $("link-unlink").hidden = !href;
    syncLinkForm();
    linkOverlay.hidden = false;
    hideLinkBubble();
    (p.kind === "page" ? pageSel : $("link-target")).focus();
  }

  function closeLinkDialog() {
    linkOverlay.hidden = true;
    const ctx = linkCtx;
    linkCtx = null;
    if (ctx && ctx.mode === "text" && ctx.host.isConnected) {
      restoreSelection({ host: ctx.host, range: ctx.range });
    }
  }

  const escHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function applyLink() {
    const href = hrefFromForm();
    if (!href) { $("link-error").textContent = "That doesn't look like a valid " + $("link-target-label").textContent.toLowerCase() + "."; return; }
    const ctx = linkCtx;
    if (!ctx) return;
    if (ctx.mode === "object") {
      const box = findBox(ctx.boxId);
      if (box) { box.link = href; rerenderBox(box); syncSelectionDom(); }
      linkOverlay.hidden = true;
      linkCtx = null;
      commit();
      renderToolbarState();
      return;
    }
    if (!ctx.host.isConnected) { linkOverlay.hidden = true; linkCtx = null; return; }
    restoreSelection({ host: ctx.host, range: ctx.range });
    if (ctx.anchor && ctx.anchor.isConnected) {
      ctx.anchor.setAttribute("href", href);
    } else if (!ctx.range.collapsed) {
      document.execCommand("createLink", false, href);
    } else {
      const text = $("link-text").value.trim() || linkLabel(href);
      document.execCommand("insertHTML", false, `<a href="${escHtml(href)}">${escHtml(text)}</a>`);
    }
    syncHost(ctx.host);
    linkOverlay.hidden = true;
    linkCtx = null;
    commit();
    note("Link set");
  }

  function unlinkAnchor(host, anchor) {
    anchor.replaceWith(...anchor.childNodes);
    syncHost(host);
    commit();
  }

  function removeLinkAtSelection() {
    const s = liveSelection();
    if (!s) return;
    const anchor = anchorAtSelection(s);
    if (anchor) unlinkAnchor(s.host, anchor);
    else if (!s.range.collapsed) {
      restoreSelection(s);
      document.execCommand("unlink");
      syncHost(s.host);
      commit();
    }
    hideLinkBubble();
    setDis("link-remove", true);
  }

  $("link-apply").addEventListener("click", applyLink);
  $("link-cancel").addEventListener("click", closeLinkDialog);
  $("link-close").addEventListener("click", closeLinkDialog);
  $("link-unlink").addEventListener("click", () => {
    const ctx = linkCtx;
    linkOverlay.hidden = true;
    linkCtx = null;
    if (!ctx) return;
    if (ctx.mode === "object") { $("obj-link-remove").click(); return; }
    if (ctx.anchor && ctx.anchor.isConnected) unlinkAnchor(ctx.host, ctx.anchor);
  });
  ["link-target", "link-text"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }));
  linkOverlay.addEventListener("mousedown", (e) => { if (e.target === linkOverlay) closeLinkDialog(); });
  $("link-edit").addEventListener("click", () => openLinkDialog("text"));
  $("link-remove").addEventListener("click", removeLinkAtSelection);

  function followHref(href) {
    const m = /^#page-(\d+)$/.exec(href || "");
    if (m) {
      const i = clamp(+m[1] - 1, 0, doc.pages.length - 1);
      goToPage(i);
      note("Page " + (i + 1));
      return true;
    }
    if (href && SAFE_HREF.test(href)) { window.open(href, "_blank", "noopener"); return true; }
    return false;
  }

  /** Ctrl+click: follow a link in the text, or the object's own link. */
  function followLinkAt(e, box) {
    const a = e.target && e.target.closest && e.target.closest("a[href]");
    if (a) return followHref(a.getAttribute("href"));
    return box.link ? followHref(box.link) : false;
  }

  let bubbleAnchor = null;
  function showLinkBubble(a) {
    bubbleAnchor = a;
    const r = a.getBoundingClientRect();
    $("lb-url").textContent = linkLabel(a.getAttribute("href"));
    linkBubble.hidden = false;
    const w = linkBubble.offsetWidth;
    linkBubble.style.left = clamp(r.left, 8, window.innerWidth - w - 8) + "px";
    linkBubble.style.top = r.bottom + 6 + "px";
  }
  function hideLinkBubble() {
    bubbleAnchor = null;
    if (linkBubble) linkBubble.hidden = true;
  }
  linkBubble.addEventListener("mousedown", (e) => e.preventDefault());
  $("lb-open").addEventListener("click", () => { if (bubbleAnchor) followHref(bubbleAnchor.getAttribute("href")); });
  $("lb-edit").addEventListener("click", () => openLinkDialog("text"));
  $("lb-remove").addEventListener("click", removeLinkAtSelection);
  $("canvas-scroll").addEventListener("scroll", hideLinkBubble);

  // ── Language & phonetic ──────────────────────────────────────────────

  function setLang(lang) {
    if (doc.lang === lang) return;
    doc.lang = lang;
    syncLang();
    commit();
    renderAll(); // page-number words depend on the language
  }
  $("lang-bn").addEventListener("click", () => setLang("bn"));
  $("lang-as").addEventListener("click", () => setLang("as"));

  function togglePhonetic() {
    doc.phonetic = !doc.phonetic;
    renderToolbarState();
    note(doc.phonetic ? "Phonetic typing on" : "Phonetic typing off");
    commit();
  }
  $("toggle-phonetic").addEventListener("click", togglePhonetic);
  $("toggle-phonetic").title = "Toggle phonetic typing (Ctrl+M)";

  // ── Undo, keyboard ───────────────────────────────────────────────────

  $("btn-undo").addEventListener("click", undo);
  $("btn-redo").addEventListener("click", redo);

  function isEditingText() {
    const a = document.activeElement;
    if (!a) return false;
    if (a.tagName === "INPUT") return !/^(checkbox|radio|button|submit|reset|color|range|file)$/i.test(a.type);
    return a.isContentEditable || a.tagName === "TEXTAREA" || a.tagName === "SELECT";
  }

  let nudgeTimer = null;
  function nudge(dx, dy) {
    if (!selection.size) return;
    moveSelection(dx, dy, true);
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => { refreshLayout(); commit(); }, 500); // one undo step per burst of nudges
  }

  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const inText = isEditingText();
    const inEditable = inText && document.activeElement.isContentEditable;

    if (mod && key === "s") { e.preventDefault(); saveProject(); return; }
    if (mod && key === "k" && (inEditable || selectedBox())) { e.preventDefault(); openLinkDialog(inEditable ? "text" : "object"); return; }
    if (mod && key === "m") { e.preventDefault(); togglePhonetic(); return; }
    if (mod && (key === "f" || key === "h")) { e.preventDefault(); openFind(); return; }
    if (mod && (e.key === "]" || e.key === "[") && (selectedBox()?.type === "text" || isTableSel())) {
      e.preventDefault();
      stepFontSize(e.key === "]" ? 1 : -1);
      return;
    }
    // Inside text, Ctrl+Z is the browser's own text undo.
    if (mod && key === "z" && !e.shiftKey && !inText) { e.preventDefault(); undo(); return; }
    if (mod && (key === "y" || (key === "z" && e.shiftKey)) && !inText) { e.preventDefault(); redo(); return; }

    // Bold/italic/underline in text: go through our command path so the
    // formatting is stored the same way as from the panel.
    // With just a caret in the text, the browser's own Ctrl+B (bold from here on) is right.
    if (mod && !e.shiftKey && !e.altKey && (key === "b" || key === "i" || key === "u") &&
        ((inEditable && hasTextSelection()) || (!inText && selectedBox()?.type === "text"))) {
      e.preventDefault();
      toggleChar({ b: "bold", i: "italic", u: "underline" }[key], { b: "bold", i: "italic", u: "underline" }[key]);
      return;
    }

    if (!inText && mod && key === "a") {
      e.preventDefault();
      const ids = doc.pages[currentPageIndex].boxes.map((b) => b.id);
      setSel(ids, ids[ids.length - 1] || null);
      syncSelectionDom();
      renderToolbarState();
      return;
    }
    if (!inText && mod && key === "g") { e.preventDefault(); if (e.shiftKey) ungroupSelection(); else groupSelection(); return; }
    if (!inText && selection.size) {
      if (mod && key === "c") { e.preventDefault(); copyObject(false); return; }
      if (mod && key === "x") { e.preventDefault(); copyObject(true); return; }
      if (mod && key === "d") { e.preventDefault(); $("obj-duplicate").click(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); return; }
      const step = e.shiftKey ? 5 : 1;
      const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (arrows[e.key] && !mod) { e.preventDefault(); nudge(...arrows[e.key]); return; }
    }
    if (!inText && mod && key === "v" && clipboard) { e.preventDefault(); pasteObjects(JSON.parse(clipboard), 5); return; }

    if (e.key === "Escape") {
      if (!linkOverlay.hidden) { closeLinkDialog(); return; }
      if (linkMode) { cancelLinkMode(); note("Cancelled"); return; }
      if (!findOverlay.hidden) { closeFind(); return; }
      if (!setupOverlay.hidden) { closeSetup(); return; }
      if (!tableOverlay.hidden) { closeTableModal(); return; }
      if (!$("saveas-overlay").hidden) { $("saveas-overlay").hidden = true; return; }
      setTool(null);
      if (inEditable) document.activeElement.blur();
      selectBox(null);
    }
  });

  // ── Printing: draw every page, then go back to the editor view ───────

  window.addEventListener("beforeprint", () => {
    printing = true;
    flushSave();
    clearFindHighlight();
    setPageSizeForPrint();
    renderPages(true);
  });
  window.addEventListener("afterprint", () => {
    printing = false;
    renderPages();
  });
  $("print-doc").addEventListener("click", () => window.print());
  $("btn-save-pdf").addEventListener("click", () => window.saveAsPDF());

  // ── Zoom buttons ─────────────────────────────────────────────────────

  $("zoom-in").addEventListener("click", () => setZoom(zoom + 0.1));
  $("zoom-out").addEventListener("click", () => setZoom(zoom - 0.1));
  $("canvas-scroll").addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });

  // ── Project files ────────────────────────────────────────────────────

  async function saveProject() {
    flushSave();
    const name = (doc.title || "Untitled").replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled";
    const snap = lastSnap;
    const info = await window.saveProjectToFile(doc, `${name}.pub`);
    if (info) {
      disk = { name: info.name, size: info.size, snap, downloaded: !!info.downloaded };
      scheduleStatus();
    }
  }
  $("btn-save-project").addEventListener("click", saveProject);

  // ── Save as Word / InDesign / plain text ─────────────────────────────

  const saveAsOverlay = $("saveas-overlay");
  const saveAsCtx = {
    margins: (i) => getEffectiveMargins(i),
    fill: (text, i) => fillTemplate(text, i),
    sideAlign: (a, i) => sideAlign(a, i),
    pageLabel: (i) => fillTemplate("Page {page}", i),
  };
  function openSaveAs() {
    $("saveas-status").textContent = "";
    saveAsOverlay.querySelectorAll(".saveas-opt").forEach((b) => (b.disabled = false));
    saveAsOverlay.hidden = false;
    saveAsOverlay.querySelector(".saveas-opt").focus();
  }
  function closeSaveAs() { saveAsOverlay.hidden = true; }
  $("btn-save-as").addEventListener("click", openSaveAs);
  $("saveas-close").addEventListener("click", closeSaveAs);
  saveAsOverlay.addEventListener("mousedown", (e) => { if (e.target === saveAsOverlay) closeSaveAs(); });
  saveAsOverlay.querySelectorAll(".saveas-opt").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const fmt = btn.dataset.format;
      const status = $("saveas-status");
      const opts = saveAsOverlay.querySelectorAll(".saveas-opt");
      flushSave();
      const name = (doc.title || "Untitled").replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled";
      opts.forEach((b) => (b.disabled = true));
      status.textContent = "Preparing " + btn.querySelector(".saveas-ext").textContent + " …";
      try {
        const saved = await window.LekhoniSaveAs.saveAs(fmt, doc, saveAsCtx, name);
        if (saved) {
          note("Saved " + name + btn.querySelector(".saveas-ext").textContent);
          closeSaveAs();
        } else {
          status.textContent = "";
        }
      } catch (err) {
        console.error("Save as failed:", err);
        status.textContent = "Could not save that file: " + (err && err.message ? err.message : err);
      } finally {
        opts.forEach((b) => (b.disabled = false));
      }
    })
  );

  $("btn-open-project").addEventListener("click", () => {
    window.openProjectFile((loaded, file) => {
      if (!loaded || !Array.isArray(loaded.pages)) {
        alert("That file is not a Lekhoni project.");
        return;
      }
      currentPageIndex = 0;
      replaceDoc(normalizeDoc(loaded));
      resetHistory();
      persist();
      disk = file ? { name: file.name, size: file.size, snap: lastSnap } : null;
      note("Opened " + (file ? file.name : "project"));
      scheduleStatus();
    });
  });

  $("btn-close-project").addEventListener("click", () => {
    window.closeProject(() => {
      currentPageIndex = 0;
      replaceDoc(freshDoc());
      resetHistory();
      persist();
      disk = null;
      scheduleStatus();
    });
  });

  // ── Boot ─────────────────────────────────────────────────────────────

  if ($("brand-ver")) $("brand-ver").textContent = "v" + APP_VERSION;
  $("toolbar").querySelector(".brand").title = "Lekhoni v" + APP_VERSION + " — Bengali & Assamese DTP";
  try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) { }

  unit = MM_PER[uiPrefs.unit] ? uiPrefs.unit : "mm";
  applyUnitLabels();
  const syncRulerUnit = () => { if (window.PublisherFeatures) window.PublisherFeatures.setUnit(unit); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncRulerUnit);
  else syncRulerUnit();

  syncCustomFonts();
  initializeTranslit();
  renderAll();
  resetHistory();

  // The IndexedDB copy is authoritative when it's newer than localStorage.
  Store.get(STORAGE_KEY).then((rec) => {
    if (!rec || !rec.doc || !Array.isArray(rec.doc.pages)) {
      if (initialLocal) persist(); // migrate the old localStorage document
      return;
    }
    if (initialLocal && initialLocal.t > (rec.t || 0)) {
      persist(); // localStorage was written last (e.g. at tab close)
      return;
    }
    replaceDoc(normalizeDoc(rec.doc));
    resetHistory();
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
  }).catch(() => { /* no IndexedDB: localStorage only */ });

  // Text re-flows once web fonts arrive; re-check which frames overflow.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (threadHeads().length && !document.activeElement?.isContentEditable) renderPages();
      pageStage.querySelectorAll(".box-text").forEach((t) => {
        const el = t.closest(".box");
        const box = el && findBox(el.dataset.boxId);
        if (box) updateOverset(el, box);
      });
    });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register("sw.js").catch(() => { });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController) note("Update installed — reload to use it");
      });
    });
  }
})();
