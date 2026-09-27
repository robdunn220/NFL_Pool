import { describe, expect, it } from 'vitest';
import { teamAbbr } from './nfl-teams';

describe('teamAbbr', () => {
  it('tells the four "New" teams apart', () => {
    expect(teamAbbr('New England Patriots')).toBe('NE');
    expect(teamAbbr('New York Giants')).toBe('NYG');
    expect(teamAbbr('New York Jets')).toBe('NYJ');
    expect(teamAbbr('New Orleans Saints')).toBe('NO');
  });

  it('tells the two Los Angeles teams apart', () => {
    expect(teamAbbr('Los Angeles Rams')).toBe('LAR');
    expect(teamAbbr('Los Angeles Chargers')).toBe('LAC');
  });

  it('handles the nickname that is a number', () => {
    expect(teamAbbr('San Francisco 49ers')).toBe('SF');
  });

  it('works from a shortened city or the nickname alone', () => {
    expect(teamAbbr('NY Giants')).toBe('NYG');
    expect(teamAbbr('Giants')).toBe('NYG');
    expect(teamAbbr('N.Y. Jets')).toBe('NYJ');
  });

  it('covers all 32 clubs with no duplicates', () => {
    const teams = [
      'Arizona Cardinals', 'Atlanta Falcons', 'Baltimore Ravens', 'Buffalo Bills',
      'Carolina Panthers', 'Chicago Bears', 'Cincinnati Bengals', 'Cleveland Browns',
      'Dallas Cowboys', 'Denver Broncos', 'Detroit Lions', 'Green Bay Packers',
      'Houston Texans', 'Indianapolis Colts', 'Jacksonville Jaguars', 'Kansas City Chiefs',
      'Las Vegas Raiders', 'Los Angeles Chargers', 'Los Angeles Rams', 'Miami Dolphins',
      'Minnesota Vikings', 'New England Patriots', 'New Orleans Saints', 'New York Giants',
      'New York Jets', 'Philadelphia Eagles', 'Pittsburgh Steelers', 'San Francisco 49ers',
      'Seattle Seahawks', 'Tampa Bay Buccaneers', 'Tennessee Titans', 'Washington Commanders',
    ];
    const abbrs = teams.map(teamAbbr);
    expect(abbrs).toHaveLength(32);
    expect(new Set(abbrs).size).toBe(32);
    // Nothing fell through to the three-letter fallback.
    expect(abbrs.filter((a) => a.length > 3)).toEqual([]);
  });

  it('degrades readably for something off-list', () => {
    expect(teamAbbr('Toronto Huskies')).toBe('TOR');
    expect(teamAbbr('')).toBe('—');
  });
});
