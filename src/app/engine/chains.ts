/**
 * What every play from scrimmage shares, runs and passes alike: penalties (rule 6.3 and 8.8.3), the coach's choice
 * on a penalty, and moving the chains: score, downs, possession and clock (rule 9.0).
 */
import { applyFieldGoal } from './fieldgoal';
import { addLog, applyKickoffOutcome, LogDraft, back, forward, GameContext, requirePhase, runClock, scoreTouchdown, spotText, teamLabel } from './game';
import { addEvents } from './events';
import { nextPossession } from './endurance';
import { clamp } from './model/common';
import { StatEventBody } from './model/events';
import { GameState, otherSide, PendingPenalty, PlayOutcome, ScrimmageOutcome, Side } from './model/game';
import { applyPunt } from './punt';
import { PENALTY_NAMES } from './tables';
import { inFinalMinutes, OUT_OF_BOUNDS_SECONDS } from './timing';

export const MIN_PLAY_SECONDS = 20;
export const TOUCHDOWN_SECONDS = 10;

// ---------------------------------------------------------------------------------------------
// Penalties on plays from scrimmage (rule 6.3 and 8.8.3)
// ---------------------------------------------------------------------------------------------

/** What a penalty on a pass needs to know (rule 6.3 #7, #8, #10). */
export interface PassPenaltyContext {
  play: 'QK' | 'SH' | 'LG' | 'SC';
  incomplete: boolean;
  /** The defender covering the receiver: pass interference is called on him. */
  coveringDefender: { label: string; id: string } | null;
  /** Flips a card for the spot of a pass interference foul. */
  runNumber: () => number;
}

/** Where along the pass a foul or an interception happens: yards past the line of scrimmage (rule 8.3.5.3). */
export function yardsAlongPass(play: 'QK' | 'SH' | 'LG' | 'SC', rn: number): number {
  return play === 'SC' ? rn - 6 : play === 'QK' ? rn : play === 'SH' ? rn * 2 : rn * 4;
}

