import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="container">
      <div class="card form-narrow">
        <h1>Sign in</h1>
        <p class="muted small">Pick every Sunday game against the spread.</p>

        @if (error(); as msg) {
          <div class="alert alert-error">{{ msg }}</div>
        }

        <form (ngSubmit)="submit()">
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
              autocomplete="current-password"
              required
            />
          </div>
          <button class="btn btn-primary" type="submit" [disabled]="busy()">
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>

        <p class="small muted" style="margin-top: 1rem">
          <a routerLink="/reset-password">Forgot password?</a> ·
          <a routerLink="/register">Create an account</a>
        </p>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected email = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async submit(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.login(this.email.trim(), this.password);
      await this.router.navigateByUrl('/picks');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
