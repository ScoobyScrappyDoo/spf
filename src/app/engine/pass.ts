import { blitzersOf, coverageHelpers, dbOutOfPosition, DOUBLE_COVERAGE, TRIPLE_COVERAGE } from './defense-strategy';
/**
 * Passing plays (rule 8.3): quick, short and long passes, screens, the pass rush, sacks, interceptions.
 * The flow follows the rulebook: the pass card first (to the receiver called, redirected, or a pass rush), then the
 * quarterback's completion range adjusted by the defense, then the receiver's pass gain column.
 */
import { scrimmagePenalty, yardsAlongPass } from './chains';
import { fumbleLost, GameContext, PlayFlips } from './game';
import { Lineup, outOfPosition } from './lineup';
import { inRange, Range, clamp } from './model/common';
import { DefenseCall, DefensiveBox, rowOf } from './model/defense';
import { StatEventBody } from './model/events';
import { getFormation, OffenseFormation, OffenseSlot } from './model/formations';
import { DefenseSetup, GameState, otherSide, PendingPenalty, ScrimmageOutcome, Side, Coverage } from './model/game';
import { Injury } from './model/injury';
import { GainCell, isOffensiveLineman, isSkillPlayer, PlayerCard, Quarterback, SkillPlayer } from './model/players';
import { Team } from './model/team';
import { choosePenalized, penaltyKind } from './penalty-players';
import { SeededRandom } from './random';
import { OffenseCall } from './selection';
import { COVERING_BOX, INTERCEPTION_BOX, INTERCEPTION_RETURN, PASS_DEFENSE } from './tables';
import { PlayKind } from './timing';
import { zInjury } from './zinjury';

type PassType = 'QK' | 'SH' | 'LG' | 'SC';
type Role = keyof typeof COVERING_BOX;

/** An empty box over the receiver adds 5 to the completion range (rule 8.3.2.2). */
const EMPTY_BOX_BONUS = 5;
/** Each back kept in to block adds 2 to the completion range and to the pass blocking (optional rule O4). */
const EXTRA_BLOCKER_BONUS = 2;
/** Play action (7.1.2.5): against a run defense +5, a pass defense -5, prevent -10. */
const PLAY_ACTION = { RUN: 5, PASS: -5, PREVENT: -10, BLITZ: 0 };
/** Chance of a second tackler on a completed pass. */
const PASS_ASSIST_CHANCE = 20;

export interface PassResult extends ScrimmageOutcome {
  /** Who the pass went to in the end, for play direction (rule 4.6); the intended receiver on a pass rush. */
  targetId: string | null;
  timeKind: PlayKind;
  /** Who had the ball when the play ended: the receiver, or the quarterback on a sack or scramble. Null when nobody. */
  ballCarrier: { slot: OffenseSlot; player: PlayerCard } | null;
  incomplete: boolean;
}

/** A defender's (or blitzer's) pass rush value; quarterbacks carry pass rush *ranges* under the same name. */
const rushValue = (p: PlayerCard) => (p.position !== 'QB' && 'passRush' in p && typeof p.passRush === 'number' ? p.passRush : 0);

const defenseKind = (call: DefenseCall): keyof typeof PLAY_ACTION =>
  call.startsWith('RUN_') ? 'RUN' : call === 'PASS' ? 'PASS' : call === 'BLITZ' ? 'BLITZ' : 'PREVENT';

/** Rule roles for the receivers: ends, flankers (with two, the left one is FL#1), and backs. */
export function receiverRoles(formation: OffenseFormation): Map<OffenseSlot, Role> {
  const roles = new Map<OffenseSlot, Role>();
  const slots = formation.skillSlots;
  for (const s of slots) {
    if (s === 'TEL' || s === 'SEL') roles.set(s, 'LE');
    if (s === 'TER' || s === 'SER') roles.set(s, 'RE');
    if (s === 'RB1') roles.set(s, 'BK1');
    if (s === 'RB2') roles.set(s, 'BK2');
    if (s === 'RB3') roles.set(s, 'BK3');
  }
  const flankers = slots.filter(s => s === 'FLL' || s === 'FLR');
  flankers.forEach((s, i) => roles.set(s, i === 0 ? 'FL1' : 'FL2'));
  return roles;
}

