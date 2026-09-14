import { describe, expect, it } from 'vitest';
import { EspnGame, findGame, sameTeam, scoresOf, toEspnDate } from './espn';

function game(away: string, home: string, awayScore = 0, homeScore = 0, completed = true): EspnGame {
  return {
    id: `${away}@${home}`,
    completed,
    competitors: [
      { name: away, score: awayScore, homeAway: 'away' },
      { name: home, score: homeScore, homeAway: 'home' },
    ],
  };
}

describe('sameTeam', () => {
  it('matches identical names', () => {
    expect(sameTeam('Pittsburgh Steelers', 'Pittsburgh Steelers')).toBe(true);
  });

  it('ignores punctuation and case', () => {
    expect(sameTeam('N.Y. Giants', 'ny giants')).toBe(true);
  });

  it('matches a city-only or nickname-only spelling', () => {
    expect(sameTeam('Pittsburgh', 'Pittsburgh Steelers')).toBe(true);
    expect(sameTeam('Steelers', 'Pittsburgh Steelers')).toBe(true);
  });

  it('keeps two teams from the same city apart', () => {
    expect(sameTeam('New York Giants', 'New York Jets')).toBe(false);
    expect(sameTeam('Los Angeles Rams', 'Los Angeles Chargers')).toBe(false);
  });

  it('rejects an empty name rather than matching everything', () => {
    expect(sameTeam('', 'Pittsburgh Steelers')).toBe(false);
  });
});

describe('findGame', () => {
  const board = [
    game('Arizona Cardinals', 'Pittsburgh Steelers', 20, 21),
    game('Dallas Cowboys', 'New York Giants', 10, 13),
    game('Buffalo Bills', 'New York Jets', 24, 3),
  ];

  it('finds the fixture by both team names', () => {
    expect(findGame(board, 'Arizona Cardinals', 'Pittsburgh Steelers')?.id).toBe(
      'Arizona Cardinals@Pittsburgh Steelers',
    );
  });

  it('does not match the same fixture played the other way round', () => {
    expect(findGame(board, 'Pittsburgh Steelers', 'Arizona Cardinals')).toBeUndefined();
  });

  it('distinguishes the two New York home teams', () => {
    expect(findGame(board, 'Dallas Cowboys', 'New York Jets')).toBeUndefined();
    expect(findGame(board, 'Buffalo Bills', 'New York Jets')?.id).toBe(
      'Buffalo Bills@New York Jets',
    );
  });

  it('returns undefined for a fixture that is not on the board', () => {
    expect(findGame(board, 'Chicago Bears', 'Green Bay Packers')).toBeUndefined();
  });
});

describe('scoresOf', () => {
  it('reads home and away scores off the competitors', () => {
    expect(scoresOf(game('Arizona Cardinals', 'Pittsburgh Steelers', 20, 21))).toEqual({
      awayScore: 20,
      homeScore: 21,
    });
  });

  it('returns null when a side is missing', () => {
    const malformed: EspnGame = {
      id: 'x',
      completed: true,
      competitors: [{ name: 'Arizona Cardinals', score: 20, homeAway: 'away' }],
    };
    expect(scoresOf(malformed)).toBeNull();
  });
});

describe('toEspnDate', () => {
  it('strips the dashes from our stored Sunday', () => {
    expect(toEspnDate('2026-09-13')).toBe('20260913');
  });
});
