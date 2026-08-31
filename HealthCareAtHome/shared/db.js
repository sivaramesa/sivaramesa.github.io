/* db.js — local IndexedDB mirror + offline outbox for all three PWAs.
 *
 * Firestore is the source of truth; this store gives instant local reads and
 * offline resilience. Writes go local-first, then enqueue an outbox op that
 * sync.js replays to Firestore (see pwa-db-sync steering).
 *
 * Stores: clients, caregivers, bookings, payments (keyPath 'id') + outbox.
 */

const DB_NAME = 'HealthCareAtHome';
const DB_VERSION = 1;

const STORES = ['clients', 'caregivers', 'bookings', 'payments'];
const STORE_OUTBOX = 'outbox';

let _db = null;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      for (const name of STORES) {
        if (!idb.objectStoreNames.contains(name)) {
          idb.createObjectStore(name, { keyPath: 'id' });
        }
      }
      if (!idb.objectStoreNames.contains(STORE_OUTBOX)) {
        idb.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStore(name, mode = 'readonly') {
  if (!_db) _db = await open();
  return _db.transaction(name, mode).objectStore(name);
}

export const DB = {
  async init() {
    if (!_db) _db = await open();
    return _db;
  },

  // ── generic CRUD against any mirrored collection ──────────────────────────
  async put(collection, record) {
    const store = await getStore(collection, 'readwrite');
    return requestToPromise(store.put(record));
  },

  async putMany(collection, records) {
    const store = await getStore(collection, 'readwrite');
    await Promise.all((records || []).map((r) => requestToPromise(store.put(r))));
  },

  async get(collection, id) {
    const store = await getStore(collection);
    return requestToPromise(store.get(id));
  },

  async getAll(collection) {
    const store = await getStore(collection);
    return (await requestToPromise(store.getAll())) || [];
  },

  async remove(collection, id) {
    const store = await getStore(collection, 'readwrite');
    return requestToPromise(store.delete(id));
  },

  async clear(collection) {
    const store = await getStore(collection, 'readwrite');
    return requestToPromise(store.clear());
  },

  // ── bookings convenience reads ────────────────────────────────────────────
  async getBookingsByClient(clientId) {
    const all = await this.getAll('bookings');
    return all
      .filter((b) => b.clientId === clientId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  },

  async getBookingsByCaregiver(caregiverId) {
    const all = await this.getAll('bookings');
    return all
      .filter((b) => b.caregiverId === caregiverId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  },

  async getBookingsByStatus(status) {
    const all = await this.getAll('bookings');
    return all.filter((b) => b.status === status);
  },

  // ── outbox (offline write queue) ──────────────────────────────────────────
  // Op shape: { id, seq, collection, op:'set'|'delete', docId, payload, queuedAt }
  async queueOp(op) {
    const store = await getStore(STORE_OUTBOX, 'readwrite');
    if (op.id == null) op.id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (op.seq == null) op.seq = Date.now();
    if (op.queuedAt == null) op.queuedAt = new Date().toISOString();
    return requestToPromise(store.put(op));
  },

  async getOutbox() {
    const store = await getStore(STORE_OUTBOX);
    const all = (await requestToPromise(store.getAll())) || [];
    return all.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  },

  async outboxCount() {
    const store = await getStore(STORE_OUTBOX);
    return requestToPromise(store.count());
  },

  async removeOp(id) {
    const store = await getStore(STORE_OUTBOX, 'readwrite');
    return requestToPromise(store.delete(id));
  }
};
