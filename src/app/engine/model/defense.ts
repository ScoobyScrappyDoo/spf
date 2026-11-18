/**
 * The defensive display (rule 3.2): three rows of five boxes.
 *   Row 1, A-E: the line. Ends, tackles and linebackers; up to two per box.
 *   Row 2, F-J: linebackers only, one per box.
 *   Row 3, K-O: defensive backs only, one per box except L, which takes two.
 * And the ten formations from the WPF version (FormationNameDefense), as data.
 */
import { DefensiveBox } from './fac';
import { Position } from './players';

export type { DefensiveBox };
export const ROWS: readonly (readonly DefensiveBox[])[] = [['A', 'B', 'C', 'D', 'E'], ['F', 'G', 'H', 'I', 'J'], ['K', 'L', 'M', 'N', 'O']];
export const rowOf = (box: DefensiveBox): 1 | 2 | 3 => (ROWS.findIndex(r => r.includes(box)) + 1) as 1 | 2 | 3;

/** What each box prefers, best first. The fallbacks are how a team short of tackles still fills a five-man line. */
export type DefenseRole = 'DE' | 'DT' | 'LB' | 'CB' | 'S' | 'DB';

export interface DefenseSlot {
  box: DefensiveBox;
  role: DefenseRole;
}

export type DefenseFormationId =
  | 'dl3-lb2-db6-bcd' | 'dl3-lb2-db6-ace' | 'dl3-lb4-db4-bcd' | 'dl3-lb4-db4-ace' | 'dl4-lb1-db6'
  | 'dl4-lb3-db4-fhj' | 'dl4-lb3-db4-ghi' | 'dl5-lb1-db5' | 'dl5-lb2-db4-fj' | 'dl5-lb2-db4-gi';

export interface DefenseFormation {
  id: DefenseFormationId;
  name: string;
  slots: DefenseSlot[];
}

const s = (box: DefensiveBox, role: DefenseRole): DefenseSlot => ({ box, role });
const corners = [s('K', 'CB'), s('O', 'CB'), s('M', 'S'), s('N', 'S')];

export const DEFENSE_FORMATIONS: readonly DefenseFormation[] = [
  { id: 'dl3-lb4-db4-ace', name: '3-4 (A C E)', slots: [s('A', 'DE'), s('C', 'DT'), s('E', 'DE'), s('F', 'LB'), s('G', 'LB'), s('I', 'LB'), s('J', 'LB'), ...corners] },
  { id: 'dl3-lb4-db4-bcd', name: '3-4 (B C D)', slots: [s('B', 'DE'), s('C', 'DT'), s('D', 'DE'), s('F', 'LB'), s('G', 'LB'), s('I', 'LB'), s('J', 'LB'), ...corners] },
  { id: 'dl4-lb3-db4-ghi', name: '4-3 (G H I)', slots: [s('A', 'DE'), s('B', 'DT'), s('D', 'DT'), s('E', 'DE'), s('G', 'LB'), s('H', 'LB'), s('I', 'LB'), ...corners] },
  { id: 'dl4-lb3-db4-fhj', name: '4-3 (F H J)', slots: [s('A', 'DE'), s('B', 'DT'), s('D', 'DT'), s('E', 'DE'), s('F', 'LB'), s('H', 'LB'), s('J', 'LB'), ...corners] },
  { id: 'dl5-lb2-db4-gi', name: '5-2 (G I)', slots: [s('A', 'DE'), s('B', 'DT'), s('C', 'DT'), s('D', 'DT'), s('E', 'DE'), s('G', 'LB'), s('I', 'LB'), ...corners] },
  { id: 'dl5-lb2-db4-fj', name: '5-2 (F J)', slots: [s('A', 'DE'), s('B', 'DT'), s('C', 'DT'), s('D', 'DT'), s('E', 'DE'), s('F', 'LB'), s('J', 'LB'), ...corners] },
  { id: 'dl3-lb2-db6-ace', name: '3-2-6 (A C E)', slots: [s('A', 'DE'), s('C', 'DT'), s('E', 'DE'), s('G', 'LB'), s('I', 'LB'), ...corners, s('L', 'DB'), s('L', 'DB')] },
  { id: 'dl3-lb2-db6-bcd', name: '3-2-6 (B C D)', slots: [s('B', 'DE'), s('C', 'DT'), s('D', 'DE'), s('F', 'LB'), s('J', 'LB'), ...corners, s('L', 'DB'), s('L', 'DB')] },
  { id: 'dl4-lb1-db6', name: '4-1-6', slots: [s('A', 'DE'), s('B', 'DT'), s('D', 'DT'), s('E', 'DE'), s('H', 'LB'), ...corners, s('L', 'DB'), s('L', 'DB')] },
  { id: 'dl5-lb1-db5', name: '5-1-5', slots: [s('A', 'DE'), s('B', 'DT'), s('C', 'DT'), s('D', 'DT'), s('E', 'DE'), s('H', 'LB'), ...corners, s('L', 'DB')] },
];

export function getDefenseFormation(id: DefenseFormationId): DefenseFormation {
  const f = DEFENSE_FORMATIONS.find(x => x.id === id);
  if (!f) throw new Error(`Unknown defensive formation ${id}`);
  return f;
}

/** Which card positions may stand in a box (rule 3.2). */
export function allowedInBox(box: DefensiveBox): readonly Position[] {
  const row = rowOf(box);
  return row === 1 ? ['DE', 'DT', 'LB'] : row === 2 ? ['LB'] : ['DB'];
}

/** The defense's secret choice (rule 7.2.1). Coverage strategies (rule 7.2.2) come later. */
export type DefenseCall = 'RUN_KEY_BK1' | 'RUN_KEY_BK2' | 'RUN_KEY_BK3' | 'RUN_NO_KEY' | 'PASS' | 'PREVENT' | 'BLITZ';

export const DEFENSE_CALL_LABELS: Record<DefenseCall, string> = {
  RUN_KEY_BK1: 'Run defense, key Back 1',
  RUN_KEY_BK2: 'Run defense, key Back 2',
  RUN_KEY_BK3: 'Run defense, key Back 3',
  RUN_NO_KEY: 'Run defense, no key',
  PASS: 'Pass defense',
  PREVENT: 'Prevent defense',
  BLITZ: 'Pass blitz defense',
};
export const RUN_DEFENSES: readonly DefenseCall[] = ['RUN_KEY_BK1', 'RUN_KEY_BK2', 'RUN_KEY_BK3', 'RUN_NO_KEY'];
export const PASS_DEFENSES: readonly DefenseCall[] = ['PASS', 'PREVENT', 'BLITZ'];
