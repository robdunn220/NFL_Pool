import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Week } from '../models';
import { PoolService } from '../services/pool.service';

/** Thin banner under the nav: which week is live, and how long is left to get picks in. */
@Component({
  selector: 'app-lock-clock',
  imports: [RouterLink],
  template: `
    <div class="bar" [class.bar-locked]="pool.isLocked()">
      <div class="bar-inner">
        <span class="week">Week {{ week().week }}</span>
        <span class="dot" aria-hidden="true">•</span>
        @if (pool.isLocked()) {
          <span>{{ week().status === 'final' ? 'Final' : 'Picks are locked' }}</span>
        } @else {
          <span>Picks lock in <strong class="mono">{{ countdown() }}</strong></span>
          <a class="cta" routerLink="/picks">Make picks</a>
        }
      </div>
    </div>
  `,
  styles: `
    .bar {
      background: var(--field);
      color: #fff;
      font-size: 0.88rem;
    }
    .bar-locked {
      background: var(--navy-700);
    }
    .bar-inner {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0.45rem 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .week {
      font-weight: 700;
    }
    .dot {
      opacity: 0.5;
    }
    .cta {
      margin-left: auto;
      color: #fff;
      border-bottom: 1px solid rgba(255, 255, 255, 0.5);
    }
    .cta:hover {
      text-decoration: none;
      border-bottom-color: #fff;
    }
  `,
})
export class LockClockComponent {
  readonly week = input.required<Week>();
  protected readonly pool = inject(PoolService);

  /** Remaining time as Xd Yh, Xh Ym, or M:SS in the final hour. */
  protected readonly countdown = computed(() => {
    const total = Math.floor(this.pool.msUntilLock() / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}:${String(s).padStart(2, '0')}`;
  });
}
