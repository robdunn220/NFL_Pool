import { Injectable } from '@angular/core';
import { Game, Side } from '../models';
import { settleGame } from '../scoring/scoring';

/**
 * ESPN's public (unofficial) NFL scoreboard — no API key, and this endpoint sends CORS headers,
 * so the browser can call it directly.
 *
 * This is the *live* feed behind the scoreboard banner only. Official results still come from the
 * Odds API sync in Cloud Functions, which is what the leaderboard scores against; the banner can
 * therefore show a game as final a few minutes before the standings catch up.
 */
const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/** A normalized game from the ESPN scoreboard. */
export interface EspnGame {
  id: string;
  date: string;
  /** 'pre' | 'in' | 'post'. */
  state: string;
  completed: boolean;
  /** ESPN's short label: "Final", "3rd 4:22", "1:00 PM". */
  statusDetail: string;
  competitors: EspnCompetitor[];
}

export interface EspnCompetitor {
  espnId: string;
  name: string;
  abbrev: string;
  logoUrl: string;
  score: number;
  homeAway: Side;
  winner: boolean;
}

/** One strip in the banner: an ESPN game, plus our line and the viewer's pick when we have them. */
export interface LiveRow {
  id: string;
  state: string;
  completed: boolean;
  statusDetail: string;
  away: EspnCompetitor;
  home: EspnCompetitor;
  /** Set when this game is on the pool's slate. */
  poolGameId?: string;
  homeSpread?: number | null;
  /** Which side is covering right now — provisional until the game is final. */
  covering?: Side | 'push' | null;
  /** The side the viewer took, when they picked this game. */
  myPick?: Side;
}

interface RawScoreboard {
  events?: {
    id?: string;
    date?: string;
    status?: { type?: { completed?: boolean; state?: string; shortDetail?: string } };
    competitions?: {
      competitors?: {
        team?: {
          id?: string;
          displayName?: string;
          abbreviation?: string;
          shortDisplayName?: string;
          logo?: string;
          logos?: { href?: string }[];
        };
        score?: string | number;
        homeAway?: string;
        winner?: boolean;
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
 * The feeds mostly agree on full names, so the cheap equality check carries the day. The other two
 * rules cover a name entered by hand in Admin as just the city ("Pittsburgh") or just the nickname
 * ("Steelers"). Distinct teams sharing a city stay distinct — "New York Giants" and "New York
 * Jets" satisfy none of these against each other.
 */
function sameTeam(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  return nickname(a) === nickname(b);
}

/**
 * Pairs ESPN games with the pool's slate.
 *
 * The two feeds share no ids, so games are matched on team names (see `sameTeam`), and on both
 * sides at once — requiring the pairing to agree is what keeps two teams from the same city
 * apart. A game that matches nothing on the slate still shows; the banner is a scoreboard first.
 *
 * Pure and exported so the matching can be tested without touching the network.
 */
export function mergeLiveScores(
  espnGames: EspnGame[],
  poolGames: Game[],
  myPicks: Record<string, Side> = {},
): LiveRow[] {
  const rows: LiveRow[] = [];
  for (const event of espnGames) {
    const home = event.competitors.find((c) => c.homeAway === 'home');
    const away = event.competitors.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;

    // A slate is a dozen-odd games, so a scan beats maintaining an index of every spelling.
    const pool = poolGames.find(
      (g) => sameTeam(g.awayTeam, away.name) && sameTeam(g.homeTeam, home.name),
    );

    const row: LiveRow = {
      id: event.id,
      state: event.state,
      completed: event.completed,
      statusDetail: event.statusDetail,
      away,
      home,
    };

    if (pool) {
      row.poolGameId = pool.id;
      row.homeSpread = pool.homeSpread;
      row.myPick = myPicks[pool.id];
      // Settle against the live score. Before the whistle this reads as "who's covering if it
      // ends here", which is exactly what you want to see mid-game.
      row.covering = settleGame({
        ...pool,
        homeScore: home.score,
        awayScore: away.score,
        completed: true,
      });
    }

    rows.push(row);
  }

  // In progress first, then upcoming, then finals; within a group, by kickoff.
  const rank = (r: LiveRow) => (r.state === 'in' ? 0 : r.completed ? 2 : 1);
  const kickoff = (r: LiveRow) => espnGames.find((e) => e.id === r.id)?.date ?? '';
  return rows.sort((a, b) => rank(a) - rank(b) || kickoff(a).localeCompare(kickoff(b)));
}

@Injectable({ providedIn: 'root' })
export class EspnService {
  /** Games for a date range (YYYYMMDD or YYYYMMDD-YYYYMMDD); defaults to ESPN's current week. */
  async fetchScoreboard(dates?: string): Promise<EspnGame[]> {
    const url = dates ? `${SCOREBOARD}?dates=${dates}&limit=100` : `${SCOREBOARD}?limit=100`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const data = (await res.json()) as RawScoreboard;

    return (data.events ?? []).map((e) => ({
      id: e.id ?? '',
      date: e.date ?? '',
      state: e.status?.type?.state ?? 'pre',
      completed: !!e.status?.type?.completed,
      statusDetail: e.status?.type?.shortDetail ?? '',
      competitors: (e.competitions?.[0]?.competitors ?? []).map((c) => ({
        espnId: c.team?.id ?? '',
        name: c.team?.displayName ?? '',
        abbrev: c.team?.abbreviation ?? c.team?.shortDisplayName ?? '',
        logoUrl: c.team?.logo ?? c.team?.logos?.[0]?.href ?? '',
        score: Number(c.score ?? 0),
        homeAway: c.homeAway === 'home' ? ('home' as const) : ('away' as const),
        winner: !!c.winner,
      })),
    }));
  }
}
