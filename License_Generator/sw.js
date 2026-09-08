const CACHE_NAME = 'license-generator-v5';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './firebase-config.js',
  './firestore-sync.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Firebase / Google network traffic. The Firestore SDK, its
  // long-poll/websocket channels, and the gstatic module CDN must always go
  // straight to the network so sync stays live and auth tokens aren't stale.
  const isFirebaseTraffic =
    url.hostname.endsWith('googleapis.com') ||
    url.hostname.endsWith('gstatic.com') ||
    url.hostname.endsWith('firebaseio.com') ||
    url.hostname.endsWith('firebaseapp.com') ||
    url.hostname.endsWith('firebasestorage.app');

  if (isFirebaseTraffic) {
    // Network-only. If offline, the SDK's own IndexedDB persistence handles it.
    event.respondWith(fetch(event.request));
    return;
  }

  // Same-origin app shell: cache-first with network fallback.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
