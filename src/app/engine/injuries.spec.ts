import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  activeInjuries, buildDefenseLineup, buildLineup, callToss, chooseAfterToss, createGame, Fac, GameContext, GameState,
  getDefenseFormation, getFormation, injuryFromPN, kickoff, Lineup, OffenseCall, placePlayer, RegularFac, setDefenseReady,
  snapPlay, suggestOffense, Team,
} from './index';

const cards = deckJson as Fac[];
const patriots = patriotsJson as unknown as Team;
const dolphins = dolphinsJson as unknown as Team;
const regular = cards.filter((c): c is RegularFac => !c.isZ);
const zCard = cards.find(c => c.isZ)!;

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
const ilToLG = (c: RegularFac) => c.runs.IL.kind === 'blockers' && c.runs.IL.players.length === 1 && c.runs.IL.players[0] === 'LG';
const hurts = (target: string) => (c: RegularFac) => c.z.type === 'INJURY' && c.z.target === target;
const pn = (lo: number, hi: number) => (c: RegularFac) => c.passNumber >= lo && c.passNumber <= hi;
function stack(state: GameState, top: Fac[]): GameState {
  const ids = top.map(c => c.id);
  return { ...state, deck: { ...state.deck, order: [...ids, ...state.deck.order.filter(id => !ids.includes(id))], next: 0 } };
}

function setup(ctx: GameContext): GameState {
  let s = createGame({ homeTeamId: 'h', awayTeamId: 'a', seed: 1 }, cards);
  for (const call of ['HEADS', 'TAILS'] as const) {
    const t = callToss(s, call, ctx);
    if (t.toss.winner === 'home') { s = t; break; }
  }
  return kickoff(stack(chooseAfterToss(s, 'RECEIVE', ctx), pick(rn(11))), ctx);
}
const call: OffenseCall = { formationId: 'pass-2wr-2te', slot: 'RB1', play: 'IL', strategy: 'NONE', extraBlockers: [] };
const ctx: GameContext = { cards, teams: { home: patriots, away: dolphins } };
const offense = buildLineup(patriots, getFormation('pass-2wr-2te'));
const defense = buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace'));
const snap = (s: GameState, top: Fac[], lineup: Lineup = offense, c = ctx) =>
  snapPlay(setDefenseReady(stack(s, top), true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'PASS' }), call, lineup, c);
/** A plain play with no Z card, just to move the injury clock on. */
// (A fresh target record each time, so the same back may carry again: these tests are about injuries.)
const quietPlay = (s: GameState, lineup: Lineup) => snap({ ...s, ballOn: 20, down: 1, distance: 10, targets: [] }, pick(ilToLG, rn(5)), lineup);

describe('injuries', () => {
  it('the injury table, capped at the rest of the game', () => {
    expect(injuryFromPN(5, 1)).toEqual({ kind: 'PLAYS', remaining: 2 });
    expect(injuryFromPN(18, 1)).toEqual({ kind: 'PLAYS', remaining: 4 });
    expect(injuryFromPN(33, 2)).toEqual({ kind: 'QUARTER', quarter: 2 });
    expect(injuryFromPN(48, 1)).toEqual({ kind: 'GAME' });
  });

  it('a Z card hurts the ball carrier, and the offense cannot snap until he is replaced', () => {
    const [dir, number, result, length] = pick(ilToLG, rn(5), hurts('BC'), pn(11, 20));
    const s = snap(setup(ctx), [zCard, dir, number, result, length]);
    expect(activeInjuries(s)).toMatchObject([{ side: 'home', name: 'Craig James', where: 'RB1', length: { kind: 'PLAYS', remaining: 4 } }]);
    expect(() => snap(s, pick(ilToLG, rn(5)))).toThrow('injured player');
    const sub = suggestOffense(s, 'home', patriots, offense, 'RB1')!;
    expect(sub.position).toBe('RB');
    const lineup = placePlayer(offense, 'RB1', sub, patriots);
    expect(() => snap(s, pick(ilToLG, rn(5)), lineup)).not.toThrow();
  });

  it('he is back after four more plays, on the bench, ready to be put back in', () => {
    const [dir, number, result, length] = pick(ilToLG, rn(5), hurts('BC'), pn(11, 20));
    let s = snap(setup(ctx), [zCard, dir, number, result, length]);
    const lineup = placePlayer(offense, 'RB1', suggestOffense(s, 'home', patriots, offense, 'RB1')!, patriots);
    for (let i = 0; i < 3; i++) s = quietPlay(s, lineup);
    expect(activeInjuries(s).length).toBe(1);
    s = quietPlay(s, lineup);
    expect(activeInjuries(s)).toEqual([]);
    expect(s.log.at(-1)!.steps).toContain('Craig James is back from injury and can play again.');
  });

  it('a defender can be hurt too, and then the defense cannot say All set with him on the display', () => {
    const [dir, number, result, length] = pick(ilToLG, rn(5), hurts('C'), pn(1, 10));
    const s = snap(setup(ctx), [zCard, dir, number, result, length]);
    expect(activeInjuries(s)).toMatchObject([{ side: 'away', where: 'box C', name: 'Bob Baumhower' }]);
    expect(() => setDefenseReady(s, true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'PASS' })).toThrow('injured player');
  });

  it('is ignored when nobody on the bench could replace him (rule 4.5.1 for the last quarterback)', () => {
    const lonely: Team = { ...patriots, players: patriots.players.filter(p => p.position !== 'RB' || p.lastName === 'James') };
    const c: GameContext = { cards, teams: { home: lonely, away: dolphins } };
    const [dir, number, result, length] = pick(ilToLG, rn(5), hurts('BC'), pn(11, 20));
    const s = snap(setup(c), [zCard, dir, number, result, length], offense, c);
    expect(activeInjuries(s)).toEqual([]);
    expect(s.log.at(-1)!.steps.join(' ')).toContain("doesn't count: nobody on the bench can replace him");
  });

  it('is ignored for the replacement while the starter he replaced is still out (injury table note)', () => {
    const [d1, n1, r1, l1] = pick(ilToLG, rn(5), hurts('BC'), pn(36, 48)); // James out for the game
    let s = snap(setup(ctx), [zCard, d1, n1, r1, l1]);
    const lineup = placePlayer(offense, 'RB1', suggestOffense(s, 'home', patriots, offense, 'RB1')!, patriots);
    const [d2, n2, r2, l2] = pick(ilToLG, rn(5), hurts('BC'), pn(11, 20));
    s = snap({ ...s, ballOn: 20, down: 1, distance: 10 }, [zCard, d2, n2, r2, l2], lineup);
    expect(activeInjuries(s).map(i => i.name)).toEqual(['Craig James']);
    expect(s.log.at(-1)!.steps.join(' ')).toContain('already lost a starter to injury');
  });

  it('"rest of the quarter" ends with the quarter', () => {
    const [dir, number, result, length] = pick(ilToLG, rn(5), hurts('BC'), pn(31, 35));
    let s = snap(setup(ctx), [zCard, dir, number, result, length]);
    const lineup = placePlayer(offense, 'RB1', suggestOffense(s, 'home', patriots, offense, 'RB1')!, patriots);
    s = quietPlay({ ...s, clock: 10 }, lineup);
    expect(s.quarter).toBe(2);
    expect(activeInjuries(s)).toEqual([]);
  });
});
