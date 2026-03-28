if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('../sw.js')
      .then(reg => console.log('Service Worker registered', reg))
      .catch(err => console.error('Service Worker failed', err));
  });
}

let jsonData = [];
let selectedIndex = null;
let map, marker;
let fileHandle = null;

function initMap() {
    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 });
    const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}");
    map = L.map("map", { 
        center: [20, 0], 
        zoom: 2, 
        zoomControl: false, 
        layers: [osm] 
    });
    L.control.layers({ "Street": osm, "Satellite": satellite }, null, { position: 'topright' }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    const geocoder = L.Control.geocoder({
        defaultMarkGeocode: false,
        placeholder: "Search location...",
        position: 'topleft'
    }).on('markgeocode', function(e) {
        const latlng = e.geocode.center;
        map.setView(latlng, 16);
        updateCurrentRowCoords(latlng.lat, latlng.lng);
    }).addTo(map);
    addLocateControl();
    marker = L.marker([0, 0]).addTo(map);
    map.on("click", e => {
        updateCurrentRowCoords(e.latlng.lat, e.latlng.lng);
    });
}

function addLocateControl() {
    const locateBtn = L.control({ position: 'topleft' });
    locateBtn.onAdd = function() {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        const a = L.DomUtil.create('a', '', div);
        a.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i>';
        a.style.cursor = 'pointer';
        a.onclick = () => map.locate({ setView: true, maxZoom: 16 });
        return div;
    };
    locateBtn.addTo(map);
    map.on('locationfound', e => updateCurrentRowCoords(e.latlng.lat, e.latlng.lng));
}

function updateCurrentRowCoords(lat, lng) {
    if (selectedIndex === null || jsonData[selectedIndex].locked) return;
    const lt = lat.toFixed(6);
    const lg = lng.toFixed(6);
    jsonData[selectedIndex].lat = lt;
    jsonData[selectedIndex].lng = lg;
    const row = document.querySelector(`tr[data-index="${selectedIndex}"]`);
    if (row) {
        row.cells[3].innerText = lt;
        row.cells[4].innerText = lg;
    }
    updateMap(selectedIndex);
}

function renderTable() {
    const container = document.getElementById("table-container");
    if (!jsonData.length) {
        container.innerHTML = "<p style='padding:20px; color:#555;'>Add a video to begin.</p>";
        return;
    }
    let html = `<table><thead><tr><th><i class="fa-solid fa-lock"></i></th><th>Title</th><th>YouTube ID</th><th>Lat</th><th>Lng</th><th>Notes</th></tr></thead><tbody>`;
    jsonData.forEach((row, i) => {
        const sel = i === selectedIndex ? 'selected' : '';
        const lck = row.locked ? 'locked-row' : '';
        const editable = !row.locked;
        html += `<tr class="${sel} ${lck}" onclick="selectRow(${i}, false)" data-index="${i}">
            <td style="text-align:center">
                <input type="checkbox" ${row.locked ? 'checked' : ''} onclick="event.stopPropagation(); toggleLock(${i})">
            </td>
            <td contenteditable="${editable}" oninput="jsonData[${i}].title=this.innerText">${row.title || ""}</td>
            <td contenteditable="${editable}" oninput="jsonData[${i}].youtubeId=this.innerText">${row.youtubeId || ""}</td>
            <td contenteditable="${editable}" oninput="jsonData[${i}].lat=this.innerText">${row.lat || "0"}</td>
            <td contenteditable="${editable}" oninput="jsonData[${i}].lng=this.innerText">${row.lng || "0"}</td>
            <td contenteditable="${editable}" oninput="jsonData[${i}].notes=this.innerText">${row.notes || ""}</td>
        </tr>`;
    });
    container.innerHTML = html + "</tbody></table>";
}

function selectRow(index, redraw = false) {
    if (selectedIndex === index && !redraw) return;
    selectedIndex = index;
    document.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
    const row = document.querySelector(`tr[data-index="${index}"]`);
    if (row) row.classList.add('selected');
    if (redraw) renderTable();
    updatePreview(index);
}

function updateCurrentRowCoords(lat, lng) {
    if (selectedIndex === null || jsonData[selectedIndex].locked) return;
    const lt = lat.toFixed(6);
    const lg = lng.toFixed(6);
    jsonData[selectedIndex].lat = lt;
    jsonData[selectedIndex].lng = lg;
    const row = document.querySelector(`tr[data-index="${selectedIndex}"]`);
    if (row) {
        row.cells[3].innerText = lt;
        row.cells[4].innerText = lg;
    }
    updateMap(selectedIndex);
}

function toggleLock(i) {
    jsonData[i].locked = !jsonData[i].locked;
    renderTable();
}

function loadJson() {
    document.getElementById('fileInput').click();
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            if (Array.isArray(importedData)) {
                jsonData = importedData;
                selectedIndex = null; // Reset selection
                renderTable();
                flashStatus("Project Loaded ✓");
            } else {
                alert("Invalid JSON format. Expected an Array.");
            }
        } catch (err) {
            alert("Error parsing JSON file.");
        }
    };
    reader.readAsText(file);
}

function flashStatus(msg) {
    const status = document.getElementById("status-msg");
    status.innerText = msg;
    setTimeout(() => status.innerText = "", 3000);
}

function importYoutube() {
    const url = prompt("Paste YouTube URL:");
    if (!url) return;
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    const vId = (match && match[7].length == 11) ? match[7] : url;
    jsonData.push({ title: "Imported Video", youtubeId: vId, lat: "0", lng: "0", notes: "", locked: false });
    renderTable();
    selectRow(jsonData.length - 1, false);
}

function updatePreview(i) {
    const row = jsonData[i];
    const box = document.getElementById("videoPreview");
    if (row.youtubeId) {
        box.innerHTML = `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${row.youtubeId}" frameborder="0" allowfullscreen></iframe>`;
    } else {
        box.innerHTML = `<div class="placeholder-text">No Video ID</div>`;
    }
    updateMap(i);
}

function updateMap(i) {
    const row = jsonData[i];
    if (row.lat && row.lng) {
        const pos = [parseFloat(row.lat), parseFloat(row.lng)];
        marker.setLatLng(pos);
        marker.off('click');
        marker.on('click', () => {
            if (row.youtubeId) {
                openLightbox(row.youtubeId);
            } else {
                alert("No YouTube ID found for this marker.");
            }
        });
        if (map.getZoom() < 10) {
            map.setView(pos, 12);
        } else {
            map.panTo(pos);
        }
    }
}

async function exportJson() {
    if (jsonData.length === 0) return alert("Nothing to save!");
    try {
        if (!fileHandle) {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: 'geovid_playlist.json',
                types: [{
                    description: 'JSON Files',
                    accept: { 'application/json': ['.json'] },
                }],
            });
        }
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(jsonData, null, 2));
        await writable.close();
        flashStatus("File Updated ✓");
    } catch (err) {
        console.error("Save cancelled or failed", err);
        if (err.name === 'TypeError') {
            const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "geovid_playlist.json";
            a.click();
        }
    }
}

function openLightbox(vId) {
    if (!vId) return;
    const container = document.getElementById("lightbox-video-container");
    container.innerHTML = `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${vId}?autoplay=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    document.getElementById("lightbox").style.display = "flex";
}

function closeLightbox() {
    document.getElementById("lightbox").style.display = "none";
    document.getElementById("lightbox-video-container").innerHTML = "";
}

window.onload = () => { initMap(); renderTable(); };