/* auth.js — OTP / secret-code based authentication (spec req: OTP-based auth).
 *
 * Supports two login modes matching the spec ("OTP-based / secret-code based"):
 *   1. Phone + OTP via Firebase Phone Auth (production path). Needs a reCAPTCHA
 *      container and a real Firebase project with Phone sign-in enabled.
 *   2. Secret-code login: the user is provisioned with an access code (e.g. by
 *      the admin) and signs in with phone + that code — useful for caregivers
 *      and clients who are onboarded by the middle-man/admin.
 *
 * The signed-in identity (role + linked record id) is cached in localStorage so
 * each PWA knows who it is on reload. Firestore security rules should enforce
 * that clients can't read other clients, caregivers see only public profiles,
 * and admin sees everything (see README).
 */
import { auth } from './firebase.js';
import {
  RecaptchaVerifier, signInWithPhoneNumber, signInAnonymously
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const SESSION_KEY = 'hc_session';

export const Auth = {
  /** Current cached session: { role, userId, name, phone } or null. */
  session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (_) { return null; }
  },

  setSession(sess) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    return sess;
  },

  signOut() {
    localStorage.removeItem(SESSION_KEY);
    try { auth.signOut(); } catch (_) {}
  },

  /**
   * Start phone-OTP sign-in. `recaptchaContainerId` is the id of a div for the
   * invisible reCAPTCHA. Returns a confirmation object; call .confirm(code).
   */
  async startPhoneOtp(phoneE164, recaptchaContainerId) {
    const verifier = new RecaptchaVerifier(auth, recaptchaContainerId, { size: 'invisible' });
    const confirmation = await signInWithPhoneNumber(auth, phoneE164, verifier);
    return {
      confirm: async (code) => {
        const cred = await confirmation.confirm(code);
        return cred.user;
      }
    };
  },

  /**
   * Secret-code login. Validates the provided code against the user record's
   * accessCode (provisioned by admin). Falls back to anonymous Firebase auth so
   * Firestore reads work under rules keyed on the cached role.
   */
  async signInWithSecretCode(userRecord, providedCode) {
    if (!userRecord || !userRecord.accessCode) throw new Error('No access code on file');
    if (String(userRecord.accessCode) !== String(providedCode).trim()) {
      throw new Error('Invalid access code');
    }
    try { await signInAnonymously(auth); } catch (_) {}
    return this.setSession({
      role: userRecord.role, userId: userRecord.id, name: userRecord.name, phone: userRecord.phone
    });
  }
};
