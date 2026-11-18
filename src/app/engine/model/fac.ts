/** Fast Action Card types (rule 5.0). The deck lives in public/cards/fac-deck.json. */

export type OffensiveSpot = 'LT' | 'LG' | 'CN' | 'RG' | 'RT' | 'LE' | 'RE' | 'BK';
export type DefensiveBox = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O';

/** Where a running play is directed by the first card (rule 8.2.1). */
export type RunDirective =
  | { kind: 'blockers'; players: OffensiveSpot[] } // e.g. "LG + LT"
  | { kind: 'boxes'; boxes: DefensiveBox[] } //       e.g. "B + G"
  | { kind: 'matchup'; blocker: OffensiveSpot; box: DefensiveBox } // e.g. "LT vs A"
  | { kind: 'break' }; //                              long gain (rule 8.2.5)

/** Pass directive (rule 8.3.1): the original receiver, a redirect to another position, or a pass rush. */
export type PassTarget = 'ORIG' | 'PASS_RUSH' | 'FL' | 'LE' | 'RE' | 'BK1' | 'BK2';

export type ScreenResult = { result: 'COM'; multiplier: number } | { result: 'INC' } | { result: 'INT' };

export type PenaltyAgainst = 'O' | 'D' | 'K' | 'R';

export type ZResult =
  | { type: 'INJURY'; target: string }
  /** Four entries, one per penalty category 1-4 (rule 8.8.3). */
  | { type: 'PENALTY'; byCategory: { against: PenaltyAgainst; penalty: number }[] }
  /** "Fumble(s)" on the card means no fumble when the ball carrier is on the home team (rule 8.8.5). */
  | { type: 'FUMBLE'; homeTeamExempt: boolean };

export type SolitaireDefense = 'RUN_NO_KEY' | 'RUN_KEY_BC' | 'PASS' | 'PASS_DOUBLE' | 'PREVENT' | 'PREVENT_DOUBLE' | 'BLITZ';

export interface RegularFac {
  id: string;
  isZ: false;
  runNumber: number;
  /** "(OB)" after the run number: the play ends out of bounds when this RN is the last one used (rule 9.1). */
  outOfBounds: boolean;
  passNumber: number;
  runs: { SL: RunDirective; SR: RunDirective; IL: RunDirective; IR: RunDirective };
  endAround: 'OK' | number;
  passes: { QK: PassTarget; SH: PassTarget; LG: PassTarget };
  screen: ScreenResult;
  z: ZResult;
  /** Solitaire defenses 1-5 (rule S4). */
  solitaire: SolitaireDefense[];
}

export interface ZFac {
  id: string;
  isZ: true;
}

export type Fac = RegularFac | ZFac;

/**
 * A card turned over during a play, for showing the play's cards afterwards. z: a Z card that counted (its result is
 * read from a later card), a Z card that didn't (rule 8.8.1: only one per play, among the first three cards), or the
 * card whose Z line was read for the result. step: the play's step that reads it (an index into the log entry's
 * steps), so Last play can show which card each step came from.
 */
export interface DealtCard {
  id: string;
  z?: 'counts' | 'ignored' | 'result';
  step?: number;
}
