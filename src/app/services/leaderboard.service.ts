import { Injectable, computed, inject, signal } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { Entry, SeasonRow, WeekScore } from '../models';
import { rankWeek, scoreEntry, seasonStandings } from '../scoring/scoring';
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

  /** Scored and ranked rows for the active week. Populated as soon as anyone has entered. */
  readonly weekly = computed<WeekScore[]>(() => {
    const week = this.pool.week();
    if (!week) return [];
    const scores = this.weekEntries().map((e) => scoreEntry(week, e));
    return rankWeek(scores);
  });

  readonly seasonRows = signal<SeasonRow[]>([]);
  readonly seasonLoading = signal(false);

  /**
   * Begin listening to the active week's entries.
   *
   * Cards are public in this pool, so this runs from the moment a week is active rather than
   * waiting for lock — before kickoff the board shows who is in and what they took, and it turns
   * into a live scoreboard on its own as games go final.
   */
  start(): void {
    const id = this.pool.week()?.id;
    if (!id || id === this.watchedWeekId) return;
    this.unsub?.();
    this.watchedWeekId = id;
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
