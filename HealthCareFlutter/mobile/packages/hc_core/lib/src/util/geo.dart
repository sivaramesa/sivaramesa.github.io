import 'dart:math';

import '../models/enums.dart';
import '../models/models.dart';

/// Distance + eligibility helpers (ports the PWA's geo.js, including the fix
/// that the radius filter only applies when both points have coordinates).
class Geo {
  static const _earthRadiusKm = 6371.0;

  static double _toRad(double deg) => deg * pi / 180.0;

  /// Great-circle distance in km between two locations. Returns
  /// [double.infinity] when either lacks coordinates.
  static double distanceKm(HcLocation? a, HcLocation? b) {
    if (a == null || b == null || !a.hasCoords || !b.hasCoords) {
      return double.infinity;
    }
    final dLat = _toRad(b.lat! - a.lat!);
    final dLng = _toRad(b.lng! - a.lng!);
    final lat1 = _toRad(a.lat!);
    final lat2 = _toRad(b.lat!);
    final h = pow(sin(dLat / 2), 2) +
        pow(sin(dLng / 2), 2) * cos(lat1) * cos(lat2);
    return 2 * _earthRadiusKm * asin(sqrt(h));
  }

  /// Straight-line distance in metres (double.infinity when unknown).
  static double distanceMeters(HcLocation? a, HcLocation? b) {
    final km = distanceKm(a, b);
    return km.isFinite ? km * 1000 : double.infinity;
  }

  /// Rough ETA in minutes assuming an average urban speed (km/h).
  static int? estimateEtaMinutes(double distKm, [double avgSpeedKmh = 25]) {
    if (distKm.isInfinite || distKm.isNaN) return null;
    return max(1, (distKm / avgSpeedKmh * 60).round());
  }

  /// Location-verification policy check, shared by the client (start gate) and
  /// caregiver (complete gate). When verification is OFF -> always ok. When ON,
  /// ok only if both locations have coords AND within radius; missing coords is
  /// NOT ok (fail-closed).
  static ProximityVerdict checkProximity(
    HcLocation? caregiverLoc,
    HcLocation? serviceLoc,
    AppSettings settings,
  ) {
    if (!settings.locationVerification) {
      return const ProximityVerdict(ok: true, distanceMeters: null, reason: 'verification off');
    }
    final cHas = caregiverLoc != null && caregiverLoc.hasCoords;
    final sHas = serviceLoc != null && serviceLoc.hasCoords;
    if (!cHas || !sHas) {
      return const ProximityVerdict(ok: false, distanceMeters: null, reason: 'location unavailable');
    }
    final d = distanceMeters(caregiverLoc, serviceLoc);
    final within = d <= settings.verifyRadiusMeters;
    return ProximityVerdict(
      ok: within,
      distanceMeters: d.round(),
      reason: within ? 'in range' : 'out of range',
    );
  }

  /// The caregiver location point(s) to compare against, per the admin match
  /// mode: 'gps' -> live location; 'registered' -> operating location;
  /// 'both' -> both points (eligible if EITHER is in range).
  static List<HcLocation> caregiverMatchPoints(
    Caregiver cg, [
    String mode = MatchLocationMode.gps,
  ]) {
    final pts = <HcLocation>[];
    if (mode == MatchLocationMode.registered) {
      if (cg.operatingLocation != null && cg.operatingLocation!.hasCoords) {
        pts.add(cg.operatingLocation!);
      }
    } else if (mode == MatchLocationMode.both) {
      if (cg.location != null && cg.location!.hasCoords) pts.add(cg.location!);
      if (cg.operatingLocation != null && cg.operatingLocation!.hasCoords) {
        pts.add(cg.operatingLocation!);
      }
    } else {
      if (cg.location != null && cg.location!.hasCoords) pts.add(cg.location!);
    }
    return pts;
  }

  /// Smallest distance (km) from a caregiver to the booking, per match mode.
  static double caregiverDistanceKm(
    Caregiver cg,
    HcLocation bookingLocation, [
    String mode = MatchLocationMode.gps,
  ]) {
    final pts = caregiverMatchPoints(cg, mode);
    if (pts.isEmpty) return double.infinity;
    return pts
        .map((p) => distanceKm(p, bookingLocation))
        .reduce((a, b) => a < b ? a : b);
  }

  /// Filter caregivers eligible for a booking: available + speciality match +
  /// (when both have coords) within radius, per the match mode. Nearest-first.
  static List<Caregiver> eligibleCaregivers(
    Booking booking,
    List<Caregiver> caregivers,
    double? radiusKm, [
    String mode = MatchLocationMode.gps,
  ]) {
    final limit = radiusKm ?? booking.radiusKm ?? double.infinity;
    final canMeasure = booking.location.hasCoords;
    final matched = caregivers
        .where((cg) => cg.availability == Availability.available)
        .where((cg) => cg.specialities.contains(booking.speciality))
        .where((cg) {
      final hasPoint = caregiverMatchPoints(cg, mode).isNotEmpty;
      if (!canMeasure || !hasPoint) {
        return true; // distance unknown -> stay eligible
      }
      return caregiverDistanceKm(cg, booking.location, mode) <= limit;
    }).toList();

    matched.sort((a, b) => caregiverDistanceKm(a, booking.location, mode)
        .compareTo(caregiverDistanceKm(b, booking.location, mode)));
    return matched;
  }
}

/// Result of a location-verification proximity check.
class ProximityVerdict {
  final bool ok;
  final int? distanceMeters;
  final String reason;
  const ProximityVerdict({required this.ok, required this.distanceMeters, required this.reason});
}
