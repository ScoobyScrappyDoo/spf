import { Injectable, signal } from '@angular/core';

export type Conditions = 'perfect' | 'rain' | 'snow' | 'wind';
/** 0 light, 1 medium, 2 heavy. */
export type Intensity = 0 | 1 | 2;

export interface Wind {
  /** Where it blows to, in degrees on the field as drawn: 0 towards the right end zone, 90 down the screen. */
  towards: number;
  mph: number;
}

/** Wind speeds for light, medium and heavy (mph): a game gets one at random in its band. */
const WIND_MPH: [number, number][] = [[6, 12], [13, 21], [22, 32]];

/**
 * The weather for the game: chosen on the Game tab, drawn on the field (WeatherLayer). For now only the look: the
 * engine doesn't know about it yet, so it isn't in saved games or online games either. When the effects come, it moves
 * into the game's start (like the teams and the seed), and the wind's direction and speed are drawn from the seed.
 */
@Injectable({ providedIn: 'root' })
export class WeatherService {
  readonly conditions = signal<Conditions>('perfect');
  readonly intensity = signal<Intensity>(1);
  readonly wind = signal<Wind>(randomWind(1));
  /**
   * Rain, snow and wind move; untick "Moving" for a still picture. Moving even when the computer asks for less motion
   * (Windows: Animation effects off), as wanted for this game.
   */
  readonly moving = signal(true);

  set(conditions: Conditions, intensity: Intensity = this.intensity()) {
    const windChanged = conditions !== this.conditions() || intensity !== this.intensity();
    this.conditions.set(conditions);
    this.intensity.set(intensity);
    if (windChanged) this.wind.set(randomWind(intensity));
  }

  /** A new game: the same conditions, a fresh wind. */
  newGame() {
    this.wind.set(randomWind(this.intensity()));
  }
}

/** Only for the picture: the browser's own random numbers, never the game's. */
function randomWind(intensity: Intensity): Wind {
  const [lo, hi] = WIND_MPH[intensity];
  return { towards: Math.floor(Math.random() * 360), mph: lo + Math.floor(Math.random() * (hi - lo + 1)) };
}
