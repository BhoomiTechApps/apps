let map = L.map('map').setView([20.5937, 78.9629], 5);
let marker;

L.tileLayer(
  'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  { maxZoom: 20 }
).addTo(map);

//-----------------------------
// Define the Custom Street View Control
const StreetViewControl = L.Control.extend({
  options: {
    position: 'bottomright'
  },

  onAdd: function(map) {
    // We only create the div and assign the class
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-streetview');
    container.title = 'Open in Google Street View';
    
    // The image tag - path remains relative to index.html
    container.innerHTML = `<img src="./leaflet/images/pegman.png" alt="Street View">`;

    container.onclick = function() {
      const lat = document.getElementById('lat').value;
      const lng = document.getElementById('lng').value;
      
      if (lat && lng) {
        // Correct Google Street View URL format
        const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
        window.open(url, '_blank');
      } else {
        alert("Please set a location first.");
      }
    };

    return container;
  }
});

map.addControl(new StreetViewControl());
//-----------------------------

map.on('click', function(e) {
  setMarker(e.latlng.lat, e.latlng.lng);
});

const nameInput = document.getElementById('name');
const latInput = document.getElementById('lat');
const lngInput = document.getElementById('lng');
const submitBtn = document.getElementById('submitBtn');

function validateForm() {
  const name = nameInput.value.trim();
  const lat = latInput.value.trim();
  const lng = lngInput.value.trim();
  submitBtn.disabled = !(name && lat && lng);
}

nameInput.addEventListener('input', validateForm);
latInput.addEventListener('input', validateForm);
lngInput.addEventListener('input', validateForm);

function setMarker(lat, lng) {
  lat = parseFloat(lat);
  lng = parseFloat(lng);
  if (isNaN(lat) || isNaN(lng)) return;

  if (marker) {
    marker.setLatLng([lat, lng]);
  } else {
    marker = L.marker([lat, lng]).addTo(map);
  }

  map.setView([lat, lng], 20);

  latInput.value = lat.toFixed(6);
  lngInput.value = lng.toFixed(6);

  validateForm();
}

window.useLocation = function() {
  navigator.geolocation.getCurrentPosition(function(position) {
    setMarker(position.coords.latitude, position.coords.longitude);
  });
};

function updateFromInputs() {
  setMarker(latInput.value, lngInput.value);
}

latInput.addEventListener('input', updateFromInputs);
lngInput.addEventListener('input', updateFromInputs);

window.openStreetView = function() {
  const lat = latInput.value;
  const lng = lngInput.value;

  if (!lat || !lng) {
    alert("Select or enter coordinates first");
    return;
  }

  window.open(
    `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`,
    '_blank'
  );
};
