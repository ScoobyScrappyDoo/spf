import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, buildLineup, callToss, chooseAfterToss, createGame, declareFieldGoal, declarePunt, Fac, fieldGoalPlay, GameContext,
  GameState, getDefenseFormation, getFormation, kickoff, KICKOFF_A, puntPlay, RegularFac, replaceDefender, setDefenseReady, snapPlay, Team,
} from './index';

const cards = deckJson as Fac[];
const patriots = patriotsJson as unknown as Team;
const dolphins = dolphinsJson as unknown as Team;
const ctx: GameContext = { cards, teams: { home: patriots, away: dolphins } };
const regular = cards.filter((c): c is RegularFac => !c.isZ);
const pick = (...preds: ((c: RegularFac) => boolean)[]) => {
  const used = new Set<string>();
  return preds.map(p => { const c = regular.find(x => !used.has(x.id) && p(x))!; used.add(c.id); return c; });
};
const stack = (s: GameState, top: Fac[]) => {
  const ids = top.map(c => c.id);
  return { ...s, deck: { ...s.deck, order: [...ids, ...s.deck.order.filter(id => !ids.includes(id))], next: 0 } };
};
const rn = (n: number) => (c: RegularFac) => c.runNumber === n;
const pn = (n: number) => (c: RegularFac) => c.passNumber === n;
function toKickoff(): GameState {
  let s = createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1 }, cards);
  for (const c of ['HEADS', 'TAILS'] as const) { const t = callToss(s, c, ctx); if (t.toss.winner === 'home') { s = t; break; } }
  return chooseAfterToss(s, 'RECEIVE', ctx); // Miami kicks off to New England
}
const patriotsBall = (over: Partial<GameState> = {}): GameState => ({ ...kickoff(stack(toKickoff(), pick(rn(11))), ctx), targets: [], ...over });
const steps = (s: GameState) => s.log.filter(e => e.steps.length).at(-1)!.steps.join(' | ');
const ready = (s: GameState, more: object = {}) => setDefenseReady(s, true, { formationId: 'dl3-lb4-db4-ace', lineup: buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace')), call: 'PASS', ...more });
const returnRn = KICKOFF_A.findIndex(e => e.kind === 'FIELDED') + 1; // a kick that is fielded and returned

describe('O1 for defensive backs', () => {
  it('a safety covering from a cornerback box counts one worse', () => {
    const safety = dolphins.players.find(p => p.position === 'DB' && p.role === 'S')!;
    // Box K guards the left end; put the safety there and throw short to the left end (Dawson, TEL).
    const lineup = replaceDefender(buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace')), 'K', 0, safety);
    const s = snapPlay(setDefenseReady(stack(patriotsBall(), pick(c => c.passes.SH === 'ORIG', pn(1), rn(3))), true, { formationId: 'dl3-lb4-db4-ace', lineup, call: 'PASS' }),
      { formationId: 'pass-2wr-2te', slot: 'TEL', play: 'SH', strategy: 'NONE', extraBlockers: [] }, buildLineup(patriots, getFormation('pass-2wr-2te')), ctx);
    expect(steps(s)).toContain(`${safety.lastName} `);
    expect(steps(s)).toContain('+1 out of position');
  });
});

describe('O2 onside-kick defense and O3 squib kicks', () => {
  it('against the onside-kick defense, an onside kick needs PN 1-7', () => {
    const s = kickoff(stack(toKickoff(), pick(pn(9))), ctx, { onside: true, onsideDefense: true });
    expect(steps(s)).toContain('receiving team recovers');
    const normal = kickoff(stack(toKickoff(), pick(pn(9))), ctx, { onside: true });
    expect(steps(normal)).toContain('kicking team recovers (1-11)');
  });

  it('a normal kickoff against the onside-kick defense is returned 20 yards at most', () => {
    const s = kickoff(stack(toKickoff(), pick(rn(returnRn), rn(1), rn(9))), ctx, { onsideDefense: true });
    const ret = s.events!.find(e => e.type === 'KICK_RETURN');
    expect(ret && ret.type === 'KICK_RETURN' && ret.yards).toBeLessThanOrEqual(20);
  });

  it('a squib kick: the return starts 15 yards farther up and its RN gets +1', () => {
    const s = kickoff(stack(toKickoff(), pick(rn(returnRn), rn(4))), ctx, { squib: true });
    expect(steps(s)).toContain('Squib kick');
    expect(steps(s)).toContain('RN 4 +1 = 5');
  });
});

describe('fake kicks (rule O6)', () => {
  const fourth = (over: Partial<GameState> = {}) => patriotsBall({ down: 4, distance: 4, ballOn: 45, ...over });

  it('a fake punt on RN 1: a 30-yard pass to the left end', () => {
    const s = puntPlay(ready(stack(declarePunt(fourth(), { coffinCorner: null, fake: true }), pick(rn(1)))), ctx);
    expect(steps(s)).toContain('Fake punt! RN 1.');
    expect(s.ballOn).toBe(75);
    expect(s.down).toBe(1);
  });

  it('a defense expecting it adds 2: RN 1 becomes a 10-yard pass to the right end', () => {
    const s = puntPlay(ready(stack(declarePunt(fourth(), { coffinCorner: null, fake: true }), pick(rn(1))), { expectFake: true }), ctx);
    expect(steps(s)).toContain('RN 1 +2 (the defense expected it) = 3');
    expect(s.ballOn).toBe(55);
  });

  it('a fake field goal: a real 12 is intercepted and returned for a touchdown; a 12 made by the +2 is incomplete', () => {
    const fg = (top: Fac[], more: object = {}) => fieldGoalPlay(ready(stack(declareFieldGoal(fourth({ ballOn: 80 }), true, true), top), more), ctx);
    const pick6 = fg(pick(rn(12)));
    expect(pick6.score.away).toBe(7);
    const inc = fg(pick(rn(10)), { expectFake: true });
    expect(steps(inc)).toContain('The pass is incomplete.');
    expect(inc.possession).toBe('away'); // 4th down: turned over on downs
  });

  it('against a real field goal, a defense expecting a fake cannot block it: the block is resolved again', () => {
    const s = fieldGoalPlay(ready(stack(declareFieldGoal(fourth({ ballOn: 80 }), true), pick(pn(48), pn(5))), { expectFake: true }), ctx);
    expect(steps(s)).toContain('would be a block, but the defense expected a fake');
  });
});
