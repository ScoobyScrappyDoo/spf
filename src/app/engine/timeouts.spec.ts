import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, buildLineup, callToss, chooseAfterToss, createGame, Fac, GameContext, GameState, getDefenseFormation,
  getFormation, kickoff, RegularFac, setDefenseReady, snapPlay, Team,
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
function run(s: GameState, opts: { offense?: boolean; defense?: boolean } = {}) {
  const ready = setDefenseReady(stack(s, pick(ilToLG, c => c.runNumber === 5)), true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'PASS', timeout: opts.defense });
  return snapPlay(ready, call, offense, ctx, { timeout: opts.offense });
}

describe('timeouts (rule 9.2)', () => {
  it('an offensive timeout stops the clock: the run takes 10 seconds instead of 30-45, and one is gone', () => {
    const before = patriotsBall();
    const s = run(before, { offense: true });
    expect(before.clock - s.clock).toBe(10);
    expect(s.timeouts).toEqual({ home: 2, away: 3 });
    expect(s.log.at(-1)!.steps).toContain('Patriots (home) takes a timeout, 2 remaining.');
  });

  it('the defense can call one too, with its "All set!"', () => {
    const s = run(patriotsBall(), { defense: true });
    expect(s.timeouts).toEqual({ home: 3, away: 2 });
  });

  it('with none left, nothing happens', () => {
    const before = patriotsBall({ timeouts: { home: 0, away: 3 } });
    const s = run(before, { offense: true });
    expect(before.clock - s.clock).toBeGreaterThanOrEqual(30);
    expect(s.timeouts.home).toBe(0);
  });

  it('three each again at halftime', () => {
    const s = run(patriotsBall({ quarter: 2, clock: 10, timeouts: { home: 1, away: 0 } }));
    expect(s.quarter).toBe(3);
    expect(s.timeouts).toEqual({ home: 3, away: 3 });
  });

  it('a timeout is only used if the clock would run: after an incomplete pass the team keeps it', () => {
    const before = patriotsBall();
    const pass = { ...call, slot: 'FLL' as const, play: 'SH' as const };
    // A short pass that falls incomplete (the pass card to the receiver, a PN past his completion range).
    const ready = setDefenseReady(stack(before, pick(c => c.passes.SH === 'ORIG', c => c.passNumber === 40, c => c.runNumber === 3)), true,
      { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'PASS', timeout: true });
    const after = snapPlay(ready, pass, offense, ctx, { timeout: true });
    const steps = after.log.at(-1)!.steps.join(' | ');
    expect(steps).toContain('incomplete');
    expect(steps).not.toContain('timeout');
    expect(after.timeouts).toEqual(before.timeouts);
  });
});

