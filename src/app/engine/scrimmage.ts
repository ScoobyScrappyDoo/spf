import { bigPlayBlocked, bigPlayResult, canBlitz, coverageProblem } from './defense-strategy';
/**
 * Plays from scrimmage: the snap, running plays (rule 8.2), Z cards on them (8.8), penalties (6.3)
 * and moving the chains, the score and the clock (9.0).
 */
import { FacDeck } from './deck';
import { addLog, applyKickoffOutcome, back, forward, fumbleLost, GameContext, PlayFlips, requirePhase, runClock, scoreTouchdown, spotPhrase, spotText, teamLabel } from './game';
import { Lineup, outOfPosition } from './lineup';
import { isPassPlay, PLAY_LABELS, STRATEGY_LABELS } from './model/calls';
import { clamp } from './model/common';
import { DEFENSE_CALL_LABELS, DefenseCall, getDefenseFormation } from './model/defense';
import { DefensiveBox, OffensiveSpot, RegularFac, RunDirective } from './model/fac';
import { getFormation, OffenseSlot, SLOT_GROUP } from './model/formations';
import { DefenseSetup, GameState, otherSide, PendingPenalty, PlayOutcome, ScrimmageOutcome, Side } from './model/game';
import { GainCell, isOffensiveLineman, isSkillPlayer, PlayerCard, RushRow } from './model/players';
import { Team } from './model/team';
import { OffenseCall } from './selection';
import { PENALTY_NAMES } from './tables';
import { inFinalMinutes, OUT_OF_BOUNDS_SECONDS, playSeconds } from './timing';
import { activeInjuries, backText, defenseBench, injuredIds, injuryFromPN, injuryIgnoredBecause, injuryText, offenseBench, tickInjuries, qbEnduranceReason } from './injuries';
import { Injury } from './model/injury';
import { END_SLOTS, zInjury } from './zinjury';
import { PassingPlay } from './pass';
import { enduranceContext, nextPossession, recordTarget } from './endurance';
import { playDirectionCheck } from './selection';
import { choosePenalized, penaltyKind } from './penalty-players';
import { SeededRandom } from './random';
import { chooseTacklers, Tacklers } from './tacklers';
import { addEvents, nextPlay } from './events';
import { applyScrimmage, scrimmagePenalty } from './chains';
import { StatEventBody } from './model/events';


// ---------------------------------------------------------------------------------------------
// "All set!" and the snap
// ---------------------------------------------------------------------------------------------

/** "All set!" hands over the defense's choices; "Not yet" takes them back. */
export function setDefenseReady(state: GameState, ready: boolean, setup?: DefenseSetup): GameState {
  requirePhase(state, 'PLAY');
  if (ready && setup) {
    const hurt = injuredIds(state, otherSide(state.possession!));
    if (Object.values(setup.lineup).flat().some(id => hurt.has(id!))) throw new Error('An injured player is on the defensive display');
    const coverage = coverageProblem(setup);
    if (coverage) throw new Error(`Coverage: ${coverage}`);
    if (setup.call === 'BLITZ' && (setup.blitzers ?? []).some(id => !canBlitz(setup.lineup, id))) throw new Error('Only players in rows 2 and 3 can blitz');
  }
  return {
    ...state, defenseReady: ready, defenseSetup: ready ? (setup ?? null) : null,
    // What the defense saw of the offense when it got set: a later change lets it set up again.
    lookAtReady: ready ? lookKey(state.offenseLook) : null, offenseChanged: false,
  };
}

const lookKey = (look: GameState['offenseLook']) =>
  look ? `${look.formationId}|${Object.entries(look.lineup).filter(([, id]) => id).sort().map(([s, id]) => `${s}:${id}`).join(',')}` : null;

/**
 * The offense lines up: its formation and players, for the defense to see (not its call). If the defense was already
 * set and the offense changed what it shows, the defense may set up again, as across a real line of scrimmage.
 */
/** The defense sets up: its formation and players, for the offense to see as they change (not its call). */
export function showDefense(state: GameState, look: { formationId: string; lineup: Record<string, string[] | undefined> }): GameState {
  return { ...state, defenseLook: look };
}

export function showOffense(state: GameState, look: { formationId: string; lineup: Record<string, string | undefined> }): GameState {
  const next: GameState = { ...state, offenseLook: look };
  if (state.defenseReady && state.lookAtReady !== null && state.lookAtReady !== undefined && state.lookAtReady !== lookKey(look)) {
    return { ...next, defenseReady: false, defenseSetup: null, lookAtReady: null, offenseChanged: true };
  }
  return next;
}

