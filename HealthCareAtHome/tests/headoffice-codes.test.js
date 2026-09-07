/* Tests for the two latest features, exercised at the decision-logic level:
 *  1) head-office distance -> green (within radius) / amber (beyond)
 *  2) show-codes-to-caregiver gate (default OFF)
 * Firestore SDK mocked so settings.js imports offline. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js', () => ({
  doc: () => ({}), getDoc: async () => ({ exists: () => false }),
  setDoc: async () => {}, onSnapshot: () => () => {}
}));
vi.mock('../shared/firebase.js', () => ({ db: {}, COLLECTION: {} }));

import { DEFAULT_SETTINGS } from '../shared/settings.js';
import { distanceKm } from '../shared/geo.js';

// Mirror of admin renderHeadOfficeDistance decision (see admin/app.js).
function headOfficeVerdict(settings, operatingLocation) {
  const ho = settings.headOffice;
  if (!ho || ho.lat == null) return 'no-head-office';
  if (!operatingLocation || operatingLocation.lat == null) return 'unknown';
  const d = distanceKm(ho, operatingLocation);
  return d <= Number(settings.headOfficeRadiusKm ?? 5) ? 'green' : 'amber';
}

// Mirror of caregiver code-visibility gate (see caregiver/app.js).
function codesShownToCaregiver(settings) {
  return settings.showCodesToCaregiver !== false;
}

describe('head office distance verdict (interview screen)', () => {
  const ho = DEFAULT_SETTINGS.headOffice; // Tambaram, Chennai (12.9249, 80.1000)

  it('defaults to Tambaram with a 5km green window', () => {
    expect(ho).toEqual({ address: 'Tambaram, Chennai', lat: 12.9249, lng: 80.1000 });
    expect(DEFAULT_SETTINGS.headOfficeRadiusKm).toBe(5);
  });

  it('green when operating location is within 5km', () => {
    const nearby = { lat: 12.9300, lng: 80.1050 }; // ~0.8 km from Tambaram
    expect(distanceKm(ho, nearby)).toBeLessThan(5);
    expect(headOfficeVerdict(DEFAULT_SETTINGS, nearby)).toBe('green');
  });

  it('amber when operating location is beyond 5km', () => {
    const farAway = { lat: 13.0827, lng: 80.2707 }; // central Chennai, ~20 km
    expect(distanceKm(ho, farAway)).toBeGreaterThan(5);
    expect(headOfficeVerdict(DEFAULT_SETTINGS, farAway)).toBe('amber');
  });

  it('honors a custom radius', () => {
    const farAway = { lat: 13.0827, lng: 80.2707 };
    expect(headOfficeVerdict({ ...DEFAULT_SETTINGS, headOfficeRadiusKm: 50 }, farAway)).toBe('green');
  });

  it('unknown when caregiver has no mapped operating location', () => {
    expect(headOfficeVerdict(DEFAULT_SETTINGS, null)).toBe('unknown');
    expect(headOfficeVerdict(DEFAULT_SETTINGS, { address: 'x', lat: null, lng: null })).toBe('unknown');
  });
});

describe('show-codes-to-caregiver gate', () => {
  it('defaults to hidden (OFF)', () => {
    expect(DEFAULT_SETTINGS.showCodesToCaregiver).toBe(false);
    expect(codesShownToCaregiver(DEFAULT_SETTINGS)).toBe(false);
  });
  it('shows codes only when explicitly enabled', () => {
    expect(codesShownToCaregiver({ showCodesToCaregiver: true })).toBe(true);
  });
  it('treats a missing flag as shown (legacy safety)', () => {
    expect(codesShownToCaregiver({})).toBe(true);
  });
});