export function scrimmagePenalty(
  against: string, number: number, state: GameState, run: ScrimmageOutcome, offense: Side, steps: string[],
  who: { label: string; id: string } | null = null, pass: PassPenaltyContext | null = null,
): ScrimmageOutcome | PendingPenalty | null {
  const name = PENALTY_NAMES[number] ?? `Penalty ${number}`;
  const onOffense = against === 'O';
  // Pass interference on the defense is called on the defender covering the receiver (rule 8.3.2.2).
  if (pass && number === 8 && !onOffense && pass.coveringDefender) who = pass.coveringDefender;
  steps.push(`Z result: ${name.toLowerCase()} on the ${onOffense ? 'offense' : 'defense'}${who ? `: ${who.label}` : ', on the team'}.`);
  const los = state.ballOn!;
  const defense = otherSide(offense);
  // For the stats: who, what, how many yards, and whether it was enforced. A penalty that wipes out the play drops the run.
  const flag = (yards: number, accepted: boolean): StatEventBody => ({
    type: 'PENALTY', side: onOffense ? offense : defense, playerId: who?.id ?? null, name, yards, accepted,
  });
  const replay = (spot: number, summary: string, autoFirstDown = false): ScrimmageOutcome => ({
    kind: 'SCRIMMAGE', newBallOn: spot, countsAsDown: false, autoFirstDown, turnover: false,
    clockUsed: run.clockUsed, outOfBounds: false, summary, events: [flag(Math.abs(spot - los), true)],
  });
  const choice = (chooser: Side, description: string, accept: ScrimmageOutcome): PendingPenalty => ({
    chooser, description, accept,
    decline: { ...run, summary: `${run.summary} (${name.toLowerCase()} declined)`, events: [...(run.events ?? []), flag(Math.abs(accept.newBallOn - los), false)] },
  });

  if (run.turnover) {
    steps.push('The ball changed hands on the play, so the penalty is not enforced.');
    return null;
  }

  if (onOffense) {
    const yards = number === 7 ? 10 : number === 5 || number === 9 ? 15 : 5;
    const spot = back(los, yards);
    const accepted = replay(spot, `${name} on the offense, ${los - spot} yards, the down is replayed`);
    // Movement, illegal procedure and delay of game happen before the snap: no option, no play (rule 6.3 #2, #3, #14).
    if (number === 2 || number === 3 || number === 14) {
      steps.push(`${los - spot} yards, no option: the play doesn't count.`);
      return accepted;
    }
    if ((number === 8 || number === 10) && !pass) {
      steps.push('That penalty only applies to passes; no effect on a run.');
      return null;
    }
    if (pass && number === 10) {
      // Intentional grounding: only on an incomplete pass. 15 yards, the down counts, no option.
      if (!pass.incomplete) {
        steps.push('Intentional grounding only counts on an incomplete pass: no effect.');
        return null;
      }
      const spot15 = back(los, 15);
      steps.push(`${los - spot15} yards and loss of down, no option.`);
      return { ...replay(spot15, `Intentional grounding, ${los - spot15} yards and loss of down`), countsAsDown: true };
    }
    if (pass && number === 8) {
      // Offensive pass interference: 15 yards, down and play count, the defense may decline.
      const spot15 = back(los, 15);
      return choice(defense, `${name} on the offense. Accept: ${los - spot15} yards back and the down counts. Decline: ${run.summary}.`,
        { ...replay(spot15, `Offensive pass interference, ${los - spot15} yards and the down counts`), countsAsDown: true });
    }
    if (pass && number === 7 && pass.play !== 'SC' && pass.play !== 'QK' && los <= 5) {
      // Holding on a pass from inside your own 5 is a safety (rule 8.8.3).
      steps.push('Holding on a pass from inside the 5: safety!');
      return { ...replay(0, 'Holding in the end zone, safety'), countsAsDown: true };
    }
    return choice(defense, `${name} on the offense. Accept: ${los - spot} yards back, replay the down from ${spotText(spot)}. Decline: ${run.summary}.`, accepted);
  }

  // On the defense.
  if (number === 5 || number === 6 || number === 9) {
    // Personal fouls and facemasks: from the end of the play, down and play count, no option.
    const yards = number === 6 ? 5 : 15;
    if (run.newBallOn >= 100) {
      steps.push('The touchdown stands.');
      return null;
    }
    const spot = forward(run.newBallOn, yards);
    steps.push(`${spot - run.newBallOn} more yards from the end of the play, no option.`);
    return {
      ...run, newBallOn: spot, events: [...(run.events ?? []), flag(spot - run.newBallOn, true)],
      summary: `${run.summary}, plus ${spot - run.newBallOn} for the ${name.toLowerCase()}`,
    };
  }
  if (pass && number === 8) {
    // Defensive pass interference: a first down at the spot of the foul; in the end zone, 1st & goal at the 1.
    const along = yardsAlongPass(pass.play, pass.runNumber());
    const foul = Math.min(99, Math.max(los + 1, los + along));
    steps.push(`Spot of the foul: ${foul - los} yards downfield${los + along >= 100 ? ', in the end zone: ball at the 1' : ''}.`);
    return choice(offense, `${name} on the defense. Accept: a first down at ${spotText(foul)}. Decline: ${run.summary}.`,
      { ...replay(foul, `Pass interference, first down at ${spotText(foul)}`, true), events: [flag(foul - los, true)] });
  }
  if (number === 8 || number === 10 || number >= 11) {
    steps.push(pass ? 'That penalty has no effect here.' : 'That penalty has no effect on a run.');
    return null;
  }
  const spot = forward(los, 5);
  if (number === 2 || number === 3) {
    steps.push(`${spot - los} yards from the line of scrimmage, no option: replay the down.`);
    return replay(spot, `${name} on the defense, ${spot - los} yards`);
  }
  const auto = number === 7; // defensive holding: 5 yards and an automatic first down
  return choice(
    offense,
    `${name} on the defense. Accept: ${spot - los} yards${auto ? ' and a first down' : ', replay the down'}. Decline: ${run.summary}.`,
    replay(spot, `${name} on the defense, ${spot - los} yards${auto ? ', automatic first down' : ''}`, auto),
  );
}

