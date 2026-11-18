import { fakeKickPlay } from './fakekick';
/**
 * Field goals (rule 8.6.1). Any down, from within 38 yards of the goal: the kick is the line of scrimmage plus
 * 17 yards. One card: its PN against the kicker's range for the distance. Over 50 yards, 2 come off the 46-50 range
 * for every yard; 60 is the limit. PN 48 (47-48 over 50 yards) is blocked and returned for a touchdown.
 * Z cards: category 3 penalties; nobody gets hurt on kicking plays (8.8.4).
 */
import { FacDeck } from './deck';
import { nextPossession, recordTarget } from './endurance';
import { addEvents, nextPlay } from './events';
import { addLog, back, LogDraft, forward, GameContext, PlayFlips, requirePhase, runClock, scoreTouchdown, spotText, teamLabel } from './game';
import { backText, tickInjuries } from './injuries';
import { inRange, Range } from './model/common';
import { StatEventBody } from './model/events';
import { FieldGoalOutcome, GameState, otherSide, PendingPenalty, Side } from './model/game';
import { Kicker, PlayerCard } from './model/players';
import { Team } from './model/team';
import { choosePenalized, penaltyKind } from './penalty-players';
import { SeededRandom } from './random';
import { PENALTY_NAMES } from './tables';

/** Timing table: "Field goal". */
const FIELD_GOAL_SECONDS = 5;
/** The line of scrimmage must be within this many yards of the goal. */
export const FIELD_GOAL_RANGE = 38;
/** From the line of scrimmage to the goal posts. */
export const FIELD_GOAL_ADDED_YARDS = 17;
export const LONGEST_FIELD_GOAL = 60;

export function kickerOf(team: Team): Kicker | undefined {
  return team.players.find((p): p is Kicker => p.position === 'K');
}

/** The kick's length from where the ball is. */
export function fieldGoalDistance(ballOn: number): number {
  return 100 - ballOn + FIELD_GOAL_ADDED_YARDS;
}

/** Why a field goal can't be tried from here, or null if it can. */
export function fieldGoalBlockedReason(state: Pick<GameState, 'ballOn' | 'phase'>): string | null {
  if (state.phase !== 'PLAY' || state.ballOn === null) return 'Not now';
  if (100 - state.ballOn > FIELD_GOAL_RANGE) return `Out of range: the ball must be within ${FIELD_GOAL_RANGE} yards of the goal`;
  return null;
}

/** The kicker's "good" range for a distance; beyond 50 yards, 2 off the 46-50 range per yard (rule 8.6.1). */
export function goodRange(kicker: Kicker | undefined, distance: number): Range | null {
  if (!kicker || distance > LONGEST_FIELD_GOAL) return null;
  if (distance > 50) {
    // A kicker without a 46-50 range (his longest was shorter) has no range beyond 50 either.
    const band = kicker.fieldGoals.find(b => b.minYards === 46);
    if (!band?.good) return null;
    const to = band.good.to - 2 * (distance - 50);
    return to >= band.good.from ? { from: band.good.from, to } : null;
  }
  return kicker.fieldGoals.find(b => distance >= b.minYards && distance <= b.maxYards)?.good ?? null;
}

/** The offense lines up to kick, or changes its mind. The defense sets itself again either way; a punt call is dropped. */
export function declareFieldGoal(state: GameState, on: boolean, fake = false): GameState {
  requirePhase(state, 'PLAY');
  if (on) {
    const why = fieldGoalBlockedReason(state);
    if (why) throw new Error(why);
  }
  return { ...state, fieldGoalCall: on, fakeKick: on && fake, puntCall: on ? null : state.puntCall, defenseReady: false, defenseSetup: null };
}

