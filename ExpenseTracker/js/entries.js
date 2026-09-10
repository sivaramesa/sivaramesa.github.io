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
import { AttachmentStore } from './storage.js';
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
   * @param {File[]} [attachmentFiles] one or more images/files; bundled into
   *   a single .zip and uploaded to Storage.
   */
  async create(input, attachmentFiles) {
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
      attachmentPath: null,   // Storage path of the .zip bundle
      attachmentUrl: null,    // download URL of the .zip
      attachmentCount: 0      // number of files inside the zip
    };

    const files = attachmentFiles ? Array.from(attachmentFiles) : [];

    // Save the entry locally and queue the sync FIRST so it appears instantly.
    // The photo upload can be slow on mobile data, so we do NOT block the save
    // on it: the entry is written now and the attachment is uploaded in the
    // background, patching the record (and re-queuing) once it completes.
    // attachmentCount stays 0 until the upload actually confirms.
    await DB.putEntry(record);
    await DB.queueOp({ collection: COLLECTION, op: 'set', docId: id, payload: record });
    Sync.flush();

    if (files.length) {
      this._uploadInBackground(who.uid, id, files);
    }
    return record;
  },

  /**
   * Upload an entry's attachment bundle without blocking the save. When the
   * upload finishes, patch the stored entry with the path/url/count and
   * re-queue it for sync. Failures are non-fatal - the entry keeps its data.
   */
  async _uploadInBackground(uid, id, files) {
    try {
      const res = await AttachmentStore.uploadZip(uid, id, files);
      const current = await DB.getEntry(id);
      if (!current) return; // entry was deleted while uploading
      const patched = {
        ...current,
        attachmentPath: res ? res.path : null,
        attachmentUrl: res ? res.url : null,
        attachmentCount: res ? res.count : 0,
        updatedAt: nowIso()
      };
      await DB.putEntry(patched);
      await DB.queueOp({ collection: COLLECTION, op: 'set', docId: id, payload: patched });
      Sync.flush();
    } catch (e) {
      // Attachments are optional - don't lose the entry over an upload failure.
      console.warn('Background attachment upload failed:', e && e.message);
    }
  },

  async update(id, patch) {
    patch.updatedAt = nowIso();
    const existing = await DB.getEntry(id);
    const merged = { ...(existing || { id }), ...patch };
    await DB.putEntry(merged);
    // Queue a full-document set so the replay is self-contained.
    await DB.queueOp({ collection: COLLECTION, op: 'set', docId: id, payload: merged });
    Sync.flush();
    return merged;
  },

  /**
   * Edit an entry's fields and its attachment set.
   * @param {string} id
   * @param {object} patch  field changes (gst is recomputed if amount/gst change)
   * @param {object} [attachments] resolved attachment set:
   *   { kept: [{name,data}], added: File[], changed: boolean }
   *   - changed=false: leave the existing bundle untouched
   *   - changed=true : rebuild from kept+added (empty => remove the bundle)
   */
  async edit(id, patch, attachments) {
    const who = Auth.currentProfile();
    if (!who) throw new Error('You must be signed in.');
    const existing = await DB.getEntry(id);
    if (!existing) throw new Error('Entry not found.');

    const amount = patch.amount != null ? Number(patch.amount) : existing.amount;
    const gstEnabled = patch.gstEnabled != null ? patch.gstEnabled : existing.gstEnabled;
    const gstRate = patch.gstRate != null ? patch.gstRate : existing.gstRate;
    const gst = computeGst(amount, gstEnabled, gstRate);

    const next = {
      ...existing,
      ...patch,
      amount,
      gstEnabled: gst.gstEnabled,
      gstRate: gst.gstRate,
      gstAmount: gst.gstAmount,
      totalAmount: gst.totalAmount,
      updatedAt: nowIso()
    };

    if (attachments && attachments.changed) {
      const kept = attachments.kept || [];
      const added = attachments.added || [];
      try {
        const res = await AttachmentStore.rebuildZip(who.uid, id, kept, added);
        if (res) {
          next.attachmentPath = res.path;
          next.attachmentUrl = res.url;
          next.attachmentCount = res.count;
        } else {
          // Final set is empty -> remove the bundle entirely.
          if (existing.attachmentPath) await AttachmentStore.remove(existing.attachmentPath);
          next.attachmentPath = null;
          next.attachmentUrl = null;
          next.attachmentCount = 0;
        }
      } catch (e) {
        console.warn('Attachment rebuild failed:', e && e.message);
        throw new Error('Could not update attachments: ' + (e && e.message));
      }
    }

    await DB.putEntry(next);
    await DB.queueOp({ collection: COLLECTION, op: 'set', docId: id, payload: next });
    Sync.flush();
    return next;
  },

  async remove(id) {
    const existing = await DB.getEntry(id);
    await DB.deleteEntry(id);
    await DB.queueOp({ collection: COLLECTION, op: 'delete', docId: id });
    Sync.flush();
    // Attachment cleanup is best-effort and only meaningful when online.
    if (existing && existing.attachmentPath && navigator.onLine) {
      await AttachmentStore.remove(existing.attachmentPath);
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
