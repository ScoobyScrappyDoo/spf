import { fakeKickPlay } from './fakekick';
/**
 * Punts (rule 8.5). The offense declares the punt out loud (so the defense can answer with an all-out rush), the
 * punter's card gives the distance and who fields it, the punt return card the return. Z cards: penalties from
 * category 3, fumbles on the return; nobody gets hurt on kicking plays (8.8.4).
 */
import { FacDeck } from './deck';
import { nextPossession, recordTarget } from './endurance';
import { addEvents, nextPlay } from './events';
import {
  addLog, back, forward, LogDraft, fumbleLost, GameContext, PlayFlips, requirePhase, runClock, scoreTouchdown, spotPhrase, spotText, teamLabel,
} from './game';
import { backText, tickInjuries } from './injuries';
import { StatEventBody } from './model/events';
import { GameState, otherSide, PendingPenalty, PuntCall, PuntOutcome, Side } from './model/game';
import { PlayerCard, Punter } from './model/players';
import { Team } from './model/team';
import { choosePenalized, penaltyKind } from './penalty-players';

/** A yard line counted from the receiving team's goal, said the way it is: "the receiving team's 30", "the kicking team's 44". */
function receivingSpot(spot: number): string {
  if (spot === 50) return 'midfield';
  return spot < 50 ? `the receiving team's ${spot}` : `the kicking team's ${100 - spot}`;
}
import { SeededRandom } from './random';
import { PENALTY_NAMES } from './tables';

/** Timing table: "Punt or returned kickoff". */
const PUNT_SECONDS = 10;
/** A punt that comes down inside the opponent's 6 rolls into the end zone (rule 8.5.6), unless it's a coffin corner. */
const ROLLS_INTO_END_ZONE = 6;
/** The most a returner gets against an all-out rush (rule 8.5.7). */
const ALL_OUT_RUSH_MAX_RETURN = 3;

/** The offense says it will punt (or changes its mind). The defense has to set itself again either way. */
export function declarePunt(state: GameState, call: PuntCall | null): GameState {
  requirePhase(state, 'PLAY');
  if (call?.coffinCorner != null && (call.coffinCorner < 10 || call.coffinCorner > 25)) {
    throw new Error('A coffin-corner punt takes off 10 to 25 yards');
  }
  // A punt and a field goal can't both be on: announcing one drops the other.
  return { ...state, puntCall: call, fieldGoalCall: call ? false : state.fieldGoalCall, fakeKick: !!call?.fake, defenseReady: false, defenseSetup: null };
}

/** The most a play can take (the timing table's maximum, rule 6.1). */
const MAX_PLAY_SECONDS = 45;

/** Why the kicking team can't ask for a delay of game now, or null if it can (rule 8.5.3). */
export function delayOfGameBlocked(state: GameState): string | null {
  if (state.phase !== 'PLAY' || !state.puntCall) return 'Only before a punt';
  if (state.delayOfGame) return state.delayOfGame === 'ASKED' ? 'Waiting for the receiving team' : 'Once per punt';
  if ((state.ballOn ?? 0) <= 5) return 'Too close to the own goal line';
  return null;
}

/** The kicking team asks for a delay of game (rule 8.5.3); the receiving team then accepts or declines. */
export function askDelayOfGame(state: GameState, ctx: GameContext): GameState {
  const why = delayOfGameBlocked(state);
  if (why) throw new Error(why);
  return {
    ...state, delayOfGame: 'ASKED',
    log: addLog(state, { title: `${teamLabel(ctx, state.possession!)}: delay of game?`, steps: ['The kicking team asks for a delay of game penalty (rule 8.5.3): 5 yards, and the clock runs.'] }),
  };
}

/** How many seconds an accepted delay runs off: the previous play counts as the maximum (rule 8.5.3). */
export function delayRunoff(state: GameState): number {
  const last = [...(state.events ?? [])].reverse().find(e => e.type === 'SNAP');
  const taken = last && last.type === 'SNAP' ? last.seconds : MAX_PLAY_SECONDS;
  return Math.max(0, Math.min(MAX_PLAY_SECONDS - taken, state.clock - 1));
}

