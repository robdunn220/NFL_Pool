import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-landing',
  imports: [RouterLink],
  template: `
    <div class="container">
      <section class="hero card">
        <h1>Sunday NFL Pool</h1>
        <p class="lede">
          One entry a week. Pick every Sunday game against the spread. Most covers wins the week.
        </p>

        @if (auth.isLoggedIn()) {
          <a class="btn btn-primary" routerLink="/picks">Make this week's picks</a>
        } @else {
          <div class="cta-row">
            <a class="btn btn-primary" routerLink="/register">Create an account</a>
            <a class="btn btn-secondary" routerLink="/login">Sign in</a>
          </div>
        }
      </section>

      <section class="rules">
        <div class="card">
          <h2>You're picking the line, not the winner</h2>
          <p class="muted">
            If the Steelers are 3.5-point favorites over the Cardinals and you take Pittsburgh,
            they have to win by <strong>4 or more</strong>. A one-point Steelers win is a loss on
            your card — the underdog covered.
          </p>
        </div>
        <div class="card">
          <h2>One entry, one deadline</h2>
          <p class="muted">
            Edit your picks as often as you like until the first Sunday kickoff. After that the
            week locks, everyone's card becomes visible, and results score themselves as games go
            final.
          </p>
        </div>
        <div class="card">
          <h2>Pushes are a wash</h2>
          <p class="muted">
            A game that lands exactly on a whole-number spread is a push: nobody gets the point,
            and it counts against nobody's record. Half-point lines can't push.
          </p>
        </div>
      </section>
    </div>
  `,
  styles: `
    .hero {
      text-align: center;
      padding: 3rem 1.5rem;
      background: linear-gradient(160deg, var(--navy) 0%, var(--navy-600) 100%);
      color: #fff;
      border: none;
      margin-bottom: 1.5rem;
    }
    .hero h1 {
      font-size: 2.2rem;
    }
    .lede {
      color: rgba(255, 255, 255, 0.82);
      max-width: 34rem;
      margin: 0 auto 1.5rem;
    }
    .cta-row {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    .rules {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
    .rules p {
      margin: 0;
      font-size: 0.92rem;
    }
  `,
})
export class LandingComponent {
  protected readonly auth = inject(AuthService);
}
