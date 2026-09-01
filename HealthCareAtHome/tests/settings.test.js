/* Tests for shared/settings.js defaults + priorityPrice, with the Firestore
 * SDK (loaded from a CDN URL) mocked so the module imports offline. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js', () => ({
  doc: () => ({}), getDoc: async () => ({ exists: () => false }),
  setDoc: async () => {}, onSnapshot: () => () => {}
}));
vi.mock('../shared/firebase.js', () => ({ db: {}, COLLECTION: {} }));

import { DEFAULT_SETTINGS, priorityPrice } from '../shared/settings.js';

describe('DEFAULT_SETTINGS — today\'s config keys', () => {
  it('has matchLocationMode default gps', () => {
    expect(DEFAULT_SETTINGS.matchLocationMode).toBe('gps');
  });
  it('has the three default cancel reason codes', () => {
    expect(DEFAULT_SETTINGS.cancelReasons).toEqual([
      'No Show of Caregiver', 'Client requested', 'Priority changes'
    ]);
  });
  it('has startAlertMinutes default 30', () => {
    expect(DEFAULT_SETTINGS.startAlertMinutes).toBe(30);
  });
});

describe('priorityPrice', () => {
  it('multiplier: base 400 x1.5 -> 600', () => {
    expect(priorityPrice(400, 1, { priorityMode: 'multiplier', priorityValue: 1.5 })).toBe(600);
  });
  it('percent: base 400 +50% -> 600', () => {
    expect(priorityPrice(400, 1, { priorityMode: 'percent', priorityValue: 50 })).toBe(600);
  });
  it('flat: base 400 + 100/recipient x2 -> 600', () => {
    expect(priorityPrice(400, 2, { priorityMode: 'flat', priorityValue: 100 })).toBe(600);
  });
});
