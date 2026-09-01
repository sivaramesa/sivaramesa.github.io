/* pwa-update.js — service-worker registration + "update available" banner.
 *
 * Shared by all three apps. Registers ./sw.js, watches for a newly installed
 * service worker waiting to activate, and shows a small banner inviting the
 * user to update. Tapping it tells the waiting SW to skipWaiting (the SWs
 * listen for the 'SKIP_WAITING' message) and reloads once the new SW takes
 * control — so a deploy reaches open sessions without a manual hard-refresh.
 */

function showUpdateBanner(onUpdate) {
  if (document.getElementById('hc-update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'hc-update-banner';
  bar.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:10000;display:flex;align-items:center;' +
    'justify-content:center;gap:14px;padding:12px 16px;background:#0f172a;color:#fff;' +
    'font:14px system-ui,sans-serif;box-shadow:0 -2px 10px rgba(0,0,0,.2);';
  bar.innerHTML =
    '<span>A new version is available.</span>' +
    '<button id="hc-update-btn" style="background:#1a73e8;color:#fff;border:none;' +
    'border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer">Update</button>' +
    '<button id="hc-update-dismiss" style="background:transparent;color:#cbd5e1;border:none;' +
    'cursor:pointer">Later</button>';
  document.body.appendChild(bar);
  document.getElementById('hc-update-btn').addEventListener('click', onUpdate);
  document.getElementById('hc-update-dismiss').addEventListener('click', () => bar.remove());
}

/**
 * Register the service worker and wire update detection.
 * Call once at app startup.
 */
export function registerWithUpdates(swUrl = './sw.js') {
  if (!('serviceWorker' in navigator)) return;

  let refreshing = false;
  // When the new SW takes control, reload once to load the fresh assets.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.register(swUrl).then((reg) => {
    // If a worker is already waiting (installed while the page was open).
    if (reg.waiting) {
      showUpdateBanner(() => reg.waiting.postMessage('SKIP_WAITING'));
    }

    // A new worker started installing — show the banner once it's installed
    // AND there's an existing controller (i.e. it's an update, not first load).
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(() => nw.postMessage('SKIP_WAITING'));
        }
      });
    });
  }).catch(() => {/* SW registration failed — app still works online */});
}
