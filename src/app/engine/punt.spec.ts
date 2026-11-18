import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, buildLineup, callToss, chooseAfterToss, choosePenalty, createGame, declarePunt, Fac, GameContext, GameState,
  getDefenseFormation, getFormation, kickoff, punterOf, puntPlay, RegularFac, setDefenseReady, snapPlay, Team,
} from './index';

const cards = deckJson as Fac[];
const patriots = patriotsJson as unknown as Team;
const dolphins = dolphinsJson as unknown as Team;
const ctx: GameContext = { cards, teams: { home: patriots, away: dolphins } };
const regular = cards.filter((c): c is RegularFac => !c.isZ);
const zCard = cards.find(c => c.isZ)!;
const prestridge = punterOf(patriots)!; // RN 1: 62 to PR1 ... RN 7: 40 FC ... 12: special (1: 89 yards no return, 2-12 penalty)

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
function stack(state: GameState, top: Fac[]): GameState {
  const ids = top.map(c => c.id);
  return { ...state, deck: { ...state.deck, order: [...ids, ...state.deck.order.filter(id => !ids.includes(id))], next: 0 } };
}
/** Patriots (home) ball, 4th & 10 at the given yard line. */
function fourthDown(ballOn: number): GameState {
  let s = createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1 }, cards);
  for (const c of ['HEADS', 'TAILS'] as const) {
    const t = callToss(s, c, ctx);
    if (t.toss.winner === 'home') { s = t; break; }
  }
  s = kickoff(stack(chooseAfterToss(s, 'RECEIVE', ctx), pick(rn(11))), ctx);
  return { ...s, ballOn, down: 4, distance: 10 };
}
const defense = buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace'));
const ready = (s: GameState, allOutRush = false) =>
  setDefenseReady(s, true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'PASS', allOutRush });
function punt(s: GameState, top: Fac[], opts: { coffin?: number; allOut?: boolean } = {}) {
  return puntPlay(ready(declarePunt(stack(s, top), { coffinCorner: opts.coffin ?? null }), opts.allOut), ctx);
}
const ev = (s: GameState, type: string) => (s.events ?? []).filter(e => e.type === type);

import { computeStats } from './index';

