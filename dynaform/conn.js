let connections = [];
//let savedImageScript = "";
//let savedDataScript = "";
const CONN_FILE = "conns.json";

document.addEventListener("DOMContentLoaded", loadConnectionsBySource);

function getSelectedSource() {
    const selected = document.querySelector('input[name="connSource"]:checked');
    return selected ? selected.value : "server";
}

async function loadConnectionsBySource() {
    const source = getSelectedSource();

    if (source === "server") {
        await loadFromServer();
    } else {
        await loadFromLocalDisk();
    }
}

async function loadFromServer() {
    try {
        const response = await fetch(CONN_FILE);
        if (!response.ok) {
            throw new Error("Server file not found");
        }
        const data = await response.json();
        connections = Array.isArray(data.profiles) ? data.profiles : [];
    } catch (e) {
        console.log("Server load failed", e);
        connections = [];
    }
    populateConnectionsDropdown();
}

async function loadFromLocalDisk() {
    if (!window.showOpenFilePicker) {
        alert("Your browser does not support File System Access API.");
        return;
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
        connections = Array.isArray(data.profiles) ? data.profiles : [];
    } catch (err) {
        console.log("Local file load cancelled", err);
        connections = [];
    }
    populateConnectionsDropdown();
}

function populateConnectionsDropdown() {
    const select = document.getElementById("connSelect");
    if (!select) return;
    select.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.textContent = "-- Select Connection --";
    defaultOption.value = "";
    select.appendChild(defaultOption);
    connections.forEach((conn, index) => {
        const opt = document.createElement("option");
        opt.value = index;
        opt.textContent = conn.name;
        select.appendChild(opt);
    });
}

function addConnection() {
    const modal = document.createElement("div");
    modal.id = "connModal";
    Object.assign(modal.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: "9999"
    });
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

    saveConnectionBySource();
    populateConnectionsDropdown();
    closeConnModal();
}

async function saveConnectionBySource() {
    const source = getSelectedSource();

    if (source === "local") {
        await saveConnectionsToFile();
    } else {
        await saveToServerLocation();
    }
}

async function saveToServerLocation() {
    alert(
        "Saving to server requires a server-side API.\n" +
        "Currently only local disk save is supported."
    );
}

function deleteConnection() {
    const select = document.getElementById("connSelect");
    if (!select || select.value === "") {
        alert("Please select a connection to delete");
        return;
    }
    if (!confirm("Are you sure you want to delete this connection?")) {
        return;
    }
    const index = parseInt(select.value);
    connections.splice(index, 1);
    saveConnectionBySource();
    populateConnectionsDropdown();
	select.value="";
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
        if (input) {
            input.value = conn.url;
            input.disabled = true;
        }
    }
    if (conn.scriptType === "Data") {
        const input = document.getElementById("dataScript");
        if (input) {
            input.value = conn.url;
            input.disabled = true;
        }
    }
}

async function saveConnectionsToFile() {
    if (!window.showSaveFilePicker) {
        alert("Your browser does not support File System Access API.");
        return;
    }
    const output = {
        app: "FOGS",
        type: "connections",
        version: "1.0",
        profiles: connections
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
    } catch (err) {
        console.log("Save cancelled", err);
    }
}

