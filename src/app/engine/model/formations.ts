/**
 * The offensive display (rule 3.1) and the eleven formations from the WPF version.
 * In C# each formation was a switch case setting nine booleans; here a formation is just data.
 */

export type LineSlot = 'LT' | 'LG' | 'C' | 'RG' | 'RT';
export type SkillSlot = 'SEL' | 'TEL' | 'TER' | 'SER' | 'FLL' | 'FLR' | 'RB1' | 'RB2' | 'RB3';
export type OffenseSlot = LineSlot | SkillSlot | 'QB';

export type SlotGroup = 'line' | 'end' | 'flanker' | 'back' | 'qb';

export const LINE_SLOTS: readonly LineSlot[] = ['LT', 'LG', 'C', 'RG', 'RT'];

export const SLOT_GROUP: Record<OffenseSlot, SlotGroup> = {
  LT: 'line', LG: 'line', C: 'line', RG: 'line', RT: 'line',
  SEL: 'end', TEL: 'end', TER: 'end', SER: 'end',
  FLL: 'flanker', FLR: 'flanker',
  RB1: 'back', RB2: 'back', RB3: 'back',
  QB: 'qb',
};

export const SLOT_LABELS: Record<OffenseSlot, string> = {
  SEL: 'Split end L', TEL: 'Tight end L', LT: 'Left tackle', LG: 'Left guard', C: 'Center',
  RG: 'Right guard', RT: 'Right tackle', TER: 'Tight end R', SER: 'Split end R',
  FLL: 'Flanker L', RB1: 'Back 1', QB: 'Quarterback', RB2: 'Back 2', RB3: 'Back 3', FLR: 'Flanker R',
};

/** Board layout: [row, column] on a 9-column grid, matching the WPF screen. */
export const SLOT_POSITION: Record<OffenseSlot, [number, number]> = {
  SEL: [1, 1], TEL: [1, 2], LT: [1, 3], LG: [1, 4], C: [1, 5], RG: [1, 6], RT: [1, 7], TER: [1, 8], SER: [1, 9],
  FLL: [2, 1], RB1: [2, 4], QB: [2, 5], RB2: [2, 6], RB3: [2, 7], FLR: [2, 9],
};

export type FormationId =
  | 'run-3rb-2te' | 'run-3rb-te-left' | 'run-3rb-te-right'
  | 'pass-3wr-te-left' | 'pass-3wr-te-right' | 'pass-2wr-2te' | 'pass-4wr'
  | '2rb-2wr-te-left' | '2rb-2wr-te-right' | '2rb-2te-fl-left' | '2rb-2te-fl-right';

export interface OffenseFormation {
  id: FormationId;
  name: string;
  /** The five skill positions in use. QB and the five linemen are always on the field. */
  skillSlots: SkillSlot[];
}

export const FORMATIONS: readonly OffenseFormation[] = [
  { id: 'run-3rb-2te', name: 'Run: 3 RB, 2 TE', skillSlots: ['TEL', 'TER', 'RB1', 'RB2', 'RB3'] },
  { id: 'run-3rb-te-left', name: 'Run: 3 RB, TE left', skillSlots: ['TEL', 'SER', 'RB1', 'RB2', 'RB3'] },
  { id: 'run-3rb-te-right', name: 'Run: 3 RB, TE right', skillSlots: ['SEL', 'TER', 'RB1', 'RB2', 'RB3'] },
  { id: 'pass-3wr-te-left', name: 'Pass: 3 WR, TE left', skillSlots: ['TEL', 'SER', 'FLL', 'FLR', 'RB1'] },
  { id: 'pass-3wr-te-right', name: 'Pass: 3 WR, TE right', skillSlots: ['SEL', 'TER', 'FLL', 'FLR', 'RB1'] },
  { id: 'pass-2wr-2te', name: 'Pass: 2 WR, 2 TE', skillSlots: ['TEL', 'TER', 'FLL', 'FLR', 'RB1'] },
  { id: 'pass-4wr', name: 'Pass: 4 WR', skillSlots: ['SEL', 'SER', 'FLL', 'FLR', 'RB1'] },
  { id: '2rb-2wr-te-left', name: '2 RB, 2 WR, TE left', skillSlots: ['TEL', 'SER', 'FLL', 'RB1', 'RB2'] },
  { id: '2rb-2wr-te-right', name: '2 RB, 2 WR, TE right', skillSlots: ['SEL', 'TER', 'FLR', 'RB1', 'RB2'] },
  { id: '2rb-2te-fl-left', name: '2 RB, 2 TE, FL left', skillSlots: ['TEL', 'TER', 'FLL', 'RB1', 'RB2'] },
  { id: '2rb-2te-fl-right', name: '2 RB, 2 TE, FL right', skillSlots: ['TEL', 'TER', 'FLR', 'RB1', 'RB2'] },
];

export function getFormation(id: FormationId): OffenseFormation {
  const f = FORMATIONS.find(x => x.id === id);
  if (!f) throw new Error(`Unknown formation ${id}`);
  return f;
}

/** All eleven slots in use: five linemen, the QB and the formation's five skill slots. */
export function slotsOnField(f: OffenseFormation): OffenseSlot[] {
  return [...LINE_SLOTS, 'QB', ...f.skillSlots];
}

/** Slots a play can be directed at (rule 7.1.3): QB, backs, ends and flankers. */
export function selectableSlots(f: OffenseFormation): OffenseSlot[] {
  return ['QB', ...f.skillSlots];
}

/**
 * The rulebook names receivers LE, RE, FL#1, FL#2, BK#1-3 (rules 7.1.3, 8.3.2.2).
 * With one flanker he is FL#1. With two flankers, FLL is FL#1.
 */
export type RulesRole = 'QB' | 'LE' | 'RE' | 'FL1' | 'FL2' | 'BK1' | 'BK2' | 'BK3';

export function rulesRole(slot: OffenseSlot, f: OffenseFormation): RulesRole | null {
  switch (slot) {
    case 'QB': return 'QB';
    case 'SEL': case 'TEL': return 'LE';
    case 'SER': case 'TER': return 'RE';
    case 'RB1': return 'BK1';
    case 'RB2': return 'BK2';
    case 'RB3': return 'BK3';
    case 'FLL': return 'FL1';
    case 'FLR': return f.skillSlots.includes('FLL') ? 'FL2' : 'FL1';
    default: return null;
  }
}
