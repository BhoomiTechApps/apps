// services/db.js

console.log("db.js loaded");
const DB_NAME = "langtoolDB";
const DB_VERSION = 1;
const STORE_NAME = "records";

class LangToolDB {
  constructor() {
    this.db = null;
  }

  async init() {
	console.log("Initializing DB...");  
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: "id"
          });

          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("synced", "synced", { unique: false });
        }
      };

      request.onsuccess = (event) => {
		console.log("DB opened successfully");  
        this.db = event.target.result;
        resolve();
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  async addRecord(record) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);

      const request = store.add(record);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getAllRecords() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);

      const request = store.getAll();

      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteRecord(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);

      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async markSynced(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);

      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const data = getRequest.result;
        if (!data) return reject("Record not found");

        data.synced = true;

        const updateRequest = store.put(data);

        updateRequest.onsuccess = () => resolve();
        updateRequest.onerror = (e) => reject(e.target.error);
      };

      getRequest.onerror = (e) => reject(e.target.error);
    });
  }
}

export default new LangToolDB();
