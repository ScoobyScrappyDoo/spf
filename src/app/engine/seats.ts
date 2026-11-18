/**
 * Two coaches on two computers: who may make which decision, and what each one is allowed to see. Used by the game
 * server: it holds the real game and sends each coach only his own view. The master sees everything (and may do
 * anything), as you do at one screen today.
 */
import { JournalEntry } from './journal';
import { DefenseSetup, GameState, otherSide, Side } from './model/game';
import { OffenseCall } from './selection';

export type Seat = Side | 'master';

/**
 * The version of what the app and the game server say to each other. Raised whenever that changes (version 2: the
 * offense's and defense's formations as they line up; version 3: each play's cards in the log, for the carousel;
 * version 4: the coaches' calls as they take shape, for the master), so an old server still running is spotted at once.
 */
export const PROTOCOL = 4;

/**
 * The coaches' calls as they take shape, before the snap or "All set!". Not part of the game (no journal, no saved
 * game): the server keeps the latest of each and sends them to the master seat only, never to the other coach.
 */
export interface Drafts {
  offense?: { call: OffenseCall; twoMinute: boolean; timeout: boolean };
  defense?: DefenseSetup;
}

/** Which side must make the next decision of this kind, or null if nobody may right now. */
function decider(state: GameState, e: JournalEntry): Side | null {
  const offense = state.possession;
  switch (e.t) {
    case 'toss': return state.toss?.caller ?? null;
    case 'choice': return state.toss?.winner ?? null;
    case 'kickoff': return state.kickoff?.kicking ?? null;
    case 'penalty': return state.pendingPenalty?.chooser ?? null;
    case 'ready': case 'defense-look': return offense ? otherSide(offense) : null;
    case 'delay-answer': return offense ? otherSide(offense) : null;
    case 'snap': case 'punt-call': case 'punt': case 'fg-call': case 'fg': case 'delay-ask': case 'look': return offense;
    case 'sim': return null; // the computer coach plays only for the master
  }
}

/** Why this seat may not make this decision now, or null if it may. */
export function mayAct(state: GameState, seat: Seat, e: JournalEntry): string | null {
  if (seat === 'master') return null;
  const who = decider(state, e);
  if (!who) return e.t === 'sim' ? 'Only the master can let the computer play' : 'Nobody can do that right now';
  return who === seat ? null : "That's the other coach's decision";
}

/**
 * What a seat may see. Both coaches see the field (formations, players, the score, everything that has happened);
 * neither sees the order of the cards, the random seed or the journal (which would give away the deck) until the game
 * is over. The offense doesn't see the defense's call, blitzers, coverage, big play or timeout before the snap; the
 * defense doesn't see a fake kick.
 */
export function viewFor(state: GameState, seat: Seat): GameState {
  if (seat === 'master' || state.phase === 'GAME_OVER') return state;
  const offense = state.possession;
  const view: GameState = {
    ...state,
    deck: { ...state.deck, order: [] },
    rngState: 0,
    seed: undefined,
    journal: undefined,
  };
  if (offense && seat === offense && state.defenseSetup) {
    const { formationId, lineup } = state.defenseSetup;
    view.defenseSetup = { formationId, lineup, call: 'RUN_NO_KEY' }; // the call isn't shown: a neutral stand-in
  }
  if (offense && seat !== offense) {
    if (view.puntCall?.fake) view.puntCall = { ...view.puntCall, fake: false };
    view.fakeKick = false;
  }
  return view;
}
