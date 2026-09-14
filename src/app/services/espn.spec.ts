import { describe, expect, it } from 'vitest';
import { Game } from '../models';
import { EspnCompetitor, EspnGame, mergeLiveScores } from './espn.service';

function competitor(
  name: string,
  homeAway: 'home' | 'away',
  score: number,
): EspnCompetitor {
  return {
    espnId: name,
    name,
    abbrev: name.slice(0, 3).toUpperCase(),
    logoUrl: '',
    score,
    homeAway,
    winner: false,
  };
}

function espnGame(partial: Partial<EspnGame> & Pick<EspnGame, 'id'>): EspnGame {
  return {
    date: '2026-09-13T17:00Z',
    state: 'post',
    completed: true,
    statusDetail: 'Final',
    competitors: [
      competitor('Arizona Cardinals', 'away', 20),
      competitor('Pittsburgh Steelers', 'home', 21),
    ],
    ...partial,
  };
}

function poolGame(partial: Partial<Game> = {}): Game {
  return {
    id: 'pool-1',
    kickoff: Date.parse('2026-09-13T17:00Z'),
    awayTeam: 'Arizona Cardinals',
    homeTeam: 'Pittsburgh Steelers',
    awayAbbr: 'ARI',
    homeAbbr: 'PIT',
    homeSpread: -3.5,
    ...partial,
  };
}

describe('mergeLiveScores', () => {
  it('attaches our line and settles the live score against it', () => {
    const [row] = mergeLiveScores([espnGame({ id: 'e1' })], [poolGame()]);
    expect(row.poolGameId).toBe('pool-1');
    expect(row.homeSpread).toBe(-3.5);
    // Steelers -3.5 winning by one: the Cardinals are covering.
    expect(row.covering).toBe('away');
  });

  it('settles mid-game too, so the strip shows who is covering right now', () => {
    const live = espnGame({
      id: 'e1',
      state: 'in',
      completed: false,
      statusDetail: '3rd 4:22',
      competitors: [
        competitor('Arizona Cardinals', 'away', 7),
        competitor('Pittsburgh Steelers', 'home', 17),
      ],
    });
    const [row] = mergeLiveScores([live], [poolGame()]);
    expect(row.covering).toBe('home');
    expect(row.completed).toBe(false);
  });

  it('marks the side the viewer took', () => {
    const [row] = mergeLiveScores([espnGame({ id: 'e1' })], [poolGame()], { 'pool-1': 'home' });
    expect(row.myPick).toBe('home');
  });

  it('matches a slate game entered by hand as just the city', () => {
    const espn = espnGame({
      id: 'e1',
      competitors: [
        competitor('Arizona Cardinals', 'away', 20),
        competitor('Pittsburgh Steelers', 'home', 21),
      ],
    });
    const pool = poolGame({ awayTeam: 'Arizona', homeTeam: 'Pittsburgh' });
    expect(mergeLiveScores([espn], [pool])[0].poolGameId).toBe('pool-1');
  });

  it('matches a slate game entered by hand as just the nickname', () => {
    const pool = poolGame({ awayTeam: 'Cardinals', homeTeam: 'Steelers' });
    expect(mergeLiveScores([espnGame({ id: 'e1' })], [pool])[0].poolGameId).toBe('pool-1');
  });

  it('keeps two teams from the same city apart', () => {
    const espn = espnGame({
      id: 'e1',
      competitors: [
        competitor('Dallas Cowboys', 'away', 10),
        competitor('New York Giants', 'home', 13),
      ],
    });
    const pool = poolGame({ awayTeam: 'Dallas Cowboys', homeTeam: 'New York Jets' });
    expect(mergeLiveScores([espn], [pool])[0].poolGameId).toBeUndefined();
  });

  it('does not match a game played in the other direction', () => {
    const espn = espnGame({
      id: 'e1',
      competitors: [
        competitor('Pittsburgh Steelers', 'away', 21),
        competitor('Arizona Cardinals', 'home', 20),
      ],
    });
    expect(mergeLiveScores([espn], [poolGame()])[0].poolGameId).toBeUndefined();
  });

  it('still shows a game that is not on the pool slate, without a line', () => {
    const espn = espnGame({
      id: 'e1',
      competitors: [
        competitor('Dallas Cowboys', 'away', 10),
        competitor('New York Giants', 'home', 13),
      ],
    });
    const [row] = mergeLiveScores([espn], [poolGame()]);
    expect(row.poolGameId).toBeUndefined();
    expect(row.covering).toBeUndefined();
    expect(row.home.abbrev).toBe('NEW');
  });

  it('skips a malformed event with no home or away side', () => {
    const espn = espnGame({ id: 'e1', competitors: [competitor('Arizona Cardinals', 'away', 20)] });
    expect(mergeLiveScores([espn], [poolGame()])).toHaveLength(0);
  });

  it('orders in-progress games first, then upcoming, then finals', () => {
    const rows = mergeLiveScores(
      [
        espnGame({ id: 'final', state: 'post', completed: true }),
        espnGame({ id: 'upcoming', state: 'pre', completed: false }),
        espnGame({ id: 'live', state: 'in', completed: false }),
      ],
      [],
    );
    expect(rows.map((r) => r.id)).toEqual(['live', 'upcoming', 'final']);
  });

  it('reports a push when the game lands on a whole number', () => {
    const [row] = mergeLiveScores([espnGame({ id: 'e1' })], [poolGame({ homeSpread: -1 })]);
    expect(row.covering).toBe('push');
  });
});
