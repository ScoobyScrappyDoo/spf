import { Injectable, inject, signal } from '@angular/core';
import { CoachMemory, newCoachMemory, Temperament } from '../engine';
import { GameStore } from './game.store';

export type SimSpeed = 'instant' | 'fast' | 'normal' | 'slow';

/** Milliseconds between steps (a step is one play, kickoff, toss or choice). */
const DELAY: Record<SimSpeed, number> = { instant: 0, fast: 250, normal: 1200, slow: 3000 };

/**
 * Runs a simulated game: the computer coach plays both sides, one step at a time, at the chosen speed.
 * It lives as long as the app, so the game goes on whichever tab you look at; pause, resume or skip to the end.
 */
@Injectable({ providedIn: 'root' })
export class SimulationService {
  private readonly game = inject(GameStore);
  readonly running = signal(false);
  readonly paused = signal(false);
  readonly speed = signal<SimSpeed>('normal');
  private memory: CoachMemory = newCoachMemory();
  /** The first step after a start gives the coach a clear head; the journal notes it so a replay does the same. */
  private fresh = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Start a new game between two teams and let the computer play it. */
  async simulateNew(homeTeamId: string, awayTeamId: string, speed: SimSpeed, temperament: Temperament = 'normal') {
    this.stop();
    await this.game.newGame(homeTeamId, awayTeamId, { home: 'AI', away: 'AI' }, temperament);
    this.run(speed);
  }

  /** Let the computer play the current game from here. */
  run(speed: SimSpeed = this.speed()) {
    this.game.markAiFinished(); // a game people were playing: the Game Book says the computer finished it
    this.memory = newCoachMemory();
    this.fresh = true;
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

  /** Skip to the final whistle. */
  finish() {
    if (!this.running()) return;
    this.clear();
    let guard = 3000;
    while (guard-- > 0 && this.game.state()?.phase !== 'GAME_OVER') {
      if (!this.step()) return;
    }
    this.stop();
  }

  stop() {
    this.clear();
    this.running.set(false);
    this.paused.set(false);
    this.game.simulating.set(false);
  }

  private step(): boolean {
    const ok = this.game.simStep(this.memory, this.fresh);
    this.fresh = false;
    if (!ok) this.stop();
    return ok;
  }

  private schedule() {
    this.clear();
    const tick = () => {
      if (!this.running() || this.paused()) return;
      if (this.game.state()?.phase === 'GAME_OVER') return this.stop();
      if (this.speed() === 'instant') {
        // In chunks, so the page stays responsive while a whole game is played in a blink.
        for (let i = 0; i < 40 && this.game.state()?.phase !== 'GAME_OVER'; i++) if (!this.step()) return;
      } else if (!this.step()) {
        return;
      }
      this.timer = setTimeout(tick, DELAY[this.speed()]);
    };
    this.timer = setTimeout(tick, this.speed() === 'instant' ? 0 : 150);
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
