/** Which side of a game a user picked. */
export type Side = 'home' | 'away';

/** Lifecycle of a week. Picks are editable only while status is 'open' and lockAt is in the future. */
export type WeekStatus = 'draft' | 'open' | 'locked' | 'final';

/**
 * One Sunday game, with the closing line the pool is played against.
 *
 * Spread convention: `homeSpread` is the number of points added to the HOME team's final score.
 * A favorite carries a negative number. "Steelers -3.5 at home vs Cardinals" is homeSpread: -3.5;
 * the same game with Pittsburgh on the road is homeSpread: +3.5.
 */
export interface Game {
  /** Stable id. From the odds feed when auto-pulled, otherwise admin-generated. */
  id: string;
  /** Kickoff, epoch ms. */
  kickoff: number;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string;
  awayAbbr: string;
  /** Points added to the home score to settle the bet. Null until a line is available. */
  homeSpread: number | null;
  /** When the line was captured, epoch ms. Lines move; this is the one the pool is graded on. */
  lineCapturedAt?: number;
  /** True once an admin pins the line so the scheduled sync stops overwriting it. */
  lineLocked?: boolean;
  homeScore?: number;
  awayScore?: number;
  completed?: boolean;
}

/** A pool week. Stored at weeks/{id}, e.g. weeks/2026-04. */
export interface Week {
  /** Document id, `${season}-${String(week).padStart(2,'0')}`. */
  id: string;
  season: number;
  /** NFL week number, 1-18. */
  week: number;
  status: WeekStatus;
  /** Picks deadline, epoch ms. Defaults to the earliest kickoff on the slate. */
  lockAt: number;
  /**
   * The Sunday this week covers, as `YYYY-MM-DD` in US Eastern time. The odds sync uses it to
   * decide which games belong to the week; left blank, the sync fills in the next upcoming Sunday.
   */
  sundayDate?: string;
  /** Sunday games only, in kickoff order. */
  games: Game[];
  updatedAt?: number;
}

/** `${season}-${week}` zero-padded, the canonical week document id. */
export function weekId(season: number, week: number): string {
  return `${season}-${String(week).padStart(2, '0')}`;
}

/** The earliest kickoff on the slate, or 0 for an empty slate. */
export function firstKickoff(games: Game[]): number {
  return games.length ? Math.min(...games.map((g) => g.kickoff)) : 0;
}

/** Formats a spread from one side's perspective: -3.5, +3.5, PK. */
export function spreadLabel(homeSpread: number | null, side: Side): string {
  if (homeSpread == null) return '—';
  const n = side === 'home' ? homeSpread : -homeSpread;
  if (n === 0) return 'PK';
  return n > 0 ? `+${n}` : `${n}`;
}
