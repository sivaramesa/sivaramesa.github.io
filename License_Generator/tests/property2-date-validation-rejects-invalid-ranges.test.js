/**
 * Property 2: Date Validation Rejects Invalid Ranges
 * Feature: date-restricted-license-keys
 * 
 * **Validates: Requirements 1.6**
 * 
 * For any pair of dates where the "Valid To" date is strictly earlier than the "Valid From" date,
 * the validation function SHALL return an invalid result and prevent key generation.
 * Also validates that missing/empty dates produce invalid results, and that valid ranges pass.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateDateRestrictedInputs, isValidISODate } from './date-restricted-license.js';

// --- Arbitraries ---

/** Generate a valid ISO 8601 date string (YYYY-MM-DD) */
const arbISODate = fc.date({
  min: new Date('2000-01-01'),
  max: new Date('2099-12-31')
}).map(d => d.toISOString().slice(0, 10));

/**
 * Generate a pair (fromDate, toDate) where toDate is strictly BEFORE fromDate (invalid range).
 * Both are valid YYYY-MM-DD strings with at least one day apart.
 */
const arbInvalidDateRange = fc.tuple(
  fc.date({ min: new Date('2000-01-02'), max: new Date('2099-12-31') }),
  fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-30') })
).chain(([d1, d2]) => {
  const s1 = d1.toISOString().slice(0, 10);
  const s2 = d2.toISOString().slice(0, 10);
  // Ensure fromDate > toDate (invalid range)
  if (s1 > s2) {
    return fc.constant([s1, s2]);
  }
  // Swap so that fromDate is strictly after toDate
  if (s2 > s1) {
    return fc.constant([s2, s1]);
  }
  // Same date — shift fromDate forward by one day
  const shifted = new Date(d1);
  shifted.setDate(shifted.getDate() + 1);
  return fc.constant([shifted.toISOString().slice(0, 10), s2]);
});

/**
 * Generate a valid date range where toDate > fromDate.
 */
const arbValidDateRange = fc.tuple(
  fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-30') }),
  fc.date({ min: new Date('2000-01-02'), max: new Date('2099-12-31') })
).chain(([d1, d2]) => {
  const s1 = d1.toISOString().slice(0, 10);
  const s2 = d2.toISOString().slice(0, 10);
  // Ensure fromDate < toDate (valid range)
  if (s1 < s2) {
    return fc.constant([s1, s2]);
  }
  if (s2 < s1) {
    return fc.constant([s2, s1]);
  }
  // Same date — shift toDate forward by one day
  const shifted = new Date(d2);
  shifted.setDate(shifted.getDate() + 1);
  return fc.constant([s1, shifted.toISOString().slice(0, 10)]);
});

// --- Property Tests ---

describe('Feature: date-restricted-license-keys, Property 2: Date Validation Rejects Invalid Ranges', () => {

  it('rejects when toDate is strictly before fromDate', () => {
    /**
     * **Validates: Requirements 1.6**
     */
    fc.assert(
      fc.property(
        arbInvalidDateRange,
        ([fromDate, toDate]) => {
          const result = validateDateRestrictedInputs(fromDate, toDate);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
          expect(typeof result.error).toBe('string');
          expect(result.error.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('rejects when fromDate is empty or missing', () => {
    /**
     * **Validates: Requirements 1.6**
     */
    fc.assert(
      fc.property(
        arbISODate,
        fc.constantFrom('', null, undefined),
        (toDate, emptyFrom) => {
          const result = validateDateRestrictedInputs(emptyFrom, toDate);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error).toContain('Valid From');
        }
      ),
      { numRuns: 5 }
    );
  });

  it('rejects when toDate is empty or missing', () => {
    /**
     * **Validates: Requirements 1.6**
     */
    fc.assert(
      fc.property(
        arbISODate,
        fc.constantFrom('', null, undefined),
        (fromDate, emptyTo) => {
          const result = validateDateRestrictedInputs(fromDate, emptyTo);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error).toContain('Valid To');
        }
      ),
      { numRuns: 5 }
    );
  });

  it('accepts when toDate is strictly after fromDate and both are valid', () => {
    /**
     * **Validates: Requirements 1.6**
     */
    fc.assert(
      fc.property(
        arbValidDateRange,
        ([fromDate, toDate]) => {
          const result = validateDateRestrictedInputs(fromDate, toDate);
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
        }
      ),
      { numRuns: 5 }
    );
  });
});
