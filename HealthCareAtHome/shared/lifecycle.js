/* lifecycle.js — the booking state machine.
 *
 * Every stage of requirements 3–9 is a method here. Each method validates the
 * transition against TRANSITIONS, mutates the booking, appends to history and
 * persists via Data.write (local-first + Firestore). Secret codes are issued
 * and verified at exactly the points the spec requires.
 *
 * Stage map:
 *   pay()                 req 3  — payment captured
 *   broadcast()           req 3  — alert eligible caregivers
 *   accept()              req 4  — caregiver confirmed, START code issued
 *   startTravel()         req 6  — navigation begins, live location on
 *   pushLocation()        req 6  — live caregiver position
 *   markArrived()         req 7  — caregiver reached client
 *   verifyStartCode()     req 7  — client verifies OTP -> service begins
 *   requestCompletion()   req 8  — caregiver asks to finish, COMPLETE code issued
 *   verifyCompletion()    req 9  — client verifies OTP + rating -> officially done
 */
import { BookingStatus, TRANSITIONS, Availability, nowIso, createBooking } from './models.js';
import { generateCode, verifyCode } from './codes.js';
import { eligibleCaregivers, estimateEtaMinutes, distanceKm } from './geo.js';
import { Data } from './sync.js';
import { COLLECTION } from './firebase.js';
import { Payments } from './payments.js';
import { Notify } from './notify.js';

function assertTransition(booking, next) {
  const allowed = TRANSITIONS[booking.status] || [];
  if (!allowed.includes(next)) {
    throw new Error(`Illegal transition: ${booking.status} -> ${next}`);
  }
}

function advance(booking, next, patch = {}) {
  assertTransition(booking, next);
  Object.assign(booking, patch);
  booking.status = next;
  booking.updatedAt = nowIso();
  booking.history = booking.history || [];
  booking.history.push({ status: next, at: booking.updatedAt });
  return booking;
}

