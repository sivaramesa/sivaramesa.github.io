/* notify.js — notifications: Firebase Cloud Messaging (web push) + in-app toast.
 *
 * Cross-device push (waking a caregiver's phone when a request is broadcast)
 * requires a server to send FCM messages to stored device tokens. This module:
 *   - registers the device for FCM and stores the token on the user record,
 *   - exposes toClient / toCaregivers helpers that (a) show an immediate in-app
 *     notification if that user is the current device, and (b) enqueue a push
 *     intent your backend/Cloud Function delivers to their FCM token.
 *
 * The real-time onSnapshot feed (sync.js) already updates every open app
 * instantly; FCM is what reaches users whose app is closed/backgrounded.
 */
import { app } from './firebase.js';
import { CONFIG } from './config.js';
import { getMessaging, getToken, onMessage }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';

let _messaging = null;
let _toastHost = null;

function ensureToastHost() {
  if (_toastHost) return _toastHost;
  const host = document.createElement('div');
  host.id = 'hc-toast-host';
  host.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:340px;';
  document.body.appendChild(host);
  _toastHost = host;
  return host;
}

export const Notify = {
  /** In-app toast (works with no push permission). */
  toast(title, body, kind = 'info') {
    const host = ensureToastHost();
    const el = document.createElement('div');
    const color = kind === 'error' ? '#c62828' : kind === 'success' ? '#2e7d32' : '#1a73e8';
    el.style.cssText =
      `background:#fff;border-left:4px solid ${color};box-shadow:0 2px 10px rgba(0,0,0,.15);` +
      'border-radius:8px;padding:10px 14px;font:14px system-ui,sans-serif;animation:hcfade .2s;';
    el.innerHTML = `<strong style="display:block;margin-bottom:2px">${title}</strong><span>${body || ''}</span>`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  },

  /**
   * Ask permission and register this device for FCM. Stores the token on the
   * given user record via the provided saver (so a backend can push later).
   */
  async registerDevice(saveToken) {
    try {
      if (!('serviceWorker' in navigator) || !('Notification' in window)) return null;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return null;
      _messaging = _messaging || getMessaging(app);
      const token = await getToken(_messaging, { vapidKey: CONFIG.fcmVapidKey });
      if (token && typeof saveToken === 'function') await saveToken(token);
      // foreground messages -> show as toast
      onMessage(_messaging, (payload) => {
        const n = payload.notification || {};
        this.toast(n.title || 'Notification', n.body || '');
      });
      return token;
    } catch (e) {
      console.warn('FCM registration skipped:', e && e.message);
      return null;
    }
  },

  /**
   * Notify one client. On this device it toasts immediately; for other devices,
   * a backend delivers the push to the client's stored FCM token. We record the
   * intent under the booking so the Admin dashboard shows the audit trail and a
   * Cloud Function can fan it out.
   */
  async toClient(clientId, msg) {
    this.toast(msg.title, msg.body, 'info');
    await this._enqueuePush('client', [clientId], msg);
  },

  /** Notify every eligible caregiver of a broadcast request. */
  async toCaregivers(caregivers, msg) {
    this.toast(msg.title, `${msg.body} (${caregivers.length} caregivers alerted)`, 'info');
    await this._enqueuePush('caregiver', caregivers.map((c) => c.id), msg);
  },

  /**
   * Placeholder for the server hand-off. In production, write a doc to a
   * `pushQueue` collection (or call an HTTPS Cloud Function) that looks up each
   * recipient's FCM token and sends the message. Here we just log it.
   */
  async _enqueuePush(role, recipientIds, msg) {
    try {
      console.info('[push intent]', { role, recipientIds, ...msg });
      // Example server hand-off (uncomment once your Cloud Function exists):
      // await Data.write('pushQueue', { id: uid('push'), role, recipientIds, ...msg, at: nowIso() });
    } catch (_) {}
  }
};
