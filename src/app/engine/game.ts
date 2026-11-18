import { FacDeck } from './deck';
import { inRange } from './model/common';
import { DealtCard, Fac, RegularFac, ZResult } from './model/fac';
import {
  Coin, GameState, KickoffOutcome, LogEntry, otherSide, PendingPenalty, Side, TossChoice,
} from './model/game';
import { Team } from './model/team';
import { SeededRandom } from './random';
import { KICKOFF_A, KICKOFF_B, PENALTY_NAMES } from './tables';
import { backText, healAtQuarterEnd, tickInjuries } from './injuries';
import { nextPossession, recordTarget } from './endurance';
import { choosePenalized, penaltyKind } from './penalty-players';
import { addEvents, nextPlay } from './events';
import { StatEventBody } from './model/events';

/** What the rules need besides the game state: the deck's cards and both teams' card sets. */
export interface GameContext {
  cards: readonly Fac[];
  teams: Record<Side, Team>;
}

export interface GameSetup {
  homeTeamId: string;
  awayTeamId: string;
  /** Fixes all the randomness, for tests and later for online play. Random when left out. */
  seed?: number;
  /** House rules this game is played with (settings.ts). */
  rules?: GameRules;
  /** Who plays each side: a name, or "AI" for the computer coach. */
  coaches?: Coaches;
}

/** Who plays each side: a name (30 characters at most), or "AI". */
export interface Coaches {
  home?: string;
  away?: string;
}
export const COACH_NAME_MAX = 30;

/** House rules, fixed for a game when it starts. */
export interface GameRules {
  /** The no-huddle offense at any time, with the fast timing (normally only in the final minutes, rule 9.4.1). */
  noHuddleAnyTime?: boolean;
  /** The computer coach's temperament: how far its reading of the field tilts its choices. */
  coachTemperament?: 'cautious' | 'normal' | 'bold';
}

const QUARTER_SECONDS = 15 * 60;
const KICK_RETURN_SECONDS = 10; // Timing table: "Punt or Returned Kickoff"

// ---------------------------------------------------------------------------------------------
// Text helpers for the play log
// ---------------------------------------------------------------------------------------------

/** "own 27", "midfield", "opponent's 35". Yard lines are counted from the team's own goal line. */
export function spotText(ballOn: number): string {
  if (ballOn === 50) return 'midfield';
  return ballOn < 50 ? `own ${ballOn}` : `opponent's ${100 - ballOn}`;
}

const ORDINAL = ['', '1st', '2nd', '3rd', '4th'];

/** "1st & 10 at own 27", "3rd & goal at opponent's 4". */
export function situationText(state: GameState): string {
  if (state.ballOn === null) return '';
  const toGo = state.ballOn + state.distance >= 100 ? 'goal' : String(state.distance);
  return `${ORDINAL[state.down]} & ${toGo} at ${spotText(state.ballOn)}`;
}

/** "Q1 14:50" */
export function clockText(state: GameState): string {
  const m = Math.floor(state.clock / 60);
  const s = String(state.clock % 60).padStart(2, '0');
  return `${quarterLabel(state.quarter)} ${m}:${s}`;
}

/** For sentences: "his own 20", "the opponent's 35", "midfield". */
export function spotPhrase(ballOn: number, owner = 'his'): string {
  if (ballOn === 50) return 'midfield';
  return ballOn < 50 ? `${owner} own ${ballOn}` : `the opponent's ${100 - ballOn}`;
}

export function teamLabel(ctx: GameContext, side: Side): string {
  return sideLabel(ctx.teams[side].shortName, side);
}

/** "Patriots (home)"; a name already ending in brackets takes the side inside them: "New York (N, home)". */
export function sideLabel(name: string, side: Side): string {
  return name.endsWith(')') ? `${name.slice(0, -1)}, ${side})` : `${name} (${side})`;
}

// ---------------------------------------------------------------------------------------------
// Card flipping with the Z-card rule (8.8.1)
// ---------------------------------------------------------------------------------------------

/**
 * Flips cards for one play. A Z card counts only if it's among the first three cards flipped, only one counts per play,
 * and it never counts on onside kicks, extra points or fumble recoveries. A Z card is always replaced by the next card.
 */
export class PlayFlips {
  private flipped = 0;
  zCard = false;
  /** Which flip (1, 2 or 3) turned up the Z card: on a pass, a Z on the first card hurts the quarterback (8.8.4). */
  zAt = 0;
  /** Every card turned over, Z cards included, for the log (the carousel on the Offense and Defense pages). */
  private readonly turned: DealtCard[] = [];

