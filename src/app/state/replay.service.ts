import { Injectable, inject, signal } from '@angular/core';
import { GameState, replayFrames } from '../engine';
import { GameStore } from './game.store';
import { SimSpeed } from './simulation.service';

const DELAY: Record<SimSpeed, number> = { instant: 0, fast: 250, normal: 1200, slow: 3000 };

/**
 * Plays a game back from the opening toss, one decision at a time, at the chosen speed: the scoreboard, field, stats
 * and play-by-play follow along on every tab. The game is already decided, so there's no taking over; at the end (or
 * on "Skip to the end") the game stands exactly as it was.
 */
@Injectable({ providedIn: 'root' })
export class ReplayService {
  private readonly game = inject(GameStore);
  readonly running = signal(false);
  readonly paused = signal(false);
  readonly speed = signal<SimSpeed>('normal');
  private frames: Generator<GameState> | null = null;
  private final: GameState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Replays the current game from the start. */
  start(speed: SimSpeed) {
    const state = this.game.state();
    const ctx = this.game.ctx();
    const cards = this.game.cards();
    if (!state || !ctx || !cards || state.seed === undefined || !state.journal) return;
    this.final = state;
    this.frames = replayFrames({ homeTeamId: state.homeTeamId, awayTeamId: state.awayTeamId, seed: state.seed, ...(state.rules ? { rules: state.rules } : {}), ...(state.coaches ? { coaches: state.coaches } : {}) }, state.journal, ctx, cards);
    this.speed.set(speed);
    this.running.set(true);
    this.paused.set(false);
    this.game.simulating.set(true);
    this.schedule();
  }

  setSpeed(speed: SimSpeed) {
    this.speed.set(speed);
    if (this.running() && !this.paused()) this.schedule();
  }

  pause() {
    this.paused.set(true);
    this.clear();
  }

  resume() {
    if (!this.running()) return;
    this.paused.set(false);
    this.schedule();
  }

  /** Straight to the end: the game as it was. */
  finish() {
    if (this.final) this.game.showFrame(this.final);
    this.stop();
  }

  /** Stops the replay where it is (the game is about to be closed, say). */
  cancel() {
    this.stop();
  }

  private stop() {
    this.clear();
    this.frames = null;
    this.final = null;
    this.running.set(false);
    this.paused.set(false);
    this.game.simulating.set(false);
  }

  /** The next frame; false at the end. */
  private next(): boolean {
    const r = this.frames?.next();
    if (!r || r.done) return false;
    this.game.showFrame(r.value);
    return true;
  }

  private schedule() {
    this.clear();
    const tick = () => {
      if (!this.running() || this.paused()) return;
      if (this.speed() === 'instant') return this.finish();
      if (!this.next()) return this.finish();
      this.timer = setTimeout(tick, DELAY[this.speed()]);
    };
    this.timer = setTimeout(tick, 150);
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
