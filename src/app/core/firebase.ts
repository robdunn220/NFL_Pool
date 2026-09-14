import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import {
  Firestore,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { environment } from '../../environments/environment';

/** Lazily-initialized Firebase singletons. */
let app: FirebaseApp | undefined;
let db: Firestore | undefined;

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(environment.firebase);
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

/**
 * Firestore with an on-disk cache.
 *
 * A cold load walks three documents in sequence — config/app, then the active week, then your
 * entry — so without a cache every reload pays three full round-trips before the slate appears.
 * With persistence the second visit renders from IndexedDB immediately and the network result just
 * updates it in place.
 *
 * The multi-tab manager matters here: people leave the pool open in a second tab on Sunday, and
 * the single-tab cache would refuse to initialize in whichever tab loaded second.
 */
export function getDb(): Firestore {
  if (!db) {
    try {
      db = initializeFirestore(getFirebaseApp(), {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch {
      // Firestore was already initialized, or the browser blocks IndexedDB (private windows,
      // storage turned off). Either way an in-memory cache still works — just not across reloads.
      db = getFirestore(getFirebaseApp());
    }
  }
  return db;
}
