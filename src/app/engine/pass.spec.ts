import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, buildLineup, callToss, chooseAfterToss, choosePenalty, computeStats, createGame, DefenseCall, DefenseLineup,
  Fac, GameContext, GameState, getDefenseFormation, getFormation, INTERCEPTION_BOX, kickoff, OffenseCall, PlayerCard, RegularFac,
  setDefenseReady, SkillPlayer, snapPlay, Team,
} from './index';

const cards = deckJson as Fac[];
const patriots = patriotsJson as unknown as Team;
const dolphins = dolphinsJson as unknown as Team;
const ctx: GameContext = { cards, teams: { home: patriots, away: dolphins } };
const teams = { home: patriots, away: dolphins };
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
const pn = (n: number) => (c: RegularFac) => c.passNumber === n;
const rn = (n: number) => (c: RegularFac) => c.runNumber === n;
const noOB = (test: (c: RegularFac) => boolean) => (c: RegularFac) => test(c) && !c.outOfBounds;
const pass = (type: 'QK' | 'SH' | 'LG', to: string) => (c: RegularFac) => c.passes[type] === to;
const screen = (result: string, multiplier?: number) => (c: RegularFac) =>
  c.screen.result === result && (multiplier === undefined || (c.screen.result === 'COM' && c.screen.multiplier === multiplier));
function stack(state: GameState, top: Fac[]): GameState {
  const ids = top.map(c => c.id);
  return { ...state, deck: { ...state.deck, order: [...ids, ...state.deck.order.filter(id => !ids.includes(id))], next: 0 } };
}
function patriotsBall(over: Partial<GameState> = {}): GameState {
  let s = createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1 }, cards);
  for (const c of ['HEADS', 'TAILS'] as const) {
    const t = callToss(s, c, ctx);
    if (t.toss.winner === 'home') { s = t; break; }
  }
  s = kickoff(stack(chooseAfterToss(s, 'RECEIVE', ctx), pick(rn(11))), ctx);
  return { ...s, ...over };
}

const formation = getFormation('pass-2wr-2te');
const offense = buildLineup(patriots, formation);
const defense = buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace'));
const player = (id: string | undefined) => patriots.players.find(p => p.id === id)! as SkillPlayer;
const dolphin = (id: string) => dolphins.players.find(p => p.id === id)!;
const morgan = player(offense.FLL);
const james = player(offense.RB1);
const call = (over: Partial<OffenseCall> = {}): OffenseCall => ({ formationId: formation.id, slot: 'FLL', play: 'QK', strategy: 'NONE', extraBlockers: [], ...over });
function snap(s: GameState, top: Fac[], c = call(), defenseCall: DefenseCall = 'PASS', lineup: DefenseLineup = defense) {
  return snapPlay(setDefenseReady(stack({ ...s, targets: [] }, top), true, { formationId: 'dl3-lb4-db4-ace', lineup, call: defenseCall }), c, offense, ctx);
}
const ev = (s: GameState, type: string) => (s.events ?? []).filter(e => e.type === type);
const steps = (s: GameState) => s.log.filter(e => e.steps.length).at(-1)!.steps.join(' | ');
const qGain = (p: SkillPlayer, r: number) => p.passGain![r - 1].q as number;
/** A run number whose quick gain on this receiver's card is a plain number. */
const numericQ = (p: SkillPlayer) => [...Array(12).keys()].map(i => i + 1).find(r => typeof p.passGain![r - 1].q === 'number' && (p.passGain![r - 1].q as number) > 0)!;

