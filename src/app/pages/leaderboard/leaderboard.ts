import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { isGridVisible } from '../../core/pool-window';
import { PicksGridComponent } from '../admin/picks-grid';
import { AuthService } from '../../services/auth.service';
import { LeaderboardService } from '../../services/leaderboard.service';
import { PoolService } from '../../services/pool.service';

type Tab = 'week' | 'season' | 'grid';

/** Weekly board (live, once the week locks) and cumulative season standings. */
@Component({
  selector: 'app-leaderboard',
  imports: [RouterLink, PicksGridComponent],
  templateUrl: './leaderboard.html',
  styleUrl: './leaderboard.css',
})
export class LeaderboardComponent {
  protected readonly auth = inject(AuthService);
  protected readonly pool = inject(PoolService);
  protected readonly board = inject(LeaderboardService);

  protected readonly tab = signal<Tab>('week');

  protected readonly rows = computed(() => this.board.weekly());

  /**
   * The full picks grid is public from the moment the week locks until midnight Eastern on the
   * following Wednesday — it goes up when there is nothing left to gain from seeing it, and comes
   * down as the next week's picks open on Thursday.
   */
  protected readonly showGrid = computed(() =>
    isGridVisible(this.pool.week()?.lockAt ?? 0, this.pool.isLocked(), this.pool.now()),
  );

  constructor() {
    // Cards are public, so listen as soon as a week is active.
    effect(() => {
      if (this.pool.week()) this.board.start();
    });

    // Don't strand anyone on the grid when its window closes mid-visit.
    effect(() => {
      if (!this.showGrid() && this.tab() === 'grid') this.tab.set('week');
    });
  }

  protected async showSeason(): Promise<void> {
    this.tab.set('season');
    if (!this.board.seasonRows().length) await this.board.loadSeason();
  }

  protected winPct(wins: number, losses: number): string {
    if (wins + losses === 0) return '—';
    return (wins / (wins + losses)).toFixed(3).replace(/^0/, '');
  }
}
