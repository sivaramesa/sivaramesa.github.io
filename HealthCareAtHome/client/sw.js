/* Service worker — HomeCare Client PWA.
 *
 * Strategy:
 *   - Pre-cache the app shell (local files) on install.
 *   - Navigations: network-first, fall back to cached index.html (offline SPA).
 *   - Same-origin GETs (incl. ../shared/* modules): cache-first with runtime fill.
 *   - Cross-origin (Firebase CDN / Google Maps / gstatic): network only — never
 *     cache opaque third-party responses.
 */
const CACHE = 'homecare-client-v16';
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
  '../shared/aadhaar.js',
  '../shared/imaging.js',
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

// Allow the page to tell a waiting SW to activate immediately.
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Cross-origin (CDN/maps/firebase) — go straight to network.
  if (!sameOrigin) return;

  // Navigations + code/style assets: NETWORK-FIRST so updates always take
  // effect on reload; fall back to cache only when offline. This prevents
  // stale app.js/config.js being served after a deploy.
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

  // Everything else (images/icons): cache-first for speed.
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