/** The coach accepts or declines a penalty, on a kickoff or a play from scrimmage. */
export function choosePenalty(state: GameState, accept: boolean, ctx: GameContext): GameState {
  requirePhase(state, 'PENALTY_CHOICE');
  const pending = state.pendingPenalty!;
  const outcome: PlayOutcome = accept ? pending.accept : pending.decline;
  const entry = { title: `${teamLabel(ctx, pending.chooser)} ${accept ? 'accept' : 'decline'} the penalty`, steps: [outcome.summary] };
  const cleared = { ...state, pendingPenalty: null };
  if (outcome.kind === 'SCRIMMAGE') return applyScrimmage({ ...cleared, phase: 'PLAY' }, outcome, ctx, entry);
  if (outcome.kind === 'PUNT') return applyPunt({ ...cleared, phase: 'PLAY' }, outcome, ctx, entry);
  if (outcome.kind === 'FIELD_GOAL') return applyFieldGoal({ ...cleared, phase: 'PLAY' }, outcome, ctx, entry);
  return applyKickoffOutcome({ ...cleared, log: addLog(state, entry) }, outcome, ctx);
}

// ---------------------------------------------------------------------------------------------
// Moving the chains
// ---------------------------------------------------------------------------------------------

const ORDINAL = ['', '1st', '2nd', '3rd', '4th'];

