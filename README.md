# Sunday NFL Pool

A weekly against-the-spread pool for Sunday NFL games. Each player gets **one entry per week** and
picks **every Sunday game** against the line. Most covers wins the week; season standings
accumulate across weeks.

Stack: Angular 22 (standalone, signals) · Firebase Auth · Firestore · Cloud Functions ·
Firebase Hosting — the same shape as `NCAA_Tourney_Pub28`.

## The rule that matters

You are picking the **line**, not the winner. Steelers −3.5 over the Cardinals means Pittsburgh has
to win by 4 or more. A one-point Steelers win is a loss on your card — the Cardinals covered.

Internally every game stores `homeSpread`, the number added to the home team's final score:

```
adjusted = homeScore - awayScore + homeSpread
adjusted > 0 -> home covered
adjusted < 0 -> away covered
adjusted = 0 -> push (nobody gets the point, nobody takes the loss)
```

A road favorite is just a positive `homeSpread`. Half-point lines can never push, which is why most
pools hang them there. See `src/app/scoring/scoring.ts` and its tests.

## Data model

| Path | Contents |
| --- | --- |
| `config/app` | `{ adminEmails, season, activeWeekId }` — the one document the security rules consult |
| `users/{uid}` | display name and email |
| `weeks/{season}-{NN}` | `{ season, week, status, lockAt, sundayDate, games[] }` |
| `weeks/{id}/entries/{uid}` | `{ picks: { gameId: 'home' \| 'away' }, tiebreaker }` |

Entries are keyed by `uid`. That is what enforces one entry per player per week — a "second entry"
is just an edit of the first, and only until the deadline.

A week moves `draft → open → locked → final`. Picks are writable only while a week is `open` and
`lockAt` (the first Sunday kickoff) is still in the future; the security rules enforce this
server-side, so a stale browser tab can't sneak a pick in after kickoff. Once locked, every
player's card becomes readable and the leaderboard scores itself live.

## Setup

1. **Create a Firebase project**, then enable **Authentication → Email/Password** and
   **Firestore** (production mode).

2. **Fill in `src/environments/environment.ts`** — the web config from
   Project settings → General → Your apps, plus your `adminEmails` and the Cloud Functions base
   URL (`https://us-central1-<project-id>.cloudfunctions.net`).

3. **Get an odds API key** from [the-odds-api.com](https://the-odds-api.com) (the free tier covers
   a weekly pool comfortably) and store it as a secret:

   ```sh
   firebase functions:secrets:set ODDS_API_KEY
   ```

4. **Install and deploy:**

   ```sh
   npm install
   npm --prefix functions install
   firebase use --add            # select your project
   firebase deploy               # rules, functions, and hosting
   ```

5. **Bootstrap the pool.** Sign in with an admin email, open **Admin**, and click
   *Initialize config*. Then create a week, hit *Sync lines now*, and flip its status to `open`.

## Running locally

```sh
npm start                  # http://localhost:4200
npm test                   # scoring unit tests
npm run build
```

## How the automation works

Two scheduled Cloud Functions (`functions/src/index.ts`) do the weekly chores:

- **`syncLinesScheduled`** (6am / noon / 6pm ET) pulls the Sunday slate and its spreads from The
  Odds API into the active week. It refuses to run once the week is locked or the deadline has
  passed, so the number you were graded against can never move after you picked. Individual games
  can be pinned in Admin (`lineLocked`) to hold a specific number, and hand-added games survive
  the sync.
- **`syncScoresScheduled`** (every 10 minutes, noon–midnight ET) pulls final scores, flips an open
  week to `locked` once the deadline passes, and marks the week `final` when every game is done.

Both have manual HTTP twins (`syncLinesNow`, `syncScoresNow`) wired to the Admin page's sync
buttons.

Spreads are taken from the first available book in a priority list (DraftKings, FanDuel, BetMGM, …)
rather than an average — a pool wants one book's actual number, not a synthetic one.

## Admin overrides

The feed gets things wrong: a postponement, a line a book moved off after capture, a score that
never finalizes. The Admin page edits the active week directly — add or delete games, set kickoff,
correct a spread, enter scores by hand, move the deadline, and change status. Everything there is
gated by the `adminEmails` list in `config/app`, both in the UI and in the Firestore rules.

## Layout

```
src/app/
  core/firebase.ts         lazily-initialized Firebase singletons
  models/                  Week / Game / Entry / score shapes
  scoring/scoring.ts       pure ATS scoring engine (+ scoring.spec.ts)
  services/                auth, pool (config + active week), entries, leaderboard
  guards/auth.guard.ts     authGuard / adminGuard
  pages/                   landing, auth, picks, leaderboard, admin
functions/
  src/odds.ts              The Odds API client, Eastern-time date helpers
  src/index.ts             scheduled + manual sync
firestore.rules            who can read and write what, and when
```
