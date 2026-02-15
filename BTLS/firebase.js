import { initializeApp } from 
"https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import { getFirestore } 
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { getAuth } 
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBhDODHvzxAWPXuxrKA_aZfKHZbGXbXF2k",
  authDomain: "bhoomitech-field.firebaseapp.com",
  projectId: "bhoomitech-field",
  storageBucket: "bhoomitech-field.firebasestorage.app",
  messagingSenderId: "815695507485",
  appId: "1:815695507485:web:6e9d8d6112d6ef9173d6f4"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
