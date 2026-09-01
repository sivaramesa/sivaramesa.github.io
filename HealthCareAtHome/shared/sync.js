/* sync.js — reconcile engine + real-time subscriptions.
 *
 * Two responsibilities:
 *   1. Deterministic catch-up after being offline (the two-phase flush from the
 *      pwa-db-sync steering): PUSH the outbox, then PULL & REPLACE the mirror.
 *   2. Live updates during a session via Firestore onSnapshot — this is the
 *      real-time channel that powers request broadcast, live location and
 *      status changes across the Client / Caregiver / Admin apps (the role the
 *      spec assigned to WebSockets/SignalR).
 *
 * Data-layer writes should go through Data.write() (below) which is local-first
 * + outbox, never a bare awaited Firestore write.
 */
import { db, COLLECTION } from './firebase.js';
import {
  doc, setDoc, deleteDoc, collection, getDocsFromServer, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { DB } from './db.js';

const MIRRORED = [COLLECTION.CLIENTS, COLLECTION.CAREGIVERS, COLLECTION.BOOKINGS, COLLECTION.PAYMENTS];

export const Sync = {
  _flushing: false,
  _statusListeners: new Set(),
  _subs: new Map(),        // collection -> unsubscribe fn
  _feed: new Map(),        // collection -> Set(callback)

  // ── status indicator (green/amber/spinner/red) ────────────────────────────
  onStatus(cb) {
    this._statusListeners.add(cb);
    return () => this._statusListeners.delete(cb);
  },

  async _emitStatus(extra = {}) {
    let pending = 0;
    try { pending = await DB.outboxCount(); } catch (_) {}
    const status = { syncing: this._flushing, pending, online: navigator.onLine, ...extra };
    this._statusListeners.forEach((cb) => { try { cb(status); } catch (_) {} });
    return status;
  },

  /**
   * Merge a server list with local records that still have an UNCONFIRMED write
   * queued in the outbox. A stale server snapshot (e.g. an echo of an earlier
   * write) must not clobber a newer local write that hasn't flushed yet —
   * otherwise a just-changed status (e.g. arrived) can revert. For any docId
   * with a pending outbox op, the local payload wins.
   */
  async _mergeWithPending(collectionName, serverList) {
    let pendingIds = new Set();
    let pendingById = new Map();
    try {
      const ops = await DB.getOutbox();
      for (const op of ops) {
        if (op.collection !== collectionName) continue;
        if (op.op === 'delete') { pendingIds.add(op.docId); pendingById.delete(op.docId); }
        else { pendingIds.add(op.docId); if (op.payload) pendingById.set(op.docId, op.payload); }
      }
    } catch (_) { return serverList; }
    if (pendingIds.size === 0) return serverList;

    const merged = serverList.filter((r) => !pendingIds.has(r.id)); // drop stale server copies of pending docs
    for (const rec of pendingById.values()) merged.push(rec);        // keep our unconfirmed writes
    return merged;
  },

  // ── two-phase flush ───────────────────────────────────────────────────────
  async flush() {
    if (this._flushing) return null;
    if (!navigator.onLine) { await this._emitStatus(); return null; }
    this._flushing = true;
    await this._emitStatus();

    let pushed = 0, failed = 0, pulled = 0;
    try { pushed = await this._pushOutbox(); }
    catch (e) { console.warn('push failed', e && e.message); failed++; }

    try { pulled = await this._pullReplace(); }
    catch (e) { console.warn('pull failed', e && e.message); failed++; }

    this._flushing = false;
    await this._emitStatus({ error: failed ? 'partial' : null });
    return { pushed, pulled, failed };
  },

  async _pushOutbox() {
    const ops = await DB.getOutbox();
    let pushed = 0;
    for (const op of ops) {
      try {
        if (op.op === 'delete') {
          await deleteDoc(doc(db, op.collection, op.docId));
        } else {
          await setDoc(doc(db, op.collection, op.docId), op.payload);
        }
        await DB.removeOp(op.id);
        pushed++;
        await this._emitStatus();
      } catch (e) {
        // stop on first failure; retry on next flush (records stay queued)
        console.warn('op replay failed, will retry', op.collection, op.docId, e && e.message);
        break;
      }
    }
    return pushed;
  },

  /**
   * PULL & REPLACE: read the authoritative data from Firebase and replace the
   * local mirror with it, then push the fresh list to subscribers so the UI
   * converges to server truth. Each collection is handled independently — a
   * failed server read for one collection leaves that collection's mirror
   * untouched (we do NOT clear before the read succeeds) and does not abort
   * the others.
   */
  async _pullReplace() {
    let total = 0;
    for (const name of MIRRORED) {
      try {
        const snap = await getDocsFromServer(collection(db, name));
        const raw = [];
        snap.forEach((d) => raw.push(d.data()));
        // keep any locally-pending (unconfirmed) writes from being reverted
        const list = await this._mergeWithPending(name, raw);
        // only clear once we actually have the server copy in hand
        await DB.clear(name);
        if (list.length) await DB.putMany(name, list);
        total += list.length;
        await this.notify(name); // reflect the authoritative data in the UI
      } catch (e) {
        // keep the current mirror for this collection; retry on the next flush
        console.warn('pull skipped (kept local mirror)', name, e && e.message);
      }
    }
    return total;
  },

  // ── real-time subscriptions ───────────────────────────────────────────────
  /**
   * Subscribe to live changes on a collection. The callback receives the full
   * current array whenever anything changes. Also keeps the local mirror fresh.
   * Multiple subscribers to the same collection share one Firestore listener.
   */
  subscribe(collectionName, cb) {
    if (!this._feed.has(collectionName)) this._feed.set(collectionName, new Set());
    this._feed.get(collectionName).add(cb);

    if (!this._subs.has(collectionName)) {
      const unsub = onSnapshot(collection(db, collectionName), async (snap) => {
        const raw = [];
        snap.forEach((d) => raw.push(d.data()));
        // don't let a stale snapshot echo revert an unconfirmed local write
        const list = await this._mergeWithPending(collectionName, raw);
        // refresh mirror so offline reads stay current
        try { await DB.clear(collectionName); if (list.length) await DB.putMany(collectionName, list); } catch (_) {}
        for (const fn of this._feed.get(collectionName)) {
          try { fn(list); } catch (_) {}
        }
      }, (err) => console.warn('snapshot error', collectionName, err && err.message));
      this._subs.set(collectionName, unsub);
    }

    // fire once immediately from the local mirror for instant paint
    DB.getAll(collectionName).then((list) => { try { cb(list); } catch (_) {} });

    // return an unsubscribe that tears down the shared listener when last leaves
    return () => {
      const set = this._feed.get(collectionName);
      if (!set) return;
      set.delete(cb);
      if (set.size === 0) {
        const unsub = this._subs.get(collectionName);
        if (unsub) unsub();
        this._subs.delete(collectionName);
        this._feed.delete(collectionName);
      }
    };
  },

  /**
   * Push the current local-mirror contents of a collection to every subscriber.
   * Called right after a local write so the UI updates instantly, without
   * waiting for the Firestore onSnapshot round-trip.
   */
  async notify(collectionName) {
    const set = this._feed.get(collectionName);
    if (!set || set.size === 0) return;
    const list = await DB.getAll(collectionName);
    for (const fn of set) { try { fn(list); } catch (_) {} }
  },

  /** Wire automatic flush on startup and reconnect. Call once per app. */
  start() {
    window.addEventListener('online', () => this.flush());
    window.addEventListener('offline', () => this._emitStatus());
    if (navigator.onLine) this.flush();
    this._emitStatus();
  }
};

/**
 * Data facade — the only write path apps should use. Local-first + outbox.
 * Reads come from the mirror (instant) or a live subscription.
 */
export const Data = {
  /** Upsert a record: write mirror now, queue Firestore set, fire-and-forget flush. */
  async write(collectionName, record) {
    await DB.put(collectionName, record);
    await DB.queueOp({ collection: collectionName, op: 'set', docId: record.id, payload: record });
    await Sync.notify(collectionName);   // update the UI immediately (local-first)
    Sync.flush();
    return record;
  },

  async remove(collectionName, id) {
    await DB.remove(collectionName, id);
    await DB.queueOp({ collection: collectionName, op: 'delete', docId: id });
    await Sync.notify(collectionName);   // update the UI immediately (local-first)
    Sync.flush();
  },

  get: (c, id) => DB.get(c, id),
  getAll: (c) => DB.getAll(c),
  subscribe: (c, cb) => Sync.subscribe(c, cb)
};
