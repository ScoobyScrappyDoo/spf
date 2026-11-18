import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import teamJson from './testdata/1984/patriots.json';
import { callToss, chooseAfterToss, choosePenalty, createGame, Fac, GameContext, GameState, kickoff, RegularFac, setDefenseReady, snapPlay, Team } from './index';

const cards = deckJson as Fac[];
const team = teamJson as unknown as Team;
const ctx: GameContext = { cards, teams: { home: team, away: team } };
const regular = cards.filter((c): c is RegularFac => !c.isZ);
const zCard = cards.find(c => c.isZ)!;

/** Picks distinct regular cards matching each test's needs. */
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
const pn = (test: (n: number) => boolean) => (c: RegularFac) => test(c.passNumber);
const penalty4 = (code: string) => (c: RegularFac) =>
  c.z.type === 'PENALTY' && c.z.byCategory[3].against + c.z.byCategory[3].penalty === code;

/** Puts these cards on top of the deck, in this order. */
function stack(state: GameState, top: Fac[]): GameState {
  const ids = top.map(c => c.id);
  const rest = state.deck.order.filter(id => !ids.includes(id));
  return { ...state, deck: { ...state.deck, order: [...ids, ...rest], next: 0 } };
}

/** A game where the home team won the toss and receives, so away kicks off. */
function readyToKick(): GameState {
  let s = createGame({ homeTeamId: team.id, awayTeamId: team.id, seed: 1 }, cards);
  for (const call of ['HEADS', 'TAILS'] as const) {
    const t = callToss(s, call, ctx);
    if (t.toss.winner === 'home') { s = t; break; }
  }
  return chooseAfterToss(s, 'RECEIVE', ctx);
}

describe('coin toss', () => {
  it('lets the away team call, and the winner chooses', () => {
    const s = createGame({ homeTeamId: 'a', awayTeamId: 'b', seed: 5 }, cards);
    expect(s.toss.caller).toBe('away');
    const tossed = callToss(s, 'HEADS', ctx);
    expect(tossed.toss.winner).toBe(tossed.toss.result === 'HEADS' ? 'away' : 'home');
    const kick = chooseAfterToss(tossed, 'KICK', ctx);
    expect(kick.kickoff!.kicking).toBe(tossed.toss.winner);
    expect(kick.receivingFirstHalf).not.toBe(tossed.toss.winner);
    expect(kick.phase).toBe('KICKOFF');
  });

  it('refuses moves out of turn', () => {
    const s = createGame({ homeTeamId: 'a', awayTeamId: 'b', seed: 5 }, cards);
    expect(() => kickoff(s, ctx)).toThrow();
  });
});

