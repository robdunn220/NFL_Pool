import { Side } from './week.model';

/** How a single pick settled. 'pending' = game not final; 'push' = landed exactly on the number. */
export type PickStatus = 'win' | 'loss' | 'push' | 'pending' | 'none';

export interface PickResult {
  gameId: string;
  side: Side | null;
  status: PickStatus;
}

/** One player's scored week. */
export interface WeekScore {
  uid: string;
  displayName: string;
  wins: number;
  losses: number;
  pushes: number;
  /** Games picked whose result is still unknown. */
  pending: number;
  /** Games on the slate the player left blank. */
  missed: number;
  /** wins + pending — the ceiling if everything still open hits. */
  maxPossible: number;
  picks: PickResult[];
}

/** Season-long standings row, aggregated across weeks. */
export interface SeasonRow {
  uid: string;
  displayName: string;
  wins: number;
  losses: number;
  pushes: number;
  weeksPlayed: number;
  /** Best single-week win total. */
  bestWeek: number;
}
