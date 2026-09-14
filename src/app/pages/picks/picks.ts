import { Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Unsubscribe } from 'firebase/firestore';
import { Entry, Game, PickStatus, Side, emptyEntry, spreadLabel } from '../../models';
import { scoreEntry, settleGame } from '../../scoring/scoring';
import { AuthService } from '../../services/auth.service';
import { EntryService } from '../../services/entry.service';
import { PoolService } from '../../services/pool.service';

/**
 * The card: every Sunday game on the slate with its line, one side selectable per game.
 *
 * Routed twice — `/picks` for your own entry (editable until lock) and `/picks/:uid` for reading
 * someone else's after the week locks. `uid` comes in via `withComponentInputBinding`.
 */
@Component({
  selector: 'app-picks',
  imports: [FormsModule],
  templateUrl: './picks.html',
  styleUrl: './picks.css',
})
export class PicksComponent implements OnDestroy {
  /** Route param; absent when viewing your own entry. */
  readonly uid = input<string>();

  protected readonly auth = inject(AuthService);
  protected readonly pool = inject(PoolService);
  private readonly entries = inject(EntryService);

  /** The entry being displayed, as loaded from Firestore. */
  protected readonly saved = signal<Entry | null>(null);
  /** Local, unsaved pick state. Diverges from `saved` while the user is clicking around. */
  protected readonly draft = signal<Record<string, Side>>({});
  protected readonly tiebreaker = signal<number | null>(null);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly savedAt = signal<number | null>(null);

  private unsub: Unsubscribe | null = null;
  private watching = '';
  /** False until the first snapshot for the current week/user has populated the draft. */
  private hydrated = false;

  /** Whose entry this is; falls back to the signed-in user. */
  protected readonly targetUid = computed(() => this.uid() ?? this.auth.user()?.uid ?? '');
  protected readonly isOwn = computed(() => this.targetUid() === this.auth.user()?.uid);
  /** Editable only when it's your own card and the week is still open. */
  protected readonly canEdit = computed(() => this.isOwn() && !this.pool.isLocked());

  protected readonly games = computed(() => this.pool.week()?.games ?? []);
  protected readonly pickedCount = computed(
    () => this.games().filter((g) => this.draft()[g.id]).length,
  );
  protected readonly complete = computed(
    () => this.games().length > 0 && this.pickedCount() === this.games().length,
  );

  /** True when the local draft differs from what's stored. */
  protected readonly dirty = computed(() => {
    const saved = this.saved();
    const draft = this.draft();
    const savedPicks = saved?.picks ?? {};
    const keys = new Set([...Object.keys(savedPicks), ...Object.keys(draft)]);
    for (const k of keys) if (savedPicks[k] !== draft[k]) return true;
    return (saved?.tiebreaker ?? null) !== this.tiebreaker();
  });

  /** Running record, meaningful only once games start going final. */
  protected readonly score = computed(() => {
    const week = this.pool.week();
    const entry = this.saved();
    return week && entry ? scoreEntry(week, entry) : null;
  });

  constructor() {
    // Re-subscribe whenever the active week or the viewed user changes.
    effect(() => {
      const weekId = this.pool.week()?.id;
      const uid = this.targetUid();
      if (!weekId || !uid) return;
      const key = `${weekId}/${uid}`;
      if (key === this.watching) return;
      this.watching = key;
      this.hydrated = false;
      this.loading.set(true);
      this.unsub?.();
      this.unsub = this.entries.watchEntry(weekId, uid, (entry) => {
        this.saved.set(entry);
        // Seed the draft from the first snapshot; after that, only adopt remote changes when the
        // user has nothing in flight, so an echo of our own write can't clobber live edits.
        if (!this.hydrated || !this.dirty()) {
          this.draft.set({ ...(entry?.picks ?? {}) });
          this.tiebreaker.set(entry?.tiebreaker ?? null);
        }
        this.hydrated = true;
        this.loading.set(false);
      });
    });
  }

  ngOnDestroy(): void {
    this.unsub?.();
  }

  protected pick(game: Game, side: Side): void {
    if (!this.canEdit() || game.homeSpread == null) return;
    this.draft.update((picks) => {
      const next = { ...picks };
      // Clicking the side you already have selected clears it.
      if (next[game.id] === side) delete next[game.id];
      else next[game.id] = side;
      return next;
    });
  }

  protected async save(): Promise<void> {
    const weekId = this.pool.week()?.id;
    const user = this.auth.user();
    if (!weekId || !user || !this.canEdit()) return;

    this.error.set('');
    this.saving.set(true);
    try {
      const base = this.saved() ?? emptyEntry(user.uid, this.auth.displayName());
      await this.entries.saveEntry(weekId, {
        ...base,
        uid: user.uid,
        displayName: this.auth.displayName(),
        picks: this.draft(),
        tiebreaker: this.tiebreaker(),
      });
      this.savedAt.set(Date.now());
    } catch (e) {
      this.error.set(
        (e as Error).message.includes('permission')
          ? 'Picks are locked — the first game has kicked off.'
          : 'Could not save your picks. Please try again.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected revert(): void {
    const entry = this.saved();
    this.draft.set({ ...(entry?.picks ?? {}) });
    this.tiebreaker.set(entry?.tiebreaker ?? null);
  }

  // --- Template helpers ---

  protected spread(game: Game, side: Side): string {
    return spreadLabel(game.homeSpread, side);
  }

  /** Whether a side is the one the viewer selected. */
  protected selected(game: Game, side: Side): boolean {
    return this.draft()[game.id] === side;
  }

  /** How this game settled, for shading the board after the fact. */
  protected cover(game: Game): Side | 'push' | null {
    return settleGame(game);
  }

  /** Status of the *saved* pick on this game — what actually counts. */
  protected status(game: Game): PickStatus {
    const side = this.saved()?.picks[game.id];
    if (!side) return 'none';
    const cover = this.cover(game);
    if (cover === null) return 'pending';
    if (cover === 'push') return 'push';
    return cover === side ? 'win' : 'loss';
  }

  protected kickoffLabel(game: Game): string {
    return new Date(game.kickoff).toLocaleTimeString([], {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  /** The game whose total settles ties: the latest kickoff on the slate. */
  protected readonly tiebreakerGame = computed<Game | null>(() => {
    const games = this.games();
    return games.length ? [...games].sort((a, b) => b.kickoff - a.kickoff)[0] : null;
  });
}
