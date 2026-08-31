/* firebase.js — shared Firebase bootstrap for all three PWAs.
 *
 * Initialises the app, Firestore (source of truth for cross-device data),
 * Auth (phone/OTP), and Messaging (FCM web push). Everything is loaded from
 * the pinned gstatic CDN build so no bundler is required — consistent with the
 * workspace's other PWAs.
 *
 * Firestore is the source of truth; db.js keeps a local IndexedDB mirror and
 * sync.js reconciles the two (per pwa-db-sync steering).
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { CONFIG } from './config.js';

export const app = initializeApp(CONFIG.firebase);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Firestore top-level collections shared by every app.
export const COLLECTION = Object.freeze({
  CLIENTS: 'clients',
  CAREGIVERS: 'caregivers',
  BOOKINGS: 'bookings',
  PAYMENTS: 'payments'
});
