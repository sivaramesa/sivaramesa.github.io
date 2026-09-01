/* models.js — shared domain model, enums, factories and the canonical
 * booking lifecycle definition used by all three apps.
 *
 * Every record uses a client-generated `id` (UUID-ish) and ISO-8601 string
 * timestamps, per the workspace PWA conventions.
 */

// ── ID + time helpers ────────────────────────────────────────────────────────
export function uid(prefix = '') {
  const rnd = (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${rnd}` : rnd;
}

export function nowIso() {
  return new Date().toISOString();
}

// ── Roles ────────────────────────────────────────────────────────────────────
export const Role = Object.freeze({
  CLIENT: 'client',
  CAREGIVER: 'caregiver',
  ADMIN: 'admin'
});

// ── Caregiver availability ───────────────────────────────────────────────────
export const Availability = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  ON_SERVICE: 'on_service'
});

// ── Booking lifecycle states ─────────────────────────────────────────────────
// The order here mirrors requirements 3–9.
export const BookingStatus = Object.freeze({
  CREATED: 'created',                 // client selected a service, not yet paid
  PAID: 'paid',                       // payment captured, about to broadcast
  BROADCAST: 'broadcast',             // alert sent to eligible caregivers
  ACCEPTED: 'accepted',               // a caregiver accepted; start code issued
  EN_ROUTE: 'en_route',               // caregiver travelling, live location on
  ARRIVED: 'arrived',                 // caregiver reached; awaiting start OTP
  IN_SERVICE: 'in_service',           // start OTP verified, service underway
  COMPLETION_PENDING: 'completion_pending', // caregiver asked to complete; code issued
  COMPLETED: 'completed',             // completion OTP verified + rating given
  CANCELLED: 'cancelled',
  EXPIRED: 'expired'                  // broadcast lapsed with no acceptance
});

// Allowed transitions — the state machine enforced by lifecycle.js.
export const TRANSITIONS = Object.freeze({
  created: ['paid', 'cancelled'],
  paid: ['broadcast', 'cancelled'],
  broadcast: ['accepted', 'expired', 'cancelled'],
  accepted: ['en_route', 'cancelled'],
  en_route: ['arrived', 'cancelled'],
  arrived: ['in_service', 'cancelled'],
  in_service: ['completion_pending', 'cancelled'],
  completion_pending: ['completed'],
  completed: [],
  cancelled: [],
  expired: ['broadcast'] // admin can re-broadcast an expired request
});

// ── Specialities offered (matched against caregiver skills) ──────────────────
export const Speciality = Object.freeze({
  NURSING: 'nursing',
  PHYSIOTHERAPY: 'physiotherapy',
  ELDER_CARE: 'elder_care',
  POST_SURGERY: 'post_surgery',
  BABY_CARE: 'baby_care',
  LAB_SAMPLE: 'lab_sample'
});

// ── Factories ────────────────────────────────────────────────────────────────

/** Client — sensitive PII; only surfaced in the Admin app. */
export function createClient({ name, phone, email = '', savedLocations = [] }) {
  return {
    id: uid('cli'),
    role: Role.CLIENT,
    name,
    phone,
    email,
    // Each location: { label, address, lat, lng }
    savedLocations,
    accessCode: null,    // secret code for code-based login (set by admin)
    fcmToken: null,      // device push token
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

/** Caregiver — public-facing profile (visible in the app). */
export function createCaregiver({ name, phone, specialities = [], lat = null, lng = null }) {
  return {
    id: uid('cg'),
    role: Role.CAREGIVER,
    name,
    phone,
    specialities,        // array of Speciality values
    photo: null,         // data-URL thumbnail (shown as identity proof)
    availability: Availability.UNAVAILABLE,
    rating: 0,
    ratingCount: 0,
    location: (lat != null && lng != null) ? { lat, lng, at: nowIso() } : null,
    accessCode: null,    // secret code for code-based login (set by admin)
    fcmToken: null,      // device push token
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

/** Booking — the central record every app reads/writes. */
export function createBooking({ clientId, speciality, location, price, radiusKm, serviceId = null, commissionPct = null }) {
  return {
    id: uid('bk'),
    clientId,
    caregiverId: null,
    speciality,                    // service key (matches caregiver specialities)
    serviceId,                     // id of the master service, if chosen from it
    commissionPct,                 // commission % snapshot at booking time (per-service)
    location,                      // { label, address, lat, lng }
    radiusKm: radiusKm || null,
    price,
    status: BookingStatus.CREATED,

    // Secret codes — see lifecycle.js. Admin can see all of these.
    codes: {
      startCode: null,            // shared with client + caregiver on accept
      startVerified: false,
      completeCode: null,         // issued when caregiver requests completion
      completeVerified: false
    },

    payment: {
      status: 'unpaid',          // unpaid | paid | released | refunded
      inTxnId: null,             // client -> platform
      outTxnId: null,            // platform -> caregiver
      paidAt: null,
      releasedAt: null
    },

    // Live tracking of the caregiver while en route.
    tracking: { lat: null, lng: null, updatedAt: null, etaMinutes: null },

    feedback: { stars: null, comments: '', at: null },

    // Full audit trail of state transitions (admin dashboard).
    history: [{ status: BookingStatus.CREATED, at: nowIso() }],

    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}
