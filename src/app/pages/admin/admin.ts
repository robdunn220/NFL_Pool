import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Game, Week, firstKickoff, weekId } from '../../models';
import { AuthService } from '../../services/auth.service';
import { PoolService } from '../../services/pool.service';
import { environment } from '../../../environments/environment';

/**
 * Commissioner tools: bootstrap config, choose the active week, and correct anything the odds
 * feed got wrong.
 *
 * The scheduled functions do the routine work — this page exists for the cases they can't handle:
 * a postponed game, a line the book moved after capture, a score the feed never finalized.
 */
@Component({
  selector: 'app-admin',
  imports: [FormsModule],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class AdminComponent {
  protected readonly auth = inject(AuthService);
  protected readonly pool = inject(PoolService);

  protected readonly weeks = signal<Week[]>([]);
  /** Local copy of the active week; edits are staged here and written on Save. */
  protected readonly draft = signal<Week | null>(null);
  protected readonly message = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  protected newSeason = new Date().getFullYear();
  protected newWeek = 1;

  protected readonly statuses: Week['status'][] = ['draft', 'open', 'locked', 'final'];

  /** lockAt as a datetime-local string for the input, derived from the staged week. */
  protected readonly lockAtInput = computed(() => toLocalInput(this.draft()?.lockAt ?? 0));

  constructor() {
    this.refresh();
  }

  protected async refresh(): Promise<void> {
    try {
      this.weeks.set(await this.pool.listWeeks());
    } catch {
      this.weeks.set([]);
    }
    const active = this.pool.week();
    if (active) this.draft.set(structuredClone(active));
  }

  private async run(label: string, fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.message.set('');
    this.error.set('');
    try {
      await fn();
      this.message.set(`${label} done.`);
    } catch (e) {
      this.error.set(`${label} failed: ${(e as Error).message}`);
    } finally {
      this.busy.set(false);
    }
  }

  // --- Config ---

  protected initConfig(): Promise<void> {
    return this.run('Initialize config', () =>
      this.pool.initConfig(environment.adminEmails, this.newSeason),
    );
  }

  protected setActive(id: string): Promise<void> {
    return this.run('Set active week', async () => {
      await this.pool.setActiveWeek(id || null);
      this.pool.watchWeek(id);
      const week = await this.pool.getWeek(id);
      if (week) this.draft.set(structuredClone(week));
    });
  }

  // --- Weeks ---

  protected createWeek(): Promise<void> {
    const id = weekId(this.newSeason, this.newWeek);
    return this.run(`Create ${id}`, async () => {
      const week: Week = {
        id,
        season: this.newSeason,
        week: this.newWeek,
        status: 'draft',
        lockAt: 0,
        games: [],
      };
      await this.pool.saveWeek(week);
      await this.refresh();
      this.draft.set(week);
    });
  }

  protected saveWeek(): Promise<void> {
    const week = this.draft();
    if (!week) return Promise.resolve();
    return this.run('Save week', async () => {
      await this.pool.saveWeek(week);
      await this.refresh();
    });
  }

  protected setStatus(status: string): void {
    this.draft.update((w) => (w ? { ...w, status: status as Week['status'] } : w));
  }

  protected setLockAt(value: string): void {
    const ms = value ? new Date(value).getTime() : 0;
    this.draft.update((w) => (w ? { ...w, lockAt: ms } : w));
  }

  protected setSundayDate(value: string): void {
    this.draft.update((w) => (w ? { ...w, sundayDate: value || undefined } : w));
  }

  /** Resets the deadline to the earliest kickoff on the slate — the usual pool convention. */
  protected lockAtFirstKickoff(): void {
    this.draft.update((w) => (w ? { ...w, lockAt: firstKickoff(w.games) } : w));
  }

  // --- Games ---

  protected addGame(): void {
    this.draft.update((w) => {
      if (!w) return w;
      const game: Game = {
        id: `manual-${Date.now()}`,
        kickoff: nextSunday(),
        homeTeam: '',
        awayTeam: '',
        homeAbbr: '',
        awayAbbr: '',
        homeSpread: null,
      };
      return { ...w, games: [...w.games, game] };
    });
  }

  protected updateGame(id: string, patch: Partial<Game>): void {
    this.draft.update((w) =>
      w ? { ...w, games: w.games.map((g) => (g.id === id ? { ...g, ...patch } : g)) } : w,
    );
  }

  protected removeGame(id: string): void {
    this.draft.update((w) => (w ? { ...w, games: w.games.filter((g) => g.id !== id) } : w));
  }

  protected kickoffInput(game: Game): string {
    return toLocalInput(game.kickoff);
  }

  /** Inverse of `toLocalInput`: a datetime-local string back to epoch ms. */
  protected parseLocal(value: string): number {
    return value ? new Date(value).getTime() : 0;
  }

  /** A blank numeric input clears the value rather than writing NaN. */
  protected numberOrNull(value: string): number | null {
    return value === '' ? null : Number(value);
  }

  /** Pins a line so the scheduled sync stops overwriting it. */
  protected toggleLineLock(game: Game): void {
    this.updateGame(game.id, { lineLocked: !game.lineLocked });
  }

  // --- Manual function triggers ---

  protected syncLines(): Promise<void> {
    return this.run('Sync lines', () => this.callFunction('syncLinesNow'));
  }

  protected syncScores(): Promise<void> {
    return this.run('Sync scores', () => this.callFunction('syncScoresNow'));
  }

  private async callFunction(name: string): Promise<void> {
    const res = await fetch(`${environment.functionsBaseUrl}/${name}`);
    const body = (await res.json()) as { ok?: boolean; status?: string; error?: string };
    if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    this.message.set(body.status ?? 'Done.');
    await this.refresh();
  }
}

/** epoch ms -> the `YYYY-MM-DDTHH:mm` shape a datetime-local input expects, in local time. */
function toLocalInput(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Next Sunday at 1:00pm local — the default slot for a hand-added game. */
function nextSunday(): number {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  d.setHours(13, 0, 0, 0);
  return d.getTime();
}
