import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  OddsEvent,
  abbreviate,
  easternDate,
  easternDay,
  fetchOdds,
  fetchScores,
  homeSpreadOf,
  nextSundayDate,
} from './odds';

initializeApp();
const db = getFirestore();

/** Set with: firebase functions:secrets:set ODDS_API_KEY */
const ODDS_API_KEY = defineSecret('ODDS_API_KEY');

const REGION = 'us-central1';

/** Mirrors src/app/models/week.model.ts. Kept local because functions is a separate package. */
interface Game {
  id: string;
  kickoff: number;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string;
  awayAbbr: string;
  homeSpread: number | null;
  lineCapturedAt?: number;
  lineLocked?: boolean;
  homeScore?: number;
  awayScore?: number;
  completed?: boolean;
}

interface Week {
  id: string;
  season: number;
  week: number;
  status: 'draft' | 'open' | 'locked' | 'final';
  lockAt: number;
  sundayDate?: string;
  games: Game[];
}

/** Reads config/app and the week it points at. */
async function loadActiveWeek(): Promise<Week | null> {
  const cfg = (await db.doc('config/app').get()).data();
  const id = cfg?.['activeWeekId'];
  if (!id) return null;
  const snap = await db.doc(`weeks/${id}`).get();
  return snap.exists ? ({ ...(snap.data() as Week), id }) : null;
}

function toGame(event: OddsEvent): Game {
  return {
    id: event.id,
    kickoff: new Date(event.commence_time).getTime(),
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    homeAbbr: abbreviate(event.home_team),
    awayAbbr: abbreviate(event.away_team),
    homeSpread: homeSpreadOf(event),
    lineCapturedAt: Date.now(),
  };
}

/**
 * Pulls the week's Sunday slate and its spreads.
 *
 * Runs only while the week is still draft or open — once picks lock, the line the pool is graded
 * on is settled and must not move underneath anyone. Individual games flagged `lineLocked` are
 * left alone too, which is how an admin pins a number the book later moved off.
 *
 * Scores and completion already on a game are preserved; this function owns lines only.
 */
async function syncLines(apiKey: string): Promise<string> {
  const week = await loadActiveWeek();
  if (!week) return 'No active week configured.';
  if (week.status === 'locked' || week.status === 'final') {
    return `Skipped ${week.id}: status is "${week.status}" — lines are final.`;
  }
  if (week.lockAt && Date.now() >= week.lockAt) {
    return `Skipped ${week.id}: the pick deadline has passed.`;
  }

  const sunday = week.sundayDate || nextSundayDate();
  const events = (await fetchOdds(apiKey)).filter(
    (e) => easternDay(e.commence_time) === 0 && easternDate(e.commence_time) === sunday,
  );

  const existing = new Map(week.games.map((g) => [g.id, g]));
  const games: Game[] = events
    .map((event) => {
      const fresh = toGame(event);
      const prior = existing.get(event.id);
      if (!prior) return fresh;
      // Preserve scores, and the line itself when an admin has pinned it.
      return {
        ...fresh,
        homeSpread: prior.lineLocked ? prior.homeSpread : fresh.homeSpread,
        lineCapturedAt: prior.lineLocked ? prior.lineCapturedAt : fresh.lineCapturedAt,
        lineLocked: prior.lineLocked,
        homeScore: prior.homeScore,
        awayScore: prior.awayScore,
        completed: prior.completed,
      };
    })
    .sort((a, b) => a.kickoff - b.kickoff);

  // Hand-added games the feed doesn't know about (a postponement, say) survive the sync.
  const feedIds = new Set(games.map((g) => g.id));
  const manual = week.games.filter((g) => !feedIds.has(g.id) && g.id.startsWith('manual-'));
  const merged = [...games, ...manual].sort((a, b) => a.kickoff - b.kickoff);

  const lockAt = merged.length ? Math.min(...merged.map((g) => g.kickoff)) : week.lockAt;
  await db.doc(`weeks/${week.id}`).set(
    { games: merged, sundayDate: sunday, lockAt, updatedAt: Date.now() },
    { merge: true },
  );

  const priced = merged.filter((g) => g.homeSpread !== null).length;
  return `Synced ${week.id}: ${merged.length} Sunday games (${sunday}), ${priced} with a line.`;
}

/**
 * Pulls final scores for the active week and settles the week when the slate is done.
 *
 * Also flips an open week to `locked` once the deadline passes, so the season standings and the
 * leaderboard's "everyone's card is visible now" behaviour key off a single stored status.
 */
async function syncScores(apiKey: string): Promise<string> {
  const week = await loadActiveWeek();
  if (!week) return 'No active week configured.';
  if (!week.games.length) return `Skipped ${week.id}: no games on the slate.`;

  const events = await fetchScores(apiKey);
  const byId = new Map(events.map((e) => [e.id, e]));

  const games = week.games.map((game) => {
    const event = byId.get(game.id);
    if (!event) return game;
    const home = event.scores?.find((s) => s.name === event.home_team)?.score;
    const away = event.scores?.find((s) => s.name === event.away_team)?.score;
    if (home == null || away == null) return { ...game, completed: !!event.completed };
    return {
      ...game,
      homeScore: Number(home),
      awayScore: Number(away),
      completed: !!event.completed,
    };
  });

  const allDone = games.every((g) => g.completed);
  const deadlinePassed = !!week.lockAt && Date.now() >= week.lockAt;
  const status = allDone ? 'final' : deadlinePassed && week.status === 'open' ? 'locked' : week.status;

  await db.doc(`weeks/${week.id}`).set({ games, status, updatedAt: Date.now() }, { merge: true });

  const done = games.filter((g) => g.completed).length;
  return `Scored ${week.id}: ${done}/${games.length} final, status "${status}".`;
}

// --- Schedules ---

// Lines move all week; refresh them a few times a day right up to the deadline.
export const syncLinesScheduled = onSchedule(
  {
    schedule: '0 6,12,18 * * *',
    timeZone: 'America/New_York',
    region: REGION,
    secrets: [ODDS_API_KEY],
  },
  async () => {
    logger.info(await syncLines(ODDS_API_KEY.value()));
  },
);

// Sunday afternoon and evening, poll often enough that the board feels live.
export const syncScoresScheduled = onSchedule(
  {
    schedule: 'every 10 minutes from 12:00 to 23:59',
    timeZone: 'America/New_York',
    region: REGION,
    secrets: [ODDS_API_KEY],
  },
  async () => {
    logger.info(await syncScores(ODDS_API_KEY.value()));
  },
);

// --- Manual triggers, used by the Admin page's sync buttons ---

export const syncLinesNow = onRequest(
  { region: REGION, secrets: [ODDS_API_KEY], cors: true },
  async (_req, res) => {
    try {
      const status = await syncLines(ODDS_API_KEY.value());
      logger.info(status);
      res.json({ ok: true, status });
    } catch (e) {
      logger.error(e);
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  },
);

export const syncScoresNow = onRequest(
  { region: REGION, secrets: [ODDS_API_KEY], cors: true },
  async (_req, res) => {
    try {
      const status = await syncScores(ODDS_API_KEY.value());
      logger.info(status);
      res.json({ ok: true, status });
    } catch (e) {
      logger.error(e);
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  },
);
