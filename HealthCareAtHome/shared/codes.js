/* codes.js — secret-code / OTP generation and verification.
 *
 * Two codes govern a booking's lifecycle (requirements 4, 7, 8, 9):
 *   - startCode    : issued when a caregiver accepts. Shared with BOTH client
 *                    and caregiver. On arrival the client asks the caregiver
 *                    for it and verifies to begin the service.
 *   - completeCode : issued when the caregiver requests completion. Shared with
 *                    the client, who enters it (with rating + comments) to
 *                    officially close the booking.
 *
 * Codes are numeric OTP-style strings. Verification is constant-time-ish and
 * whitespace/format tolerant.
 */

/** Generate a numeric code of `len` digits (default 6). */
export function generateCode(len = 6) {
  const max = 10 ** len;
  const n = (crypto.getRandomValues(new Uint32Array(1))[0] % max);
  return String(n).padStart(len, '0');
}

/** Normalise user input before comparing (strip spaces/dashes). */
export function normalize(input) {
  return String(input == null ? '' : input).replace(/[\s-]/g, '');
}

/** Length-safe equality check. */
export function verifyCode(expected, provided) {
  const a = normalize(expected);
  const b = normalize(provided);
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
