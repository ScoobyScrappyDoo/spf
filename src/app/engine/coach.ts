/**
 * The computer coach: every decision a human coach makes, from the coin toss to the last play. It reads the situation
 * (down, distance, field position, score and clock), follows a coach's tendencies for it, adds a little unpredictability
 * (seeded, so a replay makes the same calls) and leans on his team's strengths. Used for simulated games and, later,
 * for solitaire.
 */
import { DefenseLineup, buildDefenseLineup, defenseFormationForTeam, replaceDefender } from './defense-lineup';
import { fieldGoalBlockedReason, fieldGoalDistance, goodRange, kickerOf } from './fieldgoal';
import { delayOfGameBlocked, delayRunoff } from './punt';
import { GameContext } from './game';
import { bestQuarterback, injuredIds, qbEnduranceReason, suggestDefense, suggestOffense } from './injuries';
import { buildLineup, formationForStarters, Lineup, placePlayer } from './lineup';
import { isPassPlay, OffensePlay } from './model/calls';
import { DEFENSE_FORMATIONS, DefenseCall, DefenseFormationId, DefensiveBox, getDefenseFormation } from './model/defense';
import { bigPlayBlocked, coverageAllowed } from './defense-strategy';
import { receiverRoles } from './pass';
import { FORMATIONS, FormationId, getFormation, OffenseSlot, selectableSlots, SLOT_GROUP } from './model/formations';
import { DefenseSetup, GameState, otherSide, PlayOutcome, PuntCall, ReceiverPosition, Side } from './model/game';
import { isSkillPlayer, PlayerCard } from './model/players';
import { Team } from './model/team';
import { SeededRandom } from './random';
import { enduranceContext } from './endurance';
import { OffenseCall, playOptions, strategyOptions } from './selection';
import { inFinalMinutes } from './timing';
import { boxNudge, chooseCoverageTarget, chooseRunKey, coverageFactor, personnelNudge, runSideFactor, SeenDefense } from './reading';

/** What the offense does on the coming snap. */
export type OffenseDecision =
  | { kind: 'play'; call: OffenseCall; lineup: Lineup; twoMinute: boolean; timeout: boolean }
  | { kind: 'punt'; punt: PuntCall }
  | { kind: 'field-goal' };

/** The game as a coach sees it before the snap. */
export interface Situation {
  down: number;
  distance: number;
  /** From the offense's own goal line. */
  ballOn: number;
  /** The offense's score minus the defense's. */
  lead: number;
  quarter: number;
  clock: number;
  /** Seconds left in the game (or in the half, for end-of-half thinking). */
  gameLeft: number;
  halfLeft: number;
  goalToGo: boolean;
}

export function situation(state: GameState): Situation {
  const offense = state.possession!;
  const lead = state.score[offense] - state.score[otherSide(offense)];
  const ballOn = state.ballOn ?? 25;
  const halfLeft = (state.quarter % 2 === 1 ? 900 : 0) + state.clock;
  return {
    down: state.down, distance: state.distance, ballOn, lead, quarter: state.quarter, clock: state.clock,
    gameLeft: (4 - Math.min(4, state.quarter)) * 900 + state.clock, halfLeft, goalToGo: ballOn + state.distance >= 100,
  };
}

/** The coach's dice: seeded from the game, so the same game makes the same decisions. */
export function coachRandom(state: GameState, salt: number): SeededRandom {
  return new SeededRandom(((state.rngState ?? 1) ^ Math.imul((state.playIndex ?? 0) + 1, 2654435761) ^ salt) >>> 0);
}

/**
 * How likely the offense is to run, 0-1. The tendencies of an 80s coach: run on 1st down and short yardage,
 * pass on long yardage; protect a lead late on the ground; throw when behind with time running out.
 */
