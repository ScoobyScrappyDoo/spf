import { Position } from './players';
import { Side } from './game-side';

/** How long a player is out (rule 6.2). Capped at the rest of the game: no seasons here. */
export type InjuryLength =
  | { kind: 'PLAYS'; remaining: number }
  | { kind: 'QUARTER'; quarter: number }
  | { kind: 'GAME' };

export interface Injury {
  side: Side;
  playerId: string;
  name: string;
  position: Position;
  /** Where he was hurt, e.g. "RB1" or "box C", for the Data page. */
  where: string;
  length: InjuryLength;
  quarter: number;
  clock: number;
}
