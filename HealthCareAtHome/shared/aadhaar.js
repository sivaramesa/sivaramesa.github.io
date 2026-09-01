/* aadhaar.js — Aadhaar OTP verification boundary.
 *
 * IMPORTANT: Real Aadhaar OTP verification is a restricted UIDAI service. It
 * CANNOT be performed from a browser/PWA directly — it requires a licensed
 * AUA/KUA or an authorised KYC provider, with SECRET credentials held on a
 * server. So this module is a clean interface with a MOCK implementation that
 * simulates the OTP round-trip for development/demo.
 *
 * To go live: implement `sendOtp`/`verifyOtp` to call YOUR backend endpoint
 * (which in turn talks to your KYC provider). Keep the same return shapes and
 * the rest of the app keeps working unchanged.
 */

const AADHAAR_RE = /^\d{12}$/;

/** Basic client-side format check (12 digits). Not a validity guarantee. */
export function isValidAadhaarFormat(number) {
  return AADHAAR_RE.test(String(number || '').replace(/\s/g, ''));
}

// In-memory pending OTPs for the mock (txnId -> code). Not persisted.
const _pending = new Map();

export const Aadhaar = {
  provider: 'mock', // swap to your provider id when wiring a real backend

  /**
   * Request an OTP for an Aadhaar number.
   * @returns {Promise<{ ok:boolean, txnId?:string, error?:string, devHint?:string }>}
   */
  async sendOtp(number) {
    const n = String(number || '').replace(/\s/g, '');
    if (!isValidAadhaarFormat(n)) {
      return { ok: false, error: 'Enter a valid 12-digit Aadhaar number.' };
    }
    if (this.provider === 'mock') {
      await new Promise((r) => setTimeout(r, 500)); // simulate network
      const txnId = 'aad_' + Math.random().toString(36).slice(2, 10);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      _pending.set(txnId, code);
      // In production the OTP goes to the citizen's registered mobile. For the
      // mock we surface it as a dev hint so the flow is testable end-to-end.
      return { ok: true, txnId, devHint: code };
    }
    // --- real provider hook -------------------------------------------------
    // const res = await fetch('/api/aadhaar/send-otp', { method:'POST', body: JSON.stringify({ number: n }) });
    // return res.json(); // { ok, txnId }
    return { ok: false, error: 'Aadhaar provider not configured.' };
  },

  /**
   * Verify the OTP for a previously issued txnId.
   * @returns {Promise<{ ok:boolean, error?:string }>}
   */
  async verifyOtp(txnId, otp) {
    if (this.provider === 'mock') {
      await new Promise((r) => setTimeout(r, 400));
      const expected = _pending.get(txnId);
      if (!expected) return { ok: false, error: 'OTP expired — request a new one.' };
      if (String(otp).trim() !== expected) return { ok: false, error: 'Incorrect OTP.' };
      _pending.delete(txnId);
      return { ok: true };
    }
    // const res = await fetch('/api/aadhaar/verify-otp', { method:'POST', body: JSON.stringify({ txnId, otp }) });
    // return res.json(); // { ok }
    return { ok: false, error: 'Aadhaar provider not configured.' };
  }
};
