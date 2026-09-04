// GENERATED-STYLE TEMPLATE — replace by running `flutterfire configure`.
// Points at the shared project healthcareathome-35727. See app_client for notes.
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

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyBTMDEulRJ85IGyjb-hL0osuInOLZHqw88',
    appId: '1:817661404081:android:PLACEHOLDER_ADMIN',
    messagingSenderId: '817661404081',
    projectId: 'healthcareathome-35727',
    storageBucket: 'healthcareathome-35727.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyBTMDEulRJ85IGyjb-hL0osuInOLZHqw88',
    appId: '1:817661404081:ios:PLACEHOLDER_ADMIN',
    messagingSenderId: '817661404081',
    projectId: 'healthcareathome-35727',
    storageBucket: 'healthcareathome-35727.firebasestorage.app',
    iosBundleId: 'com.sivaramesa.homecare.admin',
  );
}
