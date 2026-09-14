/**
 * The Odds API (v4) client and the mapping from its payload to our Game shape.
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

export interface ScoreEvent {
  id: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores?: { name: string; score: string }[] | null;
}

export async function fetchOdds(apiKey: string): Promise<OddsEvent[]> {
  const url = `${API}/odds?apiKey=${apiKey}&regions=us&markets=spreads&oddsFormat=american`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Odds API ${res.status}: ${await res.text()}`);
  return (await res.json()) as OddsEvent[];
}

/** Scores for games that started within the last `daysFrom` days (the API's max is 3). */
export async function fetchScores(apiKey: string, daysFrom = 3): Promise<ScoreEvent[]> {
  const url = `${API}/scores?apiKey=${apiKey}&daysFrom=${daysFrom}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Odds API ${res.status}: ${await res.text()}`);
  return (await res.json()) as ScoreEvent[];
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

/** Three-letter-ish abbreviation from a full team name ("Pittsburgh Steelers" -> "PIT"). */
export function abbreviate(team: string): string {
  const nickname = team.split(' ').slice(-1)[0];
  const city = team.split(' ').slice(0, -1).join(' ');
  return (city || nickname).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}
