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

const SESSION_PREFIX = 'hc_session';

export const Auth = {
  // The role this app instance is scoped to. Each PWA calls Auth.use(role) once
  // at startup so client/caregiver/admin get SEPARATE session slots on the same
  // browser origin — otherwise logging into one overwrites another on the same
  // device (which breaks same-device testing of two roles).
  _role: null,

  /** Scope this app's session to a role. Call once at boot. */
  use(role) {
    this._role = role || null;
    return this;
  },

  _key() {
    return this._role ? `${SESSION_PREFIX}_${this._role}` : SESSION_PREFIX;
  },

  /** Current cached session for THIS app's role: { role, userId, name, phone } or null. */
  session() {
    try {
      const raw = localStorage.getItem(this._key())
        // one-time migration: fall back to the old shared key if it matches our role
        || (this._role ? null : localStorage.getItem(SESSION_PREFIX));
      const sess = raw ? JSON.parse(raw) : null;
      // guard: never return a session belonging to a different role
      if (sess && this._role && sess.role && sess.role !== this._role) return null;
      return sess;
    } catch (_) { return null; }
  },

  setSession(sess) {
    // key by the session's own role when available, else this app's role
    const role = (sess && sess.role) || this._role;
    const key = role ? `${SESSION_PREFIX}_${role}` : SESSION_PREFIX;
    localStorage.setItem(key, JSON.stringify(sess));
    return sess;
  },

  signOut() {
    localStorage.removeItem(this._key());
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