/** "Inside left to Craig James (RB1), draw play" */
export function describeCall(call: OffenseCall, lineup: Lineup, team: Team): string {
  const player = team.players.find(p => p.id === lineup[call.slot]);
  const who = player ? `${player.firstName} ${player.lastName} (${call.slot})` : call.slot;
  const strategy = call.strategy === 'NONE' ? '' : `, ${STRATEGY_LABELS[call.strategy].toLowerCase()}`;
  const blockers = call.extraBlockers.length ? `, ${call.extraBlockers.join(' and ')} kept in to block` : '';
  return `${PLAY_LABELS[call.play]} to ${who}${strategy}${blockers}`;
}

/** Whether the snap can resolve this call yet: running plays can, passes come next. */
/** Whether the snap can resolve this call: every play from scrimmage can, now that passing is in. */
export function canResolve(_call: OffenseCall): boolean {
  return true;
}

export interface SnapOptions {
  /** The two-minute offense (rule 9.4.1); only allowed in the final minutes of a half. */
  twoMinute?: boolean;
  /** The offense calls a timeout after this play (rule 9.2). */
  timeout?: boolean;
}

/** Who stops the clock after this play, if anyone: the offense first, then the defense, and only with timeouts left. */
function timeoutBy(state: GameState, options: SnapOptions): Side | undefined {
  const offense = state.possession!;
  const defense = otherSide(offense);
  if (options.timeout && (state.timeouts?.[offense] ?? 0) > 0) return offense;
  if (state.defenseSetup?.timeout && (state.timeouts?.[defense] ?? 0) > 0) return defense;
  return undefined;
}

