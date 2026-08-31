# HomeCare — Health Services at Residence

Three connected Progressive Web Apps that coordinate on-demand home health care:

- **Client** (`client/`) — book a service, pay, track the caregiver live, and confirm each stage with a secret code.
- **Caregiver** (`caregiver/`) — set availability, accept nearby requests, navigate to the client, share live location, and complete services.
- **Admin** (`admin/`) — the middle-man dashboard: manage clients and caregivers, see every booking and every secret code, handle payments in/out, and run daily / date-range reports.

They share one real-time data model synced through Firebase Firestore, following this workspace's offline-first PWA conventions (local IndexedDB mirror + outbox + reconcile).

> **A note on the tech stack.** The original spec listed Flutter/Dart with the Google Navigation SDK and SignalR. The delivered requirement (part A) was explicitly *"3 PWA applications"*, so this is built as PWAs to match the requirement and the existing workspace conventions. The spec's intent is mapped onto web equivalents: Google Maps JavaScript API + Geocoding + Directions (for Maps/Geocoding/Routes/Navigation), Firestore real-time `onSnapshot` (for WebSockets/SignalR live tracking), FCM web push (for notifications), and a payment-gateway boundary (for payments).

## Folder layout

```
HealthCareAtHome/
├── index.html            # landing page linking the three apps
├── shared/               # code shared by all three apps
│   ├── config.js         # << PUT YOUR KEYS HERE
│   ├── firebase.js       # Firebase app/firestore/auth bootstrap
│   ├── models.js         # domain model, enums, factories, state machine
│   ├── db.js             # IndexedDB mirror + offline outbox
│   ├── sync.js           # reconcile engine + real-time subscriptions + Data facade
│   ├── lifecycle.js      # booking state machine (the heart of the flow)
│   ├── codes.js          # secret-code / OTP generate + verify
│   ├── geo.js            # distance + eligibility (haversine)
│   ├── maps.js           # Google Maps: geocode, directions, live tracking
│   ├── payments.js       # payment gateway boundary (charge / payout)
│   ├── notify.js         # FCM web push + in-app toast
│   ├── auth.js           # phone-OTP / secret-code login
│   ├── styles.css        # shared design system
│   └── icons/            # PWA icons (+ make-icons.js generator)
├── client/               # Client PWA (index.html, app.js, manifest.json, sw.js)
├── caregiver/            # Caregiver PWA
└── admin/                # Admin PWA
```

## Setup

### 1. Configure keys — `shared/config.js`

| Key | Where to get it |
|-----|-----------------|
| `firebase.*` | Firebase console › Project settings › Web app config |
| `fcmVapidKey` | Firebase console › Cloud Messaging › Web push certificates |
| `googleMapsApiKey` | Google Cloud console › APIs & Services (enable Maps JavaScript, Geocoding, Directions). Restrict by HTTP referrer. |
| `payment.publishableKey` | Your gateway dashboard (Razorpay/Stripe **publishable** key only) |

Leave `payment.provider` as `'mock'` to demo the full flow without a real gateway.
Without a Google Maps key, the apps still run — map/geocoding features degrade gracefully.

### 2. Firebase

Enable **Firestore**, **Authentication** (Phone + Anonymous), and **Cloud Messaging**.
Create these collections (they auto-create on first write): `clients`, `caregivers`, `bookings`, `payments`.

Suggested Firestore security rules (enforce the confidentiality in requirement 1):

- `clients` — readable/writable only by admin; a client may read only their own doc.
- `caregivers` — public profile fields readable by all signed-in users; `accessCode` readable by admin only.
- `bookings` — a client sees their own; a caregiver sees ones assigned or broadcast to them; admin sees all.

### 3. Run locally

PWAs need to be served over HTTP (service workers won't register from `file://`):

```powershell
# from the HealthCareAtHome folder
python -m http.server 8080
# then open:
#   http://localhost:8080/            (landing)
#   http://localhost:8080/client/
#   http://localhost:8080/caregiver/
#   http://localhost:8080/admin/
```

For phone-OTP and FCM in production, serve over **HTTPS**.

### 4. First-run seed

Open the **Admin** app › *Clients* and *Caregivers* tabs, register at least one of each, and note the auto-generated **access code** for each. Clients and caregivers sign in with their **phone + access code**.

## The secret-code lifecycle

Every stage is enforced by `shared/lifecycle.js` against the `TRANSITIONS` state machine, and every code is visible to the admin.

| # | Stage | What happens | Code |
|---|-------|--------------|------|
| 3 | **Pay & broadcast** | Client pays; eligible caregivers (matching speciality **and** within the chosen km radius) are alerted. | — |
| 4 | **Accept** | A caregiver accepts. Booking is confirmed, caregiver profile is shared with the client. | **Start code** issued, shared with *both* |
| 6 | **Travel** | Caregiver starts travel; navigation opens; live location streams to the client's map. | — |
| 7 | **Arrival** | Caregiver arrives; client asks for the start code and enters it to begin. | **Start code** verified → service begins |
| 8 | **Request completion** | Caregiver initiates completion. | **Completion code** issued to client |
| 9 | **Confirm completion** | Client enters the completion code with a star rating + comments. Service is officially closed. | **Completion code** verified → completed |

Admin then **releases the payout** to the caregiver (service price minus platform commission).

## Data flow & real-time

- **Firestore** is the source of truth. **IndexedDB** mirrors each collection for instant, offline reads. An **outbox** queues writes made offline.
- All writes go through `Data.write()` (local-first, then queued for Firestore) — never a bare awaited cloud write.
- `Sync.subscribe(collection, cb)` opens a shared `onSnapshot` listener; this is the real-time channel that drives request broadcast, live tracking and status changes across all three apps.
- `Sync.flush()` runs on startup and on every reconnect: **push** the outbox, then **pull & replace** the local mirror from the server.
- A sync-status dot (green / amber / red) in each app's top bar reflects online/pending/offline.

## Production notes / limitations

- **Payments must be finalized server-side.** `payments.js` is a client-side boundary; wire it to your gateway's server SDK + webhook so `booking.payment.status` is authoritative. The `'mock'` provider is for demo only.
- **Cross-device push (FCM)** requires a backend (or Cloud Function) to send messages to stored device tokens. `notify.js` registers tokens and logs push intents; the open-app real-time feed already updates instantly.
- **Auth** uses Firebase Phone OTP and an admin-provisioned access code. Harden with proper Firestore rules before going live.
- Icons were generated by `shared/icons/make-icons.js` (`node make-icons.js`).
