/**
 * js/saveas.js — "Save as" exporters for Lekhoni.
 *
 *  - Plain text (.txt):  UTF-8 text of every page, in reading order.
 *  - Microsoft Word (.docx): editable text that flows page by page, with
 *    fonts, sizes, colours, bold/italic/underline, alignment, indents,
 *    spacing, lists, links, tables, pictures, header/footer and page numbers.
 *  - Adobe InDesign (.idml): the layout itself — every page, text frame
 *    (linked frames stay threaded), picture (embedded), shape, line and
 *    table at its exact position, with paragraph styles. Text is set with
 *    the Adobe World-Ready Paragraph Composer so Bengali/Assamese shapes
 *    correctly.
 *
 * All three are built in the browser (works offline); no libraries.
 * Exposes window.LekhoniSaveAs.
 */
(function () {
  "use strict";

  const PT_PER_MM = 72 / 25.4;
  const TWIP_PER_MM = 1440 / 25.4;
  const EMU_PER_MM = 36000;
  const PT_PER_PX = 0.75;
  const GENERIC_FONT = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|math|emoji)$/i;
  const FALLBACK_FONT = "Noto Serif Bengali";

  // ── Small helpers ────────────────────────────────────────────────────

  const r2 = (v) => Math.round(v * 100) / 100;
  const int = (v) => Math.round(v);
  const pt = (mm) => r2((mm || 0) * PT_PER_MM);
  const twip = (mm) => int((mm || 0) * TWIP_PER_MM);
  const emu = (mm) => int((mm || 0) * EMU_PER_MM);

  /** Escape for XML text and attributes; drop characters XML 1.0 forbids. */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function firstFont(css) {
    if (!css) return null;
    for (const part of String(css).split(",")) {
      const name = part.trim().replace(/^["']|["']$/g, "").trim();
      if (name && !GENERIC_FONT.test(name)) return name;
    }
    return null;
  }

  /** CSS colour → "#rrggbb" (null for transparent / unknown). */
  function hex(c) {
    if (!c) return null;
    c = String(c).trim().toLowerCase();
    let m;
    if ((m = /^#([0-9a-f]{6})$/.exec(c))) return "#" + m[1];
    if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c))) return "#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
    if ((m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(c))) {
      if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
      return "#" + [m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(+v))).toString(16).padStart(2, "0")).join("");
    }
    const named = { black: "#000000", white: "#ffffff", red: "#ff0000", blue: "#0000ff", green: "#008000", yellow: "#ffff00", gray: "#808080", grey: "#808080" };
    return named[c] || null;
  }

  function cssSizePt(v, parentPt) {
    const m = /^([\d.]+)(pt|px|em|rem|%)?$/.exec(String(v).trim());
    if (!m) return parentPt;
    const n = parseFloat(m[1]);
    switch (m[2]) {
      case "px": return n * PT_PER_PX;
      case "em": case "rem": return n * parentPt;
      case "%": return (n / 100) * parentPt;
      default: return n;
    }
  }

  // ── Numbers for list markers ─────────────────────────────────────────

  const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
  const toBn = (n) => String(n).replace(/\d/g, (d) => BN_DIGITS[d]);
  function toRoman(n) {
    if (!(n > 0 && n < 4000)) return String(n);
    const t = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let o = "";
    for (const [v, s] of t) while (n >= v) { o += s; n -= v; }
    return o;
  }
  function toAlpha(n) {
    let s = "";
    while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
  }
  function olMarker(style, n) {
    switch (style) {
      case "decimal": return n + ".";
      case "lower-roman": return toRoman(n).toLowerCase() + ".";
      case "upper-roman": return toRoman(n) + ".";
      case "lower-alpha": return toAlpha(n) + ".";
      default: return toBn(n) + "."; // ১. ২. ৩.
    }
  }
  function bulletChar(style) {
    if (style === "circle") return "○";
    if (style === "square") return "■";
    if (style && style.indexOf("–") >= 0) return "–";
    return "●";
  }

  function applyCase(t, tc) {
    if (tc === "lowercase") return t.toLowerCase();
    if (tc === "capitalize") return t.replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    return t;
  }

  // ── Rich text (the editor's HTML) → paragraphs of runs ───────────────
  //
  // Paragraph: { align, list, dropChars, runs: [run] }
  // Run: { t } text or { br: true }, plus font, size, b, i, u, s, sup, sub,
  //      color, bg, href, caps ("uppercase" | "smallcaps" | ...)

  const BLOCK = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "HEADER", "FOOTER"]);

  function baseFormat(box, over) {
    const f = {
      font: firstFont(box.fontFamily) || FALLBACK_FONT,
      size: +box.fontSize || 12,
      b: !!box.bold, i: !!box.italic, u: !!box.underline, s: !!box.strike,
      sup: false, sub: false,
      color: hex(box.color) || "#000000",
      bg: null, href: null,
      caps: box.textCase || "none",
    };
    return Object.assign(f, over || {});
  }

  function inlineFormat(el, f) {
    const g = Object.assign({}, f);
    switch (el.tagName) {
      case "B": case "STRONG": g.b = true; break;
      case "I": case "EM": g.i = true; break;
      case "U": case "INS": g.u = true; break;
      case "S": case "STRIKE": case "DEL": g.s = true; break;
      case "SUP": g.sup = true; g.sub = false; break;
      case "SUB": g.sub = true; g.sup = false; break;
      case "A": g.href = el.getAttribute("href") || null; break;
      case "FONT": {
        const face = firstFont(el.getAttribute("face"));
        if (face) g.font = face;
        const c = hex(el.getAttribute("color"));
        if (c) g.color = c;
        break;
      }
    }
    const st = el.style;
    if (st) {
      if (st.fontWeight) g.b = st.fontWeight === "bold" || st.fontWeight === "bolder" || parseInt(st.fontWeight, 10) >= 600;
      if (st.fontStyle) g.i = st.fontStyle === "italic" || st.fontStyle === "oblique";
      const td = st.textDecorationLine || st.textDecoration;
      if (td) {
        if (/none/.test(td)) { g.u = false; g.s = false; }
        if (/underline/.test(td)) g.u = true;
        if (/line-through/.test(td)) g.s = true;
      }
      if (st.color) g.color = hex(st.color) || g.color;
      if (st.backgroundColor) g.bg = hex(st.backgroundColor);
      if (st.fontFamily) g.font = firstFont(st.fontFamily) || g.font;
      if (st.fontSize) g.size = cssSizePt(st.fontSize, f.size);
      if (st.verticalAlign === "super") { g.sup = true; g.sub = false; }
      if (st.verticalAlign === "sub") { g.sub = true; g.sup = false; }
    }
    return g;
  }

  let listSeq = 0;

  function parseRich(html, box, over) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    const base = baseFormat(box, over);
    const defAlign = (over && over.align) || box.align || "left";
    const paras = [];
    let cur = null;

    const start = (align, list) => {
      cur = { align: align || defAlign, list: list || null, runs: [] };
      paras.push(cur);
      return cur;
    };
    const end = () => {
      if (cur) {
        const rs = cur.runs;
        // A browser puts a <br> at the end of a paragraph to keep it open.
        if (rs.length && rs[rs.length - 1].br) rs.pop();
      }
      cur = null;
    };
    const addText = (text, f) => {
      if (!cur) start(null, null);
      text.split("\n").forEach((part, i) => {
        if (i) cur.runs.push({ br: true });
        if (part) cur.runs.push(Object.assign({ t: applyCase(part, f.caps) }, f));
      });
    };
    const blockAlign = (el) => {
      const a = el.style && el.style.textAlign;
      if (a === "start") return "left";
      if (a === "end") return "right";
      return a === "left" || a === "right" || a === "center" || a === "justify" ? a : el.getAttribute("align") || null;
    };

    function walk(node, f, list) {
      for (const n of Array.from(node.childNodes)) {
        if (n.nodeType === 3) { addText(n.data, f); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName;
        if (tag === "BR") { if (!cur) start(null, null); cur.runs.push({ br: true }); continue; }
        if (tag === "UL" || tag === "OL") {
          end();
          const l = {
            ordered: tag === "OL", count: 0, level: list ? list.level + 1 : 0, id: ++listSeq,
            start: parseInt(n.getAttribute("start"), 10) || 1,
          };
          walk(n, f, l);
          end();
          continue;
        }
        if (n.classList && n.classList.contains("lk-dc")) {
          if (!cur) start(null, null);
          if (paras.length === 1 && cur.dropChars == null) cur.dropChars = n.textContent.length;
          walk(n, f, list);
          continue;
        }
        const g = inlineFormat(n, f);
        if (BLOCK.has(tag)) {
          if (cur && cur.fromLi && !cur.runs.length) {
            // <li><p>…</p></li>: the paragraph is the list item.
            cur.align = blockAlign(n) || cur.align;
            walk(n, g, list);
            continue;
          }
          end();
          let li = null;
          if (tag === "LI" && list) {
            list.count++;
            li = { ordered: list.ordered, level: list.level, id: list.id, n: list.start + list.count - 1, first: list.count === 1 };
          }
          start(blockAlign(n), li);
          if (li) cur.fromLi = true;
          walk(n, g, list);
          end();
          continue;
        }
        walk(n, g, list);
      }
    }
    walk(tpl.content, base, null);
    end();
    // Merge neighbouring runs with the same formatting (smaller files).
    for (const p of paras) {
      const out = [];
      for (const r of p.runs) {
        const last = out[out.length - 1];
        if (last && !last.br && !r.br && sameFmt(last, r)) last.t += r.t;
        else out.push(Object.assign({}, r));
      }
      p.runs = out;
    }
    return paras;
  }

  const FMT_KEYS = ["font", "size", "b", "i", "u", "s", "sup", "sub", "color", "bg", "href", "caps"];
  const sameFmt = (a, b) => FMT_KEYS.every((k) => a[k] === b[k]);

  // ── What is on each page, in reading order ───────────────────────────

  function collect(doc) {
    const prev = new Set();
    for (const p of doc.pages) for (const b of p.boxes) if (b.next) prev.add(b.next);
    return doc.pages.map((page) => {
      const items = page.boxes.filter((b) => !b.hidden);
      // Top to bottom; objects starting within 3 mm of each other read left to right.
      items.sort((a, b) => (Math.abs(a.y - b.y) < 3 ? a.x - b.x : a.y - b.y));
      return { page, items, prev };
    });
  }

  const plainOf = (paras) => paras.map((p) => p.runs.map((r) => (r.br ? "\n" : r.t)).join("")).join("\n");

  function cellAt(box, r, c) {
    return (box.cells || []).find((x) => x.row === r && x.col === c) || { text: "" };
  }

  function cellOver(box, cell) {
    return {
      color: hex(cell.textColor) || hex(box.color) || "#000000",
      b: !!cell.bold,
      align: cell.align || "left",
    };
  }

  function sizes(box) {
    const ok = (a, n) => Array.isArray(a) && a.length === n && a.every((x) => x > 0);
    const even = (n) => Array(n).fill(1 / n);
    return {
      cols: ok(box.colWidths, box.cols) ? box.colWidths : even(box.cols),
      rows: ok(box.rowHeights, box.rows) ? box.rowHeights : even(box.rows),
    };
  }

  // ── Images ───────────────────────────────────────────────────────────

  /** Bytes + pixel size of a stored picture; anything but PNG/JPEG becomes PNG. */
  async function loadImage(src) {
    if (!src || !/^data:image\//.test(src)) return null;
    const img = new Image();
    img.src = src;
    try { await img.decode(); } catch (e) { return null; }
    const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
    let mime = (/^data:(image\/[\w.+-]+)/.exec(src) || [])[1] || "";
    let bytes;
    if (mime === "image/png" || mime === "image/jpeg") {
      bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
    } else {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0);
      const blob = await new Promise((res) => c.toBlob(res, "image/png"));
      bytes = new Uint8Array(await blob.arrayBuffer());
      mime = "image/png";
    }
    return { bytes, mime, ext: mime === "image/png" ? "png" : "jpg", w, h };
  }

  /** Where the picture sits inside its frame (mm), following the frame's fit setting. */
  function fitImage(box, img) {
    const fw = box.w, fh = box.h, ir = img.w / img.h;
    const fit = box.imgFit || "contain";
    if (fit === "fill") return { x: 0, y: 0, w: fw, h: fh };
    let w, h;
    if ((fit === "cover") === (fw / fh < ir)) { h = fh; w = fh * ir; }
    else { w = fw; h = fw / ir; }
    return { x: (fw - w) / 2, y: (fh - h) / 2, w, h };
  }

  function b64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ── ZIP writer (stored + deflate via CompressionStream when available) ──

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function deflateRaw(data) {
    if (typeof CompressionStream === "undefined") return null;
    try {
      const cs = new CompressionStream("deflate-raw");
      const out = new Response(new Blob([data]).stream().pipeThrough(cs));
      return new Uint8Array(await out.arrayBuffer());
    } catch (e) {
      return null;
    }
  }

  /** files: [{ name, data: string|Uint8Array, store?: true }] — order is kept. */
  async function makeZip(files) {
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name);
      const raw = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(raw);
      let body = raw, method = 0;
      if (!f.store && raw.length > 256) {
        const z = await deflateRaw(raw);
        if (z && z.length < raw.length) { body = z; method = 8; }
      }
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, method, true);
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, body.length, true);
      lh.setUint32(22, raw.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, body);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, method, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, body.length, true);
      ch.setUint32(24, raw.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true);
    eo.setUint16(8, files.length, true);
    eo.setUint16(10, files.length, true);
    eo.setUint32(12, cdSize, true);
    eo.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(eo.buffer)]);
  }

  // ═════════════════════════════════════════════════════════════════════
  // Plain text
  // ═════════════════════════════════════════════════════════════════════

  function exportTXT(doc, ctx) {
    const pages = collect(doc).map(({ page, items, prev }) => {
      const blocks = [];
      for (const box of items) {
        if (box.type === "text") {
          if (prev.has(box.id)) continue; // text lives with the first frame of a flow
          const paras = parseRich(box.text, box);
          const lines = paras.map((p) => {
            let pre = "";
            if (p.list) pre = "  ".repeat(p.list.level) + (p.list.ordered ? olMarker(box.olStyle, p.list.n) : bulletChar(box.ulStyle)) + " ";
            return pre + p.runs.map((r) => (r.br ? "\n" : r.t)).join("");
          });
          const t = lines.join("\n").replace(/[ \t]+(?=\n|$)/g, "").replace(/\s+$/, "");
          if (t) blocks.push(t);
        } else if (box.type === "table") {
          const rows = [];
          for (let r = 0; r < box.rows; r++) {
            const cells = [];
            for (let c = 0; c < box.cols; c++) {
              const cell = cellAt(box, r, c);
              cells.push(plainOf(parseRich(cell.text, box, cellOver(box, cell))).replace(/\s*\n\s*/g, " ").trim());
            }
            rows.push(cells.join("\t"));
          }
          blocks.push(rows.join("\n"));
        }
      }
      return blocks.join("\n\n");
    });
    let out = "";
    pages.forEach((t, i) => {
      if (i) out += "\n\n----- " + ctx.pageLabel(i) + " -----\n\n";
      out += t;
    });
    out = out.replace(/\r?\n/g, "\r\n") + "\r\n";
    // BOM so Notepad, Word and older editors read it as UTF-8.
    return new Blob(["﻿" + out], { type: "text/plain;charset=utf-8" });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Microsoft Word (.docx)
  // ═════════════════════════════════════════════════════════════════════

  const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  async function exportDOCX(doc, ctx) {
    const lang = doc.lang === "as" ? "as-IN" : "bn-IN";
    const rels = [];       // { id, type, target, external }
    const media = [];      // { name, bytes }
    const nums = [];       // { numId, abstractId, start }
    let relSeq = 10, picSeq = 0;
    const addRel = (type, target, external) => {
      const id = "rId" + ++relSeq;
      rels.push({ id, type, target, external });
      return id;
    };
    const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";

    // Abstract numberings: one per ordered format / bullet character.
    const abstracts = new Map(); // key → { id, fmt, text, font }
    function abstractFor(ordered, style) {
      const key = (ordered ? "o:" : "b:") + style;
      if (!abstracts.has(key)) {
        let fmt = "bullet", text = bulletChar(style);
        if (ordered) {
          fmt = { decimal: "decimal", "lower-roman": "lowerRoman", "upper-roman": "upperRoman", "lower-alpha": "lowerLetter" }[style] || "decimal";
          text = "%1.";
        }
        abstracts.set(key, { id: abstracts.size, fmt, text });
      }
      return abstracts.get(key);
    }
    const numByList = new Map();
    function numFor(list, box) {
      if (!numByList.has(list.id)) {
        const ab = abstractFor(list.ordered, list.ordered ? box.olStyle : box.ulStyle);
        const numId = nums.length + 1;
        nums.push({ numId, abstractId: ab.id, start: list.n });
        numByList.set(list.id, numId);
      }
      return numByList.get(list.id);
    }

    function rPr(r) {
      const sz = int((r.size || 12) * 2);
      let x = `<w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}" w:eastAsia="${esc(r.font)}" w:cs="${esc(r.font)}"/>`;
      if (r.b) x += "<w:b/><w:bCs/>";
      if (r.i) x += "<w:i/><w:iCs/>";
      if (r.caps === "uppercase") x += "<w:caps/>";
      if (r.caps === "smallcaps") x += "<w:smallCaps/>";
      if (r.s) x += "<w:strike/>";
      if (r.color && r.color !== "#000000") x += `<w:color w:val="${r.color.slice(1).toUpperCase()}"/>`;
      if (r.letter) x += `<w:spacing w:val="${r.letter}"/>`;
      x += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
      if (r.bg) x += `<w:shd w:val="clear" w:color="auto" w:fill="${r.bg.slice(1).toUpperCase()}"/>`;
      if (r.u) x += '<w:u w:val="single"/>';
      if (r.sup) x += '<w:vertAlign w:val="superscript"/>';
      if (r.sub) x += '<w:vertAlign w:val="subscript"/>';
      x += `<w:lang w:val="en-US" w:bidi="${lang}"/>`;
      return "<w:rPr>" + x + "</w:rPr>";
    }

    function runXml(r, extra) {
      if (r.br) return "<w:r><w:br/></w:r>";
      const parts = r.t.split("\t");
      const body = parts.map((p, i) => (i ? "<w:tab/>" : "") + (p ? `<w:t xml:space="preserve">${esc(p)}</w:t>` : "")).join("");
      return `<w:r>${rPr(Object.assign({}, r, extra))}${body}</w:r>`;
    }

    function runsXml(runs, extra) {
      let out = "", i = 0;
      while (i < runs.length) {
        const r = runs[i];
        const href = !r.br && r.href && /^(https?:|mailto:|tel:)/i.test(r.href) ? r.href : null;
        if (!href) { out += runXml(r, extra); i++; continue; }
        const id = addRel(REL + "hyperlink", href, true);
        out += `<w:hyperlink r:id="${id}" w:history="1">`;
        while (i < runs.length && !runs[i].br && runs[i].href === r.href) {
          out += runXml(runs[i], Object.assign({ u: true, color: runs[i].color === "#000000" ? "#0563c1" : runs[i].color }, extra));
          i++;
        }
        out += "</w:hyperlink>";
      }
      return out;
    }

    const JC = { left: "left", center: "center", right: "right", justify: "both" };

    function paraXml(p, box, opts) {
      opts = opts || {};
      let ppr = "";
      let runs = p.runs.slice();
      let indL = box.indentLeft || 0, indFirst = box.indentFirst || 0;
      if (p.list) {
        const step = 6.35; // mm per level
        indL += step * (p.list.level + 1);
        indFirst = -step;
        const native = p.list.ordered && !["decimal", "lower-roman", "upper-roman", "lower-alpha"].includes(box.olStyle);
        if (native) {
          // Word has no Bengali-digit numbering; write the number as text.
          const f = runs.find((r) => !r.br) || baseFormat(box);
          runs.unshift(Object.assign({}, f, { t: olMarker(box.olStyle, p.list.n) + "\t", href: null, u: false, s: false }));
        } else {
          ppr += `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numFor(p.list, box)}"/></w:numPr>`;
        }
      }
      const lh = Math.max(0.5, +box.lineHeight || 1.2);
      ppr += `<w:spacing w:before="${twip(opts.noSpace ? 0 : box.spaceBefore)}" w:after="${twip(opts.noSpace ? 0 : box.spaceAfter)}" w:line="${int(lh * 240)}" w:lineRule="auto"/>`;
      const ind = [];
      if (indL) ind.push(`w:left="${twip(indL)}"`);
      if (box.indentRight) ind.push(`w:right="${twip(box.indentRight)}"`);
      if (indFirst > 0) ind.push(`w:firstLine="${twip(indFirst)}"`);
      if (indFirst < 0) ind.push(`w:hanging="${twip(-indFirst)}"`);
      if (ind.length) ppr += `<w:ind ${ind.join(" ")}/>`;
      ppr += `<w:jc w:val="${JC[p.align] || "left"}"/>`;
      // The paragraph mark carries the first run's look; Word draws list numbers with it.
      const markFmt = Object.assign({}, runs.find((r) => !r.br) || baseFormat(box, opts.over));
      Object.assign(markFmt, { u: false, s: false, sup: false, sub: false, bg: null });
      ppr += rPr(markFmt);
      const letter = box.letterSpacing ? int(box.letterSpacing * PT_PER_PX * 20) : 0;
      return `<w:p><w:pPr>${opts.pageBreak ? "<w:pageBreakBefore/>" : ""}${ppr}</w:pPr>${runsXml(runs, letter ? { letter } : null)}</w:p>`;
    }

    async function imageXml(box, contentW, m, pageBreak) {
      const img = await loadImage(box.imgSrc);
      if (!img) return "";
      const fit = fitImage(box, img);
      let w = box.imgFit === "contain" || !box.imgFit ? fit.w : box.w;
      let h = box.imgFit === "contain" || !box.imgFit ? fit.h : box.h;
      if (w > contentW) { h *= contentW / w; w = contentW; }
      const name = `image${++picSeq}.${img.ext}`;
      media.push({ name, bytes: img.bytes });
      const rid = addRel(REL + "image", "media/" + name);
      const left = Math.max(0, Math.min(box.x - m.left, contentW - w));
      const id = picSeq;
      const drawing =
        `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(w)}" cy="${emu(h)}"/>` +
        `<wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
        `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
        `<pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
        `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      return `<w:p><w:pPr>${pageBreak ? "<w:pageBreakBefore/>" : ""}<w:spacing w:before="0" w:after="120"/>${left > 1 ? `<w:ind w:left="${twip(left)}"/>` : ""}</w:pPr>${drawing}</w:p>`;
    }

    function tableXml(box, contentW) {
      const { cols, rows } = sizes(box);
      const tw = Math.min(box.w, contentW);
      const bw = Math.max(0, +box.borderWidth || 0);
      const bc = (hex(box.borderColor) || "#000000").slice(1).toUpperCase();
      const border = (side) => bw > 0
        ? `<w:${side} w:val="single" w:sz="${Math.max(2, int(bw * PT_PER_PX * 8))}" w:space="0" w:color="${bc}"/>`
        : `<w:${side} w:val="nil"/>`;
      const pad = int((+box.cellPadding || 0) * PT_PER_PX * 20);
      let x = `<w:tbl><w:tblPr><w:tblW w:w="${twip(tw)}" w:type="dxa"/>` +
        `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
        `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="${pad}" w:type="dxa"/><w:left w:w="${pad}" w:type="dxa"/>` +
        `<w:bottom w:w="${pad}" w:type="dxa"/><w:right w:w="${pad}" w:type="dxa"/></w:tblCellMar>` +
        `<w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>`;
      x += cols.map((f) => `<w:gridCol w:w="${twip(f * tw)}"/>`).join("") + "</w:tblGrid>";
      const cellBox = Object.assign({}, box, { spaceBefore: 0, spaceAfter: 0, indentLeft: 0, indentRight: 0, indentFirst: 0 });
      for (let r = 0; r < box.rows; r++) {
        x += `<w:tr><w:trPr><w:trHeight w:val="${twip(rows[r] * box.h)}" w:hRule="atLeast"/></w:trPr>`;
        for (let c = 0; c < box.cols; c++) {
          const cell = cellAt(box, r, c);
          const fill = hex(cell.bgColor);
          const va = { middle: "center", bottom: "bottom" }[cell.valign] || "top";
          x += `<w:tc><w:tcPr><w:tcW w:w="${twip(cols[c] * tw)}" w:type="dxa"/>` +
            (fill && fill !== "#ffffff" ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill.slice(1).toUpperCase()}"/>` : "") +
            `<w:vAlign w:val="${va}"/></w:tcPr>`;
          const cb = Object.assign({}, cellBox, { lineHeight: cell.lineHeight || box.lineHeight });
          const paras = parseRich(cell.text, box, cellOver(box, cell));
          if (!paras.length) paras.push({ align: cell.align || "left", runs: [] });
          x += paras.map((p) => paraXml(p, cb, { noSpace: true })).join("");
          x += "</w:tc>";
        }
        x += "</w:tr>";
      }
      return x + "</w:tbl>";
    }

    // Body
    const BREAK_TINY = '<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>';
    const m0 = ctx.margins(0);
    const contentW = doc.pageW - m0.left - m0.right;
    let body = "";
    const pages = collect(doc);
    for (let i = 0; i < pages.length; i++) {
      const { items, prev } = pages[i];
      let pageBreak = i > 0;
      const m = ctx.margins(i);
      for (const box of items) {
        if (box.type === "text") {
          if (prev.has(box.id)) continue;
          const paras = parseRich(box.text, box);
          for (const p of paras) {
            body += paraXml(p, box, { pageBreak });
            pageBreak = false;
          }
        } else if (box.type === "image") {
          const x = await imageXml(box, contentW, m, pageBreak);
          if (x) { body += x; pageBreak = false; }
        } else if (box.type === "table") {
          if (pageBreak) { body += BREAK_TINY; pageBreak = false; }
          body += tableXml(box, contentW);
          body += '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>';
        }
      }
      if (pageBreak) body += "<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>"; // an empty page
    }
    if (!body) body = "<w:p/>";

    // Header / footer (page numbers become Word PAGE / NUMPAGES fields).
    const hfFont = firstFont(doc.hfFont) || FALLBACK_FONT;
    const pnStyle = (doc.pageNumber && doc.pageNumber.style) || "native";
    const fieldFmt = pnStyle === "roman-lower" ? " \\* roman" : pnStyle === "roman-upper" ? " \\* ROMAN" : "";
    function templateRuns(text, size, color) {
      const f = { font: hfFont, size: size || 9, color: hex(color) || "#766b58" };
      text = String(text || "");
      if (pnStyle === "native" || pnStyle === "words") {
        // Same wording as on screen: "Page {page} of {total}" → "{total} এর পৃষ্ঠা {page}".
        const ofWord = doc.lang === "as" ? "ৰ" : "এর";
        if (/Page\s*\{page\}\s*of\s*\{total\}/i.test(text)) text = `{total} ${ofWord} পৃষ্ঠা {page}`;
        else text = text.replace(/\bPage\b(?![^{]*\})/gi, "পৃষ্ঠা").replace(/\bof\b(?![^{]*\})/gi, ofWord);
      }
      let out = "";
      const re = /\{(page|total|পৃষ্ঠা|মোট)\}/gi;
      let last = 0, mm;
      while ((mm = re.exec(text))) {
        if (mm.index > last) out += runXml(Object.assign({ t: text.slice(last, mm.index) }, f));
        const isTotal = /total|মোট/i.test(mm[1]);
        out += `<w:fldSimple w:instr=" ${isTotal ? "NUMPAGES" : "PAGE"}${fieldFmt} \\* MERGEFORMAT ">${runXml(Object.assign({ t: "1" }, f))}</w:fldSimple>`;
        last = re.lastIndex;
      }
      if (last < text.length) out += runXml(Object.assign({ t: text.slice(last) }, f));
      return out;
    }
    const hfAlign = (a) => ({ left: "left", right: "right", inside: "left", outside: "right" }[a] || "center");
    function hfPara(text, cfg, rule) {
      const border = rule ? `<w:pBdr><w:${rule} w:val="single" w:sz="4" w:space="1" w:color="auto"/></w:pBdr>` : "";
      return `<w:p><w:pPr>${border}<w:spacing w:before="0" w:after="0"/><w:jc w:val="${hfAlign(cfg.align)}"/></w:pPr>${templateRuns(text, cfg.size, cfg.color)}</w:p>`;
    }
    const pn = doc.pageNumber || {};
    const pnTop = (pn.position || "bottom-center").startsWith("top");
    const pnCfg = { align: (pn.position || "bottom-center").split("-")[1], size: pn.size, color: doc.footer.color };
    function hfBody(which, first) {
      const cfg = doc[which];
      let x = "";
      if (cfg.enabled && cfg.text && (!first || cfg.showOnFirst)) x += hfPara(cfg.text, cfg, cfg.rule ? (which === "header" ? "bottom" : "top") : null);
      if (pn.enabled && pnTop === (which === "header")) x += hfPara(pn.format || "{page}", pnCfg, null);
      return x;
    }
    const hfParts = [];
    const needTitlePg = (doc.header.enabled && !doc.header.showOnFirst) || (doc.footer.enabled && !doc.footer.showOnFirst);
    let sectRefs = "";
    for (const which of ["header", "footer"]) {
      const variants = [["default", false]];
      if (needTitlePg) variants.push(["first", true]);
      for (const [type, first] of variants) {
        const content = hfBody(which, first);
        if (!content && !needTitlePg) continue;
        const name = `${which}${hfParts.length + 1}.xml`;
        const tag = which === "header" ? "w:hdr" : "w:ftr";
        hfParts.push({ name, which, xml: `${XML_HEAD}<${tag} ${W_NS}>${content || "<w:p/>"}</${tag}>` });
        const id = addRel(REL + which, name);
        sectRefs += `<w:${which}Reference w:type="${type}" r:id="${id}"/>`;
      }
    }

    const W = twip(doc.pageW), H = twip(doc.pageH);
    const sect = `<w:sectPr>${sectRefs}<w:pgSz w:w="${W}" w:h="${H}"${doc.pageW > doc.pageH ? ' w:orient="landscape"' : ""}/>` +
      `<w:pgMar w:top="${twip(m0.top)}" w:right="${twip(m0.right)}" w:bottom="${twip(m0.bottom)}" w:left="${twip(m0.left)}" ` +
      `w:header="${twip(Math.max(4, m0.top / 2.5))}" w:footer="${twip(Math.max(4, (pn.offset || 8)))}" w:gutter="0"/>` +
      (pn.startAt && pn.startAt !== 1 ? `<w:pgNumType w:start="${int(pn.startAt)}"/>` : "") +
      (needTitlePg ? "<w:titlePg/>" : "") + "</w:sectPr>";
    const documentXml = `${XML_HEAD}<w:document ${W_NS}><w:body>${body}${sect}</w:body></w:document>`;

    const bodyFont = FALLBACK_FONT;
    const stylesXml = `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/>` +
      `<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:bidi="${lang}"/></w:rPr></w:rPrDefault>` +
      `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
      `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>` +
      `<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
      `</w:styles>`;

    let numberingXml = `${XML_HEAD}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`;
    for (const ab of abstracts.values()) {
      numberingXml += `<w:abstractNum w:abstractNumId="${ab.id}"><w:multiLevelType w:val="singleLevel"/>` +
        `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${ab.fmt}"/><w:lvlText w:val="${esc(ab.text)}"/><w:lvlJc w:val="left"/>` +
        `<w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>`;
    }
    for (const n of nums) {
      numberingXml += `<w:num w:numId="${n.numId}"><w:abstractNumId w:val="${n.abstractId}"/>` +
        `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${n.start}"/></w:lvlOverride></w:num>`;
    }
    numberingXml += "</w:numbering>";

    const settingsXml = `${XML_HEAD}<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:defaultTabStop w:val="720"/><w:compat><w:doNotExpandShiftReturn/><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

    addRel(REL + "styles", "styles.xml");
    addRel(REL + "settings", "settings.xml");
    addRel(REL + "numbering", "numbering.xml");
    const docRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("") +
      "</Relationships>";

    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const coreXml = `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${esc(doc.title || "")}</dc:title><dc:creator>Lekhoni</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;

    const ct = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>` +
      `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
      hfParts.map((h) => `<Override PartName="/word/${h.name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${h.which}+xml"/>`).join("") +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

    const rootRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}officeDocument" Target="word/document.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `</Relationships>`;

    const files = [
      { name: "[Content_Types].xml", data: ct },
      { name: "_rels/.rels", data: rootRels },
      { name: "docProps/core.xml", data: coreXml },
      { name: "word/document.xml", data: documentXml },
      { name: "word/styles.xml", data: stylesXml },
      { name: "word/settings.xml", data: settingsXml },
      { name: "word/numbering.xml", data: numberingXml },
      { name: "word/_rels/document.xml.rels", data: docRels },
      ...hfParts.map((h) => ({ name: "word/" + h.name, data: h.xml })),
      ...media.map((m) => ({ name: "word/media/" + m.name, data: m.bytes, store: true })),
    ];
    const zip = await makeZip(files);
    return new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Adobe InDesign (.idml)
  // ═════════════════════════════════════════════════════════════════════

  const PKG = 'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0"';
  const IDML_HEAD = XML_HEAD;
  const COMPOSER = "$ID/HL Composer Optyca"; // Adobe World-Ready Paragraph Composer (Indic shaping)

  async function exportIDML(doc, ctx) {
    let seq = 0;
    const nid = (p) => "u" + (p || "") + (++seq).toString(16);
    const W = pt(doc.pageW), H = pt(doc.pageH);
    const colors = new Map(); // "#rrggbb" → Self
    function color(h) {
      h = hex(h);
      if (!h) return "Swatch/None";
      if (h === "#000000") return "Color/Black";
      if (!colors.has(h)) colors.set(h, "Color/c_" + h.slice(1));
      return colors.get(h);
    }
    const stories = [];   // { self, xml }
    const spreads = [];   // { self, xml }
    const pStyleId = (st) => "ParagraphStyle/lk_" + String(st.id).replace(/[^\w-]/g, "_");

    // ── Text → story XML ──
    const JUST = { left: "LeftAlign", center: "CenterAlign", right: "RightAlign", justify: "LeftJustified" };
    const NUM_FMT = { decimal: "1, 2, 3, 4...", "lower-roman": "i, ii, iii, iv...", "upper-roman": "I, II, III, IV...", "lower-alpha": "a, b, c, d..." };

    function charRange(r, box, brAfter) {
      let a = `AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"`;
      const style = r.b && r.i ? "Bold Italic" : r.b ? "Bold" : r.i ? "Italic" : "Regular";
      a += ` FontStyle="${style}" PointSize="${r2(r.size)}" FillColor="${color(r.color)}"`;
      if (r.u) a += ` Underline="true"`;
      if (r.s) a += ` StrikeThru="true"`;
      if (r.sup) a += ` Position="Superscript"`;
      if (r.sub) a += ` Position="Subscript"`;
      if (r.caps === "uppercase") a += ` Capitalization="AllCaps"`;
      if (r.caps === "smallcaps") a += ` Capitalization="SmallCaps"`;
      if (box.letterSpacing) a += ` Tracking="${int((box.letterSpacing * PT_PER_PX / r.size) * 1000)}"`;
      const leading = r2(r.size * Math.max(0.5, +box.lineHeight || 1.2));
      let content = "";
      if (r.t != null) content = `<Content>${esc(r.t).replace(/\t/g, "&#9;")}</Content>`;
      if (brAfter) content += "<Br/>";
      return `<CharacterStyleRange ${a}><Properties><Leading type="unit">${leading}</Leading>` +
        `<AppliedFont type="string">${esc(r.font)}</AppliedFont></Properties>${content}</CharacterStyleRange>`;
    }

    function paraRange(p, box, last, opts) {
      opts = opts || {};
      const st = box.styleId && doc.styles.find((s) => s.id === box.styleId);
      let a = `AppliedParagraphStyle="${st ? pStyleId(st) : "ParagraphStyle/$ID/NormalParagraphStyle"}"`;
      a += ` Justification="${JUST[p.align] || "LeftAlign"}" Composer="${COMPOSER}"`;
      let left = box.indentLeft || 0, first = box.indentFirst || 0;
      let runs = p.runs.slice();
      let props = "";
      if (p.list) {
        left += 6.35 * (p.list.level + 1);
        first = -6.35;
        const fmt = p.list.ordered ? NUM_FMT[box.olStyle] : null;
        if (p.list.ordered && !fmt) {
          const f = runs.find((r) => !r.br) || baseFormat(box);
          runs.unshift(Object.assign({}, f, { t: olMarker(box.olStyle, p.list.n) + "\t", u: false, s: false }));
          a += ` BulletsAndNumberingListType="NoList"`;
        } else if (p.list.ordered) {
          a += ` BulletsAndNumberingListType="NumberedList" NumberingExpression="^#.^t" NumberingContinue="${p.list.first ? "false" : "true"}" NumberingStartAt="${p.list.n}"`;
          props += `<NumberingFormat type="string">${fmt}</NumberingFormat>`;
        } else {
          a += ` BulletsAndNumberingListType="BulletList" BulletsTextAfter="^t"`;
          props += `<BulletChar BulletCharacterType="UnicodeOnly" BulletCharacterValue="${bulletChar(box.ulStyle).codePointAt(0)}"/>`;
        }
      } else {
        a += ` BulletsAndNumberingListType="NoList"`;
      }
      a += ` LeftIndent="${pt(left)}" FirstLineIndent="${pt(first)}" RightIndent="${pt(box.indentRight)}"`;
      if (!opts.noSpace) a += ` SpaceBefore="${pt(box.spaceBefore)}" SpaceAfter="${pt(box.spaceAfter)}"`;
      else a += ` SpaceBefore="0" SpaceAfter="0"`;
      a += ` Hyphenation="${box.hyphenate ? "true" : "false"}"`;
      if (p.dropChars && box.dropCap > 1) a += ` DropCapLines="${int(box.dropCap)}" DropCapCharacters="${p.dropChars}"`;
      if (opts.rule === "below") a += ` RuleBelow="true" RuleBelowLineWeight="0.5" RuleBelowOffset="3" RuleBelowColor="${color(opts.ruleColor)}"`;
      if (opts.rule === "above") a += ` RuleAbove="true" RuleAboveLineWeight="0.5" RuleAboveOffset="${r2((opts.size || 9) + 3)}" RuleAboveColor="${color(opts.ruleColor)}"`;

      // Line breaks inside a paragraph are U+2028 in InDesign.
      const merged = [];
      for (const r of runs) {
        const lastR = merged[merged.length - 1];
        if (r.br) {
          if (lastR) lastR.t += " ";
          else merged.push(Object.assign(baseFormat(box), { t: " " }));
        } else if (lastR && sameFmt(lastR, r)) lastR.t += r.t;
        else merged.push(Object.assign({}, r));
      }
      if (!merged.length) merged.push(Object.assign(baseFormat(box, opts.over), { t: null }));
      const body = merged.map((r, i) => charRange(r, box, !last && i === merged.length - 1)).join("");
      return `<ParagraphStyleRange ${a}>${props ? `<Properties>${props}</Properties>` : ""}${body}</ParagraphStyleRange>`;
    }

    function storyXml(self, inner) {
      return `${IDML_HEAD}<idPkg:Story ${PKG}><Story Self="${self}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">` +
        `<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>` +
        `${inner}</Story></idPkg:Story>`;
    }

    function addStory(paras, box, opts) {
      const self = nid("st");
      if (!paras.length) paras = [{ align: box.align || "left", runs: [] }];
      const inner = paras.map((p, i) => paraRange(p, box, i === paras.length - 1, opts)).join("");
      stories.push({ self, xml: storyXml(self, inner) });
      return self;
    }

    function tableStory(box) {
      const self = nid("st");
      const tself = nid("tb");
      const { cols, rows } = sizes(box);
      const bw = r2(Math.max(0, +box.borderWidth || 0) * PT_PER_PX);
      const bc = color(box.borderColor || "#000000");
      const pad = r2((+box.cellPadding || 0) * PT_PER_PX);
      let t = `<Table Self="${tself}" HeaderRowCount="0" FooterRowCount="0" BodyRowCount="${box.rows}" ColumnCount="${box.cols}" ` +
        `AppliedTableStyle="TableStyle/$ID/[Basic Table]" TableDirection="LeftToRightDirection">`;
      for (let r = 0; r < box.rows; r++) t += `<Row Self="${tself}Row${r}" Name="${r}" SingleRowHeight="${pt(rows[r] * box.h)}" MinimumHeight="3" AutoGrow="true"/>`;
      for (let c = 0; c < box.cols; c++) t += `<Column Self="${tself}Column${c}" Name="${c}" SingleColumnWidth="${pt(cols[c] * box.w)}"/>`;
      const cellBox = Object.assign({}, box, { spaceBefore: 0, spaceAfter: 0, indentLeft: 0, indentRight: 0, indentFirst: 0, dropCap: 0 });
      for (let r = 0; r < box.rows; r++) {
        for (let c = 0; c < box.cols; c++) {
          const cell = cellAt(box, r, c);
          const va = { middle: "CenterAlign", bottom: "BottomAlign" }[cell.valign] || "TopAlign";
          const edge = (s) => `${s}EdgeStrokeWeight="${bw}" ${s}EdgeStrokeColor="${bw ? bc : "Swatch/None"}" ${s}EdgeStrokeType="StrokeStyle/$ID/Solid"`;
          t += `<Cell Self="${tself}i${c}:${r}" Name="${c}:${r}" RowSpan="1" ColumnSpan="1" AppliedCellStyle="CellStyle/$ID/[None]" AppliedCellStylePriority="0" ` +
            `FillColor="${color(cell.bgColor) === "Swatch/None" ? "Swatch/None" : color(cell.bgColor)}" ` +
            `TopInset="${pad}" LeftInset="${pad}" BottomInset="${pad}" RightInset="${pad}" VerticalJustification="${va}" ` +
            `${edge("Top")} ${edge("Left")} ${edge("Bottom")} ${edge("Right")}>`;
          const cb = Object.assign({}, cellBox, { lineHeight: cell.lineHeight || box.lineHeight });
          const over = cellOver(box, cell);
          let paras = parseRich(cell.text, box, over);
          if (!paras.length) paras = [{ align: over.align, runs: [] }];
          t += paras.map((p, i) => paraRange(p, cb, i === paras.length - 1, { noSpace: true, over })).join("");
          t += "</Cell>";
        }
      }
      t += "</Table>";
      const inner = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle" Composer="${COMPOSER}">` +
        `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">${t}</CharacterStyleRange></ParagraphStyleRange>`;
      stories.push({ self, xml: storyXml(self, inner) });
      return self;
    }

    // ── Geometry ──
    // Spread coordinates: page spans x 0..W, y −H/2..H/2. Each item is drawn
    // in its own space centred on (0,0) and placed with ItemTransform.
    function transform(box) {
      const cx = pt(box.x + box.w / 2), cy = r2(pt(box.y + box.h / 2) - H / 2);
      const a = ((+box.rotation || 0) * Math.PI) / 180;
      const c = r2(Math.cos(a) * 1e4) / 1e4, s = r2(Math.sin(a) * 1e4) / 1e4;
      return `${c} ${s} ${-s} ${c} ${cx} ${cy}`;
    }
    const P = (x, y) => `<PathPointType Anchor="${r2(x)} ${r2(y)}" LeftDirection="${r2(x)} ${r2(y)}" RightDirection="${r2(x)} ${r2(y)}"/>`;
    function pathGeo(points, open) {
      return `<PathGeometry><GeometryPathType PathOpen="${open ? "true" : "false"}"><PathPointArray>${points}</PathPointArray></GeometryPathType></PathGeometry>`;
    }
    function rectPath(w, h) {
      const x = w / 2, y = h / 2;
      return pathGeo(P(-x, -y) + P(-x, y) + P(x, y) + P(x, -y));
    }
    function ovalPath(w, h) {
      const rx = w / 2, ry = h / 2, k = 0.5522847498;
      const pp = (ax, ay, lx, ly, rx2, ry2) => `<PathPointType Anchor="${r2(ax)} ${r2(ay)}" LeftDirection="${r2(lx)} ${r2(ly)}" RightDirection="${r2(rx2)} ${r2(ry2)}"/>`;
      return pathGeo(
        pp(0, -ry, k * rx, -ry, -k * rx, -ry) +
        pp(-rx, 0, -rx, -k * ry, -rx, k * ry) +
        pp(0, ry, -k * rx, ry, k * rx, ry) +
        pp(rx, 0, rx, k * ry, rx, -k * ry)
      );
    }
    function polyPath(list) { return pathGeo(list.map(([x, y]) => P(x, y)).join("")); }

    function common(box, layer) {
      let a = `ItemLayer="${layer}" ItemTransform="${transform(box)}"`;
      if (box.locked) a += ` Locked="true"`;
      return a;
    }
    function opacityXml(box) {
      const o = box.opacity == null ? 1 : +box.opacity;
      return o < 1 ? `<TransparencySetting><BlendingSetting Opacity="${r2(o * 100)}"/></TransparencySetting>` : "";
    }
    function wrapXml(box) {
      if (!box.wrap || box.wrap === "none") return "";
      const off = pt(box.wrapOffset || 0);
      const mode = box.wrap === "jump" ? "JumpObjectTextWrap" : box.wrap === "contour" && box.type === "shape" ? "Contour" : "BoundingBoxTextWrap";
      return `<TextWrapPreference Inverse="false" ApplyToMasterPageOnly="false" TextWrapSide="BothSides" TextWrapMode="${mode}">` +
        `<Properties><TextWrapOffset Top="${off}" Left="${off}" Bottom="${off}" Right="${off}"/></Properties>` +
        (mode === "Contour" ? `<ContourOption ContourType="GraphicFrame" IncludeInsideEdges="false" ContourPathName="$ID/"/>` : "") +
        `</TextWrapPreference>`;
    }
    function frameStroke(box) {
      const w = +box.frameBorderWidth || 0;
      return `FillColor="${box.frameFill ? color(box.frameFill) : "Swatch/None"}" StrokeWeight="${r2(w)}" StrokeColor="${w ? color(box.frameBorderColor) : "Swatch/None"}"`;
    }

    function textFrame(box, storySelf, layer, links, extraPref) {
      const self = links.selfOf(box.id);
      const inset = box.inset == null ? [4, 0, 2, 0] : [box.inset, box.inset, box.inset, box.inset];
      const va = { middle: "CenterAlign", bottom: "BottomAlign" }[box.valign] || "TopAlign";
      const cols = Math.max(1, Math.round(box.columns || 1));
      return `<TextFrame Self="${self}" ParentStory="${storySelf}" PreviousTextFrame="${links.prev(box.id)}" NextTextFrame="${links.next(box)}" ` +
        `ContentType="TextType" ${common(box, layer)} ${frameStroke(box)} AppliedObjectStyle="ObjectStyle/$ID/[Normal Text Frame]">` +
        `<Properties>${rectPath(pt(box.w), pt(box.h))}</Properties>${opacityXml(box)}${wrapXml(box)}` +
        `<TextFramePreference TextColumnCount="${cols}" TextColumnGutter="${pt(box.columnGap ?? 5)}" VerticalJustification="${va}"` +
        `${box.ignoreWrap ? ' IgnoreWrap="true"' : ""}${extraPref || ""}>` +
        `<Properties><InsetSpacing type="list">${inset.map((v) => `<ListItem type="unit">${pt(v)}</ListItem>`).join("")}</InsetSpacing></Properties>` +
        `</TextFramePreference></TextFrame>`;
    }

    async function imageFrame(box, layer) {
      const img = await loadImage(box.imgSrc);
      const w = pt(box.w), h = pt(box.h);
      let inner = "";
      if (img) {
        const fit = fitImage(box, img);
        // Picture coordinates: 1 px = 1 pt, then scaled into the frame.
        const sx = r2((pt(fit.w) / img.w) * 1e4) / 1e4, sy = r2((pt(fit.h) / img.h) * 1e4) / 1e4;
        const tx = r2(-w / 2 + pt(fit.x)), ty = r2(-h / 2 + pt(fit.y));
        inner = `<Image Self="${nid("im")}" ItemTransform="${sx} 0 0 ${sy} ${tx} ${ty}">` +
          `<Properties><GraphicBounds Left="0" Top="0" Right="${img.w}" Bottom="${img.h}"/>` +
          `<Contents><![CDATA[${b64(img.bytes)}]]></Contents></Properties></Image>`;
      }
      return `<Rectangle Self="${nid("r")}" ContentType="GraphicType" ${common(box, layer)} ${frameStroke(box)} AppliedObjectStyle="ObjectStyle/$ID/[Normal Graphics Frame]">` +
        `<Properties>${rectPath(w, h)}</Properties>${opacityXml(box)}${wrapXml(box)}${inner}</Rectangle>`;
    }

    function shapeItem(box, layer) {
      const w = pt(box.w), h = pt(box.h);
      const sw = r2(Math.max(0, +box.strokeWidth || 0));
      const dash = box.dash || (box.strokeDasharray && box.strokeDasharray !== "none" ? "dashed" : "solid");
      const stype = dash === "dashed" ? "StrokeStyle/$ID/Dashed" : dash === "dotted" ? "StrokeStyle/$ID/Canned Dotted" : "StrokeStyle/$ID/Solid";
      const type = box.shapeType === "polygon" ? "triangle" : box.shapeType === "ellipse" ? "circle" : box.shapeType;
      const stroke = `StrokeWeight="${sw}" StrokeColor="${sw ? color(box.strokeColor || "#000000") : "Swatch/None"}" StrokeType="${stype}"`;
      const fill = `FillColor="${type === "line" ? "Swatch/None" : color(box.fillColor)}"`;
      const head = `Self="${nid("sh")}" ContentType="Unassigned" ${common(box, layer)} ${fill} ${stroke} AppliedObjectStyle="ObjectStyle/$ID/[None]"`;
      const tail = opacityXml(box) + wrapXml(box);
      const x = w / 2, y = h / 2;
      switch (type) {
        case "circle":
          return `<Oval ${head}><Properties>${ovalPath(w, h)}</Properties>${tail}</Oval>`;
        case "triangle":
          return `<Polygon ${head}><Properties>${polyPath([[0, -y], [x, y], [-x, y]])}</Properties>${tail}</Polygon>`;
        case "diamond":
          return `<Polygon ${head}><Properties>${polyPath([[0, -y], [x, 0], [0, y], [-x, 0]])}</Properties>${tail}</Polygon>`;
        case "star": {
          const n = Math.max(3, Math.min(24, Math.round(+box.starPoints || 5)));
          const list = [];
          for (let i = 0; i < n * 2; i++) {
            const k = i % 2 === 0 ? 1 : 0.4, ang = (i * Math.PI) / n - Math.PI / 2;
            list.push([x * k * Math.cos(ang), y * k * Math.sin(ang)]);
          }
          return `<Polygon ${head}><Properties>${polyPath(list)}</Properties>${tail}</Polygon>`;
        }
        case "line": {
          const dir = box.lineDir || "up";
          let a = [-x, y], b = [x, -y];
          if (dir === "down") { a = [-x, -y]; b = [x, y]; }
          else if (dir === "h") { a = [-x, 0]; b = [x, 0]; }
          else if (dir === "v") { a = [0, -y]; b = [0, y]; }
          const ends = box.lineEnds || "none";
          const le = ends === "start" || ends === "both" ? "TriangleArrowHead" : "None";
          const re = ends === "end" || ends === "both" ? "TriangleArrowHead" : "None";
          return `<GraphicLine ${head} LeftLineEnd="${le}" RightLineEnd="${re}"><Properties>${pathGeo(P(a[0], a[1]) + P(b[0], b[1]), true)}</Properties>${tail}</GraphicLine>`;
        }
        default: {
          const rad = Math.max(0, Math.min(+box.radius || 0, Math.min(box.w, box.h) / 2));
          const corners = rad > 0 ? ["TopLeft", "TopRight", "BottomLeft", "BottomRight"].map((c) => ` ${c}CornerOption="RoundedCorner" ${c}CornerRadius="${pt(rad)}"`).join("") : "";
          return `<Rectangle ${head}${corners}><Properties>${rectPath(w, h)}</Properties>${tail}</Rectangle>`;
        }
      }
    }

    // Frame ids for threaded text, so every frame knows its neighbours.
    const frameSelf = new Map();
    const prevOf = new Map();
    for (const p of doc.pages) for (const b of p.boxes) {
      if (b.type === "text") frameSelf.set(b.id, nid("tf"));
      if (b.type === "text" && b.next) prevOf.set(b.next, b.id);
    }
    const links = {
      selfOf: (id) => frameSelf.get(id),
      prev: (id) => (prevOf.has(id) ? frameSelf.get(prevOf.get(id)) : "n"),
      next: (b) => (b.next && frameSelf.has(b.next) ? frameSelf.get(b.next) : "n"),
    };
    const storyOfFrame = new Map();
    for (const p of doc.pages) for (const b of p.boxes) {
      if (b.type !== "text" || prevOf.has(b.id)) continue;
      const self = addStory(parseRich(b.text, b), b);
      for (let x = b, guard = 0; x && guard++ < 1000; x = x.next ? findBox(doc, x.next) : null) storyOfFrame.set(x.id, self);
    }

    const layer = "ulayer1";
    const pageSelves = [];
    const pnCfg = doc.pageNumber || {};
    for (let i = 0; i < doc.pages.length; i++) {
      const page = doc.pages[i];
      const m = ctx.margins(i);
      const spSelf = nid("sp"), pgSelf = nid("pg");
      pageSelves.push(pgSelf);
      let items = "";
      // Page colour under everything.
      const bg = hex(doc.pageBg);
      if (bg && bg !== "#ffffff") {
        items += shapeItem({ x: 0, y: 0, w: doc.pageW, h: doc.pageH, shapeType: "rectangle", fillColor: bg, strokeWidth: 0, locked: true }, layer);
      }
      for (const box of page.boxes) {
        let x = "";
        if (box.type === "text") x = textFrame(box, storyOfFrame.get(box.id), layer, links);
        else if (box.type === "image") x = await imageFrame(box, layer);
        else if (box.type === "shape") x = shapeItem(box, layer);
        else if (box.type === "table") {
          const st = tableStory(box);
          const tbox = Object.assign({}, box, { inset: 0, columns: 1, valign: "top", frameFill: null, frameBorderWidth: 0 });
          const id = nid("tf");
          x = textFrame(tbox, st, layer, { selfOf: () => id, prev: () => "n", next: () => "n" });
        }
        if (x && box.hidden) x = x.replace(/^<(\w+) /, '<$1 Visible="false" ');
        items += x;
      }
      // Header, footer and page number as ordinary text frames (exact text, native digits).
      if (!page.skipHF) {
        const hfBox = (y, h, cfg, valign) => Object.assign(
          { fontFamily: doc.hfFont, fontSize: cfg.size || 9, color: cfg.color || "#766B58", align: ctx.sideAlign(cfg.align, i), lineHeight: 1.2 },
          { x: m.left, y, w: doc.pageW - m.left - m.right, h, inset: 0, valign, columns: 1, rotation: 0, type: "text" });
        const hf = (cfg, text, top) => {
          const box = top ? hfBox(0, m.top, cfg, cfg.rule ? "bottom" : "middle") : hfBox(doc.pageH - m.bottom, m.bottom, cfg, cfg.rule ? "top" : "middle");
          if (cfg.rule) { if (top) box.h = m.top - 3; else { box.y += 3; box.h -= 3; } }
          const p = { align: box.align, runs: [Object.assign(baseFormat(box), { t: text })] };
          const st = addStory([p], box, { rule: cfg.rule ? (top ? "below" : "above") : null, ruleColor: cfg.color || "#766B58", size: cfg.size, noSpace: true });
          const id = nid("tf");
          return textFrame(box, st, layer, { selfOf: () => id, prev: () => "n", next: () => "n" });
        };
        if (doc.header.enabled && doc.header.text && (i !== 0 || doc.header.showOnFirst)) items += hf(doc.header, ctx.fill(doc.header.text, i), true);
        if (doc.footer.enabled && doc.footer.text && (i !== 0 || doc.footer.showOnFirst)) items += hf(doc.footer, ctx.fill(doc.footer.text, i), false);
        if (pnCfg.enabled) {
          const [vert, hside] = (pnCfg.position || "bottom-center").split("-");
          const size = pnCfg.size || 9, hMm = (size * 1.6) / PT_PER_MM, off = pnCfg.offset ?? 8;
          const y = vert === "top" ? off : doc.pageH - off - hMm;
          const box = {
            type: "text", x: m.left, y, w: doc.pageW - m.left - m.right, h: hMm, inset: 0, columns: 1, rotation: 0, valign: "top",
            fontFamily: doc.hfFont, fontSize: size, color: doc.footer.color || "#766B58", align: ctx.sideAlign(hside, i), lineHeight: 1.2,
          };
          const p = { align: box.align, runs: [Object.assign(baseFormat(box), { t: ctx.fill(pnCfg.format || "{page}", i) })] };
          const st = addStory([p], box, { noSpace: true });
          const id = nid("tf");
          items += textFrame(box, st, layer, { selfOf: () => id, prev: () => "n", next: () => "n" });
        }
      }
      const cols = Math.max(1, doc.columns || 1);
      const inner = doc.pageW - m.left - m.right;
      const colW = (inner - (doc.columnGap || 0) * (cols - 1)) / cols;
      const positions = [];
      for (let c = 0; c < cols; c++) {
        const x0 = c * (colW + (doc.columnGap || 0));
        positions.push(pt(x0), pt(x0 + colW));
      }
      const xml = `${IDML_HEAD}<idPkg:Spread ${PKG}><Spread Self="${spSelf}" PageCount="1" BindingLocation="0" AllowPageShuffle="true" ShowMasterItems="true" ` +
        `ItemTransform="1 0 0 1 0 ${r2(i * (H + 36))}" FlattenerOverride="Default">` +
        `<Page Self="${pgSelf}" Name="${i + 1}" AppliedMaster="umaster" OverrideList="" TabOrder="" GridStartingPoint="TopOutside" UseMasterGrid="true" ` +
        `GeometricBounds="0 0 ${H} ${W}" ItemTransform="1 0 0 1 0 ${r2(-H / 2)}" MasterPageTransform="1 0 0 1 0 0">` +
        `<MarginPreference ColumnCount="${cols}" ColumnGutter="${pt(doc.columnGap || 0)}" Top="${pt(m.top)}" Bottom="${pt(m.bottom)}" Left="${pt(m.left)}" Right="${pt(m.right)}" ` +
        `ColumnDirection="Horizontal" ColumnsPositions="${positions.join(" ")}"/></Page>${items}</Spread></idPkg:Spread>`;
      spreads.push({ self: spSelf, xml });
    }

    // ── Resources ──
    const m0 = ctx.margins(0);
    const master = `${IDML_HEAD}<idPkg:MasterSpread ${PKG}><MasterSpread Self="umaster" ItemTransform="1 0 0 1 0 0" Name="A-Master" NamePrefix="A" BaseName="Master" ShowMasterItems="true" PageCount="1" OverriddenPageItemProps="">` +
      `<Page Self="umasterpg" Name="A" AppliedMaster="n" OverrideList="" TabOrder="" GridStartingPoint="TopOutside" UseMasterGrid="true" ` +
      `GeometricBounds="0 0 ${H} ${W}" ItemTransform="1 0 0 1 0 ${r2(-H / 2)}" MasterPageTransform="1 0 0 1 0 0">` +
      `<MarginPreference ColumnCount="1" ColumnGutter="${pt(doc.columnGap || 0)}" Top="${pt(m0.top)}" Bottom="${pt(m0.bottom)}" Left="${pt(m0.left)}" Right="${pt(m0.right)}" ColumnDirection="Horizontal" ColumnsPositions="0 ${pt(doc.pageW - m0.left - m0.right)}"/>` +
      `</Page></MasterSpread></idPkg:MasterSpread>`;

    const defFont = firstFont((doc.styles.find((s) => s.id === "st-body") || {}).props?.fontFamily) || FALLBACK_FONT;
    let pstyles = `<ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" Imported="false" Composer="${COMPOSER}" PointSize="12" FillColor="Color/Black">` +
      `<Properties><AppliedFont type="string">${esc(defFont)}</AppliedFont><Leading type="enumeration">Auto</Leading></Properties></ParagraphStyle>` +
      `<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" Imported="false" NextStyle="ParagraphStyle/$ID/NormalParagraphStyle" Composer="${COMPOSER}">` +
      `<Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><PreviewColor type="enumeration">Nothing</PreviewColor></Properties></ParagraphStyle>`;
    for (const st of doc.styles) {
      const p = st.props || {};
      const fs = p.bold && p.italic ? "Bold Italic" : p.bold ? "Bold" : p.italic ? "Italic" : "Regular";
      pstyles += `<ParagraphStyle Self="${pStyleId(st)}" Name="${esc(st.name)}" Imported="false" NextStyle="${pStyleId(st)}" Composer="${COMPOSER}" ` +
        `PointSize="${r2(+p.fontSize || 12)}" FontStyle="${fs}" FillColor="${color(p.color)}" Justification="${JUST[p.align] || "LeftAlign"}" ` +
        `FirstLineIndent="${pt(p.indentFirst)}" LeftIndent="${pt(p.indentLeft)}" RightIndent="${pt(p.indentRight)}" SpaceBefore="${pt(p.spaceBefore)}" SpaceAfter="${pt(p.spaceAfter)}"` +
        `${p.underline ? ' Underline="true"' : ""}${p.strike ? ' StrikeThru="true"' : ""}>` +
        `<Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn>` +
        `<AppliedFont type="string">${esc(firstFont(p.fontFamily) || defFont)}</AppliedFont>` +
        `<Leading type="unit">${r2((+p.fontSize || 12) * (+p.lineHeight || 1.2))}</Leading></Properties></ParagraphStyle>`;
    }
    const styles = `${IDML_HEAD}<idPkg:Styles ${PKG}>` +
      `<RootCharacterStyleGroup Self="ucsg"><CharacterStyle Self="CharacterStyle/$ID/[No character style]" Imported="false" Name="$ID/[No character style]"/></RootCharacterStyleGroup>` +
      `<RootParagraphStyleGroup Self="upsg">${pstyles}</RootParagraphStyleGroup>` +
      `<RootCellStyleGroup Self="ucellsg"><CellStyle Self="CellStyle/$ID/[None]" Name="$ID/[None]" AppliedParagraphStyle="ParagraphStyle/$ID/[No paragraph style]"/></RootCellStyleGroup>` +
      `<RootTableStyleGroup Self="utsg"><TableStyle Self="TableStyle/$ID/[No table style]" Name="$ID/[No table style]"/>` +
      `<TableStyle Self="TableStyle/$ID/[Basic Table]" Name="$ID/[Basic Table]"><Properties><BasedOn type="string">$ID/[No table style]</BasedOn></Properties></TableStyle></RootTableStyleGroup>` +
      `<RootObjectStyleGroup Self="uosg"><ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]"/>` +
      `<ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]"><Properties><BasedOn type="string">$ID/[None]</BasedOn></Properties></ObjectStyle>` +
      `<ObjectStyle Self="ObjectStyle/$ID/[Normal Text Frame]" Name="$ID/[Normal Text Frame]"><Properties><BasedOn type="string">$ID/[None]</BasedOn></Properties></ObjectStyle>` +
      `</RootObjectStyleGroup></idPkg:Styles>`;

    let graphic = `${IDML_HEAD}<idPkg:Graphic ${PKG}>` +
      `<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Specialblack" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Black" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>` +
      `<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Specialpaper" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Paper" ColorEditable="true" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>` +
      `<Color Self="Color/Registration" Model="Registration" Space="CMYK" ColorValue="100 100 100 100" ColorOverride="Specialregistration" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Registration" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>`;
    for (const [h, self] of colors) {
      const v = [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
      graphic += `<Color Self="${self}" Model="Process" Space="RGB" ColorValue="${v.join(" ")}" ColorOverride="Normal" AlternateSpace="NoAlternateColor" AlternateColorValue="" ` +
        `Name="R=${v[0]} G=${v[1]} B=${v[2]}" ColorEditable="true" ColorRemovable="true" Visible="true" SwatchCreatorID="7937"/>`;
    }
    graphic += `<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>` +
      `<StrokeStyle Self="StrokeStyle/$ID/Solid" Name="$ID/Solid"/><StrokeStyle Self="StrokeStyle/$ID/Dashed" Name="$ID/Dashed"/>` +
      `<StrokeStyle Self="StrokeStyle/$ID/Canned Dotted" Name="$ID/Canned Dotted"/></idPkg:Graphic>`;

    const bleed = pt(doc.bleed || 0);
    const prefs = `${IDML_HEAD}<idPkg:Preferences ${PKG}>` +
      `<DocumentPreference PageHeight="${H}" PageWidth="${W}" PagesPerDocument="${doc.pages.length}" FacingPages="false" ` +
      `DocumentBleedTopOffset="${bleed}" DocumentBleedBottomOffset="${bleed}" DocumentBleedInsideOrLeftOffset="${bleed}" DocumentBleedOutsideOrRightOffset="${bleed}" DocumentBleedUniformSize="true" ` +
      `SlugBottomOffset="0" SlugTopOffset="0" SlugInsideOrLeftOffset="0" SlugRightOrOutsideOffset="0" DocumentSlugUniformSize="false" ` +
      `PreserveLayoutWhenShuffling="true" AllowPageShuffle="true" OverprintBlack="true" ColumnDirection="Horizontal" Intent="PrintIntent" PageBinding="LeftToRight"/>` +
      `<MarginPreference ColumnCount="${Math.max(1, doc.columns || 1)}" ColumnGutter="${pt(doc.columnGap || 0)}" Top="${pt(m0.top)}" Bottom="${pt(m0.bottom)}" Left="${pt(m0.left)}" Right="${pt(m0.right)}" ColumnDirection="Horizontal" ColumnsPositions="0 ${pt(doc.pageW - m0.left - m0.right)}"/>` +
      `<ViewPreference HorizontalMeasurementUnits="Millimeters" VerticalMeasurementUnits="Millimeters"/>` +
      `</idPkg:Preferences>`;

    const fonts = `${IDML_HEAD}<idPkg:Fonts ${PKG}></idPkg:Fonts>`;
    const tags = `${IDML_HEAD}<idPkg:Tags ${PKG}><XMLTag Self="XMLTag/Root" Name="Root"><Properties><TagColor type="enumeration">LightBlue</TagColor></Properties></XMLTag></idPkg:Tags>`;
    const backing = `${IDML_HEAD}<idPkg:BackingStory ${PKG}><XmlStory Self="ubackingstory" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">` +
      `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"/></ParagraphStyleRange>` +
      `</XmlStory></idPkg:BackingStory>`;

    const designmap = `${IDML_HEAD}<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="8.0(370)" ?>\n` +
      `<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0" Self="d" ` +
      `StoryList="${stories.map((s) => s.self).join(" ")}" Name="${esc((doc.title || "Untitled") + ".indd")}" ZeroPoint="0 0" ActiveLayer="${layer}" ` +
      `CMYKProfile="Coated FOGRA39 (ISO 12647-2:2004)" RGBProfile="sRGB IEC61966-2.1" SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" ` +
      `DefaultImageIntent="UseColorSettings" RGBPolicy="PreserveEmbeddedProfiles" CMYKPolicy="CombinationOfPreserveAndSafeCmyk" AccurateLABSpots="false">` +
      `<idPkg:Graphic src="Resources/Graphic.xml"/><idPkg:Fonts src="Resources/Fonts.xml"/><idPkg:Styles src="Resources/Styles.xml"/>` +
      `<idPkg:Preferences src="Resources/Preferences.xml"/><idPkg:Tags src="XML/Tags.xml"/>` +
      `<Layer Self="${layer}" Name="Layer 1" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true">` +
      `<Properties><LayerColor type="enumeration">LightBlue</LayerColor></Properties></Layer>` +
      `<idPkg:MasterSpread src="MasterSpreads/MasterSpread_umaster.xml"/>` +
      spreads.map((s) => `<idPkg:Spread src="Spreads/Spread_${s.self}.xml"/>`).join("") +
      `<Section Self="usection1" Length="${doc.pages.length}" Name="" ContinueNumbering="false" IncludeSectionPrefix="false" PageNumberStyle="Arabic" ` +
      `PageStart="${pageSelves[0]}" SectionPrefix="" PageNumberStart="${int((doc.pageNumber && doc.pageNumber.startAt) || 1)}" Marker="">` +
      `<Properties><Label/></Properties></Section>` +
      `<idPkg:BackingStory src="XML/BackingStory.xml"/>` +
      stories.map((s) => `<idPkg:Story src="Stories/Story_${s.self}.xml"/>`).join("") +
      `</Document>`;

    const container = `${XML_HEAD}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
      `<rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles></container>`;

    const files = [
      { name: "mimetype", data: "application/vnd.adobe.indesign-idml-package", store: true },
      { name: "designmap.xml", data: designmap },
      { name: "META-INF/container.xml", data: container },
      { name: "Resources/Graphic.xml", data: graphic },
      { name: "Resources/Fonts.xml", data: fonts },
      { name: "Resources/Styles.xml", data: styles },
      { name: "Resources/Preferences.xml", data: prefs },
      { name: "MasterSpreads/MasterSpread_umaster.xml", data: master },
      ...spreads.map((s) => ({ name: `Spreads/Spread_${s.self}.xml`, data: s.xml })),
      ...stories.map((s) => ({ name: `Stories/Story_${s.self}.xml`, data: s.xml })),
      { name: "XML/BackingStory.xml", data: backing },
      { name: "XML/Tags.xml", data: tags },
    ];
    const zip = await makeZip(files);
    return new Blob([zip], { type: "application/vnd.adobe.indesign-idml-package" });
  }

  function findBox(doc, id) {
    for (const p of doc.pages) for (const b of p.boxes) if (b.id === id) return b;
    return null;
  }

  // ── Saving the file ──────────────────────────────────────────────────

  const FORMATS = {
    docx: { run: exportDOCX, ext: ".docx", desc: "Microsoft Word document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    idml: { run: exportIDML, ext: ".idml", desc: "Adobe InDesign markup (IDML)", mime: "application/vnd.adobe.indesign-idml-package" },
    txt: { run: async (d, c) => exportTXT(d, c), ext: ".txt", desc: "Plain text", mime: "text/plain" },
  };

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  }

  /** Build the file in `format` ("docx" | "idml" | "txt"); returns a Blob. */
  async function build(format, doc, ctx) {
    const f = FORMATS[format];
    if (!f) throw new Error("Unknown format " + format);
    listSeq = 0;
    return f.run(doc, ctx);
  }

  /**
   * Ask where to save first (the picker needs the click that started this),
   * then build and write. Returns false if the person cancelled.
   */
  async function saveAs(format, doc, ctx, baseName) {
    const f = FORMATS[format];
    const name = (baseName || "Untitled") + f.ext;
    let handle = null;
    if ("showSaveFilePicker" in window) {
      try {
        handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: f.desc, accept: { [f.mime]: [f.ext] } }] });
      } catch (err) {
        if (err.name === "AbortError") return false;
        handle = null; // picker unavailable here: fall back to a download
      }
    }
    const blob = await build(format, doc, ctx);
    if (handle) {
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      download(blob, name);
    }
    return true;
  }

  window.LekhoniSaveAs = { build, saveAs, formats: Object.keys(FORMATS) };
})();