/** The receiving team's answer: accepted, 5 yards back and the clock runs; declined, nothing happens. */
export function answerDelayOfGame(state: GameState, accept: boolean, ctx: GameContext): GameState {
  if (state.delayOfGame !== 'ASKED') throw new Error('No delay of game has been asked for');
  const kicking = state.possession!;
  const receiving = otherSide(kicking);
  if (!accept) {
    return { ...state, delayOfGame: 'USED', log: addLog(state, { title: `${teamLabel(ctx, receiving)} decline the delay of game`, steps: ['Declined: the ball stays where it is.'] }) };
  }
  const runoff = delayRunoff(state);
  const ballOn = Math.max(1, (state.ballOn ?? 1) - 5);
  const moved: GameState = addEvents({ ...state, ballOn, distance: state.distance + ((state.ballOn ?? 1) - ballOn), clock: state.clock - runoff, delayOfGame: 'USED' },
    [{ type: 'PENALTY', side: kicking, playerId: null, name: 'Delay of game', yards: (state.ballOn ?? 1) - ballOn, accepted: true }]);
  return {
    ...moved,
    log: addLog(state, {
      title: `${teamLabel(ctx, receiving)} accept the delay of game`,
      steps: [`5 yards back: ${spotText(ballOn)}.`, runoff ? `The previous play counts as ${MAX_PLAY_SECONDS} seconds: ${runoff} more off the clock.` : 'The previous play already took the maximum time.'],
      result: `Delay of game on ${teamLabel(ctx, kicking)}, 5 yards.`,
    }),
  };
}

/** All the team's punter cards (the Patriots have two: Prestridge and Camarillo). */
export function puntersOf(team: Team): Punter[] {
  return team.players.filter((p): p is Punter => p.position === 'P');
}

/** The chosen punter, or the first one on the roster. */
export function punterOf(team: Team, punterId?: string): Punter | undefined {
  const punters = puntersOf(team);
  return punters.find(p => p.id === punterId) ?? punters[0];
}

/** "Same as PR-1" points at another column of the punt return card. */
function returnColumn(team: Team, returner: string): { column: string; name: string; playerId: string | null } {
  let column = returner;
  for (let i = 0; i < 4; i++) {
    const ref = team.puntReturn?.returners[column];
    if (ref && 'sameAs' in ref) column = ref.sameAs;
    else return { column, name: ref?.name ?? column, playerId: ref && 'playerId' in ref ? ref.playerId : null };
  }
  throw new Error(`Punt return card loops at ${returner}`);
}

interface PuntResult {
  outcome: PuntOutcome;
  /** For penalties on the return: where it began and ended, in the receiving team's yards. Null without a return. */
  landing: number | null;
  end: number | null;
  turnover: boolean;
  returner: string | null;
}

/** Punts: the whole play, from the punter's card to the change of possession. */
export function puntPlay(state: GameState, ctx: GameContext): GameState {
  requirePhase(state, 'PLAY');
  if (!state.puntCall) throw new Error('No punt has been declared');
  if (state.delayOfGame === 'ASKED') throw new Error('Waiting for the receiving team to answer the delay of game');
  if (!state.defenseReady || !state.defenseSetup) throw new Error('The defense is not set yet');
  if (state.fakeKick) return fakeKickPlay(state, ctx, 'punt');
  const kicking = state.possession!;
  const receiving = otherSide(kicking);
  const steps: string[] = [];
  const deck = new FacDeck(ctx.cards, state.deck);
  const flips = new PlayFlips(deck, true, steps);
  const rng = new SeededRandom(state.rngState);
  // Expecting a fake rules out the all-out rush (rule O6: no block on a real kick).
  const allOut = !!state.defenseSetup.allOutRush && !state.defenseSetup.expectFake;
  const coffin = state.puntCall.coffinCorner;
  const punter = punterOf(ctx.teams[kicking], state.puntCall.punterId);
  const title = `${teamLabel(ctx, kicking)}: punt`;
  if (allOut) steps.push(`${teamLabel(ctx, receiving)} come with an all-out punt rush.`);
  if (coffin) steps.push(`Coffin corner: ${coffin} yards taken off the punt.`);

  const result = resolvePunt(state, ctx, flips, steps, punter, allOut, coffin);
  let outcome = result.outcome;
  let pending: PendingPenalty | null = null;

  if (flips.zCard) {
    const z = flips.zResult();
    if (z.type === 'INJURY') {
      steps.push('Z result: injury, but nobody gets hurt on kicking plays (rule 8.8.4).');
    } else if (z.type === 'FUMBLE') {
      outcome = zFumble(z.homeTeamExempt, result, flips, ctx, kicking, receiving, steps) ?? outcome;
    } else {
      const pen = z.byCategory[2]; // category 3: field goals, punts and their returns
      const team = ctx.teams[pen.against === 'K' ? kicking : receiving];
      const who = choosePenalized(penaltyKind(pen.against, pen.penalty), team.players, rng);
      const applied = puntPenalty(pen.against, pen.penalty, state, result, flips, kicking, receiving, steps, who);
      if (applied && 'accept' in applied) pending = applied;
      else if (applied) outcome = applied;
    }
  }

  // A punt is a play: injuries tick down, it counts as a play in between for play direction (rule 4.6).
  const ticked = tickInjuries(state);
  steps.push(...ticked.healed.map(backText));
  const base: GameState = recordTarget(
    { ...nextPlay(ticked.state), rngState: rng.state, deck: deck.snapshot(), defenseReady: false, defenseSetup: null },
    null, null,
  );
  if (pending) {
    return { ...base, phase: 'PENALTY_CHOICE', pendingPenalty: pending, log: addLog(state, { title, steps, result: 'Penalty: the coach must decide.', cards: flips.cards }) };
  }
  return applyPunt(base, outcome, ctx, { title, steps, cards: flips.cards });
}

