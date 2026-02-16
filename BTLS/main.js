let map = L.map('map').setView([20.5937, 78.9629], 5);
let marker;

L.tileLayer(
  'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  { maxZoom: 20 }
).addTo(map);

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
