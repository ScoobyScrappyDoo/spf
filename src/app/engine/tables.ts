/** Rulebook tables used by the kickoff (rule 6.4, 6.3). */

export type KickoffTableResult =
  | { kind: 'COLUMN_B' }
  | { kind: 'TOUCHBACK' }
  /** Return man and the receiving team's yard line where the return begins (0 = goal line). */
  | { kind: 'FIELDED'; returner: 'KR1' | 'KR2' | 'KR3' | 'KR4'; landing: number };

const B = { kind: 'COLUMN_B' } as const;
const TB = { kind: 'TOUCHBACK' } as const;
const kr = (n: 1 | 2 | 3 | 4, landing: number): KickoffTableResult => ({ kind: 'FIELDED', returner: `KR${n}`, landing });

/** Kickoff Table column A, indexed by run number - 1. */
export const KICKOFF_A: readonly KickoffTableResult[] = [B, kr(1, 0), kr(1, 1), kr(2, 2), kr(1, 3), kr(1, 4), kr(2, 5), kr(2, 6), kr(3, 7), kr(2, 8), TB, B];

/** Kickoff Table column B. Reached from column A with a new card. */
export const KICKOFF_B: readonly KickoffTableResult[] = [kr(1, 10), kr(2, 11), kr(4, 12), kr(2, 13), kr(3, 14), kr(1, 15), kr(1, 0), TB, TB, TB, kr(4, 0), kr(4, 0)];

export const PENALTY_NAMES: Record<number, string> = {
  1: 'Offside', 2: 'Movement', 3: 'Illegal procedure', 4: 'Motion', 5: 'Personal foul', 6: 'Facemask',
  7: 'Holding', 8: 'Pass interference', 9: 'Personal foul', 10: 'Intentional grounding', 11: 'Clipping',
  12: 'Roughing the kicker', 13: 'Running into the kicker', 14: 'Delay of game', 15: 'Kickoff out of bounds',
};

/** Injury table (rule 6.2), by pass number. */
export function injuryLength(pn: number): string {
  if (pn <= 10) return 'out for the next 2 plays';
  if (pn <= 20) return 'out for the next 4 plays';
  if (pn <= 30) return 'out for the next 6 plays';
  if (pn <= 35) return 'out for the rest of the quarter';
  if (pn <= 43) return 'out for the rest of the game';
  if (pn <= 47) return `out for the rest of the game and the next ${pn - 43} game${pn > 44 ? 's' : ''}`;
  return 'out for the rest of the season';
}

// ---------------------------------------------------------------------------------------------
// Passing (rules 6.6, 6.7, 6.8 and 8.3.2.2)
// ---------------------------------------------------------------------------------------------

/**
 * Pass defense table (6.6): change to the QB's completion range by pass type and defense.
 * The second number applies when the line of scrimmage is within the defense's 20. Blitz against short and long passes
 * is a pass rush instead (rule 8.3.8). Screens are handled separately (their modifiers are on the run number).
 */
export const PASS_DEFENSE: Record<'QK' | 'SH' | 'LG', Record<'RUN' | 'PASS' | 'BLITZ' | 'PREVENT', [number, number]>> = {
  QK: { RUN: [0, -10], PASS: [-10, -15], BLITZ: [10, 10], PREVENT: [0, 0] },
  SH: { RUN: [5, 0], PASS: [-5, -5], BLITZ: [0, 0], PREVENT: [-5, -5] },
  LG: { RUN: [7, 7], PASS: [0, 0], BLITZ: [0, 0], PREVENT: [-7, -7] },
};

/** Who guards whom on a pass (rule 8.3.2.2). */
export const COVERING_BOX = { RE: 'N', LE: 'K', FL1: 'O', FL2: 'M', BK1: 'F', BK2: 'J', BK3: 'H' } as const;

/** Interception table (6.7): which box the interceptor is in, by run number (index RN - 1). */
export const INTERCEPTION_BOX: Record<'SC' | 'QK' | 'SH' | 'LG', string[]> = {
  SC: ['J', 'F', 'C', 'I', 'B', 'G', 'H', 'E', 'D', 'A', 'J', 'F'],
  QK: ['N', 'O', 'J', 'I', 'H', 'G', 'F', 'J', 'H', 'F', 'L', 'M'],
  SH: ['N', 'M', 'J', 'F', 'I', 'H', 'G', 'O', 'K', 'L', 'N', 'M'],
  LG: ['L', 'M', 'M', 'O', 'N', 'K', 'O', 'N', 'K', 'M', 'M', 'L'],
};

/** Interception return table (6.8), by run number; 100 means returned for a touchdown. */
export const INTERCEPTION_RETURN: Record<'LINE' | 'LB' | 'DB', number[]> = {
  LINE: [15, 10, 6, 3, 1, 0, 0, 0, 0, 0, 0, 0],
  LB: [20, 20, 15, 10, 8, 5, 4, 3, 0, 0, 0, 0],
  DB: [100, 50, 30, 20, 15, 10, 8, 6, 4, 2, 0, 0],
};
