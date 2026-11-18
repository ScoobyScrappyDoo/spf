/**
 * How long a play takes (rule 6.1 and 9.4). The offensive coach may use any time between the table's minimum and
 * maximum, in 5-second steps; here the game picks one at random from a range that suits the play, so runs eat more
 * clock than passes and a two-minute offense hurries.
 */
import { GameState } from './model/game';
import { SeededRandom } from './random';

export type PlayKind = 'run' | 'pass' | 'incomplete';

/** Seconds, inclusive, in 5-second steps. */
export const PLAY_TIME: Record<'normal' | 'twoMinute', Record<PlayKind, [number, number]>> = {
  normal: { run: [30, 45], pass: [20, 35], incomplete: [10, 20] },
  twoMinute: { run: [10, 20], pass: [5, 15], incomplete: [5, 10] },
};
/** Out of bounds in the final minutes: 10 seconds, or 5 in a two-minute offense (timing table, 9.4). */
export const OUT_OF_BOUNDS_SECONDS = { normal: 10, twoMinute: 5 };

/** Rule 9.4: the last two minutes of the first half and the last five of the second. */
export function inFinalMinutes(state: Pick<GameState, 'quarter' | 'clock'>): boolean {
  return (state.quarter === 2 && state.clock <= 120) || (state.quarter >= 4 && state.clock <= 300);
}

/** A random play time from the range, and the generator's new state (kept in the game so replays match). */
export function playSeconds(kind: PlayKind, twoMinute: boolean, rngState: number): { seconds: number; rngState: number } {
  const rng = new SeededRandom(rngState);
  const [min, max] = PLAY_TIME[twoMinute ? 'twoMinute' : 'normal'][kind];
  const steps = (max - min) / 5 + 1;
  return { seconds: min + 5 * rng.int(steps), rngState: rng.state };
}