  constructor(
    private readonly deck: FacDeck,
    private readonly zAllowed: boolean,
    private readonly steps: string[],
  ) {}

  /** The next regular card. Pass zCounts = false where Z cards are ignored (fumble recovery, extra point, Z results). */
  next(zCounts = true): RegularFac {
    for (;;) {
      const card = this.deck.draw();
      this.flipped++;
      // The step written next is the one that reads this card (steps are only ever added at the end).
      const step = this.steps.length;
      if (!card.isZ) {
        this.turned.push({ id: card.id, step });
        return card;
      }
      if (zCounts && this.zAllowed && this.flipped <= 3 && !this.zCard) {
        this.zCard = true;
        this.zAt = this.flipped;
        this.steps.push('Z card! It will be checked once the play is over.');
        this.turned.push({ id: card.id, z: 'counts', step });
      } else {
        this.turned.push({ id: card.id, z: 'ignored', step });
      }
    }
  }

  /** The card whose Z line gives the result of a Z card (rule 8.8.2), once the play is over. */
  zResult(): ZResult {
    const card = this.next(false);
    this.turned[this.turned.length - 1] = { ...this.turned[this.turned.length - 1], z: 'result' };
    return card.z;
  }

  /** The cards turned over so far, in order: a copy, for a log entry. */
  get cards(): DealtCard[] {
    return this.turned.map(c => ({ ...c }));
  }
}

// ---------------------------------------------------------------------------------------------
// Game start and coin toss
// ---------------------------------------------------------------------------------------------

export function createGame(setup: GameSetup, cards: readonly Fac[]): GameState {
  const seed = setup.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = new SeededRandom(seed);
  const deck = new FacDeck(cards, rng.int(2 ** 31));
  return {
    version: 1,
    seed,
    ...(setup.rules ? { rules: setup.rules } : {}),
    ...(setup.coaches ? { coaches: setup.coaches } : {}),
    journal: [],
    homeTeamId: setup.homeTeamId,
    awayTeamId: setup.awayTeamId,
    rngState: rng.state,
    deck: deck.snapshot(),
    phase: 'COIN_TOSS',
    openingKickoffDone: false,
    // The away team calls the toss.
    toss: { caller: 'away' },
    receivingFirstHalf: null,
    quarter: 1,
    clock: QUARTER_SECONDS,
    score: { home: 0, away: 0 },
    timeouts: { home: 3, away: 3 },
    possession: null,
    ballOn: null,
    down: 1,
    distance: 10,
    kickoff: null,
    pendingPenalty: null,
    log: [],
  };
}

export function requirePhase(state: GameState, phase: GameState['phase']) {
  if (state.phase !== phase) throw new Error(`Not allowed now: the game is in phase ${state.phase}, not ${phase}`);
}

/** A log entry still being written: the play's title, its steps and the cards turned over for it. */
export type LogDraft = Pick<LogEntry, 'title' | 'steps' | 'cards'>;

export function addLog(state: GameState, entry: Omit<LogEntry, 'quarter' | 'clock'>): LogEntry[] {
  return [...state.log, { quarter: state.quarter, clock: state.clock, ...entry }];
}

export function callToss(state: GameState, call: Coin, ctx: GameContext): GameState {
  requirePhase(state, 'COIN_TOSS');
  const rng = new SeededRandom(state.rngState);
  const result: Coin = rng.int(2) === 0 ? 'HEADS' : 'TAILS';
  const caller = state.toss.caller;
  const winner = call === result ? caller : otherSide(caller);
  return {
    ...state,
    rngState: rng.state,
    phase: 'TOSS_CHOICE',
    toss: { ...state.toss, call, result, winner },
    log: addLog(state, {
      title: 'Coin toss',
      steps: [`${teamLabel(ctx, caller)} call ${call.toLowerCase()}.`, `It's ${result.toLowerCase()}: ${teamLabel(ctx, winner)} win the toss.`],
    }),
  };
}

