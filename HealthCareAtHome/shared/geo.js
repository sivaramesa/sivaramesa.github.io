/* geo.js — distance + eligibility helpers.
 *
 * Uses the haversine formula for straight-line (crow-flies) distance, which is
 * enough to decide which caregivers to alert. Precise road distance/ETA comes
 * from the Google Routes API in maps.js when a booking is actually accepted.
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in km between two {lat,lng} points. */
export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Straight-line distance in metres between two {lat,lng} points (Infinity if unknown). */
export function distanceMeters(a, b) {
  const km = distanceKm(a, b);
  return isFinite(km) ? km * 1000 : Infinity;
}

/**
 * Location-verification policy check, shared by the client (start gate) and
 * caregiver (complete gate).
 *
 * @param {{lat,lng}} caregiverLoc  the caregiver's current/last-known location
 * @param {{lat,lng}} serviceLoc    the booking's service location
 * @param {{locationVerification:boolean, verifyRadiusMeters:number}} settings
 * @returns {{ ok:boolean, distanceMeters:number|null, reason:string }}
 *   - When verification is OFF: always ok (no check).
 *   - When ON: ok only if both locations have coords AND within the radius.
 *     Missing coordinates => not ok (fail-closed).
 */
export function checkProximity(caregiverLoc, serviceLoc, settings) {
  if (!settings || !settings.locationVerification) {
    return { ok: true, distanceMeters: null, reason: 'verification off' };
  }
  const radius = settings.verifyRadiusMeters || 50;
  const cHas = caregiverLoc && caregiverLoc.lat != null && caregiverLoc.lng != null;
  const sHas = serviceLoc && serviceLoc.lat != null && serviceLoc.lng != null;
  if (!cHas || !sHas) {
    return { ok: false, distanceMeters: null, reason: 'location unavailable' };
  }
  const d = distanceMeters(caregiverLoc, serviceLoc);
  return {
    ok: d <= radius,
    distanceMeters: Math.round(d),
    reason: d <= radius ? 'in range' : 'out of range'
  };
}

/** Rough ETA in minutes assuming an average urban speed (km/h). */
export function estimateEtaMinutes(distKm, avgSpeedKmh = 25) {
  if (!isFinite(distKm)) return null;
  return Math.max(1, Math.round((distKm / avgSpeedKmh) * 60));
}

/** True when a point has usable coordinates. */
function hasCoords(p) {
  return !!p && p.lat != null && p.lng != null;
}

/**
 * Filter caregivers eligible for a booking:
 *   - available
 *   - speciality matches the requested one
 *   - within `radiusKm` of the booking location — but ONLY when both the
 *     caregiver and the booking have real coordinates. If either location is
 *     missing coordinates (e.g. address not geocoded because no Maps key, or
 *     caregiver hasn't shared GPS), distance is unknown and we do NOT exclude
 *     on distance — the caregiver stays eligible so the request is still seen.
 * Returns caregivers annotated with `distanceKm` (Infinity when unknown),
 * nearest first (unknown-distance ones sorted last).
 */
/**
 * The caregiver location point(s) to compare against, per the admin match mode:
 *   'gps'        -> live shared location (cg.location)
 *   'registered' -> profile operating location (cg.operatingLocation)
 *   'both'       -> both points (eligible if EITHER is in range)
 */
export function caregiverMatchPoints(cg, mode = 'gps') {
  const pts = [];
  if (mode === 'registered') {
    if (hasCoords(cg.operatingLocation)) pts.push(cg.operatingLocation);
  } else if (mode === 'both') {
    if (hasCoords(cg.location)) pts.push(cg.location);
    if (hasCoords(cg.operatingLocation)) pts.push(cg.operatingLocation);
  } else { // 'gps'
    if (hasCoords(cg.location)) pts.push(cg.location);
  }
  return pts;
}

/** Smallest distance (km) from a caregiver to the booking, per match mode. */
export function caregiverDistanceKm(cg, booking, mode = 'gps') {
  const pts = caregiverMatchPoints(cg, mode);
  if (pts.length === 0) return Infinity;
  return Math.min(...pts.map((p) => distanceKm(p, booking.location)));
}

export function eligibleCaregivers(booking, caregivers, radiusKm, mode = 'gps') {
  const limit = radiusKm || booking.radiusKm || Infinity;
  const canMeasure = hasCoords(booking.location);
  return (caregivers || [])
    .filter((cg) => cg.availability === 'available')
    .filter((cg) => Array.isArray(cg.specialities) && cg.specialities.includes(booking.speciality))
    .map((cg) => ({ ...cg, distanceKm: caregiverDistanceKm(cg, booking, mode) }))
    .filter((cg) => {
      // apply the radius test only when we know the booking + at least one
      // caregiver point (per mode); otherwise keep eligible (distance unknown).
      const hasCgPoint = caregiverMatchPoints(cg, mode).length > 0;
      if (!canMeasure || !hasCgPoint) return true;
      return cg.distanceKm <= limit;
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
