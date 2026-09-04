import 'package:cloud_firestore/cloud_firestore.dart';

import '../config.dart';
import '../models/models.dart';

/// Firestore data access. Each collection gets typed reads, real-time streams,
/// and writes. Firestore is the source of truth (same project as the PWA), and
/// its offline persistence gives local caching for free.
class Repositories {
  final FirebaseFirestore _db;
  Repositories(this._db);

  CollectionReference<Map<String, dynamic>> get _clients =>
      _db.collection(HcConfig.colClients);
  CollectionReference<Map<String, dynamic>> get _caregivers =>
      _db.collection(HcConfig.colCaregivers);
  CollectionReference<Map<String, dynamic>> get _bookings =>
      _db.collection(HcConfig.colBookings);

  // ── Clients ────────────────────────────────────────────────────────────
  Future<void> saveClient(Client c) => _clients.doc(c.id).set(c.toMap());
  Future<void> deleteClient(String id) => _clients.doc(id).delete();

  Future<Client?> getClient(String id) async {
    final d = await _clients.doc(id).get();
    return d.exists ? Client.fromMap(d.data()!) : null;
  }

  Future<List<Client>> allClients() async {
    final s = await _clients.get();
    return s.docs.map((d) => Client.fromMap(d.data())).toList();
  }

  Stream<List<Client>> clientsStream() =>
      _clients.snapshots().map((s) => s.docs.map((d) => Client.fromMap(d.data())).toList());

  Future<Client?> clientByPhone(String phone) async {
    final norm = phone.replaceAll(RegExp(r'\s'), '');
    final all = await allClients();
    for (final c in all) {
      if (c.phone.replaceAll(RegExp(r'\s'), '') == norm) return c;
    }
    return null;
  }

  // ── Caregivers ─────────────────────────────────────────────────────────
  Future<void> saveCaregiver(Caregiver c) => _caregivers.doc(c.id).set(c.toMap());
  Future<void> deleteCaregiver(String id) => _caregivers.doc(id).delete();

  Future<Caregiver?> getCaregiver(String id) async {
    final d = await _caregivers.doc(id).get();
    return d.exists ? Caregiver.fromMap(d.data()!) : null;
  }

  Future<List<Caregiver>> allCaregivers() async {
    final s = await _caregivers.get();
    return s.docs.map((d) => Caregiver.fromMap(d.data())).toList();
  }

  Stream<List<Caregiver>> caregiversStream() => _caregivers
      .snapshots()
      .map((s) => s.docs.map((d) => Caregiver.fromMap(d.data())).toList());

  Future<Caregiver?> caregiverByPhone(String phone) async {
    final norm = phone.replaceAll(RegExp(r'\s'), '');
    final all = await allCaregivers();
    for (final c in all) {
      if (c.phone.replaceAll(RegExp(r'\s'), '') == norm) return c;
    }
    return null;
  }

  // ── Bookings ───────────────────────────────────────────────────────────
  Future<void> saveBooking(Booking b) => _bookings.doc(b.id).set(b.toMap());

  Future<Booking?> getBooking(String id) async {
    final d = await _bookings.doc(id).get();
    return d.exists ? Booking.fromMap(d.data()!) : null;
  }

  Stream<List<Booking>> bookingsStream() => _bookings
      .snapshots()
      .map((s) => s.docs.map((d) => Booking.fromMap(d.data())).toList());

  /// Live stream of a single booking (drives the client's tracking screen).
  Stream<Booking?> bookingStream(String id) =>
      _bookings.doc(id).snapshots().map((d) => d.exists ? Booking.fromMap(d.data()!) : null);
}
