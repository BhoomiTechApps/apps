const dbName = "GeoTagDB";
const storeName = "captures";
let map, marker;
let currentCoords = { lat: 0, lng: 0 };
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'images/marker-icon-2x.png',
    iconUrl: 'images/marker-icon.png',
    shadowUrl: 'images/marker-shadow.png',
});

const openDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 2);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath: "id" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};
const StreetViewControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function(map) {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-streetview');
        container.title = 'Open in Google Street View';
        container.innerHTML = `<img src="images/pegman.png" alt="SV" style="width:30px;height:30px;cursor:pointer;background:white;padding:2px;border-radius:4px;">`;
        container.onclick = function() {
            const lat = document.getElementById('lat').value;
            const lng = document.getElementById('lng').value;
            if (lat && lng && lat !== "0.000000") {
                const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
                window.open(url, '_blank');
            } else {
                alert("Please set a location on the map first.");
            }
        };
        return container;
    }
});
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const fileInput = document.createElement('input'); 
fileInput.type = 'file';
fileInput.accept = 'image/*';

async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = stream;
    } catch (err) {
        console.warn("Camera blocked or unavailable. Using file picker fallback.");
    }
}

function captureFromCamera() {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8));
}

async function getImageFromDevice() {
    return new Promise((resolve) => {
        fileInput.onchange = (e) => resolve(e.target.files[0]);
        fileInput.click();
    });
}

function initMap() {
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        maxZoom: 19, 
        attribution: '© OpenStreetMap' 
    });
    const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { 
        maxZoom: 19, 
        attribution: '© Google' 
    });
    const googleStreet = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { 
        maxZoom: 19, 
        attribution: '© Google' 
    });
    map = L.map('map', { 
        zoomControl: false,
        layers: [osmLayer] 
    }).setView([20.5937, 78.9629], 5);
	L.control.zoom({
        position: 'bottomleft'
    }).addTo(map);
    const baseMaps = {
        "OpenStreetMap": osmLayer,
        "Google Hybrid": googleHybrid,
        "Google Street": googleStreet
    };
    L.control.layers(baseMaps, null, { position: 'topright' 
	}).addTo(map);
    map.addControl(new StreetViewControl());
    const bottomCenter = map._controlCorners.bottomcenter = L.DomUtil.create('div', 'leaflet-bottom leaflet-center', map._controlContainer);
    const geocoder = L.Control.geocoder({
        defaultMarkGeocode: false,
       placeholder: "Search location...",
        position: 'bottomcenter'
    })
    .on('markgeocode', function(e) {
        const bbox = e.geocode.bbox;
        const poly = L.polygon([
            bbox.getSouthEast(),
            bbox.getNorthEast(),
            bbox.getNorthWest(),
            bbox.getSouthWest()
        ]);
        map.fitBounds(poly.getBounds());
        setMarker(e.geocode.center.lat, e.geocode.center.lng);
    })
    .addTo(map);
    map.on('click', function(e) {
        setMarker(e.latlng.lat, e.latlng.lng);
    });
    navigator.geolocation.watchPosition(updateGPS, handleGPSError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
    });
    document.getElementById('lat').addEventListener('input', updateFromInputs);
    document.getElementById('lng').addEventListener('input', updateFromInputs);
}

function updateGPS(pos) {
    setMarker(pos.coords.latitude, pos.coords.longitude, false); 
}

function setMarker(lat, lng, moveMap = true) {
    lat = parseFloat(lat);
    lng = parseFloat(lng);
    if (isNaN(lat) || isNaN(lng)) return;
    if (marker) {
        marker.setLatLng([lat, lng]);
    } else {
        marker = L.marker([lat, lng]).addTo(map);
    }
    if (moveMap) map.setView([lat, lng], 18);
    const latFixed = lat.toFixed(6);
    const lngFixed = lng.toFixed(6);
    document.getElementById('lat').value = latFixed;
    document.getElementById('lng').value = lngFixed;
    document.getElementById('coord-display').innerText = `📍 ${latFixed}, ${lngFixed}`;
    if (document.getElementById('popup-coords')) {
        document.getElementById('popup-coords').innerText = `${latFixed}, ${lngFixed}`;
    }
}

