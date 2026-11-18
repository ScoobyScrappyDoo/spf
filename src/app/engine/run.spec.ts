import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildDefenseLineup, buildLineup, callToss, chooseAfterToss, choosePenalty, createGame, DefenseCall, Fac, GameContext,
  GameState, getDefenseFormation, getFormation, kickoff, OffenseCall, RegularFac, setDefenseReady, snapPlay, Team,
} from './index';

const cards = deckJson as Fac[];
const patriots = patriotsJson as unknown as Team;
const dolphins = dolphinsJson as unknown as Team;
// Patriots at home with the ball, Dolphins on defense.
const ctx: GameContext = { cards, teams: { home: patriots, away: dolphins } };
const regular = cards.filter((c): c is RegularFac => !c.isZ);
const zCard = cards.find(c => c.isZ)!;

/** Distinct regular cards, one per condition, in order. */
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
const il = (match: (d: RegularFac['runs']['IL']) => boolean) => (c: RegularFac) => match(c.runs.IL);
const ilToLG = il(d => d.kind === 'blockers' && d.players.length === 1 && d.players[0] === 'LG'); // Hannah, plus 4

function stack(state: GameState, top: Fac[]): GameState {
  const ids = top.map(c => c.id);
  return { ...state, deck: { ...state.deck, order: [...ids, ...state.deck.order.filter(id => !ids.includes(id))], next: 0 } };
}

/** Patriots ball, 1st & 10 at their own 20, 15:00 in the 1st quarter. */
function patriotsBall(over: Partial<GameState> = {}): GameState {
  let s = createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1 }, cards);
  for (const call of ['HEADS', 'TAILS'] as const) {
    const t = callToss(s, call, ctx);
    if (t.toss.winner === 'home') { s = t; break; }
  }
  s = chooseAfterToss(s, 'RECEIVE', ctx);
  s = kickoff(stack(s, pick(rn(11))), ctx);
  return { ...s, ...over };
}

const offense = buildLineup(patriots, getFormation('pass-2wr-2te'));
const defense = buildDefenseLineup(dolphins, getDefenseFormation('dl3-lb4-db4-ace'));
const run = (over: Partial<OffenseCall> = {}): OffenseCall => ({ formationId: 'pass-2wr-2te', slot: 'RB1', play: 'IL', strategy: 'NONE', extraBlockers: [], ...over });

function snap(s: GameState, top: Fac[], call = run(), defenseCall: DefenseCall = 'PASS', twoMinute = false) {
  const ready = setDefenseReady(stack(s, top), true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: defenseCall });
  return snapPlay(ready, call, offense, ctx, { twoMinute });
}
const lastPlay = (s: GameState) => s.log.filter(e => e.title.includes(':')).at(-1)!;

