# HomeCare @ Home — Requirements Document

**Product:** HomeCare — on-demand home health-care coordination platform
**Delivery form:** Three connected Progressive Web Apps (Client, Caregiver, Admin) sharing one real-time data model.
**Status:** Reflects the implemented system as of this revision.

---

## 1. Purpose & Scope

HomeCare connects people who need health services at their residence (Clients) with vetted health professionals (Caregivers), coordinated by a middle-man operator (Admin). The platform handles registration and vetting, service booking and pricing, real-time caregiver matching and dispatch, secret-code–verified service execution, payments in/out with commission, and operational oversight.

In scope:
- Self-registration for clients and caregivers, with Aadhaar (mock) verification and admin approval for caregivers.
- Booking a single service for one or more recipients, scheduled or priority.
- Real-time broadcast, acceptance, live tracking, and code-verified start/complete.
- Payments (capture, refund on cancel, payout to caregiver) through a gateway boundary.
- Admin dashboard: full visibility, edit/cancel/clone bookings, targeted caregiver invites, reporting, configuration.

Out of scope (current build):
- Server-side payment settlement/webhooks (boundary stubbed; provider `mock` by default).
- Cross-device push delivery backend (tokens registered; open-app real-time feed drives live updates).
- Native mobile apps (delivered as PWAs).

---

## 2. Actors

| Actor | Description | App |
|-------|-------------|-----|
| **Client** | Person booking services for themselves and/or registered members. | Client PWA |
| **Caregiver** | Health professional who accepts and performs services. | Caregiver PWA |
| **Admin** | Operator/middle-man: vetting, oversight, payments, configuration. | Admin PWA |

---

## 3. Functional Requirements

### FR-1 Confidentiality & Roles
- FR-1.1 Client PII (Aadhaar, DOB, contact, members) is surfaced only in the Admin app.
- FR-1.2 Caregiver public profile (name, specialities, rating, photo) is visible to clients; access codes are admin-only.
- FR-1.3 Each app authenticates its own role; a session (role + user id) persists across reloads.

### FR-2 Caregiver Registration & Vetting
- FR-2.1 A caregiver self-registers with surname, forename, DOB, sex, photo (thumbnail), specialities, residence address + geo, and an operating (service) location + geo (same-as-residence or different).
- FR-2.2 Aadhaar number is captured and verified via OTP (mock stub with a swap-in interface).
- FR-2.3 Certificate images are attached, compressed and size-capped (kept small to fit Firestore document limits; no separate file storage).
- FR-2.4 On submission the account is **Registered** and **cannot log in**.
- FR-2.5 Admin reviews the registration (fields, photo, certificates, locations) and **Approves → Active** or **Rejects**. Only **Active** caregivers can log in.
- FR-2.6 Admin can quick-add a pre-approved caregiver.

### FR-3 Client Registration
- FR-3.1 A client self-registers with surname, forename, sex, DOB, phone (login id), photo, residence address + geo, and Aadhaar (OTP verified).
- FR-3.2 The client can add/remove additional **members** (surname, forename, sex, DOB, optional relationship, photo, address+geo with a same-as-primary option, Aadhaar OTP).
- FR-3.3 The Register button is enabled only when self and every member are Aadhaar-verified.
- FR-3.4 On registration the client is **active immediately**; an access code is generated; `savedLocations` are populated from self + member addresses.

### FR-4 Service Catalogue (Services Master)
- FR-4.1 Admin maintains a master list of services, each with a display name, stable key, cost, commission %, and active flag.
- FR-4.2 Commission defaults to 15% and is editable per service; existing services are migrated to the default.
- FR-4.3 The master seeds once from the six original specialities (Nursing, Physiotherapy, Elder Care, Post Surgery, Baby Care, Lab Sample).

### FR-5 Booking Creation
- FR-5.1 A client books exactly **one** service per request.
- FR-5.2 The client picks **when** (date + time; default now + configured lead hours).
- FR-5.3 The client selects one or more **recipients** (self and/or registered members). Cost = service unit cost × recipient count.
- FR-5.4 The service is delivered at a **single location**, chosen as one of:
  - the recipient's saved address (self if selected, else first member),
  - the client's **current live GPS** location, or
  - a **newly entered/geocoded** address.
- FR-5.5 If recipients have different saved locations, a soft warning is shown (no hard block).
- FR-5.6 **Payment is completed before the booking is persisted** (no orphaned unpaid records).

### FR-6 Priority Booking
- FR-6.1 A normal booking must respect the admin lead time; a request sooner than that must use Priority.
- FR-6.2 The client may choose **Priority** for any appointment via an explicit button, which shows the increased cost.
- FR-6.3 Priority rate is admin-configurable: mode = multiplier | percent | flat, default ×1.5.
- FR-6.4 Priority bookings are flagged and visually differentiated (badge + row highlight) for admin action.

### FR-7 Matching & Broadcast
- FR-7.1 On payment, the request is broadcast to caregivers matching the service speciality and within the chosen radius (km).
- FR-7.2 The caregiver location used for matching is admin-configurable (`matchLocationMode`): **gps** (live location), **registered** (operating location), or **both** (eligible if *either* is in range — OR semantics; nearer distance shown).
- FR-7.3 The client sees a live count of available caregivers while broadcasting.