/** Both coaches reveal their calls (rule 2.5) and the play is resolved. */
export function snapPlay(state: GameState, call: OffenseCall, lineup: Lineup, ctx: GameContext, options: SnapOptions = {}): GameState {
  requirePhase(state, 'PLAY');
  if (!state.defenseReady || !state.defenseSetup) throw new Error('The defense is not set yet');
  if (state.puntCall) throw new Error('A punt has been declared: punt, or take the declaration back first');
  if (state.fieldGoalCall) throw new Error('A field goal has been called: kick, or take it back first');
  const hurt = injuredIds(state, state.possession!);
  const hurtInLineup = Object.values(lineup).filter(id => id && hurt.has(id));
  if (hurtInLineup.length) throw new Error('An injured player is in the lineup');
  const qbRule = qbEnduranceReason(state, state.possession!, ctx.teams[state.possession!], ctx.teams[state.possession!].players.find(p => p.id === lineup.QB));
  if (qbRule) throw new Error(qbRule);
  // Rule 4.6: the player the play goes to must be allowed to be the target right now.
  const target = ctx.teams[state.possession!].players.find(p => p.id === lineup[call.slot]);
  if (target && isSkillPlayer(target)) {
    const tired = playDirectionCheck(target, enduranceContext(state));
    if (tired) throw new Error(`${target.firstName} ${target.lastName} can't be the target: ${tired.toLowerCase()}`);
  }
  // The fast timing: the two-minute offense in the final minutes, or the no-huddle at any time as a house rule.
  const twoMinute = !!options.twoMinute && (inFinalMinutes(state) || !!state.rules?.noHuddleAnyTime);
  // Rule 8.7: after a no-huddle play with the clock running, the defense keeps its players unless the offense changes.
  const lock = state.noHuddleLock;
  if (lock?.offenseIds && lock.side === state.possession && lock.play === (state.playIndex ?? 0)) {
    const ids = (l: Record<string, unknown>) => Object.values(l).flat().filter(Boolean).map(String).sort().join(',');
    const sameOffense = ids(lineup) === [...lock.offenseIds].sort().join(',');
    const setupNow = state.defenseSetup;
    const changed = !!setupNow && (setupNow.formationId !== lock.defenseFormation || ids(setupNow.lineup) !== ids(lock.defenseLineup ?? {}));
    if (sameOffense && changed) throw new Error("Rule 8.7: against a no-huddle offense the defense can't substitute unless the offense does or the clock stops");
  }
  const time = playSeconds('run', twoMinute, state.rngState);
  const offense = state.possession!;
  const setup = state.defenseSetup;
  const steps = [
    `Offense: ${describeCall(call, lineup, ctx.teams[offense]).replace(/^./, c => c.toLowerCase())}.`,
    `Defense: ${DEFENSE_CALL_LABELS[setup.call].toLowerCase()}, ${getDefenseFormation(setup.formationId).name}.`,
  ];
  const deck = new FacDeck(ctx.cards, state.deck);
  const flips = new PlayFlips(deck, call.strategy !== 'QB_FLOP', steps);
  let run: ScrimmageOutcome;
  let after: ScrimmageOutcome | PendingPenalty | null;
  let rngState: number;
  let targetId: string | null = lineup[call.slot] ?? null;
  let newInjury: Injury | null;
  // A big play defense (rule 8.4): one card on the Big Play Table first; "card fails" and the play goes on as normal.
  const defense = otherSide(offense);
  let big: ScrimmageOutcome | null = null;
  const bigCalled = !!setup.bigPlay && call.strategy !== 'QB_FLOP';
  if (bigCalled) {
    const why = bigPlayBlocked(state, defense, ctx.teams[defense]);
    if (why) throw new Error(`Big play: ${why}`);
    big = bigPlayOutcome(flips.next(), call, lineup, ctx.teams[offense], offense, state.ballOn!, steps, twoMinute, time.seconds);
  }
  if (big) {
    run = big;
    after = null;
    rngState = time.rngState;
    newInjury = null;
  } else if (isPassPlay(call.play)) {
    // Passes: the time depends on how it ended (an incomplete pass stops the clock), so it's drawn afterwards.
    const rng = new SeededRandom(state.rngState);
    const pass = new PassingPlay(state, ctx, call, lineup, setup, flips, steps, rng);
    const result = pass.resolve();
    const z = pass.zCard(result);
    const t = playSeconds(result.timeKind, twoMinute, rng.state);
    const clocked = <T extends ScrimmageOutcome>(o: T): T => ({ ...o, clockUsed: t.seconds, twoMinute });
    run = clocked(result);
    after = !z ? null : 'accept' in z
      ? { ...z, accept: clocked(z.accept as ScrimmageOutcome), decline: clocked(z.decline as ScrimmageOutcome) }
      : clocked(z);
    rngState = t.rngState;
    targetId = result.targetId;
    newInjury = pass.newInjury;
  } else {
    const rng = new SeededRandom(time.rngState);
    const play = new RunPlay(state, ctx, call, lineup, setup, flips, steps, rng);
    const resolved = { ...play.resolve(), clockUsed: time.seconds, twoMinute };
    run = { ...resolved, events: play.statEvents(resolved) };
    after = play.zCard(run as RunResult);
    rngState = rng.state;
    newInjury = play.newInjury;
  }
  // A timeout called with the play (rule 9.2) rides along on whatever the play turns out to be.
  const timeout = timeoutBy(state, options);
  if (timeout) {
    const mark = <T extends ScrimmageOutcome>(o: T): T => ({ ...o, timeout });
    run = mark(run);
    if (after) after = 'accept' in after ? { ...after, accept: mark(after.accept as ScrimmageOutcome), decline: mark(after.decline as ScrimmageOutcome) } : mark(after);
  }
  // This snap was a play: earlier injuries tick down first; someone hurt on this play misses the next ones.
  const ticked = tickInjuries(state);
  steps.push(...ticked.healed.map(backText));
  const targeted = recordTarget(nextPlay(ticked.state), targetId, offense);
  const base: GameState = {
    ...targeted, rngState, deck: deck.snapshot(), defenseReady: false, defenseSetup: null,
    ...(bigCalled ? {
      bigPlaysUsed: { ...state.bigPlaysUsed, [defense]: (state.bigPlaysUsed?.[defense] ?? 0) + 1 },
      bigPlayPossession: { ...state.bigPlayPossession, [defense]: state.possessionIndex ?? 0 },
    } : {}),
  };
  const title = `${teamLabel(ctx, offense)}: ${PLAY_LABELS[call.play].toLowerCase()}`;
  if (after && 'accept' in after) {
    return { ...base, phase: 'PENALTY_CHOICE', pendingPenalty: after, log: addLog(state, { title, steps, result: 'Penalty: the coach must decide.', cards: flips.cards }) };
  }
  const next = applyScrimmage(base, after ?? run, ctx, { title, steps, cards: flips.cards });
  const done = newInjury ? { ...next, injuries: [...activeInjuries(next), newInjury] } : next;
  // The no-huddle lock (rule 8.7) for the next play: who's on the field now, on both sides.
  const l = done.noHuddleLock;
  return l && !newInjury && !l.offenseIds && l.side === done.possession && done.phase === 'PLAY'
    ? { ...done, noHuddleLock: { ...l, play: done.playIndex ?? 0, offenseIds: Object.values(lineup).filter((x): x is string => !!x), defenseFormation: setup.formationId, defenseLineup: setup.lineup } }
    : { ...done, noHuddleLock: null };
}