export class PassingPlay {
  private readonly offense: Side;
  private readonly defense: Side;
  private readonly offenseTeam: Team;
  private readonly defenseTeam: Team;
  private readonly formation: OffenseFormation;
  private readonly roles: Map<OffenseSlot, Role>;
  private readonly qb: Quarterback | undefined;
  private readonly blitzers: Set<string>;
  private readonly play: PassType;
  private readonly los: number;
  newInjury: Injury | null = null;

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
    this.defense = otherSide(this.offense);
    this.offenseTeam = ctx.teams[this.offense];
    this.defenseTeam = ctx.teams[this.defense];
    this.formation = getFormation(call.formationId);
    this.roles = receiverRoles(this.formation);
    this.play = call.play as PassType;
    this.los = state.ballOn!;
    const qb = this.player(lineup.QB);
    this.qb = qb?.position === 'QB' ? qb : undefined;
    this.blitzers = new Set(blitzersOf(setup)); // the coach's blitzers, or F and J (rule 8.3.6.1)
  }

  private player(id: string | undefined): PlayerCard | undefined {
    return id ? this.offenseTeam.players.find(p => p.id === id) : undefined;
  }

  private defender(id: string): PlayerCard | undefined {
    return this.defenseTeam.players.find(p => p.id === id);
  }

  private nameOf = (p: PlayerCard) => `${p.firstName} ${p.lastName}`;
  private get qbName() {
    return this.qb ? this.nameOf(this.qb) : 'The quarterback';
  }

  private slotOfRole(role: Role): OffenseSlot | undefined {
    return [...this.roles.entries()].find(([, r]) => r === role)?.[0];
  }

  /** The defenders guarding a receiver; blitzers have left their boxes (rule 8.3.6.1). */
  private covering(slot: OffenseSlot): PlayerCard[] {
    const role = this.roles.get(slot);
    if (!role) return [];
    const box = COVERING_BOX[role] as DefensiveBox;
    return (this.setup.lineup[box] ?? []).filter(id => !this.blitzers.has(id)).map(id => this.defender(id)).filter((p): p is PlayerCard => !!p);
  }

  /** Double or triple coverage on this receiver (rule 7.2.2), with the extra defenders, if called. */
  private coverageOn(slot: OffenseSlot): { coverage: Coverage; helpers: PlayerCard[] } | null {
    const role = this.roles.get(slot);
    const coverage = role ? (this.setup.coverage ?? []).find(c => c.receiver === role) : undefined;
    return coverage ? { coverage, helpers: coverageHelpers(this.setup, this.defenseTeam, coverage) } : null;
  }

  // -------------------------------------------------------------------------------------------
  // The play
  // -------------------------------------------------------------------------------------------

  resolve(): PassResult {
    if (!this.qb) throw new Error('No quarterback in the lineup');
    if (this.play === 'SC') return this.screen();
    if (this.setup.call === 'BLITZ' && (this.play === 'SH' || this.play === 'LG')) {
      this.steps.push('Blitz against a short or long pass: automatic pass rush (rule 8.3.8).');
      return this.passRush();
    }
    const first = this.flips.next();
    const direction = first.passes[this.play];
    if (direction === 'PASS_RUSH') {
      this.steps.push('Pass card: pass rush!');
      return this.passRush();
    }
    if (direction === 'ORIG') {
      this.steps.push(`Pass card: to the receiver called (${this.call.slot}).`);
      return this.thrownTo(this.call.slot, this.passNumberCard());
    }
    const slot = this.redirect(direction);
    if (!slot) {
      this.steps.push(`Pass card: redirected to ${direction}, but nobody is there: incomplete.`);
      return this.incomplete(null, null);
    }
    const who = this.player(this.lineup[slot]);
    const name = who ? `${who.firstName} ${who.lastName}` : slot;
    if (direction.startsWith('BK') && !this.slotOfRole(direction as 'BK1' | 'BK2')) {
      // Rule 8.3.9.3: with two flankers, a pass to a back who isn't in the game goes to FL#2.
      this.steps.push(`Pass card: redirected to ${direction}. There's no ${direction === 'BK1' ? 'first' : 'second'} back, so with two flankers it goes to FL#2, ${name} (${slot}) (rule 8.3.9.3).`);
    } else {
      this.steps.push(`Pass card: redirected to ${direction}, ${name} (${slot}).`);
    }
    return this.thrownTo(slot, this.passNumberCard());
  }

  private passNumberCard() {
    return () => this.flips.next();
  }

  /** "FL", "LE", "RE", "BK1", "BK2" to a slot (rule 8.3.9.3: a pass to a back who isn't there goes to FL#2). */
  private redirect(to: 'FL' | 'LE' | 'RE' | 'BK1' | 'BK2'): OffenseSlot | undefined {
    if (to === 'FL') return this.slotOfRole('FL1');
    if (to === 'LE' || to === 'RE') return this.slotOfRole(to);
    return this.slotOfRole(to) ?? this.slotOfRole('FL2');
  }

  /** A pass on its way to a receiver: is he there, can he catch it, then the completion range. */
  private thrownTo(slot: OffenseSlot, draw: () => ReturnType<PlayFlips['next']>): PassResult {
    const receiver = this.player(this.lineup[slot]);
    if (this.call.extraBlockers.includes(slot)) {
      this.steps.push(`${receiver?.lastName ?? slot} stayed in to block: incomplete.`);
      return this.incomplete(receiver ?? null, slot);
    }
    if (!receiver || !isSkillPlayer(receiver) || !receiver.passGain) {
      this.steps.push(`${receiver ? receiver.lastName + ' has no pass gain values' : 'Nobody there'}: incomplete.`);
      return this.incomplete(receiver ?? null, slot);
    }
    const ranges = this.qb!.passing[this.play === 'QK' ? 'quick' : this.play === 'SH' ? 'short' : 'long'];
    const mod = this.completionModifier(slot);
    const base = ranges.com?.to ?? 0;
    const ceiling = (ranges.int?.from ?? 49) - 1;
    const comTo = clamp(base + mod.value, 0, ceiling);
    const card = draw();
    const pn = card.passNumber;
    this.steps.push(`PN ${pn} against ${this.qb!.lastName}'s completion range 1-${comTo}${mod.value ? ` (1-${base} ${mod.value > 0 ? '+' : ''}${mod.value}: ${mod.why})` : ''}.`);
    if (pn <= comTo) return this.complete(receiver, slot);
    if (ranges.int && inRange(pn, ranges.int)) {
      this.steps.push(`PN ${pn} is in his interception range ${ranges.int.from}-${ranges.int.to}: intercepted!`);
      return this.interceptedByTable(receiver, slot);
    }
    return this.incompleteOrCoverageInterception(receiver, slot, pn);
  }

  /** Rule 8.3.2: defense, covering defenders, play action and extra blockers. */
  private completionModifier(slot: OffenseSlot): { value: number; why: string } {
    const parts: string[] = [];
    let value = 0;
    const kind = defenseKind(this.setup.call);
    const inside20 = this.los >= 80;
    const table = PASS_DEFENSE[this.play as 'QK' | 'SH' | 'LG'][kind][inside20 ? 1 : 0];
    if (table) {
      value += table;
      parts.push(`${kind.toLowerCase()} defense ${table > 0 ? '+' : ''}${table}${inside20 ? ' inside the 20' : ''}`);
    }
    const covering = this.covering(slot);
    const role = this.roles.get(slot);
    const multi = this.coverageOn(slot);
    if (multi) {
      // Rule 7.2.2: the defenders' printed values don't count; double coverage is -7, triple -15.
      const v = multi.coverage.level === 'TRIPLE' ? TRIPLE_COVERAGE : DOUBLE_COVERAGE;
      value += v;
      const who = [...covering, ...multi.helpers].map(d => d.lastName).join(', ');
      parts.push(`${multi.coverage.level === 'TRIPLE' ? 'triple' : 'double'} coverage ${v}${who ? ` (${who})` : ''}`);
    } else {
      if (role && !covering.length) {
        value += EMPTY_BOX_BONUS;
        parts.push(`box ${COVERING_BOX[role]} empty +${EMPTY_BOX_BONUS}`);
      }
      for (const d of covering) {
        const printed = 'passDefense' in d ? d.passDefense : 0;
        // Optional rule O1: a back out of his listed position covers one worse.
        const out = role ? dbOutOfPosition(d, COVERING_BOX[role] as DefensiveBox) : null;
        const pd = printed + (out?.penalty ?? 0);
        value += pd;
        parts.push(out ? `${d.lastName} ${printed > 0 ? '+' : ''}${printed} +1 out of position` : `${d.lastName} ${pd > 0 ? '+' : ''}${pd}`);
      }
    }
    if (this.call.strategy === 'PLAY_ACTION' && (this.play === 'SH' || this.play === 'LG')) {
      const pa = PLAY_ACTION[kind];
      value += pa;
      parts.push(`play action ${pa > 0 ? '+' : ''}${pa}`);
    }
    if (this.call.extraBlockers.length) {
      const b = EXTRA_BLOCKER_BONUS * this.call.extraBlockers.length;
      value += b;
      parts.push(`extra blockers +${b}`);
    }
    return { value, why: parts.join(', ') };
  }

  /** Rule 8.3.3: the receiver's pass gain column. "Lg" sends it to the L column; a blank or "inc" is incomplete. */
  private complete(receiver: SkillPlayer, slot: OffenseSlot): PassResult {
    const column = this.play === 'QK' ? 'q' : this.play === 'SH' ? 's' : 'l';
    let card = this.flips.next();
    let cell: GainCell = receiver.passGain![card.runNumber - 1][column];
    let note = `RN ${card.runNumber} in ${receiver.lastName}'s ${column.toUpperCase()} column`;
    if (cell === 'LG') {
      card = this.flips.next();
      const row = receiver.passGain![card.runNumber - 1];
      cell = row.l ?? row.s ?? row.q;
      note += `: long gain! RN ${card.runNumber} in the L column`;
    }
    if (cell === null || cell === 'INC') {
      this.steps.push(`${note}: ${cell === 'INC' ? 'inc' : 'no number'}, so the pass is incomplete.`);
      return this.incomplete(receiver, slot);
    }
    let yards = cell === 'TD' ? 100 - this.los : typeof cell === 'number' ? cell : 0;
    // Rule 8.3.3.1: in the last two minutes, a long pass to a receiver with RN 1 is a touchdown.
    if (this.play === 'LG' && card.runNumber === 1 && this.state.quarter >= 4 && this.state.clock <= 120 && receiver.position === 'WR') {
      this.steps.push('Last two minutes, long pass, RN 1: touchdown (rule 8.3.3.1)!');
      yards = 100 - this.los;
    }
    yards = Math.min(yards, 100 - this.los);
    this.steps.push(`${note}: ${yards} yards.`);
    const outOfBounds = card.outOfBounds && this.los + yards < 100;
    if (outOfBounds) this.steps.push(`${receiver.lastName} goes out of bounds.`);
    const events: StatEventBody[] = [{ type: 'PASS', side: this.offense, playerId: this.qb!.id, targetId: receiver.id, complete: true, yards, touchdown: false, intercepted: false, kind: this.passKind }];
    if (this.los + yards < 100 && !outOfBounds) events.push(...this.tacklesOn(slot));
    return {
      kind: 'SCRIMMAGE', newBallOn: this.los + yards, countsAsDown: true, autoFirstDown: false, turnover: false, clockUsed: 0, outOfBounds,
      summary: `${this.qbName} to ${this.nameOf(receiver)}, ${yards === 0 ? 'no gain' : yards > 0 ? `${yards} yard${yards === 1 ? '' : 's'}` : `a loss of ${-yards}`}`,
      events, targetId: receiver.id, timeKind: 'pass', ballCarrier: { slot, player: receiver }, incomplete: false,
    };
  }

  private incomplete(receiver: PlayerCard | null, slot: OffenseSlot | null): PassResult {
    return {
      kind: 'SCRIMMAGE', newBallOn: this.los, countsAsDown: true, autoFirstDown: false, turnover: false, clockUsed: 0, outOfBounds: false,
      summary: `${this.qbName}'s pass ${receiver ? `for ${this.nameOf(receiver)} ` : ''}is incomplete`,
      events: [{ type: 'PASS', side: this.offense, playerId: this.qb!.id, targetId: receiver?.id ?? null, complete: false, yards: 0, touchdown: false, intercepted: false, kind: this.passKind }],
      targetId: receiver?.id ?? (slot ? this.lineup[slot] ?? null : null), timeKind: 'incomplete', ballCarrier: null, incomplete: true,
    };
  }

  /** Rule 8.3.5.1: an incomplete pass is picked off when the PN is in the covering defender's interception range. */
  private incompleteOrCoverageInterception(receiver: SkillPlayer, slot: OffenseSlot, pn: number): PassResult {
    // With double or triple coverage, any of the covering defenders may make it (the best placed one does).
    const guards = [...this.covering(slot), ...(this.coverageOn(slot)?.helpers ?? [])];
    for (const d of guards) {
      if (!('intercept' in d) || !inRange(pn, d.intercept)) continue;
      // Rule 8.3.5.2: a "48?" rating needs a new card, and an even PN, to make the interception.
      if (d.interceptMaybe) {
        const check = this.flips.next();
        const even = check.passNumber % 2 === 0;
        this.steps.push(`PN ${pn} is in ${d.lastName}'s "48?" range: a new card, PN ${check.passNumber}, ${even ? 'even: he picks it off in coverage!' : 'odd: he just misses it.'}`);
        if (!even) continue;
      } else {
        this.steps.push(`PN ${pn} is in ${d.lastName}'s interception range: he picks it off in coverage!`);
      }
      return this.intercepted(d, receiver);
    }
    this.steps.push(`PN ${pn}: incomplete.`);
    return this.incomplete(receiver, slot);
  }

  /** Rule 8.3.5.2: the interception table names the box; with nobody there, it's just incomplete. */
  private interceptedByTable(receiver: PlayerCard | null, slot: OffenseSlot | null): PassResult {
    const card = this.flips.next(false);
    const box = INTERCEPTION_BOX[this.play][card.runNumber - 1] as DefensiveBox;
    const there = (this.setup.lineup[box] ?? []).map(id => this.defender(id)).filter((p): p is PlayerCard => !!p);
    if (!there.length) {
      this.steps.push(`Interception table: RN ${card.runNumber}, box ${box} is empty, so the pass falls incomplete.`);
      return this.incomplete(receiver, slot);
    }
    // Two in the box: the one with the better interception rating.
    const size = (p: PlayerCard) => ('intercept' in p && p.intercept ? p.intercept.to - p.intercept.from + 1 : 0);
    const thief = there.sort((a, b) => size(b) - size(a))[0];
    this.steps.push(`Interception table: RN ${card.runNumber}, box ${box}: ${this.nameOf(thief)}.`);
    return this.intercepted(thief, receiver);
  }

  /** Rules 8.3.5.3 and 8.3.5.4: where it was picked off, then the return. */
  private intercepted(thief: PlayerCard, receiver: PlayerCard | null): PassResult {
    const point = this.flips.next(false);
    const along = yardsAlongPass(this.play, point.runNumber);
    const spot = this.los + along;
    const passEvent: StatEventBody = { type: 'PASS', side: this.offense, playerId: this.qb!.id, targetId: receiver?.id ?? null, complete: false, yards: 0, touchdown: false, intercepted: true, kind: this.passKind };
    const base = { kind: 'SCRIMMAGE' as const, countsAsDown: true, autoFirstDown: false, turnover: true, clockUsed: 0, outOfBounds: false, targetId: receiver?.id ?? null, timeKind: 'pass' as const, ballCarrier: null, incomplete: false };
    if (spot >= 100) {
      this.steps.push(`Picked off ${along} yards downfield, in the end zone: touchback.`);
      return {
        ...base, newBallOn: 80, summary: `${this.qbName} intercepted by ${this.nameOf(thief)} in the end zone, touchback`,
        events: [passEvent, { type: 'INTERCEPTION', side: this.defense, playerId: thief.id, returnYards: 0, touchdown: false }],
      };
    }
    const ret = this.flips.next(false);
    const type = thief.position === 'LB' ? 'LB' : thief.position === 'DB' ? 'DB' : 'LINE';
    const table = INTERCEPTION_RETURN[type][ret.runNumber - 1];
    const startOwn = 100 - spot; // the defense's own yard line where he caught it
    const yards = table >= 100 ? 100 - startOwn : Math.min(table, 100 - startOwn);
    const end = startOwn + yards;
    this.steps.push(`Picked off ${along} yards downfield. Return: RN ${ret.runNumber}, ${table >= 100 ? 'all the way' : `${yards} yards`}.`);
    const touchdown = end >= 100;
    return {
      ...base, newBallOn: 100 - Math.min(end, 99), defensiveTouchdown: touchdown,
      summary: `${this.qbName} intercepted by ${this.nameOf(thief)}${touchdown ? ', returned for a touchdown' : `, returned ${yards} yards`}`,
      events: [passEvent, { type: 'INTERCEPTION', side: this.defense, playerId: thief.id, returnYards: yards, touchdown }],
    };
  }

  /** Rule 8.3.6: rush against block changes the sack range, then one card decides. */
  /** The pass called, for yards after the catch in the stats. */
  private get passKind(): 'QK' | 'SH' | 'LG' | 'SC' {
    return this.call.play as 'QK' | 'SH' | 'LG' | 'SC';
  }

  /**
   * A pass rush play puts the quarterback under pressure, whatever comes of it: a sack, a scramble, a pass away. The
   * pressure goes to the sacker, or else to one of the rushers (the better pass rushers more often), picked from the
   * play itself (the PN and the line of scrimmage) rather than a new random number, so no game plays out differently.
   */
  private passRush(): PassResult {
    const result = this.resolvePassRush();
    const sack = (result.events ?? []).find(e => e.type === 'SACK');
    const by = sack && sack.type === 'SACK' && sack.byId ? sack.byId : this.pressurer?.id;
    if (!by) return result;
    const rusher = this.defender(by);
    if (rusher) this.steps.push(`Pressure: ${this.nameOf(rusher)}.`);
    const defense = this.offense === 'home' ? 'away' : 'home';
    return { ...result, events: [...(result.events ?? []), { type: 'PRESSURE', side: defense, playerId: by, sack: !!sack }] } as PassResult;
  }

  private pressurer: PlayerCard | null = null;

  private resolvePassRush(): PassResult {
    const qb = this.qb!;
    const rushers = [...(['A', 'B', 'C', 'D', 'E'] as DefensiveBox[]).flatMap(b => this.setup.lineup[b] ?? []), ...this.blitzers]
      .map(id => this.defender(id)).filter((p): p is PlayerCard => !!p);
    const rush = rushers.reduce((a, p) => a + rushValue(p), 0);
    const lineSlots: OffenseSlot[] = ['LT', 'LG', 'C', 'RG', 'RT'];
    // Optional rule O1: a lineman out of position blocks at -1.
    const outOf = lineSlots.filter(s => outOfPosition(this.player(this.lineup[s]), s)).length;
    const blockers = lineSlots.map(s => this.player(this.lineup[s])).filter((p): p is PlayerCard => !!p);
    const block = blockers.reduce((a, p) => a + (isOffensiveLineman(p) ? p.passBlock : 0), 0) - outOf + EXTRA_BLOCKER_BONUS * this.call.extraBlockers.length;
    const diff = rush - block;
    const r = qb.passRush;
    const runsTo = r.runs?.to ?? r.sack?.to ?? 0;
    const sackTo = clamp((r.sack?.to ?? 0) + 2 * diff, 0, runsTo);
    const runs: Range | null = sackTo < runsTo ? { from: sackTo + 1, to: runsTo } : null;
    if (outOf) this.steps.push(`${outOf} ${outOf === 1 ? 'lineman' : 'linemen'} out of position: pass block -${outOf}.`);
    this.steps.push(`Pass rush ${rush} against pass block ${block}: sack range 1-${sackTo}${diff ? ` (${diff > 0 ? '+' : ''}${2 * diff})` : ''}, runs ${runs ? `${runs.from}-${runs.to}` : 'none'}, complete ${r.com ? `${r.com.from}-${r.com.to}` : 'none'}.`);
    const card = this.flips.next();
    const pn = card.passNumber;
    // Who gets the pressure if it isn't a sack: a rusher weighted by his pass rush, picked from the PN and the line.
    const weights = rushers.map(p => 1 + Math.max(0, rushValue(p)));
    const total = weights.reduce((x, y) => x + y, 0);
    let pick = total ? (pn * 7 + this.los * 3) % total : 0;
    this.pressurer = rushers.find((_, i) => (pick -= weights[i]) < 0) ?? rushers[0] ?? null;
    if (pn <= sackTo) {
      const loss = Math.floor(this.flips.next().passNumber / 3);
      this.steps.push(`PN ${pn}: sacked! ${loss} yard${loss === 1 ? '' : 's'} lost.`);
      const sacker = this.weightedRusher(rushers);
      if (sacker) this.steps.push(`Sack: ${this.nameOf(sacker)}.`);
      return {
        kind: 'SCRIMMAGE', newBallOn: this.los - loss, countsAsDown: true, autoFirstDown: false, turnover: false, clockUsed: 0, outOfBounds: false,
        summary: `${this.qbName} sacked for a loss of ${loss}`, targetId: this.lineup[this.call.slot] ?? null, timeKind: 'pass',
        events: [{ type: 'SACK', side: this.offense, playerId: qb.id, yards: loss, byId: sacker?.id ?? null }],
        ballCarrier: { slot: 'QB', player: qb }, incomplete: false,
      };
    }
    if (runs && inRange(pn, runs)) {
      this.steps.push(`PN ${pn}: ${qb.lastName} scrambles!`);
      return this.scramble();
    }
    if (r.com && inRange(pn, r.com)) {
      this.steps.push(`PN ${pn}: he gets it away, complete.`);
      const slot = this.call.slot;
      const receiver = this.player(this.lineup[slot]);
      if (!receiver || !isSkillPlayer(receiver) || !receiver.passGain) return this.incomplete(receiver ?? null, slot);
      return this.complete(receiver, slot);
    }
    const slot = this.call.slot;
    const receiver = this.player(this.lineup[slot]);
    if (receiver && isSkillPlayer(receiver)) return this.incompleteOrCoverageInterception(receiver, slot, pn);
    this.steps.push(`PN ${pn}: incomplete.`);
    return this.incomplete(receiver ?? null, slot);
  }

  /** A quarterback scramble: his N column, a normal run with no modifiers (rule 8.3.6). */
  private scramble(): PassResult {
    const qb = this.qb!;
    const card = this.flips.next();
    let cell = qb.rushing[card.runNumber - 1].n;
    let note = `RN ${card.runNumber} in his N column`;
    let last = card;
    if (cell === 'SG') {
      const c = this.flips.next();
      last = c;
      cell = qb.rushing[c.runNumber - 1].sg ?? qb.rushing[c.runNumber - 1].n;
      note += `: short gain, RN ${c.runNumber} in the SG column`;
    }
    const yards = Math.min(typeof cell === 'number' ? cell : 0, 100 - this.los);
    this.steps.push(`${note}: ${yards} yards.`);
    const outOfBounds = last.outOfBounds && this.los + yards < 100;
    const events: StatEventBody[] = [{ type: 'RUSH', side: this.offense, playerId: qb.id, yards, touchdown: false }];
    if (this.los + yards < 100 && !outOfBounds) events.push(...this.randomTackle(yards));
    return {
      kind: 'SCRIMMAGE', newBallOn: this.los + yards, countsAsDown: true, autoFirstDown: false, turnover: false, clockUsed: 0, outOfBounds,
      summary: `${this.qbName} scrambles for ${yards === 0 ? 'no gain' : yards > 0 ? `${yards} yard${yards === 1 ? '' : 's'}` : `a loss of ${-yards}`}`,
      events, targetId: this.lineup[this.call.slot] ?? null, timeKind: 'run', ballCarrier: { slot: 'QB', player: qb }, incomplete: false,
    };
  }

  /** Rule 8.3.7: screen passes. The FAC says complete (with a multiplier), incomplete or intercepted; no QB card. */
  private screen(): PassResult {
    const slot = this.call.slot;
    const back = this.player(this.lineup[slot]);
    const card = this.flips.next();
    const sc = card.screen;
    if (sc.result === 'INC') {
      this.steps.push('Screen card: incomplete.');
      return this.incomplete(back ?? null, slot);
    }
    if (sc.result === 'INT') {
      this.steps.push('Screen card: intercepted!');
      return this.interceptedByTable(back ?? null, slot);
    }
    if (!back || !isSkillPlayer(back) || !back.rushing) {
      this.steps.push('Screen card: complete, but he has no rushing values: incomplete.');
      return this.incomplete(back ?? null, slot);
    }
    // RN modifiers (Pass defense table, screen row): run defense keyed on him +4, no key +2, wrong key 0; blitz -4; prevent -2.
    const call = this.setup.call;
    const keyed = call.startsWith('RUN_KEY_') && call.replace('RUN_KEY_', '') === slot.replace('RB', 'BK');
    const mod = call === 'RUN_NO_KEY' ? 2 : keyed ? 4 : call === 'BLITZ' ? -4 : call === 'PREVENT' ? -2 : 0;
    const rnCard = this.flips.next();
    const rn = clamp(rnCard.runNumber + mod, 1, 12);
    let cell = back.rushing[rn - 1].n;
    let note = `Screen card: complete x${sc.multiplier}. RN ${rnCard.runNumber}${mod ? ` ${mod > 0 ? '+' : ''}${mod} = ${rn}` : ''} in ${back.lastName}'s N column`;
    let last = rnCard;
    if (cell === 'SG') {
      const c = this.flips.next();
      last = c;
      cell = back.rushing[c.runNumber - 1].sg ?? back.rushing[c.runNumber - 1].n;
      note += `: short gain, RN ${c.runNumber} in the SG column`;
    }
    const raw = typeof cell === 'number' ? cell : cell === 'TD' ? 100 - this.los : 0;
    const yards = Math.min(Math.ceil(raw * (sc.multiplier ?? 1)), 100 - this.los);
    this.steps.push(`${note}: ${raw}${sc.multiplier !== 1 ? ` x ${sc.multiplier} = ${yards}` : ''} yards.`);
    const outOfBounds = last.outOfBounds && this.los + yards < 100;
    const events: StatEventBody[] = [{ type: 'PASS', side: this.offense, playerId: this.qb!.id, targetId: back.id, complete: true, yards, touchdown: false, intercepted: false, kind: this.passKind }];
    if (this.los + yards < 100 && !outOfBounds) events.push(...this.randomTackle(yards));
    return {
      kind: 'SCRIMMAGE', newBallOn: this.los + yards, countsAsDown: true, autoFirstDown: false, turnover: false, clockUsed: 0, outOfBounds,
      summary: `${this.qbName} screen to ${this.nameOf(back)}, ${yards === 0 ? 'no gain' : yards > 0 ? `${yards} yard${yards === 1 ? '' : 's'}` : `a loss of ${-yards}`}`,
      events, targetId: back.id, timeKind: 'pass', ballCarrier: { slot, player: back }, incomplete: false,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Tackles and sacks, for the stats (seeded; they never change the result)
  // -------------------------------------------------------------------------------------------

  /** On a completed pass the covering defender makes the stop when he can; otherwise someone in the secondary. */
  private tacklesOn(slot: OffenseSlot): StatEventBody[] {
    const covering = this.covering(slot)[0];
    if (!covering) return this.randomTackle(10);
    const events: StatEventBody[] = [];
    const assist = this.rng.int(100) < PASS_ASSIST_CHANCE ? this.pickFrom(this.inRows([2, 3]).filter(id => id !== covering.id)) : null;
    events.push({ type: 'TACKLE', side: this.defense, playerId: covering.id, assisted: !!assist });
    if (assist) events.push({ type: 'TACKLE', side: this.defense, playerId: assist, assisted: true });
    this.steps.push(`Tackle: ${this.nameOf(covering)}${assist ? ` and ${this.nameOf(this.defender(assist)!)}` : ''}.`);
    return events;
  }

  private randomTackle(yards: number): StatEventBody[] {
    const rows = yards <= 3 ? [1, 2] : yards <= 9 ? [2, 3] : [3, 2];
    const primary = this.pickFrom(this.inRows([rows[0]])) ?? this.pickFrom(this.inRows([rows[1]]));
    if (!primary) return [];
    const assist = this.rng.int(100) < PASS_ASSIST_CHANCE ? this.pickFrom(this.inRows(rows).filter(id => id !== primary)) : null;
    this.steps.push(`Tackle: ${this.nameOf(this.defender(primary)!)}${assist ? ` and ${this.nameOf(this.defender(assist)!)}` : ''}.`);
    return [
      { type: 'TACKLE', side: this.defense, playerId: primary, assisted: !!assist },
      ...(assist ? [{ type: 'TACKLE' as const, side: this.defense, playerId: assist, assisted: true }] : []),
    ];
  }

  private inRows(rows: number[]): string[] {
    return (Object.entries(this.setup.lineup) as [DefensiveBox, string[]][])
      .filter(([box]) => rows.includes(rowOf(box)))
      .flatMap(([, ids]) => ids ?? [])
      .filter(id => !this.blitzers.has(id));
  }

  private pickFrom(ids: string[]): string | null {
    return ids.length ? ids[this.rng.int(ids.length)] : null;
  }

  /** The sack goes to a rusher, more often the better pass rushers. */
  private weightedRusher(rushers: PlayerCard[]): PlayerCard | null {
    if (!rushers.length) return null;
    const weights = rushers.map(p => 1 + Math.max(0, rushValue(p)));
    let roll = this.rng.next() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < rushers.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return rushers[i];
    }
    return rushers[rushers.length - 1];
  }

  // -------------------------------------------------------------------------------------------
  // Z cards (rule 8.8)
  // -------------------------------------------------------------------------------------------

  zCard(result: PassResult): ScrimmageOutcome | PendingPenalty | null {
    if (!this.flips.zCard) return null;
    const z = this.flips.zResult();
    if (z.type === 'INJURY') {
      // "BC" on a pass: the quarterback if the Z card came first, otherwise the receiver (rule 8.8.4).
      const carrierSlot: OffenseSlot = this.flips.zAt === 1 || !result.ballCarrier ? 'QB' : result.ballCarrier.slot;
      const card = this.flips.next(false);
      this.newInjury = zInjury({
        state: this.state, offense: this.offense, offenseTeam: this.offenseTeam, defenseTeam: this.defenseTeam, lineup: this.lineup,
        defenseLineup: this.setup.lineup, ballCarrierSlot: carrierSlot, target: z.target, passNumber: card.passNumber, steps: this.steps,
      });
      return null;
    }
    if (z.type === 'FUMBLE') {
      const carrier = result.ballCarrier;
      if (!carrier || result.turnover || result.newBallOn >= 100) {
        this.steps.push('Z result: fumble, but nobody is carrying the ball.');
        return null;
      }
      if (z.homeTeamExempt && this.offense === 'home') {
        this.steps.push(`Z result: "Fumble(s)", but ${carrier.player.lastName} is on the home team, so no fumble (rule 8.8.5).`);
        return null;
      }
      this.steps.push(`Z result: ${this.nameOf(carrier.player)} fumbles!`);
      const fumble = (lost: boolean): StatEventBody => ({ type: 'FUMBLE', side: this.offense, playerId: carrier.player.id, lost });
      if (!fumbleLost(this.flips, this.offenseTeam, this.steps, 'the defense recovers', `${carrier.player.lastName} falls on it`)) {
        return { ...result, events: [...(result.events ?? []), fumble(false)] };
      }
      const tackler = (result.events ?? []).find(e => e.type === 'TACKLE');
      const recoverer = tackler && tackler.type === 'TACKLE' ? tackler.playerId : this.pickFrom(this.inRows([1, 2, 3]));
      return {
        ...result, turnover: true, summary: `${result.summary}, fumbled, the defense recovers`,
        events: [...(result.events ?? []), fumble(true), ...(recoverer ? [{ type: 'FUMBLE_RECOVERY' as const, side: this.defense, playerId: recoverer }] : [])],
      };
    }
    // Category 1 for quick and screen passes, category 2 for short and long passes.
    const pen = z.byCategory[this.play === 'QK' || this.play === 'SC' ? 0 : 1];
    const covering = this.covering(this.call.slot)[0];
    const candidates = pen.against === 'O'
      ? Object.values(this.lineup).map(id => this.player(id)).filter((p): p is PlayerCard => !!p)
      : Object.values(this.setup.lineup).flat().map(id => this.defender(id!)).filter((p): p is PlayerCard => !!p);
    const who = choosePenalized(penaltyKind(pen.against, pen.penalty), candidates, this.rng);
    return scrimmagePenalty(pen.against, pen.penalty, this.state, result, this.offense, this.steps,
      who ? { label: `${this.nameOf(who)} (${who.position})`, id: who.id } : null,
      {
        play: this.play, incomplete: result.incomplete,
        coveringDefender: covering ? { label: `${this.nameOf(covering)} (${covering.position})`, id: covering.id } : null,
        runNumber: () => this.flips.next(false).runNumber,
      });
  }
}

