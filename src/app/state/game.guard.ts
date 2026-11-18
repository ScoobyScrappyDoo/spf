import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { GameStore } from './game.store';

/** Screens other than Game only open once a game has kicked off; otherwise you land on the Game screen. */
export const gameStartedGuard: CanActivateFn = async () => {
  const game = inject(GameStore);
  const router = inject(Router);
  await game.restored;
  return game.unlocked() || router.createUrlTree(['/game']);
};
