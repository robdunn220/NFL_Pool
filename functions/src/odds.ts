/**
 * The Odds API (v4) client and the mapping from its payload to our Game shape.
 *
 * Lines only. Scores come from ESPN (see espn.ts), which is free and unmetered, so the whole
 * odds-API quota goes to the thing only a book can tell us: the number.
 *
 * Kept separate from index.ts so the date/line logic can be reasoned about — and corrected —
 * without touching the scheduling glue.
 */

const API = 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl';

/** Books we grade off, best first. A pool wants one book's number, not a synthetic average. */
const BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'pointsbetus'];

export interface OddsEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: {
    key: string;
    markets?: { key: string; outcomes?: { name: string; point?: number }[] }[];
  }[];
}

export async function fetchOdds(apiKey: string): Promise<OddsEvent[]> {
  const url = `${API}/odds?apiKey=${apiKey}&regions=us&markets=spreads&oddsFormat=american`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Odds API ${res.status}: ${await res.text()}`);
  return (await res.json()) as OddsEvent[];
}

/**
 * The home spread from the highest-priority book that posted one.
 *
 * The API gives each side's own number (Steelers -3.5 / Cardinals +3.5); we keep the home side's,
 * which is the convention the whole app settles bets with.
 */
export function homeSpreadOf(event: OddsEvent): number | null {
  const books = event.bookmakers ?? [];
  const ranked = [...books].sort((a, b) => {
    const ai = BOOK_PRIORITY.indexOf(a.key);
    const bi = BOOK_PRIORITY.indexOf(b.key);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  for (const book of ranked) {
    const market = book.markets?.find((m) => m.key === 'spreads');
    const outcome = market?.outcomes?.find((o) => o.name === event.home_team);
    if (typeof outcome?.point === 'number') return outcome.point;
  }
  return null;
}

/** `YYYY-MM-DD` for an instant, in US Eastern — the calendar the NFL schedule is written in. */
export function easternDate(iso: string | number | Date): string {
  const d = new Date(iso);
  // en-CA gives ISO-ordered parts, so this is already YYYY-MM-DD.
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** Day of week in US Eastern, 0 = Sunday. */
export function easternDay(iso: string | number | Date): number {
  const name = new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  });
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** The next Sunday on or after `from`, as an Eastern `YYYY-MM-DD`. */
export function nextSundayDate(from = Date.now()): string {
  let d = from;
  for (let i = 0; i < 8; i++) {
    if (easternDay(d) === 0) return easternDate(d);
    d += 86_400_000;
  }
  return easternDate(from);
}

/**
 * Canonical NFL abbreviations, keyed on nickname.
 *
 * Slicing the city apart doesn't work: the Patriots, both New York clubs and the Saints all begin
 * "New", and both Los Angeles clubs begin "Los". All 32 nicknames are unique, so they make a
 * reliable key.
 *
 * NOTE: duplicated in src/app/core/nfl-teams.ts (separate packages, can't share a module). Both
 * copies have tests; keep them in sync.
 */
const ABBR_BY_NICKNAME: Record<string, string> = {
  cardinals: 'ARI', falcons: 'ATL', ravens: 'BAL', bills: 'BUF',
  panthers: 'CAR', bears: 'CHI', bengals: 'CIN', browns: 'CLE',
  cowboys: 'DAL', broncos: 'DEN', lions: 'DET', packers: 'GB',
  texans: 'HOU', colts: 'IND', jaguars: 'JAX', chiefs: 'KC',
  raiders: 'LV', chargers: 'LAC', rams: 'LAR', dolphins: 'MIA',
  vikings: 'MIN', patriots: 'NE', saints: 'NO', giants: 'NYG',
  jets: 'NYJ', eagles: 'PHI', steelers: 'PIT', '49ers': 'SF',
  seahawks: 'SEA', buccaneers: 'TB', titans: 'TEN', commanders: 'WSH',
};

/** Abbreviation for a team from any reasonable spelling ("Pittsburgh Steelers" -> "PIT"). */
export function abbreviate(team: string): string {
  if (!team) return '';
  const nickname = team.trim().split(/\s+/).slice(-1)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  return ABBR_BY_NICKNAME[nickname] ?? team.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}
