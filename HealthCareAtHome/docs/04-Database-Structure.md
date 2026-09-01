# HomeCare @ Home — Database Structure

**Store:** Google Firestore (document store). **Local mirror:** IndexedDB (same shapes). All records use a **client-generated `id`** and **ISO-8601 string** timestamps. Firestore is schemaless; the shapes below are the application contract defined by `shared/models.js` (and fields added by `shared/lifecycle.js`).

## Collections

| Collection | Doc id prefix | Purpose |
|------------|---------------|---------|
| `clients` | `cli_` | Client accounts + PII + members (admin-only). |
| `caregivers` | `cg_` | Caregiver profiles, vetting, availability, rating. |
| `bookings` | `bk_` | The central record every app reads/writes. |
| `services` | `svc_` | Services master catalogue (admin-managed). |
| `settings` | doc `app` | Single platform-settings document. |
| `payments` | `pay_*` | Reserved/wired collection (payments currently recorded inline on the booking). |

---

## `clients/{clientId}`

```jsonc
{
  "id": "cli_…",
  "role": "client",
  "name": "Asha Rao",            // display name (forename + surname)
  "surname": "Rao",
  "forename": "Asha",
  "sex": "female",
  "dob": "1980-05-12",
  "phone": "+9198…",             // login id
  "email": "",
  "photo": "data:image/…",       // tiny compressed thumbnail | null
  "address": {                   // self residence | null
    "address": "Sholinganallur, Chennai",
    "lat": 12.9010, "lng": 80.2279
  },
  "aadhaar": { "number": "XXXX…", "verified": true },   // masked in UI
  "members": [                   // additional people the client books for
    {
      "surname": "Rao", "forename": "Kiran", "sex": "male",
      "dob": "2010-02-01", "relationship": "son", "photo": "data:…",
      "address": { "address": "…", "lat": 12.9, "lng": 80.2 },
      "aadhaar": { "number": "…", "verified": true }
    }
  ],
  "savedLocations": [            // derived from self + members; used at booking time
    { "label": "Home", "address": "…", "lat": 12.9, "lng": 80.2 }
  ],
  "accessCode": "482913",        // secret code for login (admin/registration-set)
  "fcmToken": null,              // device push token
  "createdAt": "2026-…Z",
  "updatedAt": "2026-…Z"
}
```

---

## `caregivers/{caregiverId}`

```jsonc
{
  "id": "cg_…",
  "role": "caregiver",
  "name": "Ravi Kumar",
  "surname": "Kumar", "forename": "Ravi", "sex": "male", "dob": "1990-08-01",
  "phone": "+9198…",
  "photo": "data:image/…",       // identity thumbnail | null
  "specialities": ["nursing", "elder_care"],  // Speciality keys
  "address": { "address": "…", "lat": 12.90, "lng": 80.22 },        // residence | null
  "operatingLocation": { "address": "…", "lat": 12.95, "lng": 80.24 }, // service area | null
  "aadhaar": { "number": "…", "verified": true },
  "certificates": [ { "name": "RN License", "dataUrl": "data:image/…" } ], // small, capped
  "status": "active",            // registered | active | rejected
  "availability": "available",   // available | unavailable | on_service
  "rating": 4.6,
  "ratingCount": 18,
  "location": {                  // live/last-seen matching point (defaults from operatingLocation)
    "lat": 12.95, "lng": 80.24, "at": "2026-…Z"
  },
  "accessCode": "704912",
  "fcmToken": null,
  "createdAt": "2026-…Z",
  "updatedAt": "2026-…Z"
}
```

**Notes**
- `location` = the point used for **gps** matching (updated when the caregiver goes available / shares location); `operatingLocation` = the point used for **registered** matching. `both` mode uses whichever is nearer.
- Only `status: active` caregivers may log in.

---

## `bookings/{bookingId}`

The central record. Fields marked *(lifecycle)* are added as the booking progresses.

