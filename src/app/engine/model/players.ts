import { Range } from './common';

/**
 * One value on a player card's rushing or pass-gain table.
 * A number is yards; 'SG' / 'LG' mean "flip another card and use the short/long gain column";
 * 'INC' means the pass falls incomplete; 'TD' is a touchdown from anywhere on the field (Mark Duper, Marcus Allen);
 * null means the card leaves that cell blank.
 */
export type GainCell = number | 'SG' | 'LG' | 'INC' | 'TD' | null;

/** One of the 12 rows of a rushing table: Normal, Short Gain and Long Gain columns. */
export interface RushRow {
  n: GainCell;
  sg: GainCell;
  lg: GainCell;
}

/** One of the 12 rows of a pass-gain table: Quick, Short and Long columns. */
export interface PassGainRow {
  q: GainCell;
  s: GainCell;
  l: GainCell;
}

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'OT' | 'OG' | 'C' | 'DE' | 'DT' | 'LB' | 'DB' | 'K' | 'P';

interface PlayerBase {
  /** Stable identity, never a field position. A player keeps this id wherever he lines up. */
  id: string;
  firstName: string;
  lastName: string;
  position: Position;
  jersey?: number;
}

export interface PassingRanges {
  com: Range | null;
  inc: Range | null;
  int: Range | null;
}

export interface Quarterback extends PlayerBase {
  position: 'QB';
  endurance: 'A' | 'B' | 'C';
  passing: { quick: PassingRanges; short: PassingRanges; long: PassingRanges };
  passRush: { sack: Range | null; runs: Range | null; com: Range | null; inc: Range | null };
  rushing: RushRow[];
}

export interface SkillPlayer extends PlayerBase {
  position: 'RB' | 'WR' | 'TE';
  /** Rule 4.6: how often plays may be directed at him (0 = unlimited ... 4 = once per quarter). */
  playDirection: 0 | 1 | 2 | 3 | 4;
  blocks: number;
  /** null when the card's rushing column is blank (he cannot carry the ball). */
  rushing: RushRow[] | null;
  passGain: PassGainRow[] | null;
}

export interface OffensiveLineman extends PlayerBase {
  position: 'OT' | 'OG' | 'C';
  runBlock: number;
  passBlock: number;
}

export interface DefensiveLineman extends PlayerBase {
  position: 'DE' | 'DT';
  tackle: number;
  passRush: number;
}

export interface Linebacker extends PlayerBase {
  position: 'LB';
  tackle: number;
  passRush: number;
  passDefense: number;
  intercept: Range | null;
  /** A "48?" rating (rule 8.3.5.2): on PN 48 a new card decides, an even PN being the interception. */
  interceptMaybe?: boolean;
}

export interface DefensiveBack extends PlayerBase {
  position: 'DB';
  /** Cornerback or safety, where the card set says so. */
  role?: 'CB' | 'S';
  passDefense: number;
  passRush: number;
  intercept: Range | null;
  /** A "48?" rating (rule 8.3.5.2): on PN 48 a new card decides, an even PN being the interception. */
  interceptMaybe?: boolean;
}

export interface Kicker extends PlayerBase {
  position: 'K';
  fieldGoals: { minYards: number; maxYards: number; good: Range }[];
  extraPoint: Range;
}

export type PuntReturner = 'PR1' | 'PR2' | 'PR3' | 'PR4' | 'FC';
export type PuntSpecialResult = { type: 'NO_RETURN'; yards: number } | { type: 'PENALTY' } | { type: 'BLOCKED' };

export interface Punter extends PlayerBase {
  position: 'P';
  /** Run numbers 1-11. Run number 12 always sends you to `special` (rule 8.5.4). */
  punts: { yards: number; returner: PuntReturner }[];
  special: { runNumber: Range; result: PuntSpecialResult }[];
}

/**
 * Any card in a team set. Because every member has a different literal `position`,
 * TypeScript narrows the type for you: inside `if (p.position === 'QB')` the compiler knows p is a Quarterback.
 * This replaces the C# cast-and-catch in CreateSkillPlayer().
 */
export type PlayerCard =
  | Quarterback
  | SkillPlayer
  | OffensiveLineman
  | DefensiveLineman
  | Linebacker
  | DefensiveBack
  | Kicker
  | Punter;

export const isQuarterback = (p: PlayerCard | undefined): p is Quarterback => p?.position === 'QB';
export const isSkillPlayer = (p: PlayerCard | undefined): p is SkillPlayer =>
  p?.position === 'RB' || p?.position === 'WR' || p?.position === 'TE';
export const isOffensiveLineman = (p: PlayerCard | undefined): p is OffensiveLineman =>
  p?.position === 'OT' || p?.position === 'OG' || p?.position === 'C';

export const fullName = (p: PlayerCard) => `${p.firstName} ${p.lastName}`;

/** Does the player have at least one value in this pass-gain column? Blank column = no passes of that type (rule 4.2.2). */
export function hasPassColumn(p: SkillPlayer, column: keyof PassGainRow): boolean {
  return p.passGain?.some(row => row[column] !== null) ?? false;
}

export function hasRushColumn(p: SkillPlayer): boolean {
  return p.rushing?.some(row => row.n !== null) ?? false;
}
