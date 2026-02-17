import { initializeApp } from 
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getStorage, ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getFirestore, collection, addDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
  const firebaseConfig = {
    apiKey: "AIzaSyBhDODHvzxAWPXuxrKA_aZfKHZbGXbXF2k",
    authDomain: "bhoomitech-field.firebaseapp.com",
    projectId: "bhoomitech-field",
    storageBucket: "bhoomitech-field.firebasestorage.app",
    messagingSenderId: "815695507485",
    appId: "1:815695507485:web:6e9d8d6112d6ef9173d6f4"
  };
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const storage = getStorage(app);
  
  window.manualSync = async function() {
  if (!navigator.onLine) {
    alert("You are offline. Please connect to internet before syncing.");
    return;
  }
  const localData = await getAllLocalData();
  if (!localData.length) {
    alert("No pending records to sync.");
    return;
  }
  if (!confirm(`You have ${localData.length} record(s). Start sync?`)) {
    return;
  }
  alert("Starting sync...");
  let syncedCount = 0;
  for (let record of localData) {
    try {
      let imageUrl = null;
      if (record.imageBlob) {
        const imageRef = ref(storage, `submissions/${record.id}.jpg`);
        await uploadBytes(imageRef, record.imageBlob);
        imageUrl = await getDownloadURL(imageRef);
      }
      await addDoc(collection(db, "submissions"), {
        name: record.name,
        phone: record.phone,
        description: record.description,
        lat: record.lat,
        lng: record.lng,
        imageUrl,
        timestamp: serverTimestamp()
      });
      deleteLocalRecord(record.id);
      syncedCount++;
    } catch (error) {
      console.error("Sync failed for record:", record.id, error);
    }
  }
  alert(`Sync complete. ${syncedCount} record(s) uploaded.`);
};

  window.submitData = async function() {
  const name = document.getElementById('name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const description = document.getElementById('description').value.trim();
  const lat = parseFloat(document.getElementById('lat').value);
  const lng = parseFloat(document.getElementById('lng').value);
  const photoFile = document.getElementById('photo').files[0];
  if (!name || !phone || isNaN(lat) || isNaN(lng)) {
    alert("Please complete all required fields.");
    return;
  }
  let imageBlob = null;
  if (photoFile) {
    imageBlob = await resizeImage(photoFile);
  }
  const record = {
    id: Date.now(),
    name,
    phone,
    description,
    lat,
    lng,
    imageBlob,
    synced: false,
    timestamp: new Date()
  };
  await saveLocally(record);
  alert("Saved locally. Click Sync Now when internet is available.");
  location.reload();
};
  
  async function resizeImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = function(e) {
      img.src = e.target.result;
    };
    img.onload = function() {
      const canvas = document.createElement("canvas");
      const maxWidth = 300;
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = height * (maxWidth / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        resolve(blob);
      }, "image/jpeg", 0.8);
    };
    reader.readAsDataURL(file);
  });
}