function updateFromInputs() {
    const lat = document.getElementById('lat').value;
    const lng = document.getElementById('lng').value;
    if (lat && lng) setMarker(lat, lng);
}

window.useLocation = function() {
    navigator.geolocation.getCurrentPosition(function(position) {
        setMarker(position.coords.latitude, position.coords.longitude);
    }, handleGPSError, { enableHighAccuracy: true });
};

function handleGPSError(err) {
    console.warn("GPS Error: ", err.message);
    const display = document.getElementById('coord-display');
    if (err.code === 1) {
        display.innerHTML = "⚠️ Location Access Denied. Please enable GPS.";
        alert("Please enable location permissions in your browser settings to use this app.");
    } else {
        display.innerText = "🛰️ GPS Signal Weak / Finding Location...";
    }
}

document.getElementById('save-idb-btn').onclick = async () => {
    const btn = document.getElementById('save-idb-btn');
    const originalText = btn.innerText;
    btn.innerText = "💾 Saving...";
    btn.disabled = true;
    const lat = document.getElementById('lat').value;
    const lng = document.getElementById('lng').value;
    let imageBlob;
    if (video.srcObject && video.readyState === 4) {
        imageBlob = await captureFromCamera();
    } else {
        imageBlob = await getImageFromDevice();
    }
    if (!imageBlob) {
        alert("No image captured!");
        btn.innerText = originalText;
        btn.disabled = false;
        return;
    }
    const entry = {
        id: Date.now().toString(),
        lat: lat,
        lng: lng,
        phone: document.getElementById('phone').value,
        desc: document.getElementById('desc').value,
        image: imageBlob
    };
    const db = await openDB();
    const tx = db.transaction(storeName, "readwrite");
    await tx.objectStore(storeName).add(entry);
    btn.innerText = originalText;
    btn.disabled = false;
    alert("Point Captured Successfully!");
    closeCameraPopup(); 
    renderQueue();
};
let selectedFileBlob = null;

function openUploadPopup() {
    document.getElementById('upload-popup').style.display = 'flex';
}

function closeUploadPopup() {
    document.getElementById('upload-popup').style.display = 'none';
    selectedFileBlob = null;
    document.getElementById('file-preview').style.display = 'none';
    document.getElementById('placeholder-text').style.display = 'block';
}

function triggerFileInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            selectedFileBlob = file;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = document.getElementById('file-preview');
                img.src = event.target.result;
                img.style.display = 'block';
                document.getElementById('placeholder-text').style.display = 'none';
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
}

document.getElementById('save-upload-btn').onclick = async () => {
    if (!selectedFileBlob) return alert("Please select an image first!");
    const lat = document.getElementById('lat').value;
    const lng = document.getElementById('lng').value;
    const entry = {
        id: Date.now().toString(),
        lat: lat,
        lng: lng,
        phone: document.getElementById('phone-upload').value,
        desc: document.getElementById('desc-upload').value,
        image: selectedFileBlob
    };
    const db = await openDB();
    const tx = db.transaction(storeName, "readwrite");
    await tx.objectStore(storeName).add(entry);
    alert("Point Captured Successfully!");
    closeUploadPopup();
    renderQueue();
};

