/* Tests for shared/geo.js — the matchLocationMode matching logic. Dependency-free. */
import { describe, it, expect } from 'vitest';
import {
  distanceKm, caregiverMatchPoints, caregiverDistanceKm, eligibleCaregivers
} from '../shared/geo.js';

const A = { lat: 13.0, lng: 80.0 };       // booking location
const near = { lat: 13.009, lng: 80.0 };  // ~1 km
const far = { lat: 13.2, lng: 80.2 };     // ~30 km

describe('distanceKm', () => {
  it('is ~1 km for the near point', () => {
    const d = distanceKm(A, near);
    expect(d).toBeGreaterThan(0.9);
    expect(d).toBeLessThan(1.1);
  });
  it('is Infinity when a point lacks coords', () => {
    expect(distanceKm(A, null)).toBe(Infinity);
  });
});

describe('caregiverMatchPoints', () => {
  const cg = { location: near, operatingLocation: far };
  it('gps -> live location only', () => expect(caregiverMatchPoints(cg, 'gps')).toEqual([near]));
  it('registered -> operating location only', () => expect(caregiverMatchPoints(cg, 'registered')).toEqual([far]));
  it('both -> both points', () => expect(caregiverMatchPoints(cg, 'both')).toHaveLength(2));
});

describe('caregiverDistanceKm', () => {
  it('both mode returns the SMALLER distance (OR semantics)', () => {
    const cg = { location: far, operatingLocation: near };
    expect(caregiverDistanceKm(cg, { location: A }, 'both')).toBeLessThan(1.1);
  });
  it('registered mode ignores a nearby GPS', () => {
    const cg = { location: near, operatingLocation: far };
    expect(caregiverDistanceKm(cg, { location: A }, 'registered')).toBeGreaterThan(20);
  });
  it('Infinity when no usable point for the mode', () => {
    expect(caregiverDistanceKm({ location: null, operatingLocation: null }, { location: A }, 'gps')).toBe(Infinity);
  });
});

describe('eligibleCaregivers with mode', () => {
  const booking = { speciality: 'nursing', location: A, radiusKm: 5 };
  const nearGps = { id: 'g', availability: 'available', specialities: ['nursing'], location: near, operatingLocation: far };
  const farGpsNearReg = { id: 'r', availability: 'available', specialities: ['nursing'], location: far, operatingLocation: near };
  const farBoth = { id: 'x', availability: 'available', specialities: ['nursing'], location: far, operatingLocation: far };
  const wrongSpec = { id: 'w', availability: 'available', specialities: ['physiotherapy'], location: near };
  const offline = { id: 'o', availability: 'unavailable', specialities: ['nursing'], location: near };

  it('gps: near eligible, far excluded', () => {
    const ids = eligibleCaregivers(booking, [nearGps, farBoth], 5, 'gps').map((c) => c.id);
    expect(ids).toContain('g');
    expect(ids).not.toContain('x');
  });
  it('registered: near operating location becomes eligible', () => {
    expect(eligibleCaregivers(booking, [farGpsNearReg], 5, 'registered')).toHaveLength(1);
  });
  it('both: eligible if EITHER point in range', () => {
    expect(eligibleCaregivers(booking, [farGpsNearReg], 5, 'both')).toHaveLength(1);
  });
  it('excludes speciality mismatch and unavailable', () => {
    expect(eligibleCaregivers(booking, [wrongSpec, offline], 5, 'gps')).toHaveLength(0);
  });
});
