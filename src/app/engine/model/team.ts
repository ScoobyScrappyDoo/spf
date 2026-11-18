import { Range } from './common';
import { PlayerCard } from './players';

export interface ReturnResult {
  yards: number;
  /** "f" on the card: the return ends in a fumble (rule 8.1.2). */
  fumble: boolean;
  /** "*" on the card: flip again, RN 1-2 uses the breakaway row (rule 8.1.1). */
  breakaway: boolean;
}

export type ReturnerRef = { name: string; playerId: string | null } | { sameAs: string };

export interface ReturnUnit {
  returners: Record<string, ReturnerRef>;
  /** 12 rows (run numbers 1-12), each keyed by returner column (KR1..KR4 / PR1..PR4). null = '-' on the card. */
  table: Record<string, ReturnResult | null>[];
  breakaway: Record<string, number | null>;
}

export interface LineupEntry {
  /** The position label as printed on the team's lineup card (QB, WR, OT, CB, DS ...). */
  listed: string;
  playerId: string;
}

export interface Team {
  id: string;
  year: number;
  name: string;
  /** The name to show in city mode when it isn't simply the name minus the nickname (e.g. "New England AH"). */
  city?: string;
  shortName: string;
  abbreviation: string;
  division: string;
  coach: string;
  record: string;
  bigPlays: { home: number; road: number };
  fumblesLost: Range;
  players: PlayerCard[];
  startingLineup: { offense: LineupEntry[]; defenseFormation: string; defense: LineupEntry[] };
  /** null when the card set has no return card yet (the Raiders XML, for now). */
  kickReturn: ReturnUnit | null;
  puntReturn: ReturnUnit | null;
  /** Corrections made while converting the printed cards (typing slips, repaired ranges, XML disagreements). */
  dataNotes?: string[];
  /** e.g. "Superbowl Champions" */
  note?: string;
  /** Formations from the WPF data. Stored for later; the offense opens in the formation that fits the starters. */
  defaultFormations?: { offense: string; defense: string };
}