export function runChance(s: Situation): number {
  let p = s.down === 1 ? 0.55 : s.down === 2 ? (s.distance <= 3 ? 0.65 : s.distance >= 8 ? 0.35 : 0.5) : s.distance <= 2 ? 0.6 : s.distance <= 5 ? 0.3 : 0.12;
  if (s.goalToGo && s.ballOn >= 95) p = Math.max(p, 0.6);
  const late = s.gameLeft <= 300;
  if (late && s.lead > 0) p += 0.25; // run the clock
  if (s.lead >= 17 && s.quarter >= 4 && s.gameLeft <= 420) p = Math.max(p, 0.9); // a big lead late: keep it on the ground
  if (late && s.lead < 0) p -= 0.3; // need points quickly
  if (s.quarter === 2 && s.halfLeft <= 120 && s.ballOn < 70) p -= 0.2; // end-of-half drive
  return Math.max(0.03, Math.min(0.92, p));
}

const pickWeighted = <T>(rng: SeededRandom, items: [T, number][]): T => {
  const total = items.reduce((a, [, w]) => a + Math.max(0, w), 0);
  let roll = rng.next() * total;
  for (const [item, w] of items) {
    roll -= Math.max(0, w);
    if (roll <= 0) return item;
  }
  return items[items.length - 1][0];
};

// -----------------------------------------------------------------------------------------------
// The toss, kickoffs and penalties
// -----------------------------------------------------------------------------------------------

export function chooseOnside(state: GameState): boolean {
  const kicking = state.kickoff?.kicking;
  if (!kicking) return false;
  const lead = state.score[kicking] - state.score[otherSide(kicking)];
  const gameLeft = (4 - Math.min(4, state.quarter)) * 900 + state.clock;
  return state.quarter >= 4 && gameLeft <= 180 && lead < 0 && lead >= -16;
}

/** A squib kick (rule O3) to protect a late lead from a long return. */
export function chooseSquib(state: GameState): boolean {
  const kicking = state.kickoff?.kicking;
  if (!kicking) return false;
  const lead = state.score[kicking] - state.score[otherSide(kicking)];
  const halfLeft = (state.quarter % 2 === 1 ? 900 : 0) + state.clock;
  return lead > 0 && lead <= 8 && (state.quarter === 2 || state.quarter >= 4) && halfLeft <= 180;
}

/** The receiving team lines up for the onside kick (rule O2) when the kicking team is behind late. */
export function expectOnside(state: GameState): boolean {
  return chooseOnside(state);
}

/** A fake punt or field goal (rule O6): rarely, on 4th and short around midfield. */
export function chooseFake(state: GameState, kind: 'punt' | 'field-goal'): boolean {
  const s = situation(state);
  const rng = coachRandom(state, 0xfa4e);
  if (s.down !== 4 || s.distance > 3) return false;
  return kind === 'punt' ? s.ballOn >= 35 && s.ballOn <= 60 && rng.next() < 0.1 : rng.next() < 0.04;
}

/** Accept or decline a penalty: whichever outcome is better for the coach choosing. */
export function acceptPenalty(state: GameState): boolean {
  const p = state.pendingPenalty!;
  return value(state, p.accept, p.chooser) >= value(state, p.decline, p.chooser);
}

/** A rough worth of an outcome for one side: field position, first downs and points. */
function value(state: GameState, o: PlayOutcome, side: Side): number {
  const offense = state.possession;
  switch (o.kind) {
    case 'SCRIMMAGE': {
      let v = o.newBallOn - (state.ballOn ?? 0);
      if (o.turnover) v -= 60;
      if (o.defensiveTouchdown) v -= 100;
      if (o.newBallOn >= 100 && !o.turnover) v += 100;
      if (o.autoFirstDown || (!o.turnover && o.newBallOn >= (state.ballOn ?? 0) + state.distance)) v += 12;
      if (o.countsAsDown && !o.autoFirstDown && o.newBallOn < (state.ballOn ?? 0) + state.distance) v -= 6;
      return side === offense ? v : -v;
    }
    case 'BALL':
      return o.possession === side ? o.ballOn : -o.ballOn;
    case 'TOUCHDOWN':
      return o.scorer === side ? 100 : -100;
    case 'REKICK':
      return 0;
    case 'PUNT': {
      const kicking = offense!;
      const r = o.result;
      const v = r.type === 'TOUCHDOWN' ? (r.scorer === kicking ? 100 : -100)
        : r.type === 'KICKING_TEAM' ? (r.firstDown ? 40 : 15) + (r.ballOn - (state.ballOn ?? 0))
        : -(r.spot);
      return side === kicking ? v : -v;
    }
    case 'FIELD_GOAL': {
      const kicking = offense!;
      const r = o.result;
      const v = r.type === 'GOOD' ? 30 : r.type === 'BLOCKED' ? -100 : r.type === 'MISSED' ? -r.spot / 2 : (r.firstDown ? 45 : 20);
      return side === kicking ? v : -v;
    }
  }
}

