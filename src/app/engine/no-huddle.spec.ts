import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, buildLineup, callToss, chooseAfterToss, createGame, DefenseFormationId, Fac, GameContext, GameRules, GameState,
  getDefenseFormation, getFormation, kickoff, placePlayer, RegularFac, setDefenseReady, snapPlay, Team,
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
function patriotsBall(rules?: GameRules): GameState {
  let s = createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1, rules }, cards);
  for (const c of ['HEADS', 'TAILS'] as const) { const t = callToss(s, c, ctx); if (t.toss.winner === 'home') { s = t; break; } }
  return { ...kickoff(stack(chooseAfterToss(s, 'RECEIVE', ctx), pick(c => c.runNumber === 11)), ctx), targets: [] };
}
const ilToLG = (c: RegularFac) => c.runs.IL.kind === 'blockers' && c.runs.IL.players.length === 1 && c.runs.IL.players[0] === 'LG' && !c.outOfBounds;
const offense = buildLineup(patriots, getFormation('pass-2wr-2te'));
const defenseIn = (f: DefenseFormationId) => ({ formationId: f, lineup: buildDefenseLineup(dolphins, getDefenseFormation(f)), call: 'PASS' as const });
const run = (s: GameState, f: DefenseFormationId, lineup = offense, slot: 'RB1' | 'RB2' = 'RB1') => snapPlay(
  setDefenseReady(stack({ ...s, targets: [] }, pick(ilToLG, c => c.runNumber === 5)), true, defenseIn(f)),
  { formationId: 'pass-2wr-2te', slot, play: 'IL', strategy: 'NONE', extraBlockers: [] }, lineup, ctx, { twoMinute: true });

describe('the no-huddle at any time (house rule) and rule 8.7', () => {
  it('with the house rule, the no-huddle uses the fast timing in the 1st quarter', () => {
    const before = patriotsBall({ noHuddleAnyTime: true });
    const s = run(before, 'dl3-lb4-db4-ace');
    expect(before.clock - s.clock).toBeLessThanOrEqual(20);
    expect(s.log.at(-1)!.steps.join(' ')).toContain('(no-huddle)');
  });

  it('without it, the fast timing waits for the final minutes', () => {
    const before = patriotsBall();
    const s = run(before, 'dl3-lb4-db4-ace');
    expect(before.clock - s.clock).toBeGreaterThanOrEqual(30);
  });

  it("after a no-huddle play with the clock running, the defense can't substitute unless the offense does", () => {
    const first = run(patriotsBall({ noHuddleAnyTime: true }), 'dl3-lb4-db4-ace');
    expect(first.noHuddleLock?.offenseIds?.length).toBeGreaterThan(0);
    expect(() => run(first, 'dl4-lb3-db4-ghi')).toThrow('Rule 8.7');
    // Same defense: fine. And if the offense brings in another back, the defense may change too.
    expect(() => run(first, 'dl3-lb4-db4-ace')).not.toThrow();
    const fresh = patriots.players.find(p => p.position === 'RB' && !Object.values(offense).includes(p.id))!;
    expect(() => run(first, 'dl4-lb3-db4-ghi', placePlayer(offense, 'RB1', fresh, patriots))).not.toThrow();
  });
});
