/* Service worker — HomeCare Admin PWA. See client/sw.js for strategy notes. */
const CACHE = 'homecare-admin-v38';
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
  '../shared/settings.js',
  '../shared/pwa-update.js',
  '../shared/services-master.js',
  '../shared/geo.js',
  '../shared/codes.js',
  '../shared/auth.js',
  '../shared/dom.js',
  '../shared/theme.js',
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

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDN/maps/firebase -> network

  // Navigations + code/style: network-first so updates apply on reload.
  const isCode = /\.(?:js|css|json)$/.test(url.pathname);
  if (req.mode === 'navigate' || isCode) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Images/icons: cache-first.
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
