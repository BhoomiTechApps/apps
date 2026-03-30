
    let geoData = null;
    let fileHandle = null;
    function toggleToolbar() {
       const toolbelt = document.getElementById('toolbelt');
       const chevron = document.getElementById('chevron-icon');
       const isExpanded = toolbelt.classList.toggle('expanded');
        if (isExpanded) {
           chevron.classList.add('rotate-180');
        } else {
           chevron.classList.remove('rotate-180');
        }
    }

    async function openGeoJSON() {
        try {
            [fileHandle] = await window.showOpenFilePicker({
                types: [{ accept: {'application/geo+json': ['.geojson', '.json']} }]
            });
            const file = await fileHandle.getFile();
            geoData = JSON.parse(await file.text());
            document.getElementById('status').innerText = file.name;
            renderUI();
        } catch (e) { console.warn("Picker closed"); }
    }

    async function saveGeoJSON() {
        if (!fileHandle) return;
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(geoData, null, 2));
        await writable.close();
        alert("File successfully overwritten.");
    }

    function renderUI() {
    const listContainer = document.getElementById('columnList');
    const jsonDisplay = document.getElementById('jsonDisplay');

    if (!geoData || !geoData.features || geoData.features.length === 0) {
        listContainer.innerHTML = '<p style="font-size: 0.8rem; color: #94a3b8;">Empty or invalid GeoJSON.</p>';
        return;
    }

    // 1. Render Column Rows (Schema)
    // We only look at the first feature to determine the schema
    const columns = Object.keys(geoData.features[0].properties);
    listContainer.innerHTML = '';

    columns.forEach((col, index) => {
        const div = document.createElement('div');
        div.className = 'col-item';
        div.innerHTML = `
            <div class="col-info">
                <i class="fas fa-grip-vertical"></i>
                <span>${col}</span>
            </div>
            <div class="actions">
                <button class="btn-tool" onclick="moveCol(${index}, -1)" title="Move Up"><i class="fas fa-chevron-up"></i></button>
                <button class="btn-tool" onclick="moveCol(${index}, 1)" title="Move Down"><i class="fas fa-chevron-down"></i></button>
                <button class="btn-tool" onclick="renameCol('${col}')" title="Rename"><i class="fas fa-edit"></i></button>
                <button class="btn-danger" onclick="deleteCol('${col}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
            </div>
        `;
        listContainer.appendChild(div);
    });

    // 2. Render JSON Summary instead of full code for large files
    const featureCount = geoData.features.length;
    
    // Check if total character count is likely to lag the browser (approx > 500KB)
    // Or if feature count is high.
    const approxSize = JSON.stringify(geoData).length;

    if (approxSize > 500000) {
        jsonDisplay.innerHTML = `
        <span style="color: #fbbf24;">// LARGE FILE MODE ENABLED</span>
        // Features: ${featureCount}
        // Approx Size: ${(approxSize / 1024 / 1024).toFixed(2)} MB

        // Full text preview is hidden to maintain performance.
        // All Geometry data is preserved in memory.
        // Use "Save" to apply schema changes to your file.

        {
          "type": "FeatureCollection",
          "features": [ 
            { 
              "type": "Feature",
              "properties": ${JSON.stringify(geoData.features[0].properties, null, 2)}
              "geometry": { ... (Geometry Hidden) ... }
               },
               ... 
              ]
            }`;
        } else {
            jsonDisplay.innerText = JSON.stringify(geoData, null, 2);
        }
    }
	
    function unloadData() {
    if (!geoData) return;
    if (confirm("Unload GeoJSON from memory? Unsaved changes will be lost.")) {
        geoData = null;
        fileHandle = null;
        document.getElementById('columnList').innerHTML = '<p>Data unloaded.</p>';
        document.getElementById('jsonDisplay').innerText = '// Awaiting data...';
        document.getElementById('status').innerText = 'No file loaded';
        document.title = "TabEdit";
      }
   }

    function addColumn() {
        const name = prompt("New Column Name:");
        if (name) {
            geoData.features.forEach(f => f.properties[name] = null);
            renderUI();
        }
    }

    function renameCol(oldName) {
        const newName = prompt("Rename to:", oldName);
        if (newName && newName !== oldName) {
            geoData.features.forEach(f => {
                f.properties[newName] = f.properties[oldName];
                delete f.properties[oldName];
            });
            renderUI();
        }
    }

    function deleteCol(name) {
        if (confirm(`Remove "${name}" from all features?`)) {
            geoData.features.forEach(f => delete f.properties[name]);
            renderUI();
        }
    }

    function moveCol(index, direction) {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= Object.keys(geoData.features[0].properties).length) return;
        geoData.features = geoData.features.map(f => {
            const entries = Object.entries(f.properties);
            const [item] = entries.splice(index, 1);
            entries.splice(newIndex, 0, item);
            f.properties = Object.fromEntries(entries);
            return f;
        });
        renderUI();
    }

    function copyJSON() {
        navigator.clipboard.writeText(document.getElementById('jsonDisplay').innerText);
    }

    
