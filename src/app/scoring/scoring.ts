import { Entry, Game, PickResult, PickStatus, SeasonRow, Side, Week, WeekScore } from '../models';

/**
 * Against-the-spread scoring for the Sunday pool.
 *
 * The only rule: a pick wins if the side you took beats the number, not if the team wins the
 * game. Add the home spread to the home team's score and compare — so Steelers -3.5 winning by
 * 1 settles at 1 - 3.5 = -2.5, a loss for anyone on Pittsburgh.
 *
 * Landing exactly on a whole-number spread is a push: no point for either side, and it counts
 * against neither record. Half-point lines can never push, which is why most pools hang them
 * there.
 *
 * Framework-free and pure so it can be unit tested in isolation and reused by the picks page,
 * the leaderboard, and the season standings.
 */

/** Which side covered, 'push' if the game landed on the number, or null while it is undecided. */
export function settleGame(game: Game): Side | 'push' | null {
  if (!game.completed || game.homeScore == null || game.awayScore == null) return null;
  // A completed game with no recorded line is unbettable; treat it as a push for everyone.
  if (game.homeSpread == null) return 'push';
  const adjusted = game.homeScore - game.awayScore + game.homeSpread;
  if (adjusted > 0) return 'home';
  if (adjusted < 0) return 'away';
  return 'push';
}

/** How one pick settled against a game. */
export function settlePick(game: Game, side: Side | undefined): PickStatus {
  if (!side) return 'none';
  const cover = settleGame(game);
  if (cover === null) return 'pending';
  if (cover === 'push') return 'push';
  return cover === side ? 'win' : 'loss';
}

/** Scores one entry against a week's slate. */
export function scoreEntry(week: Week, entry: Entry): WeekScore {
  const picks: PickResult[] = week.games.map((game) => ({
    gameId: game.id,
    side: entry.picks[game.id] ?? null,
    status: settlePick(game, entry.picks[game.id]),
  }));

  const count = (s: PickStatus) => picks.filter((p) => p.status === s).length;
  const wins = count('win');
  const pending = count('pending');

  return {
    uid: entry.uid,
    displayName: entry.displayName,
    wins,
    losses: count('loss'),
    pushes: count('push'),
    pending,
    missed: count('none'),
    maxPossible: wins + pending,
    picks,
    tiebreaker: entry.tiebreaker ?? null,
  };
}

/** Scores every entry in a week. Order is not significant; use rankWeek to sort. */
export function scoreWeek(week: Week, entries: Entry[]): WeekScore[] {
  return entries.map((e) => scoreEntry(week, e));
}

/**
 * Sorts a scored week: most wins, then fewest losses, then closest tiebreaker (when the week has
 * an actual total to compare against), then name. A missing tiebreaker sorts last.
 */
export function rankWeek(scores: WeekScore[], actualTotal?: number | null): WeekScore[] {
  const distance = (s: WeekScore) =>
    actualTotal == null || s.tiebreaker == null
      ? Number.POSITIVE_INFINITY
      : Math.abs(s.tiebreaker - actualTotal);

  return [...scores].sort(
    (a, b) =>
      b.wins - a.wins ||
      a.losses - b.losses ||
      distance(a) - distance(b) ||
      a.displayName.localeCompare(b.displayName),
  );
}

/** The tiebreaker target: total points in the latest-kicking game, once it is final. */
export function tiebreakerTotal(week: Week): number | null {
  const games = [...week.games].sort((a, b) => b.kickoff - a.kickoff);
  const last = games[0];
  if (!last?.completed || last.homeScore == null || last.awayScore == null) return null;
  return last.homeScore + last.awayScore;
}

/** Rolls scored weeks up into season standings, sorted by wins then win percentage. */
export function seasonStandings(weeks: WeekScore[][]): SeasonRow[] {
  const rows = new Map<string, SeasonRow>();

  for (const week of weeks) {
    for (const s of week) {
      const row = rows.get(s.uid) ?? {
        uid: s.uid,
        displayName: s.displayName,
        wins: 0,
        losses: 0,
        pushes: 0,
        weeksPlayed: 0,
        bestWeek: 0,
      };
      row.displayName = s.displayName;
      row.wins += s.wins;
      row.losses += s.losses;
      row.pushes += s.pushes;
      row.weeksPlayed += 1;
      row.bestWeek = Math.max(row.bestWeek, s.wins);
      rows.set(s.uid, row);
    }
  }

  const pct = (r: SeasonRow) => (r.wins + r.losses === 0 ? 0 : r.wins / (r.wins + r.losses));
  return [...rows.values()].sort(
    (a, b) => b.wins - a.wins || pct(b) - pct(a) || a.displayName.localeCompare(b.displayName),
  );
}
