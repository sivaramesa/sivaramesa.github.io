/* Firebase initialization (modular SDK v10, loaded from CDN as ES modules).
 *
 * SETUP REQUIRED:
 *   1. Create a Firebase project at https://console.firebase.google.com
 *   2. Enable: Authentication (Email/Password), Firestore Database, Storage
 *   3. Copy your web app config into `firebaseConfig` below.
 *
 * Firestore offline persistence is enabled so the app works offline and
 * syncs automatically when the connection returns.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  browserLocalPersistence,
  setPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

// -------------------------------------------------------------------------
// TODO: Replace with your own Firebase project config.
// -------------------------------------------------------------------------
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID'
};

export const isConfigured =
  firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_');

const app = initializeApp(firebaseConfig);

// Firestore with persistent offline cache (multi-tab safe).
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// Auth with local persistence so the session survives reloads.
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((e) =>
  console.warn('Auth persistence not available:', e && e.message)
);

export const storage = getStorage(app);

export { app };
