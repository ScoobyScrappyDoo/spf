import { describe, expect, it } from 'vitest';
import { DEFENSE_FORMATIONS, FORMATIONS } from '../engine';
import { defenseFormationText, offenseFormationText } from './formation-text';

const off = (id: string) => offenseFormationText(FORMATIONS.find(f => f.id === id)!);
const def = (id: string) => defenseFormationText(DEFENSE_FORMATIONS.find(f => f.id === id)!);

describe('formation descriptions', () => {
  it('offense, by the number of backs', () => {
    expect(off('pass-3wr-te-left')).toBe('Pass orientated: 3 WR with a TE to the left');
    expect(off('pass-4wr')).toBe('Pass orientated: 4 WR');
    expect(off('pass-2wr-2te')).toBe('Pass orientated: 2 WR and two TEs');
    expect(off('2rb-2wr-te-right')).toBe('Balanced: 2 RB and 2 WR with a TE to the right');
    expect(off('2rb-2te-fl-left')).toBe('Balanced: 2 RB, a flanker on the left and two TEs');
    expect(off('run-3rb-2te')).toBe('Run orientated: 3 RB and two TEs');
    expect(off('run-3rb-te-left')).toBe('Run orientated: 3 RB and a split end with a TE to the left');
  });

  it('defense, with the boxes used', () => {
    expect(def('dl3-lb4-db4-ace')).toBe('Balanced: 3 linemen in A, C and E, 4 linebackers in F, G, I and J, 4 backs');
    expect(def('dl5-lb2-db4-gi')).toBe('Run orientated: 5 linemen in A, B, C, D and E, 2 linebackers in G and I, 4 backs');
    expect(def('dl4-lb1-db6')).toBe('Pass orientated: 4 linemen in A, B, D and E, 1 linebacker in H, 6 backs (two of them in box L)');
  });
});
