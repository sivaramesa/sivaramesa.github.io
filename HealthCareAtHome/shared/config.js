/* config.js — central configuration for all three HealthCareAtHome PWAs.
 *
 * Fill these in with your real keys before deploying. Every value here is a
 * client-side key, so scope/restrict them appropriately in the respective
 * provider console (Firebase rules, Google Maps API key HTTP referrer
 * restrictions, payment gateway publishable key).
 *
 * This module is shared by the Client, Caregiver and Admin apps.
 */

export const CONFIG = {
  // ── Firebase (real-time sync + auth + FCM) ────────────────────────────────
  firebase: {
    apiKey: 'AIzaSyBTMDEulRJ85IGyjb-hL0osuInOLZHqw88',
    authDomain: 'healthcareathome-35727.firebaseapp.com',
    projectId: 'healthcareathome-35727',
    storageBucket: 'healthcareathome-35727.firebasestorage.app',
    messagingSenderId: '817661404081',
    appId: '1:817661404081:web:312f62164d1445270dd390'
  },

  // Web push (FCM) — VAPID public key from Firebase console › Cloud Messaging.
  fcmVapidKey: 'YOUR_FCM_VAPID_PUBLIC_KEY',

  // ── Google Maps Platform ──────────────────────────────────────────────────
  // Maps JavaScript API + Geocoding + Directions/Routes. Restrict by referrer.
  googleMapsApiKey: 'YOUR_GOOGLE_MAPS_API_KEY',

  // ── Payment gateway (publishable/checkout key only — never the secret) ─────
  payment: {
    provider: 'razorpay', // 'razorpay' | 'stripe' | 'mock'
    publishableKey: 'YOUR_PAYMENT_PUBLISHABLE_KEY',
    currency: 'INR'
  },

  // ── Business rules ────────────────────────────────────────────────────────
  rules: {
    // Default radius (km) used to match a booking to nearby caregivers.
    defaultMatchRadiusKm: 15,
    // How long a broadcast request stays open for caregivers to accept (min).
    requestExpiryMinutes: 10,
    // Live-location ping interval while a caregiver is travelling (ms).
    locationPingMs: 5000,
    // Platform commission taken by admin (fraction of service price).
    platformCommission: 0.15
  }
};
