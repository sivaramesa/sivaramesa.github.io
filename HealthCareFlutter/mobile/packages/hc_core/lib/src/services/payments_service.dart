import '../config.dart';
import '../models/models.dart';

class PaymentTxn {
  final String id;
  final double amount;
  final String status;
  final String at;
  PaymentTxn(this.id, this.amount, this.status, this.at);
}

class CommissionSplit {
  final double commission;
  final double caregiverAmount;
  const CommissionSplit(this.commission, this.caregiverAmount);
}

/// Payment gateway boundary (ports the PWA's payments.js). In production, the
/// charge/payout must be finalised server-side; this class isolates that so the
/// rest of the app is gateway-agnostic. The mock implementation lets the full
/// flow run without a live gateway.
class PaymentsService {
  final String provider; // 'mock' | 'razorpay' | 'stripe'
  PaymentsService({this.provider = 'mock'});

  /// Split a price into platform commission + caregiver amount. [fraction]
  /// defaults to the global commission; pass a per-service fraction to override.
  CommissionSplit commissionSplit(double price, [double? fraction]) {
    final f = fraction ?? HcConfig.platformCommission;
    final commission = double.parse((price * f).toStringAsFixed(2));
    final caregiverAmount = double.parse((price - commission).toStringAsFixed(2));
    return CommissionSplit(commission, caregiverAmount);
  }

  double _bookingFraction(Booking b) =>
      b.commissionPct != null ? b.commissionPct! / 100.0 : HcConfig.platformCommission;

  Future<PaymentTxn> charge(Booking b) async {
    await Future.delayed(const Duration(milliseconds: 400));
    return PaymentTxn(
      'pay_in_${DateTime.now().millisecondsSinceEpoch}',
      b.price,
      'captured',
      nowIso(),
    );
  }

  Future<PaymentTxn> payout(Booking b) async {
    await Future.delayed(const Duration(milliseconds: 400));
    final split = commissionSplit(b.price, _bookingFraction(b));
    return PaymentTxn(
      'pay_out_${DateTime.now().millisecondsSinceEpoch}',
      split.caregiverAmount,
      'transferred',
      nowIso(),
    );
  }

  /// Reverse a captured charge on cancellation (a payment revision). Defaults to
  /// a full refund of the booking price; pass [amount] for a partial refund.
  Future<PaymentTxn> refund(Booking b, [double? amount]) async {
    await Future.delayed(const Duration(milliseconds: 400));
    return PaymentTxn(
      'pay_rev_${DateTime.now().millisecondsSinceEpoch}',
      amount ?? b.price,
      'refunded',
      nowIso(),
    );
  }
}
