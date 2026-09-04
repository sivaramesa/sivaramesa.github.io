/// Central configuration shared by the three HomeCare Flutter apps.
///
/// Reuses the same Firebase project and Google Maps key as the PWA. Platform
/// SDK keys (Maps/Navigation) also live in the native manifests; this Dart copy
/// is for any Dart-side use and for a single source of truth.
class HcConfig {
  // Firebase project — same as the PWA (healthcareathome-35727).
  static const firebaseProjectId = 'healthcareathome-35727';
  static const firebaseApiKey = 'AIzaSyBTMDEulRJ85IGyjb-hL0osuInOLZHqw88';
  static const firebaseAuthDomain = 'healthcareathome-35727.firebaseapp.com';
  static const firebaseMessagingSenderId = '817661404081';
  static const firebaseAppId = '1:817661404081:web:312f62164d1445270dd390';
  static const firebaseStorageBucket = 'healthcareathome-35727.firebasestorage.app';

  // Google Maps / Navigation SDK key — same as the PWA.
  static const googleMapsApiKey = 'AIzaSyB6W9ggDsVZyQo_MYV0Ts52sItH0RWgyPs';

  // ASP.NET Core SignalR hub base URL for live tracking.
  // Point this at your deployed server; localhost works for emulator testing
  // (use 10.0.2.2 on the Android emulator to reach the host machine).
  static const signalRHubUrl = 'http://10.0.2.2:5080/hubs/tracking';

  // Firestore collection names (identical to the PWA).
  static const colClients = 'clients';
  static const colCaregivers = 'caregivers';
  static const colBookings = 'bookings';
  static const colPayments = 'payments';

  // Business rules.
  static const double defaultMatchRadiusKm = 15;
  static const int requestExpiryMinutes = 10;
  static const int locationPingMs = 5000;
  static const double platformCommission = 0.15;
}