// -----------------------------------------------------------------------------------------------
// Offense
// -----------------------------------------------------------------------------------------------

/** Field goal, punt or go for it on 4th down; a field goal on any down when the half is running out. */
export function kickingDecision(state: GameState, team: Team): OffenseDecision | null {
  const s = situation(state);
  const fgBlocked = fieldGoalBlockedReason(state);
  const range = !fgBlocked ? goodRange(kickerOf(team), fieldGoalDistance(s.ballOn)) : null;
  const fgChance = range ? range.to / 48 : 0;
  const lastSeconds = (s.quarter === 2 || s.quarter >= 4) && s.clock <= 20;
  if (lastSeconds && range && (s.quarter === 2 || (s.lead >= -3 && s.lead <= 0))) return { kind: 'field-goal' };
  if (s.down !== 4) return null;
  const late = s.gameLeft <= 240;
  const needTouchdown = late && s.lead < -3;
  // Go for it: a yard or less in the opponent's half, or when the game says so.
  if ((s.distance <= 1 && s.ballOn >= 50 && !(range && fgChance >= 0.5 && s.ballOn < 95)) || (late && s.lead < 0 && !(range && s.lead >= -3))) {
    return null;
  }
  if (range && fgChance >= 0.4 && !needTouchdown) return { kind: 'field-goal' };
  if (needTouchdown && s.ballOn > 40) return null;
  // Punt, with a coffin corner from around midfield where a touchback is likely.
  const coffin = s.ballOn >= 55 && s.ballOn <= 68 ? (s.ballOn >= 62 ? 20 : 15) : null;
  return { kind: 'punt', punt: { coffinCorner: coffin } };
}

const RUNS: OffensePlay[] = ['IL', 'IR', 'SL', 'SR'];

/**
 * fixed: the formation and players already shown (the computer lined up first and now calls its play); seen: the
 * defense's formation and players across the line (not its call), read as in reading.ts.
 */
