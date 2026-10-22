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
  // An entry document can exist without picks (e.g. its fields were cleared by hand in the
  // console); score it as a blank card rather than letting one bad row sink the whole board.
  const chosen = entry.picks ?? {};
  const picks: PickResult[] = week.games.map((game) => ({
    gameId: game.id,
    side: chosen[game.id] ?? null,
    status: settlePick(game, chosen[game.id]),
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
  };
}

/** Scores every entry in a week. Order is not significant; use rankWeek to sort. */
export function scoreWeek(week: Week, entries: Entry[]): WeekScore[] {
  return entries.map((e) => scoreEntry(week, e));
}

/**
 * Sorts a scored week: most wins, then fewest losses, then name.
 *
 * Ties at the top stay ties — the pool splits them rather than settling on a guessed total.
 */
export function rankWeek(scores: WeekScore[]): WeekScore[] {
  return [...scores].sort(
    (a, b) =>
      b.wins - a.wins ||
      a.losses - b.losses ||
      (a.displayName ?? '').localeCompare(b.displayName ?? ''),
  );
}

/**
 * Rolls scored weeks up into season standings, sorted by wins then win percentage.
 *
 * Also credits each week's pot: whoever picked the most games correctly wins it, and a tie at the
 * top means every tied player won — the pot is split, not decided by a tiebreaker. A week only
 * pays once nothing anyone picked is still pending, so a Sunday in progress awards nothing yet.
 * A week where the best score is zero pays nobody.
 */
export function seasonStandings(weeks: WeekScore[][]): SeasonRow[] {
  const rows = new Map<string, SeasonRow>();

  for (const week of weeks) {
    const settled = week.every((s) => s.pending === 0);
    const top = Math.max(0, ...week.map((s) => s.wins));

    for (const s of week) {
      const row = rows.get(s.uid) ?? {
        uid: s.uid,
        displayName: s.displayName,
        wins: 0,
        losses: 0,
        pushes: 0,
        weeksPlayed: 0,
        bestWeek: 0,
        weeksWon: 0,
      };
      row.displayName = s.displayName;
      row.wins += s.wins;
      row.losses += s.losses;
      row.pushes += s.pushes;
      row.weeksPlayed += 1;
      row.bestWeek = Math.max(row.bestWeek, s.wins);
      if (settled && top > 0 && s.wins === top) row.weeksWon += 1;
      rows.set(s.uid, row);
    }
  }

  const pct = (r: SeasonRow) => (r.wins + r.losses === 0 ? 0 : r.wins / (r.wins + r.losses));
  return [...rows.values()].sort(
    (a, b) =>
      b.wins - a.wins ||
      pct(b) - pct(a) ||
      (a.displayName ?? '').localeCompare(b.displayName ?? ''),
  );
}
