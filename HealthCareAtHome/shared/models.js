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

// ── Caregiver account status (self-registration lifecycle) ───────────────────
export const CaregiverStatus = Object.freeze({
  REGISTERED: 'registered', // submitted, awaiting admin approval — cannot log in
  ACTIVE: 'active',         // approved by admin — can log in
  REJECTED: 'rejected'      // admin rejected the registration
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
export function createClient({
  name, phone, email = '', savedLocations = [],
  surname = '', forename = '', sex = '', dob = '', photo = null,
  address = null,          // self residence { address, lat, lng }
  aadhaar = null,          // { number, verified }
  members = []             // additional people the client books for (see below)
}) {
  const displayName = name || [forename, surname].filter(Boolean).join(' ').trim();
  // Build savedLocations from self + members' addresses if not supplied.
  let locs = savedLocations;
  if ((!locs || locs.length === 0)) {
    locs = [];
    if (address && (address.address || address.lat != null)) {
      locs.push({ label: 'Home', address: address.address || '', lat: address.lat ?? null, lng: address.lng ?? null });
    }
    for (const m of members) {
      if (m.address && (m.address.address || m.address.lat != null)) {
        const who = [m.forename, m.surname].filter(Boolean).join(' ').trim() || 'Member';
        locs.push({ label: who, address: m.address.address || '', lat: m.address.lat ?? null, lng: m.address.lng ?? null });
      }
    }
  }
  return {
    id: uid('cli'),
    role: Role.CLIENT,
    name: displayName,
    surname,
    forename,
    sex,
    dob,
    phone,
    email,
    photo,               // tiny data-URL thumbnail
    address,             // self residence { address, lat, lng }
    aadhaar,             // { number, verified }
    // Additional members: { surname, forename, sex, dob, relationship, photo,
    //   address:{address,lat,lng}, aadhaar:{number,verified} }
    members,
    // Each location: { label, address, lat, lng } — used at booking time.
    savedLocations: locs,
    accessCode: null,    // secret code for code-based login (set on registration/admin)
    fcmToken: null,      // device push token
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

/** Caregiver — public-facing profile (visible in the app). */
export function createCaregiver({
  name, phone, specialities = [], lat = null, lng = null,
  status = CaregiverStatus.ACTIVE, // admin quick-add = pre-approved by default
  surname = '', forename = '', sex = '', dob = '', photo = null,
  address = null,             // { address, lat, lng }
  operatingLocation = null,   // { address, lat, lng }
  aadhaar = null,             // { number, verified }
  certificates = []           // [{ name, dataUrl }]
}) {
  const displayName = name || [forename, surname].filter(Boolean).join(' ').trim();
  return {
    id: uid('cg'),
    role: Role.CAREGIVER,
    name: displayName,
    surname,
    forename,
    sex,
    dob,
    phone,
    specialities,        // array of Speciality values
    photo,               // data-URL thumbnail (shown as identity proof)
    address,             // residence { address, lat, lng }
    operatingLocation,   // where they serve { address, lat, lng } (used for matching)
    aadhaar,             // { number, verified }
    certificates,        // array of { name, dataUrl } (small compressed images)
    status,              // registered | active | rejected
    availability: Availability.UNAVAILABLE,
    rating: 0,
    ratingCount: 0,
    // matching location defaults to operating location, else the given lat/lng
    location: operatingLocation && operatingLocation.lat != null
      ? { lat: operatingLocation.lat, lng: operatingLocation.lng, at: nowIso() }
      : (lat != null && lng != null) ? { lat, lng, at: nowIso() } : null,
    accessCode: null,    // secret code for code-based login (set by admin)
    fcmToken: null,      // device push token
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

/** Booking — the central record every app reads/writes. */
export function createBooking({
  clientId, speciality, location, price, radiusKm,
  serviceId = null, commissionPct = null,
  scheduledAt = null,   // ISO datetime the service is needed (default set by caller)
  recipients = [],      // [{ name, label, address, lat, lng }] — who the service is for
  unitPrice = null      // per-recipient service cost (price = unitPrice * recipients)
}) {
  return {
    id: uid('bk'),
    clientId,
    caregiverId: null,
    speciality,                    // service key (matches caregiver specialities)
    serviceId,                     // id of the master service, if chosen from it
    commissionPct,                 // commission % snapshot at booking time (per-service)
    scheduledAt: scheduledAt || nowIso(),
    recipients,                    // people this service is for
    unitPrice,                     // per-recipient cost
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
