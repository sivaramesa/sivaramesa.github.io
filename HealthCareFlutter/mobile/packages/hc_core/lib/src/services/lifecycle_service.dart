import '../models/enums.dart';
import '../models/models.dart';
import '../util/codes.dart';
import '../util/geo.dart';
import 'payments_service.dart';
import 'repositories.dart';
import 'tracking_service.dart';

/// The booking state machine (ports the PWA's lifecycle.js). Each stage of
/// requirements 3–9 is a method. Transitions are validated against
/// [kTransitions]; every change appends to history and persists to Firestore.
class LifecycleService {
  final Repositories repo;
  final PaymentsService payments;
  final TrackingService? tracking;

  LifecycleService({
    required this.repo,
    required this.payments,
    this.tracking,
  });

  void _assert(Booking b, String next) {
    final allowed = kTransitions[b.status] ?? const [];
    if (!allowed.contains(next)) {
      throw StateError('Illegal transition: ${b.status} -> $next');
    }
  }

  Booking _advance(Booking b, String next,
      {BookingCodes? codes,
      BookingPayment? payment,
      BookingTracking? tracking,
      BookingFeedback? feedback,
      String? caregiverId,
      String? caregiverName,
      String? serviceStartedAt,
      String? serviceEndedAt}) {
    _assert(b, next);
    final history = List<Map<String, dynamic>>.from(b.history)
      ..add({'status': next, 'at': nowIso()});
    return b.copyWith(
      status: next,
      codes: codes,
      payment: payment,
      tracking: tracking,
      feedback: feedback,
      caregiverId: caregiverId,
      caregiverName: caregiverName,
      serviceStartedAt: serviceStartedAt,
      serviceEndedAt: serviceEndedAt,
      history: history,
    );
  }

  /// req 3 — capture payment.
  Future<Booking> pay(Booking b) async {
    final txn = await payments.charge(b);
    final updated = _advance(b, BookingStatus.paid,
        payment: b.payment.copyWith(status: 'paid', inTxnId: txn.id, paidAt: nowIso()));
    await repo.saveBooking(updated);
    return updated;
  }

  /// req 3 — broadcast to eligible caregivers (per match [mode]). Returns the
  /// notified list.
  Future<(Booking, List<Caregiver>)> broadcast(
      Booking b, List<Caregiver> allCaregivers, double? radiusKm,
      [String mode = MatchLocationMode.gps]) async {
    final targets = Geo.eligibleCaregivers(b, allCaregivers, radiusKm, mode);
    final updated = _advance(b, BookingStatus.broadcast);
    await repo.saveBooking(updated);
    return (updated, targets);
  }

  /// req 4 — caregiver accepts; issue START code shared with both.
  Future<Booking> accept(Booking b, Caregiver cg) async {
    final startCode = Codes.generate(6);
    final updated = _advance(b, BookingStatus.accepted,
        caregiverId: cg.id,
        caregiverName: cg.name,
        codes: b.codes.copyWith(startCode: startCode));
    await repo.saveBooking(updated);
    await repo.saveCaregiver(cg.copyWith(availability: Availability.onService));
    return updated;
  }

  /// req 6 — start travel; live tracking begins.
  Future<Booking> startTravel(Booking b, Caregiver cg) async {
    final d = Geo.distanceKm(cg.location, b.location);
    final updated = _advance(b, BookingStatus.enRoute,
        tracking: BookingTracking(
          lat: cg.location?.lat,
          lng: cg.location?.lng,
          updatedAt: nowIso(),
          etaMinutes: Geo.estimateEtaMinutes(d),
        ));
    await repo.saveBooking(updated);
    return updated;
  }

  /// req 6 — live location ping (also pushed over SignalR for low latency).
  Future<Booking> pushLocation(Booking b, double lat, double lng) async {
    const trackable = [BookingStatus.enRoute, BookingStatus.arrived, BookingStatus.inService];
    if (!trackable.contains(b.status)) return b;
    final eta = Geo.estimateEtaMinutes(
        Geo.distanceKm(HcLocation(lat: lat, lng: lng), b.location));
    final updated = b.copyWith(
        tracking: BookingTracking(lat: lat, lng: lng, updatedAt: nowIso(), etaMinutes: eta));
    await repo.saveBooking(updated);
    await tracking?.sendLocation(b.id, lat, lng, eta);
    return updated;
  }

  /// req 7 — caregiver marks arrival. Optionally folds a fresh location into the
  /// SAME write (avoids a separate en_route write racing over the arrived one).
  Future<Booking> markArrived(Booking b, {double? lat, double? lng}) async {
    final tracking = (lat != null && lng != null)
        ? BookingTracking(lat: lat, lng: lng, updatedAt: nowIso(), etaMinutes: 0)
        : null;
    final updated = _advance(b, BookingStatus.arrived, tracking: tracking);
    await repo.saveBooking(updated);
    return updated;
  }

  /// req 7 — client verifies the start code the caregiver reads out.
  Future<(bool, Booking)> verifyStartCode(Booking b, String provided) async {
    if (!Codes.verify(b.codes.startCode, provided)) return (false, b);
    final updated = _advance(b, BookingStatus.inService,
        codes: b.codes.copyWith(startVerified: true), serviceStartedAt: nowIso());
    await repo.saveBooking(updated);
    return (true, updated);
  }

  /// req 8 — caregiver requests completion; issue COMPLETE code to client.
  Future<Booking> requestCompletion(Booking b) async {
    final completeCode = Codes.generate(6);
    final updated = _advance(b, BookingStatus.completionPending,
        codes: b.codes.copyWith(completeCode: completeCode));
    await repo.saveBooking(updated);
    return updated;
  }

