/* Local IndexedDB cache layer.
 *
 * Follows the project's PWA DB conventions:
 *   - promise-based wrapper exposing a single `DB` object
 *   - keyPath: 'id' for all stores, IDs generated client-side
 *   - onupgradeneeded creates stores defensively
 *   - ISO-8601 string timestamps on records
 *
 * Firestore is the source of truth and handles cross-device sync; this
 * store gives us a fast local read cache plus an outbox for writes that
 * were made while offline (belt-and-suspenders alongside Firestore's own
 * offline queue).
 */

const DB_NAME = 'ExpenseTracker';
const DB_VERSION = 2;

const STORE_ENTRIES = 'entries';   // income + expense records (mirror of Firestore)
const STORE_ACCOUNTS = 'accounts'; // account heads / projects
const STORE_OUTBOX = 'outbox';     // pending operations made while offline

let _db = null;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;

      // v1 used a store called 'expenses'; drop it in favour of 'entries'.
      if (idb.objectStoreNames.contains('expenses')) {
        idb.deleteObjectStore('expenses');
      }

      if (!idb.objectStoreNames.contains(STORE_ENTRIES)) {
        const s = idb.createObjectStore(STORE_ENTRIES, { keyPath: 'id' });
        s.createIndex('date', 'date', { unique: false });
        s.createIndex('accountId', 'accountId', { unique: false });
        s.createIndex('type', 'type', { unique: false });
        s.createIndex('createdByUid', 'createdBy.uid', { unique: false });
      }
      if (!idb.objectStoreNames.contains(STORE_ACCOUNTS)) {
        const a = idb.createObjectStore(STORE_ACCOUNTS, { keyPath: 'id' });
        a.createIndex('name', 'name', { unique: false });
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

  // ---- entries (income + expense) ----
  async putEntry(entry) {
    const store = await getStore(STORE_ENTRIES, 'readwrite');
    return requestToPromise(store.put(entry));
  },

  async putEntries(entries) {
    const store = await getStore(STORE_ENTRIES, 'readwrite');
    await Promise.all(entries.map((e) => requestToPromise(store.put(e))));
  },

  async getEntry(id) {
    const store = await getStore(STORE_ENTRIES);
    return requestToPromise(store.get(id));
  },

  async getAllEntries() {
    const store = await getStore(STORE_ENTRIES);
    const all = await requestToPromise(store.getAll());
    return (all || []).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },

  async deleteEntry(id) {
    const store = await getStore(STORE_ENTRIES, 'readwrite');
    return requestToPromise(store.delete(id));
  },

  async clearEntries() {
    const store = await getStore(STORE_ENTRIES, 'readwrite');
    return requestToPromise(store.clear());
  },

  // ---- accounts (account heads / projects) ----
  async putAccount(account) {
    const store = await getStore(STORE_ACCOUNTS, 'readwrite');
    return requestToPromise(store.put(account));
  },

  async putAccounts(accounts) {
    const store = await getStore(STORE_ACCOUNTS, 'readwrite');
    await Promise.all(accounts.map((a) => requestToPromise(store.put(a))));
  },

  async getAllAccounts() {
    const store = await getStore(STORE_ACCOUNTS);
    const all = await requestToPromise(store.getAll());
    return (all || []).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  },

  async deleteAccount(id) {
    const store = await getStore(STORE_ACCOUNTS, 'readwrite');
    return requestToPromise(store.delete(id));
  },

  async clearAccounts() {
    const store = await getStore(STORE_ACCOUNTS, 'readwrite');
    return requestToPromise(store.clear());
  },

  // ---- outbox (offline write queue) ----
  //
  // Each op describes a pending mutation to replay against Firestore:
  //   { id, seq, collection: 'entries'|'accounts', op: 'set'|'delete',
  //     docId, payload, queuedAt }
  // `seq` gives a stable replay order (FIFO) even across reloads.

  async queueOp(op) {
    const store = await getStore(STORE_OUTBOX, 'readwrite');
    if (op.id == null) op.id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (op.seq == null) op.seq = Date.now();
    if (op.queuedAt == null) op.queuedAt = new Date().toISOString();
    return requestToPromise(store.put(op));
  },

  /** All pending ops, oldest first. */
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
