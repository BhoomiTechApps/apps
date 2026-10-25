/**
 * js/feature.js — Extended features for Bengali & Assamese Publisher PWA.
 * Includes configurable rulers (mm, cm, in), unit switcher, and 
 * PageMaker-style interactive drag-and-drop guide lines.
 */
(function () {
  "use strict";

  const UNITS = {
    mm: { label: "mm", mmPerUnit: 1, step: 10 },
    cm: { label: "cm", mmPerUnit: 10, step: 1 },
    in: { label: "in", mmPerUnit: 25.4, step: 1 }
  };

  class PublisherFeatures {
    constructor() {
      this.currentUnit = "mm";
      this.isRendering = false;
      this.activeGuideDrag = null;
      this.init();
    }

    // Helper getter/setter to sync guides directly with window.doc
    get guides() {
      if (window.doc) {
        if (!Array.isArray(window.doc.guides)) {
          window.doc.guides = [];
        }
        return window.doc.guides;
      }
      return [];
    }

    set guides(val) {
      if (window.doc) {
        window.doc.guides = val;
      }
    }

    init() {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => this.setupUI());
      } else {
        this.setupUI();
      }
      // app.js calls scheduleRender() whenever it redraws the page, so no
      // MutationObserver is needed (it used to fire on every keystroke).
      window.addEventListener("resize", () => this.scheduleRender());
      this.initGuideDragEvents();
    }

    setupUI() {
      if (document.getElementById("unit-selector")) return;
      const select = document.createElement("select");
      select.className = "tsel";
      select.id = "unit-selector";
      select.title = "Ruler units";
      select.innerHTML = `
          <option value="mm">Millimetres (mm)</option>
          <option value="cm">Centimetres (cm)</option>
          <option value="in">Inches (in)</option>`;
      const slot = document.getElementById("units-slot");
      if (slot) {
        slot.appendChild(select);
      } else {
        const toolbar = document.getElementById("toolbar");
        if (!toolbar) return;
        toolbar.appendChild(select);
      }
      select.value = this.currentUnit;
      select.addEventListener("change", (e) => this.setUnit(e.target.value));
      this.scheduleRender();
    }

    setUnit(unit) {
      if (!UNITS[unit]) return;
      this.currentUnit = unit;
      const selector = document.getElementById("unit-selector");
      if (selector) selector.value = unit;
      this.scheduleRender();
    }

    scheduleRender() {
      if (this.isRendering) return;
      this.isRendering = true;
      requestAnimationFrame(() => {
        this.renderRulers();
        this.renderGuides();
        this.isRendering = false;
      });
    }

    /**
     * Attaches rulers to current visible page
     */
    renderRulers() {
      const pageEl = document.querySelector(".page:not(.only-current-page-hidden)");
      if (!pageEl) return;


      let hRuler = pageEl.querySelector(".pub-ruler-h");
      if (!hRuler) {
        hRuler = document.createElement("div");
        hRuler.className = "pub-ruler pub-ruler-h";
        pageEl.appendChild(hRuler);
      }

      let vRuler = pageEl.querySelector(".pub-ruler-v");
      if (!vRuler) {
        vRuler = document.createElement("div");
        vRuler.className = "pub-ruler pub-ruler-v";
        pageEl.appendChild(vRuler);
      }

      hRuler.style.pointerEvents = "auto";
      hRuler.style.cursor = "ns-resize";
      hRuler.onpointerdown = (e) => this.startNewGuideDrag(e, "h");
      vRuler.style.pointerEvents = "auto";
      vRuler.style.cursor = "ew-resize";
      vRuler.onpointerdown = (e) => this.startNewGuideDrag(e, "v");

      const pageW_mm = window.doc?.pageW || parseFloat(pageEl.style.width) || 210;
      const pageH_mm = window.doc?.pageH || parseFloat(pageEl.style.height) || 297;

      const config = UNITS[this.currentUnit];
      const maxUnitsX = pageW_mm / config.mmPerUnit;
      const maxUnitsY = pageH_mm / config.mmPerUnit;

      // Ticks only need rebuilding when the unit or page size changed.
      const key = this.currentUnit + "|" + pageW_mm + "|" + pageH_mm;
      if (hRuler.dataset.key === key) return;
      hRuler.dataset.key = key;

      // Horizontal ruler
      hRuler.innerHTML = "";
      for (let i = 0; i <= maxUnitsX; i += config.step) {
        const pct = ((i * config.mmPerUnit) / pageW_mm) * 100;
        const mark = document.createElement("div");
        mark.className = "ruler-mark h-mark";
        mark.style.left = `${pct}%`;

        const label = document.createElement("span");
        label.className = "ruler-label";
        label.textContent = `${i}${i === 0 ? " " + config.label : ""}`;
        mark.appendChild(label);

        hRuler.appendChild(mark);
      }

      // Vertical ruler
      vRuler.innerHTML = "";
      for (let i = 0; i <= maxUnitsY; i += config.step) {
        const pct = ((i * config.mmPerUnit) / pageH_mm) * 100;
        const mark = document.createElement("div");
        mark.className = "ruler-mark v-mark";
        mark.style.top = `${pct}%`;

        const label = document.createElement("span");
        label.className = "ruler-label";
        label.textContent = `${i}${i === 0 ? " " + config.label : ""}`;
        mark.appendChild(label);

        vRuler.appendChild(mark);
      }
    }

    /**
     * Renders created guide lines on page
     */
    renderGuides() {
      const pageEl = document.querySelector(".page:not(.only-current-page-hidden)");
      if (!pageEl) return;

      // Remove existing rendered guides
      pageEl.querySelectorAll(".pub-guide").forEach((el) => el.remove());

      const pageW_mm = window.doc?.pageW || parseFloat(pageEl.style.width) || 210;
      const pageH_mm = window.doc?.pageH || parseFloat(pageEl.style.height) || 297;

      this.guides.forEach((guide) => {
        const el = document.createElement("div");
        el.className = `pub-guide pub-guide-${guide.orientation}`;
        el.dataset.id = guide.id;

        if (guide.orientation === "h") {
          const pct = (guide.posMM / pageH_mm) * 100;
          el.style.top = `${pct}%`;
        } else {
          const pct = (guide.posMM / pageW_mm) * 100;
          el.style.left = `${pct}%`;
        }

        el.onpointerdown = (e) => this.startExistingGuideDrag(e, guide);
        pageEl.appendChild(el);
      });
    }

    startNewGuideDrag(e, orientation) {
      e.stopPropagation();
      e.preventDefault();

      const newGuide = {
        id: "guide_" + Date.now(),
        orientation: orientation,
        posMM: -100
      };

      const currentGuides = [...this.guides, newGuide];
      this.guides = currentGuides;

      this.activeGuideDrag = { guide: newGuide, isNew: true };
      this.renderGuides();
      this.handleGuideMouseMove(e);
    }

    startExistingGuideDrag(e, guide) {
      e.stopPropagation();
      e.preventDefault();
      this.activeGuideDrag = { guide, isNew: false };
    }

    initGuideDragEvents() {
      window.addEventListener("pointermove", (e) => {
        if (this.activeGuideDrag) {
          this.handleGuideMouseMove(e);
        }
      });

      window.addEventListener("pointerup", () => {
        if (this.activeGuideDrag) {
          const { guide } = this.activeGuideDrag;
          const pageEl = document.querySelector(".page:not(.only-current-page-hidden)");

          if (pageEl) {
            const pageW_mm = window.doc?.pageW || parseFloat(pageEl.style.width) || 210;
            const pageH_mm = window.doc?.pageH || parseFloat(pageEl.style.height) || 297;

            // Remove guide if dragged back into ruler area or beyond page bounds
            const limit = guide.orientation === "h" ? pageH_mm : pageW_mm;
            if (guide.posMM <= 0 || guide.posMM >= limit) {
              this.guides = this.guides.filter((g) => g.id !== guide.id);
            }
          }

          this.activeGuideDrag = null;
          if (typeof window.scheduleSave === "function") {
            window.scheduleSave();
          }
          this.scheduleRender();
        }
      });
    }

    handleGuideMouseMove(e) {
      if (!this.activeGuideDrag) return;

      const pageEl = document.querySelector(".page:not(.only-current-page-hidden)");
      if (!pageEl) return;

      const rect = pageEl.getBoundingClientRect();
      const pageW_mm = window.doc?.pageW || parseFloat(pageEl.style.width) || 210;
      const pageH_mm = window.doc?.pageH || parseFloat(pageEl.style.height) || 297;

      const guide = this.activeGuideDrag.guide;

      if (guide.orientation === "h") {
        const offsetY_px = e.clientY - rect.top;
        const posMM = (offsetY_px / rect.height) * pageH_mm;
        guide.posMM = posMM;
      } else {
        const offsetX_px = e.clientX - rect.left;
        const posMM = (offsetX_px / rect.width) * pageW_mm;
        guide.posMM = posMM;
      }

      const el = pageEl.querySelector(`.pub-guide[data-id="${guide.id}"]`);
      if (!el) return this.renderGuides();
      if (guide.orientation === "h") el.style.top = (guide.posMM / pageH_mm) * 100 + "%";
      else el.style.left = (guide.posMM / pageW_mm) * 100 + "%";
    }
  }

  window.PublisherFeatures = new PublisherFeatures();
})();

