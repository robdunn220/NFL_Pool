import { Routes } from '@angular/router';
import { adminGuard, authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/landing/landing').then((m) => m.LandingComponent),
    title: 'Sunday NFL Pool',
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/auth/login').then((m) => m.LoginComponent),
    title: 'Sign in',
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/auth/register').then((m) => m.RegisterComponent),
    title: 'Create account',
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/auth/reset-password').then((m) => m.ResetPasswordComponent),
    title: 'Reset password',
  },
  {
    path: 'picks',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/picks/picks').then((m) => m.PicksComponent),
    title: 'My Picks',
  },
  {
    path: 'picks/:uid',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/picks/picks').then((m) => m.PicksComponent),
    title: 'Entry',
  },
  {
    path: 'leaderboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/leaderboard/leaderboard').then((m) => m.LeaderboardComponent),
    title: 'Leaderboard',
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/admin/admin').then((m) => m.AdminComponent),
    title: 'Admin',
  },
  { path: '**', redirectTo: '' },
];
