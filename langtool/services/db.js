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
    if (this.db) return; // prevent re-init

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

        // Close DB if version changes elsewhere
        this.db.onversionchange = () => {
          this.db.close();
          console.warn("DB closed due to version change.");
        };

        resolve();
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  ensureDB() {
    if (!this.db) {
      throw new Error("Database not initialized. Call init() first.");
    }
  }

  // --- CRUD Methods ---
  async addRecord(record) {
    this.ensureDB();

    if (!record.id) record.id = crypto.randomUUID();
    if (!record.createdAt) record.createdAt = Date.now();
    record.synced = record.synced ?? false;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.add(record);

      request.onsuccess = () => resolve(record.id);
      request.onerror = (e) => reject(e.target.error);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async updateRecord(record) {
    this.ensureDB();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async getRecord(id) {
    this.ensureDB();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteRecord(id) {
    this.ensureDB();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async markSynced(id) {
    this.ensureDB();

    const record = await this.getRecord(id);
    if (!record) throw new Error("Record not found");

    record.synced = true;
    return this.updateRecord(record);
  }

  async clearAll() {
    this.ensureDB();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  // --- Pagination Methods ---
  async getRecordsByPage(page = 1, limit = 1) {
    this.ensureDB();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("createdAt");

      const records = [];
      let count = 0;
      const offset = (page - 1) * limit;

      index.openCursor(null, "prev").onsuccess = e => {
        const cursor = e.target.result;
        if (cursor && count < offset + limit) {
          if (count >= offset) records.push(cursor.value);
          count++;
          cursor.continue();
        } else {
          resolve(records);
        }
      };

      tx.onerror = e => reject(e.target.error);
    });
  }

  async getRecordCount() {
    this.ensureDB();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }
}

export default new LangToolDB();
