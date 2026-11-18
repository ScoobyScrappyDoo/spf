import { describe, expect, it } from 'vitest';
import patriotsJson from './testdata/1984/patriots.json';
import bearsJson from './testdata/1984/bears.json';
import {
  allowedInBox, buildDefenseLineup, DEFENSE_FORMATIONS, defenseFormationForTeam, defenseReplacements, DefensiveBox,
  getDefenseFormation, replaceDefender, ROWS, rowOf, Team,
} from './index';

const patriots = patriotsJson as unknown as Team;
const bears = bearsJson as unknown as Team;
const count = (f: (typeof DEFENSE_FORMATIONS)[number], row: number) => f.slots.filter(s => rowOf(s.box) === row).length;

describe('defensive formations (rule 3.2)', () => {
  it.each(DEFENSE_FORMATIONS.map(f => [f.name, f] as const))('%s fits the display rules', (_, f) => {
    expect(f.slots.length).toBe(11);
    expect(count(f, 1)).toBeGreaterThanOrEqual(3);
    expect(count(f, 2)).toBeLessThanOrEqual(5);
    expect(count(f, 3)).toBeLessThanOrEqual(6);
    // One player per box in rows 2 and 3, except box L which takes two, and only once K, M, N and O are filled.
    for (const box of [...ROWS[1], ...ROWS[2]]) {
      expect(f.slots.filter(s => s.box === box).length).toBeLessThanOrEqual(box === 'L' ? 2 : 1);
    }
    if (f.slots.some(s => s.box === 'L')) {
      for (const box of ['K', 'M', 'N', 'O'] as DefensiveBox[]) expect(f.slots.some(s => s.box === box)).toBe(true);
    }
  });
});

describe('defensive lineups', () => {
  it.each(DEFENSE_FORMATIONS.map(f => [f.name, f] as const))('fills every box of %s for every team, with legal players', (_, f) => {
    for (const team of [patriots, bears]) {
      const lineup = buildDefenseLineup(team, f);
      const ids = Object.values(lineup).flat();
      expect(ids.length).toBe(11);
      expect(new Set(ids).size).toBe(11);
      for (const [box, players] of Object.entries(lineup)) {
        for (const id of players!) {
          const p = team.players.find(x => x.id === id)!;
          expect(allowedInBox(box as DefensiveBox)).toContain(p.position);
        }
      }
    }
  });

  it("opens in the lineup card's formation with the listed starters", () => {
    expect(defenseFormationForTeam(patriots)).toBe('dl3-lb4-db4-ace');
    expect(defenseFormationForTeam(bears)).toBe('dl4-lb3-db4-ghi');
    const f = getDefenseFormation(defenseFormationForTeam(patriots));
    const ids = new Set(Object.values(buildDefenseLineup(patriots, f)).flat());
    expect(patriots.startingLineup.defense.every(e => ids.has(e.playerId))).toBe(true);
  });

  it('puts an end in the third tackle box when a team has only two tackles (your caveat)', () => {
    const twoTackles: Team = { ...patriots, players: patriots.players.filter(p => p.position !== 'DT' || p.lastName !== 'Henson') };
    expect(twoTackles.players.filter(p => p.position === 'DT').length).toBe(2);
    const lineup = buildDefenseLineup(twoTackles, getDefenseFormation('dl5-lb2-db4-gi'));
    const pos = (box: DefensiveBox) => twoTackles.players.find(p => p.id === lineup[box]![0])!.position;
    expect((['B', 'C', 'D'] as DefensiveBox[]).map(pos).sort()).toEqual(['DE', 'DT', 'DT']);
    expect([pos('A'), pos('E')]).toEqual(['DE', 'DE']);
  });

  it('keeps players in their boxes when the formation changes', () => {
    const before = buildDefenseLineup(patriots, getDefenseFormation('dl3-lb4-db4-ace'));
    const after = buildDefenseLineup(patriots, getDefenseFormation('dl3-lb2-db6-ace'), before);
    expect(after.A).toEqual(before.A);
    expect(after.K).toEqual(before.K);
    expect(after.L!.length).toBe(2);
    expect(after.F).toBeUndefined();
  });

  it('only offers bench players who may stand in the box', () => {
    const lineup = buildDefenseLineup(patriots, getDefenseFormation('dl3-lb4-db4-ace'));
    expect(defenseReplacements(patriots, lineup, 'K').every(p => p.position === 'DB')).toBe(true);
    expect(defenseReplacements(patriots, lineup, 'F').every(p => p.position === 'LB')).toBe(true);
    const keith = patriots.players.find(p => p.lastName === 'Lee')!;
    expect(replaceDefender(lineup, 'K', 0, keith).K).toEqual([keith.id]);
    expect(replaceDefender(lineup, 'F', 0, keith)).toBe(lineup); // a DB can't play linebacker
  });
});