describe('running plays (rule 8.2)', () => {
  it('Craig James inside left behind John Hannah: RN 5 is 5 yards, Hannah blocks +4', () => {
    const s = snap(patriotsBall(), pick(ilToLG, rn(5)));
    expect(s).toMatchObject({ ballOn: 29, down: 2, distance: 1 });
    expect([855, 860, 865, 870]).toContain(s.clock); // a run takes 30-45 seconds
    expect(lastPlay(s).result).toBe('Craig James gains 9 yards. 2nd & 1 at own 29.');
  });

  it('a run defense keyed on the ball carrier adds 4 to the run number', () => {
    // RN 5 + 4 = 9: row 9 of James's N column is 1, plus Hannah's 4.
    expect(snap(patriotsBall(), pick(ilToLG, rn(5)), run(), 'RUN_KEY_BK1').ballOn).toBe(25);
    // Keyed on the wrong back: no change.
    expect(snap(patriotsBall(), pick(ilToLG, rn(5)), run(), 'RUN_KEY_BK2').ballOn).toBe(29);
  });

  it('a draw against a pass defense subtracts 4 from the run number', () => {
    // Draw against a pass defense: RN 5 - 4 = 1, which is "Sg" on James's card: a short gain from a new card.
    const s = snap(patriotsBall(), pick(ilToLG, rn(5), rn(3)), run({ strategy: 'DRAW' }));
    // SG column row 3 is 26, plus Hannah 4.
    expect(s.ballOn).toBe(20 + 26 + 4);
    expect(lastPlay(s).steps.join(' ')).toContain('Short gain');
  });

  it('a Break is a long gain from the LG column', () => {
    const s = snap(patriotsBall(), pick(il(d => d.kind === 'break'), rn(2)));
    expect(s.ballOn).toBe(20 + 61); // James LG row 2
    expect(s.down).toBe(1);
  });

  it('an "Lg" in the N column flips a card for the LG column (it counted 0 yards before update 04)', () => {
    // Craig James with "Lg" on row 5 of his N column, as Rick McIvor (1984 Cardinals) has on row 12.
    const jamesId = offense.RB1!;
    const changed = {
      ...patriots,
      players: patriots.players.map(p => (p.id === jamesId && 'rushing' in p && p.rushing
        ? { ...p, rushing: p.rushing.map((r, i) => (i === 4 ? { ...r, n: 'LG' as const } : r)) } : p)),
    } as Team;
    const own: GameContext = { cards, teams: { home: changed, away: dolphins } };
    const ready = setDefenseReady(stack(patriotsBall(), pick(ilToLG, rn(5), rn(2))), true, { formationId: 'dl3-lb4-db4-ace', lineup: defense, call: 'PASS' });
    const s = snapPlay(ready, run(), offense, own, { twoMinute: false });
    expect(s.ballOn).toBe(20 + 61 + 4); // James LG row 2, plus Hannah's 4
    expect(lastPlay(s).steps).toContain('Long gain: RN 2 in the LG column, 61 yards.');
  });

  it('a quarterback flop is a one-yard loss without a card', () => {
    const s = snap(patriotsBall(), [], run({ slot: 'QB', strategy: 'QB_FLOP' }));
    expect(s.ballOn).toBe(19);
    expect(s.deck.next).toBe(0); // the stacked deck is untouched
  });

  it('a touchdown from the 2 scores 6, kicks the extra point and kicks off', () => {
    const s = snap(patriotsBall({ ballOn: 98, distance: 2 }), pick(ilToLG, rn(5)));
    // The card says 9 yards, but only the 2 to the goal line count.
    const entry = s.log.find(e => e.title.includes('inside left'))!;
    expect(entry.result).toBe('Craig James gains 2 yards. Touchdown!');
    expect(entry.steps).toContain("The goal line was 2 yards away: 2 of the 9 count, and it's a touchdown.");
    expect(s.score.home).toBe(7);
    expect(s).toMatchObject({ phase: 'KICKOFF', kickoff: { kicking: 'home', afterSafety: false } });
  });

  it('tackled in his own end zone is a safety, and the Patriots free kick', () => {
    // Box C (Baumhower, -4) on an inside run: a loss. From the 1, any loss is a safety.
    const toC = il(d => d.kind === 'boxes' && d.boxes.length === 1 && d.boxes[0] === 'C');
    const s = snap(patriotsBall({ ballOn: 1 }), pick(toC, rn(12)));
    expect(s.score.away).toBe(2);
    expect(s).toMatchObject({ phase: 'KICKOFF', kickoff: { kicking: 'home', afterSafety: true } });
  });

  it('short on 4th down is a turnover on downs', () => {
    const s = snap(patriotsBall({ down: 4, distance: 15 }), pick(ilToLG, rn(5)));
    expect(s).toMatchObject({ possession: 'away', ballOn: 100 - 29, down: 1, distance: 10 });
  });
});

