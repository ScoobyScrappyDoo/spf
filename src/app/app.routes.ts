import { SETTINGS } from './settings';
import { Routes } from '@angular/router';
import { gameStartedGuard } from './state/game.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./views/dashboard/dashboard').then(m => m.Dashboard), title: SETTINGS.gameName },
  { path: 'game', loadComponent: () => import('./views/game/game-page').then(m => m.GamePage), title: 'Game' },
  { path: 'report', loadComponent: () => import('./views/report/report-page').then(m => m.ReportPage), title: 'Game Book' },
  { path: 'rosters', loadComponent: () => import('./views/rosters/rosters-page').then(m => m.RostersPage), title: 'Rosters' },
  {
    path: 'offense',
    canActivate: [gameStartedGuard],
    loadComponent: () => import('./views/offense/offense-page').then(m => m.OffensePage),
    title: 'Offense selection',
  },
  {
    path: 'defense',
    canActivate: [gameStartedGuard],
    loadComponent: () => import('./views/defense/defense-page').then(m => m.DefensePage),
    title: 'Defense selection',
  },
  {
    path: 'play-by-play',
    canActivate: [gameStartedGuard],
    loadComponent: () => import('./views/play-by-play/play-by-play-page').then(m => m.PlayByPlayPage),
    title: 'Play by play',
  },
  {
    path: 'stats',
    canActivate: [gameStartedGuard],
    loadComponent: () => import('./views/stats/stats-page').then(m => m.StatsPage),
    title: 'Stats',
  },
  {
    path: 'data',
    canActivate: [gameStartedGuard],
    loadComponent: () => import('./views/data/data-page').then(m => m.DataPage),
    title: 'Data',
  },
  {
    path: ':section',
    canActivate: [gameStartedGuard],
    loadComponent: () => import('./views/coming-soon/coming-soon').then(m => m.ComingSoon),
    title: SETTINGS.gameName,
  },
];
