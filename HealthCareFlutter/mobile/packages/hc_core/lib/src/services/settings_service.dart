import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/models.dart';

/// Platform-wide admin settings (Firestore settings/app). Ports the PWA's
/// settings.js: live stream + admin update. Holds the location-verification
/// policy (locationVerification, verifyRadiusMeters).
class SettingsService {
  final FirebaseFirestore _db;
  SettingsService(this._db);

  DocumentReference<Map<String, dynamic>> get _doc =>
      _db.collection('settings').doc('app');

  /// One-shot read (falls back to defaults).
  Future<AppSettings> load() async {
    try {
      final snap = await _doc.get();
      return AppSettings.fromMap(snap.exists ? snap.data() : null);
    } catch (_) {
      return const AppSettings();
    }
  }

  /// Live stream; emits defaults if the doc is missing.
  Stream<AppSettings> stream() =>
      _doc.snapshots().map((d) => AppSettings.fromMap(d.exists ? d.data() : null));

  /// Admin update (merge).
  Future<void> update(AppSettings settings) => _doc.set(settings.toMap(), SetOptions(merge: true));
}
