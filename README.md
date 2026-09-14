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

3. **Get an odds API key** from [the-odds-api.com](https://the-odds-api.com) — used for **lines
   only** (scores come from ESPN), which is about 90 requests a month, well inside the free tier.
   Store it as a secret; it must never go in `environment.ts`, which ships to every browser:

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
npm test                   # scoring + live-score matching tests
npm run build

npm --prefix functions test   # odds/ESPN helpers, team matching
```

For the Functions emulator, put the key in `functions/.secret.local` (gitignored):

```
ODDS_API_KEY=your-key
```

## How the automation works

Two scheduled Cloud Functions (`functions/src/index.ts`) do the weekly chores:

- **`syncLinesScheduled`** (6am / noon / 6pm ET) pulls the Sunday slate and its spreads from The
  Odds API into the active week. It refuses to run once the week is locked or the deadline has
  passed, so the number you were graded against can never move after you picked. Individual games
  can be pinned in Admin (`lineLocked`) to hold a specific number, and hand-added games survive
  the sync.
- **`syncScoresScheduled`** (every 10 minutes, 1–11pm ET **on Sundays**) pulls scores from ESPN,
  flips an open week to `locked` once the deadline passes, and marks the week `final` when every
  game is done. `syncScoresSweep` repeats it Monday at 8am to catch a game that ran past midnight.

Scores come from **ESPN**, not the odds feed: it is free and unmetered, so the whole odds-API quota
goes to the thing only a book can tell us — the number. It is also the same feed the scoreboard
banner polls, so the banner and the standings cannot disagree about a final.

The two feeds share no game ids, so fixtures are matched on team names, requiring *both* sides to
agree — that is what keeps the Giants and the Jets apart. Verified against a real 13-game Sunday
slate: all 13 matched. See `functions/src/espn.ts` and its tests.

Both have manual HTTP twins (`syncLinesNow`, `syncScoresNow`) wired to the Admin page's sync
buttons. These are public URLs, so each verifies a Firebase ID token and requires the caller's
email to be on the same `config/app.adminEmails` list the Firestore rules consult — admin access is
defined in exactly one place. An unauthenticated request is rejected before any odds quota is
spent.

Spreads are taken from the first available book in a priority list (DraftKings, FanDuel, BetMGM, …)
rather than an average — a pool wants one book's actual number, not a synthetic one.

## The live scoreboard banner

A strip under the nav polls **ESPN's public NFL scoreboard** (no key, CORS-open, so the browser
calls it directly) every 30 seconds while a game is in progress and every 5 minutes otherwise.

Because this is a spread pool, the banner does more than show scores: each game on the slate is
joined to its stored line, the covering side is highlighted with its number, and a gold dot marks
the side you took. Mid-game that reads as "who's covering if it ends right here", which is the
thing you actually want on a Sunday afternoon.

ESPN and the Odds API share no game ids, so games are matched on team names — full name, then a
substring or nickname match to catch a game an admin typed in by hand. Matching requires *both*
sides to agree, which keeps the Giants and the Jets apart. A game that matches nothing still shows,
just without a line. See `mergeLiveScores` in `src/app/services/espn.service.ts` and its tests.

The banner reads ESPN directly for snappy updates, while `syncScores` writes the same feed's
numbers into Firestore on its own schedule — so the banner can move a minute or two ahead of the
leaderboard, but the two can never disagree about what actually happened.

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
  services/                auth, pool (config + active week), entries, leaderboard, ESPN live scores
  components/              lock-clock deadline strip, live scoreboard banner
  guards/auth.guard.ts     authGuard / adminGuard
  pages/                   landing, auth, picks, leaderboard, admin
functions/
  src/odds.ts              The Odds API client, Eastern-time date helpers
  src/index.ts             scheduled + manual sync
firestore.rules            who can read and write what, and when
```