function resolvePunt(
  state: GameState, ctx: GameContext, flips: PlayFlips, steps: string[], punter: Punter | undefined, allOut: boolean, coffin: number | null,
): PuntResult {
  const kicking = state.possession!;
  const receiving = otherSide(kicking);
  const los = state.ballOn!;
  const team = ctx.teams[receiving];
  const punterId = punter?.id ?? null;
  const name = punter ? `${punter.firstName} ${punter.lastName}` : 'The punter';
  const puntEvent = (yards: number, extra: Partial<Extract<StatEventBody, { type: 'PUNT' }>> = {}): StatEventBody => ({
    type: 'PUNT', side: kicking, playerId: punterId, yards, touchback: false, inside20: false, fairCatch: false, blocked: false, ...extra,
  });
  const ball = (spot: number, summary: string, events: StatEventBody[]): PuntResult => ({
    outcome: { kind: 'PUNT', result: { type: 'RECEIVING', spot }, clockUsed: PUNT_SECONDS, summary, events }, landing: null, end: null, turnover: false, returner: null,
  });

  const first = flips.next();
  let row = punter?.punts[first.runNumber - 1];
  steps.push(`Punt: RN ${first.runNumber}${first.runNumber === 12 ? ', see below' : `, ${row?.yards} yards${row?.returner === 'FC' ? ', fair catch' : ` to ${row?.returner}`}`}.`);

  if (first.runNumber === 12) {
    const second = flips.next();
    if (allOut) {
      // Rule 8.5.7: 1-4 blocked, 5-9 hurried (the RN 11 punt), 10-12 roughing the kicker.
      if (second.runNumber <= 4) return blocked(state, ctx, flips, steps, puntEvent);
      if (second.runNumber >= 10) {
        const spot = forward(los, 15);
        steps.push(`RN ${second.runNumber}: roughing the kicker! 15 yards and a first down.`);
        return {
          outcome: {
            kind: 'PUNT', result: { type: 'KICKING_TEAM', ballOn: spot, firstDown: true }, clockUsed: PUNT_SECONDS,
            summary: `Roughing the kicker, ${teamLabel(ctx, kicking)} keep the ball at ${spotText(spot)}`,
            events: [{ type: 'PENALTY', side: receiving, playerId: null, name: 'Roughing the kicker', yards: spot - los, accepted: true }],
          },
          landing: null, end: null, turnover: false, returner: null,
        };
      }
      steps.push(`RN ${second.runNumber}: the punt is hurried, the RN 11 punt.`);
      row = punter?.punts[10];
    } else {
      const special = punter?.special.find(s => second.runNumber >= s.runNumber.from && second.runNumber <= s.runNumber.to)?.result ?? { type: 'PENALTY' as const };
      steps.push(`Special result: RN ${second.runNumber}.`);
      if (special.type === 'BLOCKED') return blocked(state, ctx, flips, steps, puntEvent);
      if (special.type === 'PENALTY') return punterCardPenalty(state, ctx, flips, steps);
      // A long punt nobody returns.
      const landing = los + special.yards - (coffin ?? 0);
      if (landing >= 100) {
        steps.push(`${special.yards} yards, into the end zone: touchback.`);
        return ball(20, 'Touchback', [puntEvent(special.yards - (coffin ?? 0), { touchback: true })]);
      }
      const spot = 100 - landing;
      steps.push(`${special.yards} yards, no return. Ball at ${receivingSpot(spot)}.`);
      return ball(spot, `${name} punts ${landing - los} yards, no return`, [puntEvent(landing - los, { inside20: spot <= 20 })]);
    }
  }

  const yards = (row?.yards ?? 0) - (coffin ?? 0);
  const landing = los + yards;
  // Into the end zone, or (not a coffin corner) inside the 6 where it rolls in: a touchback.
  if (landing >= 100 || (!coffin && 100 - landing < ROLLS_INTO_END_ZONE)) {
    steps.push(landing >= 100
      ? 'Into the end zone: touchback. Ball at the 20.'
      : `It comes down at the ${100 - landing} and rolls into the end zone (inside the 6, rule 8.5.6): touchback. Ball at the 20.`);
    return ball(20, `${name} punts into the end zone, touchback`, [puntEvent(Math.min(yards, 100 - los), { touchback: true })]);
  }
  const spot = 100 - landing;
  if (coffin && first.runNumber % 2 === 1) {
    steps.push(`RN ${first.runNumber} is odd: out of bounds at ${receivingSpot(spot)}, no return.`);
    return ball(spot, `${name} punts ${yards} yards, out of bounds`, [puntEvent(yards, { inside20: spot <= 20 })]);
  }
  if (row?.returner === 'FC') {
    steps.push(`Fair catch at ${receivingSpot(spot)}.`);
    return ball(spot, `${name} punts ${yards} yards, fair catch`, [puntEvent(yards, { fairCatch: true, inside20: spot <= 20 })]);
  }

  // The return (rule 8.5): RN on the punt return card, breakaway (*) and fumble (f) as for kickoffs.
  const { column, name: returner, playerId } = returnColumn(team, row?.returner ?? 'PR1');
  steps.push(`${returner} (${row?.returner}) fields it at ${spotPhrase(spot)}.`);
  const card = flips.next();
  const cell = team.puntReturn?.table[card.runNumber - 1][column];
  let gain = cell?.yards ?? 0;
  steps.push(`Return: RN ${card.runNumber} in column ${column}: ${gain} yards${cell?.breakaway ? ', breakaway chance' : ''}${cell?.fumble ? ', fumble' : ''}.`);
  if (cell?.breakaway) {
    const b = flips.next();
    const breakaway = team.puntReturn?.breakaway[column];
    if (b.runNumber <= 2 && breakaway != null) {
      gain = breakaway;
      steps.push(`Breakaway: RN ${b.runNumber}, he breaks it for ${gain} yards.`);
    } else {
      steps.push(`Breakaway: RN ${b.runNumber}, no breakaway.`);
    }
  }
  if (allOut && gain > ALL_OUT_RUSH_MAX_RETURN) {
    steps.push(`Against the all-out rush the return is held to ${ALL_OUT_RUSH_MAX_RETURN} yards.`);
    gain = ALL_OUT_RUSH_MAX_RETURN;
  }
  const end = spot + gain;
  const puntEv = puntEvent(yards, { inside20: spot <= 20 });
  const ret = (y: number, touchdown: boolean): StatEventBody => ({ type: 'PUNT_RETURN', side: receiving, playerId, name: returner, yards: y, touchdown });
  if (end >= 100) {
    steps.push(`${returner} takes it all the way!`);
    return {
      outcome: { kind: 'PUNT', result: { type: 'TOUCHDOWN', scorer: receiving }, clockUsed: PUNT_SECONDS, summary: `${returner} punt return touchdown`, events: [puntEv, ret(100 - spot, true)] },
      landing: spot, end: 100, turnover: false, returner: playerId,
    };
  }
  if (cell?.fumble) {
    const fumble = (lost: boolean): StatEventBody[] => (playerId ? [{ type: 'FUMBLE', side: receiving, playerId, lost }] : []);
    if (fumbleLost(flips, team, steps, 'the kicking team recovers', `${returner} falls on it`)) {
      return {
        outcome: {
          kind: 'PUNT', result: { type: 'KICKING_TEAM', ballOn: 100 - end, firstDown: true, newPossession: true }, clockUsed: PUNT_SECONDS,
          summary: `${returner} fumbles the return, ${teamLabel(ctx, kicking)} recover`, events: [puntEv, ret(gain, false), ...fumble(true)],
        },
        landing: spot, end, turnover: true, returner: playerId,
      };
    }
    steps.push(`${returner} returns it to ${spotPhrase(end)}.`);
    return {
      outcome: { kind: 'PUNT', result: { type: 'RECEIVING', spot: end }, clockUsed: PUNT_SECONDS, summary: `${returner} returns it ${gain} yards`, events: [puntEv, ret(gain, false), ...fumble(false)] },
      landing: spot, end, turnover: false, returner: playerId,
    };
  }
  steps.push(`${returner} returns it to ${spotPhrase(end)}.`);
  return {
    outcome: { kind: 'PUNT', result: { type: 'RECEIVING', spot: end }, clockUsed: PUNT_SECONDS, summary: `${returner} returns it ${gain} yards`, events: [puntEv, ret(gain, false)] },
    landing: spot, end, turnover: false, returner: playerId,
  };
}