export function fieldGoalPlay(state: GameState, ctx: GameContext): GameState {
  requirePhase(state, 'PLAY');
  if (!state.fieldGoalCall) throw new Error('No field goal has been called');
  if (!state.defenseReady || !state.defenseSetup) throw new Error('The defense is not set yet');
  if (state.fakeKick) return fakeKickPlay(state, ctx, 'field-goal');
  const kicking = state.possession!;
  const defense = otherSide(kicking);
  const steps: string[] = [];
  const deck = new FacDeck(ctx.cards, state.deck);
  const flips = new PlayFlips(deck, true, steps);
  const rng = new SeededRandom(state.rngState);
  const kicker = kickerOf(ctx.teams[kicking]);
  const distance = fieldGoalDistance(state.ballOn!);
  const name = kicker ? `${kicker.firstName} ${kicker.lastName}` : 'The kicker';
  const range = goodRange(kicker, distance);
  const title = `${teamLabel(ctx, kicking)}: ${distance}-yard field goal`;
  const event = (good: boolean, blocked = false): StatEventBody => ({ type: 'FIELD_GOAL', side: kicking, playerId: kicker?.id ?? null, distance, good, blocked });

  const blockedFrom = distance > 50 ? 47 : 48;
  let card = flips.next();
  // Rule O6: a defense expecting a fake can't block a real kick; a block result is resolved again.
  while (state.defenseSetup?.expectFake && card.passNumber >= blockedFrom) {
    steps.push(`PN ${card.passNumber} would be a block, but the defense expected a fake: a new card.`);
    card = flips.next();
  }
  let outcome: FieldGoalOutcome;
  if (card.passNumber >= blockedFrom) {
    steps.push(`PN ${card.passNumber}: blocked! The defense returns it for a touchdown.`);
    outcome = { kind: 'FIELD_GOAL', result: { type: 'BLOCKED', scorer: defense }, clockUsed: FIELD_GOAL_SECONDS, summary: `${name}'s ${distance}-yard try is blocked and returned for a touchdown`, events: [event(false, true)] };
  } else {
    const good = inRange(card.passNumber, range);
    steps.push(`PN ${card.passNumber} against ${name}'s ${range ? `${range.from}-${range.to}` : 'nothing'} from ${distance} yards: ${good ? 'good!' : 'no good.'}`);
    outcome = good
      ? { kind: 'FIELD_GOAL', result: { type: 'GOOD' }, clockUsed: FIELD_GOAL_SECONDS, summary: `${name}'s ${distance}-yard field goal is good`, events: [event(true)] }
      : { kind: 'FIELD_GOAL', result: { type: 'MISSED', spot: Math.max(20, 100 - state.ballOn!) }, clockUsed: FIELD_GOAL_SECONDS, summary: `${name}'s ${distance}-yard try is no good`, events: [event(false)] };
  }

  let pending: PendingPenalty | null = null;
  if (flips.zCard) {
    const z = flips.zResult();
    if (z.type === 'INJURY') steps.push('Z result: injury, but nobody gets hurt on kicking plays (rule 8.8.4).');
    else if (z.type === 'FUMBLE') steps.push('Z result: fumble, but there is nothing to fumble on a field goal.');
    else {
      const pen = z.byCategory[2]; // category 3: field goals, punts and their returns
      const team = ctx.teams[pen.against === 'K' ? kicking : defense];
      const who = choosePenalized(penaltyKind(pen.against, pen.penalty), team.players, rng);
      const applied = fieldGoalPenalty(pen.against, pen.penalty, state, outcome, kicking, defense, steps, who);
      if (applied && 'accept' in applied) pending = applied;
      else if (applied) outcome = applied;
    }
  }

  const ticked = tickInjuries(state);
  steps.push(...ticked.healed.map(backText));
  const base: GameState = recordTarget(
    { ...nextPlay(ticked.state), rngState: rng.state, deck: deck.snapshot(), defenseReady: false, defenseSetup: null },
    null, null,
  );
  if (pending) {
    return { ...base, phase: 'PENALTY_CHOICE', pendingPenalty: pending, log: addLog(state, { title, steps, result: 'Penalty: the coach must decide.', cards: flips.cards }) };
  }
  return applyFieldGoal(base, outcome, ctx, { title, steps, cards: flips.cards });
}

