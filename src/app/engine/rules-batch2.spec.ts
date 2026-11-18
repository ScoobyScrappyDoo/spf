import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  bigPlayResult, buildDefenseLineup, buildLineup, callToss, chooseAfterToss, coverageAllowed, createGame, DefenseCall, DefenseFormationId,
  DefenseSetup, Fac, GameContext, GameState, getDefenseFormation, getFormation, kickoff, RegularFac, setDefenseReady, snapPlay, Team,
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
function patriotsBall(over: Partial<GameState> = {}): GameState {
  let s = createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1 }, cards);
  for (const c of ['HEADS', 'TAILS'] as const) { const t = callToss(s, c, ctx); if (t.toss.winner === 'home') { s = t; break; } }
  return { ...kickoff(stack(chooseAfterToss(s, 'RECEIVE', ctx), pick(c => c.runNumber === 11)), ctx), targets: [], ...over };
}
const rn = (n: number) => (c: RegularFac) => c.runNumber === n;
const pn = (n: number) => (c: RegularFac) => c.passNumber === n;
const offense = buildLineup(patriots, getFormation('pass-2wr-2te'));
const setupFor = (formationId: DefenseFormationId, call: DefenseCall, more: Partial<DefenseSetup> = {}): DefenseSetup =>
  ({ formationId, lineup: buildDefenseLineup(dolphins, getDefenseFormation(formationId)), call, ...more });
const snap = (s: GameState, setup: DefenseSetup, top: Fac[], play: 'IL' | 'SH' = 'SH', slot: 'RB1' | 'FLL' = 'FLL') =>
  snapPlay(setDefenseReady(stack(s, top), true, setup), { formationId: 'pass-2wr-2te', slot, play, strategy: 'NONE', extraBlockers: [] }, offense, ctx);
const steps = (s: GameState) => s.log.filter(e => e.steps.length).at(-1)!.steps.join(' | ');

describe('double and triple coverage (rule 7.2.2)', () => {
  it('only with a pass or prevent defense, in formations with 4-4 or 3-5 in rows 2 and 3; triple only in the 3-2-6', () => {
    expect(coverageAllowed(setupFor('dl3-lb4-db4-ace', 'PASS'))).toMatchObject({ double: true, triple: false });
    expect(coverageAllowed(setupFor('dl3-lb4-db4-ace', 'RUN_NO_KEY')).double).toBe(false);
    expect(coverageAllowed(setupFor('dl4-lb3-db4-ghi', 'PASS')).double).toBe(false);
    expect(coverageAllowed(setupFor('dl3-lb2-db6-ace', 'PREVENT'))).toMatchObject({ double: true, triple: true });
  });

  it('a double-covered receiver counts -7 instead of his defender', () => {
    // Morgan (FLL) is FL#1: double him, then a short pass to him that the pass card leaves alone.
    const s = snap(patriotsBall(), setupFor('dl3-lb4-db4-ace', 'PASS', { coverage: [{ receiver: 'FL1', level: 'DOUBLE' }] }), pick(c => c.passes.SH === 'ORIG', pn(1), rn(3)));
    expect(steps(s)).toMatch(/double coverage -7 \(/);
  });

  it('an illegal coverage is refused when the defense says "All set!"', () => {
    expect(() => setDefenseReady(patriotsBall(), true, setupFor('dl4-lb3-db4-ghi', 'PASS', { coverage: [{ receiver: 'FL1', level: 'DOUBLE' }] }))).toThrow('Coverage');
    expect(() => setDefenseReady(patriotsBall(), true, setupFor('dl3-lb4-db4-ace', 'PASS', { coverage: [{ receiver: 'FL1', level: 'TRIPLE' }] }))).toThrow('3-2-6');
  });
});

describe('choosing blitzers', () => {
  it('only players in rows 2 and 3 can blitz', () => {
    const setup = setupFor('dl3-lb4-db4-ace', 'BLITZ');
    const lineman = setup.lineup.A![0];
    expect(() => setDefenseReady(patriotsBall(), true, { ...setup, blitzers: [lineman] })).toThrow('rows 2 and 3');
    const backer = setup.lineup.G![0];
    expect(setDefenseReady(patriotsBall(), true, { ...setup, blitzers: [backer] }).defenseReady).toBe(true);
  });
});

describe('big plays (rule 8.4)', () => {
  it('the Big Play Table: losses against runs, sacks and incompletions against passes, RN 8-12 fails', () => {
    expect(bigPlayResult(1, false)).toEqual({ kind: 'loss', yards: 4 });
    expect(bigPlayResult(6, false)).toEqual({ kind: 'loss', yards: 0 });
    expect(bigPlayResult(1, true)).toEqual({ kind: 'sack', yards: 13 });
    expect(bigPlayResult(5, true)).toEqual({ kind: 'incomplete' });
    expect(bigPlayResult(8, true)).toBeNull();
  });

  it('a big play against a run: RN 1 is a loss of 4, and one is used', () => {
    const before = patriotsBall();
    const s = snap(before, setupFor('dl3-lb4-db4-ace', 'RUN_NO_KEY', { bigPlay: true }), pick(rn(1)), 'IL', 'RB1');
    expect(s.ballOn).toBe(before.ballOn! - 4);
    expect(s.bigPlaysUsed?.away).toBe(1);
    expect(steps(s)).toContain('Big play defense! RN 1: a loss of 4.');
  });

  it('only one per possession, and only as many as the team card allows', () => {
    const s = snap(patriotsBall(), setupFor('dl3-lb4-db4-ace', 'RUN_NO_KEY', { bigPlay: true }), pick(rn(9)), 'IL', 'RB1');
    expect(steps(s)).toContain('the card fails, the play goes on');
    expect(() => snap({ ...s, targets: [] }, setupFor('dl3-lb4-db4-ace', 'RUN_NO_KEY', { bigPlay: true }), [], 'IL', 'RB1')).toThrow('One per possession');
    expect(() => snap(patriotsBall({ bigPlaysUsed: { away: 9 } }), setupFor('dl3-lb4-db4-ace', 'RUN_NO_KEY', { bigPlay: true }), [], 'IL', 'RB1')).toThrow('No big plays left');
  });
});
