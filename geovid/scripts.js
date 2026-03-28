if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered', reg))
      .catch(err => console.error('Service Worker failed', err));
  });
}

let jsonData = [];
let map, marker;

function initMap() {
    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { 
        maxZoom: 19, attribution: '© OSM' 
    });
    const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: 'Tiles © Esri'
    });
    map = L.map("map", { 
        center: [20, 0], 
        zoom: 2, 
        zoomControl: false,
        layers: [osm] // Default
    });
    const baseMaps = {
        "Street": osm,
        "Satellite": satellite
    };
    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);
    new L.Control.Geocoder({
        defaultMarkGeocode: false,
        placeholder: "Search location...",
        position: 'topleft'
    }).on('markgeocode', function(e) {
        const latlng = e.geocode.center;
        map.setView(latlng, 16);
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    marker = L.marker([0, 0]).addTo(map);
    map.on("click", e => {
    });
}

function loadJson() {
    document.getElementById('fileInput').click();
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        jsonData = JSON.parse(e.target.result);
        document.getElementById('project-name').innerText = file.name;
        renderList();
    };
    reader.readAsText(file);
}

function renderList() {
    const wrapper = document.getElementById('table-container'); 
    let html = `<table><thead><tr><th>Title</th><th>Notes</th></tr></thead><tbody>`;
    
    jsonData.forEach((row, i) => {
        html += `<tr onclick="selectVideo(${i})" id="row-${i}">
            <td>${row.title}</td>
            <td style="color:#888">${row.notes || ''}</td>
        </tr>`;
    });
    wrapper.innerHTML = html + `</tbody></table>`;
}

function selectVideo(i) {
    const row = jsonData[i];
    if (!row.lat || !row.lng) return;
    document.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
    document.getElementById(`row-${i}`).classList.add('selected');
    const pos = [parseFloat(row.lat), parseFloat(row.lng)];
    marker.setLatLng(pos);
    map.flyTo(pos, 14);
    marker.off('click');
    marker.on('click', () => openLightbox(row.youtubeId));
}

function openLightbox(vId) {
    if (!vId) return;
    const container = document.getElementById("lightbox-video-container");
    container.innerHTML = `<iframe src="https://www.youtube.com/embed/${vId}?autoplay=1&rel=0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    document.getElementById("lightbox").style.display = "flex";
}

function closeLightbox() {
    document.getElementById("lightbox").style.display = "none";
    document.getElementById("lightbox-video-container").innerHTML = "";
}

window.onload = initMap;