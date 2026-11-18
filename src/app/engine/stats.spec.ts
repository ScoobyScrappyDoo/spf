import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, buildLineup, callToss, chooseAfterToss, choosePenalty, computeStats, createGame, Fac, GameContext,
  GameState, getDefenseFormation, getFormation, kickoff, OffenseCall, RegularFac, setDefenseReady, snapPlay, Team, yardsAfterCatch,
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
const rn = (n: number) => (c: RegularFac) => c.runNumber === n;
const ilTo = (test: (d: RegularFac['runs']['IL']) => boolean) => (c: RegularFac) => test(c.runs.IL);
const ilToLG = ilTo(d => d.kind === 'blockers' && d.players.length === 1 && d.players[0] === 'LG');
const ilToC = ilTo(d => d.kind === 'boxes' && d.boxes.length === 1 && d.boxes[0] === 'C');
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
const offense = buildLineup(patriots, getFormation('pass-2wr-2te'));
const defense = buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace'));
const call: OffenseCall = { formationId: 'pass-2wr-2te', slot: 'RB1', play: 'IL', strategy: 'NONE', extraBlockers: [] };
const snap = (s: GameState, top: Fac[]) =>
  snapPlay(setDefenseReady(stack({ ...s, targets: [] }, top), true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'PASS' }), call, offense, ctx);
const eventsOf = (s: GameState, type: string) => (s.events ?? []).filter(e => e.type === type);
const lineOf = (s: GameState, side: 'home' | 'away', last: string) =>
  computeStats(s, teams).players[side].find(p => p.name.endsWith(last));

describe('play events', () => {
  it('a kickoff records the kick, and a touchback no return', () => {
    const s = patriotsBall();
    expect(eventsOf(s, 'KICKOFF')).toMatchObject([{ side: 'away', touchback: true }]);
    expect(eventsOf(s, 'KICK_RETURN')).toEqual([]);
  });

  it('a run records the snap, the carry and the tackle, and the tackle is in the play-by-play', () => {
    const s = snap(patriotsBall(), pick(ilToLG, rn(5)));
    expect(eventsOf(s, 'SNAP')).toMatchObject([{ side: 'home', down: 1, distance: 10, firstDown: false, counted: true }]);
    expect(eventsOf(s, 'RUSH')).toMatchObject([{ side: 'home', playerId: 'ne84-craig-james', yards: 9, touchdown: false }]);
    const tackles = eventsOf(s, 'TACKLE');
    expect(tackles.length).toBeGreaterThanOrEqual(1);
    expect(tackles.every(t => t.side === 'away')).toBe(true);
    expect(s.log.at(-1)!.steps.some(x => x.startsWith('Tackle: '))).toBe(true);
  });

  it('when the card names a box, the player there makes the stop', () => {
    const s = snap(patriotsBall(), pick(ilToC, rn(5)));
    const tackle = eventsOf(s, 'TACKLE')[0];
    expect(tackle.type === 'TACKLE' && tackle.playerId).toBe(defense.C![0]);
  });

  it('a touchdown run: yards to the goal line only, no tackle, the extra point recorded', () => {
    const s = snap(patriotsBall({ ballOn: 98, distance: 2 }), pick(ilToLG, rn(5)));
    expect(eventsOf(s, 'RUSH')).toMatchObject([{ yards: 2, touchdown: true }]);
    expect(eventsOf(s, 'TACKLE')).toEqual([]);
    expect(eventsOf(s, 'EXTRA_POINT')).toMatchObject([{ side: 'home', good: true }]);
  });

  it('an accepted penalty that replays the down wipes out the carry; a declined one leaves it', () => {
    const offside = (c: RegularFac) => c.z.type === 'PENALTY' && c.z.byCategory[0].against === 'D' && c.z.byCategory[0].penalty === 1;
    const [dir, number, result] = pick(ilToLG, rn(5), offside);
    const pending = snap(patriotsBall(), [zCard, dir, number, result]);
    const accepted = choosePenalty(pending, true, ctx);
    expect(eventsOf(accepted, 'RUSH')).toEqual([]);
    expect(eventsOf(accepted, 'PENALTY')).toMatchObject([{ side: 'away', yards: 5, accepted: true }]);
    const declined = choosePenalty(pending, false, ctx);
    expect(eventsOf(declined, 'RUSH')).toMatchObject([{ yards: 9 }]);
    expect(eventsOf(declined, 'PENALTY')).toMatchObject([{ accepted: false }]);
  });

  it('a lost fumble: the fumble, the recovery and a turnover', () => {
    const fumble = (c: RegularFac) => c.z.type === 'FUMBLE' && !c.z.homeTeamExempt;
    const [dir, number, result, recovery] = pick(ilToLG, rn(5), fumble, c => c.passNumber <= 24);
    const s = snap(patriotsBall(), [zCard, dir, number, result, recovery]);
    expect(eventsOf(s, 'FUMBLE')).toMatchObject([{ side: 'home', lost: true }]);
    expect(eventsOf(s, 'FUMBLE_RECOVERY')).toMatchObject([{ side: 'away' }]);
    expect(computeStats(s, teams).teams.home.turnovers).toBe(1);
  });
});

