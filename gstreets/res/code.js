// 1. Initialize Map & Layers
const googleStreet = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { attribution: '© Google', maxZoom: 19 });
const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { attribution: '© Google', maxZoom: 20 });

const map = L.map('map', {
    center: [26.1445, 91.7362],
    zoom: 13,
    layers: [googleStreet]
});

L.control.layers({ "Street": googleStreet, "Satellite": googleHybrid }).addTo(map);

// 2. Initialize Geocoder (Search) in Toolbar
const geocoder = L.Control.geocoder({
    defaultMarkGeocode: false,
    placeholder: "Search location..."
}).on('markgeocode', function(e) {
    const center = e.geocode.center;
    map.setView(center, 16);
    updateMarkerAndCoords(center.lat, center.lng);
});

// Append geocoder to the inline toolbar container
document.getElementById('searchContainer').appendChild(geocoder.onAdd(map));

// 3. User Location Button (Placed in topleft to stack under zoom)
const LocationControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function() {
        const container = L.DomUtil.create('div', 'leaflet-bar');
        const button = L.DomUtil.create('a', 'custom-location-btn', container);
        button.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i>';
        button.title = "Find my location";
        button.onclick = function(e) {
            L.DomEvent.stopPropagation(e);
            map.locate({setView: true, maxZoom: 20});
        };
        return container;
    }
});
new LocationControl().addTo(map);

const centerPlaceholder = L.control({ position: 'bottomleft' });
centerPlaceholder.onAdd = function() {
    const div = L.DomUtil.create('div', 'leaflet-bottom leaflet-center');
    L.DomEvent.disableClickPropagation(div);
    return div;
};

// 4. Shared Logic for Interaction
let marker;

function updateMarkerAndCoords(lat, lng) {
    const latLng = [lat, lng];
    if (marker) marker.setLatLng(latLng);
    else marker = L.marker(latLng).addTo(map);
    document.getElementById('coords').innerText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

map.on('click', function(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    updateMarkerAndCoords(lat, lng);
    const svUrl = `https://maps.google.com/maps?q=&layer=c&cbll=${lat},${lng}&cbp=11,0,0,0,0&output=svembed`;
    openStreetView(svUrl);
});

function openStreetView(url) {
    document.getElementById('streetview').src = url;
    document.getElementById('streetviewContainer').style.display = 'block';
    document.getElementById('map').classList.add('map-hidden');
}

function closeStreetView() {
    document.getElementById('streetviewContainer').style.display = 'none';
    document.getElementById('streetview').src = "";
    document.getElementById('map').classList.remove('map-hidden');
    document.getElementById('coords').innerText = "Click on map to select location";
    if (marker) { map.removeLayer(marker); marker = null; }
}

function toggleToolbar() {
    const toolbar = document.getElementById('toolbar');
    toolbar.classList.toggle('collapsed');
    toolbar.classList.toggle('expanded');
}

map.on('locationfound', (e) => updateMarkerAndCoords(e.latlng.lat, e.latlng.lng));