/** Category 3 penalties on a field goal try. A penalty that keeps the ball for the kickers means kicking again. */
function fieldGoalPenalty(
  against: string, number: number, state: GameState, result: FieldGoalOutcome, kicking: Side, defense: Side, steps: string[], who: PlayerCard | null,
): FieldGoalOutcome | PendingPenalty | null {
  const name = PENALTY_NAMES[number] ?? `Penalty ${number}`;
  const onKickers = against === 'K';
  const los = state.ballOn!;
  steps.push(`Z result: ${name.toLowerCase()} on the ${onKickers ? 'kicking team' : 'defense'}${who ? `: ${who.firstName} ${who.lastName} (${who.position})` : ''}.`);
  const flag = (yards: number, accepted: boolean): StatEventBody => ({
    type: 'PENALTY', side: onKickers ? kicking : defense, playerId: who?.id ?? null, name, yards, accepted,
  });
  const keep = (ballOn: number, firstDown: boolean, summary: string, yards: number): FieldGoalOutcome => ({
    kind: 'FIELD_GOAL', result: { type: 'KICKING_TEAM', ballOn, firstDown: firstDown || ballOn >= los + state.distance },
    clockUsed: FIELD_GOAL_SECONDS, summary, events: [flag(yards, true)],
  });
  const declined = (): FieldGoalOutcome => ({ ...result, events: [...(result.events ?? []), flag(0, false)], summary: `${result.summary} (${name.toLowerCase()} declined)` });
  if (result.result.type === 'BLOCKED') {
    steps.push('The blocked kick was returned for a touchdown; the penalty is not enforced.');
    return null;
  }
  if (onKickers) {
    const yards = number === 5 || number === 9 ? 15 : number === 1 || number === 14 ? 5 : 0;
    if (!yards) {
      steps.push('This penalty has no effect on a field goal.');
      return null;
    }
    const spot = back(los, yards);
    const outcome = keep(spot, false, `${name} on the kicking team, ${los - spot} yards back, kick again`, los - spot);
    if (number === 14) {
      steps.push('5 yards, no option: kick again from farther back.');
      return outcome;
    }
    return { chooser: defense, description: `${name} on the kicking team. Accept: ${los - spot} yards back and they kick again. Decline: ${result.summary}.`, accept: outcome, decline: declined() };
  }
  // On the defense: offside 5, running into the kicker 5, roughing the kicker and personal fouls 15 and a first down.
  const yards = number === 12 || number === 5 || number === 9 ? 15 : number === 1 || number === 13 ? 5 : 0;
  if (!yards) {
    steps.push('This penalty has no effect on a field goal.');
    return null;
  }
  const auto = yards === 15;
  const spot = forward(los, yards);
  const outcome = keep(spot, auto, `${name} on the defense, ${spot - los} yards${auto ? ' and a first down' : ', kick again'}`, spot - los);
  return { chooser: kicking, description: `${name} on the defense. Accept: ${spot - los} yards${auto ? ' and a first down' : ' and kick again'}. Decline: ${result.summary}.`, accept: outcome, decline: declined() };
}

/** Puts a field goal try into the game: 3 points and a kickoff, the other team's ball, or the kickers keep it. */
export function applyFieldGoal(state: GameState, o: FieldGoalOutcome, ctx: GameContext, entry: LogDraft): GameState {
  const kicking = state.possession!;
  const defense = otherSide(kicking);
  const s0 = addEvents(state, [
    { type: 'SNAP', side: kicking, down: state.down, distance: state.distance, seconds: o.clockUsed,
      firstDown: o.result.type === 'KICKING_TEAM' && o.result.firstDown, counted: false, ballOn: state.ballOn ?? undefined,
      // A field goal drive is measured to where the kick was snapped, as a box score counts it.
      endBallOn: o.result.type === 'KICKING_TEAM' ? o.result.ballOn : state.ballOn ?? undefined },
    ...(o.events ?? []),
  ], state);
  const steps = [...entry.steps, `${o.clockUsed} seconds off the clock.`];
  const log = (s: GameState, result: string) => ({ ...s, log: addLog(state, { ...entry, steps, result }) });

  switch (o.result.type) {
    case 'GOOD': {
      const score = { ...s0.score, [kicking]: s0.score[kicking] + 3 };
      const s: GameState = {
        ...s0, score, fieldGoalCall: false, phase: 'KICKOFF', possession: null, ballOn: null,
        kickoff: { kicking, afterSafety: false, landingShift: 0 },
      };
      return runClock(log(s, `${o.summary}. ${teamLabel(ctx, kicking)} ${score[kicking]}, ${teamLabel(ctx, defense)} ${score[defense]}.`), o.clockUsed, ctx);
    }
    case 'MISSED': {
      const spot = o.result.spot;
      const s: GameState = { ...nextPossession(s0), fieldGoalCall: false, possession: defense, ballOn: spot, down: 1, distance: Math.min(10, 100 - spot) };
      return runClock(log(s, `${o.summary}. ${teamLabel(ctx, defense)} ball, 1st & 10 at ${spotText(spot)}.`), o.clockUsed, ctx);
    }
    case 'BLOCKED':
      return scoreTouchdown(log({ ...s0, fieldGoalCall: false }, `${o.summary}.`), o.result.scorer, o.clockUsed, ctx);
    case 'KICKING_TEAM': {
      const ballOn = Math.max(1, Math.min(99, o.result.ballOn));
      if (o.result.firstDown) {
        const s: GameState = { ...s0, fieldGoalCall: false, ballOn, down: 1, distance: Math.min(10, 100 - ballOn) };
        return runClock(log(s, `${o.summary}. First down at ${spotText(ballOn)}.`), o.clockUsed, ctx);
      }
      const distance = state.ballOn! + state.distance - ballOn;
      // Kicking again: from out of range, the field goal call is dropped and the coach decides afresh.
      const still = 100 - ballOn <= FIELD_GOAL_RANGE;
      const s: GameState = { ...s0, fieldGoalCall: still, ballOn, distance };
      return runClock(log(s, `${o.summary}. Still ${['', '1st', '2nd', '3rd', '4th'][state.down]} & ${distance} at ${spotText(ballOn)}.`), o.clockUsed, ctx);
    }
  }
}
