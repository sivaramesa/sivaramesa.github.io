/* Sync engine.
 *
 * Implements explicit reconciliation:
 *   1. PUSH  - replay every pending op from the local outbox to Firestore
 *              (creates/updates/deletes that were made while offline).
 *   2. PULL  - read the authoritative data straight from the Firebase server
 *              and REPLACE the local IndexedDB mirror with it.
 *
 * This runs at startup (when online) and on every reconnect. The real-time
 * onSnapshot subscriptions keep things fresh afterwards; this module handles
 * the "catch up after being offline" case deterministically.
 */
import { db } from './firebase-config.js';
import {
  doc,
  setDoc,
  deleteDoc,
  collection,
  getDocsFromServer
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { DB } from './db.js';
import { applyPendingAttachmentPatches } from './entries.js';

const COLLECTIONS = {
  // `transform` lets a collection overlay local state onto the server list
  // before it replaces the mirror. Entries use it so an in-flight attachment
  // upload isn't nulled back out by this pull (see entries.js).
  entries: {
    clear: () => DB.clearEntries(),
    putMany: (x) => DB.putEntries(x),
    transform: (list) => applyPendingAttachmentPatches(list)
  },
  accounts: { clear: () => DB.clearAccounts(), putMany: (x) => DB.putAccounts(x) }
};

export const Sync = {
  _flushing: false,
  _rerun: false,
  _listeners: new Set(),

  /** Subscribe to sync-status updates. cb({ syncing, pending, error }). */
  onStatus(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  },

  async _emit(extra = {}) {
    let pending = 0;
    try { pending = await DB.outboxCount(); } catch (_) {}
    const status = { syncing: this._flushing, pending, ...extra };
    this._listeners.forEach((cb) => {
      try { cb(status); } catch (_) {}
    });
    return status;
  },

  /**
   * Push all pending local ops to Firebase, then replace the local mirror
   * with a fresh server read. Safe to call repeatedly: a call that arrives
   * while a flush is already running doesn't no-op (that used to drop the
   * request entirely - e.g. the background attachment-upload patch queued
   * right after the initial entry save - and the still-running flush's pull
   * step would then overwrite the local mirror with the stale, pre-patch
   * data). Instead it asks the in-flight flush to loop once more so nothing
   * queued gets lost.
   * @returns {{pushed:number, pulled:number, failed:number}|null}
   */
  async flush() {
    if (this._flushing) {
      this._rerun = true;
      return null;
    }
    if (!navigator.onLine) {
      await this._emit();
      return null;
    }
    this._flushing = true;
    await this._emit();

    let pushed = 0;
    let pulled = 0;
    let failed = 0;
    do {
      this._rerun = false;
      try {
        pushed += await this._pushOutbox();
      } catch (e) {
        console.warn('Outbox push failed:', e && e.message);
        failed++;
      }

      try {
        pulled += await this._pullReplace();
      } catch (e) {
        // Offline reads still resolve from cache in the subscription; a failed
        // server read here just means we keep the current mirror.
        console.warn('Server pull failed:', e && e.message);
        failed++;
      }
    } while (this._rerun);

    this._flushing = false;
    await this._emit({ error: failed ? 'partial' : null });
    return { pushed, pulled, failed };
  },

  /** Step 1: replay pending ops (FIFO). Removes each op once it succeeds. */
  async _pushOutbox() {
    const ops = await DB.getOutbox();
    let pushed = 0;
    for (const op of ops) {
      try {
        if (op.op === 'delete') {
          await deleteDoc(doc(db, op.collection, op.docId));
        } else {
          // 'set' (create or full update) - payload is the whole document.
          await setDoc(doc(db, op.collection, op.docId), op.payload);
        }
        await DB.removeOp(op.id);
        pushed++;
        await this._emit();
      } catch (e) {
        // Leave the op queued and stop; we'll retry on the next flush.
        console.warn('Op replay failed, will retry:', op.collection, op.docId, e && e.message);
        break;
      }
    }
    return pushed;
  },

  /** Step 2: read from server and REPLACE the local mirror. */
  async _pullReplace() {
    let total = 0;
    for (const [name, api] of Object.entries(COLLECTIONS)) {
      const snap = await getDocsFromServer(collection(db, name));
      let list = [];
      snap.forEach((d) => list.push(d.data()));
      if (api.transform) list = api.transform(list);
      await api.clear();
      if (list.length) await api.putMany(list);
      total += list.length;
    }
    return total;
  }
};