describe('punts (rule 8.5)', () => {
  it('declaring a punt makes the defense set again, and Run play is refused', () => {
    const s = declarePunt(ready(fourthDown(30)), { coffinCorner: null });
    expect(s.defenseReady).toBe(false);
    const offense = buildLineup(patriots, getFormation('pass-2wr-2te'));
    const call = { formationId: 'pass-2wr-2te' as const, slot: 'RB1' as const, play: 'IL' as const, strategy: 'NONE' as const, extraBlockers: [] };
    expect(() => snapPlay(ready(s), call, offense, ctx)).toThrow('punt has been declared');
  });

  it('a fair catch: 40 yards from the 30, Dolphins ball at their own 30, a new possession', () => {
    const before = fourthDown(30);
    const s = punt(before, pick(rn(7)));
    expect(s).toMatchObject({ phase: 'PLAY', possession: 'away', ballOn: 30, down: 1, distance: 10, puntCall: null });
    expect(s.possessionIndex).toBe((before.possessionIndex ?? 0) + 1);
    expect(ev(s, 'PUNT')).toMatchObject([{ side: 'home', playerId: prestridge.id, yards: 40, fairCatch: true }]);
  });

  it('a return: 53 yards from the 20 to PR2 ("same as PR1": Fulton Walker), RN 4 on his column is 11 yards', () => {
    const s = punt(fourthDown(20), pick(rn(2), rn(4)));
    expect(s).toMatchObject({ possession: 'away', ballOn: 27 + 11 });
    expect(ev(s, 'PUNT_RETURN')).toMatchObject([{ side: 'away', playerId: 'mia84-fulton-walker', yards: 11, touchdown: false }]);
    expect(ev(s, 'PUNT')).toMatchObject([{ yards: 53, fairCatch: false, touchback: false }]);
  });

  it('into the end zone is a touchback at the 20', () => {
    expect(punt(fourthDown(40), pick(rn(1)))).toMatchObject({ possession: 'away', ballOn: 20 });
  });

  it('a normal punt coming down inside the 6 rolls into the end zone', () => {
    // RN 5: 46 yards from midfield comes down at the opponent's 4.
    expect(punt(fourthDown(50), pick(rn(5)))).toMatchObject({ possession: 'away', ballOn: 20 });
  });

  it('coffin corner: the yards come off, an odd RN goes out of bounds with no return', () => {
    // RN 1: 62 - 20 = 42 yards from midfield, out of bounds at the Dolphins' 8.
    const s = punt(fourthDown(50), pick(rn(1)), { coffin: 20 });
    expect(s).toMatchObject({ possession: 'away', ballOn: 8 });
    expect(ev(s, 'PUNT_RETURN')).toEqual([]);
  });

  it('RN 12 on the punter card: the special result (Prestridge: 89 yards, no return)', () => {
    const s = punt(fourthDown(5), pick(rn(12), rn(1)));
    expect(s).toMatchObject({ possession: 'away', ballOn: 6 });
  });

  it('RN 12, special penalty: even RN is movement on the kickers, punt again from 5 yards back', () => {
    const s = punt(fourthDown(30), pick(rn(12), rn(5), rn(4)));
    expect(s).toMatchObject({ phase: 'PLAY', possession: 'home', ballOn: 25, down: 4, distance: 15, puntCall: { coffinCorner: null } });
  });

  it('all-out rush: RN 12 then 1-4 is a block, returned RN x 5 yards', () => {
    const s = punt(fourthDown(30), pick(rn(12), rn(2), rn(3)), { allOut: true });
    expect(s).toMatchObject({ possession: 'away', ballOn: 70 + 15 });
    expect(ev(s, 'PUNT')).toMatchObject([{ blocked: true }]);
  });

  it('all-out rush: RN 12 then 10-12 is roughing the kicker, 15 yards and a first down', () => {
    expect(punt(fourthDown(30), pick(rn(12), rn(11)), { allOut: true })).toMatchObject({ possession: 'home', ballOn: 45, down: 1, distance: 10 });
  });

  it('all-out rush: the return is held to 3 yards', () => {
    const s = punt(fourthDown(20), pick(rn(2), rn(1)), { allOut: true });
    expect(ev(s, 'PUNT_RETURN')).toMatchObject([{ yards: 3 }]);
  });

  it('roughing the kicker from a Z card lets the kicking team choose', () => {
    const roughing = (c: RegularFac) => c.z.type === 'PENALTY' && c.z.byCategory[2].against === 'R' && c.z.byCategory[2].penalty === 12;
    const [kick, result] = pick(rn(7), roughing);
    const s = punt(fourthDown(30), [zCard, kick, result]);
    expect(s.phase).toBe('PENALTY_CHOICE');
    expect(s.pendingPenalty!.chooser).toBe('home');
    expect(choosePenalty(s, true, ctx)).toMatchObject({ possession: 'home', ballOn: 45, down: 1 });
    expect(choosePenalty(s, false, ctx)).toMatchObject({ possession: 'away', ballOn: 30 });
  });

  it('a team with two punters: the chosen one punts with his own card', () => {
    const camarillo = patriots.players.find(p => p.lastName === 'Camarillo')!;
    const s = puntPlay(ready(declarePunt(stack(fourthDown(30), pick(rn(1))), { coffinCorner: null, punterId: camarillo.id })), ctx);
    // Camarillo's RN 1 is 61 yards (Prestridge's is 62): from the 30 it comes down at the Dolphins' 9.
    expect(ev(s, 'PUNT')).toMatchObject([{ playerId: camarillo.id, yards: 61 }]);
  });

  it('punting and punt returns in the stats', () => {
    const s = punt(fourthDown(20), pick(rn(2), rn(4)));
    const st = computeStats(s, { home: patriots, away: dolphins });
    expect(st.teams.home.punts).toEqual({ count: 1, yards: 53 });
    expect(st.teams.away.puntReturns).toEqual({ count: 1, yards: 11 });
    expect(st.players.home.find(p => p.playerId === prestridge.id)!.punting).toMatchObject({ count: 1, yards: 53, long: 53 });
    expect(st.players.away.find(p => p.playerId === 'mia84-fulton-walker')!.puntReturns).toMatchObject({ count: 1, yards: 11 });
  });

  it('a fair catch past midfield is said from the right side: "the kicking team\'s 45"', () => {
    // From the Patriots' 5, RN 7 is 40 yards: it comes down at the Patriots' 45.
    const s = punt(fourthDown(5), pick(rn(7)));
    const entry = s.log.at(-1)!;
    expect(entry.steps).toContain("Fair catch at the kicking team's 45.");
    expect(entry.result).toBe("Luke Prestridge punts 40 yards, fair catch. Dolphins (away) ball, 1st & 10 at opponent's 45.");
  });
});

