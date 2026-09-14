import { Injectable, computed, signal } from '@angular/core';
import {
  Unsubscribe,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getDb } from '../core/firebase';
import { Week, firstKickoff } from '../models';

/** The singleton config document at config/app. */
export interface AppConfig {
  adminEmails: string[];
  season: number;
  /** Week document id the app opens to, e.g. "2026-04". */
  activeWeekId: string | null;
}

/**
 * Tracks the pool's config and the active week, both as live listeners so a line correction or a
 * final score reaches every open browser without a refresh.
 */
@Injectable({ providedIn: 'root' })
export class PoolService {
  private readonly db = getDb();

  readonly config = signal<AppConfig | null>(null);
  readonly week = signal<Week | null>(null);
  /** True until both the config and its active week have been read once. */
  readonly loading = signal(true);

  /** Picks are closed once the week advances or the deadline passes. Recomputed on a ticking clock. */
  private readonly now = signal(Date.now());
  readonly isLocked = computed(() => {
    const w = this.week();
    if (!w) return true;
    return w.status === 'locked' || w.status === 'final' || this.now() >= w.lockAt;
  });
  readonly msUntilLock = computed(() => Math.max(0, (this.week()?.lockAt ?? 0) - this.now()));

  private unsubWeek: Unsubscribe | null = null;
  private watchedWeekId: string | null = null;

  constructor() {
    setInterval(() => this.now.set(Date.now()), 1000);
    onSnapshot(doc(this.db, 'config', 'app'), (snap) => {
      const cfg = snap.exists() ? (snap.data() as AppConfig) : null;
      this.config.set(cfg);
      if (cfg?.activeWeekId) this.watchWeek(cfg.activeWeekId);
      else {
        this.week.set(null);
        this.loading.set(false);
      }
    });
  }

  /** Repoints the live week listener; a no-op when already watching that week. */
  watchWeek(id: string): void {
    if (id === this.watchedWeekId) return;
    this.unsubWeek?.();
    this.watchedWeekId = id;
    this.loading.set(true);
    this.unsubWeek = onSnapshot(
      doc(this.db, 'weeks', id),
      (snap) => {
        this.week.set(snap.exists() ? (snap.data() as Week) : null);
        this.loading.set(false);
      },
      () => this.loading.set(false),
    );
  }

  /** Every week the caller is allowed to read, oldest first. */
  async listWeeks(): Promise<Week[]> {
    const snap = await getDocs(query(collection(this.db, 'weeks'), orderBy('week')));
    return snap.docs.map((d) => d.data() as Week);
  }

  // --- Admin writes (rejected by security rules for everyone else) ---

  /** Creates config/app on first run so the security rules have an admin list to consult. */
  async initConfig(adminEmails: string[], season: number): Promise<void> {
    await setDoc(
      doc(this.db, 'config', 'app'),
      { adminEmails, season, activeWeekId: null },
      { merge: true },
    );
  }

  async setActiveWeek(weekId: string | null): Promise<void> {
    await setDoc(doc(this.db, 'config', 'app'), { activeWeekId: weekId }, { merge: true });
  }

  /** Writes a week. lockAt defaults to the first kickoff on the slate when not set explicitly. */
  async saveWeek(week: Week): Promise<void> {
    const lockAt = week.lockAt || firstKickoff(week.games);
    await setDoc(
      doc(this.db, 'weeks', week.id),
      { ...week, lockAt, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }
}
