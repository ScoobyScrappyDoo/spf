import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, buildLineup, callToss, chooseAfterToss, computeDrives, createGame, declareFieldGoal, declarePunt, fieldGoalPlay, Fac, GameContext, GameState,
  getDefenseFormation, getFormation, kickoff, OffenseCall, puntPlay, RegularFac, setDefenseReady, SkillPlayer, snapPlay, spotShort, Team,
} from './index';

const cards = deckJson as Fac[];
const patriots = patriotsJson as unknown as Team;
const dolphins = dolphinsJson as unknown as Team;
const ctx: GameContext = { cards, teams: { home: patriots, away: dolphins } };
const teams = { home: patriots, away: dolphins };
const regular = cards.filter((c): c is RegularFac => !c.isZ);

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
const pn = (n: number) => (c: RegularFac) => c.passNumber === n;
const noOB = (t: (c: RegularFac) => boolean) => (c: RegularFac) => t(c) && !c.outOfBounds;
const ilToLG = (c: RegularFac) => c.runs.IL.kind === 'blockers' && c.runs.IL.players.length === 1 && c.runs.IL.players[0] === 'LG';
function stack(state: GameState, top: Fac[]): GameState {
  const ids = top.map(c => c.id);
  return { ...state, deck: { ...state.deck, order: [...ids, ...state.deck.order.filter(id => !ids.includes(id))], next: 0 } };
}
function patriotsBall(): GameState {
  let s = createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1 }, cards);
  for (const c of ['HEADS', 'TAILS'] as const) {
    const t = callToss(s, c, ctx);
    if (t.toss.winner === 'home') { s = t; break; }
  }
  return kickoff(stack(chooseAfterToss(s, 'RECEIVE', ctx), pick(rn(11))), ctx);
}
const offense = buildLineup(patriots, getFormation('pass-2wr-2te'));
const morgan = patriots.players.find(p => p.id === offense.FLL)! as SkillPlayer;
const defenseLineup = buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace'));
const ready = (s: GameState) => setDefenseReady(s, true, { formationId: 'dl3-lb4-db4-ace', lineup: defenseLineup, call: 'PASS' });
const call = (over: Partial<OffenseCall> = {}): OffenseCall => ({ formationId: 'pass-2wr-2te', slot: 'RB1', play: 'IL', strategy: 'NONE', extraBlockers: [], ...over });
const snap = (s: GameState, top: Fac[], c = call()) => snapPlay(ready(stack({ ...s, targets: [] }, top)), c, offense, ctx);
const quickGain = [...Array(12).keys()].map(i => i + 1).find(r => typeof morgan.passGain![r - 1].q === 'number' && (morgan.passGain![r - 1].q as number) > 0)!;
const qYards = morgan.passGain![quickGain - 1].q as number;

/** A Patriots drive: a 9-yard run, a quick pass to Morgan, then a punt (RN 7: 40 yards, fair catch). */
function driveThenPunt(): GameState {
  let s = snap(patriotsBall(), pick(ilToLG, rn(5)));
  s = snap(s, pick(c => c.passes.QK === 'ORIG', pn(1), noOB(rn(quickGain))), call({ slot: 'FLL', play: 'QK' }));
  s = { ...s, down: 4, distance: 10 };
  return puntPlay(ready(declarePunt(stack(s, pick(rn(7))), { coffinCorner: null })), ctx);
}

