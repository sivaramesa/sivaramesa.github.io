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

/* Attachment patches that completed locally but may not yet be reflected in
 * the data the server hands back. Both the real-time onSnapshot subscription
 * and Sync's pull-and-replace rewrite the ENTIRE local mirror from the server;
 * if one of those lands in the window between "entry saved (attachmentPath
 * null)" and "attachment-upload patch propagated to the server", it would
 * clobber the just-uploaded attachment back to null - so after add-then-edit
 * the attachment appears to have vanished.
 *
 * We remember each entry's resolved attachment fields here and overlay them
 * onto any incoming server list until the server copy actually carries the
 * same attachmentPath, at which point the guard is cleared.
 *   id -> { attachmentPath, attachmentUrl, attachmentCount }
 */
const pendingAttachmentPatches = new Map();

/**
 * Overlay any pending attachment patches onto a list of entries coming from
 * the server, so a full-mirror replace can't reset a freshly-uploaded
 * attachment back to null. Clears a guard once the server copy has caught up.
 * Mutates nothing; returns a new list.
 */
export function applyPendingAttachmentPatches(list) {
  if (!pendingAttachmentPatches.size) return list;
  return (list || []).map((entry) => {
    const patch = pendingAttachmentPatches.get(entry.id);
    if (!patch) return entry;
    // Server has caught up (it now reports the same bundle) -> drop the guard.
    if (entry.attachmentPath === patch.attachmentPath) {
      pendingAttachmentPatches.delete(entry.id);
      return entry;
    }
    // Server copy is still stale (missing/old attachment) -> keep our version.
    return { ...entry, ...patch };
  });
}

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
  // Tracks each entry's in-flight background attachment upload (id -> Promise),
  // so remove()/edit() can coordinate with it instead of racing it.
  _uploads: new Map(),
  // Entry ids deleted while their upload was still running; the upload
  // cleans up its own Storage zip when it lands instead of leaking it.
  _pendingDeletes: new Set(),

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
   *
   * Tracked in `_uploads` for the entry's id so remove()/edit() can wait on
   * or react to it instead of racing the same Storage path / entry record.
   */
  _uploadInBackground(uid, id, files) {
    const task = this._runUpload(uid, id, files);
    this._uploads.set(id, task);
    task.finally(() => {
      if (this._uploads.get(id) === task) this._uploads.delete(id);
    });
    return task;
  },

  async _runUpload(uid, id, files) {
    try {
      const res = await AttachmentStore.uploadZip(uid, id, files);
      if (this._pendingDeletes.delete(id)) {
        // The entry was deleted while this upload was running - clean up the
        // zip we just uploaded instead of leaking it in Storage forever.
        if (res) await AttachmentStore.remove(res.path);
        return;
      }
      const current = await DB.getEntry(id);
      if (!current) return; // entry was deleted while uploading
      const patched = {
        ...current,
        attachmentPath: res ? res.path : null,
        attachmentUrl: res ? res.url : null,
        attachmentCount: res ? res.count : 0,
        updatedAt: nowIso()
      };
      // Guard this attachment against being wiped by a snapshot/pull mirror
      // replace that still carries the pre-upload (null) server copy. The
      // guard self-clears once the server reports the same attachmentPath.
      pendingAttachmentPatches.set(id, {
        attachmentPath: patched.attachmentPath,
        attachmentUrl: patched.attachmentUrl,
        attachmentCount: patched.attachmentCount
      });
      await DB.putEntry(patched);
      await DB.queueOp({ collection: COLLECTION, op: 'set', docId: id, payload: patched });
      Sync.flush();
      console.info('Attachment upload done for', id, '-> count', patched.attachmentCount);
      this._emitAttachmentResult({ id, ok: true, count: patched.attachmentCount });
    } catch (e) {
      // Attachments are optional - don't lose the entry over an upload failure.
      console.warn('Background attachment upload failed:', e && e.message);
      this._emitAttachmentResult({ id, ok: false, error: (e && e.message) || 'upload failed' });
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

    // Save the text/amount/GST changes IMMEDIATELY and let the (potentially
    // slow) attachment rebuild happen in the background - mirroring create().
    // Blocking the save on Storage uploads was what made the edit screen look
    // frozen on a slow connection. The attachment fields keep their current
    // values for now; the background task patches them once the zip lands.
    await DB.putEntry(next);
    await DB.queueOp({ collection: COLLECTION, op: 'set', docId: id, payload: next });
    Sync.flush();

    if (attachments && attachments.changed) {
      this._rebuildAttachmentsInBackground(who.uid, id, {
        kept: attachments.kept || [],
        added: attachments.added || [],
        hadAttachmentAtOpen: !!attachments.hadAttachmentAtOpen,
        prevPath: existing.attachmentPath || null,
        prevUrl: existing.attachmentUrl || null
      });
    }
    return next;
  },

  /**
   * Rebuild + upload an edited entry's attachment bundle without blocking the
   * save. Tracked in `_uploads` so remove()/a subsequent edit can coordinate
   * with it. On completion it patches the stored entry's attachment fields and
   * re-queues it for sync; failures leave the entry's data intact.
   */
  _rebuildAttachmentsInBackground(uid, id, plan) {
    // If an earlier upload/rebuild for this entry is still running, chain
    // after it so the two don't race to overwrite the same Storage zip path.
    const prior = this._uploads.get(id);
    const run = Promise.resolve(prior)
      .catch(() => {})
      .then(() => this._runRebuild(uid, id, plan));
    this._uploads.set(id, run);
    run.finally(() => {
      if (this._uploads.get(id) === run) this._uploads.delete(id);
    });
    return run;
  },

  // Optional UI callback: cb({ id, ok, count, error }) fired when a background
  // attachment rebuild/upload settles, so the UI can confirm or warn.
  _onAttachmentResult: null,
  onAttachmentResult(cb) { this._onAttachmentResult = cb; },
  _emitAttachmentResult(info) {
    if (this._onAttachmentResult) {
      try { this._onAttachmentResult(info); } catch (_) {}
    }
  },

  async _runRebuild(uid, id, plan) {
    try {
      let kept = plan.kept;

      // Edit opened before the original upload had attached anything, but it
      // has since landed - fold those files in instead of discarding them.
      if (!plan.hadAttachmentAtOpen && plan.prevPath) {
        try {
          const already = await AttachmentStore.fetchAttachments(plan.prevPath, plan.prevUrl);
          kept = already.map((f) => ({ name: f.name, data: f.data })).concat(kept);
        } catch (e) {
          console.warn('Could not merge newly-landed attachment before edit:', e && e.message);
        }
      }

      const res = await AttachmentStore.rebuildZip(uid, id, kept, plan.added);

      if (this._pendingDeletes.delete(id)) {
        // Entry was deleted while this rebuild ran - clean up what we uploaded.
        if (res) await AttachmentStore.remove(res.path);
        return;
      }

      const current = await DB.getEntry(id);
      if (!current) return; // deleted while rebuilding

      let patched;
      if (res) {
        patched = { ...current, attachmentPath: res.path, attachmentUrl: res.url, attachmentCount: res.count, updatedAt: nowIso() };
        pendingAttachmentPatches.set(id, {
          attachmentPath: res.path,
          attachmentUrl: res.url,
          attachmentCount: res.count
        });
      } else {
        // Final set empty -> drop the bundle.
        if (plan.prevPath) await AttachmentStore.remove(plan.prevPath);
        patched = { ...current, attachmentPath: null, attachmentUrl: null, attachmentCount: 0, updatedAt: nowIso() };
        pendingAttachmentPatches.delete(id);
      }
      await DB.putEntry(patched);
      await DB.queueOp({ collection: COLLECTION, op: 'set', docId: id, payload: patched });
      Sync.flush();
      console.info('Attachment rebuild done for', id, '-> count', patched.attachmentCount);
      this._emitAttachmentResult({ id, ok: true, count: patched.attachmentCount });
    } catch (e) {
      console.warn('Background attachment rebuild failed:', e && e.message);
      this._emitAttachmentResult({ id, ok: false, error: (e && e.message) || 'upload failed' });
    }
  },

  async remove(id) {
    const existing = await DB.getEntry(id);
    // Drop any attachment guard so the overlay can't resurrect a deleted entry.
    pendingAttachmentPatches.delete(id);
    await DB.deleteEntry(id);
    await DB.queueOp({ collection: COLLECTION, op: 'delete', docId: id });
    Sync.flush();

    if (this._uploads.has(id)) {
      // Its attachment upload is still running (attachmentPath isn't set
      // yet, so there's nothing to clean up here). Mark it so that once the
      // zip lands it deletes itself instead of leaking a Storage object for
      // an entry that no longer exists. Deliberately not awaited - deleting
      // stays instant regardless of how long that upload takes.
      this._pendingDeletes.add(id);
      return;
    }
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
        const raw = [];
        snap.forEach((d) => raw.push(d.data()));
        // Overlay any just-uploaded attachment that the server copy hasn't
        // caught up with yet, so this full refresh doesn't null it back out.
        const list = applyPendingAttachmentPatches(raw);
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
