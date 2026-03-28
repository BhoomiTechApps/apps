let jsonData = [];
let selectedIndex = null;
let dirty = false;
let fileHandle = null;
let directoryHandle = null;
let columnVisibility = {}; 

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 });
const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 });
const map = L.map("map", { center: [20, 0], zoom: 2, layers: [osm], zoomControl: false });
L.control.zoom({ position: "bottomright" }).addTo(map);
L.control.layers({ "Street": osm, "Satellite": satellite }, null, { position: "topright" }).addTo(map);
const marker = L.marker([0, 0]).addTo(map);
const geocoder = L.Control.geocoder({
  defaultMarkGeocode: false,
  position: 'topleft'
}).on('markgeocode', function(e) {
  const latlng = e.geocode.center;
  map.setView(latlng, 16);
  if (selectedIndex !== null && !jsonData[selectedIndex].locked) {
    updateCoords(latlng.lat, latlng.lng);
  } else if (selectedIndex !== null && jsonData[selectedIndex].locked) {
    flashToolbar("Map moved, but row is LOCKED - Coords not updated.");
  }
}).addTo(map);

map.on("click", e => {
  if(selectedIndex === null || jsonData[selectedIndex].locked) return;
  const lt = e.latlng.lat.toFixed(6);
  const lg = e.latlng.lng.toFixed(6);
  jsonData[selectedIndex].lat = lt;
  jsonData[selectedIndex].lng = lg;
  dirty = true;
  updateMap(selectedIndex);
  const row = document.querySelector(`tr[data-index="${selectedIndex}"]`);
  if(row) {
    renderTable(); 
  }
});

async function initNewProject() {
  try {
    directoryHandle = await window.showDirectoryPicker();
    await directoryHandle.getDirectoryHandle("images", { create: true });
    await directoryHandle.getDirectoryHandle("thumbs", { create: true });
    fileHandle = await directoryHandle.getFileHandle("data.json", { create: true });
    jsonData = [{ id: Date.now(), name: "New", image: "", thumb: "", lat: "0", lng: "0", description: "", locked: false }];
    await saveJson();
    renderTable();
  } catch (e) {}
}

async function openProject() {
  try {
    directoryHandle = await window.showDirectoryPicker();
    fileHandle = await directoryHandle.getFileHandle("data.json");
    jsonData = JSON.parse(await (await fileHandle.getFile()).text());
    renderTable();
  } catch (e) { alert("Invalid Project Folder"); }
}

async function saveJson() {
  if (!fileHandle) return;
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(jsonData, null, 2));
  await writable.close();
  dirty = false;
  flashToolbar("Saved ✓");
}

function toggleColumn(key) {
  columnVisibility[key] = !columnVisibility[key];
  renderTable(); 
}

function showAllColumns() {
  Object.keys(columnVisibility).forEach(k => columnVisibility[k] = true);
  renderTable();
}

function renderTable() {
  const container = document.getElementById("table-container");
  if (!jsonData.length) return;
  
  const keys = Object.keys(jsonData[0]).filter(k => k !== 'locked');
  keys.forEach(k => { if(columnVisibility[k] === undefined) columnVisibility[k] = true; });

  let html = `<table><thead><tr><th><i class="fa-solid fa-lock"></i></th>`;
  keys.forEach(k => {
    if (columnVisibility[k]) {
      html += `<th><div class="header-cell"><span>${k}</span><button class="toggle-btn" onclick="toggleColumn('${k}')"><i class="fa-solid fa-eye-slash"></i></button></div></th>`;
    }
  });
  html += `</tr></thead><tbody>`;

  jsonData.forEach((row, i) => {
    const isLocked = row.locked ? 'locked-row' : '';
    const isSelected = (i === selectedIndex) ? 'selected' : '';
    html += `<tr class="${isSelected} ${isLocked}" onclick="selectRow(${i}, false)" data-index="${i}">`;
    html += `<td style="text-align:center;"><input type="checkbox" ${row.locked ? 'checked' : ''} onclick="event.stopPropagation(); toggleLock(${i}, this.checked)"></td>`;
    keys.forEach(k => {
      if (columnVisibility[k]) {
        const editable = row.locked ? "false" : "true";
        html += `<td contenteditable="${editable}" 
                     oninput="updateCell(${i},'${k}',this.innerText)">
                     ${row[k] || ""}
                 </td>`;
      }
    });
    html += "</tr>";
  });
  container.innerHTML = html + "</tbody></table>";
}

