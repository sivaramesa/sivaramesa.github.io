import 'dart:math';

/// Secret-code / OTP generation and verification (ports the PWA's codes.js).
///
/// Two codes govern a booking's lifecycle:
///   - startCode    : issued on caregiver accept, shared with both sides.
///   - completeCode : issued when the caregiver requests completion.
class Codes {
  static final _rand = Random.secure();

  /// Generate a numeric code of [len] digits (default 6).
  static String generate([int len = 6]) {
    final max = pow(10, len).toInt();
    final n = _rand.nextInt(max);
    return n.toString().padLeft(len, '0');
  }

  /// Normalise input before comparing (strip spaces/dashes).
  static String normalize(String? input) =>
      (input ?? '').replaceAll(RegExp(r'[\s-]'), '');

  /// Length-safe equality check.
  static bool verify(String? expected, String? provided) {
    final a = normalize(expected);
    final b = normalize(provided);
    if (a.isEmpty || a.length != b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      diff |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
    }
    return diff == 0;
  }
}
