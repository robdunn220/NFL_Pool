import { Injectable } from '@angular/core';
import {
  Unsubscribe,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getDb } from '../core/firebase';
import { Entry } from '../models';

/** Reads and writes weekly entries at weeks/{weekId}/entries/{uid}. */
@Injectable({ providedIn: 'root' })
export class EntryService {
  private readonly db = getDb();

  async getEntry(weekId: string, uid: string): Promise<Entry | null> {
    const snap = await getDoc(doc(this.db, 'weeks', weekId, 'entries', uid));
    return snap.exists() ? (snap.data() as Entry) : null;
  }

  /** Live updates for a single user's entry. */
  watchEntry(weekId: string, uid: string, cb: (entry: Entry | null) => void): Unsubscribe {
    return onSnapshot(doc(this.db, 'weeks', weekId, 'entries', uid), (snap) =>
      cb(snap.exists() ? (snap.data() as Entry) : null),
    );
  }

  /**
   * Live updates for every entry in a week. Only succeeds once the week has locked — before that,
   * security rules hide other players' picks and the listen is rejected.
   */
  watchAllEntries(weekId: string, cb: (entries: Entry[]) => void): Unsubscribe {
    return onSnapshot(collection(this.db, 'weeks', weekId, 'entries'), (snap) =>
      cb(snap.docs.map((d) => d.data() as Entry)),
    );
  }

  async listEntries(weekId: string): Promise<Entry[]> {
    const snap = await getDocs(collection(this.db, 'weeks', weekId, 'entries'));
    return snap.docs.map((d) => d.data() as Entry);
  }

  /**
   * Upserts the signed-in user's entry. Writing to a uid-keyed document is what keeps a player to
   * one entry per week — a second "entry" is just an edit of the first, and only until lock.
   */
  async saveEntry(weekId: string, entry: Entry): Promise<void> {
    const payload: Record<string, unknown> = { ...entry, updatedAt: serverTimestamp() };
    if (!entry.submittedAt) payload['submittedAt'] = serverTimestamp();
    await setDoc(doc(this.db, 'weeks', weekId, 'entries', entry.uid), payload, { merge: true });
  }
}
