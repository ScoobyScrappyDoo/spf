/**
 * Fake kicks (optional rule O6, table 6.10): before a punt or field goal the offense may stage a fake. One card's RN on
 * the Fake Kick Table: passes to the receivers, a run by the punter (or the holder, the quarterback), or an incomplete
 * pass. A defense that expects the fake adds 2 to the RN, but then can't block a real kick. On a fake field goal only
 * a real 12 is an interception, returned for a touchdown by a linebacker; with the +2 it's just incomplete.
 */
import { applyScrimmage } from './chains';
import { FacDeck } from './deck';
import { nextPlay } from './events';
import { GameContext, PlayFlips, teamLabel } from './game';
import { Lineup } from './lineup';
import { getFormation, OffenseSlot } from './model/formations';
import { GameState, otherSide, ScrimmageOutcome } from './model/game';
import { PlayerCard } from './model/players';
import { receiverRoles } from './pass';
import { SeededRandom } from './random';
import { playSeconds } from './timing';
import { buildLineup, formationForStarters } from './lineup';

type FakeResult = { kind: 'pass'; to: 'LE' | 'FL1' | 'RE' | 'BK1' | 'BK2'; yards: number } | { kind: 'run'; yards: number } | { kind: 'incomplete' } | { kind: 'interception' };

const P = (to: 'LE' | 'FL1' | 'RE' | 'BK1' | 'BK2', yards: number): FakeResult => ({ kind: 'pass', to, yards });
const R = (yards: number): FakeResult => ({ kind: 'run', yards });
const INC: FakeResult = { kind: 'incomplete' };

/** Table 6.10, RN 1-12. */
export const FAKE_FIELD_GOAL: FakeResult[] = [P('LE', 25), P('FL1', 18), P('RE', 15), P('BK1', 10), P('BK2', 9), R(15), INC, INC, INC, INC, INC, { kind: 'interception' }];
export const FAKE_PUNT: FakeResult[] = [P('LE', 30), P('FL1', 20), P('RE', 10), P('BK1', 8), P('BK2', 6), R(15), R(7), R(6), R(3), R(1), R(0), R(-5)];
const NAMES = { LE: 'LE', FL1: 'FL', RE: 'RE', BK1: 'BK#1', BK2: 'BK#2' } as const;