  /// req 9 — client verifies completion code + rating. Officially done.
  Future<(bool, Booking)> verifyCompletion(
      Booking b, String provided, int? stars, String comments, Caregiver? cg) async {
    if (!Codes.verify(b.codes.completeCode, provided)) return (false, b);
    final updated = _advance(b, BookingStatus.completed,
        codes: b.codes.copyWith(completeVerified: true),
        feedback: BookingFeedback(stars: stars, comments: comments, at: nowIso()),
        serviceEndedAt: nowIso());
    await repo.saveBooking(updated);

    if (cg != null) {
      var newRating = cg.rating;
      var newCount = cg.ratingCount;
      if (stars != null) {
        final total = cg.rating * cg.ratingCount + stars;
        newCount = cg.ratingCount + 1;
        newRating = double.parse((total / newCount).toStringAsFixed(1));
      }
      await repo.saveCaregiver(cg.copyWith(
          availability: Availability.available, rating: newRating, ratingCount: newCount));
    }
    return (true, updated);
  }

  /// admin — release the caregiver payout after completion.
  Future<Booking> releasePayout(Booking b) async {
    final txn = await payments.payout(b);
    final updated = b.copyWith(
        payment: b.payment.copyWith(status: 'released', outTxnId: txn.id, releasedAt: nowIso()));
    await repo.saveBooking(updated);
    return updated;
  }

  /// Cancel a booking, recording a payment revision:
  ///   - paid + [transferToRebook]: amount CARRIED FORWARD to a rebook (no cash
  ///     refund) -> payment 'transferred'
  ///   - paid (normal): a refund txn -> payment 'refunded'
  ///   - otherwise: a zero-value 'void' revision
  /// Also frees any assigned caregiver (on_service -> available). Returns the
  /// updated booking and the revision recorded.
  Future<(Booking, PaymentRevision)> cancel(
    Booking b, {
    String reason = '',
    String? reasonCode,
    String by = 'client',
    bool transferToRebook = false,
    String? toBookingId,
  }) async {
    final code = reasonCode ?? (reason.isNotEmpty ? reason : '');
    final wasPaid = b.payment.status == 'paid' || b.payment.status == 'released';
    late PaymentRevision revision;
    BookingPayment payment = b.payment;

    if (wasPaid && transferToRebook) {
      revision = PaymentRevision(
          type: 'transfer', amount: b.price, at: nowIso(), by: by,
          reason: reason, reasonCode: code, toBookingId: toBookingId);
      payment = b.payment.copyWith(
          status: 'transferred', transferredToBookingId: toBookingId, transferredAt: nowIso());
    } else if (wasPaid) {
      final txn = await payments.refund(b);
      revision = PaymentRevision(
          type: 'refund', amount: txn.amount, txnId: txn.id, at: txn.at, by: by,
          reason: reason, reasonCode: code);
      payment = b.payment.copyWith(status: 'refunded', refundTxnId: txn.id, refundedAt: txn.at);
    } else {
      revision = PaymentRevision(
          type: 'void', amount: 0, at: nowIso(), by: by, reason: reason, reasonCode: code);
    }

    final revisions = List<PaymentRevision>.from(b.paymentRevisions)..add(revision);
    final updated = _advance(b, BookingStatus.cancelled, payment: payment)
        .copyWith(
      paymentRevisions: revisions,
      cancelReason: reason,
      cancelReasonCode: code,
      cancelledBy: by,
    );
    await repo.saveBooking(updated);

    // free the assigned caregiver, if any
    if (b.caregiverId != null) {
      final cg = await repo.getCaregiver(b.caregiverId!);
      if (cg != null && cg.availability == Availability.onService) {
        await repo.saveCaregiver(cg.copyWith(availability: Availability.available));
      }
    }
    return (updated, revision);
  }

  /// Clone a (usually just-cancelled) booking into a fresh request, carrying all
  /// request details + clonedFrom. When [rebook] is true and the original was
  /// paid, the clone retains paid status (PAID, ready to broadcast). A past
  /// scheduled time is shifted forward to [minScheduledAt] (or now).
  Booking cloneBooking(Booking original, {bool rebook = false, String? minScheduledAt}) {
    var scheduledAt = original.scheduledAt;
    if (scheduledAt != null) {
      final t = DateTime.tryParse(scheduledAt);
      if (t != null && t.toUtc().isBefore(DateTime.now().toUtc())) {
        scheduledAt = minScheduledAt ?? nowIso();
      }
    }

    final freshId = 'bk_${DateTime.now().millisecondsSinceEpoch}';
    final origPaid = ['paid', 'released', 'refunded', 'transferred'].contains(original.payment.status);
    final doRebook = rebook && origPaid;

    return Booking(
      id: freshId,
      clientId: original.clientId,
      speciality: original.speciality,
      serviceId: original.serviceId,
      commissionPct: original.commissionPct,
      scheduledAt: scheduledAt,
      recipients: original.recipients,
      unitPrice: original.unitPrice,
      priority: original.priority,
      clonedFrom: original.id,
      location: original.location,
      radiusKm: original.radiusKm,
      price: original.price,
      status: doRebook ? BookingStatus.paid : BookingStatus.created,
      payment: doRebook
          ? BookingPayment(
              status: 'paid',
              inTxnId: original.payment.inTxnId,
              paidAt: original.payment.paidAt ?? nowIso(),
              paymentFromBookingId: original.id)
          : const BookingPayment(),
      history: doRebook
          ? [
              {'status': BookingStatus.created, 'at': nowIso()},
              {'status': BookingStatus.paid, 'at': nowIso(), 'by': 'admin-rebook'},
            ]
          : null,
    );
  }
}
