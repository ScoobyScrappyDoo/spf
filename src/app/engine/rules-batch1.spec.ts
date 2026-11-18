import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  answerDelayOfGame, askDelayOfGame, bestQuarterback, buildDefenseLineup, buildLineup, callToss, chooseAfterToss, createGame,
  declarePunt, Fac, GameContext, GameState, getDefenseFormation, getFormation, kickoff, OVERTIME, placePlayer, qbEnduranceReason,
  RegularFac, runClock, setDefenseReady, snapPlay, Team,
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
function patriotsBall(over: Partial<GameState> = {}): GameState {
  let s = createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1 }, cards);
  for (const c of ['HEADS', 'TAILS'] as const) { const t = callToss(s, c, ctx); if (t.toss.winner === 'home') { s = t; break; } }
  return { ...kickoff(stack(chooseAfterToss(s, 'RECEIVE', ctx), pick(c => c.runNumber === 11)), ctx), targets: [], ...over };
}
const ilToLG = (c: RegularFac) => c.runs.IL.kind === 'blockers' && c.runs.IL.players.length === 1 && c.runs.IL.players[0] === 'LG';
const offense = buildLineup(patriots, getFormation('pass-2wr-2te'));
const defense = buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace'));
const call = { formationId: 'pass-2wr-2te' as const, slot: 'RB1' as const, play: 'IL' as const, strategy: 'NONE' as const, extraBlockers: [] };
const ready = (s: GameState) => setDefenseReady(s, true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'PASS' });
const eason = patriots.players.find(p => p.lastName === 'Eason')!;
const grogan = patriots.players.find(p => p.lastName === 'Grogan')!;

describe('overtime (rule 9.8.1)', () => {
  it('a tie after four quarters goes to overtime: a new toss, two timeouts each', () => {
    const s = runClock(patriotsBall({ quarter: 4, clock: 5, score: { home: 10, away: 10 } }), 5, ctx);
    expect(s).toMatchObject({ quarter: OVERTIME, clock: 900, phase: 'COIN_TOSS', timeouts: { home: 2, away: 2 } });
  });

  it('the first score wins: a touchdown ends the game at once, without an extra point', () => {
    const s = snapPlay(ready(stack(patriotsBall({ quarter: OVERTIME, ballOn: 98, distance: 2, score: { home: 10, away: 10 } }), pick(ilToLG, c => c.runNumber === 5))), call, offense, ctx);
    expect(s.phase).toBe('GAME_OVER');
    expect(s.score).toEqual({ home: 16, away: 10 });
    expect(s.log.at(-1)!.result).toContain('win 16-10 in overtime');
  });

  it('a scoreless overtime ends in a tie', () => {
    const s = runClock(patriotsBall({ quarter: OVERTIME, clock: 5, score: { home: 10, away: 10 } }), 5, ctx);
    expect(s.phase).toBe('GAME_OVER');
    expect(s.log.at(-1)!.result).toBe('Tied 10-10 after overtime.');
  });
});

describe('quarterback endurance (rule 4.5)', () => {
  it('Eason (A) always plays; Grogan (B) only while Eason is hurt', () => {
    const s = patriotsBall();
    expect(eason.position === 'QB' && eason.endurance).toBe('A');
    expect(qbEnduranceReason(s, 'home', patriots, eason)).toBeNull();
    expect(qbEnduranceReason(s, 'home', patriots, grogan)).toContain('rule 4.5.2');
    const hurt: GameState = { ...s, injuries: [{ playerId: eason.id, side: 'home', name: 'Tony Eason', position: 'QB', where: 'QB', length: { kind: 'PLAYS', plays: 4 }, at: { quarter: 1, clock: 800, play: 1 } }] } as unknown as GameState;
    expect(qbEnduranceReason(hurt, 'home', patriots, grogan)).toBeNull();
    expect(bestQuarterback(hurt, 'home', patriots)!.lastName).toBe('Grogan');
  });

  it('anyone may play with a lead of more than 20 in the 4th quarter', () => {
    expect(qbEnduranceReason(patriotsBall({ quarter: 4, score: { home: 31, away: 10 } }), 'home', patriots, grogan)).toBeNull();
    expect(qbEnduranceReason(patriotsBall({ quarter: 4, score: { home: 30, away: 10 } }), 'home', patriots, grogan)).not.toBeNull();
  });

  it('the engine refuses a snap with a quarterback who may not play', () => {
    const withGrogan = placePlayer(offense, 'QB', grogan, patriots);
    expect(() => snapPlay(ready(patriotsBall()), call, withGrogan, ctx)).toThrow('rule 4.5.2');
  });
});

describe('delay of game before a punt (rule 8.5.3)', () => {
  const fourth = () => declarePunt(patriotsBall({ down: 4, distance: 6, ballOn: 40 }), { coffinCorner: null });

  it('accepted: 5 yards back, and the clock runs off to the maximum play time', () => {
    const s = fourth();
    const asked = askDelayOfGame(s, ctx);
    expect(asked.delayOfGame).toBe('ASKED');
    const after = answerDelayOfGame(asked, true, ctx);
    expect(after).toMatchObject({ ballOn: 35, distance: 11, delayOfGame: 'USED' });
    expect(after.clock).toBeLessThanOrEqual(s.clock);
    expect(after.events!.at(-1)).toMatchObject({ type: 'PENALTY', name: 'Delay of game', yards: 5, accepted: true });
  });

  it('declined: nothing changes; and only once per punt', () => {
    const s = fourth();
    const after = answerDelayOfGame(askDelayOfGame(s, ctx), false, ctx);
    expect(after).toMatchObject({ ballOn: 40, distance: 6, clock: s.clock, delayOfGame: 'USED' });
    expect(() => askDelayOfGame(after, ctx)).toThrow('Once per punt');
  });

  it('only with a punt declared', () => {
    expect(() => askDelayOfGame(patriotsBall(), ctx)).toThrow('Only before a punt');
  });
});
