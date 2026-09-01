# HomeCare @ Home — Feature List

A checklist of implemented capabilities, grouped by app/area. Each maps to requirements in `01-Requirements.md`.

## Client app

- [x] Self-registration: self (surname, forename, sex, DOB, photo, address+geo, Aadhaar OTP) + add/remove members, each with own address (same-as-primary toggle) and Aadhaar OTP.
- [x] Register enabled only when self + all members Aadhaar-verified; active immediately; auto access code; saved locations populated.
- [x] Phone + access-code login; session persisted.
- [x] Book one service per request from the services master.
- [x] Choose date/time (default now + configured lead hours).
- [x] Select one or more recipients (self and/or members); live cost = unit × recipients.
- [x] **Service location chooser:** recipient's saved address, current live GPS, or a newly entered/geocoded address.
- [x] Soft warning when selected recipients are at different locations.
- [x] Priority booking button with cost-increase note; blocks sub-lead-time normal bookings.
- [x] Pay-before-persist (no orphaned unpaid records); price guarded against NaN/zero.
- [x] Live "N caregivers available within X km" count while broadcasting.
- [x] Assigned caregiver card (name, photo, rating); start code display with optional proximity gate.
- [x] Live caregiver tracking on a map (en route / arrived).
- [x] Verify start code → service begins; verify completion code + star rating → service closed.
- [x] Cancel booking before a caregiver accepts, with reason-code picker (+ Other) and refund note.
- [x] Clean view reset when a booking is cancelled/expired (with toast).
- [x] Banner: user photo thumbnail + name + Sign out.

## Caregiver app

- [x] Self-registration with photo, specialities, residence + operating location (same/different) + geo, Aadhaar OTP, capped certificate uploads.
- [x] Registered → blocked from login until admin approves to Active (or Rejects).
- [x] Availability toggle (available / unavailable).
- [x] Request queue filtered by speciality + radius, honoring the admin match-location mode.
- [x] **Admin invites** appear pinned to the top (bypass radius; speciality still required) and visible even when off-duty.
- [x] Accept a job (start code issued; marked on-service) — double-click guarded.
- [x] Start travel (opens navigation) + continuous live location sharing.
- [x] Mark arrived; request completion — all stage buttons double-click guarded with status re-checks.
- [x] Clean reset + stop location sharing + freed availability when a job is cancelled by admin.
- [x] Banner: photo thumbnail + name + Sign out.

## Admin app

- [x] Full dashboard: every booking, all secret codes, payment status, client/caregiver, schedule, recipients.
- [x] Register/list clients (confidential PII) and caregivers.
- [x] Caregiver registrations review: inspect fields/photo/certs/locations → Approve/Reject (guarded).
- [x] Caregiver directory with name/speciality/sex filters + distance-from-point (geocoded) filter, honoring match mode.
- [x] Services master: add/edit services (name, cost, commission %, active); 15% default; seed + migrate.
- [x] Settings: location-verification toggle + radius; booking lead hours; priority mode/value; match-location mode; cancellation reason codes; start-risk alert minutes.
- [x] Edit booking (service, schedule, price, radius, priority) + status override; delete booking (guarded save).
- [x] Cancel any non-completed booking with reason-code picker; then clone-new-request Yes/No.
- [x] Payment revision recorded on every cancel (refund txn when paid, void when unpaid); assigned caregiver freed.
- [x] Find & invite caregivers for open bookings: search-local radius + location-mode overrides, include-offline (last-seen GPS/registered) checkbox, select-all-shown, multi-select high-precedence link (guarded).
- [x] Dashboard filters: include-completed (default off) and at-risk-only; at-risk count badge.
- [x] At-risk highlight (red row/badge, "Xm left"/"Overdue") for accepted-but-not-started within a configurable window; 60s refresh that defers during modals / off-dashboard.
- [x] Payments: capture visible; release payout (price − commission) after completion (guarded, idempotent).
- [x] Reporting: daily / date-range totals (bookings, completed, gross, commission, payout, ratings).
- [x] Row indicators: Priority ⚡, Rebooked ↻ (clone), ★ Invited N, cancellation reason.

## Platform / shared

- [x] Offline-first: IndexedDB mirror + outbox + reconcile; instant local reads.
- [x] Real-time via Firestore `onSnapshot` subscriptions (`Data`/`Sync` facade).
- [x] Booking state machine with enforced transitions and full history/audit trail.
- [x] Secret-code generate/verify (start + completion 6-digit codes).
- [x] Distance/eligibility (haversine) with three match-location modes.
- [x] Payment boundary: charge / payout / refund (mock + swap-in gateway).
- [x] Aadhaar OTP mock stub with swap-in interface.
- [x] Image compression + size caps for photos and certificates.
- [x] Shared double-click guard helpers (`guardedClick` / `guardOnce`).
- [x] Per-app service workers with versioned caches; PWA installable.
- [x] Vitest unit-test harness (geo matching, cancel/refund/clone lifecycle, settings + pricing, at-risk logic).
- [x] One-off admin migration page (default empty addresses) with dry-run + apply.

## Known boundaries / not yet built

- [ ] Server-side payment settlement + gateway webhooks (currently mock/boundary).
- [ ] Cross-device push delivery backend (tokens registered; real-time feed drives updates).
- [ ] Distinct priority-booking **admin workflow** beyond flag/badge/highlight (pending spec).
- [ ] Browser end-to-end (Playwright) automation (logic-level tests exist).
