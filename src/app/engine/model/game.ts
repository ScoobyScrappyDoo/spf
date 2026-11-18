import { DeckState } from '../deck';
import type { DealtCard } from './fac';
import type { DefenseLineup } from '../defense-lineup';
import { DefenseCall, DefenseFormationId } from './defense';

import { Injury } from './injury';
import { otherSide, Side } from './game-side';
import type { TargetEvent } from '../selection';
import { StatEvent, StatEventBody } from './events';

export { otherSide };
export type { Side };

export type Coin = 'HEADS' | 'TAILS';
export type TossChoice = 'RECEIVE' | 'KICK';

/**
 * Where the game is. Each phase allows exactly one kind of move, so a screen only needs to look at the phase
 * to know what to offer, and the server can later reject anything out of turn.
 */
export type GamePhase = 'COIN_TOSS' | 'TOSS_CHOICE' | 'KICKOFF' | 'PENALTY_CHOICE' | 'PLAY' | 'GAME_OVER';

export interface LogEntry {
  quarter: number;
  /** Seconds left in the quarter when the play started. */
  clock: number;
  title: string;
  /** Each card flip and what it meant, in order, like reading the play off the table. */
  steps: string[];
  /** One line saying how it ended, e.g. "Walter Payton gains 6 yards. 2nd & 4 at own 26." */
  result?: string;
  /** The cards turned over for this play, in order (missing in games from before update 01 and on entries without cards). */
  cards?: DealtCard[];
}

/** What a kickoff ends in. Penalties with an option offer two of these and the coach picks one. */
export type KickoffOutcome = (
  | { kind: 'BALL'; possession: Side; ballOn: number; clockUsed: number; summary: string }
  | { kind: 'TOUCHDOWN'; scorer: Side; clockUsed: number; summary: string }
  | { kind: 'REKICK'; landingShift: number; summary: string }
) & { events?: StatEventBody[] };

/** How a play from scrimmage ends, before downs, score and clock are worked out. */
export interface ScrimmageOutcome {
  kind: 'SCRIMMAGE';
  /** Where the ball ends up, from the offense's own goal line: 100 or more is a touchdown, 0 or less a safety. */
  newBallOn: number;
  /** False when a penalty wipes out the play and the down is played again. */
  countsAsDown: boolean;
  autoFirstDown: boolean;
  /** The defense recovered a fumble (or intercepted) at newBallOn. */
  turnover: boolean;
  /** The defense took it all the way back: an interception or fumble return for a touchdown. */
  defensiveTouchdown?: boolean;
  clockUsed: number;
  outOfBounds: boolean;
  /** Ran with the two-minute offense (rule 9.4.1): out of bounds then costs only 5 seconds. */
  twoMinute?: boolean;
  /** A timeout called with this play (rule 9.2): the play takes the short time, and that team has one fewer. */
  timeout?: Side;
  /** What happened on the play, for the stats. A penalty that wipes out the play drops the run's events. */
  events?: StatEventBody[];
  summary: string;
}

/** How a punt ends: the other team's ball, a return touchdown, or the kicking team keeps it after a penalty. */
export interface PuntOutcome {
  kind: 'PUNT';
  result:
    | { type: 'RECEIVING'; spot: number }
    | { type: 'TOUCHDOWN'; scorer: Side }
    | { type: 'KICKING_TEAM'; ballOn: number; firstDown: boolean; newPossession?: boolean };
  clockUsed: number;
  summary: string;
  events?: StatEventBody[];
}

/** How a field goal try ends. */
export interface FieldGoalOutcome {
  kind: 'FIELD_GOAL';
  result:
    | { type: 'GOOD' }
    /** The other team takes over: at the line of scrimmage, or their 20 if that's better for them. */
    | { type: 'MISSED'; spot: number }
    /** PN 48 (47-48 over 50 yards): blocked and returned for a touchdown. */
    | { type: 'BLOCKED'; scorer: Side }
    /** A penalty: the kicking team keeps the ball and kicks again, or has a first down. */
    | { type: 'KICKING_TEAM'; ballOn: number; firstDown: boolean };
  clockUsed: number;
  summary: string;
  events?: StatEventBody[];
}

export type PlayOutcome = KickoffOutcome | ScrimmageOutcome | PuntOutcome | FieldGoalOutcome;

export interface PendingPenalty {
  /** The team that wasn't penalized decides (rule 8.8.3). */
  chooser: Side;
  description: string;
  accept: PlayOutcome;
  decline: PlayOutcome;
}

export interface DefenseSetup {
  formationId: DefenseFormationId;
  lineup: DefenseLineup;
  call: DefenseCall;
  /** Against a declared punt: an all-out rush (rule 8.5.7). */
  allOutRush?: boolean;
  /** The defense calls a timeout after this play (rule 9.2). */
  timeout?: boolean;
  /** With a blitz: who goes (player ids from rows 2 and 3); none chosen means the outside linebackers in F and J. */
  blitzers?: string[];
  /** Double or triple coverage on receiver positions (rule 7.2.2). */
  coverage?: Coverage[];
  /** A big play defense (rule 8.4). */
  bigPlay?: boolean;
  /** Against a punt or field goal: the defense expects a fake (rule O6): +2 on the fake's RN, but no block on a real kick. */
  expectFake?: boolean;
}

