import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, buildLineup, callToss, chooseAfterToss, createGame, enduranceContext, Fac, GameContext, GameState,
  getDefenseFormation, getFormation, kickoff, normalizeCall, OffenseCall, playOptions, RegularFac, restingPlayers,
  setDefenseReady, snapPlay, Team,
} from './index';

const cards = deckJson as Fac[];
const patriots = patriotsJson as unknown as Team;
const dolphins = dolphinsJson as unknown as Team;
const regular = cards.filter((c): c is RegularFac => !c.isZ);
const ctx: GameContext = { cards, teams: { home: patriots, away: dolphins } };

function pick(...preds: ((c: RegularFac) => boolean)[]): Fac[] {
  const used = new Set<string>();
  return preds.map(p => {
    const c = regular.find(x => !used.has(x.id) && p(x));
    if (!c) throw new Error('No card matches');
    used.add(c.id);
    return c;
  });
}
const rn = (n: number) => (c: RegularFac) => c.runNumber === n;
// Hannah blocks +4 and nothing else happens: a quiet 9-yard run.
const quiet = () => pick(c => c.runs.IL.kind === 'blockers' && c.runs.IL.players.length === 1 && c.runs.IL.players[0] === 'LG', rn(5));
function stack(state: GameState, top: Fac[]): GameState {
  const ids = top.map(c => c.id);
  return { ...state, deck: { ...state.deck, order: [...ids, ...state.deck.order.filter(id => !ids.includes(id))], next: 0 } };
}
function patriotsBall(): GameState {
  let s = createGame({ homeTeamId: 'h', awayTeamId: 'a', seed: 1 }, cards);
  for (const c of ['HEADS', 'TAILS'] as const) {
    const t = callToss(s, c, ctx);
    if (t.toss.winner === 'home') { s = t; break; }
  }
  return kickoff(stack(chooseAfterToss(s, 'RECEIVE', ctx), pick(rn(11))), ctx);
}
// Two backs: Craig James (rating 1) at RB1, Tony Collins (rating 1) at RB2.
const formation = getFormation('2rb-2wr-te-right');
const lineup = buildLineup(patriots, formation);
const defense = buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace'));
const call = (slot: 'RB1' | 'RB2'): OffenseCall => ({ formationId: formation.id, slot, play: 'IL', strategy: 'NONE', extraBlockers: [] });
const snap = (s: GameState, slot: 'RB1' | 'RB2') =>
  snapPlay(setDefenseReady(stack({ ...s, ballOn: 20, down: 1, distance: 10 }, quiet()), true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'PASS' }), call(slot), lineup, ctx);
const inSlot = (slot: string) => patriots.players.find(p => p.id === lineup[slot as 'RB1'])!;

describe('play direction (rule 4.6)', () => {
  it('a back rated 1 cannot carry twice in a row, but can after one play in between', () => {
    let s = snap(patriotsBall(), 'RB1'); // James
    expect(() => snap(s, 'RB1')).toThrow("Craig James can't be the target: he was the target on the previous play");
    s = snap(s, 'RB2'); // Collins in between
    expect(() => snap(s, 'RB1')).not.toThrow();
  });

  it('a kickoff counts as a play in between', () => {
    const s = snap(patriotsBall(), 'RB1');
    const afterKick = kickoff(stack({ ...s, phase: 'KICKOFF', kickoff: { kicking: 'away', afterSafety: false, landingShift: 0 } }, pick(rn(11))), ctx);
    expect(() => snap(afterKick, 'RB1')).not.toThrow();
  });

  it('the Select a player list shows him disabled, with the reason, and the call moves on to someone who can go', () => {
    const s = snap(patriotsBall(), 'RB1');
    const c = { ...enduranceContext(s), ballOn: 20 };
    expect(playOptions('RB1', inSlot('RB1'), c).every(o => !o.enabled)).toBe(true);
    expect(playOptions('RB1', inSlot('RB1'), c)[0].reason).toBe('He was the target on the previous play');
    const next = normalizeCall(call('RB1'), slot => inSlot(slot), c);
    expect(next.slot).toBe('RB2');
  });

  it('the Endurance table lists who is resting and until when', () => {
    const s = snap(patriotsBall(), 'RB1');
    expect(restingPlayers(s, patriots).map(r => [r.player.lastName, r.rating, r.back])).toEqual([['James', 1, 'after the next play']]);
  });

  it('"once per possession" (3) and "once per quarter" (4)', () => {
    const tweak = (rating: 3 | 4): Team => ({ ...patriots, players: patriots.players.map(p => (p.id === lineup.RB1 && p.position === 'RB' ? { ...p, playDirection: rating } : p)) });
    const s = snap(patriotsBall(), 'RB1');
    const thisDrive = { ...enduranceContext(s), ballOn: 20 };
    const p3 = tweak(3).players.find(p => p.id === lineup.RB1)!;
    expect(playOptions('RB1', p3, thisDrive).some(o => o.enabled)).toBe(false);
    expect(playOptions('RB1', p3, { ...thisDrive, possession: thisDrive.possession! + 1 }).some(o => o.enabled)).toBe(true);
    const p4 = tweak(4).players.find(p => p.id === lineup.RB1)!;
    expect(playOptions('RB1', p4, { ...thisDrive, possession: thisDrive.possession! + 1 }).some(o => o.enabled)).toBe(false);
    expect(playOptions('RB1', p4, { ...thisDrive, quarter: 2 }).some(o => o.enabled)).toBe(true);
  });
});
