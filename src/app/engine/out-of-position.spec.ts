import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, buildLineup, callToss, chooseAfterToss, createGame, eligibleReplacements, Fac, GameContext, GameState,
  getDefenseFormation, getFormation, isEligible, kickoff, outOfPosition, placePlayer, RegularFac, setDefenseReady, snapPlay, Team,
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
  return kickoff(stack(chooseAfterToss(s, 'RECEIVE', ctx), pick(c => c.runNumber === 11)), ctx);
}
const lineup = buildLineup(patriots, getFormation('pass-2wr-2te'));
const hannah = patriots.players.find(p => p.lastName === 'Hannah')!; // a guard, run block +4
const holloway = patriots.players.find(p => p.lastName === 'Holloway')!; // a tackle
// Hannah moves to left tackle, Holloway to left guard: both out of position.
const swapped = placePlayer(placePlayer(lineup, 'LT', hannah, patriots), 'LG', holloway, patriots);
const defense = buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace'));
const snap = (s: GameState, top: Fac[], l = swapped, play: 'IL' | 'SH' = 'IL') => snapPlay(
  setDefenseReady(stack({ ...s, targets: [] }, top), true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'PASS' }),
  { formationId: 'pass-2wr-2te', slot: play === 'IL' ? 'RB1' : 'FLL', play, strategy: 'NONE', extraBlockers: [] }, l, ctx);
const steps = (s: GameState) => s.log.filter(e => e.steps.length).at(-1)!.steps.join(' | ');

describe('optional rule O1: playing out of position', () => {
  it('a lineman may play anywhere on the line, his own position first', () => {
    expect(isEligible(hannah, 'LT')).toBe(true);
    expect(isEligible(hannah, 'C')).toBe(true);
    expect(isEligible(patriots.players.find(p => p.position === 'TE')!, 'LT')).toBe(false);
    expect(eligibleReplacements(patriots, lineup, 'LT').every(p => ['OT', 'OG', 'C'].includes(p.position))).toBe(true);
  });

  it('says what he is and where he plays, only when out of position', () => {
    expect(outOfPosition(hannah, 'LT')).toEqual({ penalty: 1, text: 'Guard playing tackle' });
    expect(outOfPosition(hannah, 'LG')).toBeNull();
    expect(outOfPosition(hannah, 'QB')).toBeNull();
  });

  it('blocks at -1 when the run card points at him', () => {
    // Inside left at the LT: Hannah (+4) at tackle counts +3.
    const toLT = (c: RegularFac) => c.runs.IL.kind === 'blockers' && c.runs.IL.players.length === 1 && c.runs.IL.players[0] === 'LT';
    const s = snap(patriotsBall(), pick(toLT, c => c.runNumber === 5));
    expect(steps(s)).toContain('Hannah (LT) +4 -1 out of position = +3');
  });

  it('every lineman out of position takes 1 off the pass block total', () => {
    const rush = (c: RegularFac) => c.passes.SH === 'PASS_RUSH';
    const normal = snap(patriotsBall(), pick(rush, c => c.passNumber === 40), lineup, 'SH');
    const moved = snap(patriotsBall(), pick(rush, c => c.passNumber === 40), swapped, 'SH');
    const total = (s: GameState) => Number(/against pass block (-?\d+)/.exec(steps(s))![1]);
    expect(total(moved)).toBe(total(normal) - 2);
    expect(steps(moved)).toContain('2 linemen out of position: pass block -2.');
  });
});
