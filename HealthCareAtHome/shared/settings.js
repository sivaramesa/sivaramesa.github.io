/* settings.js — platform-wide admin settings, stored in Firestore at
 * settings/app so every app sees changes in real time.
 *
 * Currently holds the location-verification policy:
 *   - locationVerification: when true, a caregiver may only start/complete a
 *     service while physically within `verifyRadiusMeters` of the service
 *     location. When false, no location check (and null coordinates allowed).
 *   - verifyRadiusMeters: the allowed proximity in metres (admin-configurable).
 *
 * Defaults are applied in memory so the apps work even before the doc exists.
 */
import { db } from './firebase.js';
import {
  doc, getDoc, setDoc, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const SETTINGS_DOC = ['settings', 'app'];

export const DEFAULT_SETTINGS = Object.freeze({
  locationVerification: false,
  verifyRadiusMeters: 50,
  // Priority booking
  bookingLeadHours: 4,          // minimum lead time for a normal booking
  priorityMode: 'multiplier',   // 'multiplier' | 'percent' | 'flat'
  priorityValue: 1.5,           // multiplier: ×1.5 | percent: +50% | flat: +₹/recipient
  // Which caregiver location the matching uses when broadcasting/filtering.
  // 'gps' = live shared location, 'registered' = profile operating location,
  // 'both' = eligible if EITHER is within range (OR).
  matchLocationMode: 'gps',
  // Admin-configurable cancellation reason codes (an "Other" free-text option
  // is always offered by the apps in addition to these).
  cancelReasons: ['No Show of Caregiver', 'Client requested', 'Priority changes']
});

/**
 * Compute the priority price for a base amount.
 * @param {number} base      the normal total (unit × recipients)
 * @param {number} recipients recipient count (for flat surcharge per person)
 * @param {object} s         settings
 */
export function priorityPrice(base, recipients, s) {
  const mode = (s && s.priorityMode) || 'multiplier';
  const val = Number((s && s.priorityValue) ?? 1.5);
  if (mode === 'flat') return Math.round(base + val * Math.max(1, recipients));
  if (mode === 'percent') return Math.round(base * (1 + val / 100));
  return Math.round(base * (val || 1)); // multiplier
}

function withDefaults(data) {
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}

export const Settings = {
  _current: { ...DEFAULT_SETTINGS },
  _listeners: new Set(),

  /** Best-effort cached snapshot (safe to read synchronously). */
  current() {
    return this._current;
  },

  /** One-shot read from Firestore, falling back to defaults. */
  async load() {
    try {
      const snap = await getDoc(doc(db, ...SETTINGS_DOC));
      this._current = withDefaults(snap.exists() ? snap.data() : null);
    } catch (_) {
      this._current = { ...DEFAULT_SETTINGS };
    }
    return this._current;
  },

  /** Live subscription; fires immediately with the current value. */
  subscribe(cb) {
    this._listeners.add(cb);
    // start a single shared snapshot listener on first subscriber
    if (!this._unsub) {
      this._unsub = onSnapshot(doc(db, ...SETTINGS_DOC), (snap) => {
        this._current = withDefaults(snap.exists() ? snap.data() : null);
        this._listeners.forEach((fn) => { try { fn(this._current); } catch (_) {} });
      }, (_) => {/* offline: keep cached */});
    }
    // fire once right away with what we have
    try { cb(this._current); } catch (_) {}
    return () => this._listeners.delete(cb);
  },

  /** Admin update (merge). */
  async update(patch) {
    const next = withDefaults({ ...this._current, ...patch });
    await setDoc(doc(db, ...SETTINGS_DOC), next, { merge: true });
    this._current = next;
    return next;
  }
};