export function chooseOffense(
  state: GameState, ctx: GameContext, previous: Lineup = {}, fixed?: { formationId: FormationId; lineup: Lineup }, seen?: SeenDefense,
): OffenseDecision {
  const side = state.possession!;
  const team = ctx.teams[side];
  const kick = kickingDecision(state, team);
  if (kick) return kick;
  const s = situation(state);
  const rng = coachRandom(state, 0x0ff);
  // Victory formation: leading, and the downs left can run out the clock (rule 7.1.2.2, the quarterback flop).
  // Also with a lead of more than one score in the last two minutes: no risk, the clock keeps running, and 4th down
  // brings the field goal or the punt.
  const kneel = s.lead > 0 && s.down < 4 && ((s.quarter >= 4 && s.gameLeft <= (4 - s.down) * 40) || (s.quarter === 2 && s.halfLeft <= 30 && s.ballOn < 60)
    || (s.quarter >= 4 && s.lead > 8 && s.gameLeft <= 120));
  if (kneel) {
    const formationId = fixed?.formationId ?? formationForStarters(team);
    const lineup = fixed?.lineup ?? freshLineup(state, team, side, formationId, previous) ?? buildLineup(team, getFormation(formationId), previous);
    if (strategyOptions('QB', 'IL').some(o => o.value === 'QB_FLOP' && o.enabled)) {
      return { kind: 'play', call: { formationId, slot: 'QB', play: 'IL', strategy: 'QB_FLOP', extraBlockers: [] }, lineup, twoMinute: false, timeout: false };
    }
  }
  // The two-minute drill in the final minutes; with the house rule, the no-huddle too when well behind in the second half.
  const twoMinute = (inFinalMinutes(state) && (s.lead <= 0 || s.quarter === 2) && !(s.lead > 0 && s.quarter >= 4))
    || (!!state.rules?.noHuddleAnyTime && s.quarter >= 3 && s.lead <= -9);
  // A light box in view makes a run more attractive, a heavy one a pass (reading.ts).
  const run = rng.next() < Math.min(0.95, Math.max(0.05, runChance(s) + (seen ? boxNudge(state, seen) : 0)));

  // Formation: heavy for short yardage runs, spread for long passes, otherwise the team's own.
  const own = formationForStarters(team);
  let formationId: FormationId = fixed ? fixed.formationId : run
    ? s.distance <= 2 || (s.goalToGo && s.ballOn >= 95) ? pickWeighted(rng, [['run-3rb-2te' as FormationId, 2], ['2rb-2te-fl-left' as FormationId, 1], [own, 1]]) : own
    : s.distance >= 10 || twoMinute ? pickWeighted(rng, [['pass-3wr-te-left' as FormationId, 2], ['pass-4wr' as FormationId, 1], [own, 1]]) : own;
  // Like a human coach: if injuries leave a hole nobody on the bench can fill, pick a formation he can field.
  let lineup = fixed ? fixed.lineup : freshLineup(state, team, side, formationId, previous);
  if (!lineup) {
    for (const f of [own, ...FORMATIONS.map(x => x.id)]) {
      lineup = freshLineup(state, team, side, f, previous);
      if (lineup) { formationId = f; break; }
    }
  }
  if (!lineup) lineup = buildLineup(team, getFormation(formationId), previous); // nothing fits: the engine will say why
  const ctxCall = { ballOn: s.ballOn, ...enduranceContext(state) };
  const player = (slot: OffenseSlot) => team.players.find(p => p.id === lineup[slot]);
  const slots = selectableSlots(getFormation(formationId));
  const options = slots.flatMap(slot => playOptions(slot, player(slot), ctxCall).filter(o => o.enabled).map(o => ({ slot, play: o.value })));

  let choice: { slot: OffenseSlot; play: OffensePlay } | undefined;
  if (run) {
    // A run goes to a back. If none may carry this play (they must rest, rule 4.6), a real coach passes rather than
    // hand it to his quarterback or a receiver; the sneak on a yard or less is the one quarterback run kept as a call,
    // plus the odd keeper (rarer for a quarterback who can't run).
    const backsFree = options.some(o => RUNS.includes(o.play) && SLOT_GROUP[o.slot] === 'back');
    const runs = options.filter(o => RUNS.includes(o.play) && (SLOT_GROUP[o.slot] === 'back' || (backsFree && o.slot === 'QB')));
    // The best rested back gets most carries; inside on short yardage, outside more often on long.
    const weight = (o: { slot: OffenseSlot; play: OffensePlay }) => {
      const p = player(o.slot);
      const avg = p && isSkillPlayer(p) && p.rushing ? p.rushing.slice(1, 7).reduce((a, r) => a + (typeof r.n === 'number' ? r.n : 0), 0) / 6 : 1;
      const back = SLOT_GROUP[o.slot] === 'back' ? 3 : o.slot === 'QB' ? 0.02 : 0;
      const inside = o.play === 'IL' || o.play === 'IR';
      const dir = s.distance <= 2 ? (inside ? 3 : 1) : inside ? 1.5 : 1;
      const side = seen ? runSideFactor(state, ctx.teams[otherSide(state.possession!)], seen, o.play) : 1; // towards weaker tacklers
      return Math.max(0.1, avg) * back * dir * side;
    };
    if (runs.length) choice = pickWeighted(rng, runs.map(o => [o, weight(o)] as [typeof o, number]));
  }
  if (!choice) {
    // Mostly short and quick, as 80s offenses threw; the long ball for long yardage and the two-minute drill.
    const wanted: OffensePlay[] = s.distance <= 4 ? ['QK', 'QK', 'QK', 'SH', 'SC'] : s.distance <= 10 ? ['SH', 'SH', 'QK', 'QK', 'LG', 'SC']
      : twoMinute && s.lead < 0 ? ['LG', 'SH', 'SH', 'QK'] : ['SH', 'SH', 'LG', 'QK', 'QK'];
    const type = wanted[rng.int(wanted.length)];
    let passes = options.filter(o => o.play === type);
    if (!passes.length) passes = options.filter(o => isPassPlay(o.play));
    // Receivers are thrown to more than backs; better pass catchers (bigger short gains) more again.
    const weight = (o: { slot: OffenseSlot; play: OffensePlay }) => {
      const p = player(o.slot);
      const g = SLOT_GROUP[o.slot];
      const base = g === 'flanker' || g === 'end' ? 3 : 1;
      const gain = p && isSkillPlayer(p) && p.passGain ? p.passGain.slice(1, 6).reduce((a, r) => a + (typeof r.s === 'number' ? r.s : typeof r.q === 'number' ? r.q : 0), 0) / 5 : 3;
      const cover = seen ? coverageFactor(state, ctx.teams[otherSide(state.possession!)], seen, formationId, o.slot) : 1; // weaker cover
      return base * Math.max(1, gain) * cover;
    };
    if (passes.length) choice = pickWeighted(rng, passes.map(o => [o, weight(o)] as [typeof o, number]));
  }
  if (!choice) choice = options[0] ?? { slot: 'QB', play: 'IL' };

  // Strategies: a draw now and then on passing downs, play action after establishing the run, the QB sneak on a yard.
  let strategy: OffenseCall['strategy'] = 'NONE';
  const allowed = new Set(strategyOptions(choice.slot, choice.play).filter(o => o.enabled).map(o => o.value));
  if (allowed.has('QB_SNEAK') && choice.slot === 'QB' && s.distance <= 1) strategy = 'QB_SNEAK';
  else if (allowed.has('DRAW') && s.distance >= 6 && rng.next() < 0.3) strategy = 'DRAW';
  else if (allowed.has('PLAY_ACTION') && s.down <= 2 && rng.next() < 0.25) strategy = 'PLAY_ACTION';
  const call: OffenseCall = { formationId, slot: choice.slot, play: choice.play, strategy, extraBlockers: [] };
  return { kind: 'play', call, lineup, twoMinute, timeout: offenseTimeout(state, s, choice.play) };
}

