class ImageViewer {
  constructor() {
    this.imageElement = document.getElementById('imageElement');
    this.imageWrapper = document.getElementById('imageWrapper');
    this.viewport = document.getElementById('viewport');
    this.zoomHandle = document.getElementById('zoomHandle');
    this.zoomTrack = document.getElementById('zoomTrack');
    this.zoomFill = document.getElementById('zoomFill');
    this.zoomLevel = document.getElementById('zoomLevel');
    
    this.pan = { x: 0, y: 0 };
    this.zoom = 1;
    this.minZoom = 0.1;
    this.maxZoom = 2;
    this.isDragging = false;
    this.isZoomDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.snapThreshold = 0.08;
    
    this.metadata = null;
    this.projKey = null;

    this.fileInput = document.getElementById('fileInput');
    this.metaFileInput = document.getElementById('metaFileInput');
    this.uploadBtn = document.getElementById('uploadBtn');
    this.uploadMetaBtn = document.getElementById('uploadMetaBtn');
    this.resetBtn = document.getElementById('resetBtn');
    this.statusMessage = document.getElementById('statusMessage');
    this.statusText = document.getElementById('statusText');
    this.statusClose = document.getElementById('statusClose');
    this.filename = document.getElementById('filename');
    this.imageSize = document.getElementById('imageSize');
    this.pixelPos = document.getElementById('pixelPos');
    this.geoCoord = document.getElementById('geoCoord');
    
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    this.metaFileInput.addEventListener('change', (e) => this.handleMetaSelect(e));
    this.uploadBtn.addEventListener('click', () => this.fileInput.click());
    this.uploadMetaBtn.addEventListener('click', () => this.metaFileInput.click());
    this.resetBtn.addEventListener('click', () => this.resetView());
    this.statusClose.addEventListener('click', () => this.statusMessage.classList.add('hidden'));

    // Mouse drag & cursor coordinate tracking
    this.viewport.addEventListener('mousedown', (e) => this.startDrag(e));
    document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    document.addEventListener('mouseup', () => this.endDrag());

    // Touch drag
    this.viewport.addEventListener('touchstart', (e) => this.startDrag(e));
    this.viewport.addEventListener('touchmove', (e) => this.drag(e), { passive: false });
    this.viewport.addEventListener('touchend', () => this.endDrag());

    // Zoom scale events
    this.zoomHandle.addEventListener('mousedown', (e) => this.startZoomDrag(e));
    this.zoomHandle.addEventListener('touchstart', (e) => this.startZoomDrag(e));
    document.addEventListener('mousemove', (e) => this.zoomDrag(e));
    document.addEventListener('touchmove', (e) => this.zoomDrag(e), { passive: false });
    document.addEventListener('mouseup', () => this.endZoomDrag());
    document.addEventListener('touchend', () => this.endZoomDrag());

    this.zoomTrack.addEventListener('click', (e) => this.handleZoomTrackClick(e));
  }

  handleMetaSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        this.metadata = JSON.parse(event.target?.result);
        this.initProjection();
        this.uploadMetaBtn.textContent = 'Metadata Loaded ✓';
        this.uploadMetaBtn.style.borderColor = 'var(--accent)';
        this.statusMessage.classList.add('hidden');
      } catch (err) {
        alert('Invalid JSON metadata file.');
      }
    };
    reader.readAsText(file);
  }

  initProjection() {
  if (!this.metadata || !this.metadata.projection) return;
  
  const metaProj = this.metadata.projection;
  let projStr;

  // Handle Geographic Coordinate Systems (e.g., GCS WGS 1984)
  if (metaProj.type === 'GEOGCS' || metaProj.projection === 'GCS_WGS_1984') {
    projStr = "+proj=longlat +datum=WGS84 +no_defs";
    this.projKey = 'CUSTOM_GEOG_MAP';
  } else {
    // Handle Projected Coordinate Systems (e.g., Lambert Conformal Conic)
    const p = metaProj.parameters;
    projStr = `+proj=lcc +lat_1=${p.standardParallel1} +lat_2=${p.standardParallel2} +lat_0=${p.latitudeOfOrigin} +lon_0=${p.centralMeridian} +x_0=${p.falseEasting} +y_0=${p.falseNorthing} +datum=WGS84 +units=m +no_defs`;
    this.projKey = 'CUSTOM_LCC_MAP';
  }
  
  proj4.defs(this.projKey, projStr);
}

  handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    this.statusText.textContent = 'Loading image...';
    this.statusClose.classList.add('hidden');
    this.statusMessage.classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = (event) => {
      this.imageElement.onload = () => {
        const filenameWithoutExtension = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        this.filename.textContent = filenameWithoutExtension;
        this.imageSize.textContent = `${this.imageElement.naturalWidth} × ${this.imageElement.naturalHeight}`;
        this.imageElement.style.display = 'block';

        this.statusText.innerHTML = 'Image loaded successfully! Optional: load a <b>metadata JSON file</b> to enable georeferencing.';
        this.statusClose.classList.remove('hidden');
        this.statusMessage.classList.remove('hidden');

        this.resetView();
      };
      this.imageElement.onerror = () => {
        this.statusText.textContent = 'Failed to load image';
        this.statusClose.classList.add('hidden');
      };
      this.imageElement.src = event.target?.result;
    };
    reader.readAsDataURL(file);
  }

  startDrag(e) {
    if (this.imageElement.style.display === 'none') return;
    if (e.target === this.zoomHandle || this.zoomHandle.contains(e.target)) return;
    
    const touch = e.touches?.[0];
    const x = touch ? touch.clientX : e.clientX;
    const y = touch ? touch.clientY : e.clientY;
    
    this.isDragging = true;
    this.dragStart = { x, y };
    this.viewport.classList.add('dragging');
  }

  handleMouseMove(e) {
    if (this.isDragging) {
      this.drag(e);
      return;
    }

    if (this.imageElement.style.display === 'none') return;

    const rect = this.viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const viewportWidth = this.viewport.clientWidth;
    const viewportHeight = this.viewport.clientHeight;
    const scaledWidth = this.imageElement.naturalWidth * this.zoom;
    const scaledHeight = this.imageElement.naturalHeight * this.zoom;

    const imgLeft = (viewportWidth - scaledWidth) / 2 + this.pan.x;
    const imgTop = (viewportHeight - scaledHeight) / 2 + this.pan.y;

    const px = (mouseX - imgLeft) / this.zoom;
    const py = (mouseY - imgTop) / this.zoom;

    if (px >= 0 && px <= this.imageElement.naturalWidth && py >= 0 && py <= this.imageElement.naturalHeight) {
      this.pixelPos.textContent = `${Math.round(px)}, ${Math.round(py)}`;
      
      if (this.metadata && this.projKey) {
        const wf = this.metadata.worldFile;
        const easting = wf.easting + (px * wf.pixelWidth) + (py * (wf.rotationX || 0));
        const northing = wf.northing + (px * (wf.rotationY || 0)) + (py * wf.pixelHeight);

        try {
          const [lon, lat] = proj4(this.projKey, 'WGS84', [easting, northing]);
          this.geoCoord.textContent = `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
        } catch (err) {
          this.geoCoord.textContent = 'Transformation error';
        }
      } else {
        this.geoCoord.textContent = 'No metadata loaded';
      }
    } else {
      this.pixelPos.textContent = '-';
      this.geoCoord.textContent = this.metadata ? 'Out of bounds' : 'No metadata loaded';
    }
  }

  drag(e) {
    if (!this.isDragging) return;
    e.preventDefault?.();
    
    const touch = e.touches?.[0];
    const x = touch ? touch.clientX : e.clientX;
    const y = touch ? touch.clientY : e.clientY;
    
    this.pan.x += (x - this.dragStart.x);
    this.pan.y += (y - this.dragStart.y);
    
    this.dragStart = { x, y };
    this.constrainPan();
    this.updateTransform();
  }

  endDrag() {
    this.isDragging = false;
    this.viewport.classList.remove('dragging');
  }

  constrainPan() {
    const viewportWidth = this.viewport.clientWidth;
    const viewportHeight = this.viewport.clientHeight;
    
    const scaledWidth = this.imageElement.naturalWidth * this.zoom;
    const scaledHeight = this.imageElement.naturalHeight * this.zoom;
    
    const maxPanX = Math.max(0, (scaledWidth - viewportWidth) / 2);
    const maxPanY = Math.max(0, (scaledHeight - viewportHeight) / 2);

    this.pan.x = Math.max(-maxPanX, Math.min(maxPanX, this.pan.x));
    this.pan.y = Math.max(-maxPanY, Math.min(maxPanY, this.pan.y));
  }

  updateTransform() {
    this.imageWrapper.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
  }

  resetView() {
    this.pan = { x: 0, y: 0 };
    this.zoom = 1;
    this.updateTransform();
    this.updateZoomScale();
  }

  startZoomDrag(e) {
    e.stopPropagation();
    this.isZoomDragging = true;
    this.zoomHandle.classList.add('dragging');
  }

  zoomDrag(e) {
    if (!this.isZoomDragging || this.imageElement.style.display === 'none') return;
    
    const track = this.zoomTrack.getBoundingClientRect();
    const relativeY = Math.max(0, Math.min(track.height, (e.touches?.[0]?.clientY || e.clientY) - track.top));
    const normalizedValue = 1 - (relativeY / track.height);
    
    if (Math.abs(normalizedValue - 0.5) < this.snapThreshold) {
      this.zoom = 1;
    } else {
      this.zoom = this.minZoom + (this.maxZoom - this.minZoom) * normalizedValue;
    }
    
    this.constrainPan();
    this.updateTransform();
    this.updateZoomScale();
  }

  endZoomDrag() {
    this.isZoomDragging = false;
    this.zoomHandle.classList.remove('dragging');
  }

  handleZoomTrackClick(e) {
    const track = this.zoomTrack.getBoundingClientRect();
    const relativeY = Math.max(0, Math.min(track.height, e.clientY - track.top));
    const normalizedValue = 1 - (relativeY / track.height);
    
    if (Math.abs(normalizedValue - 0.5) < this.snapThreshold) {
      this.zoom = 1;
    } else {
      this.zoom = this.minZoom + (this.maxZoom - this.minZoom) * normalizedValue;
    }
    
    this.constrainPan();
    this.updateTransform();
    this.updateZoomScale();
  }

  updateZoomScale() {
    const normalizedZoom = (this.zoom - this.minZoom) / (this.maxZoom - this.minZoom);
    this.zoomHandle.style.top = ((1 - normalizedZoom) * 100) + '%';
    this.zoomFill.style.height = (normalizedZoom * 100) + '%';
    this.zoomLevel.textContent = Math.round(this.zoom * 100) + '%';
  }

  // Add this new method to your ImageViewer class
  updateCenterCoordinates() {
    if (this.imageElement.style.display === 'none') return;

    const viewportWidth = this.viewport.clientWidth;
    const viewportHeight = this.viewport.clientHeight;
    const scaledWidth = this.imageElement.naturalWidth * this.zoom;
    const scaledHeight = this.imageElement.naturalHeight * this.zoom;

    const imgLeft = (viewportWidth - scaledWidth) / 2 + this.pan.x;
    const imgTop = (viewportHeight - scaledHeight) / 2 + this.pan.y;

    // Calculate pixel right underneath the absolute center of the viewport
    const px = ((viewportWidth / 2) - imgLeft) / this.zoom;
    const py = ((viewportHeight / 2) - imgTop) / this.zoom;

    if (px >= 0 && px <= this.imageElement.naturalWidth && py >= 0 && py <= this.imageElement.naturalHeight) {
      this.pixelPos.textContent = `${Math.round(px)}, ${Math.round(py)}`;
      
      if (this.metadata && this.projKey) {
        const wf = this.metadata.worldFile;
        const easting = wf.easting + (px * wf.pixelWidth) + (py * (wf.rotationX || 0));
        const northing = wf.northing + (px * (wf.rotationY || 0)) + (py * wf.pixelHeight);

        try {
          const [lon, lat] = proj4(this.projKey, 'WGS84', [easting, northing]);
          this.geoCoord.textContent = `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
        } catch (err) {
          this.geoCoord.textContent = 'Transformation error';
        }
      } else {
        this.geoCoord.textContent = 'No metadata loaded';
      }
    } else {
      this.pixelPos.textContent = '-';
      this.geoCoord.textContent = this.metadata ? 'Out of bounds' : 'No metadata loaded';
    }
  }

  updateTransform() {
    this.imageWrapper.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    
    // Automatically recalculate coordinates based on the center crosshair during pan/zoom movements
    if (window.innerWidth <= 768) {
      this.updateCenterCoordinates();
    }
  }
}

// Initialize application and toolbar navigation hooks safely
document.addEventListener('DOMContentLoaded', () => {
  new ImageViewer();

  const metaBuilderBtn = document.getElementById('openMetaBuilder');
  if (metaBuilderBtn) {
    metaBuilderBtn.addEventListener('click', () => {
      window.open('metabuilder.html', '_blank');
    });
  }
});
