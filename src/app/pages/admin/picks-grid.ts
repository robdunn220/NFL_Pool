import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Unsubscribe } from 'firebase/firestore';
import { teamAbbr } from '../../core/nfl-teams';
import { Entry, Game, PickStatus, Side, Week, spreadLabel } from '../../models';
import { rankWeek, scoreEntry, settleGame } from '../../scoring/scoring';
import { EntryService } from '../../services/entry.service';
import { PoolService } from '../../services/pool.service';

/**
 * Every entry in one week as a grid: players down the side, games across the top, each cell the
 * side that player took.
 *
 * This is the view for settling an argument — you can see the whole room's card against one game
 * at a glance, which the per-player picks page can't show. Live while games are on, and the same
 * table becomes the record of a finished week.
 */
@Component({
  selector: 'app-picks-grid',
  imports: [FormsModule],
  templateUrl: './picks-grid.html',
  styleUrl: './picks-grid.css',
})
export class PicksGridComponent implements OnDestroy {
  /**
   * Weeks the viewer may switch between. The Admin page passes its loaded list; the leaderboard
   * passes nothing, and the grid simply shows the active week with no picker.
   */
  readonly weeks = input<Week[]>([]);

  private readonly pool = inject(PoolService);
  private readonly entries = inject(EntryService);

  protected readonly selectedId = signal('');
  protected readonly rows = signal<Entry[]>([]);
  protected readonly loading = signal(false);

  private unsub: Unsubscribe | null = null;
  private watching = '';

  // The frozen columns' offsets depend on the rendered widths of the columns before them.
  private readonly gridWrap = viewChild<ElementRef<HTMLElement>>('gridWrap');
  private readonly playerHead = viewChild<ElementRef<HTMLElement>>('playerHead');
  private readonly ptsHead = viewChild<ElementRef<HTMLElement>>('ptsHead');
  private resizer: ResizeObserver | null = null;

  /**
   * The week being shown: whatever is selected, defaulting to the pool's active week.
   *
   * The active week is taken from PoolService rather than the `weeks` input, because that one is a
   * live snapshot — scores land in it as games go final, and the grid's totals move with them. The
   * input is a one-shot load, fine for past weeks that no longer change.
   */
  protected readonly week = computed<Week | null>(() => {
    const active = this.pool.week();
    const id = this.selectedId() || active?.id;
    if (id && id === active?.id) return active;
    return this.weeks().find((w) => w.id === id) ?? active ?? null;
  });

  protected readonly games = computed(() => this.week()?.games ?? []);

  /** Scored and ranked, so the grid reads top-down like the leaderboard. */
  protected readonly scores = computed(() => {
    const week = this.week();
    if (!week) return [];
    return rankWeek(this.rows().map((e) => scoreEntry(week, e)));
  });

  /** True once every game has a final score — the totals stop moving. */
  protected readonly isFinal = computed(
    () => this.games().length > 0 && this.games().every((g) => g.completed),
  );

  constructor() {
    // Follow the selected week's entries live, so the grid fills in as Sunday goes on.
    effect(() => {
      const id = this.week()?.id;
      if (!id || id === this.watching) return;
      this.watching = id;
      this.loading.set(true);
      this.unsub?.();
      this.unsub = this.entries.watchAllEntries(id, (entries) => {
        this.rows.set(entries);
        this.loading.set(false);
      });
    });

    // Pin Pts and Rec just right of the player column. Re-measured whenever those headers resize —
    // a longer name joining, or "Pts" turning into "Final" — and re-attached when the table is
    // re-rendered (switching weeks swaps it out for a loading message and back).
    effect(() => {
      const wrap = this.gridWrap()?.nativeElement;
      const player = this.playerHead()?.nativeElement;
      const pts = this.ptsHead()?.nativeElement;
      this.resizer?.disconnect();
      this.resizer = null;
      if (!wrap || !player || !pts) return;

      const place = () => {
        wrap.style.setProperty('--pts-left', `${player.offsetWidth}px`);
        wrap.style.setProperty('--rec-left', `${player.offsetWidth + pts.offsetWidth}px`);
      };
      place();
      this.resizer = new ResizeObserver(place);
      this.resizer.observe(player);
      this.resizer.observe(pts);
    });
  }

  ngOnDestroy(): void {
    this.unsub?.();
    this.resizer?.disconnect();
  }

  // --- Template helpers ---

  /**
   * Abbreviation for one side of a game, derived from the full team name rather than the `Abbr`
   * fields stored on the game — those were written by an older heuristic that collapsed all four
   * "New ..." teams onto NEW.
   */
  protected abbr(game: Game, side: Side): string {
    return teamAbbr(side === 'home' ? game.homeTeam : game.awayTeam);
  }

  /** The abbreviation of the side this player took, or null when they left it blank. */
  protected pickLabel(uid: string, game: Game): string | null {
    const entry = this.rows().find((e) => e.uid === uid);
    const side = entry?.picks[game.id];
    if (!side) return null;
    return this.abbr(game, side);
  }

  /** Status of that player's pick, used to colour the cell. */
  protected pickStatus(uid: string, game: Game): PickStatus {
    const entry = this.rows().find((e) => e.uid === uid);
    const side = entry?.picks[game.id];
    if (!side) return 'none';
    const cover = settleGame(game);
    if (cover === null) return 'pending';
    if (cover === 'push') return 'push';
    return cover === side ? 'win' : 'loss';
  }

  /** Header line for a game column: the favourite and its number. */
  protected lineLabel(game: Game): string {
    if (game.homeSpread === null) return 'no line';
    const favouredHome = game.homeSpread < 0;
    const abbr = this.abbr(game, favouredHome ? 'home' : 'away');
    return `${abbr} ${spreadLabel(game.homeSpread, favouredHome ? 'home' : 'away')}`;
  }

  /** Final score for the header, once the game is over. */
  protected scoreLabel(game: Game): string | null {
    if (!game.completed || game.homeScore == null || game.awayScore == null) return null;
    return `${game.awayScore}–${game.homeScore}`;
  }
}
