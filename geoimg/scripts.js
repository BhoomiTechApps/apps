let images = [];
let markers = L.markerClusterGroup();
let highlightLayer = L.layerGroup();
let radiusCircle = null;
let currentCenter = null;
let modal = null;
let jsonList = null;

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
const street = L.tileLayer("https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}");
const satellite = L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}");

const map = L.map("map", {
  center: [25, 93],
  zoom: 7,
  layers: [osm]
});

L.control.layers({
  "OpenStreetMap": osm,
  "GoogleStreet": street,
  "GoogleHybrid": satellite
}).addTo(map);

map.addLayer(markers);
highlightLayer.addTo(map);

L.control.fullscreen({ position: "topleft" }).addTo(map);

L.control.locate({
  position: "topleft",
  showPopup: false,
  locateOptions: { enableHighAccuracy: true }
}).addTo(map);

L.Control.geocoder({
  position: "topleft",
  defaultMarkGeocode: false
})
.on("markgeocode", e => {
  const c = e.geocode.center;
  map.setView(c, 13);
  runSearch(c.lat, c.lng);
})
.addTo(map);

function haversine(a,b,c,d){
  const R=6371;
  const dLat=(c-a)*Math.PI/180;
  const dLon=(d-b)*Math.PI/180;
  return 2*R*Math.asin(Math.sqrt(
    Math.sin(dLat/2)**2 +
    Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*
    Math.sin(dLon/2)**2
  ));
}

map.on("click", e => {
  runSearch(e.latlng.lat, e.latlng.lng);
});

function runSearch(lat, lng) {
  currentCenter = [lat, lng];
  const r = +document.getElementById("radius").value;

  markers.clearLayers();
  highlightLayer.clearLayers();
  if (radiusCircle) map.removeLayer(radiusCircle);

  radiusCircle = L.circle(currentCenter, {
    radius: r * 1000,
    color: "blue",
    fillOpacity: 0.1
  }).addTo(map);

  const nearby = images.filter(i =>
    haversine(lat, lng, i.lat, i.lng) <= r
  );

  nearby.forEach(i => {
    const descEscaped = (i.description || "").replace(/'/g, "\\'");
    const popupImg =
      `<img src="${i.thumb}" class="popup-thumb" 
        onclick="openLightbox('${i.image}', '${descEscaped}')">`;
    const m = L.marker([i.lat, i.lng]).bindPopup(popupImg);
    m.imageData = i;
    markers.addLayer(m);
  });
  showResults(nearby);
}

function showResults(list) {
  const res = document.getElementById("results");
  res.innerHTML = "";

  if (!list.length) {
    res.innerHTML = "<p style='padding:10px; font-size:12px;'>No images found.</p>";
    return;
  }

  list.forEach(i => {
    const d = document.createElement("div");
    d.className = "thumb";
    d.innerHTML = `
      <img src="${i.thumb}" loading="lazy">
      <div class="desc">${i.description || ""}</div>
    `;
    d.onclick = () => {
      highlightLayer.clearLayers();
      L.circleMarker([i.lat, i.lng], {
        radius: 8,
        color: "red",
        fillOpacity: 0.8
      }).addTo(highlightLayer);
      map.setView([i.lat, i.lng], 16);
      markers.eachLayer(layer => {
        if(layer.getLatLng().lat === i.lat && layer.getLatLng().lng === i.lng) {
          layer.openPopup();
        }
      });
    };
    res.appendChild(d);
  });
}

function openLightbox(url, desc) {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  const cap = document.getElementById("lightboxCaption");
  img.src = url;
  if (cap) cap.innerText = desc || "";
  lb.style.display = "flex";
}

const slider = document.getElementById("radius");
slider.oninput = () => {
  document.getElementById("radiusValue").innerText = slider.value;
  if (currentCenter)
    runSearch(currentCenter[0], currentCenter[1]);
};

document.addEventListener("DOMContentLoaded", () => {
  const folderInput = document.getElementById("folderInput");
  const openBtn = document.getElementById("openJsonBtn");
  if (openBtn) openBtn.onclick = () => folderInput.click();
  folderInput.onchange = async (e) => {
    const files = Array.from(e.target.files);
    const jsonFile = files.find(f => f.name === "data.json");
    if (!jsonFile) {
      alert("Could not find data.json in the selected folder.");
      return;
    }
    try {
      const text = await jsonFile.text();
      const rawImages = JSON.parse(text);
      const getFileName = (path) => path.split('/').pop().toLowerCase();
      images = rawImages.map(img => {
        const thumbName = getFileName(img.thumb);
        const imageName = getFileName(img.image);
        const thumbFile = files.find(f => 
          f.webkitRelativePath.toLowerCase().endsWith(`thumbs/${thumbName}`)
        );
        const fullFile = files.find(f => 
          f.webkitRelativePath.toLowerCase().endsWith(`images/${imageName}`)
        );
        return {
          ...img,
          thumb: thumbFile ? URL.createObjectURL(thumbFile) : "https://via.placeholder.com/150?text=No+Thumb",
          image: fullFile ? URL.createObjectURL(fullFile) : ""
        };
      });
      markers.clearLayers();
      highlightLayer.clearLayers();
      if (radiusCircle) map.removeLayer(radiusCircle);
      document.getElementById("results").innerHTML = `
        <p style="padding:10px; font-weight:bold;">
          ${images.length} images loaded.<br>
          <span style="font-size:10px; font-weight:normal;">Click the map to view gallery.</span>
        </p>
      `;
      if (images.length) {
        const group = L.featureGroup(images.map(i => L.marker([i.lat, i.lng])));
        map.fitBounds(group.getBounds());
      }
    } catch (err) {
      console.error("JSON Error:", err);
      alert("Error parsing data.json.");
    }
  };
});

function loadJsonIndex() {
  if(!jsonList) return;
  jsonList.innerHTML = "Loading...";
  fetch("jsons/index.json")
    .then(r => r.json())
    .then(files => {
      jsonList.innerHTML = "";
      files.forEach(f => {
        const d = document.createElement("div");
        d.textContent = f;
        d.style.cursor = "pointer";
        d.style.padding = "6px 0";
        d.addEventListener("click", () => loadJsonFile(f));
        jsonList.appendChild(d);
      });
    });
}

function loadJsonFile(file) {
  fetch("jsons/" + file)
    .then(r => r.json())
    .then(data => {
      images = data;
      markers.clearLayers();
      highlightLayer.clearLayers();
      document.getElementById("results").innerHTML = "";
      if(modal) modal.style.display = "none";
    });
}

window.addEventListener('resize', () => {
  map.invalidateSize();
});