```jsonc
{
  "id": "bk_…",
  "clientId": "cli_…",
  "caregiverId": null,           // set on accept (lifecycle)
  "caregiverName": null,         // snapshot on accept (lifecycle)

  "speciality": "nursing",       // service key (matches caregiver specialities)
  "serviceId": "svc_…",          // master service id | null
  "commissionPct": 15,           // commission % snapshot at booking time

  "scheduledAt": "2026-09-01T10:00:00.000Z",  // when service is needed
  "recipients": [                // who the service is for
    { "name": "Asha", "label": "Self", "address": "…", "lat": 12.9, "lng": 80.2 }
  ],
  "unitPrice": 800,              // per-recipient cost
  "price": 1600,                 // total = unitPrice × recipients (or priority-adjusted)
  "priority": false,             // expedited booking (differentiator)
  "clonedFrom": null,            // originating cancelled booking id, if a clone (differentiator)

  "location": {                  // single service location
    "label": "Home", "address": "…", "lat": 12.9, "lng": 80.2
  },
  "radiusKm": 15,                // match radius chosen by the client

  "status": "created",           // BookingStatus (see state machine)

  "codes": {                     // secret codes (admin-visible)
    "startCode": "418273",       "startVerified": false,
    "completeCode": "905612",    "completeVerified": false
  },

  "payment": {
    "status": "unpaid",          // unpaid | paid | released | refunded
    "inTxnId": null,             // client → platform
    "outTxnId": null,            // platform → caregiver
    "paidAt": null, "releasedAt": null,
    "refundTxnId": null, "refundedAt": null   // set on cancel-with-refund (lifecycle)
  },
  "paymentRevisions": [          // audit trail of cancels/refunds (lifecycle)
    { "type": "refund", "amount": 1600, "txnId": "pay_rev_…",
      "at": "2026-…Z", "by": "admin", "reason": "No Show of Caregiver",
      "reasonCode": "No Show of Caregiver" }
  ],

  "broadcast": {                 // set on broadcast (lifecycle)
    "at": "2026-…Z", "targetIds": ["cg_…"], "radiusKm": 15
  },
  "invitedCaregiverIds": ["cg_…"],  // admin high-precedence targeted invite (lifecycle)

  "tracking": {                  // live caregiver position (lifecycle)
    "lat": null, "lng": null, "updatedAt": null, "etaMinutes": null
  },

  "feedback": { "stars": null, "comments": "", "at": null },  // set on completion (lifecycle)

  "serviceStartedAt": null,      // set on start-code verify (lifecycle)
  "serviceEndedAt": null,        // set on completion (lifecycle)

  "cancelReason": null,          // set on cancel (lifecycle)
  "cancelReasonCode": null,      // reason code selected (lifecycle)
  "cancelledBy": null,           // 'client' | 'admin' (lifecycle)

  "history": [                   // full transition audit trail
    { "status": "created", "at": "2026-…Z" }
  ],

  "createdAt": "2026-…Z",
  "updatedAt": "2026-…Z"
}
```

### BookingStatus values
`created · paid · broadcast · accepted · en_route · arrived · in_service · completion_pending · completed · cancelled · expired`

### Allowed transitions
```
created→{paid,cancelled}  paid→{broadcast,cancelled}
broadcast→{accepted,expired,cancelled}  accepted→{en_route,cancelled}
en_route→{arrived,cancelled}  arrived→{in_service,cancelled}
in_service→{completion_pending,cancelled}
completion_pending→{completed,cancelled}
completed→{}  cancelled→{}  expired→{broadcast,cancelled}
```

---

## `services/{serviceId}`

```jsonc
{
  "id": "svc_…",
  "name": "Nursing",
  "key": "nursing",              // stored on bookings as `speciality`
  "cost": 800,
  "commissionPct": 15,           // default 15
  "active": true,
  "createdAt": "2026-…Z",
  "updatedAt": "2026-…Z"
}
```
Seeded once from: Nursing (800), Physiotherapy (700), Elder Care (600), Post Surgery (900), Baby Care (650), Lab Sample (300).

---

## `settings/app` (single document)

```jsonc
{
  "locationVerification": false, // require caregiver within radius to start/complete
  "verifyRadiusMeters": 50,
  "bookingLeadHours": 4,         // minimum lead time for a normal booking
  "priorityMode": "multiplier",  // multiplier | percent | flat
  "priorityValue": 1.5,          // ×1.5 | +50% | +₹ per recipient
  "matchLocationMode": "gps",    // gps | registered | both (OR)
  "cancelReasons": ["No Show of Caregiver", "Client requested", "Priority changes"],
  "startAlertMinutes": 30        // accepted-but-not-started at-risk window
}
```
`DEFAULT_SETTINGS` are applied in memory so apps work before the doc exists.

---

## `payments/{id}` (reserved)

Wired for sync/storage but **not currently written** — payment state lives inline on `bookings.payment` and `bookings.paymentRevisions`. Available for a future dedicated ledger.

---

## Relationships

```
clients (1) ──< bookings >── (1) caregivers
services (1) ──< bookings           (speciality/serviceId + commission snapshot)
settings/app (1) ── governs pricing, matching, verification, cancel reasons
```

- A booking references a client (`clientId`) and, once accepted, a caregiver (`caregiverId`).
- A booking snapshots `serviceId` + `commissionPct` at creation so later master edits don't rewrite history.
- `clonedFrom` links a rebooked request back to the cancelled original.
- `invitedCaregiverIds` links a booking to admin-targeted caregivers.

## Indexing & rules (recommended)

- Indexes: `bookings` by `clientId`, by `caregiverId`, by `status`, by `scheduledAt`.
- Rules (enforce confidentiality): `clients` admin-only + own doc; `caregivers` public profile (codes admin-only); `bookings` visible to its client, assigned/targeted caregiver, and admin; `services`/`settings` readable by all signed-in, writable by admin.

## Conventions

- Client-generated ids (prefix + UUID) so writes are offline-safe and idempotent.
- ISO-8601 string timestamps everywhere.
- Photos/certificates stored as compressed, size-capped data URLs (no separate object storage).
- All writes go through the `Data` facade (local mirror + outbox + reconcile).
