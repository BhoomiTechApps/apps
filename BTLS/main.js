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
    // Create the container div
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-streetview');
    container.title = 'Open in Google Street View';
    
    // Using a stable SVG icon (Pegman style)
    container.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="4" r="3" fill="#F4B400"/>
        <path d="M12 7c-2.76 0-5 2.24-5 5v7h2v5h2v-5h2v5h2v-5h2v-7c0-2.76-2.24-5-5-5z" fill="#F4B400"/>
      </svg>
    `;

    // Handle the click event
    container.onclick = function(e) {
      L.DomEvent.stopPropagation(e); // Prevents map click events
      
      const latVal = document.getElementById('lat').value.trim();
      const lngVal = document.getElementById('lng').value.trim();

      if (!latVal || !lngVal) {
        alert("Please enter Latitude and Longitude first!");
        return;
      }

      const lat = parseFloat(latVal);
      const lng = parseFloat(lngVal);

      if (isNaN(lat) || isNaN(lng)) {
        alert("Invalid coordinates. Please check the fields.");
        return;
      }

      // Updated URL format for browser-based Street View
      const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
      window.open(url, '_blank');
    };

    return container;
  }
});

// Add the control to your map
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