describe('Z cards on running plays (rule 8.8)', () => {
  it('a fumble the defense recovers changes possession at the spot', () => {
    const fumble = (c: RegularFac) => c.z.type === 'FUMBLE' && !c.z.homeTeamExempt;
    const [dir, number, result, recovery] = pick(ilToLG, rn(5), fumble, c => c.passNumber <= 24);
    const s = snap(patriotsBall(), [zCard, dir, number, result, recovery]);
    expect(s).toMatchObject({ possession: 'away', ballOn: 100 - 29 });
  });

  it('defensive offside lets the offense choose: replay the down 5 yards closer, or keep the run', () => {
    const offside = (c: RegularFac) => c.z.type === 'PENALTY' && c.z.byCategory[0].against === 'D' && c.z.byCategory[0].penalty === 1;
    const [dir, number, result] = pick(ilToLG, rn(5), offside);
    const s = snap(patriotsBall(), [zCard, dir, number, result]);
    expect(s.phase).toBe('PENALTY_CHOICE');
    expect(s.pendingPenalty!.chooser).toBe('home');
    expect(s.pendingPenalty!.description).toContain('Decline: Craig James gains 9 yards.'); // names keep their capitals
    expect(choosePenalty(s, true, ctx)).toMatchObject({ phase: 'PLAY', ballOn: 25, down: 1, distance: 5 });
    expect(choosePenalty(s, false, ctx)).toMatchObject({ phase: 'PLAY', ballOn: 29, down: 2, distance: 1 });
  });

  it('names the player who committed the foul, without changing the yardage', () => {
    const offside = (c: RegularFac) => c.z.type === 'PENALTY' && c.z.byCategory[0].against === 'D' && c.z.byCategory[0].penalty === 1;
    const [dir, number, result] = pick(ilToLG, rn(5), offside);
    const s = snap(patriotsBall(), [zCard, dir, number, result]);
    const line = s.log.at(-1)!.steps.find(x => x.startsWith('Z result: offside on the defense'))!;
    expect(line).toMatch(/^Z result: offside on the defense: [A-Z][a-z]+ .+ \((DE|DT|LB|DB), box [A-O]\)\.$/);
    expect(choosePenalty(s, false, ctx).ballOn).toBe(29); // declined: the run's 9 yards stand, as before
  });

  it('a movement penalty on the offense has no option: back 5, same down', () => {
    const movement = (c: RegularFac) => c.z.type === 'PENALTY' && c.z.byCategory[0].against === 'O' && c.z.byCategory[0].penalty === 2;
    const [dir, number, result] = pick(ilToLG, rn(5), movement);
    expect(snap(patriotsBall(), [zCard, dir, number, result])).toMatchObject({ phase: 'PLAY', ballOn: 15, down: 1, distance: 15 });
  });
});

describe('the clock (rule 9.0)', () => {
  it('ends the 1st quarter when time runs out, and keeps the drive going', () => {
    const s = snap(patriotsBall({ clock: 10 }), pick(ilToLG, rn(5)));
    expect(s).toMatchObject({ quarter: 2, clock: 900, possession: 'home', ballOn: 29 });
    expect(s.log.at(-1)!.title).toBe('End of the 1st quarter');
  });

  it('at halftime the team that received first kicks off', () => {
    const s = snap(patriotsBall({ quarter: 2, clock: 10 }), pick(ilToLG, rn(5)));
    expect(s).toMatchObject({ quarter: 3, phase: 'KICKOFF', kickoff: { kicking: 'home' } });
  });

  it('the play that reaches the two-minute warning uses only 20 seconds', () => {
    expect(snap(patriotsBall({ quarter: 2, clock: 130 }), pick(ilToLG, rn(5))).clock).toBe(110);
  });

  it('runs take 30-45 seconds, in 5-second steps, and the time is in the play-by-play', () => {
    const seen = new Set<number>();
    let s = patriotsBall();
    for (let i = 0; i < 40; i++) {
      // A fresh target record each time: this test is about the clock, not play direction.
      s = snap({ ...s, phase: 'PLAY', quarter: 1, clock: 900, possession: 'home', ballOn: 20, down: 1, distance: 10, targets: [] }, pick(ilToLG, rn(5)));
      seen.add(900 - s.clock);
    }
    expect([...seen].every(t => [30, 35, 40, 45].includes(t))).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
    expect(lastPlay(s).steps.at(-1)).toMatch(/^\d+ seconds off the clock\.$/);
  });

  it('the two-minute offense takes 10-20 seconds, but only in the final minutes', () => {
    const late = snap(patriotsBall({ quarter: 4, clock: 240 }), pick(ilToLG, rn(5)), run(), 'PASS', true);
    expect([10, 15, 20]).toContain(240 - late.clock);
    expect(lastPlay(late).steps.at(-1)).toContain('two-minute offense');
    const early = snap(patriotsBall({ quarter: 1, clock: 600 }), pick(ilToLG, rn(5)), run(), 'PASS', true);
    expect([30, 35, 40, 45]).toContain(600 - early.clock);
  });

  it('the same seed gives the same clock', () => {
    const a = snap(patriotsBall(), pick(ilToLG, rn(5)));
    const b = snap(patriotsBall(), pick(ilToLG, rn(5)));
    expect(b.clock).toBe(a.clock);
  });

  it('the game ends after the 4th quarter', () => {
    const s = snap(patriotsBall({ quarter: 4, clock: 5, score: { home: 7, away: 3 } }), pick(ilToLG, rn(5)));
    expect(s.phase).toBe('GAME_OVER');
    expect(s.log.at(-1)!.result).toBe('Patriots (home) win 7-3.');
  });
});
