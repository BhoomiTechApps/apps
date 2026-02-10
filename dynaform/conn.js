let connections = [];
const CONN_FILE = "conns.json";

document.addEventListener("DOMContentLoaded", () => {
    initConnections();
});

async function initConnections() {
    try {
        const response = await fetch(CONN_FILE);
        const data = await response.json();
        if (Array.isArray(data.profiles)) {
            connections = data.profiles;
        } else {
            connections = [];
        }
    } catch (e) {
        connections = [];
    }
    populateConnectionsDropdown();
}

function populateConnectionsDropdown() {
    const select = document.getElementById("connSelect");
    if (!select) return;
    select.innerHTML = "";
    let defaultOption = document.createElement("option");
    defaultOption.textContent = "-- Select Connection --";
    defaultOption.value = "";
    select.appendChild(defaultOption);
    connections.forEach((conn, index) => {
        let opt = document.createElement("option");
        opt.value = index;
        opt.textContent = conn.name;
        select.appendChild(opt);
    });
}

function addConnection() {
    let modal = document.createElement("div");
    modal.id = "connModal";
    modal.style.position = "fixed";
    modal.style.top = "0";
    modal.style.left = "0";
    modal.style.width = "100%";
    modal.style.height = "100%";
    modal.style.background = "rgba(0,0,0,0.5)";
    modal.style.display = "flex";
    modal.style.alignItems = "center";
    modal.style.justifyContent = "center";
    modal.style.zIndex = "9999";
    modal.innerHTML = `
    <div style="background:#fff;padding:20px;border-radius:10px;width:400px;">
        <h3>Add New Connection</h3>
        <label>Name</label>
        <input id="connName" style="width:100%;margin-bottom:10px;">
        <label>Script Type</label>
        <select id="connType" style="width:100%;margin-bottom:10px;">
            <option value="Image">Image</option>
            <option value="Data">Data</option>
        </select>
        <label>Script URL</label>
        <input id="connURL" style="width:100%;margin-bottom:10px;">
        <div style="display:flex;gap:10px;">
            <button onclick="saveConnection()">Save</button>
            <button onclick="closeConnModal()">Cancel</button>
        </div>
    </div>
    `;
    document.body.appendChild(modal);
}

function closeConnModal() {
    const modal = document.getElementById("connModal");
    if (modal) modal.remove();
}

function saveConnection() {
    const name = document.getElementById("connName").value.trim();
    const type = document.getElementById("connType").value;
    const url = document.getElementById("connURL").value.trim();
    if (!name || !url) {
        alert("Please enter name and URL");
        return;
    }
    connections.push({
        name: name,
        scriptType: type,
        url: url
    });
    saveConnectionsToFile();
    populateConnectionsDropdown();
    closeConnModal();
}

function deleteConnection() {
    const select = document.getElementById("connSelect");
    if (!select || select.value === "") {
        alert("Please select a connection to delete");
        return;
    }
    if (!confirm("Are you sure you want to delete this connection?"))
        return;
    const index = parseInt(select.value);
    connections.splice(index, 1);
    saveConnectionsToFile();
    populateConnectionsDropdown();
}

function loadConnection() {
    const select = document.getElementById("connSelect");
    if (!select || select.value === "") {
        alert("Please select a connection to load");
        return;
    }
    const conn = connections[select.value];
    if (conn.scriptType === "Image") {
        const input = document.getElementById("imageScript");
        input.value = conn.url;
        input.disabled = true;
        savedImageScript = conn.url;
    }
    if (conn.scriptType === "Data") {
        const input = document.getElementById("dataScript");
        input.value = conn.url;
        input.disabled = true;
        savedDataScript = conn.url;
    }
}

async function saveConnectionsToFile(newProfile = null) {
    let existingProfiles = [];

    const loaded = await loadExistingConnectionsFromFile();
    if (loaded) {
        existingProfiles = loaded;
    }
    if (newProfile) {
        existingProfiles.push(newProfile);
    } else {
        existingProfiles = connections;
    }
    const output = {
        app: "FOGS",
        type: "connections",
        version: "1.0",
        profiles: existingProfiles
    };
    const jsonText = JSON.stringify(output, null, 2);
    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: "conns.json",
            types: [{
                description: "JSON File",
                accept: { "application/json": [".json"] }
            }]
        });
        const writable = await handle.createWritable();
        await writable.write(jsonText);
        await writable.close();
        alert("Connections saved successfully!");
        connections = existingProfiles;
        populateConnectionsDropdown();
    } catch (err) {
        console.log("Save cancelled", err);
    }
}

async function loadExistingConnectionsFromFile() {
    if (!window.showOpenFilePicker) {
        alert("Your browser does not support File System Access API.");
        return null;
    }
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{
                description: "JSON File",
                accept: { "application/json": [".json"] }
            }]
        });
        const file = await handle.getFile();
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.profiles && Array.isArray(data.profiles)) {
            return data.profiles;
        } else {
            alert("Invalid conns.json structure");
            return null;
        }
    } catch (err) {
        console.log("File open cancelled", err);
        return null;
    }
}
