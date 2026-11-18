import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, callToss, chooseAfterToss, createGame, declarePunt, Fac, GameContext, GameState, getDefenseFormation, kickoff,
  mayAct, setDefenseReady, showDefense, showOffense, Team, viewFor,
} from './index';

const cards = deckJson as Fac[];
const patriots = patriotsJson as unknown as Team;
const dolphins = dolphinsJson as unknown as Team;
const ctx: GameContext = { cards, teams: { home: patriots, away: dolphins } };
function patriotsBall(): GameState {
  let s = createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1 }, cards);
  for (const c of ['HEADS', 'TAILS'] as const) { const t = callToss(s, c, ctx); if (t.toss.winner === 'home') { s = t; break; } }
  return kickoff(chooseAfterToss(s, 'RECEIVE', ctx), ctx);
}
const defense = buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace'));

describe('two coaches: who decides, and who sees what', () => {
  it('each decision belongs to one coach; the master may do anything', () => {
    const s = patriotsBall(); // New England (home) has the ball
    const snap = { t: 'snap' as const, call: { formationId: 'pass-2wr-2te' as const, slot: 'RB1' as const, play: 'IL' as const, strategy: 'NONE' as const, extraBlockers: [] }, lineup: {}, twoMinute: false, timeout: false };
    expect(mayAct(s, 'home', snap)).toBeNull();
    expect(mayAct(s, 'away', snap)).toBe("That's the other coach's decision");
    expect(mayAct(s, 'away', { t: 'ready', ready: true })).toBeNull();
    expect(mayAct(s, 'home', { t: 'ready', ready: true })).toBe("That's the other coach's decision");
    expect(mayAct(s, 'master', snap)).toBeNull();
    expect(mayAct(s, 'home', { t: 'sim' })).toContain('master');
  });

  it("neither coach sees the deck, the seed or the journal; the offense doesn't see the defense's call", () => {
    const s = setDefenseReady(patriotsBall(), true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'BLITZ', blitzers: [defense.F![0]], bigPlay: true, timeout: true });
    const offense = viewFor(s, 'home');
    expect(offense.deck.order).toEqual([]);
    expect(offense.seed).toBeUndefined();
    expect(offense.journal).toBeUndefined();
    expect(offense.defenseSetup).toEqual({ formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'RUN_NO_KEY' }); // formation and players only
    const defenseView = viewFor(s, 'away');
    expect(defenseView.defenseSetup?.call).toBe('BLITZ'); // his own call
    expect(defenseView.deck.order).toEqual([]);
    expect(viewFor(s, 'master').deck.order.length).toBeGreaterThan(0);
  });

  it("the defense sees a punt coming, but not that it's a fake", () => {
    const s = declarePunt({ ...patriotsBall(), down: 4 }, { coffinCorner: null, fake: true });
    expect(viewFor(s, 'away')).toMatchObject({ puntCall: { fake: false }, fakeKick: false });
    expect(viewFor(s, 'home').fakeKick).toBe(true);
  });

  it('the offense lines up for all to see; a change after the defense is set lets the defense set up again', () => {
    const look = { formationId: 'pass-2wr-2te', lineup: { QB: 'a', RB1: 'b' } };
    let s = showOffense(patriotsBall(), look);
    s = setDefenseReady(s, true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'PASS' });
    expect(viewFor(s, 'away').offenseLook).toEqual(look); // the defense sees it
    expect(showOffense(s, { ...look }).defenseReady).toBe(true); // the same look: still set
    const changed = showOffense(s, { formationId: 'run-2rb-2te', lineup: { QB: 'a', RB1: 'b', RB2: 'c' } });
    expect(changed).toMatchObject({ defenseReady: false, defenseSetup: null, offenseChanged: true });
    expect(mayAct(s, 'home', { t: 'look', formationId: 'x', lineup: {} })).toBeNull();
    expect(mayAct(s, 'away', { t: 'look', formationId: 'x', lineup: {} })).toBe("That's the other coach's decision");
  });

  it('the defense sets up for all to see as well: its formation and players, not its call', () => {
    const look = { formationId: 'dl3-lb4-db4-ace', lineup: { A: ['x'], K: ['y'] } };
    const s = showDefense(patriotsBall(), look);
    expect(viewFor(s, 'home').defenseLook).toEqual(look);
    expect(mayAct(s, 'away', { t: 'defense-look', ...look })).toBeNull();
    expect(mayAct(s, 'home', { t: 'defense-look', ...look })).toBe("That's the other coach's decision");
  });

  it('the defense lines up for all to see too: only the defense shows its look', () => {
    const s = patriotsBall();
    const look = { t: 'defense-look' as const, formationId: 'dl3-lb4-db4-ace', lineup: { A: ['x'] } };
    expect(mayAct(s, 'away', look)).toBeNull();
    expect(mayAct(s, 'home', look)).toBe("That's the other coach's decision");
  });
});

