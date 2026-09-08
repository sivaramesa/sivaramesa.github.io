/**
 * Property 3: Perpetual Key Backward Compatibility
 * Feature: date-restricted-license-keys
 * 
 * **Validates: Requirements 2.1**
 * 
 * For any valid user name, generating a perpetual license key SHALL produce
 * a base64-encoded JSON object containing exactly the fields:
 *   - n (matching the input name)
 *   - h (matching the HMAC-SHA256 hex digest computed over the name)
 * with no `f` or `t` fields present.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateLicense, hmacHex } from './date-restricted-license.js';

// --- Arbitraries ---

/** Generate a non-empty user name (printable ASCII) */
const arbUserName = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ._-]{0,49}$/);

/** Generate a valid secret codes array (array of char codes 32-126, printable ASCII) */
const arbSecretCodes = fc.array(
  fc.integer({ min: 32, max: 126 }),
  { minLength: 1, maxLength: 30 }
);

// --- Property Tests ---

describe('Feature: date-restricted-license-keys, Property 3: Perpetual Key Backward Compatibility', () => {

  it('perpetual key contains only n and h fields, no f or t fields', () => {
    /**
     * **Validates: Requirements 2.1**
     * 
     * The existing generateLicense function still produces keys in the original
     * format { n: name, h: hash }. Perpetual keys do NOT contain f or t fields.
     */
    fc.assert(
      fc.property(
        arbUserName,
        arbSecretCodes,
        (name, secretCodes) => {
          const key = generateLicense(name, secretCodes);

          // 1. Key is valid base64
          expect(() => atob(key)).not.toThrow();
          const decoded = atob(key);

          // 2. Decoded string is valid JSON
          let payload;
          expect(() => { payload = JSON.parse(decoded); }).not.toThrow();

          // 3. Payload contains exactly fields n and h (no f, no t)
          const keys = Object.keys(payload).sort();
          expect(keys).toEqual(['h', 'n']);

          // 4. No f or t fields present
          expect(payload).not.toHaveProperty('f');
          expect(payload).not.toHaveProperty('t');

          // 5. n matches input name
          expect(payload.n).toBe(name);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('perpetual key HMAC is computed over the user name only', () => {
    /**
     * **Validates: Requirements 2.1**
     * 
     * The HMAC for perpetual keys is computed over the user name only,
     * not over name + dates or any other combination.
     */
    fc.assert(
      fc.property(
        arbUserName,
        arbSecretCodes,
        (name, secretCodes) => {
          const key = generateLicense(name, secretCodes);
          const payload = JSON.parse(atob(key));

          // h matches HMAC-SHA256 computed over name only
          const expectedHmac = hmacHex(name, secretCodes);
          expect(payload.h).toBe(expectedHmac);

          // h is a valid 64-char hex string (SHA-256 = 32 bytes = 64 hex chars)
          expect(payload.h).toMatch(/^[0-9a-f]{64}$/);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('perpetual key format is unchanged (deterministic, same inputs produce same output)', () => {
    /**
     * **Validates: Requirements 2.1**
     * 
     * Previously generated standard keys remain valid — generating the same
     * key twice with identical inputs produces identical output.
     */
    fc.assert(
      fc.property(
        arbUserName,
        arbSecretCodes,
        (name, secretCodes) => {
          const key1 = generateLicense(name, secretCodes);
          const key2 = generateLicense(name, secretCodes);

          // Same inputs always produce the same key
          expect(key1).toBe(key2);
        }
      ),
      { numRuns: 3 }
    );
  });
});