/* ==========================================
   GUIDE SNAPPING UTILITY
   ========================================== */

/**
 * Snaps box positions to page margins & user guide lines.
 */
function snapToGuides(pos, guides = { horizontal: [], vertical: [] }, threshold = 3) {
  let snappedX = pos.x;
  let snappedY = pos.y;

  const boxRight = pos.x + pos.w;
  const boxBottom = pos.y + pos.h;

  // Vertical Snapping (X-axis)
  if (guides.vertical && guides.vertical.length > 0) {
    for (const guideX of guides.vertical) {
      if (Math.abs(pos.x - guideX) <= threshold) {
        snappedX = guideX;
        break;
      }
      if (Math.abs(boxRight - guideX) <= threshold) {
        snappedX = guideX - pos.w;
        break;
      }
    }
  }

  // Horizontal Snapping (Y-axis)
  if (guides.horizontal && guides.horizontal.length > 0) {
    for (const guideY of guides.horizontal) {
      if (Math.abs(pos.y - guideY) <= threshold) {
        snappedY = guideY;
        break;
      }
      if (Math.abs(boxBottom - guideY) <= threshold) {
        snappedY = guideY - pos.h;
        break;
      }
    }
  }

  return { x: snappedX, y: snappedY };
}

window.snapToGuides = snapToGuides;

