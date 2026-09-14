import { Side } from './week.model';

/**
 * A user's entry for one week. Stored at weeks/{weekId}/entries/{uid} — keyed by uid, which is
 * what guarantees one entry per user per week.
 *
 * `picks` maps game id -> the side the user took against the spread. A game missing from the map
 * is simply unpicked and scores zero; the UI nudges for a full slate but does not require it.
 */
export interface Entry {
  uid: string;
  displayName: string;
  picks: Record<string, Side>;
  /** Optional tiebreaker: total points in the last Sunday game. */
  tiebreaker?: number | null;
  submittedAt?: number;
  updatedAt?: number;
}

export function emptyEntry(uid: string, displayName: string): Entry {
  return { uid, displayName, picks: {}, tiebreaker: null };
}