describe('drives', () => {
  it('a drive: its plays in broadcast form, net yards, time and how it ended', () => {
    const s = driveThenPunt();
    const [d] = computeDrives(s, teams);
    expect(d).toMatchObject({ number: 1, side: 'home', startBallOn: 20, result: 'Punt' });
    expect(d.plays.map(p => p.text)).toEqual([
      'Craig James runs for 9 yards',
      `Tony Eason to Stanley Morgan for ${qYards}`,
      'Luke Prestridge punts 40 yards, fair catch',
    ]);
    expect(d.plays.map(p => p.kind)).toEqual(['run', 'pass', 'punt']);
    expect(d.yards).toBe(9 + qYards);
    expect(d.seconds).toBeGreaterThan(0);
  });

  it('the next drive belongs to the other team and is still in progress', () => {
    const s = driveThenPunt();
    expect(s.possession).toBe('away');
    const dolphinsOffense = buildLineup(dolphins, getFormation('pass-2wr-2te'));
    const patriotsDefense = buildDefenseLineup(patriots, getDefenseFormation('dl3-lb4-db4-ace'));
    const next = snapPlay(
      setDefenseReady(stack({ ...s, targets: [] }, pick(ilToLG, rn(5))), true, { formationId: 'dl3-lb4-db4-ace', lineup: patriotsDefense, call: 'PASS' }),
      call(), dolphinsOffense, ctx,
    );
    const drives = computeDrives(next, teams);
    expect(drives.map(d => [d.side, d.result])).toEqual([['home', 'Punt'], ['away', 'In progress']]);
    // The punt: from the 20 + 9 + the pass, 40 yards, fair catch.
    expect(drives[1].startBallOn).toBe(100 - (20 + 9 + qYards + 40));
    expect(spotShort(25)).toBe('own 25');
    expect(spotShort(66)).toBe('opp 34');
  });

  it('a touchdown ends the drive as a touchdown', () => {
    let s = patriotsBall();
    s = snap({ ...s, ballOn: 95, distance: 5 }, pick(ilToLG, rn(5)));
    const [d] = computeDrives(s, teams);
    expect(d.result).toBe('Touchdown');
    expect(d.plays[0].text).toBe('Craig James runs for 5 yards. Touchdown!');
  });

  it('a field goal drive counts its yards to where the kick was snapped', () => {
    const start = patriotsBall();
    let s = snap(start, pick(ilToLG, rn(5))); // 20 -> 29
    s = { ...s, ballOn: 75, down: 4, distance: 5 }; // as if the drive had reached the opponent's 25
    s = fieldGoalPlay(ready(declareFieldGoal(stack(s, pick(pn(20))), true)), ctx);
    const [d] = computeDrives(s, teams);
    expect(d.result).toBe('Field goal');
    expect(d.endBallOn).toBe(75);
  });
});


describe('drives: kneels and recoveries', () => {
  it('a quarterback flop reads as a knee', () => {
    const s = snap(patriotsBall(), [], call({ slot: 'QB', play: 'IL', strategy: 'QB_FLOP' }));
    const [d] = computeDrives(s, teams);
    expect(d.plays[0].text).toBe('Tony Eason takes a knee');
  });
});

describe('timeouts in the drive chart', () => {
  it('come from the timeout event, or in older games from the play text', async () => {
    const { applyEntry, computeDrives, createGame, newCoachMemory, withEntry } = await import('./index');
    const deck = (await import('../../../public/cards/fac-deck.json')).default as never;
    const home = (await import('./testdata/1984/patriots.json')).default as never;
    const away = (await import('./testdata/1984/chiefs.json')).default as never;
    const ctx = { cards: deck, teams: { home, away } };
    // A simulated game: the computer calls timeouts late in each half.
    let s = createGame({ homeTeamId: 'ne', awayTeamId: 'kc', seed: 5 }, deck);
    const memory = newCoachMemory();
    for (let i = 0; i < 3000 && s.phase !== 'GAME_OVER'; i++) s = withEntry(s, applyEntry(s, { t: 'sim', ...(i ? {} : { fresh: true }) }, ctx, memory), { t: 'sim' });
    const shown = (st: typeof s) => computeDrives(st, ctx.teams).flatMap(d => d.plays.filter(p => p.timeout).map(p => `${p.quarter} ${p.clock} ${p.timeout!.side} ${p.timeout!.left}`));
    const now = shown(s);
    expect(now.length).toBeGreaterThan(0);
    // The same game as an older one would have it: no timeout events, the old wording in the play text.
    const old = {
      ...s,
      events: (s.events ?? []).filter(e => e.type !== 'TIMEOUT'),
      log: s.log.map(l => ({ ...l, steps: l.steps.map(st => st.replace(/^(.+) \((home|away)\) takes a timeout, (\d+) remaining\.$/, 'Timeout, $1 ($2): $3 left in this half.')) })),
    };
    expect(shown(old)).toEqual(now);
  }, 60_000);
});