// ---------------------------------------------------------------------------------------------
// Running plays
// ---------------------------------------------------------------------------------------------

interface RunResult extends ScrimmageOutcome {
  carrier: string;
  yards: number;
}


class RunPlay {
  private readonly offense: Side;
  private readonly offenseTeam: Team;
  private readonly defenseTeam: Team;
  private readonly carrier: PlayerCard;
  /** Set when a Z card hurts someone and the injury counts. */
  newInjury: Injury | null = null;
  /** Defenders at the spot the run went to: the likeliest to commit a personal foul. */
  private readonly nearPlay = new Set<string>();
  /** The boxes the run card named, for the tackle. */
  private readonly namedBoxes: DefensiveBox[] = [];
  private tacklers: Tacklers | null = null;

  constructor(
    private readonly state: GameState,
    private readonly ctx: GameContext,
    private readonly call: OffenseCall,
    private readonly lineup: Lineup,
    private readonly setup: DefenseSetup,
    private readonly flips: PlayFlips,
    private readonly steps: string[],
    private readonly rng: SeededRandom,
  ) {
    this.offense = state.possession!;
    this.offenseTeam = ctx.teams[this.offense];
    this.defenseTeam = ctx.teams[otherSide(this.offense)];
    const carrier = this.player(lineup[call.slot]);
    if (!carrier) throw new Error(`Nobody in ${call.slot}`);
    this.carrier = carrier;
  }

  private player(id: string | undefined): PlayerCard | undefined {
    return id ? this.offenseTeam.players.find(p => p.id === id) : undefined;
  }

  private get name() {
    return `${this.carrier.firstName} ${this.carrier.lastName}`;
  }

  resolve(): RunResult {
    const los = this.state.ballOn!;
    const finish = (yards: number, outOfBounds: boolean): RunResult => {
      let y = yards;
      // Rule 8.2.7: no inside run loses more than 3 yards.
      if ((this.call.play === 'IL' || this.call.play === 'IR') && y < -3) {
        this.steps.push(`Inside runs lose at most 3 yards: ${y} becomes -3.`);
        y = -3;
      }
      // Into the end zone: only the yards to the goal line count, in the summary as in the stats.
      const toGoal = 100 - los;
      if (y > toGoal) this.steps.push(`The goal line was ${toGoal} yard${toGoal === 1 ? '' : 's'} away: ${toGoal} of the ${y} count, and it's a touchdown.`);
      return {
        kind: 'SCRIMMAGE', newBallOn: los + y, countsAsDown: true, autoFirstDown: false, turnover: false,
        clockUsed: 0, outOfBounds, summary: gainText(this.name, Math.min(y, toGoal)), carrier: this.name, yards: y,
      };
    };

    // Rule 7.1.2.2 and 7.1.2.3: quarterback flop and sneak.
    if (this.call.strategy === 'QB_FLOP') {
      this.steps.push('Quarterback flop: one yard lost, no card flipped.');
      return finish(-1, false);
    }
    if (this.call.strategy === 'QB_SNEAK') {
      const c = this.flips.next();
      const gain = c.passNumber % 2 === 0 ? 1 : 0;
      this.steps.push(`Quarterback sneak: PN ${c.passNumber} is ${gain ? 'even, one yard' : 'odd, no gain'}.`);
      return finish(gain, false);
    }

    const rows = this.carrierRows();
    if (this.call.play === 'ER') return this.endAround(rows, finish);

    const first = this.flips.next();
    const dir = first.runs[this.call.play as 'IL' | 'IR' | 'SL' | 'SR'];
    this.steps.push(`Run card: ${PLAY_LABELS[this.call.play].toLowerCase()} goes ${directionText(dir)}.`);

    if (dir.kind === 'break') {
      const c = this.flips.next();
      const yards = this.cell(rows, c.runNumber, 'lg');
      this.steps.push(`Break! Long gain: RN ${c.runNumber} in the LG column, ${yards} yards.`);
      return finish(yards, this.outOfBounds(c));
    }

    const card = this.flips.next();
    const mod = this.runNumberModifier();
    const rn = clamp(card.runNumber + mod.value, 1, 12);
    this.steps.push(`RN ${card.runNumber}${mod.value ? ` ${mod.value > 0 ? '+' : ''}${mod.value} (${mod.why}) = ${rn}` : ''}.`);

    let base: number;
    let last = card;
    const n = rows ? rows[rn - 1].n : null;
    if (n === 'SG') {
      const c = this.flips.next();
      last = c;
      base = this.cell(rows, c.runNumber, 'sg');
      this.steps.push(`Short gain: RN ${c.runNumber} in the SG column, ${base} yards.`);
    } else if (n === 'LG') {
      // Rare: an "Lg" in the N column (Rick McIvor, 1984 Cardinals, row 12) flips a card for the LG column.
      const c = this.flips.next();
      last = c;
      base = this.cell(rows, c.runNumber, 'lg');
      this.steps.push(`Long gain: RN ${c.runNumber} in the LG column, ${base} yards.`);
    } else {
      base = cellYards(n, this.state.ballOn!);
      this.steps.push(`${this.name}'s N column, row ${rn}: ${base} yards.`);
    }
    const blocking = this.directionModifier(dir);
    if (blocking.text) this.steps.push(blocking.text);
    return finish(base + blocking.value, this.outOfBounds(last));
  }

