import { Injectable, computed, inject, signal } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { Entry, SeasonRow, WeekScore } from '../models';
import { rankWeek, scoreEntry, seasonStandings, tiebreakerTotal } from '../scoring/scoring';
import { EntryService } from './entry.service';
import { PoolService } from './pool.service';

/**
 * Live weekly leaderboard plus on-demand season standings.
 *
 * The weekly board is a listener, so rows re-rank as scores go final. The season table is a
 * one-shot read across every week — it changes slowly and would otherwise mean a listener per
 * week.
 */
@Injectable({ providedIn: 'root' })
export class LeaderboardService {
  private readonly pool = inject(PoolService);
  private readonly entries = inject(EntryService);

  private readonly weekEntries = signal<Entry[]>([]);
  private unsub: Unsubscribe | null = null;
  private watchedWeekId: string | null = null;

  /** Scored and ranked rows for the active week. Empty until the week locks. */
  readonly weekly = computed<WeekScore[]>(() => {
    const week = this.pool.week();
    if (!week) return [];
    const scores = this.weekEntries().map((e) => scoreEntry(week, e));
    return rankWeek(scores, tiebreakerTotal(week));
  });

  readonly seasonRows = signal<SeasonRow[]>([]);
  readonly seasonLoading = signal(false);

  /**
   * Begin listening to the active week's entries. Only runs once picks are locked: before lock,
   * security rules hide other players' entries and there is nothing to score anyway.
   */
  start(): void {
    if (!this.pool.isLocked()) return;
    const id = this.pool.week()?.id;
    if (!id || id === this.watchedWeekId) return;
    this.unsub?.();
    this.watchedWeekId = id;
    this.entries.listEntries(id).catch(() => {});
    this.unsub = this.entries.watchAllEntries(id, (entries) => this.weekEntries.set(entries));
  }

  /** Recomputes season standings from every locked week. */
  async loadSeason(): Promise<void> {
    this.seasonLoading.set(true);
    try {
      const weeks = (await this.pool.listWeeks()).filter(
        (w) => w.status === 'locked' || w.status === 'final',
      );
      const scored = await Promise.all(
        weeks.map(async (w) => {
          const entries = await this.entries.listEntries(w.id);
          return entries.map((e) => scoreEntry(w, e));
        }),
      );
      this.seasonRows.set(seasonStandings(scored));
    } finally {
      this.seasonLoading.set(false);
    }
  }
}