/** The formation's lineup, keeping players where possible, with injured players replaced; null if one can't be. */
function freshLineup(state: GameState, team: Team, side: Side, formationId: FormationId, previous: Lineup): Lineup | null {
  let lineup = buildLineup(team, getFormation(formationId), previous);
  // Rule 4.5: the quarterback the endurance rule wants (the starter back from injury, say).
  const qb = team.players.find(p => p.id === lineup.QB);
  if (qbEnduranceReason(state, side, team, qb)) {
    const best = bestQuarterback(state, side, team);
    if (best) lineup = placePlayer(lineup, 'QB', best, team);
  }
  const hurt = injuredIds(state, side);
  for (const [slot, id] of Object.entries(lineup) as [OffenseSlot, string | undefined][]) {
    if (id && hurt.has(id)) {
      const sub = suggestOffense(state, side, team, lineup, slot);
      if (!sub) return null;
      lineup = placePlayer(lineup, slot, sub, team);
    }
  }
  return lineup;
}

/**
 * Timeouts (rule 9.2): a coach saves them for when the clock matters, and spends one on a play likely to keep it running
 * (a run or a short pass); a long pass, often incomplete, stops it anyway.
 */
function offenseTimeout(state: GameState, s: Situation, play: OffensePlay): boolean {
  if ((state.timeouts?.[state.possession!] ?? 0) <= 0 || play === 'LG') return false;
  const endOfGame = s.quarter >= 4 && s.gameLeft <= 150 && s.lead <= 0;
  const endOfHalf = s.quarter === 2 && s.halfLeft <= 75 && s.ballOn >= 40;
  return endOfGame || endOfHalf;
}

