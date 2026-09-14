import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Requires a signed-in user; redirects to /login otherwise. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  // Wait for the first auth state, then read the LIVE signal — after a fresh sign-in the user may
  // have logged in since `whenReady()` first resolved (with null).
  await auth.whenReady();
  return auth.user() ? true : router.createUrlTree(['/login']);
};

/** Requires an admin user; redirects home otherwise. */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();
  return auth.isAdmin() ? true : router.createUrlTree(['/']);
};