function updateCell(i, k, val) {
  jsonData[i][k] = val;
  dirty = true;
}

function selectRow(index, redraw = true) {
  selectedIndex = index;
  document.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
  const row = document.querySelector(`tr[data-index="${index}"]`);
  if(row) row.classList.add('selected');
  updatePreview(index);
  if(redraw) renderTable(); 
}

function toggleLock(i, checked) {
  jsonData[i].locked = checked;
  dirty = true;
  renderTable();
}

async function updatePreview(i) {
  const row = jsonData[i];
  const imgBox = document.getElementById("imagePreview");
  if (row.image && directoryHandle) {
    try {
      const parts = row.image.split('/');
      const dH = await directoryHandle.getDirectoryHandle(parts[0]);
      const fH = await dH.getFileHandle(parts[1]);
      imgBox.innerHTML = `<img src="${URL.createObjectURL(await fH.getFile())}">`;
    } catch(e) { imgBox.innerHTML = "Image error"; }
  } else { imgBox.innerHTML = "No Image"; }
  updateMap(i);
}

function updateMap(i) {
  const row = jsonData[i];
  if(row.lat && row.lng) {
    const pos = [parseFloat(row.lat), parseFloat(row.lng)];
    marker.setLatLng(pos); map.setView(pos, 16);
  }
}

async function replaceMainImage() {
  if(selectedIndex === null || jsonData[selectedIndex].locked) return alert("Select an unlocked row");
  try {
    const [h] = await window.showOpenFilePicker();
    const f = await h.getFile();
    const d = await directoryHandle.getDirectoryHandle("images", {create:true});
    const dest = await d.getFileHandle(f.name, {create:true});
    const w = await dest.createWritable();
    await w.write(await f.arrayBuffer()); await w.close();
    const tBlob = await createThumbnail(f, 100);
    const tD = await directoryHandle.getDirectoryHandle("thumbs", {create:true});
    const tDest = await tD.getFileHandle(f.name, {create:true});
    const tW = await tDest.createWritable();
    await tW.write(tBlob); await tW.close();
    jsonData[selectedIndex].image = `images/${f.name}`;
    jsonData[selectedIndex].thumb = `thumbs/${f.name}`;
    renderTable(); 
    updatePreview(selectedIndex);
  } catch(e){}
}

function createThumbnail(file, size = 100) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.getElementById('canvas-buffer');
        const ctx = canvas.getContext('2d');
        canvas.width = size;
        canvas.height = size;
        const scale = Math.max(size / img.width, size / img.height);
        const x = (size / 2) - (img.width / 2) * scale;
        const y = (size / 2) - (img.height / 2) * scale;
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function addRow() { 
  jsonData.push({ id: Date.now(), name: "", image: "", thumb: "", lat: "0", lng: "0", description: "", locked: false }); 
  renderTable(); 
}

function deleteRow() {
  if (selectedIndex !== null && confirm("Delete?")) {
    jsonData.splice(selectedIndex, 1);
    selectedIndex = null;
    renderTable();
  }
}

function flashToolbar(text) {
  const bar = document.getElementById("toolbar");
  const msg = document.createElement("span");
  msg.textContent = text;
  msg.style.cssText = "color:#4caf50; margin-left:10px; font-weight:bold; font-size:12px;";
  bar.appendChild(msg);
  setTimeout(() => msg.remove(), 2000);
}