  /** Rule 8.2.6. */
  private endAround(rows: RushRow[] | null, finish: (y: number, ob: boolean) => RunResult): RunResult {
    const first = this.flips.next();
    if (first.endAround !== 'OK') {
      this.steps.push(`End around: ${first.endAround} yards, the play is stopped in the backfield.`);
      return finish(first.endAround, false);
    }
    this.steps.push('End around: OK.');
    const card = this.flips.next();
    const mod = this.runNumberModifier();
    const rn = clamp(card.runNumber + mod.value, 1, 12);
    this.steps.push(`RN ${card.runNumber}${mod.value ? ` ${mod.value > 0 ? '+' : ''}${mod.value} (${mod.why}) = ${rn}` : ''}.`);
    if (rows && rows[rn - 1].n === 'SG') {
      const c = this.flips.next();
      if (c.runNumber === 1 || c.runNumber === 12) {
        const l = this.flips.next();
        const yards = this.cell(rows, l.runNumber, 'lg');
        this.steps.push(`RN ${c.runNumber}: long gain! RN ${l.runNumber} in the LG column, ${yards} yards.`);
        return finish(yards, this.outOfBounds(l));
      }
      const yards = this.cell(rows, c.runNumber, 'sg');
      this.steps.push(`Short gain: RN ${c.runNumber} in the SG column, ${yards} yards.`);
      return finish(yards, this.outOfBounds(c));
    }
    if (rows && rows[rn - 1].n === 'LG') {
      const c = this.flips.next();
      const yards = this.cell(rows, c.runNumber, 'lg');
      this.steps.push(`Long gain: RN ${c.runNumber} in the LG column, ${yards} yards.`);
      return finish(yards, this.outOfBounds(c));
    }
    const yards = cellYards(rows ? rows[rn - 1].n : 0, this.state.ballOn!);
    this.steps.push(`${this.name}'s N column, row ${rn}: ${yards} yards.`);
    return finish(yards, this.outOfBounds(card));
  }

  private carrierRows(): RushRow[] | null {
    const p = this.carrier;
    if (p.position === 'QB') return p.rushing;
    return isSkillPlayer(p) ? p.rushing : null;
  }

  /** A column the card doesn't have falls back to the next one: LG to SG to N (rule 8.2.5). */
  private cell(rows: RushRow[] | null, rn: number, column: 'sg' | 'lg'): number {
    if (!rows) return 0;
    const row = rows[rn - 1];
    const order: (keyof RushRow)[] = column === 'lg' ? ['lg', 'sg', 'n'] : ['sg', 'n'];
    const hasColumn = (k: keyof RushRow) => rows.some(r => typeof r[k] === 'number');
    const k = order.find(hasColumn) ?? 'n';
    return cellYards(row[k], this.state.ballOn!);
  }

  /** Rule 9.1: OB after the last run number ends the play out of bounds, but never on an inside run. */
  private outOfBounds(card: RegularFac): boolean {
    return card.outOfBounds && this.call.play !== 'IL' && this.call.play !== 'IR';
  }

