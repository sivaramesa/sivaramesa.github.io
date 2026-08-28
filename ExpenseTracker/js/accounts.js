/* Account heads (projects) data layer - Firestore sync + IndexedDB mirror.
 *
 * An "account head" is a project or ledger bucket that income and expense
 * entries are recorded against (e.g. "Site A", "Office", "Client X").
 */
import {
  collection,
  onSnapshot,
  query,
  orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-config.js';
import { DB } from './db.js';
import { Auth } from './auth.js';
import { Sync } from './sync.js';
import { uuid, nowIso } from './utils.js';

const COLLECTION = 'accounts';

export const Accounts = {
  _unsub: null,

  /**
   * Create an account head.
   * @param {object} input { name, type, description, openingBalance }
   *   type: 'project' | 'asset' | 'liability' (defaults to 'project')
   */
  async create(input) {
    const who = Auth.currentProfile();
    if (!who) throw new Error('You must be signed in.');
    const name = (input.name || '').trim();
    if (!name) throw new Error('Account head name is required.');

    const id = uuid();
    const record = {
      id,
      name,
      type: input.type || 'project',
      description: (input.description || '').trim(),
      openingBalance: Number(input.openingBalance) || 0,
      createdBy: who,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await DB.putAccount(record);
    await DB.queueOp({ collection: COLLECTION, op: 'set', docId: id, payload: record });
    Sync.flush();
    return record;
  },

  async update(id, patch) {
    patch.updatedAt = nowIso();
    const all = await DB.getAllAccounts();
    const existing = all.find((a) => a.id === id) || { id };
    const merged = { ...existing, ...patch };
    await DB.putAccount(merged);
    await DB.queueOp({ collection: COLLECTION, op: 'set', docId: id, payload: merged });
    Sync.flush();
  },

  async remove(id) {
    await DB.deleteAccount(id);
    await DB.queueOp({ collection: COLLECTION, op: 'delete', docId: id });
    Sync.flush();
  },

  async getAllLocal() {
    return DB.getAllAccounts();
  },

  subscribe(onData, onError) {
    this.unsubscribe();
    const q = query(collection(db, COLLECTION), orderBy('name'));
    this._unsub = onSnapshot(
      q,
      async (snap) => {
        const list = [];
        snap.forEach((d) => list.push(d.data()));
        try {
          await DB.clearAccounts();
          if (list.length) await DB.putAccounts(list);
        } catch (e) {
          console.warn('Accounts mirror refresh failed:', e && e.message);
        }
        onData(list);
      },
      (err) => {
        console.warn('Accounts subscription error:', err && err.message);
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
