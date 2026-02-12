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
    controlBox = document.createElement("div");
    controlBox.id = "fltrControls";
    controlBox.style.display = "flex";
    controlBox.style.flexWrap = "wrap";
    controlBox.style.gap = "6px";
    controlBox.style.padding = "10px";
    controlBox.style.border = "1px solid #ddd";
    controlBox.style.background = "#eaeaea";
    container.prepend(controlBox);
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.textContent = "Apply Filters";
    applyBtn.style.padding = "6px 12px";
    applyBtn.style.cursor = "pointer";
    applyBtn.style.fontSize = "12px";
    applyBtn.addEventListener("click", fltr_apply);
    controlBox.appendChild(applyBtn);
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
      lbl.textContent = label;
      wrapper.appendChild(lbl);
      if (allNumeric) {
        const nums = samples.map(v => extractNumber(v)).filter(n => !isNaN(n));
        const minVal = nums.length ? Math.min(...nums) : "";
        const maxVal = nums.length ? Math.max(...nums) : "";
        const rowDiv = document.createElement("div");
        rowDiv.style.display = "flex";
        rowDiv.style.gap = "4px";
        const minBox = document.createElement("input");
        minBox.type = "number";
        minBox.placeholder = "Min";
        minBox.style.padding = "4px";
        minBox.style.border = "1px solid #ccc";
        minBox.style.width = "70px";
        minBox.value = minVal !== "" ? minVal : "";
        minBox.defaultValue = minVal !== "" ? minVal : "";
        const maxBox = document.createElement("input");
        maxBox.type = "number";
        maxBox.placeholder = "Max";
        maxBox.style.padding = "4px";
        maxBox.style.border = "1px solid #ccc";
        maxBox.style.width = "70px";
        maxBox.value = maxVal !== "" ? maxVal : "";
        maxBox.defaultValue = maxVal !== "" ? maxVal : "";
        rowDiv.appendChild(minBox);
        rowDiv.appendChild(maxBox);
        wrapper.appendChild(rowDiv);
        currentControls.push({
          type: "numeric",
          col: colIndex,
          minEl: minBox,
          maxEl: maxBox
        });
      }
      else {
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "contains...";
        input.style.padding = "4px";
        input.style.border = "1px solid #ccc";
		input.style.width = "150px";
        wrapper.appendChild(input);
        currentControls.push({
          type: "text",
          col: colIndex,
          el: input
        });
      }
      controlBox.appendChild(wrapper);
    });
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