  /** Run number modifiers (rule 8.2.2 and table 6.5, including the draw play 7.1.2.4). */
  runNumberModifier(): { value: number; why: string } {
    const call: DefenseCall = this.setup.call;
    const role = SLOT_GROUP[this.call.slot] === 'back' ? this.call.slot.replace('RB', 'BK') : null;
    let value = 0;
    let why = '';
    if (call === 'RUN_NO_KEY') {
      value = 2;
      why = 'run defense, no key';
    } else if (call.startsWith('RUN_KEY_')) {
      const keyed = call.replace('RUN_KEY_', '');
      if (keyed === role) {
        value = 4;
        why = 'run defense keyed on the ball carrier';
      } else {
        why = 'run defense keyed on the wrong back';
      }
    }
    if (this.call.strategy === 'DRAW') {
      const draw = call.startsWith('RUN_') ? 2 : call === 'PREVENT' ? -2 : -4;
      value += draw;
      why = why ? `${why}, draw ${draw > 0 ? '+' : ''}${draw}` : `draw against ${DEFENSE_CALL_LABELS[call].toLowerCase()}`;
    }
    return { value, why };
  }

  /** Blocking and tackling values on the spot the run card names (rules 8.2.3 and 8.2.8). */
  private directionModifier(dir: RunDirective): { value: number; text: string } {
    if (dir.kind === 'blockers') {
      const parts = dir.players.map(spot => this.blockers(spot));
      const value = parts.reduce((a, b) => a + b.value, 0);
      return { value, text: `Blocking: ${parts.map(p => p.text).join(' + ')} = ${signed(value)}.` };
    }
    if (dir.kind === 'boxes') {
      const boxes = dir.boxes.map(b => this.tackler(b));
      if (boxes.every(b => b.empty)) return { value: 2, text: `Box ${dir.boxes.join(' and ')} empty: +2.` };
      const value = boxes.reduce((a, b) => a + b.value, 0);
      return { value, text: `Tackling: ${boxes.map(b => b.text).join(' + ')} = ${signed(value)}.` };
    }
    if (dir.kind === 'matchup') {
      const blocker = this.blockers(dir.blocker);
      const box = this.tackler(dir.box);
      if (box.empty) return { value: blocker.value, text: `${blocker.text} against an empty box ${dir.box}: ${signed(blocker.value)}.` };
      const sum = blocker.value + box.value;
      const value = sum > 0 ? blocker.value : sum < 0 ? box.value : 0;
      const winner = sum > 0 ? 'the blocker wins' : sum < 0 ? 'the tackler wins' : 'a standoff';
      return { value, text: `${blocker.text} against ${box.text}: ${winner}, ${signed(value)}.` };
    }
    return { value: 0, text: '' };
  }

  private blockers(spot: OffensiveSpot): { value: number; text: string } {
    if (spot === 'BK') {
      // Rule 8.2.8: the other backs block; with no other back, nothing changes.
      const backs = getFormation(this.call.formationId).skillSlots.filter(s => SLOT_GROUP[s] === 'back' && s !== this.call.slot);
      const players = backs.map(s => this.player(this.lineup[s])).filter((p): p is PlayerCard => !!p);
      if (!players.length) return { value: 0, text: 'no other back (0)' };
      const value = players.reduce((a, p) => a + blockValue(p), 0);
      return { value, text: players.map(p => `${p.lastName} ${signed(blockValue(p))}`).join(' + ') };
    }
    const slots: OffenseSlot[] = spot === 'LE' || spot === 'RE' ? END_SLOTS[spot] : [spot === 'CN' ? 'C' : spot];
    const slot = slots.find(s => this.lineup[s]);
    const p = slot ? this.player(this.lineup[slot]) : undefined;
    if (!p || !slot) return { value: 0, text: `${spot} empty (0)` };
    const out = outOfPosition(p, slot);
    if (out) {
      const value = blockValue(p) - out.penalty;
      return { value, text: `${p.lastName} (${spot}) ${signed(blockValue(p))} -1 out of position = ${signed(value)}` };
    }
    return { value: blockValue(p), text: `${p.lastName} (${spot}) ${signed(blockValue(p))}` };
  }

  /** Rule 8.2.3.2 and 8.2.3.4: a box with two players counts as -4. */
  private tackler(box: DefensiveBox): { value: number; empty: boolean; text: string } {
    const ids = this.setup.lineup[box] ?? [];
    const players = ids.map(id => this.defenseTeam.players.find(p => p.id === id)).filter((p): p is PlayerCard => !!p);
    players.forEach(p => this.nearPlay.add(p.id));
    this.namedBoxes.push(box);
    if (!players.length) return { value: 0, empty: true, text: `box ${box} empty` };
    if (players.length > 1) return { value: -4, empty: false, text: `box ${box} (two players) -4` };
    const p = players[0];
    const value = 'tackle' in p ? p.tackle : 0;
    return { value, empty: false, text: `${p.lastName} (${box}) ${signed(value)}` };
  }

