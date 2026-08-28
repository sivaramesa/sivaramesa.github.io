/* Authentication module - wraps Firebase Auth (email/password).
 * Exposes a small promise-based API plus an auth-state observer.
 */
import { auth } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

export const Auth = {
  /** Current signed-in user (Firebase User) or null. */
  current() {
    return auth.currentUser;
  },

  /** A plain object describing the current user for storing on records. */
  currentProfile() {
    const u = auth.currentUser;
    if (!u) return null;
    return {
      uid: u.uid,
      name: u.displayName || (u.email ? u.email.split('@')[0] : 'Unknown'),
      email: u.email || ''
    };
  },

  async signUp(email, password, name) {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (name && name.trim()) {
      await updateProfile(cred.user, { displayName: name.trim() });
    }
    return cred.user;
  },

  async signIn(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    return cred.user;
  },

  async logout() {
    return signOut(auth);
  },

  /** Subscribe to auth state changes. Returns an unsubscribe function. */
  onChange(callback) {
    return onAuthStateChanged(auth, callback);
  }
};
