# HomeCare @ Home — Architecture & Design

## 1. Overview

HomeCare is three role-specific Progressive Web Apps (Client, Caregiver, Admin) built on a shared, framework-free ES-module codebase. There is no build step: apps load ES modules directly and pull the Firebase/Maps SDKs from a pinned CDN. State is offline-first — each app mirrors Firestore into IndexedDB and reconciles through an outbox — and real-time via Firestore `onSnapshot`.

```
                         ┌───────────────────────────────────────────┐
                         │                Firebase                     │
                         │  Firestore (source of truth) · Auth · FCM   │
                         └───────────────▲───────────────▲─────────────┘
                                         │ onSnapshot / writes
              ┌──────────────────────────┼───────────────┼──────────────────────────┐
              │                          │               │                          │
        ┌─────┴─────┐              ┌─────┴─────┐    ┌─────┴─────┐
        │ Client PWA│              │Caregiver  │    │ Admin PWA │
        │           │              │   PWA     │    │           │
        │ app.js    │              │ app.js    │    │ app.js    │
        └─────┬─────┘              └─────┬─────┘    └─────┬─────┘
              │        shared/ (ES modules, no bundler)   │
              └──────────────┬──────────────┬─────────────┘
                             │              │
                   ┌─────────┴───┐   ┌──────┴───────┐
                   │ sync.js     │   │ lifecycle.js │  models · geo · settings
                   │ (Data facade│   │ (state       │  payments · notify · codes
                   │  + reconcile│   │  machine)    │  maps · auth · imaging · dom
                   │  + IndexedDB│   └──────────────┘
                   │  outbox)    │
                   └─────────────┘
```

## 2. Design principles

- **One domain model, three views.** `shared/models.js` defines every entity, enum, and the booking state machine. The three apps are thin controllers over that model.
- **Local-first writes.** All writes go through `Data.write()` — write the IndexedDB mirror, queue an outbox op, notify subscribers instantly, then fire-and-forget flush to Firestore. Never a bare awaited cloud write.
- **Real-time by subscription.** `Sync.subscribe(collection, cb)` opens a shared `onSnapshot`; this is the live channel for broadcast, tracking, and status changes.
- **State machine, not scattered ifs.** Booking progress is a single enforced transition table; each stage is one `Lifecycle` method that validates → mutates → appends history → persists.
- **Graceful degradation.** No Maps key → geocoding/maps degrade but the flow works. Offline → reads from mirror, writes queue. Malformed record → per-row isolation, not a blank screen.
- **Web-equivalents of the original native spec.** Maps JS API (Navigation/Routes), Firestore onSnapshot (SignalR/WebSockets), FCM web push (notifications), gateway boundary (payments).

## 3. Module responsibilities (`shared/`)

| Module | Responsibility |
|--------|----------------|
| `config.js` | All client-side keys + business rules (commission, radius, ping interval). |
| `firebase.js` | Bootstraps Firebase app/Firestore/Auth; exports `COLLECTION` constants. |
| `models.js` | Enums (Role, CaregiverStatus, Availability, BookingStatus, Speciality), `TRANSITIONS`, factories (`createClient/Caregiver/Booking`), id/time helpers. |
| `db.js` | IndexedDB mirror + offline outbox (put/get/getAll/remove/queueOp). |
| `sync.js` | Reconcile engine, `Sync` (subscribe/flush/status) and the `Data` facade used by all apps. |
| `lifecycle.js` | The booking state machine: pay, broadcast, accept, startTravel, pushLocation, markArrived, verifyStartCode, requestCompletion, verifyCompletion, releasePayout, cancel, cloneBooking. |
| `geo.js` | Haversine distance, proximity check, ETA, and match-mode eligibility (`caregiverMatchPoints`, `caregiverDistanceKm`, `eligibleCaregivers`). |
| `settings.js` | Platform settings doc (`settings/app`) with live subscribe/update; `DEFAULT_SETTINGS`; `priorityPrice`. |
| `services-master.js` | Services catalogue CRUD + seed/migrate + commission resolution. |
| `payments.js` | Gateway boundary: `charge`, `payout`, `refund` (mock + swap-in). |
| `codes.js` | Secret-code / OTP generate + verify. |
| `notify.js` | In-app toast + FCM token registration + push-intent hand-off. |
| `auth.js` | Phone-OTP / access-code login; session in localStorage; `signOut`. |
| `maps.js` | Google Maps: geocode, live map, `currentPosition`, `watchPosition`. |
| `aadhaar.js` | Aadhaar OTP mock stub (swap-in interface). |
| `imaging.js` | Photo/certificate compression + size caps. |
| `dom.js` | `guardedClick` / `guardOnce` double-click guards. |
| `pwa-update.js` | Service-worker registration + update prompt. |
| `styles.css` | Shared design system. |

## 4. Booking state machine

States: `created → paid → broadcast → accepted → en_route → arrived → in_service → completion_pending → completed`, plus terminal `cancelled` and `expired`.

