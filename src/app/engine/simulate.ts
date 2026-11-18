import { applyEntry, JournalEntry } from './journal';
/**
 * Simulated games: the computer coach (coach.ts) makes every decision, one step at a time, so a game can be run in a
 * blink or watched at any speed. A step is one thing that happens: the toss, the choice after it, a kickoff, a penalty
 * choice, or one play from scrimmage (the offense decides, the defense sets, then the snap, the punt or the kick).
 */
import { acceptDelayOfGame, acceptPenalty, chooseDefense, chooseFake, chooseOffense, chooseOnside, chooseSquib, coachRandom, expectOnside, wantDelayOfGame } from './coach';
import { DefenseLineup } from './defense-lineup';
import { declareFieldGoal, fieldGoalPlay } from './fieldgoal';
import { callToss, chooseAfterToss, GameContext, kickoff } from './game';
import { Lineup } from './lineup';
import { GameState, otherSide, Side } from './model/game';
import { answerDelayOfGame, askDelayOfGame, declarePunt, puntPlay } from './punt';
import { choosePenalty } from './chains';
import { setDefenseReady, snapPlay } from './scrimmage';

/** The coaches' lineups between plays, so players stay where they were (like a coach's depth chart in his head). */
export interface CoachMemory {
  offense: Partial<Record<Side, Lineup>>;
  defense: Partial<Record<Side, DefenseLineup>>;
}

export const newCoachMemory = (): CoachMemory => ({ offense: {}, defense: {} });

/**
 * One turn of the computer coach as concrete decisions (journal entries): the toss call, the kickoff, a penalty choice,
 * or a play (the offense's call and lineup, the defense's setup, the snap or the kick). Journaling these, rather than
 * "the computer's step", makes a saved game independent of the coach: a replay makes the same plays even after the
 * coach has learned new tricks.
 */
export function coachTurn(state: GameState, ctx: GameContext, memory: CoachMemory = newCoachMemory()): { entries: JournalEntry[]; state: GameState } {
  const entries: JournalEntry[] = [];
  let s = state;
  const go = (e: JournalEntry) => { entries.push(e); s = applyEntry(s, e, ctx, memory); };
  switch (state.phase) {
    case 'COIN_TOSS':
      go({ t: 'toss', call: coachRandom(state, 0x7055).next() < 0.5 ? 'HEADS' : 'TAILS' });
      break;
    case 'TOSS_CHOICE':
      go({ t: 'choice', choice: 'RECEIVE' });
      break;
    case 'KICKOFF': {
      const squib = chooseSquib(state), onsideDefense = expectOnside(state);
      go({ t: 'kickoff', onside: chooseOnside(state), ...(squib ? { squib } : {}), ...(onsideDefense ? { onsideDefense } : {}) });
      break;
    }
    case 'PENALTY_CHOICE':
      go({ t: 'penalty', accept: acceptPenalty(state) });
      break;
    case 'GAME_OVER':
      break;
    case 'PLAY':
      playTurn(s, ctx, memory, go, () => s);
      break;
  }
  return { entries, state: s };
}

function playTurn(state: GameState, ctx: GameContext, memory: CoachMemory, go: (e: JournalEntry) => void, now: () => GameState) {
  if (state.delayOfGame === 'ASKED') return go({ t: 'delay-answer', accept: acceptDelayOfGame(state) });
  const offense = state.possession!;
  const defense = otherSide(offense);
  const decision = chooseOffense(state, ctx, memory.offense[offense]);
  // A punt or field goal still declared from a replayed down, when the coach now wants something else.
  if (now().puntCall && decision.kind !== 'punt') go({ t: 'punt-call', call: null });
  if (now().fieldGoalCall && decision.kind !== 'field-goal') go({ t: 'fg-call', on: false });
  if (decision.kind === 'punt') {
    go({ t: 'punt-call', call: { ...decision.punt, ...(chooseFake(now(), 'punt') ? { fake: true } : {}) } });
    if (wantDelayOfGame(now())) return go({ t: 'delay-ask' }); // the receiving team answers on the next turn
  }
  if (decision.kind === 'field-goal' && !now().fieldGoalCall) {
    const fake = chooseFake(now(), 'field-goal');
    go({ t: 'fg-call', on: true, ...(fake ? { fake } : {}) });
  }
  const look = decision.kind === 'play' ? { formationId: decision.call.formationId, lineup: decision.lineup } : undefined;
  const setup = chooseDefense(now(), ctx, memory.defense[defense], look);
  memory.defense[defense] = setup.lineup;
  go({ t: 'ready', ready: true, setup });
  if (decision.kind === 'punt') return go({ t: 'punt' });
  if (decision.kind === 'field-goal') return go({ t: 'fg' });
  // The play is called once the defense is in view (its formation and players, not its call), as at the table.
  const play = decision.call.strategy === 'QB_FLOP' ? decision
    : chooseOffense(now(), ctx, memory.offense[offense], { formationId: decision.call.formationId, lineup: decision.lineup }, { formationId: setup.formationId, lineup: setup.lineup });
  const final = play.kind === 'play' ? play : decision;
  memory.offense[offense] = final.lineup;
  go({ t: 'snap', call: final.call, lineup: final.lineup, twoMinute: final.twoMinute, timeout: final.timeout });
}

export function simulateStep(state: GameState, ctx: GameContext, memory: CoachMemory = newCoachMemory()): GameState {
  return coachTurn(state, ctx, memory).state;
}

/** Plays a game to the end. Stops after `maxSteps` as a guard against a game that never ends. */
export function simulateGame(state: GameState, ctx: GameContext, maxSteps = 2000): GameState {
  const memory = newCoachMemory();
  let s = state;
  for (let i = 0; i < maxSteps && s.phase !== 'GAME_OVER'; i++) {
    s = simulateStep(s, ctx, memory);
  }
  if (s.phase !== 'GAME_OVER') throw new Error(`The game did not end within ${maxSteps} steps (stuck in ${s.phase}, Q${s.quarter} ${s.clock}s)`);
  return s;
}
