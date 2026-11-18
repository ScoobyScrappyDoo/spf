import { EventStamp, StatEventBody } from './model/events';
import { GameState } from './model/game';

/** Stamps events with the play, quarter, clock and possession they happened in, and adds them to the game. */
export function addEvents(state: GameState, events: StatEventBody[], at: Pick<GameState, 'quarter' | 'clock'> = state): GameState {
  if (!events.length) return state;
  const stamp: EventStamp = { play: state.playIndex ?? 0, quarter: at.quarter, clock: at.clock, possession: state.possessionIndex ?? 0 };
  return { ...state, events: [...(state.events ?? []), ...events.map(e => ({ ...e, ...stamp }))] };
}

/** One more play has started. */
export function nextPlay(state: GameState): GameState {
  return { ...state, delayOfGame: null, playIndex: (state.playIndex ?? 0) + 1 };
}
