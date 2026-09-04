// GENERATED-STYLE TEMPLATE — replace by running `flutterfire configure`.
//
// These values point at the shared project healthcareathome-35727. The web/
// android/ios appId and android/ios apiKey differ per platform; the ones below
// are placeholders derived from the web app you already created. Run
// `flutterfire configure --project=healthcareathome-35727` to generate the
// correct per-platform values (it also drops google-services.json /
// GoogleService-Info.plist into the native folders).
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        return web;
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyBTMDEulRJ85IGyjb-hL0osuInOLZHqw88',
    appId: '1:817661404081:web:312f62164d1445270dd390',
    messagingSenderId: '817661404081',
    projectId: 'healthcareathome-35727',
    authDomain: 'healthcareathome-35727.firebaseapp.com',
    storageBucket: 'healthcareathome-35727.firebasestorage.app',
  );

  // TODO(flutterfire): replace appId/apiKey with the Android app values.
  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyBTMDEulRJ85IGyjb-hL0osuInOLZHqw88',
    appId: '1:817661404081:android:PLACEHOLDER_CLIENT',
    messagingSenderId: '817661404081',
    projectId: 'healthcareathome-35727',
    storageBucket: 'healthcareathome-35727.firebasestorage.app',
  );

  // TODO(flutterfire): replace appId/apiKey/iosBundleId with the iOS values.
  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyBTMDEulRJ85IGyjb-hL0osuInOLZHqw88',
    appId: '1:817661404081:ios:PLACEHOLDER_CLIENT',
    messagingSenderId: '817661404081',
    projectId: 'healthcareathome-35727',
    storageBucket: 'healthcareathome-35727.firebasestorage.app',
    iosBundleId: 'com.sivaramesa.homecare.client',
  );
}
