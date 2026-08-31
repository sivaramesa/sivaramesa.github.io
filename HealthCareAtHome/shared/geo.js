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
export function eligibleCaregivers(booking, caregivers, radiusKm) {
  const limit = radiusKm || booking.radiusKm || Infinity;
  const canMeasure = hasCoords(booking.location);
  return (caregivers || [])
    .filter((cg) => cg.availability === 'available')
    .filter((cg) => Array.isArray(cg.specialities) && cg.specialities.includes(booking.speciality))
    .map((cg) => ({ ...cg, distanceKm: distanceKm(cg.location, booking.location) }))
    .filter((cg) => {
      // apply the radius test only when we actually know both positions
      if (!canMeasure || !hasCoords(cg.location)) return true;
      return cg.distanceKm <= limit;
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