/** The fake: one card on the table, then scored like a play from scrimmage (downs, first downs, touchdowns, clock). */
export function fakeKickPlay(state: GameState, ctx: GameContext, kind: 'punt' | 'field-goal'): GameState {
  const offense = state.possession!;
  const defense = otherSide(offense);
  const team = ctx.teams[offense];
  const steps: string[] = [];
  const deck = new FacDeck(ctx.cards, state.deck);
  const flips = new PlayFlips(deck, false, steps);
  const rng = new SeededRandom(state.rngState);
  const expected = !!state.defenseSetup?.expectFake;
  const card = flips.next(false);
  const rn = Math.min(12, card.runNumber + (expected ? 2 : 0));
  const table = kind === 'punt' ? FAKE_PUNT : FAKE_FIELD_GOAL;
  // Rule O6: only a real 12 intercepts a fake field goal; a 12 made by the +2 is incomplete.
  let result = table[rn - 1];
  if (result.kind === 'interception' && card.runNumber !== 12) result = INC;
  steps.push(`Fake ${kind === 'punt' ? 'punt' : 'field goal'}! RN ${card.runNumber}${expected ? ` +2 (the defense expected it) = ${rn}` : ''}.`);

  // Who's out there: the kicking team's usual players; the punter, or the quarterback holding, has the ball.
  const lineup: Lineup = buildLineup(team, getFormation(formationForStarters(team)));
  const roles = receiverRoles(getFormation(formationForStarters(team)));
  const slotOf = (role: string) => [...roles.entries()].find(([, r]) => r === role)?.[0];
  const player = (id: string | undefined) => team.players.find(p => p.id === id);
  const punter = team.players.find(p => p.position === 'P');
  const holder = team.players.filter(p => p.position === 'QB').sort((a, b) => ('ABC'.indexOf(a.position === 'QB' ? a.endurance : 'C') - 'ABC'.indexOf(b.position === 'QB' ? b.endurance : 'C')))[1]
    ?? team.players.find(p => p.position === 'QB');
  const thrower: PlayerCard | undefined = kind === 'punt' ? punter : holder; // the note on table 6.10: the QB is the "B" one
  const name = (p: PlayerCard | undefined) => (p ? `${p.firstName} ${p.lastName}` : 'the kicking team');
  const los = state.ballOn!;
  const time = playSeconds(result.kind === 'incomplete' ? 'incomplete' : 'run', false, rng.state);
  const base = { kind: 'SCRIMMAGE' as const, countsAsDown: true, autoFirstDown: false, turnover: false, outOfBounds: false, clockUsed: time.seconds };
  let outcome: ScrimmageOutcome;
  if (result.kind === 'pass') {
    const slot = slotOf(result.to) as OffenseSlot | undefined;
    const target = player(slot ? lineup[slot] : undefined);
    if (!target) {
      steps.push(`Pass to ${NAMES[result.to]}, but nobody is there: incomplete.`);
      outcome = { ...base, newBallOn: los, summary: `${name(thrower)}'s pass falls incomplete`, events: thrower ? [{ type: 'PASS', side: offense, playerId: thrower.id, targetId: null, complete: false, yards: 0, touchdown: false, intercepted: false }] : [] };
    } else {
      const yards = Math.min(result.yards, 100 - los);
      steps.push(`Pass to ${NAMES[result.to]}, ${name(target)}, for ${result.yards} yards.`);
      outcome = {
        ...base, newBallOn: los + result.yards, summary: `${name(thrower)} to ${name(target)}, ${yards} yards`,
        events: [{ type: 'PASS', side: offense, playerId: thrower?.id ?? target.id, targetId: target.id, complete: true, yards, touchdown: false, intercepted: false }],
      };
    }
  } else if (result.kind === 'run') {
    const yards = Math.min(result.yards, 100 - los);
    steps.push(`${name(thrower)} runs for ${result.yards} yards.`);
    outcome = {
      ...base, newBallOn: los + result.yards, summary: `${name(thrower)} ${yards > 0 ? `runs for ${yards} yards` : yards < 0 ? `loses ${-yards} yards` : 'is stopped for no gain'}`,
      events: thrower ? [{ type: 'RUSH', side: offense, playerId: thrower.id, yards, touchdown: false }] : [],
    };
  } else if (result.kind === 'incomplete') {
    steps.push('The pass is incomplete.');
    outcome = { ...base, newBallOn: los, summary: `${name(thrower)}'s pass falls incomplete`, events: thrower ? [{ type: 'PASS', side: offense, playerId: thrower.id, targetId: null, complete: false, yards: 0, touchdown: false, intercepted: false }] : [] };
  } else {
    // Returned for a touchdown by the defense's best interceptor among its linebackers, from the line of scrimmage.
    const lbs = ctx.teams[defense].players.filter(p => p.position === 'LB');
    const thief = lbs.sort((a, b) => (('intercept' in b && b.intercept ? 49 - b.intercept.from : 0) - ('intercept' in a && a.intercept ? 49 - a.intercept.from : 0)))[0];
    steps.push(`Intercepted by ${name(thief)}, and returned all the way!`);
    outcome = {
      ...base, newBallOn: los, turnover: true, defensiveTouchdown: true, summary: `${name(thrower)} is intercepted by ${name(thief)}`,
      events: [
        ...(thrower ? [{ type: 'PASS' as const, side: offense, playerId: thrower.id, targetId: null, complete: false, yards: 0, touchdown: false, intercepted: true }] : []),
        ...(thief ? [{ type: 'INTERCEPTION' as const, side: defense, playerId: thief.id, returnYards: los, touchdown: true }] : []),
      ],
    };
  }
  const played: GameState = { ...nextPlay(state), rngState: time.rngState, deck: deck.snapshot(), defenseReady: false, defenseSetup: null, puntCall: null, fieldGoalCall: false, fakeKick: false };
  return applyScrimmage(played, outcome, ctx, { title: `${teamLabel(ctx, offense)}: fake ${kind === 'punt' ? 'punt' : 'field goal'}`, steps, cards: flips.cards });
}