/** The receiver positions coverage is called on (rule 7.2.2.2). */
export type ReceiverPosition = 'LE' | 'RE' | 'FL1' | 'FL2' | 'BK1' | 'BK2' | 'BK3';

export interface Coverage {
  receiver: ReceiverPosition;
  level: 'DOUBLE' | 'TRIPLE';
}

/** The offense has said out loud it will punt (rule 8.5), with a coffin-corner deduction if any (8.5.6). */
export interface PuntCall {
  /** Yards taken off the punt on purpose to pin the returners deep, 10-25; null for a normal punt. */
  coffinCorner: number | null;
  /** Which punter, when the team has more than one card; otherwise the first. */
  punterId?: string;
  /** A fake punt (optional rule O6); kept from the defense until the snap. */
  fake?: boolean;
}

export interface GameState {
  version: 1;
  homeTeamId: string;
  awayTeamId: string;
  /** State of the random number generator for the coin toss. */
  rngState: number;
  deck: DeckState;
  phase: GamePhase;
  /** True once the opening kickoff is over. Offense and defense screens open from then on. */
  openingKickoffDone: boolean;
  toss: { caller: Side; call?: Coin; result?: Coin; winner?: Side; choice?: TossChoice };
  /** Who receives in the first half. The other team receives in the second (your C# CoinToss logic). */
  receivingFirstHalf: Side | null;
  quarter: number;
  /** Seconds left in the quarter. */
  clock: number;
  score: Record<Side, number>;
  timeouts: Record<Side, number>;
  /** The team with the ball, once a play has started. */
  possession: Side | null;
  /** Yards from the possession team's own goal line (1-99). */
  ballOn: number | null;
  down: number;
  distance: number;
  kickoff: { kicking: Side; afterSafety: boolean; landingShift: number } | null;
  /**
   * The defense has made its secret choices and pressed "All set!". Only then can the offense run the play.
   * Reset after every snap. (Missing in games saved before this existed, which reads as false.)
   */
  defenseReady?: boolean;
  /** The defense's secret choices, handed over with "All set!" and revealed at the snap (rule 2.5). */
  defenseSetup?: DefenseSetup | null;
  /** Players who are hurt right now (missing in games saved before injuries existed). */
  injuries?: Injury[];
  /** Who every play went to, in order, for the play-direction ratings (rule 4.6). */
  targets?: TargetEvent[];
  /** Counts possessions, so a "once per possession" rating knows when a new one starts. */
  possessionIndex?: number;
  /** Big plays used this game, and the possession each side last used one in (rule 8.4: one per possession). */
  bigPlaysUsed?: Partial<Record<Side, number>>;
  bigPlayPossession?: Partial<Record<Side, number>>;
  /** A punt the offense has declared for the coming play. */
  puntCall?: PuntCall | null;
  /** Delay of game before a punt (rule 8.5.3): asked for and waiting for the receiving team, or used on this down. */
  delayOfGame?: 'ASKED' | 'USED' | null;
  /** The offense lines up for a field goal on the coming play (rule 8.6.1). */
  fieldGoalCall?: boolean;
  /** The offense is staging a fake punt or field goal (optional rule O6). */
  fakeKick?: boolean;
  /**
   * The offense's formation and players as it lines up (not its call): what the defense sees across the line before
   * it sets up. Shown by the offense whenever it changes (online play); a local game doesn't need it.
   */
  offenseLook?: { formationId: string; lineup: Record<string, string | undefined> } | null;
  /** The defense's formation and players as it sets up (not its call): what the offense sees across the line. */
  defenseLook?: { formationId: string; lineup: Record<string, string[] | undefined> } | null;
  /** The offense's look when the defense pressed "All set!": a change after that lets the defense set up again. */
  lookAtReady?: string | null;
  /** The offense changed its formation or players after the defense was set: the defense may set up again. */
  offenseChanged?: boolean;
  /** Who plays each side (see Coaches in game.ts). */
  coaches?: import('../game').Coaches;
  /** The computer coach finished a game people had been playing. */
  aiFinished?: boolean;
  /** House rules for this game (see GameRules in game.ts). */
  rules?: import('../game').GameRules;
  /**
   * Rule 8.7: after a no-huddle play that left the clock running, the defense may not substitute for the next play
   * unless the offense does. Valid only for that play (`play`), and only with the lineups known.
   */
  noHuddleLock?: { side: Side; play?: number; offenseIds?: string[]; defenseFormation?: string; defenseLineup?: Record<string, string[] | undefined> } | null;
  /** The score at the end of each quarter played (missing in older games). */
  quarterScores?: { home: number; away: number }[];
  /** The seed the game was started with: with the journal, enough to rebuild it exactly. */
  seed?: number;
  /** Every decision made, in order, by the coaches or the computer (see journal.ts). Missing in older games. */
  journal?: import('../journal').JournalEntry[];
  /** Everything that happened, play by play, for the stats (missing in games saved before stats existed). */
  events?: StatEvent[];
  /** Counts plays, for the events. */
  playIndex?: number;
  pendingPenalty: PendingPenalty | null;
  log: LogEntry[];
}