/** Puts a scrimmage outcome into the game: score, downs, possession and clock. */
export function applyScrimmage(
  state: GameState, o: ScrimmageOutcome, ctx: GameContext, entry: LogDraft,
): GameState {
  const offense = state.possession!;
  const defense = otherSide(offense);
  const los = state.ballOn!;
  const lineToGain = los + state.distance;
  const touchdown = o.newBallOn >= 100 && !o.turnover;
  const firstDown = touchdown || (!o.turnover && o.newBallOn > 0 && (o.autoFirstDown || o.newBallOn >= lineToGain));
  const record = (s: GameState, seconds: number) =>
    addEvents(s, [
      {
        type: 'SNAP', side: offense, down: state.down, distance: state.distance, seconds, firstDown, counted: o.countsAsDown, ballOn: los,
        // Where the play ended for the offense; an interception counts from the line of scrimmage.
        endBallOn: Math.max(0, Math.min(100, (o.events ?? []).some(e => e.type === 'INTERCEPTION') ? los : o.newBallOn)),
      },
      ...(o.events ?? []).map(e => ((e.type === 'RUSH' || (e.type === 'PASS' && e.complete)) && touchdown ? { ...e, touchdown: true } : e)),
      ...(o.newBallOn <= 0 && !o.turnover ? [{ type: 'SAFETY' as const, side: defense }] : []),
    ], state);
  if (touchdown) {
    return scoreTouchdown(record({ ...state, log: addLog(state, { ...entry, result: `${o.summary}. Touchdown!` }) }, TOUCHDOWN_SECONDS), offense, TOUCHDOWN_SECONDS, ctx);
  }
  if (o.defensiveTouchdown) {
    const s = nextPossession(record({ ...state, log: addLog(state, { ...entry, result: `${o.summary}. Touchdown ${teamLabel(ctx, defense)}!` }) }, TOUCHDOWN_SECONDS));
    return scoreTouchdown({ ...s, possession: defense }, defense, TOUCHDOWN_SECONDS, ctx);
  }
  const log = (s: GameState, result: string) => ({ ...s, log: addLog(state, { ...entry, result }) });

  // Final minutes (rule 9.4): out of bounds stops the clock sooner, sooner still in a two-minute offense.
  let seconds = o.clockUsed;
  let why = '';
  if (inFinalMinutes(state) && o.outOfBounds) {
    seconds = OUT_OF_BOUNDS_SECONDS[o.twoMinute ? 'twoMinute' : 'normal'];
    why = ', out of bounds';
  }
  // Two-minute warning (rule 9.3): the play that reaches 2:00 uses the minimum time.
  if ((state.quarter === 2 || state.quarter === 4) && state.clock > 120 && state.clock - seconds <= 120) {
    seconds = Math.min(seconds, MIN_PLAY_SECONDS);
    why = ', two-minute warning';
  }
  // A timeout (rule 9.2) stops the clock: the play takes the short time, like a play out of bounds. It's called after
  // the play, so only if the clock would run: after an incompletion, a penalty, out of bounds, the two-minute warning
  // or a change of possession the clock has stopped anyway, and the team keeps its timeout.
  const stoppedAnyway = !!why || o.turnover || (o.events ?? []).some(e => (e.type === 'PASS' && !e.complete) || (e.type === 'PENALTY' && e.accepted));
  if (o.timeout && (state.timeouts?.[o.timeout] ?? 0) > 0 && !stoppedAnyway) {
    seconds = Math.min(seconds, OUT_OF_BOUNDS_SECONDS[o.twoMinute ? 'twoMinute' : 'normal']);
    const left = state.timeouts[o.timeout] - 1;
    state = { ...state, timeouts: { ...state.timeouts, [o.timeout]: left } };
    entry = { ...entry, steps: [...entry.steps, `${teamLabel(ctx, o.timeout)} takes a timeout, ${left} remaining.`] };
    state = addEvents(state, [{ type: 'TIMEOUT', side: o.timeout, left }]); // for the drive chart and the play-by-play
    why = ', timeout';
  }
  seconds = Math.min(seconds, state.clock);
  const fast = o.twoMinute ? (inFinalMinutes(state) ? ' (two-minute offense)' : ' (no-huddle)') : '';
  const clockStep = `${seconds} seconds off the clock${fast}${why}.`;
  // Rule 8.7: a no-huddle play that leaves the clock running keeps the defense from substituting on the next play.
  const penalty = (o.events ?? []).some(e => e.type === 'PENALTY' && e.accepted);
  const incomplete = (o.events ?? []).some(e => e.type === 'PASS' && !e.complete);
  const stopped = !!why || penalty || (inFinalMinutes(state) && incomplete);
  state = { ...state, noHuddleLock: o.twoMinute && !stopped ? { side: offense } : null };
  entry = { ...entry, steps: [...entry.steps, clockStep] };
  state = record(state, seconds);

  if (o.turnover) {
    const spot = clamp(100 - o.newBallOn, 1, 99);
    const s: GameState = { ...nextPossession(state), possession: defense, ballOn: spot, down: 1, distance: Math.min(10, 100 - spot) };
    return runClock(log(s, `${o.summary}. ${teamLabel(ctx, defense)} ball, 1st & 10 at ${spotText(spot)}.`), seconds, ctx);
  }
  if (o.newBallOn <= 0) {
    const score = { ...state.score, [defense]: state.score[defense] + 2 };
    const s: GameState = {
      ...state, score, phase: 'KICKOFF', possession: null, ballOn: null,
      kickoff: { kicking: offense, afterSafety: true, landingShift: 0 },
    };
    return runClock(log(s, `${o.summary}. Safety! 2 points for ${teamLabel(ctx, defense)}.`), seconds, ctx);
  }

  const spot = o.newBallOn;
  if (o.autoFirstDown || spot >= lineToGain) {
    const s: GameState = { ...state, ballOn: spot, down: 1, distance: Math.min(10, 100 - spot) };
    return runClock(log(s, `${o.summary}. First down at ${spotText(spot)}.`), seconds, ctx);
  }
  const down = o.countsAsDown ? state.down + 1 : state.down;
  if (down > 4) {
    const turned = clamp(100 - spot, 1, 99);
    const s: GameState = { ...nextPossession(state), possession: defense, ballOn: turned, down: 1, distance: Math.min(10, 100 - turned) };
    return runClock(log(s, `${o.summary}. Turnover on downs: ${teamLabel(ctx, defense)} ball at ${spotText(turned)}.`), seconds, ctx);
  }
  const distance = lineToGain - spot;
  const s: GameState = { ...state, ballOn: spot, down, distance };
  const toGo = spot + distance >= 100 ? 'goal' : String(distance);
  return runClock(log(s, `${o.summary}. ${ORDINAL[down]} & ${toGo} at ${spotText(spot)}.`), seconds, ctx);
}