/** Rule 8.5.5: blocked, recovered by the defense and returned RN x 5 yards from the line of scrimmage. */
function blocked(
  state: GameState, ctx: GameContext, flips: PlayFlips, steps: string[],
  puntEvent: (yards: number, extra: Partial<Extract<StatEventBody, { type: 'PUNT' }>>) => StatEventBody,
): PuntResult {
  const kicking = state.possession!;
  const receiving = otherSide(kicking);
  const card = flips.next(false);
  const spot = 100 - state.ballOn! + card.runNumber * 5;
  steps.push(`Blocked! The defense picks it up and runs it back ${card.runNumber * 5} yards (RN ${card.runNumber}).`);
  const events = [puntEvent(0, { blocked: true })];
  if (spot >= 100) {
    return {
      outcome: { kind: 'PUNT', result: { type: 'TOUCHDOWN', scorer: receiving }, clockUsed: PUNT_SECONDS, summary: `Blocked punt returned for a touchdown by ${teamLabel(ctx, receiving)}`, events },
      landing: null, end: null, turnover: false, returner: null,
    };
  }
  return {
    outcome: { kind: 'PUNT', result: { type: 'RECEIVING', spot }, clockUsed: PUNT_SECONDS, summary: `The punt is blocked and returned ${card.runNumber * 5} yards`, events },
    landing: null, end: null, turnover: false, returner: null,
  };
}

