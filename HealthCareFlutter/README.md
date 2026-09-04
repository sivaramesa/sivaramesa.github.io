# HomeCare — Flutter/Dart native apps

Native migration of the HomeCare PWA to **Flutter/Dart**, per the original spec's
technical stack. Three separate apps share one Dart core package and a Firebase
backend; live tracking runs over an **ASP.NET Core SignalR** hub; the caregiver
app uses the **Google Navigation SDK** for turn-by-turn.

The original PWA (`../HealthCareAtHome`) is untouched and still works — this is a
parallel implementation, not a replacement.

## Layout

```
HealthCareFlutter/
├── mobile/
│   ├── packages/hc_core/        # shared Dart package (no UI)
│   │   └── lib/src/
│   │       ├── models/          # enums + Client/Caregiver/Booking (Firestore maps)
│   │       ├── util/            # codes (OTP), geo (distance/eligibility)
│   │       ├── services/        # repositories, auth, lifecycle, payments,
│   │       │                    #   tracking (SignalR), notifications (FCM)
│   │       └── config.dart      # shared Firebase + Maps + SignalR config
│   ├── app_client/              # Client app
│   ├── app_caregiver/           # Caregiver app (Navigation SDK)
│   └── app_admin/               # Admin app
└── server/HealthCareHub/        # ASP.NET Core SignalR hub (live tracking)
```

All three apps depend on `hc_core` via a path dependency, so the domain model
and the booking lifecycle live in exactly one place.

## Shared backend (same as the PWA)

- **Firebase project:** `healthcareathome-35727` — Firestore is the source of
  truth; the same `clients` / `caregivers` / `bookings` documents are read by
  both the PWA and these apps.
- **Google Maps key:** `AIzaSyB6W9ggDsVZyQo_MYV0Ts52sItH0RWgyPs` (already in the
  Android manifests and `hc_core/config.dart`).

## Prerequisites

- Flutter SDK 3.3+ and Dart 3.3+
- Android Studio / Xcode + a device or emulator
- .NET 8 SDK (for the SignalR hub)
- The FlutterFire CLI: `dart pub global activate flutterfire_cli`

## Setup — do this once per app

Because Flutter apps aren't fully generated here (no Flutter SDK was available
during scaffolding), each app has `lib/` + a hand-written `AndroidManifest.xml`
and `firebase_options.dart`, but you must generate the rest of the native
scaffolding and the real Firebase config:

For each of `app_client`, `app_caregiver`, `app_admin`:

```powershell
# 1. Generate the missing native folders WITHOUT overwriting lib/ or the manifest
flutter create --org com.sivaramesa.homecare --project-name app_client `
  --platforms=android,ios .

# 2. Generate real per-platform Firebase config (replaces the placeholder
#    firebase_options.dart and drops google-services.json / GoogleService-Info.plist)
flutterfire configure --project=healthcareathome-35727

# 3. Fetch packages
flutter pub get
```

Set the Android `applicationId` in each app's `android/app/build.gradle`:

| App | applicationId |
|-----|---------------|
| app_client | `com.sivaramesa.homecare.client` |
| app_caregiver | `com.sivaramesa.homecare.caregiver` |
| app_admin | `com.sivaramesa.homecare.admin` |

> The hand-written `AndroidManifest.xml` files already contain the Google Maps
> key and the right permissions — after `flutter create`, keep these (don't let
> it overwrite them), or re-add the `<meta-data com.google.android.geo.API_KEY>`
> block and location permissions.

### Google Navigation SDK (caregiver app only)

`google_navigation_flutter` is a **premium** Maps product. In Google Cloud:
enable the **Navigation SDK**, accept its terms, and make sure billing is on.
Follow the package's platform setup (min SDK/iOS version bumps) from its README.
The key is the same Maps key already configured.

## Run the SignalR hub

```powershell
cd server/HealthCareHub
dotnet run
# listens on http://0.0.0.0:5080, hub at /hubs/tracking
```

`hc_core/config.dart` points `signalRHubUrl` at `http://10.0.2.2:5080/hubs/tracking`
(10.0.2.2 = the host machine from the Android emulator). Change it to your
server's address for real devices / production.

## Run an app

```powershell
cd mobile/app_client   # or app_caregiver / app_admin
flutter run
```

Seed data first via the **Admin** app: register a client and a caregiver, note
their auto-generated access codes, then sign in to the client/caregiver apps
with phone + access code.

## The lifecycle (unchanged from the PWA)

`hc_core`'s `LifecycleService` enforces the same secret-code flow:

| # | Stage | Code |
|---|-------|------|
| 3 | pay + broadcast to eligible caregivers | — |
| 4 | caregiver accepts | **start code** to both |
| 6 | travel + live location (SignalR) | — |
| 7 | client verifies start code on arrival | start code |
| 8 | caregiver requests completion | **completion code** to client |
| 9 | client re-enters completion code + rates | completion code |

## What's verified vs. not

- **SignalR hub:** built and run-tested with .NET 8 (negotiate endpoint returns 200).
- **Flutter/Dart:** written to compile against the listed package versions, but
  **not** compiled here (no Flutter SDK on the scaffolding machine). Run
  `flutter analyze` after `flutter pub get`; expect to resolve a few
  version-specific API details (notably `google_navigation_flutter`, whose API
  changes across versions).

## Production notes

- Payments are mocked (`PaymentsService`); wire a real gateway server-side.
- Cross-device FCM push needs a backend/Cloud Function to send to stored tokens.
- Firestore rules are still open — lock down before real use (client PII + codes).
- Auth uses anonymous + admin-provisioned access codes; add Phone OTP UI for prod.

## Ported from the PWA (parity update)

The following PWA features were ported into this Flutter project:

- **Services master** — admin-managed `services` collection (name, cost,
  commission %, active). Auto-seeds the six original specialities on first
  admin launch. The client's booking dropdown is driven by active services and
  pre-fills the (editable) cost; each booking snapshots `serviceId` +
  `commissionPct` so later edits don't change past bookings.
- **Per-service commission** — payouts and admin reports use each booking's
  commission snapshot (falling back to the current service, then the global 15%).
- **Location verification** (`settings/app`: `locationVerification`,
  `verifyRadiusMeters`, default off) — admin toggle on the Dashboard tab. When
  on: the client's start screen shows the caregiver's live distance, masks the
  start code (`••••••`) and disables the start button until the caregiver is
  within range; the caregiver's "Complete service" is blocked unless within
  range. Fail-closed when coordinates are missing.
- **Caregiver photo** — captured via `image_picker` on registration (stored as a
  base64 data URL on the caregiver record), shown as identity proof on the
  client's caregiver card.
- **Live available-caregiver count** — shown on the client's booking screen
  while broadcasting.

`image_picker` was added to `app_admin/pubspec.yaml`. PWA-only concerns
(service worker caching, favicon, Maps `loading=async`, update banner) do not
apply to the native Flutter apps and were intentionally not ported.

> Not compiled here (no Flutter SDK on the scaffolding machine). Run
> `flutter pub get` in each app + `flutter analyze`; expect only minor,
> version-specific fixes.
