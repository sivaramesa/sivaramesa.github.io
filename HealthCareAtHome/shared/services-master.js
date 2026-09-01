/* services-master.js — the Services master (admin-managed catalogue).
 *
 * Each service defines its display name, a stable `key` (the value stored on
 * bookings as `speciality`, matched against caregiver specialities), a default
 * cost, a commission percentage (default 15), and an active flag.
 *
 * Stored in the Firestore `services` collection. Seeded once from the six
 * original hardcoded specialities so nothing breaks on migration.
 */
import { db } from './firebase.js';
import {
  collection, doc, getDocs, setDoc, deleteDoc, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { uid } from './models.js';
import { CONFIG } from './config.js';

const COL = 'services';

/** Default commission percentage when a service doesn't specify one. */
export const DEFAULT_COMMISSION_PCT = Math.round((CONFIG.rules.platformCommission || 0.15) * 100);

/** The original hardcoded specialities, used to seed the master once. */
const SEED = [
  { key: 'nursing', name: 'Nursing', cost: 800 },
  { key: 'physiotherapy', name: 'Physiotherapy', cost: 700 },
  { key: 'elder_care', name: 'Elder Care', cost: 600 },
  { key: 'post_surgery', name: 'Post Surgery', cost: 900 },
  { key: 'baby_care', name: 'Baby Care', cost: 650 },
  { key: 'lab_sample', name: 'Lab Sample', cost: 300 }
];

export function createService({ name, key, cost = 0, commissionPct = DEFAULT_COMMISSION_PCT, active = true }) {
  return {
    id: uid('svc'),
    name,
    key: key || slug(name),
    cost: Number(cost) || 0,
    commissionPct: Number(commissionPct),
    active: !!active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function slug(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export const Services = {
  /** Seed the master from the original specialities if the collection is empty. */
  async seedDefaults() {
    const snap = await getDocs(collection(db, COL));
    if (!snap.empty) return false; // already has services — don't reseed
    for (const s of SEED) {
      const rec = createService({ name: s.name, key: s.key, cost: s.cost, commissionPct: DEFAULT_COMMISSION_PCT });
      await setDoc(doc(db, COL, rec.id), rec);
    }
    return true;
  },

  async all() {
    const snap = await getDocs(collection(db, COL));
    return snap.docs.map((d) => d.data());
  },

  /** Live subscription; fires with the full list on every change. */
  subscribe(cb) {
    return onSnapshot(collection(db, COL), (snap) => {
      cb(snap.docs.map((d) => d.data()));
    });
  },

  async save(service) {
    service.updatedAt = new Date().toISOString();
    await setDoc(doc(db, COL, service.id), service);
    return service;
  },

  async remove(id) {
    await deleteDoc(doc(db, COL, id));
  }
};

/**
 * Resolve the commission fraction (0..1) for a booking. Prefers the commission
 * snapshot stored on the booking at creation time; falls back to the current
 * service definition; finally to the global default.
 * @param {object} booking
 * @param {object[]} services  current services master (may be empty)
 */
export function commissionFractionFor(booking, services = []) {
  if (booking && typeof booking.commissionPct === 'number') {
    return booking.commissionPct / 100;
  }
  const svc = services.find((s) => s.key === (booking && booking.speciality));
  if (svc && typeof svc.commissionPct === 'number') return svc.commissionPct / 100;
  return CONFIG.rules.platformCommission || 0.15;
}
