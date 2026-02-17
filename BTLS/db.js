let localDb;
const DB_NAME = "BhoomiTechOfflineDB";
const STORE_NAME = "submissions";
const request = indexedDB.open(DB_NAME, 1);

request.onupgradeneeded = function(event) {
  localDb = event.target.result;
  localDb.createObjectStore(STORE_NAME, { keyPath: "id" });
};

request.onsuccess = function(event) {
  localDb = event.target.result;
  console.log("IndexedDB Ready");
};

request.onerror = function() {
  console.error("IndexedDB Error");
};

function saveLocally(data) {
  return new Promise((resolve, reject) => {
    const tx = localDb.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(data);
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}

function getAllLocalData() {
  return new Promise((resolve, reject) => {
    const tx = localDb.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = reject;
  });
}

function deleteLocalRecord(id) {
  const tx = localDb.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
}