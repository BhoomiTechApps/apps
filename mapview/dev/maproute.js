// ================================
// Basemap Routing via Right-Click
// ================================

// Globals
let routingWaypoints = [];
let lastRoute = null;
let tempMarkers = [];

// Get existing HTML elements
const navPanel = document.getElementById('navPanel');
const waypointsInfo = document.getElementById('waypointsInfo');
const speedRange = document.getElementById('speedRange');
const speedLabel = document.getElementById('speedLabel');
const travelTimeInfo = document.getElementById('travelTimeInfo');
const altRoutesContainer = document.getElementById('altRoutesContainer');
const turnByTurnContainer = document.getElementById('turnByTurnContainer'); // Ensure this exists in HTML
const clearAllRoutesBtn = document.getElementById('clearAllRoutesBtn');

// Show nav panel
navPanel.style.display = 'block';

// --- Routing Control ---
const routingControl = L.Routing.control({
  waypoints: [],
  routeWhileDragging: true,
  draggableWaypoints: true,
  addWaypoints: true,
  showAlternatives: true,
  
  // Main route style
  lineOptions: {
    styles: [{ color: '#0077FF', opacity: 0.9, weight: 5 }]
  },
  
  // Alternative routes style
  altLineOptions: {
    styles: [{ color: '#FFA500', opacity: 0.5, weight: 4 }]
  },
  
  createMarker: function(i, wp) {
    const icon = L.divIcon({
      className: i === 0 ? 'start-marker' : 'end-marker',
      html: i === 0 ? 'S' : 'D',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14]
    });
    return L.marker(wp.latLng, { icon });
  }
}).addTo(map);
;

// Hide default control panel
routingControl._container.style.display = 'none';

// --- Add Routing Waypoints via Right-Click ---
function addRoutingWaypoint(latlng) {
  if (routingWaypoints.length >= 2) {
    routingWaypoints = [];
    routingControl.setWaypoints([]);
    tempMarkers.forEach(m => map.removeLayer(m));
    tempMarkers = [];
    waypointsInfo.textContent = 'Right-click map to set start/end';
    travelTimeInfo.textContent = '';
    altRoutesContainer.innerHTML = '';
    turnByTurnContainer.innerHTML = '';
  }

  routingWaypoints.push(latlng);

  // Temporary marker
  if (routingWaypoints.length === 1) {
    const startMarker = L.marker(latlng, {
      icon: L.divIcon({ className:'start-marker', html:'S', iconSize:[28,28], iconAnchor:[14,14] }),
      interactive: false
    }).addTo(map);
    tempMarkers.push(startMarker);
    waypointsInfo.textContent = `Start: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
  }

  if (routingWaypoints.length === 2) {
    routingControl.setWaypoints(routingWaypoints);
    tempMarkers.forEach(m => map.removeLayer(m));
    tempMarkers = [];
    const end = routingWaypoints[1];
    waypointsInfo.textContent += ` → End: ${end.lat.toFixed(5)}, ${end.lng.toFixed(5)}`;
  }
}

// --- Prevent browser context menu ---
map.getContainer().addEventListener('contextmenu', ev => ev.preventDefault());
map.on('contextmenu', e => addRoutingWaypoint(e.latlng));

// --- Speed Slider ---
speedRange.addEventListener('input', () => {
  speedLabel.textContent = speedRange.value + ' km/h';
  if (lastRoute) updateTravelTime(lastRoute, parseFloat(speedRange.value));
});

// --- Compute Travel Time ---
function updateTravelTime(route, speedKmph) {
  if (!route) return;
  const distanceKm = route.summary.totalDistance / 1000;
  const travelTimeHr = distanceKm / speedKmph;
  const hours = Math.floor(travelTimeHr);
  const minutes = Math.round((travelTimeHr - hours) * 60);
  travelTimeInfo.textContent = `Distance: ${distanceKm.toFixed(2)} km | ETA: ${hours}h ${minutes}m`;
}

// --- Routing Events ---
routingControl.on('routesfound', (e) => {
  lastRoute = e.routes[0];
  updateTravelTime(lastRoute, parseFloat(speedRange.value));
  updateTurnByTurnInstructions(lastRoute);
});

routingControl.on('routeselected', (e) => {
  lastRoute = e.route;
  updateTravelTime(lastRoute, parseFloat(speedRange.value));
  updateTurnByTurnInstructions(lastRoute);
});

// --- Clear All Routes ---
clearAllRoutesBtn.addEventListener('click', () => {
  routingWaypoints = [];
  routingControl.setWaypoints([]);
  lastRoute = null;

  // Clear instructions
  turnByTurnContainer.innerHTML = '';
  tempMarkers.forEach(m => map.removeLayer(m));
  tempMarkers = [];

  // Reset info displays
  waypointsInfo.textContent = 'Right-click map to set start/end';
  travelTimeInfo.textContent = '';
  altRoutesContainer.innerHTML = '';
});

function updateTurnByTurnInstructions(route) {
  turnByTurnContainer.innerHTML = ''; // clear previous
  if (!route || !route.instructions || !route.coordinates) return;

  route.instructions.forEach((instr, idx) => {
    const div = document.createElement('div');
    div.style.marginBottom = '2px';
    div.style.cursor = 'pointer';
    div.style.padding = '2px 4px';
    div.style.borderRadius = '4px';
    div.innerHTML = `${idx + 1}. ${instr.text} (${(instr.distance/1000).toFixed(2)} km)`;

    // Highlight step on hover
    div.onmouseover = () => div.style.background = '#eef';
    div.onmouseout = () => div.style.background = 'transparent';

    // Compute approximate LatLng for this instruction
    let instrLatLng = null;
    if (instr.index != null && route.coordinates[instr.index]) {
      const c = route.coordinates[instr.index];
      instrLatLng = L.latLng(c.lat, c.lng || c.lon || c[1]); // handle array or object
    }

    // Zoom/popup when clicked
    div.onclick = () => {
      if (instrLatLng) {
        map.setView(instrLatLng, 16);
        L.popup({closeOnClick:true})
          .setLatLng(instrLatLng)
          .setContent(`<b>Step ${idx + 1}:</b> ${instr.text}`)
          .openOn(map);
      }
    };

    turnByTurnContainer.appendChild(div);
  });
}