/** Rule 8.5.2: the punter's card says penalty. Even RN: movement on the kickers; odd: offside on the returners. No option. */
function punterCardPenalty(state: GameState, ctx: GameContext, flips: PlayFlips, steps: string[]): PuntResult {
  const kicking = state.possession!;
  const receiving = otherSide(kicking);
  const los = state.ballOn!;
  const card = flips.next(false);
  const onKickers = card.runNumber % 2 === 0;
  const spot = onKickers ? back(los, 5) : forward(los, 5);
  const firstDown = !onKickers && spot >= los + state.distance;
  steps.push(`Penalty card: RN ${card.runNumber} is ${onKickers ? 'even: movement on the kicking team, 5 yards back' : 'odd: offside on the receiving team, 5 yards'}. No option.`);
  steps.push(firstDown ? 'That gives the kicking team a first down.' : 'The punt is played again.');
  return {
    outcome: {
      kind: 'PUNT', result: { type: 'KICKING_TEAM', ballOn: spot, firstDown }, clockUsed: 0,
      summary: onKickers ? 'Movement on the kicking team, punt again from 5 yards back' : `Offside on the receiving team${firstDown ? ', first down' : ', punt again'}`,
      events: [{ type: 'PENALTY', side: onKickers ? kicking : receiving, playerId: null, name: onKickers ? 'Movement' : 'Offside', yards: Math.abs(spot - los), accepted: true }],
    },
    landing: null, end: null, turnover: false, returner: null,
  };
}

