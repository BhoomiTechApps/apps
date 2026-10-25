/**
 * app.js — editor logic for the Bengali/Assamese desktop-publishing PWA.
 *
 * Model: one document = array of pages; each page = array of boxes
 * (text, image, table, shape), positioned/sized in millimetres so print
 * output matches the screen exactly.
 *
 * v5.0.1
 *  - Phonetic typing converts live as you type (no roman text left behind
 *    when the caret moves), types over selections, uses native undo.
 *  - Saves to IndexedDB (localStorage fallback), flushes on tab close.
 *  - Undo history shares image data instead of copying it per step.
 *  - Only the current page is drawn on screen; print/PDF draws every page.
 */
(function () {
  "use strict";

  const APP_VERSION = "5.0.3";
  const STORAGE_KEY = "bn-dtp-doc-v1";
  const DEFAULT_PAGE_W_MM = 210, DEFAULT_PAGE_H_MM = 297; // A4
  const MAX_HISTORY = 100;
  const MAX_IMAGE_SIDE = 3000; // px; larger photos are downscaled on import

  const PAGE_PRESETS = {
    a4: [210, 297],
    letter: [215.9, 279.4],
    legal: [215.9, 355.6],
    a5: [148, 210],
  };

  const NUM_WORDS = {
    bn: ["", "এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়", "দশ", "এগারো", "বারো", "তেরো", "চৌদ্দ", "পনেরো", "ষোলো", "সতেরো", "আঠারো", "উনিশ", "কুড়ি"],
    as: ["", "এক", "দুই", "তিনি", "চাৰি", "পাঁচ", "ছয়", "সাত", "আঠ", "ন", "দহ", "এঘাৰ", "বাৰ", "তেৰ", "চৈধ্য", "পোন্ধৰ", "ষোল্ল", "সোতৰ", "ওঠৰ", "ঊনৈছ", "বিছ"],
  };

  const $ = (id) => document.getElementById(id);
  const uid = (p) => p + Math.random().toString(36).slice(2, 10);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ── Model ────────────────────────────────────────────────────────────

  function newBox(type, x, y, w, h, tableRows, tableCols) {
    const box = {
      id: uid("b"),
      type,
      x, y, w, h,
      text: type === "text" ? "" : undefined,
      imgSrc: type === "image" ? null : undefined,
      fontFamily: "'Noto Serif Bengali', serif",
      fontSize: 14,
      bold: false, italic: false, underline: false,
      align: "left",
      color: "#1b1d22",
      lineHeight: 1.2,
      letterSpacing: 0,
      wordSpacing: 0,
      indentFirst: 0,
      indentLeft: 0,
      indentRight: 0,
      textTransform: "none",
      textShadow: "none",
    };

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
      lineHeight: 1.2, letterSpacing: 0, wordSpacing: 0,
      indentLeft: 0, indentRight: 0, indentFirst: 0,
    };
  }

  function newPage() {
    return { id: uid("p"), boxes: [] };
  }

  function freshDoc() {
    return {
      pages: [newPage()],
      lang: "bn",
      phonetic: true,
      pageW: DEFAULT_PAGE_W_MM,
      pageH: DEFAULT_PAGE_H_MM,
      margins: { top: 20, right: 18, bottom: 20, left: 18 },
      gutter: { size: 0, mode: "alternate" },
      columns: 1,
      columnGap: 0,
      guides: [],
      showMarginGuides: true,
      header: { enabled: false, text: "", showOnFirst: true },
      footer: { enabled: false, text: "", showOnFirst: true },
      pageNumber: { enabled: false, position: "bottom-center", format: "{page}", style: "native", startAt: 1 },
      customFonts: [],
    };
  }

  /** Strip anything executable from stored rich text (opened .pub files are untrusted). */
  function sanitizeHTML(html) {
    if (!html) return "";
    const tpl = document.createElement("template");
    tpl.innerHTML = String(html);
    tpl.content
      .querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button,textarea,select,svg,math")
      .forEach((n) => n.remove());
    tpl.content.querySelectorAll("*").forEach((n) => {
      for (const a of Array.from(n.attributes)) {
        const name = a.name.toLowerCase();
        if (name.startsWith("on") || name === "contenteditable" ||
            (/^(href|src|xlink:href|action|formaction)$/.test(name) && /^\s*(javascript|vbscript|data):/i.test(a.value))) {
          n.removeAttribute(a.name);
        }
      }
    });
    return tpl.innerHTML;
  }

  /** Fill in defaults, repair structure, migrate old content, sanitize. */
  function normalizeDoc(raw) {
    const d = freshDoc();
    const doc = raw && typeof raw === "object" ? raw : {};
    if (!Array.isArray(doc.pages) || !doc.pages.length) doc.pages = d.pages;
    if (typeof doc.pageW !== "number" || !(doc.pageW > 0)) doc.pageW = d.pageW;
    if (typeof doc.pageH !== "number" || !(doc.pageH > 0)) doc.pageH = d.pageH;
    doc.margins = Object.assign({}, d.margins, doc.margins || {});
    doc.gutter = Object.assign({}, d.gutter, doc.gutter || {});
    if (!(doc.columns >= 1)) doc.columns = 1;
    if (!(doc.columnGap >= 0)) doc.columnGap = 0;
    if (!Array.isArray(doc.guides)) doc.guides = [];
    if (typeof doc.showMarginGuides !== "boolean") doc.showMarginGuides = d.showMarginGuides;
    doc.header = Object.assign({}, d.header, doc.header || {});
    doc.footer = Object.assign({}, d.footer, doc.footer || {});
    doc.pageNumber = Object.assign({}, d.pageNumber, doc.pageNumber || {});
    if (!Array.isArray(doc.customFonts)) doc.customFonts = [];
    doc.customFonts = doc.customFonts.filter((f) => f && typeof f.dataUrl === "string" && f.dataUrl.startsWith("data:") && f.family);
    if (doc.lang !== "bn" && doc.lang !== "as") doc.lang = "bn";
    if (typeof doc.phonetic !== "boolean") doc.phonetic = true;

    for (const page of doc.pages) {
      if (!page.id) page.id = uid("p");
      if (!Array.isArray(page.boxes)) page.boxes = [];
      for (const box of page.boxes) {
        if (!box.id) box.id = uid("b");
        if (typeof box.text === "string") {
          // v4 Enter inserted "\n" + <br> (two line breaks); keep one.
          box.text = sanitizeHTML(box.text.replace(/\n<br>/g, "<br>"));
        }
        if (box.type === "image" && box.imgSrc && !/^data:image\//.test(box.imgSrc)) box.imgSrc = null;
        if (box.type === "table") {
          if (!Array.isArray(box.cells)) box.cells = [];
          for (const cell of box.cells) {
            if (typeof cell.text === "string") cell.text = sanitizeHTML(cell.text.replace(/\n<br>/g, "<br>"));
          }
        }
      }
    }
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
  let saveTimer = null;
  let saveSeq = 0;
  let lastSnap = null;
  let printing = false;
  let lastTabFor = null;
  const history = [];
  let historyIndex = -1;

  // ── DOM refs ─────────────────────────────────────────────────────────

  const pageStage = $("page-stage");
  const pagesRail = $("pages-rail");
  const autosaveNote = $("autosave-note");
  const imageInput = $("image-input");
  const zoomLabel = $("zoom-label");
  const deleteBoxBtn = $("delete-box");
  const fontFamilySel = $("font-family");
  const fontSizeInput = $("font-size");
  const textColorInput = $("text-color");
  const lineHeightInput = $("line-height");
  const letterSpacingInput = $("letter-spacing");
  const indentFirstInput = $("indent-first");
  const fontInput = $("font-input");

  const setupOverlay = $("setup-overlay");
  const pageSizePreset = $("page-size-preset");
  const pageWInput = $("page-w");
  const pageHInput = $("page-h");
  const marginTop = $("margin-top");
  const marginRight = $("margin-right");
  const marginBottom = $("margin-bottom");
  const marginLeft = $("margin-left");
  const marginGuidesChk = $("margin-guides");
  const gutterSize = $("gutter-size");
  const gutterMode = $("gutter-mode");
  const headerEnabled = $("header-enabled");
  const headerText = $("header-text");
  const headerFirst = $("header-first");
  const footerEnabled = $("footer-enabled");
  const footerText = $("footer-text");
  const footerFirst = $("footer-first");
  const pagenumEnabled = $("pagenum-enabled");
  const pagenumPosition = $("pagenum-position");
  const pagenumFormat = $("pagenum-format");
  const pagenumStyle = $("pagenum-style");
  const pagenumStart = $("pagenum-start");
  const tableOverlay = $("table-overlay");

  // Zoom sizer: the stage is scaled with a transform, which doesn't change its
  // layout size, so a wrapper is sized to the scaled box to give correct scrolling.
  const zoomSizer = document.createElement("div");
  zoomSizer.className = "zoom-sizer";
  pageStage.parentNode.insertBefore(zoomSizer, pageStage);
  zoomSizer.appendChild(pageStage);

  function note(text) {
    if (autosaveNote) autosaveNote.textContent = text;
  }

  // ── Saving ───────────────────────────────────────────────────────────

  function scheduleSave() {
    note("Saving…");
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
      note("Saved");
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
        if (seq === saveSeq) note("Saved");
      })
      .catch(() => {
        if (seq !== saveSeq) return;
        note(writeLocal(t) ? "Saved" : "Could not save (storage full)");
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
    if (!(opts && opts.keepSelection) || !findBox(selectedBoxId)) selectedBoxId = null;
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
  const toNativeDigits = (num) => String(num).replace(/\d/g, (d) => BENGALI_DIGITS[+d]);

  function formatNumber(num, style, lang) {
    if (style === "native") return toNativeDigits(num);
    if (style === "words") {
      const words = NUM_WORDS[lang] || NUM_WORDS.bn;
      return words[num] || toNativeDigits(num);
    }
    return String(num);
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

  function getEffectiveMargins(pageIndex) {
    const m = { ...doc.margins };
    const g = doc.gutter;
    if (!g || !g.size || g.mode === "none") return m;
    if (g.mode === "left") m.left += g.size;
    else if (g.mode === "right") m.right += g.size;
    else if (g.mode === "alternate") {
      if ((pageIndex + 1) % 2 === 1) m.left += g.size;
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

  let lastPrintCss = "";
  function setPageSizeForPrint() {
    const css = `@page { size: ${doc.pageW}mm ${doc.pageH}mm; margin: 0; }`;
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

  const boxEl = (id) => pageStage.querySelector(`[data-box-id="${id}"]`);

  // ── Rendering ────────────────────────────────────────────────────────

  function renderAll() {
    setPageSizeForPrint();
    renderPages();
    renderRail();
    renderToolbarState();
  }

  function renderPages(allPages) {
    pageStage.textContent = "";
    if (allPages) {
      doc.pages.forEach((page, idx) => pageStage.appendChild(renderPage(page, idx)));
    } else {
      pageStage.appendChild(renderPage(doc.pages[currentPageIndex], currentPageIndex));
    }
    applyZoom();
    if (!allPages && window.PublisherFeatures) window.PublisherFeatures.scheduleRender();
  }

  function renderPage(page, idx) {
    const pageEl = document.createElement("div");
    pageEl.className = "page";
    pageEl.dataset.pageId = page.id;
    pageEl.style.width = doc.pageW + "mm";
    pageEl.style.height = doc.pageH + "mm";

    if (doc.showMarginGuides) pageEl.appendChild(buildMarginGuide(idx));

    if (page.boxes.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "এই পাতাটি ফাঁকা — টুলবার থেকে Text বা Image বেছে পাতায় ক্লিক করুন।";
      pageEl.appendChild(hint);
    }

    for (const box of page.boxes) {
      if (box.hidden && printing) continue;
      pageEl.appendChild(renderBox(box));
    }

    if (doc.header.enabled && doc.header.text && (idx !== 0 || doc.header.showOnFirst)) {
      pageEl.appendChild(buildHeaderFooter("page-header", fillTemplate(doc.header.text, idx), "top", idx));
    }
    if (doc.footer.enabled && doc.footer.text && (idx !== 0 || doc.footer.showOnFirst)) {
      pageEl.appendChild(buildHeaderFooter("page-footer", fillTemplate(doc.footer.text, idx), "bottom", idx));
    }
    if (doc.pageNumber.enabled) pageEl.appendChild(buildPageNumber(idx));

    pageEl.addEventListener("pointerdown", (e) => {
      if (e.target !== pageEl) return;
      if (activeTool) placeBoxAt(page, pageEl, e);
      else selectBox(null);
    });
    return pageEl;
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

  function buildHeaderFooter(cls, text, side, pageIndex) {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
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
    const el = document.createElement("div");
    el.className = "page-number";
    el.textContent = fillTemplate(doc.pageNumber.format || "{page}", idx);
    const m = getEffectiveMargins(idx);
    const [vert, horiz] = (doc.pageNumber.position || "bottom-center").split("-");
    if (vert === "top") el.style.top = "2mm";
    else el.style.bottom = "2mm";
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
    t.style.textDecoration = box.underline ? "underline" : "none";
    t.style.textAlign = box.align;
    t.style.color = box.color;
    t.style.lineHeight = box.lineHeight || 1.2;
    t.style.letterSpacing = (box.letterSpacing || 0) + "px";
    t.style.wordSpacing = (box.wordSpacing || 0) + "px";
    t.style.paddingLeft = (box.indentLeft || 0) + "mm";
    t.style.paddingRight = (box.indentRight || 0) + "mm";
    t.style.textIndent = (box.indentFirst || 0) + "mm";
  }

  /** Wire an editable element (text box or table cell) to its model object. */
  function bindEditable(el, model) {
    el.contentEditable = "true";
    el.spellcheck = false;
    el.innerHTML = model.text || "";
    el.addEventListener("input", (e) => {
      model.text = el.innerHTML;
      if (e.inputType && e.inputType.startsWith("history")) phReset(el);
      scheduleSave(); // typing is batched into one undo step per pause
    });
    el.addEventListener("keydown", (e) => onEditableKeydown(e, el));
    el.addEventListener("paste", (e) => onEditablePaste(e, el));
    el.addEventListener("blur", () => phReset(el));
    el.addEventListener("pointerdown", () => phReset(el));
  }

  function renderBox(box) {
    const el = document.createElement("div");
    el.className = "box" + (box.id === selectedBoxId ? " selected" : "") + (box.hidden ? " is-hidden" : "");
    el.dataset.boxId = box.id;
    el.style.left = box.x + "mm";
    el.style.top = box.y + "mm";
    el.style.width = box.w + "mm";
    el.style.height = box.h + "mm";

    const grip = document.createElement("div");
    grip.className = "grip";
    grip.addEventListener("pointerdown", (e) => startDrag(e, box));
    el.appendChild(grip);

    if (box.type === "text") {
      const t = document.createElement("div");
      t.className = "box-text";
      applyTextStyle(t, box);
      bindEditable(t, box);
      t.addEventListener("focus", () => selectBox(box.id));
      el.appendChild(t);
    } else if (box.type === "table") {
      el.appendChild(renderTable(box));
      el.appendChild(buildTableResizers(box));
      requestAnimationFrame(() => positionTableResizers(el));
    } else if (box.type === "shape") {
      el.appendChild(renderShapeSvg(box));
    } else {
      const wrap = document.createElement("div");
      wrap.className = "box-image";
      if (box.imgSrc) {
        const img = document.createElement("img");
        img.src = box.imgSrc;
        img.alt = "";
        img.draggable = false;
        wrap.appendChild(img);
        wrap.title = "Double-click to replace the image";
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
          pickImageFor(box.id);
        });
      }
      el.appendChild(wrap);
    }

    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (selectedBoxId !== box.id) selectBox(box.id);
    });

    const handle = document.createElement("div");
    handle.className = "resize-handle";
    handle.addEventListener("pointerdown", (e) => startResize(e, box));
    el.appendChild(handle);
    return el;
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
        bindEditable(td, cell);
        // Rows grow with their text, so keep the drag handles on the borders.
        td.addEventListener("input", () => positionTableResizers(td.closest(".box")));
        td.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          if (selectedBoxId !== box.id) selectBox(box.id);
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

  const PX_PER_MM = 96 / 25.4; // CSS px per mm at 100% zoom (layout units)

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

  const SVG_NS = "http://www.w3.org/2000/svg";

  function renderShapeSvg(box) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.display = "block";

    let shape = null;
    const mk = (tag, attrs) => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    };
    switch (box.shapeType) {
      case "rectangle": shape = mk("rect", { x: 5, y: 5, width: 90, height: 90 }); break;
      case "circle": shape = mk("ellipse", { cx: 50, cy: 50, rx: 45, ry: 45 }); break;
      case "ellipse": shape = mk("ellipse", { cx: 50, cy: 50, rx: 45, ry: 35 }); break;
      case "star": shape = createSVGStar(50, 50, 5, 45, 18); break;
      case "line": shape = mk("line", { x1: 5, y1: 95, x2: 95, y2: 5, "stroke-linecap": "round" }); break;
      case "polygon": shape = mk("polygon", { points: "50,5 95,95 5,95" }); break;
    }
    if (shape) {
      shape.setAttribute("fill", box.shapeType === "line" ? "none" : (box.fillColor || "#FFFFFF"));
      shape.setAttribute("stroke", box.strokeColor || "#000000");
      shape.setAttribute("stroke-width", box.strokeWidth || 1);
      // Keep stroke width in screen units even though the shape stretches with the box.
      shape.setAttribute("vector-effect", "non-scaling-stroke");
      if (box.strokeDasharray && box.strokeDasharray !== "none") shape.setAttribute("stroke-dasharray", box.strokeDasharray);
      if (box.opacity !== undefined) shape.setAttribute("opacity", box.opacity);
      svg.appendChild(shape);
    }
    return svg;
  }

  function createSVGStar(cx, cy, points, outerRadius, innerRadius) {
    const star = document.createElementNS(SVG_NS, "polygon");
    const pts = [];
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerRadius : innerRadius;
      const a = (i * Math.PI) / points - Math.PI / 2;
      pts.push((cx + r * Math.cos(a)).toFixed(2) + "," + (cy + r * Math.sin(a)).toFixed(2));
    }
    star.setAttribute("points", pts.join(" "));
    return star;
  }

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
      thumb.title = "Page " + (idx + 1);
      for (const box of page.boxes) {
        const mini = document.createElement("div");
        mini.className = "mini-box" + (box.hidden ? " is-hidden" : "");
        mini.style.left = (box.x / doc.pageW) * 100 + "%";
        mini.style.top = (box.y / doc.pageH) * 100 + "%";
        mini.style.width = (box.w / doc.pageW) * 100 + "%";
        mini.style.height = (box.h / doc.pageH) * 100 + "%";
        thumb.appendChild(mini);
      }
      thumb.addEventListener("click", () => goToPage(idx));

      const delBtn = document.createElement("button");
      delBtn.className = "page-thumb-delete";
      delBtn.type = "button";
      delBtn.title = "Delete this page";
      delBtn.setAttribute("aria-label", "Delete page " + (idx + 1));
      delBtn.textContent = "×";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deletePage(idx);
      });
      thumb.appendChild(delBtn);
      wrap.appendChild(thumb);

      const num = document.createElement("div");
      num.className = "page-num";
      num.textContent = "Page " + (idx + 1);
      wrap.appendChild(num);
      frag.appendChild(wrap);
    });

    const addBtn = document.createElement("button");
    addBtn.className = "add-page-btn";
    addBtn.textContent = "+ Add page";
    addBtn.addEventListener("click", () => {
      doc.pages.splice(currentPageIndex + 1, 0, newPage());
      currentPageIndex++;
      selectedBoxId = null;
      commit();
      renderAll();
    });
    frag.appendChild(addBtn);
    pagesRail.appendChild(frag);
  }

  function goToPage(idx) {
    if (idx === currentPageIndex) return;
    currentPageIndex = clamp(idx, 0, doc.pages.length - 1);
    selectedBoxId = null;
    renderAll();
    $("canvas-scroll").scrollTop = 0;
  }

  function applyZoom() {
    pageStage.style.transform = zoom === 1 ? "" : `scale(${zoom})`;
    zoomSizer.style.width = pageStage.offsetWidth * zoom + "px";
    zoomSizer.style.height = pageStage.offsetHeight * zoom + "px";
    zoomLabel.textContent = Math.round(zoom * 100) + "%";
  }

  function setZoom(z) {
    zoom = clamp(+z.toFixed(2), 0.3, 3);
    applyZoom();
  }

  function renderToolbarState() {
    const box = findBox(selectedBoxId);
    $("props-panel").dataset.sel = box ? box.type : "none";
    // Newly selected object (clicked or just placed): show its tab.
    if (box && box.id !== lastTabFor) showTabFor(box.type);
    lastTabFor = box ? box.id : null;
    const isText = !!box && box.type === "text";
    const isTable = !!box && box.type === "table";
    const isShape = !!box && box.type === "shape";
    deleteBoxBtn.disabled = !box;

    $("group-font").classList.toggle("is-off", !(isText || isTable));
    $("group-style").classList.toggle("is-off", !isText);
    $("group-typography").classList.toggle("is-off", !isText);
    $("group-shape").classList.toggle("is-off", !isShape);
    $("group-arrange").classList.toggle("is-off", !box);
    fontFamilySel.disabled = fontSizeInput.disabled = !(isText || isTable);
    textColorInput.disabled = !isText;
    [lineHeightInput, letterSpacingInput, indentFirstInput].forEach((el) => (el.disabled = !isText));
    ["style-bold", "style-italic", "style-underline", "align-left", "align-center", "align-right", "align-justify"]
      .forEach((id) => ($(id).disabled = !isText));

    if (isText || isTable) {
      fontFamilySel.value = box.fontFamily;
      fontSizeInput.value = box.fontSize;
    }
    if (isText) {
      textColorInput.value = box.color;
      lineHeightInput.value = box.lineHeight || 1.2;
      letterSpacingInput.value = box.letterSpacing || 0;
      indentFirstInput.value = box.indentFirst || 0;
      $("style-bold").classList.toggle("active", !!box.bold);
      $("style-italic").classList.toggle("active", !!box.italic);
      $("style-underline").classList.toggle("active", !!box.underline);
      ["left", "center", "right", "justify"].forEach((a) => $("align-" + a).classList.toggle("active", box.align === a));
    }

    ["shape-fill-color", "shape-stroke-color", "shape-stroke-width"].forEach((id) => ($(id).disabled = !isShape));
    if (isShape) {
      $("shape-fill-color").value = box.fillColor || "#FFFFFF";
      $("shape-stroke-color").value = box.strokeColor || "#000000";
      $("shape-stroke-width").value = box.strokeWidth || 1;
    }

    ["layer-front", "layer-back", "layer-show", "layer-hide"].forEach((id) => ($(id).disabled = !box));
    if (box) {
      $("layer-show").disabled = !box.hidden;
      $("layer-hide").disabled = !!box.hidden;
    }

    $("lang-bn").classList.toggle("active", doc.lang === "bn");
    $("lang-as").classList.toggle("active", doc.lang === "as");
    $("toggle-phonetic").classList.toggle("active", !!doc.phonetic);
    zoomLabel.textContent = Math.round(zoom * 100) + "%";
  }

  function selectBox(id) {
    selectedBoxId = id;
    pageStage.querySelectorAll(".box").forEach((el) => el.classList.toggle("selected", el.dataset.boxId === id));
    renderToolbarState();
  }

  // ── Properties panel ─────────────────────────────────────────────────

  const UI_PREF_KEY = "lekhoni-ui";
  const uiPrefs = (() => {
    try { return JSON.parse(localStorage.getItem(UI_PREF_KEY)) || {}; } catch (e) { return {}; }
  })();
  const saveUiPrefs = () => {
    try { localStorage.setItem(UI_PREF_KEY, JSON.stringify(uiPrefs)); } catch (e) { }
  };

  const propsPanel = $("props-panel");
  const panelTabs = Array.from(propsPanel.querySelectorAll(".ptab"));
  const CONTEXT_TABS = ["text", "shape", "arrange"];

  function showTab(name) {
    for (const tab of panelTabs) {
      const on = tab.dataset.tab === name;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on);
    }
    propsPanel.querySelectorAll(".ppane").forEach((p) => (p.hidden = p.dataset.pane !== name));
    uiPrefs.tab = name;
    saveUiPrefs();
  }

  /** On a new selection, jump to the tab that formats it (unless on Page). */
  function showTabFor(type) {
    const current = panelTabs.find((t) => t.classList.contains("active"))?.dataset.tab;
    if (current === "page") return;
    showTab(type === "text" || type === "table" ? "text" : type === "shape" ? "shape" : "arrange");
  }

  panelTabs.forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));

  function setPanelVisible(visible) {
    $("workspace").classList.toggle("panel-hidden", !visible);
    $("toggle-panel").classList.toggle("active", visible);
    uiPrefs.panel = visible;
    saveUiPrefs();
  }
  $("toggle-panel").addEventListener("click", () =>
    setPanelVisible($("workspace").classList.contains("panel-hidden"))
  );

  showTab(uiPrefs.tab || "text");
  setPanelVisible(uiPrefs.panel !== undefined ? uiPrefs.panel : window.innerWidth >= 1000);

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
    const h = isShape ? (activeTool === "line" ? 30 : 60) : activeTool === "text" ? 30 : 60;
    const box = newBox(type, clamp(xMm - w / 2, 0, doc.pageW - w), clamp(yMm - h / 2, 0, doc.pageH - h), w, h);

    if (type === "text") {
      box.fontFamily = fontFamilySel.value;
      box.fontSize = Number(fontSizeInput.value) || 14;
      Typography.initTypography(box);
    }
    if (isShape) Shapes.initShapeBox(box, activeTool);

    evt.preventDefault(); // keep focus where we put it below
    page.boxes.push(box);
    setTool(null);
    selectedBoxId = box.id;
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
    const vertical = [0, m.left, doc.pageW - m.right, doc.pageW, ...columnEdges(currentPageIndex)];
    const horizontal = [0, m.top, doc.pageH - m.bottom, doc.pageH];
    for (const g of doc.guides || []) {
      if (g.orientation === "v") vertical.push(g.posMM);
      if (g.orientation === "h") horizontal.push(g.posMM);
    }
    return { vertical, horizontal };
  }

  function trackPointer(e, onMove, onDone) {
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch (err) { }
    let moved = false;
    const move = (ev) => { moved = true; onMove(ev); };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      onDone(moved);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  function startDrag(e, box) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    selectBox(box.id);
    const el = boxEl(box.id);
    const pxPerMm = el.closest(".page").getBoundingClientRect().width / doc.pageW;
    const startX = e.clientX, startY = e.clientY;
    const origX = box.x, origY = box.y;
    const guides = snapGuides();
    const threshold = 6 / pxPerMm; // ~6 screen px at any zoom

    trackPointer(e, (ev) => {
      let x = clamp(origX + (ev.clientX - startX) / pxPerMm, 0, doc.pageW - box.w);
      let y = clamp(origY + (ev.clientY - startY) / pxPerMm, 0, doc.pageH - box.h);
      if (typeof window.snapToGuides === "function") {
        ({ x, y } = window.snapToGuides({ x, y, w: box.w, h: box.h }, guides, threshold));
      }
      box.x = x;
      box.y = y;
      el.style.left = x + "mm";
      el.style.top = y + "mm";
    }, (moved) => {
      if (!moved) return;
      renderRail();
      commit();
    });
  }

  function startResize(e, box) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    selectBox(box.id);
    const el = boxEl(box.id);
    const pxPerMm = el.closest(".page").getBoundingClientRect().width / doc.pageW;
    const startX = e.clientX, startY = e.clientY;
    const origW = box.w, origH = box.h;

    trackPointer(e, (ev) => {
      box.w = clamp(origW + (ev.clientX - startX) / pxPerMm, 5, doc.pageW - box.x);
      box.h = clamp(origH + (ev.clientY - startY) / pxPerMm, 5, doc.pageH - box.y);
      el.style.width = box.w + "mm";
      el.style.height = box.h + "mm";
      if (box.type === "table") {
        applyTableSizes(el.querySelector("table.box-table"), box);
        positionTableResizers(el);
      }
    }, (moved) => {
      if (!moved) return;
      renderRail();
      commit();
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
    let ok = false;
    try { ok = document.execCommand("insertLineBreak", false); } catch (err) { }
    if (ok) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const br = document.createElement("br");
    range.insertNode(br);
    // A <br> at the very end of a block shows no new line on its own.
    if (!br.nextSibling) br.after(document.createElement("br"));
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function onEditableKeydown(e, el) {
    if (e.isComposing || e.keyCode === 229) return; // native IME in use

    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      phReset(el);
      insertLineBreak(el);
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
    replaceRange(el, sel.getRangeAt(0), text.replace(/\r\n?/g, "\n"));
  }

  // ── Pages ────────────────────────────────────────────────────────────

  function deletePage(idx) {
    if (doc.pages.length <= 1) {
      alert("A document needs at least one page.");
      return;
    }
    if (doc.pages[idx].boxes.length && !confirm("Delete this page and everything on it?")) return;
    doc.pages.splice(idx, 1);
    if (currentPageIndex >= doc.pages.length) currentPageIndex = doc.pages.length - 1;
    else if (currentPageIndex > idx) currentPageIndex--;
    selectedBoxId = null;
    commit();
    renderAll();
  }

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
    for (const [key, [w, h]] of Object.entries(PAGE_PRESETS)) {
      if (Math.abs(doc.pageW - w) < 0.05 && Math.abs(doc.pageH - h) < 0.05) return key;
    }
    return "custom";
  }

  function openSetup() {
    pageSizePreset.value = detectPreset();
    pageWInput.value = doc.pageW;
    pageHInput.value = doc.pageH;
    marginTop.value = doc.margins.top;
    marginRight.value = doc.margins.right;
    marginBottom.value = doc.margins.bottom;
    marginLeft.value = doc.margins.left;
    marginGuidesChk.checked = !!doc.showMarginGuides;
    gutterSize.value = doc.gutter.size || 0;
    gutterMode.value = doc.gutter.mode || "alternate";
    headerEnabled.checked = !!doc.header.enabled;
    headerText.value = doc.header.text || "";
    headerFirst.checked = !!doc.header.showOnFirst;
    footerEnabled.checked = !!doc.footer.enabled;
    footerText.value = doc.footer.text || "";
    footerFirst.checked = !!doc.footer.showOnFirst;
    pagenumEnabled.checked = !!doc.pageNumber.enabled;
    pagenumPosition.value = doc.pageNumber.position;
    pagenumFormat.value = doc.pageNumber.format;
    pagenumStyle.value = doc.pageNumber.style || "native";
    pagenumStart.value = doc.pageNumber.startAt;
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

  pageSizePreset.addEventListener("change", () => {
    const v = pageSizePreset.value;
    if (v === "custom") return;
    changeDoc(() => {
      [doc.pageW, doc.pageH] = PAGE_PRESETS[v];
      pageWInput.value = doc.pageW;
      pageHInput.value = doc.pageH;
    });
  });

  function onPageDimsChanged() {
    changeDoc(() => {
      doc.pageW = clamp(Number(pageWInput.value) || doc.pageW, 50, 1000);
      doc.pageH = clamp(Number(pageHInput.value) || doc.pageH, 50, 1000);
      pageWInput.value = doc.pageW;
      pageHInput.value = doc.pageH;
      pageSizePreset.value = detectPreset();
    });
  }
  pageWInput.addEventListener("change", onPageDimsChanged);
  pageHInput.addEventListener("change", onPageDimsChanged);

  [marginTop, marginRight, marginBottom, marginLeft].forEach((el) =>
    el.addEventListener("change", () => changeDoc(() => {
      doc.margins = {
        top: clamp(Number(marginTop.value) || 0, 0, 200),
        right: clamp(Number(marginRight.value) || 0, 0, 200),
        bottom: clamp(Number(marginBottom.value) || 0, 0, 200),
        left: clamp(Number(marginLeft.value) || 0, 0, 200),
      };
    }))
  );
  marginGuidesChk.addEventListener("change", () => changeDoc(() => (doc.showMarginGuides = marginGuidesChk.checked)));
  gutterSize.addEventListener("change", () => changeDoc(() => (doc.gutter.size = clamp(Number(gutterSize.value) || 0, 0, 50))));
  gutterMode.addEventListener("change", () => changeDoc(() => (doc.gutter.mode = gutterMode.value || "alternate")));

  headerEnabled.addEventListener("change", () => changeDoc(() => (doc.header.enabled = headerEnabled.checked)));
  headerText.addEventListener("input", () => changeDoc(() => (doc.header.text = headerText.value), true));
  headerFirst.addEventListener("change", () => changeDoc(() => (doc.header.showOnFirst = headerFirst.checked)));
  footerEnabled.addEventListener("change", () => changeDoc(() => (doc.footer.enabled = footerEnabled.checked)));
  footerText.addEventListener("input", () => changeDoc(() => (doc.footer.text = footerText.value), true));
  footerFirst.addEventListener("change", () => changeDoc(() => (doc.footer.showOnFirst = footerFirst.checked)));
  pagenumEnabled.addEventListener("change", () => changeDoc(() => (doc.pageNumber.enabled = pagenumEnabled.checked)));
  pagenumPosition.addEventListener("change", () => changeDoc(() => (doc.pageNumber.position = pagenumPosition.value)));
  pagenumFormat.addEventListener("change", () => changeDoc(() => (doc.pageNumber.format = pagenumFormat.value)));
  pagenumStyle.addEventListener("change", () => changeDoc(() => (doc.pageNumber.style = pagenumStyle.value)));
  pagenumStart.addEventListener("change", () => changeDoc(() => (doc.pageNumber.startAt = Math.max(1, Number(pagenumStart.value) || 1))));

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
    box.fontFamily = fontFamilySel.value;
    box.fontSize = Number(fontSizeInput.value) || 12;
    page.boxes.push(box);
    selectedBoxId = box.id;
    closeTableModal();
    commit();
    renderAll();
  });

  // ── Formatting controls ──────────────────────────────────────────────

  /** Change the selected text box (or table, for font family/size). */
  function applyToSelected(mutator, opts) {
    const box = findBox(selectedBoxId);
    if (!box) return;
    const allowTable = opts && opts.table;
    if (box.type !== "text" && !(allowTable && box.type === "table")) return;
    mutator(box);
    if (box.type === "text") {
      const t = boxEl(box.id)?.querySelector(".box-text");
      if (t) applyTextStyle(t, box);
    } else {
      rerenderBox(box);
    }
    renderToolbarState();
    if (opts && opts.debounce) scheduleSave();
    else commit();
  }

  fontFamilySel.addEventListener("change", () => applyToSelected((b) => (b.fontFamily = fontFamilySel.value), { table: true }));
  fontSizeInput.addEventListener("change", () => applyToSelected((b) => (b.fontSize = clamp(Number(fontSizeInput.value) || 14, 4, 400)), { table: true }));
  textColorInput.addEventListener("input", () => applyToSelected((b) => (b.color = textColorInput.value), { debounce: true }));
  lineHeightInput.addEventListener("change", () => applyToSelected((b) => (b.lineHeight = clamp(parseFloat(lineHeightInput.value) || 1.2, 0.5, 5))));
  letterSpacingInput.addEventListener("change", () => applyToSelected((b) => (b.letterSpacing = clamp(parseFloat(letterSpacingInput.value) || 0, -10, 50))));
  indentFirstInput.addEventListener("change", () => applyToSelected((b) => (b.indentFirst = clamp(parseFloat(indentFirstInput.value) || 0, -50, 100))));

  $("style-bold").addEventListener("click", () => applyToSelected((b) => (b.bold = !b.bold)));
  $("style-italic").addEventListener("click", () => applyToSelected((b) => (b.italic = !b.italic)));
  $("style-underline").addEventListener("click", () => applyToSelected((b) => (b.underline = !b.underline)));
  ["left", "center", "right", "justify"].forEach((a) =>
    $("align-" + a).addEventListener("click", () => applyToSelected((b) => (b.align = a)))
  );

  function bindShapeInput(id, apply) {
    const input = $(id);
    const update = (save) => {
      const box = findBox(selectedBoxId);
      if (!box || box.type !== "shape") return;
      apply(box, input.value);
      rerenderBox(box); // only this box, not the whole page
      if (save) commit();
      else scheduleSave();
    };
    input.addEventListener("input", () => update(false));
    input.addEventListener("change", () => update(true));
  }
  bindShapeInput("shape-fill-color", (b, v) => (b.fillColor = v));
  bindShapeInput("shape-stroke-color", (b, v) => (b.strokeColor = v));
  bindShapeInput("shape-stroke-width", (b, v) => (b.strokeWidth = clamp(parseFloat(v) || 1, 0, 20)));

  // ── Templates, layers ────────────────────────────────────────────────

  $("master-page").addEventListener("change", (e) => {
    const name = e.target.value;
    e.target.value = "";
    if (!name) return;
    changeDoc(() => MasterPages.applyMasterPage(doc, MasterPages.createMasterPage(name)));
  });

  function layerAction(fn) {
    const box = findBox(selectedBoxId);
    const page = findPageOfBox(selectedBoxId);
    if (!box || !page) return;
    fn(box, page);
    renderPages();
    renderRail();
    renderToolbarState();
    commit();
  }
  $("layer-front").addEventListener("click", () => layerAction((b, p) => Layers.bringToFront(p, b.id)));
  $("layer-back").addEventListener("click", () => layerAction((b, p) => Layers.sendToBack(p, b.id)));
  // Hidden boxes stay on screen as faint outlines (and are left out of print),
  // so they can still be selected and shown again.
  $("layer-show").addEventListener("click", () => layerAction((b) => (b.hidden = false)));
  $("layer-hide").addEventListener("click", () => layerAction((b) => (b.hidden = true)));

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

  // ── Delete, undo, keyboard ───────────────────────────────────────────

  deleteBoxBtn.addEventListener("click", () => {
    const page = findPageOfBox(selectedBoxId);
    if (!page) return;
    page.boxes = page.boxes.filter((b) => b.id !== selectedBoxId);
    selectedBoxId = null;
    commit();
    renderAll();
  });

  $("btn-undo").addEventListener("click", undo);
  $("btn-redo").addEventListener("click", redo);

  function isEditingText() {
    const a = document.activeElement;
    return !!a && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
  }

  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === "s") {
      e.preventDefault();
      saveProject();
      return;
    }
    if (mod && key === "m") {
      e.preventDefault();
      togglePhonetic();
      return;
    }
    // Inside text, Ctrl+Z is the browser's own text undo.
    if (mod && key === "z" && !e.shiftKey && !isEditingText()) { e.preventDefault(); undo(); return; }
    if (mod && (key === "y" || (key === "z" && e.shiftKey)) && !isEditingText()) { e.preventDefault(); redo(); return; }

    if ((e.key === "Delete" || e.key === "Backspace") && selectedBoxId && !isEditingText()) {
      e.preventDefault();
      deleteBoxBtn.click();
      return;
    }

    if (e.key === "Escape") {
      if (!setupOverlay.hidden) { closeSetup(); return; }
      if (!tableOverlay.hidden) { closeTableModal(); return; }
      setTool(null);
      if (isEditingText() && document.activeElement.isContentEditable) document.activeElement.blur();
      selectBox(null);
    }
  });

  // ── Printing: draw every page, then go back to the editor view ───────

  window.addEventListener("beforeprint", () => {
    printing = true;
    flushSave();
    renderPages(true);
  });
  window.addEventListener("afterprint", () => {
    printing = false;
    renderPages();
  });
  $("print-doc").addEventListener("click", () => window.print());
  $("btn-save-pdf").addEventListener("click", () => window.saveAsPDF());

  // ── Zoom ─────────────────────────────────────────────────────────────

  $("zoom-in").addEventListener("click", () => setZoom(zoom + 0.1));
  $("zoom-out").addEventListener("click", () => setZoom(zoom - 0.1));
  $("canvas-scroll").addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });

  // ── Project files ────────────────────────────────────────────────────

  function saveProject() {
    flushSave();
    window.saveProjectToFile(doc, `${doc.title || "Untitled"}.pub`);
  }
  $("btn-save-project").addEventListener("click", saveProject);

  $("btn-open-project").addEventListener("click", () => {
    window.openProjectFile((loaded) => {
      if (!loaded || !Array.isArray(loaded.pages)) {
        alert("That file is not a Lekhoni project.");
        return;
      }
      currentPageIndex = 0;
      replaceDoc(normalizeDoc(loaded));
      resetHistory();
      persist();
    });
  });

  $("btn-close-project").addEventListener("click", () => {
    window.closeProject(() => {
      currentPageIndex = 0;
      replaceDoc(freshDoc());
      resetHistory();
      persist();
    });
  });

  // ── Boot ─────────────────────────────────────────────────────────────

  if ($("brand-ver")) $("brand-ver").textContent = "v" + APP_VERSION;
  $("toolbar").querySelector(".brand").title = "Lekhoni v" + APP_VERSION + " — Bengali & Assamese DTP";

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
