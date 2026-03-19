import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAE8uB_nVBvZnCXNjrFikbULzj_GSWBSuI",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "wrytoff.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "wrytoff",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "wrytoff.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "384739962766",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:384739962766:web:ccade7ce6b6211d5bd3edf"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
