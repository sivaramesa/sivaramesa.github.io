/**
 * Property 1: Date-Restricted Key Payload Integrity
 * Feature: date-restricted-license-keys
 * 
 * **Validates: Requirements 1.4, 1.5, 1.8**
 * 
 * For any valid user name, valid "Valid From" date, and valid "Valid To" date (where from <= to),
 * generating a date-restricted license key and then base64-decoding the result SHALL produce
 * a JSON object containing exactly the fields:
 *   - n (matching the input name)
 *   - f (matching the fromDate in YYYY-MM-DD format)
 *   - t (matching the toDate in YYYY-MM-DD format)
 *   - h (matching the HMAC-SHA256 hex digest computed over the concatenation of name + fromDate + toDate)
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateDateRestrictedLicense, hmacHex } from './date-restricted-license.js';

// --- Arbitraries ---

/** Generate a non-empty user name (printable ASCII, avoids empty) */
const arbUserName = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ._-]{0,49}$/);

/** Generate a valid secret codes array (array of char codes 32-126, printable ASCII) */
const arbSecretCodes = fc.array(
  fc.integer({ min: 32, max: 126 }),
  { minLength: 1, maxLength: 30 }
);

/**
 * Generate a valid pair of (fromDate, toDate) where toDate >= fromDate.
 * Both are valid YYYY-MM-DD strings.
 */
const arbDateRange = fc.tuple(
  fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') }),
  fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') })
).map(([d1, d2]) => {
  const s1 = d1.toISOString().slice(0, 10);
  const s2 = d2.toISOString().slice(0, 10);
  // Ensure fromDate <= toDate
  return s1 <= s2 ? [s1, s2] : [s2, s1];
});

// --- Property Tests ---

describe('Feature: date-restricted-license-keys, Property 1: Date-Restricted Key Payload Integrity', () => {

  it('generated key is valid base64 that decodes to valid JSON with correct fields and HMAC', () => {
    /**
     * **Validates: Requirements 1.4, 1.5, 1.8**
     */
    fc.assert(
      fc.property(
        arbUserName,
        arbSecretCodes,
        arbDateRange,
        (name, secretCodes, [fromDate, toDate]) => {
          const key = generateDateRestrictedLicense(name, secretCodes, fromDate, toDate);

          // 1. Key is valid base64 that decodes to valid JSON
          const decoded = atob(key);
          const payload = JSON.parse(decoded);

          // 2. Payload contains exactly fields n, f, t, h
          const keys = Object.keys(payload).sort();
          expect(keys).toEqual(['f', 'h', 'n', 't']);

          // 3. n matches input name
          expect(payload.n).toBe(name);

          // 4. f matches fromDate in YYYY-MM-DD format
          expect(payload.f).toBe(fromDate);
          expect(payload.f).toMatch(/^\d{4}-\d{2}-\d{2}$/);

          // 5. t matches toDate in YYYY-MM-DD format
          expect(payload.t).toBe(toDate);
          expect(payload.t).toMatch(/^\d{4}-\d{2}-\d{2}$/);

          // 6. h is a valid hex string of 64 characters (SHA-256 = 32 bytes = 64 hex chars)
          expect(payload.h).toMatch(/^[0-9a-f]{64}$/);

          // 7. h matches the HMAC-SHA256 computed over name + fromDate + toDate
          const expectedHmac = hmacHex(name + fromDate + toDate, secretCodes);
          expect(payload.h).toBe(expectedHmac);
        }
      ),
      { numRuns: 5 }
    );
  });
});
