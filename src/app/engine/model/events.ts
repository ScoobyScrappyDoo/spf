/**
 * What happened on each play, as plain records. The stats (and later the drive tracker and the game archive) are
 * worked out from these, never kept as running totals, so a stat can be added or corrected by recalculating.
 */
import { Side } from './game-side';

/** Recorded by the engine for every event, so stats can be split by quarter and drives rebuilt later. */
export interface EventStamp {
  /** Counts plays from the start of the game (kickoffs and snaps). */
  play: number;
  quarter: number;
  /** Seconds left in the quarter when the play started. */
  clock: number;
  possession: number;
}

export type StatEventBody =
  /** A snap: who had the ball, the down it was, how long it took and whether it moved the chains. */
  /** ballOn: where the play started; endBallOn: where it ended, both counted from the offense's own goal line. */
  | { type: 'SNAP'; side: Side; down: number; distance: number; seconds: number; firstDown: boolean; counted: boolean; ballOn?: number; endBallOn?: number }
  /** A carry. Yards to the goal line at most; a touchdown run is flagged when the score happens. */
  /** kneel: a quarterback flop (rule 7.1.2.2), the victory formation's kneel-down. */
  | { type: 'RUSH'; side: Side; playerId: string; yards: number; touchdown: boolean; kneel?: boolean }
  /** A tackle: solo, or one of two players sharing it (an assist each, NFL style). */
  | { type: 'TACKLE'; side: Side; playerId: string; assisted: boolean }
  | { type: 'FUMBLE'; side: Side; playerId: string; lost: boolean }
  | { type: 'FUMBLE_RECOVERY'; side: Side; playerId: string }
  /** playerId null: a team foul (delay of game). Declined penalties are kept but don't count in the totals. */
  | { type: 'PENALTY'; side: Side; playerId: string | null; name: string; yards: number; accepted: boolean }
  | { type: 'KICKOFF'; side: Side; touchback: boolean; onside: boolean; recovered: boolean }
  | { type: 'KICK_RETURN'; side: Side; playerId: string | null; name: string; yards: number; touchdown: boolean }
  | { type: 'EXTRA_POINT'; side: Side; playerId: string | null; good: boolean }
  /** A punt: gross yards from the line of scrimmage to where it came down. */
  | { type: 'PUNT'; side: Side; playerId: string | null; yards: number; touchback: boolean; inside20: boolean; fairCatch: boolean; blocked: boolean }
  | { type: 'PUNT_RETURN'; side: Side; playerId: string | null; name: string; yards: number; touchdown: boolean }
  | { type: 'FIELD_GOAL'; side: Side; playerId: string | null; distance: number; good: boolean; blocked: boolean }
  /** A pass attempt: who threw, who it went to (after any redirect), and how it ended. */
  /** kind: the pass called (quick, short, long, screen), for yards after the catch; missing in older games. */
  | { type: 'PASS'; side: Side; playerId: string; targetId: string | null; complete: boolean; yards: number; touchdown: boolean; intercepted: boolean; kind?: 'QK' | 'SH' | 'LG' | 'SC' }
  /** A timeout (rule 9.2): which team, and how many it has left in the half. */
  | { type: 'TIMEOUT'; side: Side; left: number }
  /** A pass rush play (rule 8.3.6): the quarterback under pressure, whatever came of it (sack, scramble, pass). */
  | { type: 'PRESSURE'; side: Side; playerId: string; sack: boolean }
  /** A sack: the quarterback's lost yards, and who got to him. */
  | { type: 'SACK'; side: Side; playerId: string; yards: number; byId: string | null }
  | { type: 'INTERCEPTION'; side: Side; playerId: string; returnYards: number; touchdown: boolean }
  | { type: 'SAFETY'; side: Side };

export type StatEvent = StatEventBody & EventStamp;