  /** The carry and the tackle, for the stats. Nobody tackles a touchdown, a run out of bounds or a QB flop. */
  statEvents(run: RunResult): StatEventBody[] {
    const los = this.state.ballOn!;
    const events: StatEventBody[] = [
      { type: 'RUSH', side: this.offense, playerId: this.carrier.id, yards: Math.min(run.yards, 100 - los), touchdown: false, ...(this.call.strategy === 'QB_FLOP' ? { kneel: true } : {}) },
    ];
    if (run.newBallOn >= 100 || run.outOfBounds || this.call.strategy === 'QB_FLOP') {
      if (run.outOfBounds && run.newBallOn < 100) this.steps.push(`${this.carrier.lastName} runs out of bounds.`);
      return events;
    }
    const t = chooseTacklers(this.call.play as 'IL' | 'IR' | 'SL' | 'SR' | 'ER', run.yards, this.namedBoxes, this.setup.lineup, this.rng);
    if (!t) return events;
    this.tacklers = t;
    const name = (id: string) => {
      const p = this.defenseTeam.players.find(x => x.id === id);
      return p ? `${p.firstName} ${p.lastName}` : id;
    };
    const defense = otherSide(this.offense);
    events.push({ type: 'TACKLE', side: defense, playerId: t.primary, assisted: !!t.assist });
    if (t.assist) events.push({ type: 'TACKLE', side: defense, playerId: t.assist, assisted: true });
    this.steps.push(`Tackle: ${name(t.primary)}${t.assist ? ` and ${name(t.assist)}` : ''}.`);
    return events;
  }

  // -------------------------------------------------------------------------------------------
  // Z cards (rule 8.8)
  // -------------------------------------------------------------------------------------------

  /** Reads the Z result once the play is over. Returns a changed outcome, a penalty choice, or null. */
  zCard(run: RunResult): ScrimmageOutcome | PendingPenalty | null {
    if (!this.flips.zCard) return null;
    const z = this.flips.zResult();
    if (z.type === 'INJURY') {
      this.injury(z.target);
      return null;
    }
    if (z.type === 'FUMBLE') {
      if (this.call.strategy === 'QB_FLOP') return null;
      if (z.homeTeamExempt && this.offense === 'home') {
        this.steps.push(`Z result: "Fumble(s)", but ${this.name} is on the home team, so no fumble (rule 8.8.5).`);
        return null;
      }
      if (run.newBallOn >= 100) {
        this.steps.push('Z result: fumble, but he was already in the end zone.');
        return null;
      }
      this.steps.push(`Z result: ${this.name} fumbles!`);
      const fumble = (lost: boolean): StatEventBody => ({ type: 'FUMBLE', side: this.offense, playerId: this.carrier.id, lost });
      if (!fumbleLost(this.flips, this.offenseTeam, this.steps, 'the defense recovers', `${this.carrier.lastName} falls on it`)) {
        return { ...run, events: [...(run.events ?? []), fumble(false)] };
      }
      // The recovery goes to the tackler, or to a defender near the spot.
      const near = [...this.nearPlay];
      const recoverer = this.tacklers?.primary ?? (near.length ? near[this.rng.int(near.length)] : Object.values(this.setup.lineup).flat()[0]);
      const recovery: StatEventBody[] = recoverer ? [{ type: 'FUMBLE_RECOVERY', side: otherSide(this.offense), playerId: recoverer }] : [];
      return {
        ...run, turnover: true, events: [...(run.events ?? []), fumble(true), ...recovery],
        summary: `${this.name} fumbles, the defense recovers at ${spotPhrase(run.newBallOn, 'the offense\'s')}`,
      };
    }
    const pen = z.byCategory[0]; // category 1: running plays, quick and screen passes
    return scrimmagePenalty(pen.against, pen.penalty, this.state, run, this.offense, this.steps, this.penalized(pen.against, pen.penalty));
  }