export function chooseAfterToss(state: GameState, choice: TossChoice, ctx: GameContext): GameState {
  requirePhase(state, 'TOSS_CHOICE');
  const winner = state.toss.winner!;
  const receiving = choice === 'RECEIVE' ? winner : otherSide(winner);
  const kicking = otherSide(receiving);
  return {
    ...state,
    phase: 'KICKOFF',
    toss: { ...state.toss, choice },
    receivingFirstHalf: receiving,
    kickoff: { kicking, afterSafety: false, landingShift: 0 },
    log: addLog(state, {
      title: 'Choice',
      steps: [`${teamLabel(ctx, winner)} choose to ${choice === 'RECEIVE' ? 'receive' : 'kick'}.`, `${teamLabel(ctx, kicking)} will kick off.`],
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Kickoff (rule 8.1)
// ---------------------------------------------------------------------------------------------

/** "Same as KR-2" on the return card points at another column. */
function returnColumn(team: Team, returner: string): { column: string; name: string } {
  if (!team.kickReturn) throw new Error(`The ${team.name} have no kick return card yet`);
  let column = returner;
  for (let i = 0; i < 4; i++) {
    const ref = team.kickReturn.returners[column];
    if (ref && 'sameAs' in ref) column = ref.sameAs;
    else return { column, name: ref?.name ?? column };
  }
  throw new Error(`Kick return card loops at ${returner}`);
}

/** Rule 8.8.5: the fumble is lost when the PN falls in the team's "Fumbles Lost" range. */
export function fumbleLost(flips: PlayFlips, team: Team, steps: string[], who = 'kicking team recovers', keeps = 'returner falls on it'): boolean {
  const card = flips.next(false);
  const lost = inRange(card.passNumber, team.fumblesLost);
  steps.push(`Fumble! Recovery card PN ${card.passNumber} against fumbles lost ${team.fumblesLost.from}-${team.fumblesLost.to}: ${lost ? who : keeps}.`);
  return lost;
}

/** Penalties may move the ball no more than half the distance to the goal (rule 8.8.3). */
export const back = (spot: number, yards: number) => spot - Math.min(yards, Math.floor(spot / 2));
export const forward = (spot: number, yards: number) => spot + Math.min(yards, Math.floor((100 - spot) / 2));

interface ReturnResult {
  base: KickoffOutcome;
  /** What happened on the kick, for the stats (the kick, the return, a fumble on it). */
  events: StatEventBody[];
  /** Where the return started and ended, receiving team's yard lines. null for touchbacks and onside kicks. */
  landing: number | null;
  end: number | null;
  turnover: boolean;
}

/**
 * onside: an onside kick (rule 8.1.3). squib: a squib kick (optional rule O3). onsideDefense: the receiving team expects
 * an onside kick (optional rule O2).
 */
export interface KickoffOptions {
  onside?: boolean;
  squib?: boolean;
  onsideDefense?: boolean;
}

export function kickoff(state: GameState, ctx: GameContext, options: KickoffOptions = {}): GameState {
  requirePhase(state, 'KICKOFF');
  const { kicking, afterSafety, landingShift } = state.kickoff!;
  const receiving = otherSide(kicking);
  const steps: string[] = [];
  const deck = new FacDeck(ctx.cards, state.deck);
  const flips = new PlayFlips(deck, !options.onside, steps);
  const title = `${teamLabel(ctx, kicking)} ${options.onside ? 'try an onside kick' : options.squib ? 'squib the kickoff' : 'kick off'}`;
  if (options.onsideDefense) steps.push(`${teamLabel(ctx, receiving)} line up for an onside kick (optional rule O2).`);

  const result = options.onside
    ? onsideKick(flips, kicking, receiving, steps, !!options.onsideDefense)
    : regularKick(flips, ctx, kicking, receiving, afterSafety, landingShift, steps, { squib: !!options.squib, maxReturn: options.onsideDefense ? 20 : null });

  let outcome: KickoffOutcome = { ...result.base, events: result.events };
  let pending: PendingPenalty | null = null;
  const rng = new SeededRandom(state.rngState);

  if (flips.zCard) {
    const z = flips.zResult();
    if (z.type === 'INJURY') {
      steps.push('Z result: injury, but nobody gets hurt on kicking plays (rule 8.8.4).');
    } else if (z.type === 'FUMBLE') {
      const { fumbled, lost } = zFumble(z.homeTeamExempt, result, flips, ctx, kicking, receiving, steps);
      const returner = result.events.find(e => e.type === 'KICK_RETURN');
      const fumble: StatEventBody[] = returner && returner.type === 'KICK_RETURN' && returner.playerId && fumbled
        ? [{ type: 'FUMBLE', side: receiving, playerId: returner.playerId, lost: !!lost }] : [];
      outcome = lost ? { ...lost, events: [...result.events, ...fumble] } : { ...outcome, events: [...result.events, ...fumble] };
    } else {
      const penalty = z.byCategory[3]; // category 4: kickoffs and their returns
      // Name the player (penalty-players.ts): the kicker for a kickoff out of bounds, otherwise someone on the unit.
      const team = ctx.teams[penalty.against === 'K' ? kicking : receiving];
      const who = choosePenalized(penaltyKind(penalty.against, penalty.penalty), team.players, rng);
      const applied = kickoffPenalty(penalty.against, penalty.penalty, result, flips, kicking, receiving, steps,
        who ? `${who.firstName} ${who.lastName} (${who.position})` : null);
      // For the stats: a re-kick wipes out the kick; a kickoff out of bounds had no return.
      const flag = (accepted: boolean, yards: number): StatEventBody => ({
        type: 'PENALTY', side: penalty.against === 'K' ? kicking : receiving, playerId: who?.id ?? null,
        name: PENALTY_NAMES[penalty.penalty] ?? `Penalty ${penalty.penalty}`, yards, accepted,
      });
      const outOfBounds = penalty.penalty === 15;
      const kickOnly = result.events.filter(e => e.type === 'KICKOFF');
      const eventsFor = (o: KickoffOutcome, accepted: boolean, yards: number): StatEventBody[] =>
        o.kind === 'REKICK' ? [flag(accepted, yards)] : [...(outOfBounds ? kickOnly : result.events), flag(accepted, yards)];
      if (applied && 'accept' in applied) {
        const a = applied.accept as KickoffOutcome;
        const d = applied.decline as KickoffOutcome;
        pending = { ...applied, accept: { ...a, events: eventsFor(a, true, 5) }, decline: { ...d, events: eventsFor(d, false, 5) } };
      } else if (applied && applied.kind === 'BALL' && result.base.kind === 'BALL') {
        outcome = { ...applied, events: [...result.events, flag(true, Math.abs(applied.ballOn - result.base.ballOn))] };
      } else if (applied) {
        outcome = { ...applied, events: [...result.events.map(e => (e.type === 'KICK_RETURN' ? { ...e, touchdown: false } : e)), flag(true, 15)] };
      }
    }
  }

  // The kickoff was a play: injuries that count plays tick down (nobody gets hurt on kicks, rule 8.8.4).
  const ticked = tickInjuries(state);
  steps.push(...ticked.healed.map(backText));
  const next: GameState = recordTarget({ ...nextPlay(ticked.state), rngState: rng.state, deck: deck.snapshot(), log: addLog(state, { title, steps, cards: flips.cards }) }, null, null);
  if (pending) {
    return { ...next, phase: 'PENALTY_CHOICE', pendingPenalty: pending };
  }
  return applyKickoffOutcome(next, outcome, ctx);
}

function onsideKick(flips: PlayFlips, kicking: Side, receiving: Side, steps: string[], defended = false): ReturnResult {
  const card = flips.next(false);
  // Rule O2: against an onside-kick defense, the kicking team recovers only on PN 1-7.
  const top = defended ? 7 : 11;
  const recovered = card.passNumber <= top;
  steps.push(`Onside kick: PN ${card.passNumber}, ${recovered ? `kicking team recovers (1-${top})` : 'receiving team recovers'} at midfield.`);
  return {
    base: { kind: 'BALL', possession: recovered ? kicking : receiving, ballOn: 50, clockUsed: KICK_RETURN_SECONDS, summary: 'Onside kick' },
    events: [{ type: 'KICKOFF', side: kicking, touchback: false, onside: true, recovered }],
    landing: null,
    end: null,
    turnover: recovered,
  };
}

function regularKick(
  flips: PlayFlips, ctx: GameContext, kicking: Side, receiving: Side, afterSafety: boolean, landingShift: number, steps: string[],
  kick$: { squib: boolean; maxReturn: number | null } = { squib: false, maxReturn: null },
): ReturnResult {
  const team = ctx.teams[receiving];
  const first = flips.next();
  let entry = KICKOFF_A[first.runNumber - 1];
  steps.push(`Kick: RN ${first.runNumber} on column A${entry.kind === 'COLUMN_B' ? ', go to column B' : ''}.`);
  if (entry.kind === 'COLUMN_B') {
    const second = flips.next();
    entry = KICKOFF_B[second.runNumber - 1];
    steps.push(`Column B: RN ${second.runNumber}.`);
  }
  if (entry.kind === 'COLUMN_B') throw new Error('Kickoff table column B never refers to itself');

  // A squib kick bounces into play: no touchback (rule O3).
  if (entry.kind === 'TOUCHBACK' && !afterSafety && !kick$.squib) {
    steps.push('Touchback. Ball at the 20.');
    return {
      base: { kind: 'BALL', possession: receiving, ballOn: 20, clockUsed: 0, summary: 'Touchback' }, landing: null, end: null, turnover: false,
      events: [{ type: 'KICKOFF', side: kicking, touchback: true, onside: false, recovered: false }],
    };
  }
  // After a safety the kick comes from 15 yards farther back; would-be touchbacks are fielded at the 15 (rule 8.1.4).
  const fielded = entry.kind === 'TOUCHBACK'
    ? { returner: 'KR1', landing: afterSafety ? 15 : 0 }
    : { returner: entry.returner, landing: entry.landing + (afterSafety ? 15 : 0) };
  // Rule O3: the return of a squib kick starts 15 yards farther up the field.
  const landing = Math.max(0, Math.min(99, fielded.landing + landingShift + (kick$.squib ? 15 : 0)));
  if (kick$.squib) steps.push('Squib kick: the return starts 15 yards farther up the field, and the return RN gets +1 (rule O3).');
  const { column, name } = returnColumn(team, fielded.returner);
  const ref = team.kickReturn!.returners[column];
  const returnerId = ref && 'playerId' in ref ? ref.playerId : null;
  const kick: StatEventBody = { type: 'KICKOFF', side: kicking, touchback: false, onside: false, recovered: false };
  const ret = (yards: number, touchdown: boolean): StatEventBody => ({ type: 'KICK_RETURN', side: receiving, playerId: returnerId, name, yards, touchdown });
  steps.push(`${name} (${fielded.returner}) fields it at the ${landing === 0 ? 'goal line' : landing}${landingShift ? ` (re-kick, ${landingShift > 0 ? '+' : ''}${landingShift})` : ''}.`);

  const card = flips.next();
  const rn = kick$.squib ? Math.min(12, card.runNumber + 1) : card.runNumber; // a 12 stays a 12
  const cell = team.kickReturn!.table[rn - 1][column];
  let yards = cell?.yards ?? 0;
  steps.push(`Return: RN ${card.runNumber}${rn !== card.runNumber ? ` +1 = ${rn}` : ''} in column ${column}: ${yards} yards${cell?.breakaway ? ', breakaway chance' : ''}${cell?.fumble ? ', fumble' : ''}.`);
  if (cell?.breakaway) {
    const b = flips.next();
    const breakaway = team.kickReturn!.breakaway[column];
    if (b.runNumber <= 2 && breakaway !== null && breakaway !== undefined) {
      yards = breakaway;
      steps.push(`Breakaway: RN ${b.runNumber}, he breaks it for ${yards} yards.`);
    } else {
      steps.push(`Breakaway: RN ${b.runNumber}, no breakaway.`);
    }
  }

  // Rule O2: against an onside-kick defense, a normal kickoff can be returned 20 yards at most.
  if (kick$.maxReturn !== null && yards > kick$.maxReturn) {
    steps.push(`The onside-kick defense holds the return to ${kick$.maxReturn} yards (rule O2).`);
    yards = kick$.maxReturn;
  }
  const end = landing + yards;
  if (end >= 100) {
    steps.push(`${name} goes all the way!`);
    return {
      base: { kind: 'TOUCHDOWN', scorer: receiving, clockUsed: KICK_RETURN_SECONDS, summary: `${name} kickoff return touchdown` }, landing, end: 100, turnover: false,
      events: [kick, ret(100 - landing, true)],
    };
  }
  const fumble = (lost: boolean): StatEventBody[] => (returnerId ? [{ type: 'FUMBLE', side: receiving, playerId: returnerId, lost }] : []);
  if (cell?.fumble) {
    if (fumbleLost(flips, team, steps)) {
      return {
        base: { kind: 'BALL', possession: kicking, ballOn: 100 - end, clockUsed: KICK_RETURN_SECONDS, summary: `${name} fumbles, kicking team recovers` }, landing, end, turnover: true,
        events: [kick, ret(yards, false), ...fumble(true)],
      };
    }
    steps.push(`${name} returns it to ${spotPhrase(end)}.`);
    return {
      base: { kind: 'BALL', possession: receiving, ballOn: end, clockUsed: KICK_RETURN_SECONDS, summary: `${name} returns it to ${spotPhrase(end)}` }, landing, end, turnover: false,
      events: [kick, ret(yards, false), ...fumble(false)],
    };
  }
  steps.push(`${name} returns it to ${spotPhrase(end)}.`);
  return {
    base: { kind: 'BALL', possession: receiving, ballOn: end, clockUsed: KICK_RETURN_SECONDS, summary: `${name} returns it to ${spotPhrase(end)}` }, landing, end, turnover: false,
    events: [kick, ret(yards, false)],
  };
}

/** A Z-card fumble on the return. Says whether the returner fumbled at all, and the new outcome if he lost it. */
function zFumble(
  homeTeamExempt: boolean, result: ReturnResult, flips: PlayFlips, ctx: GameContext, kicking: Side, receiving: Side, steps: string[],
): { fumbled: boolean; lost: KickoffOutcome | null } {
  if (result.end === null || result.turnover || result.base.kind !== 'BALL') {
    steps.push('Z result: fumble, but there is no return to fumble on.');
    return { fumbled: false, lost: null };
  }
  if (homeTeamExempt && receiving === 'home') {
    steps.push('Z result: "Fumble(s)", the returner is on the home team, so no fumble (rule 8.8.5).');
    return { fumbled: false, lost: null };
  }
  steps.push('Z result: fumble on the return.');
  if (!fumbleLost(flips, ctx.teams[receiving], steps)) return { fumbled: true, lost: null };
  return {
    fumbled: true,
    lost: { kind: 'BALL', possession: kicking, ballOn: 100 - result.end, clockUsed: KICK_RETURN_SECONDS, summary: 'Fumble on the return, kicking team recovers' },
  };
}

/**
 * Applies a category 4 penalty to a kickoff. These are the ones the FAC deck can produce:
 * K1/R1 offside, K15 kickoff out of bounds, K5/K9/R5 personal fouls, R11 clipping.
 * Returns a new outcome, a choice for the coach, or null when the penalty doesn't change anything.
 */
function kickoffPenalty(
  against: string, number: number, result: ReturnResult, flips: PlayFlips, kicking: Side, receiving: Side, steps: string[],
  who: string | null = null,
): KickoffOutcome | PendingPenalty | null {
  const name = PENALTY_NAMES[number] ?? `Penalty ${number}`;
  const team = against === 'K' ? 'kicking team' : 'receiving team';
  steps.push(`Z result: ${name.toLowerCase()} on the ${team}${who ? `: ${who}` : ''}.`);

  if (result.turnover) {
    steps.push('The ball changed hands on the play, so the penalty is not enforced.');
    return null;
  }

  // Offside: the kick is done again, 5 yards farther or shorter (rule 8.1.5). The other team may decline.
  if (number === 1) {
    const shift = against === 'K' ? 5 : -5;
    const chooser = against === 'K' ? receiving : kicking;
    return {
      chooser,
      description: `${name} on the ${team}, 5 yards. Accept to re-kick 5 yards ${shift > 0 ? 'shorter' : 'deeper'}, or decline and keep the result.`,
      accept: { kind: 'REKICK', landingShift: shift, summary: `${name} accepted, re-kick` },
      decline: { ...result.base, summary: `${result.base.summary} (${name.toLowerCase()} declined)` },
    };
  }

  // Kickoff out of bounds: take the ball at the 35, or have them kick again from 5 yards back.
  if (number === 15) {
    return {
      chooser: receiving,
      description: `${name}. Take the ball at your own 35, or make them kick again from 5 yards back.`,
      accept: { kind: 'BALL', possession: receiving, ballOn: 35, clockUsed: 0, summary: `${name}, ball at their own 35` },
      decline: { kind: 'REKICK', landingShift: 5, summary: `${name}, re-kick from 5 yards back` },
    };
  }

  if (result.end === null) {
    steps.push('There was no return, so the penalty has no effect.');
    return null;
  }
  const clockUsed = KICK_RETURN_SECONDS;

  // Personal fouls: 15 yards from where the return ended, no option (rule 6.3 #5/#9).
  if (number === 5 || number === 9) {
    if (result.base.kind === 'TOUCHDOWN') {
      if (against === 'K') {
        steps.push('The touchdown stands; the foul does not change it.');
        return null;
      }
      const spot = back(99, 15);
      steps.push(`Touchdown called back. Ball at ${spotPhrase(spot, 'their')}.`);
      return { kind: 'BALL', possession: receiving, ballOn: spot, clockUsed, summary: `${name} on the return, touchdown called back` };
    }
    const spot = against === 'K' ? forward(result.end, 15) : back(result.end, 15);
    steps.push(`15 yards ${against === 'K' ? 'added' : 'back'}: ball at ${spotPhrase(spot, 'their')}.`);
    return { kind: 'BALL', possession: receiving, ballOn: spot, clockUsed, summary: `${name}, ball at ${spotPhrase(spot, 'their')}` };
  }

  // Clipping on the receiving team: 15 yards from the spot of the foul, no option (rule 6.3 #11).
  if (number === 11 && against === 'R') {
    const card = flips.next(false);
    const end = Math.min(result.end, 99);
    const foulSpot = card.runNumber % 2 === 1 ? result.landing! + Math.floor((end - result.landing!) / 2) : end;
    const spot = back(foulSpot, 15);
    steps.push(`Spot of the foul: RN ${card.runNumber} is ${card.runNumber % 2 ? 'odd, halfway through the return' : 'even, where the return ended'} (${spotPhrase(foulSpot)}). 15 yards back: ${spotPhrase(spot)}.`);
    return { kind: 'BALL', possession: receiving, ballOn: spot, clockUsed, summary: `Clipping on the return, ball at ${spotPhrase(spot, 'their')}` };
  }

  steps.push('This penalty has no effect on a kickoff.');
  return null;
}

const QUARTER_ORDINAL = ['', '1st', '2nd', '3rd', '4th'];

/**
 * Runs the clock (rule 9.0). No play takes more time than is left (9.7). When a quarter runs out:
 * after the 1st and 3rd the game goes on, after the 2nd the second half starts with a kickoff by the team
 * that received first (your C# CoinToss logic), after the 4th the game is over.
 */
/** The overtime period (rule 9.8.1). */
export const OVERTIME = 5;

/** "Q1"-"Q4", and "OT" for overtime. */
export const quarterLabel = (quarter: number) => (quarter >= OVERTIME ? 'OT' : `Q${quarter}`);

export function runClock(state: GameState, seconds: number, ctx: GameContext): GameState {
  // Overtime is sudden death (rule 9.8.1): the first score ends the game at once.
  if (state.quarter === OVERTIME && state.score.home !== state.score.away && state.phase !== 'GAME_OVER') {
    const { home, away } = state.score;
    const result = `${teamLabel(ctx, home > away ? 'home' : 'away')} win ${Math.max(home, away)}-${Math.min(home, away)} in overtime.`;
    return {
      ...state, clock: Math.max(0, state.clock - seconds), phase: 'GAME_OVER', defenseReady: false, defenseSetup: null, kickoff: null,
      quarterScores: [...(state.quarterScores ?? []), { ...state.score }],
      log: addLog(state, { title: 'Final (overtime)', steps: [result], result }),
    };
  }
  const clock = Math.max(0, state.clock - seconds);
  if (clock > 0) return { ...state, clock };
  const ended = state.quarter;
  // "Rest of the quarter" injuries end with it.
  const heal = healAtQuarterEnd({ ...state, clock: 0 });
  // The score as each quarter ends, for the play-by-play's quarter summaries.
  const s: GameState = { ...heal.state, quarterScores: [...(state.quarterScores ?? []), { ...state.score }] };
  const back = heal.healed.map(backText);
  if (ended === 2) {
    const kicking = state.receivingFirstHalf!;
    return {
      ...s, quarter: 3, clock: QUARTER_SECONDS, phase: 'KICKOFF', possession: null, ballOn: null, defenseReady: false, defenseSetup: null,
      timeouts: { home: 3, away: 3 }, // three each again for the second half (rule 9.2)
      pendingPenalty: null, kickoff: { kicking, afterSafety: false, landingShift: 0 },
      log: addLog(s, { title: 'Halftime', steps: [`${teamLabel(ctx, kicking)} kick off to start the second half.`, ...back] }),
    };
  }
  // Tied after four quarters: one overtime period, with a new coin toss and two timeouts each (rule 9.8.1).
  if (ended === 4 && state.score.home === state.score.away) {
    return {
      ...s, quarter: OVERTIME, clock: QUARTER_SECONDS, phase: 'COIN_TOSS', toss: { caller: 'away' }, possession: null, ballOn: null,
      defenseReady: false, defenseSetup: null, pendingPenalty: null, kickoff: null, puntCall: null, fieldGoalCall: false,
      timeouts: { home: 2, away: 2 },
      log: addLog(s, {
        title: 'End of regulation',
        steps: [`Tied ${state.score.home}-${state.score.away}: overtime. Sudden death, 15 minutes, two timeouts each; a new coin toss decides who receives.`, ...back],
      }),
    };
  }
  if (ended >= 4) {
    const { home, away } = state.score;
    const result = home === away
      ? `Tied ${home}-${away} after overtime.`
      : `${teamLabel(ctx, home > away ? 'home' : 'away')} win ${Math.max(home, away)}-${Math.min(home, away)}.`;
    return { ...s, phase: 'GAME_OVER', defenseReady: false, defenseSetup: null, log: addLog(s, { title: 'Final', steps: [result], result }) };
  }
  return { ...s, quarter: ended + 1, clock: QUARTER_SECONDS, log: addLog(s, { title: `End of the ${QUARTER_ORDINAL[ended]} quarter`, steps: back }) };
}

/**
 * Six points, the extra point (rule 8.6.2: one card, Z cards don't count) and a kickoff by the scoring team.
 * Used for touchdowns on returns and from scrimmage alike.
 */
export function scoreTouchdown(state: GameState, scorer: Side, clockUsed: number, ctx: GameContext): GameState {
  const deck = new FacDeck(ctx.cards, state.deck);
  const steps: string[] = [];
  const kicker = ctx.teams[scorer].players.find(p => p.position === 'K');
  // In overtime the touchdown ends the game: no extra point.
  if (state.quarter === OVERTIME) {
    const score = { ...state.score, [scorer]: state.score[scorer] + 6 };
    return runClock({ ...state, score, pendingPenalty: null, log: addLog(state, { title: `Touchdown ${teamLabel(ctx, scorer)}`, steps }) }, clockUsed, ctx);
  }
  const flips = new PlayFlips(deck, false, steps);
  const card = flips.next(false);
  const good = kicker?.position === 'K' && inRange(card.passNumber, kicker.extraPoint);
  steps.push(`Extra point: PN ${card.passNumber}, ${good ? 'good' : 'no good'}.`);
  const score = { ...state.score, [scorer]: state.score[scorer] + 6 + (good ? 1 : 0) };
  const after: GameState = {
    ...addEvents(state, [{ type: 'EXTRA_POINT', side: scorer, playerId: kicker?.id ?? null, good }]), pendingPenalty: null, openingKickoffDone: true, score, deck: deck.snapshot(), defenseReady: false, defenseSetup: null,
    phase: 'KICKOFF', possession: null, ballOn: null, kickoff: { kicking: scorer, afterSafety: false, landingShift: 0 },
  };
  const result = `${teamLabel(ctx, scorer)} ${score[scorer]}, ${teamLabel(ctx, otherSide(scorer))} ${score[otherSide(scorer)]}.`;
  return runClock({ ...after, log: addLog(after, { title: `Touchdown ${teamLabel(ctx, scorer)}`, steps, result, cards: flips.cards }) }, clockUsed, ctx);
}

/** Puts the result of a kickoff (or the coach's penalty choice) into the game. */
export function applyKickoffOutcome(stateBefore: GameState, outcome: KickoffOutcome, ctx: GameContext): GameState {
  const state = addEvents(stateBefore, outcome.events ?? []);
  const base = { ...state, pendingPenalty: null };
  switch (outcome.kind) {
    case 'REKICK':
      return { ...state, pendingPenalty: null, phase: 'KICKOFF', kickoff: { ...state.kickoff!, landingShift: outcome.landingShift } };
    case 'BALL': {
      const next: GameState = {
        ...nextPossession(base),
        phase: 'PLAY',
        openingKickoffDone: true,
        possession: outcome.possession,
        ballOn: outcome.ballOn,
        down: 1,
        distance: Math.min(10, 100 - outcome.ballOn),
        kickoff: null,
      };
      return runClock(next, outcome.clockUsed, ctx);
    }
    case 'TOUCHDOWN':
      return scoreTouchdown(base, outcome.scorer, outcome.clockUsed, ctx);
  }
}