async function renderQueue() {
    const db = await openDB();
    const tx = db.transaction(storeName, "readonly");
    const entries = await new Promise(res => {
    const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => res(req.result);
    });
    const list = document.getElementById('queue-list');
    const count = entries.length;
    let html = `
        <div class="sync-header">
            <span><strong>${count}</strong> Pending Tags</span>
            ${count > 0 ? `<button class="btn-bulk" onclick="exportAllToDisk()">💾 Save All</button>` : ''}
        </div>
    `;
    if (count === 0) {
        html += '<p style="text-align:center; padding:20px; color:#64748b;">No data in queue.</p>';
        list.innerHTML = html;
        return;
    }
    entries.forEach(entry => {
        const thumbUrl = URL.createObjectURL(entry.image);
        html += `
            <div class="queue-item">
                <img src="${thumbUrl}" class="queue-thumb">
                <div class="queue-info">
                    <strong>Tag: ${entry.id.slice(-5)}</strong>
                    <p>📍 ${entry.lat}, ${entry.lng}</p>
                    <p>📞 ${entry.phone || 'N/A'}</p>
                </div>
                <div class="queue-actions">
                    <button class="btn-mini btn-save" onclick="saveSingleToDisk('${entry.id}')">Export</button>
                    <button class="btn-mini btn-del" onclick="deleteEntry('${entry.id}')">Clear</button>
                </div>
            </div>
        `;
    });
    list.innerHTML = html;
}

async function exportAllToDisk() {
    try {
        const db = await openDB();
        const tx = db.transaction(storeName, "readonly");
        const entries = await new Promise(res => {
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => res(req.result);
        });
        const rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        for (const entry of entries) {
            const folder = await rootHandle.getDirectoryHandle(`entry_${entry.id}`, { create: true });
            const imgFile = await folder.getFileHandle("photo.jpg", { create: true });
            const imgWriter = await imgFile.createWritable();
            await imgWriter.write(entry.image);
            await imgWriter.close();
            const txtFile = await folder.getFileHandle("data.txt", { create: true });
            const txtWriter = await txtFile.createWritable();
            await txtWriter.write(`Phone: ${entry.phone}\nLat: ${entry.lat}\nLng: ${entry.lng}\nDesc: ${entry.desc}`);
            await txtWriter.close();
            const delTx = db.transaction(storeName, "readwrite");
            await delTx.objectStore(storeName).delete(entry.id);
        }
        alert("Export complete!");
        renderQueue();
    } catch (err) { if (err.name !== 'AbortError') console.error(err); }
}

async function saveSingleToDisk(id) {
    try {
        const db = await openDB();
        const entry = await new Promise(res => {
            const req = db.transaction(storeName).objectStore(storeName).get(id);
            req.onsuccess = () => res(req.result);
        });
        const rootHandle = await window.showDirectoryPicker();
        const subFolder = await rootHandle.getDirectoryHandle(`tag_${entry.id}`, { create: true });
        const imgFile = await subFolder.getFileHandle("photo.jpg", { create: true });
        const imgWriter = await imgFile.createWritable();
        await imgWriter.write(entry.image);
        await imgWriter.close();
        const txtFile = await subFolder.getFileHandle("data.txt", { create: true });
        const txtWriter = await txtFile.createWritable();
        await txtWriter.write(`Phone: ${entry.phone}\nLat: ${entry.lat}\nLng: ${entry.lng}\nDesc: ${entry.desc}`);
        await txtWriter.close();
        const delTx = db.transaction(storeName, "readwrite");
        await delTx.objectStore(storeName).delete(id);
        renderQueue();
    } catch (err) { if (err.name !== 'AbortError') console.error(err); }
}

async function deleteEntry(id) {
    if (!confirm("Remove this item?")) return;
    const db = await openDB();
    const tx = db.transaction(storeName, "readwrite");
    await tx.objectStore(storeName).delete(id);
    renderQueue();
}

function openCameraPopup() {
    document.getElementById('camera-popup').style.display = 'flex';
    initCamera();
}

function closeCameraPopup() {
    document.getElementById('camera-popup').style.display = 'none';
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
}

function showSettings() {
    document.getElementById('settings-view').style.display = 'flex';
    renderQueue();
}

function closeSettings() {
    document.getElementById('settings-view').style.display = 'none';
}

window.onload = () => {
    initMap();
    renderQueue();
};