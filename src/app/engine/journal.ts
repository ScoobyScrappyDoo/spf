import { showDefense, showOffense } from './scrimmage';
/**
 * The game's journal: every decision made, in order, by the coaches or the computer. The engine is deterministic, so a
 * game's seed and its journal rebuild it exactly, card for card; that's what a saved game (.spf) holds and what a
 * replay plays back. A simulated step is journaled as the computer's step: the coach is deterministic too.
 */
import { choosePenalty } from './chains';
import { declareFieldGoal, fieldGoalPlay } from './fieldgoal';
import { callToss, chooseAfterToss, createGame, GameContext, kickoff } from './game';
import { Lineup } from './lineup';
import { Coin, DefenseSetup, GameState, PuntCall, TossChoice } from './model/game';
import { Fac } from './model/fac';
import { answerDelayOfGame, askDelayOfGame, declarePunt, puntPlay } from './punt';
import { setDefenseReady, snapPlay } from './scrimmage';
import { OffenseCall } from './selection';
import { CoachMemory, newCoachMemory, simulateStep } from './simulate';

export type JournalEntry =
  | { t: 'toss'; call: Coin }
  | { t: 'choice'; choice: TossChoice }
  | { t: 'kickoff'; onside: boolean; squib?: boolean; onsideDefense?: boolean }
  | { t: 'penalty'; accept: boolean }
  | { t: 'ready'; ready: boolean; setup?: DefenseSetup }
  | { t: 'snap'; call: OffenseCall; lineup: Lineup; twoMinute: boolean; timeout: boolean }
  | { t: 'punt-call'; call: PuntCall | null }
  | { t: 'punt' }
  | { t: 'fg-call'; on: boolean; fake?: boolean }
  | { t: 'fg' }
  | { t: 'delay-ask' }
  /** The offense lines up (formation and players, not its call), for the defense to see. */
  | { t: 'look'; formationId: string; lineup: Record<string, string | undefined> }
  /** The defense sets up (formation and players, not its call), for the offense to see. */
  | { t: 'defense-look'; formationId: string; lineup: Record<string, string[] | undefined> }
  | { t: 'delay-answer'; accept: boolean }
  /** One step by the computer coach; `fresh` when a simulation started here (the coach starts with a clear head). */
  | { t: 'sim'; fresh?: boolean };

export interface GameStart {
  homeTeamId: string;
  awayTeamId: string;
  seed: number;
  rules?: import('./game').GameRules;
  coaches?: import('./game').Coaches;
}

/** Applies one journal entry. The journal itself is not touched; see `withEntry`. */
export function applyEntry(state: GameState, e: JournalEntry, ctx: GameContext, memory: CoachMemory): GameState {
  switch (e.t) {
    case 'toss': return callToss(state, e.call, ctx);
    case 'choice': return chooseAfterToss(state, e.choice, ctx);
    case 'kickoff': return kickoff(state, ctx, { onside: e.onside, squib: e.squib, onsideDefense: e.onsideDefense });
    case 'penalty': return choosePenalty(state, e.accept, ctx);
    case 'ready': return setDefenseReady(state, e.ready, e.setup);
    case 'snap': return snapPlay(state, e.call, e.lineup, ctx, { twoMinute: e.twoMinute, timeout: e.timeout });
    case 'punt-call': return declarePunt(state, e.call);
    case 'punt': return puntPlay(state, ctx);
    case 'fg-call': return declareFieldGoal(state, e.on, !!e.fake);
    case 'fg': return fieldGoalPlay(state, ctx);
    case 'look': return showOffense(state, { formationId: e.formationId, lineup: e.lineup });
    case 'defense-look': return showDefense(state, { formationId: e.formationId, lineup: e.lineup });
    case 'delay-ask': return askDelayOfGame(state, ctx);
    case 'delay-answer': return answerDelayOfGame(state, e.accept, ctx);
    case 'sim': return simulateStep(state, ctx, memory);
  }
}

/** The state after an entry, with the entry added to its journal. */
export function withEntry(before: GameState, after: GameState, e: JournalEntry): GameState {
  return { ...after, journal: [...(before.journal ?? []), e] };
}

/**
 * Plays a journal back from the start, one entry at a time: yields each state in turn (the replay's frames).
 * The coach's memory starts afresh where a simulation started, exactly as it did in the game.
 */
export function* replayFrames(start: GameStart, journal: readonly JournalEntry[], ctx: GameContext, cards: readonly Fac[]): Generator<GameState> {
  let state = createGame(start, cards);
  let memory = newCoachMemory();
  yield state;
  for (const e of journal) {
    if (e.t === 'sim' && e.fresh) memory = newCoachMemory();
    state = withEntry(state, applyEntry(state, e, ctx, memory), e);
    yield state;
  }
}

/** The finished (or current) state of a journaled game. */
export function rebuildGame(start: GameStart, journal: readonly JournalEntry[], ctx: GameContext, cards: readonly Fac[]): GameState {
  let last: GameState | undefined;
  for (const s of replayFrames(start, journal, ctx, cards)) last = s;
  return last!;
}
