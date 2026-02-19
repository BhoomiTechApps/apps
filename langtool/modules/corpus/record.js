// modules/corpus/record.js
import db from "../../services/db.js";

let stream = null;
let mediaRecorder = null;
let audioChunks = [];
let currentAudioBlob = null;

const recordsList = document.getElementById("records-list");
const paginationControls = document.getElementById("pagination-controls");
let recordTemplate = "";

let currentPage = 1;
const pageSize = 1;
let totalRecords = 0;

// --- Load template ---
async function loadTemplate() {
  if (!recordTemplate) {
    const res = await fetch("./modules/corpus/corpus.html");
    recordTemplate = await res.text();
  }
}

// --- Init DB & render ---
export async function initCorpusModule() {
  await db.init();
  await loadTemplate();
  totalRecords = await db.getRecordCount();
  await renderRecords();
}

// --- Microphone ---
export async function initMicrophone() {
  if (!stream) {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("Microphone initialized");
  }
}

export function startRecording() {
  if (!stream) throw new Error("Microphone not initialized");

  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
  mediaRecorder.start();
  console.log("Recording started");
}

export function stopRecording() {
  return new Promise(resolve => {
    mediaRecorder.onstop = () => {
      currentAudioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
      console.log("Recording stopped. Blob size:", currentAudioBlob.size);
      resolve(currentAudioBlob);
    };
    mediaRecorder.stop();
  });
}

// --- Add new record ---
export async function addNewRecord(text) {
  if (!currentAudioBlob) {
    alert("Please record audio first.");
    return false;
  }

  const record = {
    id: crypto.randomUUID(),
    text,
    audioBlob: currentAudioBlob,
    createdAt: Date.now(),
    synced: false
  };

  await db.addRecord(record);
  currentAudioBlob = null;
  totalRecords = await db.getRecordCount();
  await renderRecords();
  return true;
}

// --- Update audio for existing record ---
async function updateRecordAudio(id, newAudioBlob) {
  const record = await db.getRecord(id);
  if (!record) return;

  record.audioBlob = newAudioBlob;
  record.synced = false;
  await db.updateRecord(record);
  await renderRecords();
}

// --- Render paginated records ---
export async function renderRecords() {
  await loadTemplate();

  const records = await db.getRecordsByPage(currentPage, pageSize);
  recordsList.innerHTML = "";

  if (!records || records.length === 0) {
    recordsList.innerHTML = "<p>No records yet.</p>";
    return;
  }

  records.forEach(record => {
  let html = recordTemplate
    .replace("{{id}}", record.id)
    .replace("{{audioUrl}}", record.audioBlob ? URL.createObjectURL(record.audioBlob) : "")
    .replace("{{text}}", record.text || "")
    .replace("{{createdAt}}", new Date(record.createdAt).toLocaleString())
    .replace("{{syncStatus}}", record.synced ? "✓ Synced" : "• Local");

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  recordsList.appendChild(tempDiv.firstElementChild);
  });

  renderPaginationControls();
  renderPaginationControls();
}

// --- Pagination controls ---
function renderPaginationControls() {
  if (!paginationControls) return;

  const totalPages = Math.ceil(totalRecords / pageSize);

  paginationControls.innerHTML = "";
  if (totalPages <= 1) return;

  const prevBtn = document.createElement("button");
  prevBtn.textContent = "Previous";
  prevBtn.disabled = currentPage === 1;
  prevBtn.addEventListener("click", () => {
    if (currentPage > 1) { currentPage--; renderRecords(); }
  });

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "Next";
  nextBtn.disabled = currentPage >= totalPages;
  nextBtn.addEventListener("click", () => {
    if (currentPage < totalPages) { currentPage++; renderRecords(); }
  });

  const pageInfo = document.createElement("span");
  pageInfo.textContent = ` Page ${currentPage} of ${totalPages} `;

  paginationControls.appendChild(prevBtn);
  paginationControls.appendChild(pageInfo);
  paginationControls.appendChild(nextBtn);
}

// --- Handle Re-record / Delete / Sync / Export clicks ---
recordsList.addEventListener("click", async e => {
  const card = e.target.closest(".record-card");
  if (!card) return;
  const id = card.dataset.id;

  // Delete
  if (e.target.classList.contains("delete-btn")) {
    await db.deleteRecord(id);
    totalRecords = await db.getRecordCount();
    if ((currentPage - 1) * pageSize >= totalRecords && currentPage > 1) {
      currentPage--;
    }
    await renderRecords();
    return;
  }

  // Re-record
  if (e.target.classList.contains("re-record-btn")) {
    try {
      await initMicrophone();
    } catch {
      return alert("Microphone permission required.");
    }

    startRecording();
    e.target.textContent = "Stop Recording";

    const onStop = async () => {
      await stopRecording();
      updateRecordAudio(id, currentAudioBlob);
      e.target.textContent = "Re-record";
      e.target.removeEventListener("click", onStop);
    };

    e.target.addEventListener("click", onStop);
    return;
  }

  // Sync button placeholder
  if (e.target.classList.contains("sync-btn")) {
    console.log("Sync clicked for record:", id);
    return;
  }

  // Export record
  if (e.target.classList.contains("export-btn")) {
    const record = await db.getRecord(id);
    if (!record) return;

    // Export audio
    if (record.audioBlob) {
      const audioUrl = URL.createObjectURL(record.audioBlob);
      const a = document.createElement("a");
      a.href = audioUrl;
      a.download = `${record.text || 'record'}-${record.id}.webm`;
      a.click();
      URL.revokeObjectURL(audioUrl);
    }

    // Export text
    if (record.text) {
      const textBlob = new Blob([record.text], { type: 'text/plain' });
      const aText = document.createElement("a");
      aText.href = URL.createObjectURL(textBlob);
      aText.download = `${record.text || 'record'}-${record.id}.txt`;
      aText.click();
      URL.revokeObjectURL(aText.href);
    }
    return;
  }
});
