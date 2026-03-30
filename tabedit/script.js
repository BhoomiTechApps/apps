
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
        if (!geoData || !geoData.features.length) return;
        const columns = Object.keys(geoData.features[0].properties);
        const listContainer = document.getElementById('columnList');
        listContainer.innerHTML = '';
        columns.forEach((col, index) => {
            const div = document.createElement('div');
            div.className = 'col-item';
            div.innerHTML = `
                <div class="col-info">
                    <i class="fas fa-ellipsis-v"></i>
                    <span>${col}</span>
                </div>
                <div class="actions">
                    <button class="btn-tool" onclick="moveCol(${index}, -1)" title="Move Up"><i class="fas fa-chevron-up"></i></button>
                    <button class="btn-tool" onclick="moveCol(${index}, 1)" title="Move Down"><i class="fas fa-chevron-down"></i></button>
                    <button class="btn-tool" onclick="renameCol('${col}')" title="Rename"><i class="fas fa-pen"></i></button>
                    <button class="btn-danger" onclick="deleteCol('${col}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
                </div>
            `;
            listContainer.appendChild(div);
        });
        document.getElementById('jsonDisplay').innerText = JSON.stringify(geoData, null, 2);
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

    
