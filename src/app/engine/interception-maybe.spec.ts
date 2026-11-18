import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, buildLineup, callToss, chooseAfterToss, createGame, Fac, GameContext, GameState, getDefenseFormation,
  getFormation, kickoff, RegularFac, replaceDefender, setDefenseReady, snapPlay, Team,
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
function patriotsBall(): GameState {
  let s = createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1 }, cards);
  for (const c of ['HEADS', 'TAILS'] as const) { const t = callToss(s, c, ctx); if (t.toss.winner === 'home') { s = t; break; } }
  return { ...kickoff(stack(chooseAfterToss(s, 'RECEIVE', ctx), pick(c => c.runNumber === 11)), ctx), targets: [] };
}
const offense = buildLineup(patriots, getFormation('pass-2wr-2te'));
// Box O guards FL#1, Stanley Morgan: put a "48?" back there (William Judson, 4 interceptions, is 46-48).
const maybe = dolphins.players.find(p => p.position === 'DB' && p.interceptMaybe)!;
const lineup = replaceDefender(buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace')), 'O', 0, maybe);
const guard = maybe;
const quickToMorgan = (s: GameState, third: (c: RegularFac) => boolean) => snapPlay(
  setDefenseReady(stack(s, pick(c => c.passes.QK === 'ORIG', c => c.passNumber === 48, third)), true, { formationId: 'dl3-lb4-db4-ace', lineup, call: 'PASS' }),
  { formationId: 'pass-2wr-2te', slot: 'FLL', play: 'QK', strategy: 'NONE', extraBlockers: [] }, offense, ctx);
const steps = (s: GameState) => s.log.filter(e => e.steps.length).at(-1)!.steps.join(' | ');

describe('"48?" interception ratings (rule 8.3.5.2)', () => {
  it('the 1984 cards follow the worksheet table: 0-1 interceptions "48?", 4 is 46-48', () => {
    expect(guard.position === 'DB' && guard.intercept).toEqual({ from: 48, to: 48 });
    const judson = dolphins.players.find(p => p.lastName === 'Judson')!;
    expect(judson.position === 'DB' && [judson.intercept, judson.interceptMaybe]).toEqual([{ from: 46, to: 48 }, undefined]);
  });

  it('PN 48 against a "48?" defender: an even PN on a new card is the interception', () => {
    const s = quickToMorgan(patriotsBall(), c => c.passNumber % 2 === 0);
    expect(steps(s)).toContain(`"48?" range: a new card`);
    expect(steps(s)).toContain('even: he picks it off');
    expect(s.possession).toBe('away');
  });

  it('an odd PN: he just misses it, incomplete', () => {
    const s = quickToMorgan(patriotsBall(), c => c.passNumber % 2 === 1);
    expect(steps(s)).toContain('odd: he just misses it');
    expect(s.possession).toBe('home');
  });
});
