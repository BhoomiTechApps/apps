(function () {
  let controlBox = null;
  let currentControls = [];

  function extractNumber(v) {
    if (v == null) return NaN;
    v = String(v).replace(/\u00A0/g, " ").replace(/,/g, "").trim().toLowerCase();
    if (v === "") return NaN;
    v = v
      .replace(/\s*km²$/g, "")
      .replace(/\s*km2$/g, "")
      .replace(/\s*km$/g, "")
      .replace(/\s*sq\.?\s*km$/g, "")
      .replace(/\s*sqkm$/g, "")
      .replace(/\s*m$/g, "");
    v = v.trim();
    if (v === "") return NaN;
    return parseFloat(v);
  }

  function isNumericWithUnits(v) {
    if (!v) return false;
    const s = String(v).trim().toLowerCase();
    if (s === "") return false;
    const rx = /^[-+]?\d+(\.\d+)?\s*(km|km2|km²|sq ?km|sq\. ?km|sqkm|m)?$/;
    if (!rx.test(s)) return false;
    return !isNaN(extractNumber(s));
  }

  function isURL(v) {
    if (!v) return false;
    v = String(v).trim().toLowerCase();
    return /^https?:\/\//.test(v) || /^www\./.test(v) ||
           /\.(com|org|net|io|gov|edu)(\/|$)/.test(v);
  }

  function fltr_build() {
    const container = document.getElementById("tableContainer");
    if (!container) return;
    const table = container.querySelector("table");
    if (!table) return;
    const thead = table.querySelector("thead");
    const rows = table.querySelectorAll("tbody tr");
    if (!thead || rows.length === 0) return;

    const headers = [...thead.querySelectorAll("th")];
    document.querySelectorAll("#fltrControls").forEach(n => n.remove());
    currentControls = [];

    // Initialize the main control box
    controlBox = document.createElement("div");
    controlBox.id = "fltrControls";
    controlBox.style.display = "flex";
    controlBox.style.flexWrap = "wrap";
    controlBox.style.gap = "10px";
    controlBox.style.padding = "10px";
    controlBox.style.border = "1px solid #ddd";
    controlBox.style.background = "#eaeaea";
    controlBox.style.alignItems = "flex-end"; 
    container.prepend(controlBox);

    headers.forEach((th, colIndex) => {
        const label = th.innerText.trim();
        if (!label) return;

        const samples = [...rows].map(r => {
            const cell = r.children[colIndex];
            return cell ? (cell.textContent || cell.innerText || "").trim() : "";
        });

        if (samples.some(isURL)) return;
        const nonEmpty = samples.filter(v => v !== "");
        if (nonEmpty.length === 0) return;

        const allNumeric = nonEmpty.every(isNumericWithUnits);
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.width = "170px";

        const lbl = document.createElement("label");
        lbl.style.fontSize = "12px";
        lbl.style.fontWeight = "600";
        lbl.style.marginBottom = "4px";
        lbl.textContent = label;
        wrapper.appendChild(lbl);

        if (allNumeric) {
            const rowDiv = document.createElement("div");
            rowDiv.style.display = "flex";
            rowDiv.style.gap = "4px";

            const minBox = document.createElement("input");
            minBox.type = "number";
            minBox.placeholder = "Min";
            minBox.style.padding = "4px";
            minBox.style.border = "1px solid #ccc";
            minBox.style.borderRadius = "4px";
            minBox.style.width = "75px";
            minBox.style.height = "28px";

            const maxBox = document.createElement("input");
            maxBox.type = "number";
            maxBox.placeholder = "Max";
            maxBox.style.padding = "4px";
            maxBox.style.border = "1px solid #ccc";
            maxBox.style.borderRadius = "4px";
            maxBox.style.width = "75px";
            maxBox.style.height = "28px";

            rowDiv.appendChild(minBox);
            rowDiv.appendChild(maxBox);
            wrapper.appendChild(rowDiv);
            currentControls.push({ type: "numeric", col: colIndex, minEl: minBox, maxEl: maxBox });
        } else {
            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = "contains...";
            input.style.padding = "4px";
            input.style.border = "1px solid #ccc";
            input.style.borderRadius = "4px";
            input.style.width = "150px";
            input.style.height = "28px";
            wrapper.appendChild(input);
            currentControls.push({ type: "text", col: colIndex, el: input });
        }
        controlBox.appendChild(wrapper);
    });

    const btnGroup = document.createElement("div");
    btnGroup.style.marginLeft = "auto"; 
    btnGroup.style.display = "flex";
    btnGroup.style.gap = "8px";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.title = "Reset All Filters";
    resetBtn.innerHTML = '<i class="fas fa-undo"></i>';
    resetBtn.style.width = "36px";
    resetBtn.style.height = "36px";
    resetBtn.style.cursor = "pointer";
    resetBtn.style.background = "#6c757d";
    resetBtn.style.color = "white";
    resetBtn.style.border = "none";
    resetBtn.style.borderRadius = "5px";
    resetBtn.onclick = () => {
        currentControls.forEach(ctrl => {
            if (ctrl.type === "text") ctrl.el.value = "";
            else { ctrl.minEl.value = ""; ctrl.maxEl.value = ""; }
        });
        fltr_apply();
    };

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.title = "Apply Filters";
    applyBtn.innerHTML = '<i class="fas fa-check"></i>';
    applyBtn.style.width = "36px";
    applyBtn.style.height = "36px";
    applyBtn.style.cursor = "pointer";
    applyBtn.style.background = "#28a745";
    applyBtn.style.color = "white";
    applyBtn.style.border = "none";
    applyBtn.style.borderRadius = "5px";
    applyBtn.onclick = fltr_apply;

    btnGroup.appendChild(resetBtn);
    btnGroup.appendChild(applyBtn);
    controlBox.appendChild(btnGroup);
}

  function fltr_apply() {
    const table = document.querySelector("#tableContainer table");
    if (!table) return;
    const rows = table.querySelectorAll("tbody tr");
    rows.forEach(row => {
      let visible = true;
      for (const ctrl of currentControls) {
        const cell = row.children[ctrl.col];
        const raw = cell ? (cell.textContent || cell.innerText || "").trim() : "";
        if (ctrl.type === "text") {
          const q = ctrl.el.value.trim().toLowerCase();
          if (q && !raw.toLowerCase().includes(q)) {
            visible = false;
            break;
          }
        }
        else if (ctrl.type === "numeric") {
          const minVal = ctrl.minEl.value.trim();
          const maxVal = ctrl.maxEl.value.trim();
          const hasMin = minVal !== "";
          const hasMax = maxVal !== "";
          if (!hasMin && !hasMax) continue;
          const num = extractNumber(raw);
          if (isNaN(num)) {
            visible = false;
            break;
          }
          if (hasMin && num < Number(minVal)) {
            visible = false;
            break;
          }
          if (hasMax && num > Number(maxVal)) {
            visible = false;
            break;
          }
        }
      }
      row.style.display = visible ? "" : "none";
    });
  }
  window.fltr_build = fltr_build;
})();