function zFumble(
  homeTeamExempt: boolean, result: PuntResult, flips: PlayFlips, ctx: GameContext, kicking: Side, receiving: Side, steps: string[],
): PuntOutcome | null {
  if (result.end === null || result.turnover || result.outcome.result.type !== 'RECEIVING') {
    steps.push('Z result: fumble, but there is no return to fumble on.');
    return null;
  }
  if (homeTeamExempt && receiving === 'home') {
    steps.push('Z result: "Fumble(s)", the returner is on the home team, so no fumble (rule 8.8.5).');
    return null;
  }
  steps.push('Z result: fumble on the return.');
  const fumble = (lost: boolean): StatEventBody[] => (result.returner ? [{ type: 'FUMBLE', side: receiving, playerId: result.returner, lost }] : []);
  if (!fumbleLost(flips, ctx.teams[receiving], steps, 'the kicking team recovers', 'the returner falls on it')) {
    return { ...result.outcome, events: [...(result.outcome.events ?? []), ...fumble(false)] };
  }
  return {
    kind: 'PUNT', result: { type: 'KICKING_TEAM', ballOn: 100 - result.end, firstDown: true, newPossession: true }, clockUsed: PUNT_SECONDS,
    summary: `Fumble on the return, ${teamLabel(ctx, kicking)} recover`, events: [...(result.outcome.events ?? []), ...fumble(true)],
  };
}

/** Category 3 penalties on a punt: K1/R1 offside, K14 delay, K5/K9/R5 personal fouls, R11 clipping, R12 roughing, R13 running into the kicker. */
function puntPenalty(
  against: string, number: number, state: GameState, result: PuntResult, flips: PlayFlips, kicking: Side, receiving: Side, steps: string[],
  who: PlayerCard | null,
): PuntOutcome | PendingPenalty | null {
  const name = PENALTY_NAMES[number] ?? `Penalty ${number}`;
  const onKickers = against === 'K';
  const los = state.ballOn!;
  steps.push(`Z result: ${name.toLowerCase()} on the ${onKickers ? 'kicking' : 'receiving'} team${who ? `: ${who.firstName} ${who.lastName} (${who.position})` : ''}.`);
  const flag = (yards: number, accepted: boolean): StatEventBody => ({
    type: 'PENALTY', side: onKickers ? kicking : receiving, playerId: who?.id ?? null, name, yards, accepted,
  });
  const keep = (ballOn: number, firstDown: boolean, summary: string, yards: number): PuntOutcome => ({
    kind: 'PUNT', result: { type: 'KICKING_TEAM', ballOn, firstDown: firstDown || ballOn >= los + state.distance }, clockUsed: 0, summary, events: [flag(yards, true)],
  });
  const declined = (): PuntOutcome => ({ ...result.outcome, events: [...(result.outcome.events ?? []), flag(0, false)], summary: `${result.outcome.summary} (${name.toLowerCase()} declined)` });
  const choice = (chooser: Side, description: string, accept: PuntOutcome): PendingPenalty => ({ chooser, description, accept, decline: declined() });

  if (result.turnover) {
    steps.push('The ball changed hands on the play, so the penalty is not enforced.');
    return null;
  }
  // Before or at the kick: the kicking team's offside and delay, the receivers' offside, roughing and running into the kicker.
  if (onKickers && (number === 1 || number === 14)) {
    const spot = back(los, 5);
    const outcome = keep(spot, false, `${name} on the kicking team, punt again from 5 yards back`, los - spot);
    if (number === 14) {
      steps.push('5 yards, no option: punt again.');
      return outcome;
    }
    return choice(receiving, `${name} on the kicking team. Accept: they punt again from 5 yards back. Decline: ${result.outcome.summary}.`, outcome);
  }
  if (!onKickers && (number === 1 || number === 12 || number === 13)) {
    const yards = number === 12 ? 15 : 5;
    const spot = forward(los, yards);
    const auto = number === 12;
    const outcome = keep(spot, auto, `${name} on the receiving team, ${spot - los} yards${auto ? ' and a first down' : ''}`, spot - los);
    return choice(kicking, `${name} on the receiving team. Accept: ${spot - los} yards${auto ? ' and a first down' : ', punt again'}. Decline: ${result.outcome.summary}.`, outcome);
  }
  // During the return: personal fouls and clipping, no option.
  if (result.end === null || result.landing === null) {
    steps.push('There was no return, so the penalty has no effect.');
    return null;
  }
  const outcomeAt = (spot: number, summary: string, yards: number): PuntOutcome => ({
    kind: 'PUNT', result: { type: 'RECEIVING', spot }, clockUsed: PUNT_SECONDS, summary,
    events: [...(result.outcome.events ?? []).map(e => (e.type === 'PUNT_RETURN' ? { ...e, touchdown: false } : e)), flag(yards, true)],
  });
  const end = Math.min(result.end, 99);
  if (number === 5 || number === 9) {
    if (onKickers) {
      if (result.outcome.result.type === 'TOUCHDOWN') {
        steps.push('The touchdown stands.');
        return null;
      }
      const spot = forward(end, 15);
      steps.push(`15 yards added to the return: ball at ${spotPhrase(spot, 'their')}.`);
      return outcomeAt(spot, `${name} on the kicking team, 15 yards added to the return`, spot - end);
    }
    const spot = back(end, 15);
    steps.push(`15 yards back from the end of the return: ball at ${spotPhrase(spot, 'their')}.`);
    return outcomeAt(spot, `${name} on the return, 15 yards back`, end - spot);
  }
  if (number === 11 && !onKickers) {
    const card = flips.next(false);
    const foulSpot = card.runNumber % 2 === 1 ? result.landing + Math.floor((end - result.landing) / 2) : end;
    const spot = back(foulSpot, 15);
    steps.push(`Spot of the foul: RN ${card.runNumber} is ${card.runNumber % 2 ? 'odd, halfway through the return' : 'even, where it ended'}. 15 yards back: ${spotPhrase(spot, 'their')}.`);
    return outcomeAt(spot, `Clipping on the return, 15 yards from the spot of the foul`, foulSpot - spot);
  }
  steps.push('This penalty has no effect on a punt.');
  return null;
}