Enforced transitions (`TRANSITIONS` in `models.js`):

```
created            → paid, cancelled
paid               → broadcast, cancelled
broadcast          → accepted, expired, cancelled
accepted           → en_route, cancelled
en_route           → arrived, cancelled
arrived            → in_service, cancelled
in_service         → completion_pending, cancelled
completion_pending → completed, cancelled   (admin may still cancel)
completed          → (terminal)
cancelled          → (terminal)
expired            → broadcast, cancelled    (admin re-broadcast / cancel)
```

`advance(booking, next, patch)` asserts the transition, applies the patch, stamps `updatedAt`, and appends `{status, at}` to `history`. This is the single audit trail the admin dashboard reads.

## 5. Key flows

### 5.1 Book → pay → broadcast → serve (secret-code lifecycle)
1. Client selects service, time, recipients, and service location; sees live cost.
2. `Lifecycle.pay()` captures payment and writes the **paid** booking (pay-before-persist).
3. `Lifecycle.broadcast()` selects eligible caregivers via `eligibleCaregivers(booking, all, radius, mode)` and notifies them.
4. Caregiver `accept()` → 6-digit **start code** issued to both sides; caregiver on-service.
5. `startTravel()` opens navigation + live location; `pushLocation()` streams position through en-route/arrived/in-service.
6. `markArrived()` → client enters **start code** (`verifyStartCode`) → in service.
7. `requestCompletion()` issues the **completion code**; `verifyCompletion()` (code + rating) closes the service and frees the caregiver.
8. Admin `releasePayout()` transfers price − commission.

### 5.2 Match-location modes (admin-configurable)
`caregiverMatchPoints(cg, mode)` chooses which point(s) to compare against the booking:
- `gps` → live `cg.location`
- `registered` → `cg.operatingLocation`
- `both` → both; eligible if **either** is in range (OR); nearer distance shown.

### 5.3 Admin targeted invite
For a broadcast booking, admin searches caregivers with **search-local** radius + mode overrides (never touching app-wide settings), optionally including offline caregivers (last-seen GPS/registered), and writes `invitedCaregiverIds` on the booking (stays `broadcast`, schemaless field). Invited caregivers see the request pinned to the top of their queue, bypassing radius (speciality still required), and accept via the normal path.

### 5.4 Cancellation → payment revision → clone
`Lifecycle.cancel(booking, reason, {by, reasonCode})`:
- if paid → `Payments.refund` + `payment.status='refunded'` (+ refund txn/date);
- else → zero-value "void" revision;
- appends to `booking.paymentRevisions[]`; advances to `cancelled` with reason/code/by; frees an on-service caregiver.
`Lifecycle.cloneBooking(original)` builds a fresh `created` booking carrying all details (same date/time and type) with `clonedFrom = original.id`.

## 6. Sync & offline model

- **Source of truth:** Firestore. **Mirror:** IndexedDB (instant reads). **Outbox:** queued writes made offline.
- `Data.write/remove` → mirror + queue + notify + flush. `Data.get/getAll` → mirror. `Data.subscribe` → live `onSnapshot`.
- `Sync.flush()` on startup/reconnect: push outbox, then pull-and-replace the local mirror.
- A green/amber/red status dot reflects online / pending / offline.

## 7. Real-time view reconciliation

Each app's bookings subscription is the single render entry. Resolvers exclude terminal states from "active"; on a tracked booking becoming cancelled/expired, the app toasts and resets to its default screen (client → book; caregiver → stop sharing + free + queue). Admin re-renders on data change and on a 60s timer that **defers** while a modal is open or the dashboard tab is hidden.

## 8. Resilience & UX safety

- **Per-row render isolation:** the admin bookings table renders each row in a try/catch so a single malformed record degrades to one error row, never a blank table; property access on `codes`/`payment` is null-guarded.
- **Double-click guards:** `guardedClick`/`guardOnce` disable a button while its async handler runs and ignore re-entry; handlers re-check record status so a stale tap is a safe no-op.
- **Pay-before-persist:** a failed payment leaves no record.

## 9. Security & deployment

- **Roles/confidentiality** enforced by Firestore rules (clients admin-only + own doc; caregiver public profile; bookings scoped to participants; codes admin-only).
- **Payments** finalized server-side in production (boundary + webhook); `mock` for demo.
- **Keys** are client-scoped and referrer-restricted; Aadhaar is a mock provider.
- **Hosting:** static PWAs on GitHub Pages; Firebase for data/auth/messaging. Each app has a versioned service-worker cache; served over HTTPS in production.

## 10. Testing

- Vitest + jsdom harness (`tests/`) covering the pure/logic layer with Firebase mocked: match-location eligibility, cancel/refund/clone lifecycle, settings defaults + `priorityPrice`, and the at-risk decision.
- Static wiring audits + `node --check` on every change; DOM/real-time flows verified manually (Playwright E2E is a future add).