describe('kickoff', () => {
  it('touchback: RN 11 on column A puts the ball at the 20 and uses no time', () => {
    const s = kickoff(stack(readyToKick(), pick(rn(11))), ctx);
    expect(s).toMatchObject({ phase: 'PLAY', possession: 'home', ballOn: 20, down: 1, distance: 10, clock: 900, openingKickoffDone: true });
  });

  it('return: KR1 fields it at the goal line and runs 46 yards on RN 1', () => {
    const s = kickoff(stack(readyToKick(), pick(rn(2), rn(1))), ctx);
    expect(s).toMatchObject({ possession: 'home', ballOn: 46, clock: 890 });
    expect(s.log.at(-1)!.steps.join(' ')).toContain('Tony Collins');
  });

  it('column B, then a fumble on the return that the kicking team recovers', () => {
    // A: RN 1 -> column B; B: RN 6 -> KR1 at the 15; RN 12 -> 6f; fumble card PN within 1-24.
    const s = kickoff(stack(readyToKick(), pick(rn(1), rn(6), rn(12), pn(n => n <= 24))), ctx);
    expect(s).toMatchObject({ possession: 'away', ballOn: 100 - 21 });
  });

  it('a Z card among the first three flips brings clipping, enforced from the spot of the foul', () => {
    const [kick, ret, zResult] = pick(rn(2), rn(1), penalty4('R11'));
    const [odd] = pick(c => c.runNumber % 2 === 1 && ![kick, ret, zResult].includes(c));
    const s = kickoff(stack(readyToKick(), [zCard, kick, ret, zResult, odd]), ctx);
    // Return from the goal line to the 46; halfway is the 23; 15 yards back would pass half the distance, so the 12.
    expect(s).toMatchObject({ possession: 'home', ballOn: 12 });
  });

  it('kickoff out of bounds lets the receiving coach choose', () => {
    const [kick, ret, zResult] = pick(rn(2), rn(1), penalty4('K15'));
    const s = kickoff(stack(readyToKick(), [zCard, kick, ret, zResult]), ctx);
    expect(s.phase).toBe('PENALTY_CHOICE');
    expect(s.pendingPenalty!.chooser).toBe('home');
    expect(choosePenalty(s, true, ctx)).toMatchObject({ phase: 'PLAY', possession: 'home', ballOn: 35 });
    const rekick = choosePenalty(s, false, ctx);
    expect(rekick).toMatchObject({ phase: 'KICKOFF', kickoff: { kicking: 'away', landingShift: 5 } });
    // The re-kick lands 5 yards shorter: KR1 at the goal line becomes the 5, plus 46 yards.
    expect(kickoff(stack(rekick, pick(rn(2), rn(1))), ctx).ballOn).toBe(51);
  });

  it('a Z card turned up fourth or later is ignored and replaced by the next card', () => {
    // RN 1 -> column B, RN 6 -> KR1 at the 15, RN 12 -> 6f. The fourth flip (fumble recovery) is a Z card.
    const [a, b, c, recovery] = pick(rn(1), rn(6), rn(12), pn(n => n <= 24));
    const s = kickoff(stack(readyToKick(), [a, b, c, zCard, recovery]), ctx);
    expect(s).toMatchObject({ phase: 'PLAY', possession: 'away', ballOn: 79 });
    expect(s.log.at(-1)!.steps.join(' ')).not.toContain('Z card');
  });

  it('onside kick: PN 1-11 means the kicking team recovers at midfield', () => {
    const s = kickoff(stack(readyToKick(), pick(pn(n => n <= 11))), ctx, { onside: true });
    expect(s).toMatchObject({ possession: 'away', ballOn: 50 });
  });

  it('a return touchdown scores, kicks the extra point and the scoring team kicks off', () => {
    const fast: Team = structuredClone(team);
    fast.kickReturn!.table[0]['KR1'] = { yards: 100, fumble: false, breakaway: false };
    const fastCtx: GameContext = { cards, teams: { home: fast, away: fast } };
    const s = kickoff(stack(readyToKick(), pick(rn(2), rn(1))), fastCtx);
    expect(s.score.home).toBe(7); // Tony Franklin: extra point good on 1-48
    expect(s).toMatchObject({ phase: 'KICKOFF', kickoff: { kicking: 'home' } });
  });

  it('is fully reproducible from the seed', () => {
    const a = kickoff(readyToKick(), ctx);
    const b = kickoff(readyToKick(), ctx);
    expect(b).toEqual(a);
  });
});

describe('the snap', () => {
  function inPlay(): GameState {
    return kickoff(stack(readyToKick(), pick(rn(11))), ctx); // touchback: home ball at the 20
  }
  const call = { formationId: 'pass-2wr-2te' as const, slot: 'RB1' as const, play: 'IL' as const, strategy: 'DRAW' as const, extraBlockers: [] };
  const lineup = { RB1: 'ne84-craig-james' };
  const setup = { formationId: 'dl3-lb4-db4-ace' as const, lineup: {}, call: 'RUN_NO_KEY' as const };

  it('needs the defense to be all set first', () => {
    expect(() => snapPlay(inPlay(), call, lineup, ctx)).toThrow('defense is not set');
  });

  it('reveals both calls in the play-by-play and resets the defense for the next play', () => {
    const s = snapPlay(setDefenseReady(inPlay(), true, setup), call, lineup, ctx);
    const steps = s.log.find(e => e.title.includes('inside left'))!.steps;
    expect(steps[0]).toBe('Offense: inside left to Craig James (RB1), draw play.');
    expect(steps[1]).toBe('Defense: run defense, no key, 3-4 (A C E).');
    expect(s.defenseReady).toBe(false);
    expect(s.defenseSetup).toBeNull();
  });

  it('lets the defense take back its "All set"', () => {
    expect(setDefenseReady(setDefenseReady(inPlay(), true, setup), false).defenseReady).toBe(false);
  });
});