/** Puts a punt's outcome into the game: the other team's ball, a score, or the kicking team keeps it. */
export function applyPunt(state: GameState, o: PuntOutcome, ctx: GameContext, entry: LogDraft): GameState {
  const kicking = state.possession!;
  const receiving = otherSide(kicking);
  const firstDownByPenalty = o.result.type === 'KICKING_TEAM' && o.result.firstDown && !o.result.newPossession;
  const s0 = addEvents(state, [
    { type: 'SNAP', side: kicking, down: state.down, distance: state.distance, seconds: o.clockUsed, firstDown: firstDownByPenalty, counted: false, ballOn: state.ballOn ?? undefined,
      endBallOn: o.result.type === 'KICKING_TEAM' ? o.result.ballOn : state.ballOn ?? undefined },
    ...(o.events ?? []),
  ], state);
  const steps = [...entry.steps, `${o.clockUsed} seconds off the clock.`];
  const log = (s: GameState, result: string) => ({ ...s, log: addLog(state, { ...entry, steps, result }) });

  switch (o.result.type) {
    case 'TOUCHDOWN':
      return scoreTouchdown(log({ ...s0, puntCall: null }, `${o.summary}. Touchdown!`), o.result.scorer, o.clockUsed, ctx);
    case 'RECEIVING': {
      const spot = Math.max(1, Math.min(99, o.result.spot));
      const s: GameState = { ...nextPossession(s0), puntCall: null, possession: receiving, ballOn: spot, down: 1, distance: Math.min(10, 100 - spot) };
      return runClock(log(s, `${o.summary}. ${teamLabel(ctx, receiving)} ball, 1st & 10 at ${spotText(spot)}.`), o.clockUsed, ctx);
    }
    case 'KICKING_TEAM': {
      const ballOn = Math.max(1, Math.min(99, o.result.ballOn));
      if (o.result.newPossession) {
        const s: GameState = { ...nextPossession(nextPossession(s0)), puntCall: null, ballOn, down: 1, distance: Math.min(10, 100 - ballOn) };
        return runClock(log(s, `${o.summary}. ${teamLabel(ctx, kicking)} ball, 1st & 10 at ${spotText(ballOn)}.`), o.clockUsed, ctx);
      }
      if (o.result.firstDown) {
        const s: GameState = { ...s0, puntCall: null, ballOn, down: 1, distance: Math.min(10, 100 - ballOn) };
        return runClock(log(s, `${o.summary}. First down at ${spotText(ballOn)}.`), o.clockUsed, ctx);
      }
      // The punt is played again: same down, the distance follows the new spot. The punt stays declared.
      const distance = state.ballOn! + state.distance - ballOn;
      const s: GameState = { ...s0, ballOn, distance };
      return runClock(log(s, `${o.summary}. Still ${['', '1st', '2nd', '3rd', '4th'][state.down]} & ${distance} at ${spotText(ballOn)}.`), o.clockUsed, ctx);
    }
  }
}

