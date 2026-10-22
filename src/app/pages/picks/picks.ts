import { Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Unsubscribe } from 'firebase/firestore';
import { Entry, Game, PickStatus, Side, Week, emptyEntry, spreadLabel } from '../../models';
import { scoreEntry, settleGame } from '../../scoring/scoring';
import { AuthService } from '../../services/auth.service';
import { EntryService } from '../../services/entry.service';
import { PoolService } from '../../services/pool.service';

/**
 * The card: every Sunday game on the slate with its line, one side selectable per game.
 *
 * Routed twice — `/picks` for your own entry (editable until lock) and `/picks/:uid` for reading
 * someone else's after the week locks. `uid` comes in via `withComponentInputBinding`.
 *
 * Always opens on the pool's active week. A dropdown switches to any past (locked or final) week
 * to review how that card settled; past weeks are read-only.
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

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly savedAt = signal<number | null>(null);

  /** The week picked in the dropdown; null means the active week, which is where the page opens. */
  protected readonly selectedWeekId = signal<string | null>(null);
  /** The past week being viewed, read once — only the active week still receives score updates. */
  private readonly pastWeek = signal<Week | null>(null);
  /** Past weeks available in the dropdown, newest first. */
  private readonly settledWeeks = signal<Week[]>([]);

  /** True when showing the active week rather than a past one. */
  protected readonly isCurrentWeek = computed(() => {
    const id = this.selectedWeekId();
    return !id || id === this.pool.week()?.id;
  });

  /** The week on screen: the live active week, or the past week chosen in the dropdown. */
  protected readonly week = computed<Week | null>(() =>
    this.isCurrentWeek() ? this.pool.week() : this.pastWeek(),
  );

  /** Dropdown entries: the active week plus every settled week, newest first. */
  protected readonly weekOptions = computed(() => {
    const byId = new Map<string, Week>();
    for (const w of this.settledWeeks()) byId.set(w.id, w);
    const active = this.pool.week();
    if (active) byId.set(active.id, active);
    return [...byId.values()]
      .sort((a, b) => b.season - a.season || b.week - a.week)
      .map((w) => ({
        id: w.id,
        label: `Week ${w.week}` + (w.id === active?.id ? ' (current)' : ''),
      }));
  });

  private unsub: Unsubscribe | null = null;
  private watching = '';
  /** False until the first snapshot for the current week/user has populated the draft. */
  private hydrated = false;

  /** Whose entry this is; falls back to the signed-in user. */
  protected readonly targetUid = computed(() => this.uid() ?? this.auth.user()?.uid ?? '');
  protected readonly isOwn = computed(() => this.targetUid() === this.auth.user()?.uid);
  /** Editable only when it's your own card and the week is still open. */
  protected readonly canEdit = computed(
    () => this.isOwn() && this.isCurrentWeek() && !this.pool.isLocked(),
  );

  protected readonly games = computed(() => this.week()?.games ?? []);
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
    return [...keys].some((k) => savedPicks[k] !== draft[k]);
  });

  /** Running record, meaningful only once games start going final. */
  protected readonly score = computed(() => {
    const week = this.week();
    const entry = this.saved();
    return week && entry ? scoreEntry(week, entry) : null;
  });

  constructor() {
    // Past weeks for the dropdown. A failure just leaves the dropdown showing the current week.
    this.pool
      .listSettledWeeks()
      .then((weeks) => this.settledWeeks.set(weeks))
      .catch(() => {});

    // Re-subscribe whenever the viewed week or the viewed user changes.
    effect(() => {
      const weekId = this.week()?.id;
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

  /** Switches the card to another week; the active week goes back to following the live listener. */
  protected async selectWeek(id: string): Promise<void> {
    if (this.dirty()) return;
    const current = !id || id === this.pool.week()?.id;
    this.selectedWeekId.set(current ? null : id);
    if (current) return;
    this.pastWeek.set(this.settledWeeks().find((w) => w.id === id) ?? null);
    try {
      // Re-read so a score an admin corrected after the fact shows up.
      const fresh = await this.pool.getWeek(id);
      if (this.selectedWeekId() === id && fresh) this.pastWeek.set(fresh);
    } catch {
      // Keep the copy from the dropdown list.
    }
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

  /**
   * How this side settled, but only for the side the player actually took — the losing side of a
   * game they picked correctly should stay neutral rather than being painted red.
   */
  protected result(game: Game, side: Side): PickStatus | null {
    if (this.saved()?.picks?.[game.id] !== side) return null;
    return this.status(game);
  }

  /** Status of the *saved* pick on this game — what actually counts. */
  protected status(game: Game): PickStatus {
    const side = this.saved()?.picks?.[game.id];
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
}
