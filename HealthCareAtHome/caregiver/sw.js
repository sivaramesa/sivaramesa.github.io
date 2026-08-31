/* Service worker — HomeCare Caregiver PWA. See client/sw.js for strategy notes. */
const CACHE = 'homecare-caregiver-v2';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  '../shared/styles.css',
  '../shared/models.js',
  '../shared/config.js',
  '../shared/firebase.js',
  '../shared/db.js',
  '../shared/sync.js',
  '../shared/lifecycle.js',
  '../shared/notify.js',
  '../shared/payments.js',
  '../shared/maps.js',
  '../shared/geo.js',
  '../shared/codes.js',
  '../shared/auth.js',
  '../shared/icons/icon-192.png',
  '../shared/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDN/maps/firebase -> network

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