  /** Names the player who committed the foul (see penalty-players.ts), e.g. "Brian Holloway (OT, LT)". */
  private penalized(against: string, number: number): { label: string; id: string } | null {
    const onOffense = against === 'O';
    const where = new Map<string, string>();
    const candidates: PlayerCard[] = [];
    if (onOffense) {
      for (const [slot, id] of Object.entries(this.lineup)) {
        const p = this.player(id);
        if (p) { candidates.push(p); where.set(p.id, slot); }
      }
    } else {
      for (const [box, ids] of Object.entries(this.setup.lineup)) {
        for (const id of ids ?? []) {
          const p = this.defenseTeam.players.find(x => x.id === id);
          if (p) { candidates.push(p); where.set(p.id, `box ${box}`); }
        }
      }
    }
    const who = choosePenalized(penaltyKind(against, number), candidates, this.rng, this.nearPlay);
    return who ? { label: `${who.firstName} ${who.lastName} (${who.position}, ${where.get(who.id)})`, id: who.id } : null;
  }

  /** Rule 8.8.4: the Z card names the ball carrier, an offensive position or a defensive box. */
  private injury(target: string) {
    const card = this.flips.next(false);
    this.newInjury = zInjury({
      state: this.state, offense: this.offense, offenseTeam: this.offenseTeam, defenseTeam: this.defenseTeam, lineup: this.lineup,
      defenseLineup: this.setup.lineup, ballCarrierSlot: this.call.slot, target, passNumber: card.passNumber, steps: this.steps,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

function blockValue(p: PlayerCard): number {
  if (isOffensiveLineman(p)) return p.runBlock;
  if (isSkillPlayer(p)) return p.blocks;
  return 0;
}

function cellYards(cell: GainCell, ballOn: number): number {
  if (typeof cell === 'number') return cell;
  if (cell === 'TD') return 100 - ballOn;
  return 0;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function gainText(name: string, yards: number): string {
  if (yards > 0) return `${name} gains ${yards} yard${yards === 1 ? '' : 's'}`;
  if (yards < 0) return `${name} loses ${-yards} yard${yards === -1 ? '' : 's'}`;
  return `${name}, no gain`;
}

function directionText(dir: RunDirective): string {
  switch (dir.kind) {
    case 'break': return 'Break';
    case 'blockers': return dir.players.join(' + ');
    case 'boxes': return `box ${dir.boxes.join(' + ')}`;
    case 'matchup': return `${dir.blocker} vs box ${dir.box}`;
  }
}

/** The Big Play Table's result for this play (rule 8.4, table 6.9), or null when the card fails. */
function bigPlayOutcome(card: RegularFac, call: OffenseCall, lineup: Lineup, team: Team, offense: Side, los: number, steps: string[], twoMinute: boolean, seconds: number): ScrimmageOutcome | null {
  const pass = isPassPlay(call.play);
  const r = bigPlayResult(card.runNumber, pass);
  if (!r) {
    steps.push(`Big play defense! RN ${card.runNumber}: the card fails, the play goes on.`);
    return null;
  }
  const carrier = team.players.find(p => p.id === lineup[call.slot]);
  const qb = team.players.find(p => p.id === lineup.QB);
  const name = (p: PlayerCard | undefined) => (p ? `${p.firstName} ${p.lastName}` : 'The ball carrier');
  const base = { kind: 'SCRIMMAGE' as const, countsAsDown: true, autoFirstDown: false, turnover: false, outOfBounds: false, clockUsed: seconds, twoMinute };
  if (r.kind === 'loss') {
    const y = -r.yards;
    steps.push(`Big play defense! RN ${card.runNumber}: ${y ? `a loss of ${-y}` : 'no gain'}.`);
    return {
      ...base, newBallOn: los + y, summary: `${name(carrier)} is stopped by the big play defense${y ? ` for a loss of ${-y}` : ', no gain'}`,
      events: carrier ? [{ type: 'RUSH', side: offense, playerId: carrier.id, yards: y, touchdown: false }] : [],
    };
  }
  if (r.kind === 'sack') {
    steps.push(`Big play defense! RN ${card.runNumber}: the quarterback is sacked, ${r.yards} yards.`);
    return {
      ...base, newBallOn: los - r.yards, summary: `${name(qb)} is sacked by the big play defense for a loss of ${r.yards}`,
      events: qb ? [{ type: 'SACK', side: offense, playerId: qb.id, yards: r.yards, byId: null }] : [],
    };
  }
  steps.push(`Big play defense! RN ${card.runNumber}: incomplete.`);
  return {
    ...base, newBallOn: los, clockUsed: Math.min(seconds, 15), summary: `${name(qb)}'s pass is broken up by the big play defense`,
    events: qb ? [{ type: 'PASS', side: offense, playerId: qb.id, targetId: lineup[call.slot] ?? null, complete: false, yards: 0, touchdown: false, intercepted: false }] : [],
  };
}