describe('stats', () => {
  /** Three Craig James carries: 9 yards (2nd & 1), 9 yards (first down), 9 yards. */
  function drive() {
    let s = snap(patriotsBall(), pick(ilToLG, rn(5)));
    s = snap(s, pick(ilToLG, rn(5)));
    return snap(s, pick(ilToLG, rn(5)));
  }

  it('rushing: attempts, yards and the longest run', () => {
    const james = lineOf(drive(), 'home', 'James')!;
    expect(james.rushing).toEqual({ att: 3, yards: 27, long: 9, td: 0, twentyPlus: 0 });
  });

  it('team stats: first downs, plays, yards, time of possession', () => {
    const s = drive();
    const t = computeStats(s, teams).teams.home;
    expect(t).toMatchObject({ plays: 3, totalYards: 27, rushing: { att: 3, yards: 27 }, firstDowns: 1, firstDownsRushing: 1 });
    expect(t.timeOfPossession).toBe(900 - s.clock);
  });

  it('third downs: attempts and conversions', () => {
    const s = snap(patriotsBall({ down: 3, distance: 5 }), pick(ilToLG, rn(5)));
    expect(computeStats(s, teams).teams.home.thirdDowns).toEqual({ made: 1, att: 1 });
  });

  it('defense: solo tackles and assists add up to one tackle per stop', () => {
    const s = drive();
    const d = computeStats(s, teams).players.away.filter(p => p.tackles);
    const solo = d.reduce((a, p) => a + p.tackles!.solo, 0);
    const assists = d.reduce((a, p) => a + p.tackles!.assists, 0);
    expect(solo + assists / 2).toBe(3); // three stops: each either one solo or two assists
  });

  it('the same game gives the same tacklers (seeded)', () => {
    const a = eventsOf(drive(), 'TACKLE');
    const b = eventsOf(drive(), 'TACKLE');
    expect(b).toEqual(a);
  });
});

describe('defensive touchdowns', () => {
  it('an interception returned for a touchdown counts the pick, the return yards and the TD', () => {
    const s = {
      ...createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1 }, cards),
      events: [
        { type: 'INTERCEPTION', side: 'home', playerId: 'ne84-ernest-gibson', returnYards: 34, touchdown: true, play: 1, quarter: 2, clock: 600, possession: 3 },
      ],
    } as unknown as Parameters<typeof computeStats>[0];
    const gibson = computeStats(s, { home: patriotsJson as unknown as Team, away: dolphinsJson as unknown as Team }).players.home.find(p => p.playerId === 'ne84-ernest-gibson')!;
    expect(gibson.tackles).toMatchObject({ interceptions: 1, intYards: 34, td: 1 });
  });
});

describe('yards after the catch', () => {
  it('follows the pass called, never past the gain, and is the same every time', () => {
    const at = (kind: 'QK' | 'SH' | 'LG' | 'SC', yards: number, play = 7) => yardsAfterCatch({ kind, yards, play, targetId: 'r' });
    for (let play = 0; play < 40; play++) {
      const q = yardsAfterCatch({ kind: 'QK', yards: 15, play, targetId: 'r' });
      expect(q).toBeGreaterThanOrEqual(5); // caught 0-10 downfield: 5-15 after the catch
      expect(q).toBeLessThanOrEqual(15);
      const l = yardsAfterCatch({ kind: 'LG', yards: 48, play, targetId: 'r' });
      expect(l).toBeLessThanOrEqual(10); // most of a long pass is in the air
      const s = yardsAfterCatch({ kind: 'SC', yards: 6, play, targetId: 'r' });
      expect(s).toBeGreaterThanOrEqual(6); // a screen is caught behind the line
    }
    expect(at('SH', 18)).toBe(at('SH', 18)); // the same play gives the same figure
    expect(at('QK', 0)).toBe(0);
  });
});
