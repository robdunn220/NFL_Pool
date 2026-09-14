import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  OddsEvent,
  abbreviate,
  easternDate,
  easternDay,
  fetchOdds,
  homeSpreadOf,
  nextSundayDate,
} from './odds';
import { fetchScoreboard, findGame, scoresOf, toEspnDate } from './espn';

initializeApp();
const db = getFirestore();

/** Set with: firebase functions:secrets:set ODDS_API_KEY. Lines only — scores come from ESPN. */
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
 * Pulls scores for the active week from ESPN and settles the week when the slate is done.
 *
 * ESPN rather than the odds feed: it is free and unmetered, so the odds-API quota is spent
 * entirely on lines, and the scoreboard banner reads the same source — the banner and the
 * standings can no longer disagree about a final.
 *
 * The two feeds share no game ids, so fixtures are matched on team names (see `findGame`).
 * Also flips an open week to `locked` once the deadline passes, so the season standings and the
 * leaderboard's "everyone's card is visible now" behaviour key off a single stored status.
 */
async function syncScores(): Promise<string> {
  const week = await loadActiveWeek();
  if (!week) return 'No active week configured.';
  if (!week.games.length) return `Skipped ${week.id}: no games on the slate.`;

  // Ask for the week's own Sunday rather than ESPN's idea of the current week, so a late sweep on
  // Monday still reads the right slate.
  const espnGames = await fetchScoreboard(week.sundayDate ? toEspnDate(week.sundayDate) : undefined);

  let matched = 0;
  const games = week.games.map((game) => {
    const event = findGame(espnGames, game.awayTeam, game.homeTeam);
    if (!event) return game;
    matched++;
    const scores = scoresOf(event);
    if (!scores) return { ...game, completed: event.completed };
    return { ...game, ...scores, completed: event.completed };
  });

  const allDone = games.every((g) => g.completed);
  const deadlinePassed = !!week.lockAt && Date.now() >= week.lockAt;
  const status = allDone ? 'final' : deadlinePassed && week.status === 'open' ? 'locked' : week.status;

  await db.doc(`weeks/${week.id}`).set({ games, status, updatedAt: Date.now() }, { merge: true });

  const done = games.filter((g) => g.completed).length;
  const unmatched = games.length - matched;
  return (
    `Scored ${week.id}: ${done}/${games.length} final, status "${status}"` +
    (unmatched ? `, ${unmatched} not found on ESPN's board.` : '.')
  );
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

// Sunday afternoon and evening only — that is the whole slate, and polling a weekday would just
// re-read finals. No secret needed: ESPN's scoreboard is public.
export const syncScoresScheduled = onSchedule(
  { schedule: '*/10 13-23 * * 0', timeZone: 'America/New_York', region: REGION },
  async () => {
    logger.info(await syncScores());
  },
);

// Monday morning catch-up, for a game that ran past midnight or was still marked in-progress when
// the Sunday window closed.
export const syncScoresSweep = onSchedule(
  { schedule: '0 8 * * 1', timeZone: 'America/New_York', region: REGION },
  async () => {
    logger.info(await syncScores());
  },
);

// --- Manual triggers, used by the Admin page's sync buttons ---

/**
 * Verifies the caller is a pool admin.
 *
 * These endpoints are public URLs, so without a check anyone who learns one could drain the odds
 * quota or rewrite a week's scores. The caller sends a Firebase ID token; we verify it and require
 * the email to be on the same `config/app.adminEmails` list the Firestore rules consult, so admin
 * access is defined in exactly one place.
 *
 * Returns null when authorized, or the HTTP status and message to reject with.
 */
async function requireAdmin(
  authorization: string | undefined,
): Promise<{ status: number; error: string } | null> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (!token) return { status: 401, error: 'Sign in as an admin to run a sync.' };

  let email: string | undefined;
  try {
    email = (await getAuth().verifyIdToken(token)).email;
  } catch {
    return { status: 401, error: 'Your session has expired. Sign in again.' };
  }

  const admins = (await db.doc('config/app').get()).data()?.['adminEmails'] as string[] | undefined;
  const allowed = (admins ?? []).map((e) => e.toLowerCase());
  if (!email || !allowed.includes(email.toLowerCase())) {
    return { status: 403, error: 'That account is not a pool admin.' };
  }
  return null;
}

export const syncLinesNow = onRequest(
  { region: REGION, secrets: [ODDS_API_KEY], cors: true },
  async (req, res) => {
    const denied = await requireAdmin(req.headers.authorization);
    if (denied) {
      res.status(denied.status).json({ ok: false, error: denied.error });
      return;
    }
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
  { region: REGION, cors: true },
  async (req, res) => {
    const denied = await requireAdmin(req.headers.authorization);
    if (denied) {
      res.status(denied.status).json({ ok: false, error: denied.error });
      return;
    }
    try {
      const status = await syncScores();
      logger.info(status);
      res.json({ ok: true, status });
    } catch (e) {
      logger.error(e);
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  },
);
