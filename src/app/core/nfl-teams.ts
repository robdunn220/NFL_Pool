/**
 * Canonical NFL team abbreviations.
 *
 * Derived from a table rather than sliced out of the city, because four teams share "New" (the
 * Patriots, both New York clubs, and the Saints) and both Los Angeles clubs share "Los" — a
 * heuristic cannot tell them apart, and a grid showing NEW @ NEW is useless.
 *
 * Keyed on the nickname: all 32 are unique, which also means the lookup survives whatever the
 * feeds or an admin call the city ("NY Giants", "New York Giants", "Giants").
 *
 * NOTE: duplicated in functions/src/odds.ts, which stores the abbreviation on new games. The app
 * and functions are separate packages and can't share a module; both copies have tests. The app
 * derives its display value here rather than trusting what's stored, so a stale abbreviation in
 * Firestore never reaches the screen.
 */
const BY_NICKNAME: Record<string, string> = {
  cardinals: 'ARI',
  falcons: 'ATL',
  ravens: 'BAL',
  bills: 'BUF',
  panthers: 'CAR',
  bears: 'CHI',
  bengals: 'CIN',
  browns: 'CLE',
  cowboys: 'DAL',
  broncos: 'DEN',
  lions: 'DET',
  packers: 'GB',
  texans: 'HOU',
  colts: 'IND',
  jaguars: 'JAX',
  chiefs: 'KC',
  raiders: 'LV',
  chargers: 'LAC',
  rams: 'LAR',
  dolphins: 'MIA',
  vikings: 'MIN',
  patriots: 'NE',
  saints: 'NO',
  giants: 'NYG',
  jets: 'NYJ',
  eagles: 'PHI',
  steelers: 'PIT',
  '49ers': 'SF',
  seahawks: 'SEA',
  buccaneers: 'TB',
  titans: 'TEN',
  commanders: 'WSH',
};

/**
 * The abbreviation for a team, from any reasonable spelling of its name.
 *
 * Falls back to the first three letters for anything unrecognised — a relocation, a rename, or a
 * game an admin typed in by hand — so the grid degrades to something readable instead of blank.
 */
export function teamAbbr(name: string): string {
  if (!name) return '—';
  const nickname = name.trim().split(/\s+/).slice(-1)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  return BY_NICKNAME[nickname] ?? name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}
