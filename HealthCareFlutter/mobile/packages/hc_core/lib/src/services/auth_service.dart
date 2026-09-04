import 'package:firebase_auth/firebase_auth.dart';

import '../models/models.dart';

/// A signed-in session identity.
class Session {
  final String role;
  final String userId;
  final String name;
  final String phone;
  Session({required this.role, required this.userId, required this.name, required this.phone});
}

/// OTP / secret-code authentication (ports the PWA's auth.js).
///
/// Two paths:
///   - Phone OTP via Firebase Phone Auth (production).
///   - Secret-code login: validate the admin-provisioned accessCode, then sign
///     in anonymously so Firestore reads work under rules keyed on role.
class AuthService {
  final FirebaseAuth _auth;
  AuthService(this._auth);

  /// Secret-code sign-in for a client record.
  Future<Session> signInClientWithCode(Client c, String providedCode) async {
    if (c.accessCode == null || c.accessCode!.isEmpty) {
      throw StateError('No access code on file');
    }
    if (c.accessCode!.trim() != providedCode.trim()) {
      throw StateError('Invalid access code');
    }
    await _auth.signInAnonymously();
    return Session(role: c.role, userId: c.id, name: c.name, phone: c.phone);
  }

  /// Secret-code sign-in for a caregiver record.
  Future<Session> signInCaregiverWithCode(Caregiver c, String providedCode) async {
    if (c.accessCode == null || c.accessCode!.isEmpty) {
      throw StateError('No access code on file');
    }
    if (c.accessCode!.trim() != providedCode.trim()) {
      throw StateError('Invalid access code');
    }
    await _auth.signInAnonymously();
    return Session(role: c.role, userId: c.id, name: c.name, phone: c.phone);
  }

  /// Admin sign-in (simple shared-code gate; harden with real auth for prod).
  Future<Session> signInAdmin(String adminId) async {
    await _auth.signInAnonymously();
    return Session(role: 'admin', userId: adminId, name: 'Admin', phone: '');
  }

  Future<void> signOut() => _auth.signOut();
}
