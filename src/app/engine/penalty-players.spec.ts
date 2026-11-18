import { describe, expect, it } from 'vitest';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, buildLineup, choosePenalized, getDefenseFormation, getFormation, PENALTY_SHARES, penaltyKind,
  penaltyWeights, PlayerCard, SeededRandom, Team,
} from './index';

const patriots = patriotsJson as unknown as Team;
const dolphins = dolphinsJson as unknown as Team;
const onField = (team: Team, ids: (string | undefined)[]) => ids.map(id => team.players.find(p => p.id === id)).filter((p): p is PlayerCard => !!p);
const offense = onField(patriots, Object.values(buildLineup(patriots, getFormation('pass-2wr-2te'))));
const fourWide = onField(patriots, Object.values(buildLineup(patriots, getFormation('pass-4wr'))));
const defense = onField(dolphins, Object.values(buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace'))).flat());
const share = (w: ReturnType<typeof penaltyWeights>, test: (p: PlayerCard) => boolean) => w.filter(x => test(x.player)).reduce((a, x) => a + x.weight, 0);
const isOL = (p: PlayerCard) => p.position === 'OT' || p.position === 'OG' || p.position === 'C';

describe('who committed the penalty', () => {
  it('maps the penalty table to real-football fouls', () => {
    expect(penaltyKind('O', 7)).toBe('OFFENSIVE_HOLDING');
    expect(penaltyKind('O', 1)).toBe('FALSE_START');
    expect(penaltyKind('D', 1)).toBe('DEFENSIVE_OFFSIDE');
    expect(penaltyKind('D', 9)).toBe('DEFENSIVE_PERSONAL_FOUL');
    expect(penaltyKind('O', 14)).toBe('TEAM');
    expect(penaltyKind('K', 15)).toBe('KICKER');
    expect(penaltyKind('R', 11)).toBe('SPECIAL_TEAMS');
  });

  it('offensive holding: mostly linemen, tackles more than guards, but backs and receivers can hold too', () => {
    const w = penaltyWeights('OFFENSIVE_HOLDING', offense);
    expect(share(w, isOL)).toBeCloseTo(0.8, 5);
    const tackle = w.find(x => x.player.position === 'OT')!.weight;
    const guard = w.find(x => x.player.position === 'OG')!.weight;
    expect(tackle).toBeGreaterThan(guard);
    expect(share(w, p => p.position === 'RB')).toBeGreaterThan(0);
    expect(share(w, p => p.position === 'QB')).toBe(0);
  });

  it('a group that is not on the field drops out and the others scale up', () => {
    const w = penaltyWeights('OFFENSIVE_HOLDING', fourWide); // no tight end
    expect(share(w, p => p.position === 'TE')).toBe(0);
    expect(share(w, () => true)).toBeCloseTo(1, 5);
    expect(share(w, isOL)).toBeCloseTo(80 / (80 + 6 + 4), 5);
  });

  it('a personal foul leans towards the defender at the spot of the play', () => {
    const near = defense.find(p => p.position === 'LB')!;
    const plain = penaltyWeights('DEFENSIVE_PERSONAL_FOUL', defense).find(x => x.player.id === near.id)!.weight;
    const tilted = penaltyWeights('DEFENSIVE_PERSONAL_FOUL', defense, new Set([near.id])).find(x => x.player.id === near.id)!.weight;
    expect(tilted).toBe(plain * 3);
  });

  it('over many fouls the shares match the table', () => {
    const rng = new SeededRandom(42);
    let ol = 0, rb = 0;
    for (let i = 0; i < 10000; i++) {
      const p = choosePenalized('OFFENSIVE_HOLDING', offense, rng)!;
      if (isOL(p)) ol++;
      if (p.position === 'RB') rb++;
    }
    expect(ol / 10000).toBeGreaterThan(0.77);
    expect(ol / 10000).toBeLessThan(0.83);
    expect(rb).toBeGreaterThan(0);
    expect(PENALTY_SHARES.OFFENSIVE_HOLDING.OL).toBe(80);
  });

  it('team fouls name nobody, a kickoff out of bounds names the kicker', () => {
    expect(choosePenalized('TEAM', offense, new SeededRandom(1))).toBeNull();
    expect(choosePenalized('KICKER', patriots.players, new SeededRandom(1))?.position).toBe('K');
  });

  it('is reproducible from the seed', () => {
    const a = choosePenalized('DEFENSIVE_HOLDING', defense, new SeededRandom(7))!;
    const b = choosePenalized('DEFENSIVE_HOLDING', defense, new SeededRandom(7))!;
    expect(b.id).toBe(a.id);
  });
});
