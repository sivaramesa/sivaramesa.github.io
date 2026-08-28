# Ledger Tracker (PWA)

An offline-first Progressive Web App for tracking **income and expenses** against **account heads (projects)**. Every entry records **who** entered it, **when** it happened, an optional **GST** breakdown, and optional **photo proof**. Data syncs across devices through Firebase, and the app keeps working offline.

## Features

- **Login / signup** with Firebase Authentication (email + password)
- **Account heads (projects)** — create ledger buckets (e.g. "Site A", "Client X", "Office") with a type (project / asset / liability) and an opening balance
- **Income & expense entries** recorded against an account head
- **Optional GST** — tick to add a GST rate; the app computes GST amount and GST-inclusive total, and stores both base and total amounts
- **Who & when tracking** — each entry stores the signed-in user (name/email/uid), the entry date, and a recorded-at timestamp
- **Photo proof** uploaded to Firebase Storage (auto-compressed)
- **Real-time cloud sync** via Firestore, shared across signed-in devices
- **Offline-first** — Firestore persistent cache + a local IndexedDB mirror. Add entries offline; they sync automatically when you reconnect
- **Reports**
  - Monthly report (pick any month)
  - Custom date-range report (start → end, inclusive)
  - Optional filter by a single account head
  - Income / expense / net / GST totals, plus breakdowns **by account head**, by category, and by person
  - Toggle to report on base amounts or GST-inclusive totals
  - CSV export
- **Balance sheet** for any date range — per-account opening balance + income − expenses = closing balance, with grand totals and GST collected vs GST paid; CSV export
- **Installable PWA** with service-worker app-shell caching

## Project structure

```
ExpenseTracker/
├── index.html            # Auth screen + app shell (Add / Entries / Accounts / Reports)
├── manifest.json         # PWA manifest
├── sw.js                 # Service worker (app-shell caching)
├── css/styles.css
├── icons/                # 192 & 512 PNG icons
└── js/
    ├── app.js            # Main controller (wires everything)
    ├── firebase-config.js# Firebase init + your project config  <-- EDIT THIS
    ├── auth.js           # Firebase Auth wrapper
    ├── db.js             # IndexedDB offline mirror (entries + accounts)
    ├── accounts.js       # Account heads: Firestore CRUD + sync
    ├── entries.js        # Income/expense entries + GST: Firestore CRUD + sync
    ├── storage.js        # Photo-proof upload (Firebase Storage)
    ├── reports.js        # Reports, account grouping, balance sheet
    ├── ui.js             # DOM rendering
    └── utils.js          # Shared helpers
```

## Data model

**Account head** (`accounts` collection): `{ id, name, type, description, openingBalance, createdBy, createdAt, updatedAt }`

**Entry** (`entries` collection):
`{ id, type: 'income'|'expense', accountId, amount (base), category, description, date, gstEnabled, gstRate, gstAmount, totalAmount, createdBy {uid,name,email}, createdAt, photoPath, photoUrl }`

## Setup

### 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com) and create a project.
2. **Authentication** → Sign-in method → enable **Email/Password**.
3. **Firestore Database** → create a database (Production mode is fine).
4. **Storage** → get started.
5. Project settings → **Your apps** → add a **Web app** and copy the config.

### 2. Add your config

Open `js/firebase-config.js` and replace the placeholder `firebaseConfig` values with the config from your Firebase web app.

### 3. Security rules

**Firestore** (`Firestore → Rules`) — signed-in users share the ledger; each user can only create records under their own identity and only edit/delete their own:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /entries/{id} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
                    && request.resource.data.createdBy.uid == request.auth.uid;
      allow update, delete: if request.auth != null
                    && resource.data.createdBy.uid == request.auth.uid;
    }
    match /accounts/{id} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
                    && request.resource.data.createdBy.uid == request.auth.uid;
      allow update, delete: if request.auth != null
                    && resource.data.createdBy.uid == request.auth.uid;
    }
  }
}
```

**Storage** (`Storage → Rules`) — a user can only write photo proofs under their own folder; any signed-in user can read them:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /proofs/{uid}/{file} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

> Adjust the read scope if you want each user to see only their own data instead of a shared ledger.

### 4. Run it

The app uses ES modules and a service worker, so it must be served over HTTP(S), not opened via `file://`. From the `ExpenseTracker` folder:

```powershell
# Any static server works. For example, with Python:
python -m http.server 8080
```

Then open http://localhost:8080. For install-to-home-screen and full PWA behavior, serve over HTTPS (e.g. Firebase Hosting).

## Usage flow

1. Sign up / sign in.
2. Go to **Accounts** and create at least one account head (project). Set an opening balance if the account already carries a value.
3. On **Add**, choose Expense or Income, pick the account head, enter the amount, optionally enable GST, optionally attach a photo, and save.
4. **Entries** lists everything with income/expense totals; filter by account or type.
5. **Reports** produces monthly or custom-range reports (optionally scoped to one account) and a **balance sheet** for a date range.

## How offline sync works

The app is offline-first with an explicit reconcile step (`js/sync.js`):

1. **Local-first writes** — every create/update/delete writes to the IndexedDB mirror immediately and enqueues a pending operation in an **outbox** store. The UI updates instantly whether you're online or not.
2. **Push** — on startup (when online) and on every reconnect, the outbox is drained in FIFO order: each pending op is pushed to Firebase (`setDoc` / `deleteDoc`), and removed from the outbox only once it succeeds. A failed op stays queued and is retried on the next sync.
3. **Pull & replace** — after pushing, the app does a forced **server read** (`getDocsFromServer`) for `entries` and `accounts`, clears the local IndexedDB stores, and replaces them with the authoritative Firebase data.

Firestore's own **persistent cache** and real-time `onSnapshot` subscriptions keep data fresh during a normal session; the outbox + reconcile handles the "made changes while offline" case deterministically.

The top-bar sync indicator shows the state:
- **green ●** — online and fully synced
- **amber ● N** — N local changes waiting to sync
- **spinning ⟳** — currently syncing
- **red ●** — offline

## Notes

- GST: the entered amount is the **base (pre-GST)** amount; GST amount and GST-inclusive total are computed and stored. Reports can show either base or GST-inclusive figures via the "Use GST-inclusive totals" toggle.
- Deleting an account head keeps its entries (they show as "Unassigned").
- Photos are downscaled to a max edge of 1280px and re-encoded as JPEG before upload.
- Amounts are formatted in INR (₹). Change the locale/currency in `js/utils.js` (`formatMoney`) if needed.
- IDs are generated client-side (UUID); timestamps are stored as ISO-8601 strings.
