import { Injectable, computed, signal } from '@angular/core';
import {
  User,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDb, getFirebaseAuth } from '../core/firebase';
import { environment } from '../../environments/environment';

/** Maps Firebase auth error codes to friendly messages. */
function friendlyAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account already exists with that email.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = getFirebaseAuth();

  /** Current Firebase user, or null when signed out. */
  readonly user = signal<User | null>(null);
  /** True until the first auth state resolves (avoids guard/redirect flicker). */
  readonly initializing = signal(true);

  readonly isLoggedIn = computed(() => !!this.user());
  readonly displayName = computed(() => this.user()?.displayName || this.user()?.email || '');
  readonly isAdmin = computed(() => {
    const email = this.user()?.email?.toLowerCase();
    return !!email && environment.adminEmails.map((e) => e.toLowerCase()).includes(email);
  });

  private readyResolve!: (user: User | null) => void;
  private readonly ready = new Promise<User | null>((resolve) => (this.readyResolve = resolve));

  constructor() {
    setPersistence(this.auth, browserLocalPersistence).catch(() => {});
    let first = true;
    onAuthStateChanged(this.auth, (user) => {
      this.user.set(user);
      this.initializing.set(false);
      if (first) {
        first = false;
        this.readyResolve(user);
      }
    });
  }

  /** Resolves with the user once the first auth state is known. */
  whenReady(): Promise<User | null> {
    return this.ready;
  }

  async register(email: string, password: string, displayName: string): Promise<void> {
    try {
      const cred = await createUserWithEmailAndPassword(this.auth, email, password);
      await updateProfile(cred.user, { displayName });
      await setDoc(
        doc(getDb(), 'users', cred.user.uid),
        { email, displayName, createdAt: serverTimestamp() },
        { merge: true },
      );
      this.user.set(this.auth.currentUser);
    } catch (e: unknown) {
      throw new Error(friendlyAuthError((e as { code?: string }).code ?? ''));
    }
  }

  async login(email: string, password: string): Promise<void> {
    try {
      const cred = await signInWithEmailAndPassword(this.auth, email, password);
      // Set the signal immediately so guards see the user without waiting for the observer.
      this.user.set(cred.user);
    } catch (e: unknown) {
      throw new Error(friendlyAuthError((e as { code?: string }).code ?? ''));
    }
  }

  async resetPassword(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(this.auth, email);
    } catch (e: unknown) {
      throw new Error(friendlyAuthError((e as { code?: string }).code ?? ''));
    }
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }
}
