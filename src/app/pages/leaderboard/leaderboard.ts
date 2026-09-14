import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { tiebreakerTotal } from '../../scoring/scoring';
import { AuthService } from '../../services/auth.service';
import { LeaderboardService } from '../../services/leaderboard.service';
import { PoolService } from '../../services/pool.service';

type Tab = 'week' | 'season';

/** Weekly board (live, once the week locks) and cumulative season standings. */
@Component({
  selector: 'app-leaderboard',
  imports: [RouterLink],
  templateUrl: './leaderboard.html',
  styleUrl: './leaderboard.css',
})
export class LeaderboardComponent {
  protected readonly auth = inject(AuthService);
  protected readonly pool = inject(PoolService);
  protected readonly board = inject(LeaderboardService);

  protected readonly tab = signal<Tab>('week');

  protected readonly rows = computed(() => this.board.weekly());
  /** The tiebreaker target, shown as a column header once the late game is final. */
  protected readonly actualTotal = computed(() => {
    const week = this.pool.week();
    return week ? tiebreakerTotal(week) : null;
  });

  constructor() {
    // Cards are public, so listen as soon as a week is active.
    effect(() => {
      if (this.pool.week()) this.board.start();
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
