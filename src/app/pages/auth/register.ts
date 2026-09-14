import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="container">
      <div class="card form-narrow">
        <h1>Create account</h1>
        <p class="muted small">Your display name is what the leaderboard shows.</p>

        @if (error(); as msg) {
          <div class="alert alert-error">{{ msg }}</div>
        }

        <form (ngSubmit)="submit()">
          <div class="field">
            <label for="name">Display name</label>
            <input id="name" name="name" [(ngModel)]="displayName" autocomplete="nickname" required />
          </div>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" name="email" [(ngModel)]="email" autocomplete="email" required />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input
              id="password"
              type="password"
              name="password"
              [(ngModel)]="password"
              autocomplete="new-password"
              minlength="6"
              required
            />
          </div>
          <button class="btn btn-primary" type="submit" [disabled]="busy()">
            {{ busy() ? 'Creating…' : 'Create account' }}
          </button>
        </form>

        <p class="small muted" style="margin-top: 1rem">
          Already have an account? <a routerLink="/login">Sign in</a>
        </p>
      </div>
    </div>
  `,
})
export class RegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected displayName = '';
  protected email = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async submit(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.register(this.email.trim(), this.password, this.displayName.trim());
      await this.router.navigateByUrl('/picks');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
