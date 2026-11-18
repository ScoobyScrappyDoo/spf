import { effect, inject, Injectable, untracked } from '@angular/core';
import {
  acceptDelayOfGame, acceptPenalty, chooseDefense, chooseFake, chooseOffense, chooseOnside, chooseSquib, CoachMemory, coachRandom,
  FormationId, GameContext, GameState, JournalEntry, Lineup, newCoachMemory, OffenseDecision, Side,
} from '../engine';
import { GameStore } from './game.store';

/** How long the computer "thinks" before each decision: quick, but you see it happen. */
const THINK_MS = 450;

/**
 * Solitaire: the computer coach plays one side of a local game (the side whose "played by" is AI). It watches the
 * game and, whenever a decision is the computer's, makes it after a moment, the way a coach across the table would:
 *
 *  - on offense, it lines up first (its formation and players, which you see), waits for your "All set!", then
 *    snaps its play (or kicks);
 *  - on defense, it sets up once it sees how you line up, and again if you change your formation afterwards.
 *
 * It never looks at your call before the snap, and you don't see its call either. All its decisions are journaled
 * like yours, so saving, replays and the Game Book work as for any game.
 */
@Injectable({ providedIn: 'root' })
export class SolitaireService {
  private readonly game = inject(GameStore);
  private memory: CoachMemory = newCoachMemory();
  /** The computer's offensive decision for the play now being set up: lined up first, snapped after your All set!. */
  private pending: { play: number; decision: OffenseDecision } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Every change of the game (a new play, your All set!, your formation) is a moment to check whose turn it is.
    effect(() => {
      const state = this.game.state();
      const ai = this.game.aiSide();
      if (!state || !ai || this.game.simulating()) return;
      untracked(() => this.schedule());
    });
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.step();
    }, THINK_MS);
  }

  /** One decision, if it's the computer's turn (checked again on the game as it is now). */
  private step() {
    const state = this.game.state(), ai = this.game.aiSide(), ctx = this.game.ctx();
    if (!state || !ai || !ctx || this.game.simulating()) return;
    const entry = this.decide(state, ai, ctx);
    if (!entry) return;
    if (this.game.perform(entry)) {
      this.refusals = 0;
      return;
    }
    // Refused (the game changes nothing, so nothing would wake the computer up again): think again from scratch, a
    // few times; then the reason stays on screen.
    this.pending = null;
    if (++this.refusals <= 3) this.schedule();
  }

  /** Decisions refused in a row (see step). */
  private refusals = 0;

  private decide(s: GameState, ai: Side, ctx: GameContext): JournalEntry | null {
    switch (s.phase) {
      case 'COIN_TOSS':
        return s.toss?.caller === ai ? { t: 'toss', call: coachRandom(s, 0x7055).next() < 0.5 ? 'HEADS' : 'TAILS' } : null;
      case 'TOSS_CHOICE':
        return s.toss?.winner === ai ? { t: 'choice', choice: 'RECEIVE' } : null;
      case 'KICKOFF': {
        if (s.kickoff?.kicking !== ai) return null;
        const squib = chooseSquib(s);
        return { t: 'kickoff', onside: chooseOnside(s), ...(squib ? { squib } : {}) };
      }
      case 'PENALTY_CHOICE':
        return s.pendingPenalty?.chooser === ai ? { t: 'penalty', accept: acceptPenalty(s) } : null;
      case 'PLAY':
        return this.play(s, ai, ctx);
      default:
        return null;
    }
  }

  private play(s: GameState, ai: Side, ctx: GameContext): JournalEntry | null {
    const offense = s.possession;
    if (!offense) return null;
    // You asked for a delay of game before your punt: the computer, receiving, answers.
    if (s.delayOfGame === 'ASKED') return offense !== ai ? { t: 'delay-answer', accept: acceptDelayOfGame(s) } : null;
    if (offense === ai) return this.offense(s, ai, ctx);

    // On defense: set up once your formation is in view (or your kick is declared); again if you change it.
    if (s.defenseReady) return null;
    const look = s.offenseLook ? { formationId: s.offenseLook.formationId as FormationId, lineup: s.offenseLook.lineup as Lineup } : undefined;
    if (!look && !s.puntCall && !s.fieldGoalCall) return null;
    const setup = chooseDefense(s, ctx, this.memory.defense[ai], look);
    this.memory.defense[ai] = setup.lineup;
    return { t: 'ready', ready: true, setup };
  }

  private offense(s: GameState, ai: Side, ctx: GameContext): JournalEntry | null {
    const play = s.playIndex ?? 0;
    // First: decide and line up (or declare the kick), so you can see it and set your defense.
    if (!this.pending || this.pending.play !== play) {
      const decision = chooseOffense(s, ctx, this.memory.offense[ai]);
      this.pending = { play, decision };
      if (decision.kind === 'punt') return { t: 'punt-call', call: { ...decision.punt, ...(chooseFake(s, 'punt') ? { fake: true } : {}) } };
      if (decision.kind === 'field-goal') return { t: 'fg-call', on: true, ...(chooseFake(s, 'field-goal') ? { fake: true } : {}) };
      this.memory.offense[ai] = decision.lineup;
      const lineup = Object.fromEntries(Object.entries(decision.lineup).filter(([, id]) => id)) as Record<string, string>;
      return { t: 'look', formationId: decision.call.formationId, lineup };
    }
    // Then, once your defense is set: the snap, or the kick.
    if (!s.defenseReady) return null;
    const d = this.pending.decision;
    if (d.kind === 'punt') return { t: 'punt' };
    if (d.kind === 'field-goal') return { t: 'fg' };
    // Now the play itself, with your defense in view: its formation and players (not your call), kept as lined up.
    const setup = s.defenseSetup;
    const called = d.call.strategy === 'QB_FLOP' || !setup ? d
      : chooseOffense(s, ctx, this.memory.offense[ai], { formationId: d.call.formationId, lineup: d.lineup }, { formationId: setup.formationId, lineup: setup.lineup });
    const final = called.kind === 'play' ? called : d;
    return { t: 'snap', call: final.call, lineup: final.lineup, twoMinute: final.twoMinute, timeout: final.timeout };
  }
}
