import 'package:firebase_messaging/firebase_messaging.dart';

/// Firebase Cloud Messaging wrapper (the spec's push notifications).
///
/// Registers the device, exposes the token so it can be stored on the user's
/// Firestore record, and streams foreground messages. Cross-device delivery
/// (waking a backgrounded app) still requires a server/Cloud Function to send
/// to stored tokens — the same as the PWA.
class NotificationService {
  final _fcm = FirebaseMessaging.instance;

  Future<String?> register() async {
    final settings = await _fcm.requestPermission();
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      return null;
    }
    return _fcm.getToken();
  }

  Stream<RemoteMessage> get onForegroundMessage => FirebaseMessaging.onMessage;
}
