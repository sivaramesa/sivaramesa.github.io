/*
 * Firebase initialization for the License Generator.
 *
 * Uses the Firebase v10 modular SDK loaded from the gstatic CDN as an ES module.
 * Because the rest of the app (app.js, firestore-sync.js) is written as classic
 * (non-module) scripts, this file bootstraps Firebase inside a module and then
 * publishes the pieces the app needs on `window.__fb`. A readiness Promise
 * (`window.__fbReady`) lets non-module code await initialization.
 *
 * NOTE: The apiKey below is a public Firebase Web API key. It is safe to expose
 * in client code, but it does NOT authorize access on its own -- access is
 * controlled by Firestore Security Rules. See FIREBASE_SETUP.md for the rules
 * you must apply in the Firebase console.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  enableIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCRlCR4RT1bC1RcsK7eWQ7dag8LtaZfY7w',
  authDomain: 'licensegen-b7c9c.firebaseapp.com',
  projectId: 'licensegen-b7c9c',
  storageBucket: 'licensegen-b7c9c.firebasestorage.app',
  messagingSenderId: '517216783333',
  appId: '1:517216783333:web:de2a7bb5183bab468e3d0c'
};

let resolveReady, rejectReady;
window.__fbReady = new Promise(function (resolve, reject) {
  resolveReady = resolve;
  rejectReady = reject;
});

try {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const auth = getAuth(app);

  // Keep the user signed in across reloads/sessions.
  setPersistence(auth, browserLocalPersistence).catch(function (err) {
    console.warn('[firebase] auth persistence unavailable:', err && err.code);
  });

  // Enable offline persistence so the tool keeps working without a connection.
  // Fails silently if multiple tabs are open or the browser doesn't support it.
  enableIndexedDbPersistence(db).catch(function (err) {
    console.warn('[firebase] IndexedDB persistence unavailable:', err && err.code);
  });

  // Publish the SDK surface the sync layer + auth gate need onto a single global.
  window.__fb = {
    app: app,
    db: db,
    auth: auth,
    collection: collection,
    doc: doc,
    getDoc: getDoc,
    getDocs: getDocs,
    setDoc: setDoc,
    deleteDoc: deleteDoc,
    onSnapshot: onSnapshot,
    writeBatch: writeBatch,
    serverTimestamp: serverTimestamp,
    // auth helpers
    onAuthStateChanged: function (cb) { return onAuthStateChanged(auth, cb); },
    signInWithEmail: function (email, password) { return signInWithEmailAndPassword(auth, email, password); },
    signOutUser: function () { return signOut(auth); }
  };

  resolveReady(window.__fb);
  console.log('[firebase] initialized for project', firebaseConfig.projectId);
} catch (e) {
  console.error('[firebase] initialization failed:', e);
  rejectReady(e);
}
