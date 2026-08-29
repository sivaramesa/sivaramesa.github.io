/* Expense Tracker - Service Worker
 * App-shell caching for offline use. Firebase SDK + API calls are
 * network-first (Firestore has its own offline persistence).
 */
const CACHE_VERSION = 'ledger-tracker-v9';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/firebase-config.js',
  './js/auth.js',
  './js/db.js',
  './js/entries.js',
  './js/accounts.js',
  './js/sync.js',
  './js/storage.js',
  './js/zip.js',
  './js/crop.js',
  './js/reports.js',
  './js/ui.js',
  './js/utils.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Cache each asset individually so a single 404 (e.g. a path/case
      // mismatch on the host) can't fail the whole install.
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((e) => console.warn('SW: could not cache', url, e && e.message))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache Firebase / Google API traffic - let it hit the network.
  if (/(googleapis|gstatic|firebaseio|firebaseapp|firebase)\.com/.test(url.hostname)) {
    return;
  }

  // App shell + local assets: cache-first, fall back to network, then cache the response.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => cached);
      })
    );
  }
});