/* ==========================================
   PROJECT FILE & PDF EXPORT FEATURES
   ========================================== */

(function () {
  "use strict";

  let activeFileHandle = null;

  async function saveProjectToFile(doc, suggestedName = "Untitled.pub") {
    const dataString = JSON.stringify(doc);

    if (!("showSaveFilePicker" in window)) {
      fallbackDownload(dataString, suggestedName);
      const note = document.getElementById("autosave-note");
      if (note) note.textContent = "Downloaded " + suggestedName;
      return;
    }

    try {
      if (!activeFileHandle) {
        activeFileHandle = await window.showSaveFilePicker({
          suggestedName: suggestedName,
          types: [{
            description: "Lekhoni Project File",
            accept: { "application/json": [".pub"] },
          }],
        });
      }

      const writable = await activeFileHandle.createWritable();
      await writable.write(dataString);
      await writable.close();

      const autosaveNote = document.getElementById("autosave-note");
      if (autosaveNote) autosaveNote.textContent = "Saved to file";
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Failed to save file:", err);
        alert("Could not save the file.");
      }
    }
  }

  async function openProjectFile(callback) {
    if (!("showOpenFilePicker" in window)) {
      // Firefox/Safari: use the hidden file input instead.
      const input = document.getElementById("project-input");
      if (!input) return;
      input.onchange = async () => {
        const file = input.files && input.files[0];
        input.value = "";
        if (!file) return;
        try {
          const loadedDoc = JSON.parse(await file.text());
          if (typeof callback === "function") callback(loadedDoc);
        } catch (err) {
          console.error("Failed to open file:", err);
          alert("Could not open project file.");
        }
      };
      input.click();
      return;
    }

    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{
          description: "Lekhoni Project File",
          accept: { "application/json": [".pub"] },
        }],
        multiple: false,
      });

      const file = await handle.getFile();
      const contents = await file.text();
      const loadedDoc = JSON.parse(contents);

      activeFileHandle = handle;

      if (typeof callback === "function") callback(loadedDoc);
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Failed to open file:", err);
        alert("Could not open project file.");
      }
    }
  }

  function closeProject(onCloseCallback) {
    if (confirm("Are you sure you want to close this project? Unsaved changes will be lost.")) {
      activeFileHandle = null;
      
      if (typeof onCloseCallback === "function") {
        onCloseCallback();
      }

      const autosaveNote = document.getElementById("autosave-note");
      if (autosaveNote) autosaveNote.textContent = "Closed";
    }
  }

  function fallbackDownload(content, filename) {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); // revoking at once can cancel the download
  }

  function saveAsPDF() {
    window.print();
  }

  window.saveProjectToFile = saveProjectToFile;
  window.openProjectFile = openProjectFile;
  window.closeProject = closeProject;
  window.saveAsPDF = saveAsPDF;
})();