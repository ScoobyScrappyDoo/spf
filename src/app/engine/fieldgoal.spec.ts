import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, callToss, chooseAfterToss, choosePenalty, computeStats, createGame, declareFieldGoal, declarePunt, Fac,
  fieldGoalDistance, fieldGoalPlay, GameContext, GameState, getDefenseFormation, goodRange, kickerOf, kickoff, RegularFac,
  setDefenseReady, Team,
} from './index';

const cards = deckJson as Fac[];
const patriots = patriotsJson as unknown as Team;
const dolphins = dolphinsJson as unknown as Team;
const ctx: GameContext = { cards, teams: { home: patriots, away: dolphins } };
const regular = cards.filter((c): c is RegularFac => !c.isZ);
const zCard = cards.find(c => c.isZ)!;
const franklin = kickerOf(patriots)!; // 18-25: 1-43, 26-35: 1-38, 36-45: 1-28, 46-50: 1-18

function pick(...preds: ((c: RegularFac) => boolean)[]): Fac[] {
  const used = new Set<string>();
  return preds.map(p => {
    const c = regular.find(x => !used.has(x.id) && p(x));
    if (!c) throw new Error('No card matches');
    used.add(c.id);
    return c;
  });
}
const pn = (n: number) => (c: RegularFac) => c.passNumber === n;
function stack(state: GameState, top: Fac[]): GameState {
  const ids = top.map(c => c.id);
  return { ...state, deck: { ...state.deck, order: [...ids, ...state.deck.order.filter(id => !ids.includes(id))], next: 0 } };
}
/** Patriots (home) ball, 4th & 5 at the given yard line. */
function at(ballOn: number): GameState {
  let s = createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1 }, cards);
  for (const c of ['HEADS', 'TAILS'] as const) {
    const t = callToss(s, c, ctx);
    if (t.toss.winner === 'home') { s = t; break; }
  }
  s = kickoff(stack(chooseAfterToss(s, 'RECEIVE', ctx), pick(c => c.runNumber === 11)), ctx);
  return { ...s, ballOn, down: 4, distance: 5 };
}
const defense = buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace'));
const kick = (s: GameState, top: Fac[]) =>
  fieldGoalPlay(setDefenseReady(declareFieldGoal(stack(s, top), true), true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'PASS' }), ctx);

describe('field goals (rule 8.6.1)', () => {
  it('only from within 38 yards of the goal; the kick is 17 yards more', () => {
    expect(() => declareFieldGoal(at(61), true)).toThrow('Out of range');
    expect(() => declareFieldGoal(at(62), true)).not.toThrow();
    expect(fieldGoalDistance(80)).toBe(37);
  });

  it('over 50 yards, 2 come off the 46-50 range for every yard', () => {
    expect(goodRange(franklin, 37)).toEqual({ from: 1, to: 28 });
    expect(goodRange(franklin, 50)).toEqual({ from: 1, to: 18 });
    expect(goodRange(franklin, 52)).toEqual({ from: 1, to: 14 });
    expect(goodRange(franklin, 61)).toBeNull();
  });

  it('good: 3 points, and the kicking team kicks off', () => {
    const s = kick(at(80), pick(pn(20)));
    expect(s.score.home).toBe(3);
    expect(s).toMatchObject({ phase: 'KICKOFF', kickoff: { kicking: 'home' }, fieldGoalCall: false });
  });

  it('no good: the other team takes over at the line of scrimmage, or at their 20', () => {
    expect(kick(at(70), pick(pn(30)))).toMatchObject({ phase: 'PLAY', possession: 'away', ballOn: 30 });
    expect(kick(at(85), pick(pn(45)))).toMatchObject({ possession: 'away', ballOn: 20 });
  });

  it('PN 48 is blocked and returned for a touchdown; over 50 yards PN 47 is too', () => {
    const s = kick(at(80), pick(pn(48)));
    expect(s.score.away).toBe(7); // touchdown and the Dolphins' extra point
    const long = kick(at(65), pick(pn(47))); // a 52-yard try
    expect(long.score.away).toBeGreaterThanOrEqual(6);
  });

  it('a 52-yard try: good on 1-14 only', () => {
    expect(kick(at(65), pick(pn(14))).score.home).toBe(3);
    expect(kick(at(65), pick(pn(15))).possession).toBe('away');
  });

  it('roughing the kicker: the kicking team may take 15 yards and a first down instead of the points', () => {
    const roughing = (c: RegularFac) => c.z.type === 'PENALTY' && c.z.byCategory[2].against === 'R' && c.z.byCategory[2].penalty === 12;
    const [card, result] = pick(pn(20), roughing);
    const s = kick(at(80), [zCard, card, result]);
    expect(s.phase).toBe('PENALTY_CHOICE');
    // From the opponent's 20, 15 yards is more than half the distance to the goal: half the distance (rule 8.8.3).
    expect(choosePenalty(s, true, ctx)).toMatchObject({ possession: 'home', ballOn: 90, down: 1 });
    expect(choosePenalty(s, false, ctx).score.home).toBe(3);
  });

  it('a punt call and a field goal call cancel each other out', () => {
    const fg = declareFieldGoal(at(80), true);
    const punt = declarePunt(fg, { coffinCorner: null });
    expect(punt).toMatchObject({ fieldGoalCall: false, puntCall: { coffinCorner: null } });
    expect(declareFieldGoal(punt, true)).toMatchObject({ fieldGoalCall: true, puntCall: null });
  });

  it('field goals in the stats: made, attempted and the long', () => {
    const s = kick(at(80), pick(pn(20)));
    const line = computeStats(s, { home: patriots, away: dolphins }).players.home.find(p => p.playerId === franklin.id)!;
    expect(line.fieldGoals).toEqual({ made: 1, att: 1, long: 37, blocked: 0 });
  });
});
