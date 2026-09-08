# Firebase / Firestore Setup — License Generator

This tool now syncs its **app registry** and **license history** to Cloud Firestore,
with `localStorage` kept as an offline mirror. This document explains the one-time
setup you must do in the Firebase console, the security rules to apply, and a
browser test checklist.

> The code cannot create your Firestore database or set security rules for you —
> those actions happen in the Firebase console under your account.

---

## 1. Project

The app is wired to Firebase project **`licensegen-b7c9c`** (see `firebase-config.js`).
If that is your project, no change is needed. To point at a different project,
replace the `firebaseConfig` object in `firebase-config.js`.

---

## 2. Enable Cloud Firestore

1. Open the [Firebase console](https://console.firebase.google.com/) and select
   the `licensegen-b7c9c` project.
2. Go to **Build → Firestore Database → Create database**.
3. Choose a location (closest region to you).
4. Start in **production mode** (locked). You will paste the rules below next.

The app uses two collections, created automatically on first write:

| Collection | Document id                         | Fields                                                                 |
|------------|-------------------------------------|------------------------------------------------------------------------|
| `apps`     | `app_<slug-of-name>`                | `name`, `secret` (number[]), `restricted` (bool), `order` (number)     |
| `history`  | `h_<digits>_<hash>`                 | `appName`, `userName`, `licenseKey`, `timestamp`, `licenseType`, `validFrom`, `validTo` |

---

## 3. Security Rules — IMPORTANT

The Firebase Web API key in `firebase-config.js` is **not** a secret and does not
grant access by itself. Access is controlled entirely by **Firestore Security
Rules**. Because this tool stores app signing secrets, you must lock it down.

### Recommended: require sign-in (most secure)

Add **Firebase Authentication** (e.g. Email/Password with just your own account,
or Google sign-in restricted to your email), then use:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Only authenticated users can read/write.
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

> The app now includes an email/password sign-in gate, so this is the intended
> rule set. Enable **Authentication → Sign-in method → Email/Password** and add
> your user under **Authentication → Users**. The app will not read or write
> Firestore until a user is signed in.

### Minimum (no auth) — locked to nobody, open only while you test

If you are running this **only on localhost** and never deploy it publicly, you
can temporarily allow open access **for a short, dated window** and then close it:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      // TEMPORARY — expires automatically. Replace with auth rules ASAP.
      allow read, write: if request.time < timestamp.date(2026, 10, 1);
    }
  }
}
```

### Do NOT use this

```
allow read, write: if true;   // anyone on the internet can read your secrets
```

**To publish rules:** Firestore Database → **Rules** tab → paste → **Publish**.

---

## 4. Authorized domains

Under **Authentication → Settings → Authorized domains**, make sure the domain
you serve the app from is listed. `localhost` is authorized by default. If you
serve from anywhere else, add it.

---

## 5. How sync behaves

- **First run (with data already in `localStorage`):** the app pushes your
  existing registry (only if the cloud `apps` collection is empty) and any local
  history entries that aren't already in the cloud. A one-time flag
  (`license_gen_fb_migrated` in `localStorage`) prevents re-running the push.
- **After migration:** Firestore is the source of truth. Real-time listeners
  update the UI on any change (including from another device/browser).
- **Offline / Firebase unavailable:** the app keeps working from the
  `localStorage` mirror + the Firestore SDK's own IndexedDB cache. The sync
  badge in the top bar shows the current state:
  - green **Synced** — connected
  - amber **Syncing** — a write is in flight
  - red **Offline** — no connection, changes cached locally
  - grey **Local** — Firebase never connected (local-only mode)

---

## 6. Browser test checklist

Serve over `localhost` (Web Crypto + service worker require it):

```
npx http-server -p 8081
```

Then open `http://localhost:8081` and verify:

1. **Sign in** — the app shows a sign-in screen on load. Enter your Firebase
   Authentication email/password. On success the app appears and the badge goes
   grey → amber → green. Console shows
   `[firebase] initialized for project licensegen-b7c9c`. Reloading keeps you
   signed in; use **Manage Apps → Account → Sign Out** to sign out.
2. **Migration** — in the Firebase console, `apps` shows 8 seeded documents;
   generating a license adds a doc to `history`.
3. **Generate** — create a perpetual and a date-restricted key; both appear in
   the History tab and in Firestore.
4. **Cross-device sync** — open the app in a second browser/profile; a license
   generated in one appears in the other within a second or two.
5. **Delete / Clear All** — removing an entry in the app removes the matching
   Firestore doc.
6. **Offline** — turn off the network (or DevTools → Network → Offline). Badge
   turns red; you can still generate keys; they queue and sync when back online.
7. **Manage Apps** — add a custom app; it appears in Firestore `apps` and in the
   dropdown. Protected apps still can't be deleted.

---

## 7. Files added/changed for Firebase

| File                 | Change                                                            |
|----------------------|-------------------------------------------------------------------|
| `firebase-config.js` | **new** — initializes Firebase (ES module), exposes `window.__fb` |
| `firestore-sync.js`  | **new** — sync layer, `window.LicenseSync`                        |
| `app.js`             | registry + history now route through the sync layer               |
| `index.html`         | loads the two new scripts + sync-status badge                     |
| `styles.css`         | sync-status badge styles                                          |
| `sw.js`              | cache bumped to v5; Firebase traffic bypasses the cache           |

---

## 8. Security reminder for source control

This tool contains app **signing secrets** in `app.js` (`DEFAULT_APPS`). Do not
commit it to a **public** repository (for example a `*.github.io` Pages repo),
or anyone could read the secrets and forge license keys. Keep it in a **private**
repo, or exclude the `License_Generator/` folder from any public repo.
