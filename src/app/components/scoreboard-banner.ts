import { Component, DestroyRef, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { Side, spreadLabel } from '../models';
import { EspnService, LiveRow, mergeLiveScores } from '../services/espn.service';
import { AuthService } from '../services/auth.service';
import { EntryService } from '../services/entry.service';
import { PoolService } from '../services/pool.service';

/**
 * Live scoreboard strip under the nav. Polls ESPN's NFL scoreboard and, for games on the pool's
 * slate, shows which side is covering the number and marks the one the viewer took.
 *
 * Renders nothing when there are no games, so it stays out of the way in the off-week.
 */
@Component({
  selector: 'app-scoreboard-banner',
  template: `
    @if (rows().length) {
      <div class="sb" role="region" aria-label="Live scoreboard">
        <span class="sb-label">🏈 Scores</span>
        <div class="sb-track">
          @for (row of rows(); track row.id) {
            <div class="sb-game" [class.live]="row.state === 'in'" [class.mine]="!!row.myPick">
              <div class="sb-rows">
                @for (side of ['away', 'home']; track side) {
                  <div
                    class="sb-team"
                    [class.covering]="row.covering === side"
                    [class.picked]="row.myPick === side"
                  >
                    @if (team(row, side).logoUrl) {
                      <img class="sb-logo" [src]="team(row, side).logoUrl" alt="" />
                    }
                    <span class="sb-ab">{{ team(row, side).abbrev }}</span>
                    @if (row.homeSpread !== null && row.homeSpread !== undefined) {
                      <span class="sb-line">{{ line(row, side) }}</span>
                    }
                    <span class="sb-sc">{{ team(row, side).score }}</span>
                  </div>
                }
              </div>
              <span class="sb-status" [class.live]="row.state === 'in'">
                {{ row.statusDetail }}
                @if (row.covering === 'push') { <span class="sb-push">· push</span> }
              </span>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .sb {
      display: flex;
      align-items: stretch;
      background: #08182d;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      color: #e7eef7;
      min-height: 72px;
      /* Never let the strip widen the page — the board scrolls inside itself. */
      max-width: 100%;
      overflow: hidden;
    }
    .sb-label {
      display: flex;
      align-items: center;
      padding: 0 0.9rem;
      font-weight: 800;
      font-size: 0.8rem;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: #9fb1c9;
      background: rgba(0, 0, 0, 0.2);
      white-space: nowrap;
      flex: none;
    }
    .sb-track {
      display: flex;
      align-items: stretch;
      overflow-x: auto;
      /*
       * min-width:0 is what makes this scroll at all. A flex item defaults to min-width:auto,
       * which refuses to shrink below its content, so the track grew past the viewport and got
       * clipped instead of scrolling. flex:1 then hands it the space left by the label.
       */
      flex: 1;
      min-width: 0;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.35) transparent;
      overscroll-behavior-x: contain;
    }
    /* macOS hides overlay scrollbars until you scroll, so give the strip a standing one. */
    .sb-track::-webkit-scrollbar {
      height: 8px;
    }
    .sb-track::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.25);
    }
    .sb-track::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.28);
      border-radius: 4px;
    }
    .sb-track::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.45);
    }
    .sb-game {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0.2rem;
      padding: 0.7rem 0.95rem;
      border-right: 1px solid rgba(255, 255, 255, 0.07);
      min-width: 150px;
      flex: none;
    }
    .sb-game.live {
      background: rgba(200, 16, 46, 0.12);
    }
    /* A game the viewer has a stake in. */
    .sb-game.mine {
      box-shadow: inset 3px 0 0 var(--gold);
    }
    .sb-rows {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }
    .sb-team {
      display: grid;
      grid-template-columns: auto 2.6rem 2.8rem 1.6rem;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.85rem;
      color: #c4d0e0;
    }
    /* The side currently beating the number. */
    .sb-team.covering {
      color: #fff;
      font-weight: 700;
    }
    .sb-team.covering .sb-line {
      color: #6ee7a0;
    }
    .sb-team.picked .sb-ab::after {
      content: ' ●';
      color: var(--gold);
      font-size: 0.7em;
      vertical-align: middle;
    }
    .sb-logo {
      width: 18px;
      height: 18px;
      object-fit: contain;
    }
    .sb-ab {
      white-space: nowrap;
    }
    .sb-line {
      font-variant-numeric: tabular-nums;
      font-size: 0.75rem;
      color: #7e93ad;
      text-align: right;
    }
    .sb-sc {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .sb-status {
      font-size: 0.68rem;
      color: #8497ad;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      white-space: nowrap;
    }
    .sb-status.live {
      color: #ff6b81;
      font-weight: 700;
    }
    .sb-push {
      color: var(--gold);
    }
  `,
})
export class ScoreboardBannerComponent implements OnDestroy {
  private readonly espn = inject(EspnService);
  private readonly auth = inject(AuthService);
  private readonly pool = inject(PoolService);
  private readonly entries = inject(EntryService);

  /** Poll fast while a game is in progress, slow when everything is final or not yet started. */
  private static readonly LIVE_INTERVAL = 30_000;
  private static readonly IDLE_INTERVAL = 5 * 60_000;

  private readonly raw = signal<Awaited<ReturnType<EspnService['fetchScoreboard']>>>([]);
  private readonly myPicks = signal<Record<string, Side>>({});

  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsub: Unsubscribe | null = null;
  private watching = '';

  /** ESPN games joined to the pool's slate, capped so the strip stays tidy. */
  readonly rows = computed(() =>
    mergeLiveScores(this.raw(), this.pool.week()?.games ?? [], this.myPicks()).slice(0, 20),
  );

  constructor() {
    void this.tick();

    // Follow the signed-in user's own entry so their picks can be marked on the strip.
    effect(() => {
      const weekId = this.pool.week()?.id;
      const uid = this.auth.user()?.uid;
      if (!weekId || !uid) return;
      const key = `${weekId}/${uid}`;
      if (key === this.watching) return;
      this.watching = key;
      this.unsub?.();
      this.unsub = this.entries.watchEntry(weekId, uid, (entry) =>
        this.myPicks.set(entry?.picks ?? {}),
      );
    });

    inject(DestroyRef).onDestroy(() => this.ngOnDestroy());
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsub?.();
  }

  /** Refresh, then schedule the next poll based on whether anything is live. */
  private async tick(): Promise<void> {
    await this.refresh();
    const live = this.rows().some((r) => r.state === 'in');
    const delay = live
      ? ScoreboardBannerComponent.LIVE_INTERVAL
      : ScoreboardBannerComponent.IDLE_INTERVAL;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async refresh(): Promise<void> {
    try {
      this.raw.set(await this.espn.fetchScoreboard());
    } catch {
      // Leave the previous scores in place on a transient failure.
    }
  }

  // --- Template helpers ---

  protected team(row: LiveRow, side: string): LiveRow['home'] {
    return side === 'home' ? row.home : row.away;
  }

  protected line(row: LiveRow, side: string): string {
    return spreadLabel(row.homeSpread ?? null, side === 'home' ? 'home' : 'away');
  }
}
