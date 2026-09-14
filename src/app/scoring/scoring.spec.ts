import { describe, expect, it } from 'vitest';
import { Entry, Game, Week } from '../models';
import { rankWeek, scoreEntry, seasonStandings, settleGame } from './scoring';

function game(partial: Partial<Game> & Pick<Game, 'id'>): Game {
  return {
    kickoff: Date.UTC(2026, 8, 13, 17),
    homeTeam: 'Pittsburgh Steelers',
    awayTeam: 'Arizona Cardinals',
    homeAbbr: 'PIT',
    awayAbbr: 'ARI',
    homeSpread: -3.5,
    ...partial,
  };
}

function week(games: Game[]): Week {
  return { id: '2026-02', season: 2026, week: 2, status: 'final', lockAt: 0, games };
}

function entry(picks: Entry['picks']): Entry {
  return { uid: 'u1', displayName: 'Rob', picks };
}

describe('settleGame', () => {
  it('does not pay a favorite that wins by less than the spread', () => {
    // The motivating case: Steelers -3.5, they win by one. Backing them loses.
    const g = game({ id: 'g1', homeSpread: -3.5, homeScore: 21, awayScore: 20, completed: true });
    expect(settleGame(g)).toBe('away');
  });

  it('pays a favorite that clears the spread', () => {
    const g = game({ id: 'g1', homeSpread: -3.5, homeScore: 24, awayScore: 20, completed: true });
    expect(settleGame(g)).toBe('home');
  });

  it('pays an underdog that loses by less than the spread', () => {
    const g = game({ id: 'g1', homeSpread: 7, homeScore: 20, awayScore: 24, completed: true });
    expect(settleGame(g)).toBe('home');
  });

  it('pushes when the game lands exactly on a whole number', () => {
    const g = game({ id: 'g1', homeSpread: -3, homeScore: 23, awayScore: 20, completed: true });
    expect(settleGame(g)).toBe('push');
  });

  it('never pushes on a half-point line', () => {
    for (const [hs, as_] of [
      [23, 20],
      [24, 20],
      [20, 20],
    ]) {
      const g = game({ id: 'g1', homeSpread: -3.5, homeScore: hs, awayScore: as_, completed: true });
      expect(settleGame(g)).not.toBe('push');
    }
  });

  it('reads a road favorite through the sign of the home spread', () => {
    // Steelers -3.5 on the road: homeSpread is +3.5, and a 1-point Pittsburgh win covers for home.
    const g = game({ id: 'g1', homeSpread: 3.5, homeScore: 20, awayScore: 21, completed: true });
    expect(settleGame(g)).toBe('home');
  });

  it('is undecided until the game is final with both scores', () => {
    expect(settleGame(game({ id: 'g1' }))).toBeNull();
    expect(settleGame(game({ id: 'g1', homeScore: 21, completed: true }))).toBeNull();
  });

  it('treats a completed game with no recorded line as a push', () => {
    const g = game({ id: 'g1', homeSpread: null, homeScore: 30, awayScore: 3, completed: true });
    expect(settleGame(g)).toBe('push');
  });
});

describe('scoreEntry', () => {
  const slate = week([
    game({ id: 'g1', homeSpread: -3.5, homeScore: 21, awayScore: 20, completed: true }), // away covers
    game({ id: 'g2', homeSpread: -3.5, homeScore: 27, awayScore: 20, completed: true }), // home covers
    game({ id: 'g3', homeSpread: -3, homeScore: 23, awayScore: 20, completed: true }), // push
    game({ id: 'g4', homeSpread: -6.5 }), // not yet played
    game({ id: 'g5', homeSpread: -1.5, homeScore: 17, awayScore: 14, completed: true }), // left blank
  ]);

  it('separates wins, losses, pushes, pending and unpicked games', () => {
    const s = scoreEntry(slate, entry({ g1: 'away', g2: 'away', g3: 'home', g4: 'home' }));
    expect(s).toMatchObject({ wins: 1, losses: 1, pushes: 1, pending: 1, missed: 1 });
  });

  it('counts pending picks toward the ceiling but not the current total', () => {
    const s = scoreEntry(slate, entry({ g1: 'away', g4: 'home' }));
    expect(s.wins).toBe(1);
    expect(s.maxPossible).toBe(2);
  });

  it('reports a status for every game on the slate, picked or not', () => {
    const s = scoreEntry(slate, entry({ g1: 'away' }));
    expect(s.picks).toHaveLength(5);
    expect(s.picks.find((p) => p.gameId === 'g5')).toMatchObject({ side: null, status: 'none' });
  });
});

describe('rankWeek', () => {
  const slate = week([
    game({ id: 'g1', homeSpread: -3.5, homeScore: 21, awayScore: 20, completed: true }),
    game({ id: 'g2', homeSpread: -3.5, homeScore: 27, awayScore: 20, completed: true }),
  ]);

  it('orders by wins, then fewest losses', () => {
    const scores = [
      scoreEntry(slate, { uid: 'a', displayName: 'Ann', picks: { g1: 'home', g2: 'away' } }), // 0-2
      scoreEntry(slate, { uid: 'b', displayName: 'Bob', picks: { g1: 'away', g2: 'home' } }), // 2-0
      scoreEntry(slate, { uid: 'c', displayName: 'Cal', picks: { g1: 'away' } }), // 1-0
    ];
    expect(rankWeek(scores).map((s) => s.uid)).toEqual(['b', 'c', 'a']);
  });

  it('leaves an even tie alone, ordering by name', () => {
    const scores = [
      scoreEntry(slate, { uid: 'b', displayName: 'Bob', picks: { g1: 'away' } }),
      scoreEntry(slate, { uid: 'a', displayName: 'Ann', picks: { g1: 'away' } }),
    ];
    expect(rankWeek(scores).map((s) => s.uid)).toEqual(['a', 'b']);
  });
});

describe('seasonStandings', () => {
  it('accumulates records across weeks and tracks the best single week', () => {
    const w1 = week([
      game({ id: 'g1', homeSpread: -3.5, homeScore: 21, awayScore: 20, completed: true }),
      game({ id: 'g2', homeSpread: -3.5, homeScore: 27, awayScore: 20, completed: true }),
    ]);
    const w2 = week([game({ id: 'h1', homeSpread: -3, homeScore: 23, awayScore: 20, completed: true })]);

    const standings = seasonStandings([
      [
        scoreEntry(w1, { uid: 'a', displayName: 'Ann', picks: { g1: 'away', g2: 'home' } }),
        scoreEntry(w1, { uid: 'b', displayName: 'Bob', picks: { g1: 'home', g2: 'home' } }),
      ],
      [scoreEntry(w2, { uid: 'b', displayName: 'Bob', picks: { h1: 'home' } })],
    ]);

    expect(standings[0]).toMatchObject({ uid: 'a', wins: 2, losses: 0, weeksPlayed: 1, bestWeek: 2 });
    expect(standings[1]).toMatchObject({ uid: 'b', wins: 1, losses: 1, pushes: 1, weeksPlayed: 2 });
  });
});
