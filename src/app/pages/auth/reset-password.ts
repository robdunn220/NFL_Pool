import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-reset-password',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="container">
      <div class="card form-narrow">
        <h1>Reset password</h1>

        @if (error(); as msg) {
          <div class="alert alert-error">{{ msg }}</div>
        }
        @if (sent()) {
          <div class="alert alert-success">Check your email for a reset link.</div>
        }

        <form (ngSubmit)="submit()">
          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" name="email" [(ngModel)]="email" autocomplete="email" required />
          </div>
          <button class="btn btn-primary" type="submit" [disabled]="busy()">
            {{ busy() ? 'Sending…' : 'Send reset link' }}
          </button>
        </form>

        <p class="small muted" style="margin-top: 1rem"><a routerLink="/login">Back to sign in</a></p>
      </div>
    </div>
  `,
})
export class ResetPasswordComponent {
  private readonly auth = inject(AuthService);

  protected email = '';
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal('');

  protected async submit(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.resetPassword(this.email.trim());
      this.sent.set(true);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