describe('passing plays (rule 8.3)', () => {
  it('a quick pass to the receiver called, complete: yards from his Q column', () => {
    const r = numericQ(morgan);
    const s = snap(patriotsBall(), pick(pass('QK', 'ORIG'), pn(1), noOB(rn(r))));
    expect(s.ballOn).toBe(20 + qGain(morgan, r));
    expect(ev(s, 'PASS')).toMatchObject([{ side: 'home', targetId: morgan.id, complete: true, yards: qGain(morgan, r) }]);
    expect(steps(s)).toContain('Pass card: to the receiver called (FLL)');
  });

  it('incomplete: down goes up, the ball stays, and the clock stops sooner', () => {
    const before = patriotsBall();
    const s = snap(before, pick(pass('QK', 'ORIG'), pn(40)));
    expect(s).toMatchObject({ ballOn: 20, down: 2, distance: 10 });
    expect(ev(s, 'PASS')).toMatchObject([{ complete: false }]);
    expect([10, 15, 20]).toContain(before.clock - s.clock);
  });

  it('the pass card can redirect the pass: BK1 goes to the first back', () => {
    const r = numericQ(james);
    const s = snap(patriotsBall(), pick(pass('QK', 'BK1'), pn(1), noOB(rn(r))));
    expect(ev(s, 'PASS')).toMatchObject([{ targetId: james.id, complete: true }]);
    expect(s.targets!.at(-1)!.playerId).toBe(james.id); // play direction counts the player it really went to
  });

  it('an empty covering box adds 5 to the completion range', () => {
    const { O: _o, ...noSafety } = defense;
    const s = snap(patriotsBall(), pick(pass('QK', 'ORIG'), pn(1), noOB(rn(numericQ(morgan)))), call(), 'PASS', noSafety);
    expect(steps(s)).toContain('box O empty +5');
  });

  it('pass rush: a sack loses the next PN divided by 3', () => {
    const s = snap(patriotsBall({ ballOn: 30 }), pick(pass('SH', 'PASS_RUSH'), pn(1), pn(30)), call({ play: 'SH' }));
    expect(s.ballOn).toBe(20);
    expect(ev(s, 'SACK')).toMatchObject([{ side: 'home', yards: 10 }]);
  });

  it('a blitz against a short pass is an automatic pass rush', () => {
    const s = snap(patriotsBall({ ballOn: 30 }), pick(pn(1), pn(15)), call({ play: 'SH' }), 'BLITZ');
    expect(steps(s)).toContain('automatic pass rush');
    expect(ev(s, 'SACK')).toMatchObject([{ yards: 5 }]);
  });

  it("intercepted from the QB's range: the table names the box, then the spot and the return", () => {
    const box = 'K';
    const r = INTERCEPTION_BOX.LG.indexOf(box) + 1;
    const s = snap(patriotsBall(), pick(pass('LG', 'ORIG'), pn(47), rn(r), rn(3), rn(12)), call({ play: 'LG' }));
    // Long pass: picked off RN 3 x 4 = 12 yards downfield, at the Dolphins' 68; a defensive back's RN 12 return is 0.
    expect(s).toMatchObject({ possession: 'away', ballOn: 68 });
    expect(ev(s, 'INTERCEPTION')).toMatchObject([{ side: 'away', playerId: defense[box]![0], returnYards: 0 }]);
    expect(computeStats(s, teams).teams.home.turnovers).toBe(1);
  });

  it('an incomplete pass can be picked off in coverage by the defender guarding the receiver', () => {
    const guard = dolphin(defense.O![0]) as PlayerCard & { intercept: { from: number; to: number } | null };
    expect(guard.intercept).not.toBeNull();
    const s = snap(patriotsBall(), pick(pass('QK', 'ORIG'), pn(guard.intercept!.from), rn(4), rn(12)));
    expect(ev(s, 'INTERCEPTION')).toMatchObject([{ playerId: guard.id }]);
    expect(s.possession).toBe('away');
  });

  it('a screen pass: the FAC says complete x2, then the back runs it off his N column', () => {
    const n5 = james.rushing![4].n as number;
    const s = snap(patriotsBall(), pick(screen('COM', 2), noOB(rn(5))), call({ slot: 'RB1', play: 'SC' }));
    expect(s.ballOn).toBe(20 + Math.ceil(n5 * 2));
    expect(ev(s, 'PASS')).toMatchObject([{ targetId: james.id, complete: true }]);
  });

  it('a screen pass the FAC says is incomplete', () => {
    const s = snap(patriotsBall(), pick(screen('INC')), call({ slot: 'RB1', play: 'SC' }));
    expect(s).toMatchObject({ ballOn: 20, down: 2 });
  });

  it('pass interference on the defense: called on the covering defender, a first down at the spot of the foul', () => {
    const dpi = (c: RegularFac) => c.z.type === 'PENALTY' && c.z.byCategory[1].against === 'D' && c.z.byCategory[1].penalty === 8;
    // PN 40: incomplete, and outside the covering defender's interception range.
    const [card, number, result, spot] = pick(pass('SH', 'ORIG'), pn(40), dpi, rn(5));
    const s = snap(patriotsBall(), [zCard, card, number, result, spot], call({ play: 'SH' }));
    expect(s.phase).toBe('PENALTY_CHOICE');
    expect(steps(s)).toContain(dolphin(defense.O![0]).lastName);
    // Short pass: RN 5 x 2 = 10 yards downfield.
    expect(choosePenalty(s, true, ctx)).toMatchObject({ ballOn: 30, down: 1, distance: 10 });
  });

  it('passing and receiving stats, sacks and net passing yards', () => {
    const r = numericQ(morgan);
    let s = snap(patriotsBall(), pick(pass('QK', 'ORIG'), pn(1), noOB(rn(r))));
    s = snap({ ...s, ballOn: 30, down: 1, distance: 10 }, pick(pass('SH', 'PASS_RUSH'), pn(1), pn(30)), call({ play: 'SH' }));
    const st = computeStats(s, teams);
    const eason = st.players.home.find(p => p.position === 'QB')!;
    expect(eason.passing).toMatchObject({ comp: 1, att: 1, yards: qGain(morgan, r), sacks: 1, sackYards: 10 });
    expect(st.players.home.find(p => p.playerId === morgan.id)!.receiving).toMatchObject({ rec: 1, yards: qGain(morgan, r), targets: 1 });
    expect(st.teams.home.passing).toMatchObject({ comp: 1, att: 1, net: qGain(morgan, r) - 10 });
  });

  it('with two flankers, a pass redirected to a back who is not there goes to FL#2 (rule 8.3.9.3)', () => {
    // pass-2wr-2te has one back (RB1) and two flankers: BK2 goes to the right flanker.
    const r = numericQ(player(offense.FLR));
    const s = snap(patriotsBall(), pick(pass('QK', 'BK2'), pn(1), noOB(rn(r))));
    expect(ev(s, 'PASS')).toMatchObject([{ targetId: offense.FLR, complete: true }]);
    expect(steps(s)).toContain("There's no second back, so with two flankers it goes to FL#2");
  });
});

