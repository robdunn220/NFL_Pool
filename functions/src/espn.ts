/**
 * ESPN's public NFL scoreboard — the source of truth for scores.
 *
 * No API key and no quota to speak of, which is why scores come from here rather than the odds
 * feed; the Odds API is used only for the lines. It is also the same feed the client-side
 * scoreboard banner polls, so the banner and the standings can no longer disagree.
 *
 * NOTE: `sameTeam`/`normalize`/`nickname` are duplicated from src/app/services/espn.service.ts.
 * The app and functions are separate packages and can't share a module; both copies are covered by
 * tests (espn.spec.ts on each side). Keep them in sync.
 */

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

export interface EspnCompetitor {
  name: string;
  score: number;
  homeAway: 'home' | 'away';
}

export interface EspnGame {
  id: string;
  completed: boolean;
  competitors: EspnCompetitor[];
}

interface RawScoreboard {
  events?: {
    id?: string;
    status?: { type?: { completed?: boolean } };
    competitions?: {
      competitors?: {
        team?: { displayName?: string };
        score?: string | number;
        homeAway?: string;
      }[];
    }[];
  }[];
}

/** Lowercase alphanumerics, so "N.Y. Giants" and "NY Giants" compare equal. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The nickname alone ("Pittsburgh Steelers" -> "steelers"). All 32 NFL nicknames are unique. */
function nickname(name: string): string {
  return normalize(name.trim().split(/\s+/).slice(-1)[0] ?? '');
}

/**
 * Whether two spellings name the same team.
 *
 * The feeds mostly agree on full names, so the equality check carries the day. The other two rules
 * cover a game entered by hand in Admin as just the city ("Pittsburgh") or just the nickname
 * ("Steelers"). Two teams sharing a city stay distinct — "New York Giants" and "New York Jets"
 * satisfy none of these against each other.
 */
export function sameTeam(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  return nickname(a) === nickname(b);
}

/** `YYYY-MM-DD` (our stored Sunday) -> `YYYYMMDD` (what ESPN's `dates` param wants). */
export function toEspnDate(sundayDate: string): string {
  return sundayDate.replace(/-/g, '');
}

/** Games on one date. `date` is YYYYMMDD; omit for ESPN's current scoreboard. */
export async function fetchScoreboard(date?: string): Promise<EspnGame[]> {
  const url = date ? `${SCOREBOARD}?dates=${date}&limit=100` : `${SCOREBOARD}?limit=100`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  const data = (await res.json()) as RawScoreboard;

  return (data.events ?? []).map((e) => ({
    id: e.id ?? '',
    completed: !!e.status?.type?.completed,
    competitors: (e.competitions?.[0]?.competitors ?? []).map((c) => ({
      name: c.team?.displayName ?? '',
      score: Number(c.score ?? 0),
      homeAway: c.homeAway === 'home' ? ('home' as const) : ('away' as const),
    })),
  }));
}

/** The ESPN game matching a pool fixture, matched on both sides so same-city teams stay apart. */
export function findGame(
  espnGames: EspnGame[],
  awayTeam: string,
  homeTeam: string,
): EspnGame | undefined {
  return espnGames.find((e) => {
    const home = e.competitors.find((c) => c.homeAway === 'home');
    const away = e.competitors.find((c) => c.homeAway === 'away');
    return (
      !!home && !!away && sameTeam(homeTeam, home.name) && sameTeam(awayTeam, away.name)
    );
  });
}

/** The home and away scores of an ESPN game, or null when either side is missing. */
export function scoresOf(game: EspnGame): { homeScore: number; awayScore: number } | null {
  const home = game.competitors.find((c) => c.homeAway === 'home');
  const away = game.competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;
  return { homeScore: home.score, awayScore: away.score };
}
