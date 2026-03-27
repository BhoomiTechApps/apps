let images = [];
let markers = L.markerClusterGroup();
let highlightLayer = L.layerGroup();
let radiusCircle = null;
let currentCenter = null;
let modal = null;
let jsonList = null;

// --- BASEMAPS ---
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
const street = L.tileLayer("https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}");
const satellite = L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}");

// --- MAP ---
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

// --- CONTROLS ---
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

// --- LOAD DATA ---
//fetch("jsons/imglist.json")
  //.then(r => r.json())
  //.then(data => images = data);

// --- HAVERSINE ---
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

// --- MAP CLICK ---
map.on("click", e => {
  runSearch(e.latlng.lat, e.latlng.lng);
});

// --- SEARCH ---
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
    const popupImg =
      `<img src="${i.thumb}" width="150" style="cursor:pointer"
        onclick="openLightbox('${i.image}')">`;

    const m = L.marker([i.lat, i.lng]).bindPopup(popupImg);
    m.imageData = i;
    markers.addLayer(m);
  });

  showResults(nearby);
}

// --- GALLERY ---
function showResults(list) {
  const res = document.getElementById("results");
  res.innerHTML = "";

  if (!list.length) {
    res.innerHTML = "<p>No images found.</p>";
    return;
  }

  list.forEach(i => {
    const d = document.createElement("div");
    d.className = "thumb";
    d.innerHTML = `
      <img src="${i.thumb}" loading="lazy">
      <div class="desc">${i.description || ""}</div>
    `;

    // CLICK instead of mouseover
    d.onclick = () => {
      highlightLayer.clearLayers();

      L.circleMarker([i.lat, i.lng], {
        radius: 8,
        color: "red",
        fillOpacity: 0.8
      }).addTo(highlightLayer);

      // Center map on image location at zoom 16
      map.setView([i.lat, i.lng], 16);
    };

    res.appendChild(d);
  });
}

// --- LIGHTBOX ---
function openLightbox(url) {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  img.src = url;
  lb.style.display = "flex";
}

// --- RADIUS SLIDER ---
const slider = document.getElementById("radius");
slider.oninput = () => {
  document.getElementById("radiusValue").innerText = slider.value;
  if (currentCenter)
    runSearch(currentCenter[0], currentCenter[1]);
};

// --- JSON FILE PICKER ---
document.addEventListener("DOMContentLoaded", () => {
  const folderInput = document.getElementById("folderInput");
  const openBtn = document.getElementById("openJsonBtn");

  // Trigger file input when button is clicked
  openBtn.onclick = () => folderInput.click();

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

    // Helper to get just the filename if your JSON has "images/photo.jpg"
    const getFileName = (path) => path.split('/').pop().toLowerCase();

    images = rawImages.map(img => {
      const thumbName = getFileName(img.thumb);
      const imageName = getFileName(img.image);

      // Look for the file anywhere in the upload that matches the subfolder + filename
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

    // Reset UI
    markers.clearLayers();
    highlightLayer.clearLayers();
    if (radiusCircle) map.removeLayer(radiusCircle);
    
    document.getElementById("results").innerHTML = `
      <p style="padding:10px; font-weight:bold;">
        ${images.length} images loaded.<br>
        <span style="font-size:10px; font-weight:normal;">Click the map to view gallery.</span>
      </p>
    `;

  } catch (err) {
    console.error("JSON Error:", err);
  }
  // Optional: Auto-zoom to fit all markers once loaded
    if (images.length) {
       const group = L.featureGroup(images.map(i => L.marker([i.lat, i.lng])));
       map.fitBounds(group.getBounds());
     }
  };
});

folderInput.onchange = async (e) => {
  const files = Array.from(e.target.files);
  console.log("Files detected:", files.length);

  // 1. Find the data.json file
  const jsonFile = files.find(f => f.name === "data.json");
  if (!jsonFile) {
    alert("Could not find data.json in the selected folder.");
    return;
  }

  try {
    const text = await jsonFile.text();
    const rawImages = JSON.parse(text);

    images = rawImages.map(img => {
      // Robust matching: check if the path ends with the expected subfolder + filename
      const thumbFile = files.find(f => 
        f.webkitRelativePath.toLowerCase().endsWith(`thumbs/${img.thumb}`.toLowerCase())
      );
      const fullFile = files.find(f => 
        f.webkitRelativePath.toLowerCase().endsWith(`images/${img.image}`.toLowerCase())
      );

      // Log if a file is missing to help debugging
      if (!thumbFile) console.warn(`Thumbnail missing: thumbs/${img.thumb}`);
      if (!fullFile) console.warn(`Full image missing: images/${img.image}`);

      return {
        ...img,
        // Generate the blob URLs
        thumb: thumbFile ? URL.createObjectURL(thumbFile) : "https://via.placeholder.com/150?text=No+Thumb",
        image: fullFile ? URL.createObjectURL(fullFile) : ""
      };
    });

    // 2. Clear and Reset UI
    markers.clearLayers();
    highlightLayer.clearLayers();
    if (radiusCircle) map.removeLayer(radiusCircle);
    
    document.getElementById("results").innerHTML = `
      <p style="padding:10px; font-weight:bold;">
        ${images.length} images loaded.<br>
        <span style="font-size:10px; font-weight:normal;">Click the map to see images in a radius.</span>
      </p>
    `;

  } catch (err) {
    console.error("JSON Error:", err);
    alert("Error parsing data.json. Check the console for details.");
  }
};

function loadJsonIndex() {
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

      // reset UI state
      markers.clearLayers();
      highlightLayer.clearLayers();
      document.getElementById("results").innerHTML = "";

      modal.style.display = "none";
    });
	
    window.addEventListener('resize', () => {
    map.invalidateSize();
  });
}
