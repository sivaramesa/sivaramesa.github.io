import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/enums.dart';
import '../models/models.dart';

/// Services master data access (Firestore `services` collection). Ports the
/// PWA's services-master.js: seed the six original specialities once, CRUD,
/// live stream, and commission resolution for a booking.
class ServicesRepository {
  final FirebaseFirestore _db;
  ServicesRepository(this._db);

  static const _col = 'services';
  static const int defaultCommissionPct = 15;

  CollectionReference<Map<String, dynamic>> get _c => _db.collection(_col);

  /// Seed from the original specialities if the collection is empty. Idempotent.
  Future<bool> seedDefaults() async {
    final snap = await _c.get();
    if (snap.docs.isNotEmpty) return false;
    for (final s in kServiceSeed) {
      final id = 'svc_${DateTime.now().microsecondsSinceEpoch}_${s['key']}';
      final svc = Service(
        id: id,
        name: s['name'] as String,
        key: s['key'] as String,
        cost: (s['cost'] as num).toDouble(),
        commissionPct: defaultCommissionPct.toDouble(),
      );
      await _c.doc(svc.id).set(svc.toMap());
    }
    return true;
  }

  Future<List<Service>> all() async {
    final snap = await _c.get();
    return snap.docs.map((d) => Service.fromMap(d.data())).toList();
  }

  Stream<List<Service>> stream() => _c.snapshots().map(
        (s) => s.docs.map((d) => Service.fromMap(d.data())).toList()
          ..sort((a, b) => a.name.compareTo(b.name)),
      );

  Future<void> save(Service s) => _c.doc(s.id).set(s.toMap());
  Future<void> remove(String id) => _c.doc(id).delete();

  static Service create({
    required String name,
    double cost = 0,
    double commissionPct = 15,
    bool active = true,
  }) {
    final key = name.trim().toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '_').replaceAll(RegExp(r'^_+|_+$'), '');
    return Service(
      id: 'svc_${DateTime.now().microsecondsSinceEpoch}',
      name: name.trim(),
      key: key,
      cost: cost,
      commissionPct: commissionPct,
      active: active,
    );
  }
}

/// Resolve the commission fraction (0..1) for a booking: prefer the booking's
/// commission snapshot, then the current service definition, then 0.15.
double commissionFractionFor(Booking booking, List<Service> services) {
  if (booking.commissionPct != null) return booking.commissionPct! / 100.0;
  for (final s in services) {
    if (s.key == booking.speciality) return s.commissionPct / 100.0;
  }
  return 0.15;
}