### FR-8 Admin Targeted Invite
- FR-8.1 For an open (broadcast, not-yet-accepted) booking, admin can search caregivers with a **search-local** radius override and location-mode override that do **not** change the app-wide setting.
- FR-8.2 The search can include **offline** caregivers (matched by last-seen GPS, else registered location), toggled by a checkbox; a "select all shown" one-click control is provided.
- FR-8.3 Admin links one or more caregivers with **high precedence**; invited caregivers see the request pinned to the top of their queue (bypassing radius, speciality still required) and can accept normally.

### FR-9 Service Execution (Secret-Code Lifecycle)
- FR-9.1 A caregiver toggles availability and sees a queue of eligible requests.
- FR-9.2 On **accept**, a 6-digit **start code** is issued and shared with both client and caregiver; the caregiver is marked on-service.
- FR-9.3 The caregiver **starts travel**: navigation opens and live location streams to the client.
- FR-9.4 The caregiver **marks arrival**; the client enters the **start code** to begin (→ in service).
- FR-9.5 The caregiver **requests completion**; a 6-digit **completion code** is issued to the client.
- FR-9.6 The client enters the **completion code** with a star rating + comments to officially close the service; the caregiver is freed and their rating average updated.

### FR-10 Location Verification (optional policy)
- FR-10.1 Admin can require the caregiver to be within a configurable radius (metres) of the service location to start/complete (fail-closed if coordinates are missing).

### FR-11 Cancellation, Payment Revision & Clone
- FR-11.1 A **client** can cancel only **before** a caregiver accepts (CREATED/PAID/BROADCAST).
- FR-11.2 **Admin** can cancel at any status except Completed/Cancelled.
- FR-11.3 Every cancel records a **payment revision**: a refund (with txn id) when paid, or a zero-value "void" entry when unpaid; an assigned caregiver is freed.
- FR-11.4 A cancellation requires a **reason code** chosen from an admin-configurable list (defaults: "No Show of Caregiver", "Client requested", "Priority changes") plus an "Other" free-text option.
- FR-11.5 On admin cancel, an option to **clone** a new request is offered: cloning creates a fresh booking carrying all details (same date/time, same booking type) with a `clonedFrom` marker; declining keeps only the cancellation.
- FR-11.6 After cancellation, the client and caregiver views reset cleanly to their default screen (no stuck state); the caregiver stops location sharing and is freed.

### FR-12 Admin Booking Management
- FR-12.1 Admin sees every booking with all secret codes and payment status.
- FR-12.2 Admin can edit a booking (service, schedule, price, radius, priority) and override status; and delete a booking.
- FR-12.3 A dashboard filter toggles inclusion of completed records (default off).
- FR-12.4 Bookings that are **accepted but not started** and whose scheduled time is within a configurable window (default 30 min) or overdue are highlighted as **at-risk**, with an at-risk count and an at-risk-only filter.
- FR-12.5 The time-based at-risk refresh (60s) must not disrupt ongoing admin activity (an open modal or a non-dashboard tab defers the refresh).

### FR-13 Payments & Reporting
- FR-13.1 Client payment is captured into the platform; the caregiver payout (price − commission) is released by admin after completion.
- FR-13.2 Admin reporting provides daily / date-range totals (bookings, completed, gross, commission, payout, ratings).

### FR-14 Cross-cutting UX
- FR-14.1 Client and caregiver banners show the logged-in user's photo thumbnail + name and a **Sign out** link.
- FR-14.2 Action buttons that mutate state (booking, verify start/complete, accept, payout, approve/reject, save/cancel/invite) are guarded against double-clicks; a duplicate/stale tap is a safe no-op, not an error.

---

## 4. Non-Functional Requirements

- **NFR-1 Offline-first:** each app mirrors Firestore into IndexedDB and queues writes in an outbox; reads are instant offline, writes reconcile on reconnect.
- **NFR-2 Real-time:** status/tracking changes propagate via Firestore `onSnapshot` to all apps.
- **NFR-3 Installable PWA:** each app has a manifest + service worker with a versioned cache; served over HTTPS in production.
- **NFR-4 Resilience:** rendering must not blank on a single malformed record (per-row error isolation); a failed payment leaves no orphaned record.
- **NFR-5 Data size:** photos/certificates are compressed and size-capped to fit Firestore document limits (no separate object storage).
- **NFR-6 Security:** Firestore rules enforce role confidentiality; payment finalization is a server responsibility; secrets/keys are client-scoped and referrer-restricted.
- **NFR-7 Maintainability:** shared domain logic (models, lifecycle, geo, settings, payments) is centralized and unit-tested.

---

## 5. Assumptions & Constraints

- Aadhaar verification is a **mock** with a swap-in interface for a real provider.
- Payment provider is a boundary; `mock` by default, real gateways require server-side confirmation.
- Google Maps key optional — geocoding/maps degrade gracefully when absent.
- Deployment target: GitHub Pages (static hosting) + Firebase backend services.
