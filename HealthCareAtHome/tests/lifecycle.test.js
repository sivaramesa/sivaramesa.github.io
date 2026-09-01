/* Tests for the real cancellation + clone + payment-revision logic in
 * shared/lifecycle.js and shared/payments.js, with Firebase/sync mocked so the
 * actual shipped code runs offline. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── in-memory Data store standing in for Firestore + IndexedDB ───────────────
const store = { bookings: {}, caregivers: {}, clients: {}, payments: {} };
vi.mock('../shared/sync.js', () => ({
  Data: {
    async write(col, rec) { store[col][rec.id] = JSON.parse(JSON.stringify(rec)); return rec; },
    async remove(col, id) { delete store[col][id]; },
    get: async (col, id) => store[col][id] ? JSON.parse(JSON.stringify(store[col][id])) : null,
    getAll: async (col) => Object.values(store[col]),
    subscribe: () => () => {}
  },
  Sync: { start() {}, onStatus() {}, subscribe: () => () => {}, notify() {} }
}));
vi.mock('../shared/notify.js', () => ({
  Notify: { toast() {}, toCaregivers: vi.fn(async () => {}), toClient: vi.fn(async () => {}), _enqueuePush: async () => {} }
}));
// firebase.js runs initializeApp() against a CDN URL — replace with just COLLECTION.
vi.mock('../shared/firebase.js', () => ({
  db: {},
  COLLECTION: { CLIENTS: 'clients', CAREGIVERS: 'caregivers', BOOKINGS: 'bookings', PAYMENTS: 'payments' }
}));

import { Lifecycle } from '../shared/lifecycle.js';
import { Payments } from '../shared/payments.js';
import { createBooking, BookingStatus, Availability, createCaregiver } from '../shared/models.js';

function resetStore() {
  for (const k of Object.keys(store)) store[k] = {};
}

function paidBooking(overrides = {}) {
  const b = createBooking({
    clientId: 'c1', speciality: 'nursing', location: { lat: 13, lng: 80 },
    price: 500, radiusKm: 5, scheduledAt: '2026-09-01T10:00:00.000Z',
    priority: true, unitPrice: 250, recipients: [{ name: 'Self' }], ...overrides
  });
  b.status = BookingStatus.BROADCAST;
  b.payment = { ...b.payment, status: 'paid', inTxnId: 'in_1', paidAt: '2026-09-01T09:00:00.000Z' };
  return b;
}

describe('Payments.refund', () => {
  it('returns a refunded txn for the booking price', async () => {
    const txn = await Payments.refund({ price: 500 });
    expect(txn.status).toBe('refunded');
    expect(txn.amount).toBe(500);
    expect(txn.id).toMatch(/^pay_rev/);
  });
  it('supports a partial refund amount', async () => {
    const txn = await Payments.refund({ price: 500 }, 200);
    expect(txn.amount).toBe(200);
  });
});

describe('Lifecycle.cancel — paid booking', () => {
  beforeEach(resetStore);

  it('refunds and records a payment revision', async () => {
    const b = paidBooking();
    store.bookings[b.id] = b;
    const { booking, revision } = await Lifecycle.cancel(b, 'Client requested', { by: 'client', reasonCode: 'Client requested' });
    expect(booking.status).toBe(BookingStatus.CANCELLED);
    expect(booking.payment.status).toBe('refunded');
    expect(booking.payment.refundTxnId).toBeTruthy();
    expect(revision.type).toBe('refund');
    expect(revision.amount).toBe(500);
    expect(revision.reason).toBe('Client requested');
    expect(revision.reasonCode).toBe('Client requested');
    expect(booking.paymentRevisions).toHaveLength(1);
    expect(booking.cancelReason).toBe('Client requested');
    expect(booking.cancelledBy).toBe('client');
  });

  it('frees an assigned caregiver who was on service', async () => {
    const cg = createCaregiver({ name: 'Asha', phone: '+911', specialities: ['nursing'] });
    cg.id = 'cg1'; cg.availability = Availability.ON_SERVICE;
    store.caregivers[cg.id] = cg;
    const b = paidBooking(); b.caregiverId = 'cg1'; b.status = BookingStatus.ACCEPTED;
    store.bookings[b.id] = b;
    await Lifecycle.cancel(b, 'No Show of Caregiver', { by: 'admin', reasonCode: 'No Show of Caregiver' });
    expect(store.caregivers['cg1'].availability).toBe(Availability.AVAILABLE);
  });
});

describe('Lifecycle.cancel — unpaid booking', () => {
  beforeEach(resetStore);
  it('records a void revision, no refund', async () => {
    const b = createBooking({ clientId: 'c1', speciality: 'nursing', location: { lat: 13, lng: 80 }, price: 500, radiusKm: 5 });
    b.status = BookingStatus.CREATED;
    store.bookings[b.id] = b;
    const { booking, revision } = await Lifecycle.cancel(b, 'Priority changes', { by: 'client', reasonCode: 'Priority changes' });
    expect(booking.status).toBe(BookingStatus.CANCELLED);
    expect(revision.type).toBe('void');
    expect(revision.amount).toBe(0);
    expect(revision.reasonCode).toBe('Priority changes');
  });
});

describe('Lifecycle.cloneBooking', () => {
  it('copies request details incl. scheduledAt + priority, stamps clonedFrom, fresh id/status', () => {
    const orig = paidBooking();
    const clone = Lifecycle.cloneBooking(orig);
    expect(clone.clonedFrom).toBe(orig.id);
    expect(clone.id).not.toBe(orig.id);
    expect(clone.status).toBe(BookingStatus.CREATED);
    expect(clone.scheduledAt).toBe(orig.scheduledAt);
    expect(clone.priority).toBe(orig.priority);
    expect(clone.speciality).toBe(orig.speciality);
    expect(clone.price).toBe(orig.price);
    expect(clone.payment.status).toBe('unpaid'); // fresh, not carried over
  });
});

describe('Lifecycle.markArrived — single write, folds location', () => {
  beforeEach(resetStore);

  it('advances en_route -> arrived in one write and stores the given location', async () => {
    const b = paidBooking();
    b.status = BookingStatus.EN_ROUTE;
    store.bookings[b.id] = b;
    await Lifecycle.markArrived(b, { lat: 13.001, lng: 80.001 });
    const saved = store.bookings[b.id];
    expect(saved.status).toBe(BookingStatus.ARRIVED);
    expect(saved.tracking.lat).toBeCloseTo(13.001, 3);
    expect(saved.tracking.etaMinutes).toBe(0);
  });

  it('works without a location (best-effort GPS unavailable)', async () => {
    const b = paidBooking();
    b.status = BookingStatus.EN_ROUTE;
    store.bookings[b.id] = b;
    await Lifecycle.markArrived(b, null);
    expect(store.bookings[b.id].status).toBe(BookingStatus.ARRIVED);
  });

  it('rejects an illegal transition (not en_route)', async () => {
    const b = paidBooking();
    b.status = BookingStatus.ARRIVED;
    store.bookings[b.id] = b;
    await expect(Lifecycle.markArrived(b, null)).rejects.toThrow(/Illegal transition/);
  });
});
