/* Entries data layer - income & expense records with Firestore sync + local
 * IndexedDB mirror.
 *
 * Each entry records:
 *   - type: 'income' | 'expense'
 *   - accountId: the account head / project it belongs to
 *   - amount: the base (taxable) amount
 *   - optional GST: gstEnabled, gstRate (%), gstAmount, totalAmount
 *   - WHO created it (createdBy), WHEN it happened (date), createdAt
 *   - optional photo proof
 */
import {
  collection,
  onSnapshot,
  query,
  orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-config.js';
import { DB } from './db.js';
import { PhotoStore } from './storage.js';
import { Auth } from './auth.js';
import { Sync } from './sync.js';
import { uuid, nowIso, localInputToIso } from './utils.js';

const COLLECTION = 'entries';

/** Compute GST + total from a base amount and rate. */
export function computeGst(amount, gstEnabled, gstRate) {
  const base = Number(amount) || 0;
  if (!gstEnabled) {
    return { gstEnabled: false, gstRate: 0, gstAmount: 0, totalAmount: base };
  }
  const rate = Number(gstRate) || 0;
  const gstAmount = +(base * (rate / 100)).toFixed(2);
  return {
    gstEnabled: true,
    gstRate: rate,
    gstAmount,
    totalAmount: +(base + gstAmount).toFixed(2)
  };
}

export const Entries = {
  _unsub: null,

  /**
   * Create an income or expense entry.
   * @param {object} input {
   *   type, accountId, amount, category, description, dateTimeLocal,
   *   gstEnabled, gstRate
   * }
   * @param {File} [photoFile]
   */
  async create(input, photoFile) {
    const who = Auth.currentProfile();
    if (!who) throw new Error('You must be signed in.');

    const type = input.type === 'income' ? 'income' : 'expense';
    const id = uuid();
    const dateIso =
      input.dateIso || localInputToIso(input.dateTimeLocal) || nowIso();
    const gst = computeGst(input.amount, input.gstEnabled, input.gstRate);

    const record = {
      id,
      type,
      accountId: input.accountId || null,
      amount: Number(input.amount),      // base / taxable amount
      category: input.category || (type === 'income' ? 'Income' : 'Other'),
      description: (input.description || '').trim(),
      date: dateIso,
      gstEnabled: gst.gstEnabled,
      gstRate: gst.gstRate,
      gstAmount: gst.gstAmount,
      totalAmount: gst.totalAmount,      // amount + GST
      createdBy: who,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      photoPath: null,
      photoUrl: null
    };

    if (photoFile) {
      try {
        const { path, url } = await PhotoStore.upload(who.uid, id, photoFile);
        record.photoPath = path;
        record.photoUrl = url;
      } catch (e) {
        console.warn('Photo upload failed, saving without proof:', e && e.message);
      }
    }

    // Write local mirror immediately, then queue the push. If online, kick
    // off a flush right away; if offline, it stays queued until reconnect.
    await DB.putEntry(record);
    await DB.queueOp({ collection: COLLECTION, op: 'set', docId: id, payload: record });
    Sync.flush();
    return record;
  },

  async update(id, patch) {
    patch.updatedAt = nowIso();
    const existing = await DB.getEntry(id);
    const merged = { ...(existing || { id }), ...patch };
    await DB.putEntry(merged);
    // Queue a full-document set so the replay is self-contained.
    await DB.queueOp({ collection: COLLECTION, op: 'set', docId: id, payload: merged });
    Sync.flush();
  },

  async remove(id) {
    const existing = await DB.getEntry(id);
    await DB.deleteEntry(id);
    await DB.queueOp({ collection: COLLECTION, op: 'delete', docId: id });
    Sync.flush();
    // Photo cleanup is best-effort and only meaningful when online.
    if (existing && existing.photoPath && navigator.onLine) {
      await PhotoStore.remove(existing.photoPath);
    }
  },

  async getAllLocal() {
    return DB.getAllEntries();
  },

  subscribe(onData, onError) {
    this.unsubscribe();
    const q = query(collection(db, COLLECTION), orderBy('date', 'desc'));
    this._unsub = onSnapshot(
      q,
      async (snap) => {
        const list = [];
        snap.forEach((d) => list.push(d.data()));
        try {
          await DB.clearEntries();
          if (list.length) await DB.putEntries(list);
        } catch (e) {
          console.warn('Local mirror refresh failed:', e && e.message);
        }
        onData(list);
      },
      (err) => {
        console.warn('Entries subscription error:', err && err.message);
        if (onError) onError(err);
      }
    );
    return this._unsub;
  },

  unsubscribe() {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
  }
};