/** Ask for a delay of game before this punt (rule 8.5.3)? To burn clock with a lead late, or for room near midfield. */
export function wantDelayOfGame(state: GameState): boolean {
  if (delayOfGameBlocked(state)) return false;
  const s = situation(state);
  const burnClock = s.lead > 0 && s.quarter >= 4 && s.gameLeft <= 300 && delayRunoff(state) >= 10;
  const room = s.ballOn >= 58 && s.ballOn <= 66;
  return burnClock || room;
}

/** The receiving team accepts a delay of game unless it's behind late and the clock matters more than 5 yards. */
export function acceptDelayOfGame(state: GameState): boolean {
  const s = situation(state); // from the kicking team's view
  return !(s.lead > 0 && s.quarter >= 4 && s.gameLeft <= 360);
}

// -----------------------------------------------------------------------------------------------
// Defense
// -----------------------------------------------------------------------------------------------

/** What the defense can see before the snap: the offense's formation and who's in it (both displays are open). */
export interface OffenseLook {
  formationId: FormationId;
  lineup: Lineup;
}

export function chooseDefense(state: GameState, ctx: GameContext, previous: DefenseLineup = {}, look?: OffenseLook): DefenseSetup {
  const offense = state.possession!;
  const side = otherSide(offense);
  const team = ctx.teams[side];
  const s = situation(state);
  const rng = coachRandom(state, 0xdef);
  // The situation sets the run/pass guess; the offense's personnel in view nudges it (reading.ts).
  const runLikely = Math.min(0.95, Math.max(0.05, runChance(s) + (look ? personnelNudge(state, look) : 0)));
  const preventTime = (s.quarter === 2 || s.quarter >= 4) && s.clock <= 90 && (s.quarter === 2 || -s.lead > 0 ? true : false);

  // Formation: a heavy front for short yardage, extra backs for long yardage and prevent, otherwise the team's own.
  const own = defenseFormationForTeam(team);
  let formationId: DefenseFormationId = own;
  // Rule 8.7: against a no-huddle with the clock running, keep the players and formation unless the offense changed.
  const lock = state.noHuddleLock;
  const locked = !!lock?.offenseIds && lock.side === offense && lock.play === (state.playIndex ?? 0) && !!look
    && Object.values(look.lineup).filter(Boolean).sort().join(',') === [...lock.offenseIds].sort().join(',');
  if (s.distance <= 2 || (s.goalToGo && s.ballOn >= 95)) formationId = pickWeighted(rng, [['dl5-lb2-db4-gi' as DefenseFormationId, 2], ['dl4-lb3-db4-ghi' as DefenseFormationId, 1], [own, 1]]);
  else if ((s.down >= 3 && s.distance >= 8) || preventTime) formationId = pickWeighted(rng, [['dl3-lb2-db6-ace' as DefenseFormationId, 1], ['dl4-lb1-db6' as DefenseFormationId, 1], ['dl5-lb1-db5' as DefenseFormationId, 1]]);
  if (!DEFENSE_FORMATIONS.some(f => f.id === formationId)) formationId = own;

  if (locked) formationId = lock!.defenseFormation as DefenseFormationId;
  let lineup = locked ? (lock!.defenseLineup as DefenseLineup) : buildDefenseLineup(team, getDefenseFormation(formationId), previous);
  const hurt = injuredIds(state, side);
  for (const [box, ids] of Object.entries(lineup)) {
    (ids ?? []).forEach((id, index) => {
      if (id && hurt.has(id)) {
        const role = getDefenseFormation(formationId).slots.find(sl => sl.box === box)?.role ?? 'DB';
        const sub = suggestDefense(state, side, team, lineup, box as never, role);
        if (sub) lineup = replaceDefender(lineup, box as never, index, sub);
      }
    });
  }

  // The call: guess run or pass the way the offense thinks; key the back most likely to carry.
  let call: DefenseCall;
  const leadingLate = s.lead < 0 && s.gameLeft <= 120; // the offense trails: we lead
  if (preventTime && (leadingLate || s.quarter === 2) && s.ballOn < 75) call = 'PREVENT';
  else if (rng.next() < runLikely) {
    if (look) {
      // Key the back most likely to hurt, weighted, never one who may not carry this play (reading.ts).
      call = chooseRunKey(state, ctx.teams[offense], look, rng);
    } else {
      const backs = (['RB1', 'RB2', 'RB3'] as const).filter((_, i) => i === 0 || rng.next() < 0.25);
      call = rng.next() < 0.35 ? 'RUN_NO_KEY' : (`RUN_KEY_BK${backs.length > 1 && rng.next() < 0.3 ? 2 : 1}` as DefenseCall);
    }
  } else {
    call = s.down >= 3 && s.distance >= 4 && s.distance <= 9 && rng.next() < 0.25 ? 'BLITZ' : 'PASS';
  }
  // Against a kick: now and then expect a fake (rule O6), more on 4th and short; then no all-out rush.
  const expectFake = (!!state.puntCall || !!state.fieldGoalCall) && rng.next() < (s.distance <= 3 ? 0.25 : 0.04);
  const allOutRush = !!state.puntCall && !expectFake && s.ballOn <= 20 && rng.next() < 0.35;
  // Trailing late: stop the clock after likely runs, to get the ball back with time to use it.
  const timeout = (state.timeouts?.[side] ?? 0) > 0 && s.quarter >= 4 && s.gameLeft <= 180 && s.lead > 0 && s.lead <= 16 && runLikely >= 0.5 && !state.puntCall && !state.fieldGoalCall;
  const setup: DefenseSetup = { formationId, lineup, call, allOutRush, timeout, ...(expectFake ? { expectFake } : {}) };

  // Blitzers: the solitaire packages (rule S4.8), with their odds: F and J, F, J and M, or all of F to J.
  if (call === 'BLITZ') {
    const roll = rng.int(48) + 1;
    const boxes: DefensiveBox[] = roll <= 26 ? ['F', 'J'] : roll <= 35 ? ['F', 'J', 'M'] : ['F', 'G', 'H', 'I', 'J'];
    const ids = boxes.flatMap(b => lineup[b] ?? []);
    if (ids.length) setup.blitzers = ids;
  }

  // Coverage on passing downs: double the most dangerous receiver in view, now and then two, or triple from the 3-2-6.
  const allowed = coverageAllowed(setup);
  if (look && allowed.double && runLikely < 0.5 && rng.next() < 0.45) {
    const offenseTeam = ctx.teams[offense];
    const threat = (id: string | undefined) => {
      const p = offenseTeam.players.find(x => x.id === id);
      return p && isSkillPlayer(p) && p.passGain ? p.passGain.slice(1, 6).reduce((a, r) => a + (typeof r.s === 'number' ? r.s : 0), 0) : 0;
    };
    const targets = [...receiverRoles(getFormation(look.formationId)).entries()]
      .map(([slot, role]) => ({ receiver: role as ReceiverPosition, threat: threat(look.lineup[slot]) }))
      .sort((a, b) => b.threat - a.threat);
    // The first one doubled: the most dangerous more often, weighted (reading.ts), not always.
    const first = chooseCoverageTarget<ReceiverPosition>(state, offenseTeam, look, rng);
    if (first) targets.sort((a, b) => (b.receiver === first ? 1 : 0) - (a.receiver === first ? 1 : 0));
    if (targets.length) {
      if (allowed.triple && rng.next() < 0.4) setup.coverage = [{ receiver: targets[0].receiver, level: 'TRIPLE' }];
      else setup.coverage = targets.slice(0, targets.length > 1 && rng.next() < 0.35 ? 2 : 1).map(t => ({ receiver: t.receiver, level: 'DOUBLE' as const }));
    }
  }

  // A big play when it matters: 3rd and 4th downs in our half, the goal line, and close games late.
  if (!bigPlayBlocked(state, side, team) && !state.puntCall && !state.fieldGoalCall) {
    const key = (s.down >= 3 && s.ballOn >= 50) || s.ballOn >= 92 || (s.gameLeft <= 300 && Math.abs(s.lead) <= 8 && s.down >= 2);
    if (key && rng.next() < 0.35) setup.bigPlay = true;
  }
  return setup;
}