export const Lifecycle = {
  /** req 3 — capture payment from the client into the platform account. */
  async pay(booking) {
    const txn = await Payments.charge(booking);
    advance(booking, BookingStatus.PAID, {
      payment: { ...booking.payment, status: 'paid', inTxnId: txn.id, paidAt: nowIso() }
    });
    await Data.write(COLLECTION.BOOKINGS, booking);
    return booking;
  },

  /** req 3 — find eligible caregivers (speciality + within radius) and alert them.
   *  mode = which caregiver location to match on ('gps' | 'registered' | 'both'). */
  async broadcast(booking, allCaregivers, radiusKm, mode = 'gps') {
    const targets = eligibleCaregivers(booking, allCaregivers, radiusKm, mode);
    advance(booking, BookingStatus.BROADCAST, {
      broadcast: { at: nowIso(), targetIds: targets.map((c) => c.id), radiusKm: radiusKm || booking.radiusKm }
    });
    await Data.write(COLLECTION.BOOKINGS, booking);
    await Notify.toCaregivers(targets, {
      title: 'New service request',
      body: `${booking.speciality} needed near ${booking.location.label || 'client'}`,
      bookingId: booking.id
    });
    return { booking, notified: targets };
  },

  /** req 4 — a caregiver accepts. Issue the START secret shared with both sides. */
  async accept(booking, caregiver) {
    const startCode = generateCode(6);
    advance(booking, BookingStatus.ACCEPTED, {
      caregiverId: caregiver.id,
      caregiverName: caregiver.name,
      codes: { ...booking.codes, startCode }
    });
    await Data.write(COLLECTION.BOOKINGS, booking);

    // mark the caregiver busy
    caregiver.availability = Availability.ON_SERVICE;
    caregiver.updatedAt = nowIso();
    await Data.write(COLLECTION.CAREGIVERS, caregiver);

    // share caregiver profile + start code with client; start code with caregiver
    await Notify.toClient(booking.clientId, {
      title: 'Caregiver confirmed',
      body: `${caregiver.name} is assigned. Service start code: ${startCode}`,
      bookingId: booking.id
    });
    return booking;
  },

  /** req 6 — caregiver begins travelling; live tracking turns on. */
  async startTravel(booking, caregiver) {
    const d = distanceKm(caregiver.location, booking.location);
    advance(booking, BookingStatus.EN_ROUTE, {
      tracking: {
        lat: caregiver.location?.lat ?? null,
        lng: caregiver.location?.lng ?? null,
        updatedAt: nowIso(),
        etaMinutes: estimateEtaMinutes(d)
      }
    });
    await Data.write(COLLECTION.BOOKINGS, booking);
    await Notify.toClient(booking.clientId, {
      title: 'Caregiver on the way',
      body: `ETA ~${booking.tracking.etaMinutes} min`,
      bookingId: booking.id
    });
    return booking;
  },

  /**
   * req 6 — push a live location ping. Kept flowing through EN_ROUTE, ARRIVED
   * and IN_SERVICE so the location-verification gate always has a fresh
   * caregiver position for start/complete checks.
   */
  async pushLocation(booking, lat, lng) {
    const trackable = [BookingStatus.EN_ROUTE, BookingStatus.ARRIVED, BookingStatus.IN_SERVICE];
    if (!trackable.includes(booking.status)) return booking;
    const eta = estimateEtaMinutes(distanceKm({ lat, lng }, booking.location));
    booking.tracking = { lat, lng, updatedAt: nowIso(), etaMinutes: eta };
    booking.updatedAt = nowIso();
    await Data.write(COLLECTION.BOOKINGS, booking);
    return booking;
  },

  /** req 7 — caregiver marks arrival; client will now ask for the start code. */
  async markArrived(booking) {
    advance(booking, BookingStatus.ARRIVED);
    await Data.write(COLLECTION.BOOKINGS, booking);
    await Notify.toClient(booking.clientId, {
      title: 'Caregiver has arrived',
      body: 'Ask for the start code and enter it to begin the service.',
      bookingId: booking.id
    });
    return booking;
  },

  /** req 7 — client enters the start code the caregiver reads out. */
  async verifyStartCode(booking, providedCode) {
    if (!verifyCode(booking.codes.startCode, providedCode)) {
      return { ok: false, booking };
    }
    advance(booking, BookingStatus.IN_SERVICE, {
      codes: { ...booking.codes, startVerified: true },
      serviceStartedAt: nowIso()
    });
    await Data.write(COLLECTION.BOOKINGS, booking);
    return { ok: true, booking };
  },

  /** req 8 — caregiver requests completion; issue the COMPLETE secret to client. */
  async requestCompletion(booking) {
    const completeCode = generateCode(6);
    advance(booking, BookingStatus.COMPLETION_PENDING, {
      codes: { ...booking.codes, completeCode }
    });
    await Data.write(COLLECTION.BOOKINGS, booking);
    await Notify.toClient(booking.clientId, {
      title: 'Service complete — confirm to close',
      body: `Enter completion code ${completeCode} with your rating.`,
      bookingId: booking.id
    });
    return booking;
  },

  /** req 9 — client verifies completion code + gives rating/comments. Officially done. */
  async verifyCompletion(booking, providedCode, { stars, comments }, caregiver) {
    if (!verifyCode(booking.codes.completeCode, providedCode)) {
      return { ok: false, booking };
    }
    advance(booking, BookingStatus.COMPLETED, {
      codes: { ...booking.codes, completeVerified: true },
      feedback: { stars: Number(stars) || null, comments: comments || '', at: nowIso() },
      serviceEndedAt: nowIso()
    });
    await Data.write(COLLECTION.BOOKINGS, booking);

    // free the caregiver + fold rating into their running average
    if (caregiver) {
      caregiver.availability = Availability.AVAILABLE;
      if (stars) {
        const total = (caregiver.rating || 0) * (caregiver.ratingCount || 0) + Number(stars);
        caregiver.ratingCount = (caregiver.ratingCount || 0) + 1;
        caregiver.rating = Math.round((total / caregiver.ratingCount) * 10) / 10;
      }
      caregiver.updatedAt = nowIso();
      await Data.write(COLLECTION.CAREGIVERS, caregiver);
    }
    return { ok: true, booking };
  },

  /** admin — release the payout to the caregiver after completion. */
  async releasePayout(booking) {
    const txn = await Payments.payout(booking);
    booking.payment = { ...booking.payment, status: 'released', outTxnId: txn.id, releasedAt: nowIso() };
    booking.updatedAt = nowIso();
    await Data.write(COLLECTION.BOOKINGS, booking);
    return booking;
  },

  /**
   * Cancel a booking. Records a payment revision:
   *   - if the client had paid, a refund txn is created and payment.status -> 'refunded'
   *   - otherwise the (unpaid) payment is simply marked 'cancelled'
   * Also frees any assigned caregiver (availability -> available).
   * @param {object} booking
   * @param {string} reason
   * @param {object} [opts] { by:'client'|'admin' }
   */
  async cancel(booking, reason = '', opts = {}) {
    const by = opts.by || 'client';
    let revision = null;

    if (booking.payment && booking.payment.status === 'paid') {
      // reverse the captured charge — a payment revision (refund)
      const txn = await Payments.refund(booking);
      revision = { type: 'refund', amount: txn.amount, txnId: txn.id, at: txn.at, by, reason };
      booking.payment = {
        ...booking.payment,
        status: 'refunded',
        refundTxnId: txn.id,
        refundedAt: txn.at
      };
    } else {
      // nothing captured — record a zero-value revision for the audit trail
      revision = { type: 'void', amount: 0, txnId: null, at: nowIso(), by, reason };
      if (booking.payment) booking.payment = { ...booking.payment, status: booking.payment.status === 'unpaid' ? 'unpaid' : booking.payment.status };
    }

    // keep a running list of payment revisions on the booking (audit trail)
    booking.paymentRevisions = [...(booking.paymentRevisions || []), revision];

    advance(booking, BookingStatus.CANCELLED, { cancelReason: reason, cancelledBy: by });
    await Data.write(COLLECTION.BOOKINGS, booking);

    // free the assigned caregiver, if any
    if (booking.caregiverId) {
      const caregiver = await Data.get(COLLECTION.CAREGIVERS, booking.caregiverId);
      if (caregiver && caregiver.availability === Availability.ON_SERVICE) {
        caregiver.availability = Availability.AVAILABLE;
        caregiver.updatedAt = nowIso();
        await Data.write(COLLECTION.CAREGIVERS, caregiver);
      }
    }

    return { booking, revision };
  },

  /**
   * Clone a (usually just-cancelled) booking into a fresh CREATED request,
   * carrying over all the request details and stamping clonedFrom = original.id
   * so the new record is differentiable (like priority).
   */
  cloneBooking(original) {
    return createBooking({
      clientId: original.clientId,
      speciality: original.speciality,
      location: original.location,
      price: original.price,
      radiusKm: original.radiusKm,
      serviceId: original.serviceId,
      commissionPct: original.commissionPct,
      scheduledAt: original.scheduledAt,
      recipients: original.recipients,
      unitPrice: original.unitPrice,
      priority: original.priority,
      clonedFrom: original.id
    });
  }
};
