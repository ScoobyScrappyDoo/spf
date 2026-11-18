/**
 * Drives, built from the play events: each team's possessions in order, their plays in broadcast form
 * ("Craig James runs for 5 yards", "Dan Marino to Mark Duper for 12"), net yards, time used and how each ended.
 */
import { StatEvent } from './model/events';
import { GameState, Side } from './model/game';
import { Team } from './model/team';

export type DrivePlayKind = 'run' | 'pass' | 'incomplete' | 'interception' | 'sack' | 'punt' | 'field-goal' | 'penalty' | 'other';

export interface DrivePlay {
  play: number;
  quarter: number;
  clock: number;
  down: number;
  distance: number;
  ballOn: number;
  kind: DrivePlayKind;
  /** Yards gained (negative: lost) on runs, catches and sacks; 0 otherwise. */
  yards: number;
  text: string;
  /** A timeout called on this play: which team, and how many it had left. */
  timeout?: { side: Side; left: number };
}

export type DriveResult =
  | 'Touchdown' | 'Field goal' | 'Missed field goal' | 'Blocked field goal' | 'Punt' | 'Blocked punt' | 'Fumble'
  | 'Interception' | 'Interception, returned for a TD' | 'Safety' | 'Downs' | 'End of half' | 'End of game' | 'In progress';

export interface Drive {
  number: number;
  side: Side;
  possession: number;
  startQuarter: number;
  startClock: number;
  /** From the team's own goal line. */
  startBallOn: number;
  endBallOn: number;
  plays: DrivePlay[];
  yards: number;
  seconds: number;
  result: DriveResult;
}

/** "own 25", "midfield", "opp 34" */
export const spotShort = (ballOn: number) => (ballOn === 50 ? 'midfield' : ballOn < 50 ? `own ${ballOn}` : `opp ${100 - ballOn}`);

const yardsWord = (n: number) => `${n} yard${Math.abs(n) === 1 ? '' : 's'}`;

export function computeDrives(state: GameState, teams: Record<Side, Team>): Drive[] {
  const events = state.events ?? [];
  const name = (side: Side, id: string | null | undefined) => {
    const p = id ? teams[side].players.find(x => x.id === id) : undefined;
    return p ? `${p.firstName} ${p.lastName}` : 'someone';
  };
  const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

  // A drive is the plays from scrimmage one team ran in one possession.
  const snaps = events.filter((e): e is Extract<StatEvent, { type: 'SNAP' }> => e.type === 'SNAP');
  const byPossession = new Map<number, typeof snaps>();
  for (const s of snaps) byPossession.set(s.possession, [...(byPossession.get(s.possession) ?? []), s]);

  const drives: Drive[] = [];
  [...byPossession.entries()].sort((a, b) => a[0] - b[0]).forEach(([possession, list]) => {
    const side = list[0].side;
    const plays = list.map(snap => describe(snap, events.filter(e => e.play === snap.play), side));
    const first = list[0];
    const last = list[list.length - 1];
    const lastEvents = events.filter(e => e.play === last.play);
    drives.push({
      number: drives.length + 1, side, possession,
      startQuarter: first.quarter, startClock: first.clock,
      startBallOn: first.ballOn ?? 0, endBallOn: last.endBallOn ?? last.ballOn ?? 0,
      plays, seconds: list.reduce((a, s) => a + s.seconds, 0),
      yards: (last.endBallOn ?? last.ballOn ?? 0) - (first.ballOn ?? 0),
      result: resultOf(last, lastEvents),
    });
  });

  // Drives with no ending play of their own ended with the clock, or are still going.
  drives.forEach((d, i) => {
    if (d.result !== 'In progress') return;
    const next = drives[i + 1];
    if (!next) d.result = state.phase === 'GAME_OVER' ? 'End of game' : 'In progress';
    else if (d.startQuarter <= 2 && next.startQuarter >= 3) d.result = 'End of half';
  });
  return drives;

  function describe(snap: Extract<StatEvent, { type: 'SNAP' }>, evs: StatEvent[], side: Side): DrivePlay {
    const base = { play: snap.play, quarter: snap.quarter, clock: snap.clock, down: snap.down, distance: snap.distance, ballOn: snap.ballOn ?? 0 };
    const td = evs.some(e => (e.type === 'RUSH' || e.type === 'PASS') && e.touchdown);
    const fumbleLost = evs.some(e => e.type === 'FUMBLE' && e.lost);
    const recovery = evs.find(e => e.type === 'FUMBLE_RECOVERY' && e.side !== side);
    const recoveredBy = recovery && recovery.type === 'FUMBLE_RECOVERY' ? name(recovery.side, recovery.playerId) : 'the defense';
    const penalty = evs.find(e => e.type === 'PENALTY' && e.accepted);
    const flag = penalty && penalty.type === 'PENALTY'
      ? `${penalty.name}${penalty.playerId ? ` on ${name(penalty.side, penalty.playerId)}` : ''}, ${yardsWord(penalty.yards)}` : '';
    const to = evs.find(e => e.type === 'TIMEOUT');
    const timeout = to && to.type === 'TIMEOUT' ? { timeout: { side: to.side, left: to.left } } : timeoutFromLog(state, snap.quarter, snap.clock);
    const finish = (kind: DrivePlayKind, yards: number, text: string): DrivePlay => ({
      ...base, kind, yards, ...timeout,
      text: text + (fumbleLost ? `, fumbled, recovered by ${recoveredBy}` : '') + (td ? '. Touchdown!' : '') + (flag && kind !== 'penalty' ? ` (plus ${flag})` : ''),
    });
    for (const e of evs) {
      if (e.type === 'RUSH') {
        const who = name(side, e.playerId);
        if (e.kneel) return finish('run', -1, `${who} takes a knee`);
        return finish('run', e.yards, e.yards > 0 ? `${who} runs for ${yardsWord(e.yards)}` : e.yards < 0 ? `${who} loses ${yardsWord(-e.yards)}` : `${who}, no gain`);
      }
      if (e.type === 'SACK') return finish('sack', -e.yards, `${name(side, e.playerId)} sacked for a loss of ${e.yards}`);
      if (e.type === 'PASS') {
        const qb = name(side, e.playerId);
        if (e.intercepted) {
          const pick = evs.find(x => x.type === 'INTERCEPTION');
          const by = pick && pick.type === 'INTERCEPTION' ? name(other(side), pick.playerId) : 'the defense';
          return finish('interception', 0, `${qb} intercepted by ${by}${pick && pick.type === 'INTERCEPTION' && pick.touchdown ? ', returned for a touchdown' : ''}`);
        }
        if (!e.complete) return finish('incomplete', 0, `${qb} incomplete${e.targetId ? ` to ${name(side, e.targetId)}` : ''}`);
        return finish('pass', e.yards, `${qb} to ${name(side, e.targetId)} for ${e.yards < 0 ? `a loss of ${-e.yards}` : e.yards}`);
      }
      if (e.type === 'PUNT') {
        const ret = evs.find(x => x.type === 'PUNT_RETURN');
        const how = e.blocked ? ' is blocked' : ` punts ${e.yards} yards${e.touchback ? ', touchback' : e.fairCatch ? ', fair catch' : ''}`;
        const back = ret && ret.type === 'PUNT_RETURN' ? `, returned ${ret.yards} by ${ret.name}${ret.touchdown ? ' for a touchdown' : ''}` : '';
        return finish('punt', 0, `${name(side, e.playerId)}${how}${back}`);
      }
      if (e.type === 'FIELD_GOAL') {
        return finish('field-goal', 0, `${name(side, e.playerId)}, ${e.distance}-yard field goal ${e.good ? 'is good' : e.blocked ? 'is blocked' : 'is no good'}`);
      }
    }
    if (flag) return finish('penalty', 0, `Penalty: ${flag}`);
    return finish('other', 0, 'No play');
  }
}

function resultOf(last: Extract<StatEvent, { type: 'SNAP' }>, evs: StatEvent[]): DriveResult {
  if (evs.some(e => (e.type === 'RUSH' || e.type === 'PASS') && e.touchdown)) return 'Touchdown';
  const pick = evs.find(e => e.type === 'INTERCEPTION');
  if (pick && pick.type === 'INTERCEPTION') return pick.touchdown ? 'Interception, returned for a TD' : 'Interception';
  if (evs.some(e => e.type === 'FUMBLE' && e.lost)) return 'Fumble';
  const fg = evs.find(e => e.type === 'FIELD_GOAL');
  if (fg && fg.type === 'FIELD_GOAL') return fg.good ? 'Field goal' : fg.blocked ? 'Blocked field goal' : 'Missed field goal';
  const punt = evs.find(e => e.type === 'PUNT');
  if (punt && punt.type === 'PUNT') return punt.blocked ? 'Blocked punt' : 'Punt';
  if (evs.some(e => e.type === 'SAFETY')) return 'Safety';
  if (last.down === 4 && last.counted && !last.firstDown) return 'Downs';
  return 'In progress';
}

/**
 * Games played before timeouts were recorded as events have them only in the play's text ("Timeout, Kansas City
 * (away): 2 left in this half." or "... takes a timeout, 2 remaining."): read it from there, so they show too.
 */
function timeoutFromLog(state: GameState, quarter: number, clock: number): { timeout?: { side: Side; left: number } } {
  for (const entry of state.log) {
    if (entry.quarter !== quarter || entry.clock !== clock) continue;
    for (const step of entry.steps) {
      const m = /\((home|away)\)(?:: (\d+) left| takes a timeout, (\d+) remaining)/.exec(step);
      if (m && /timeout/i.test(step)) return { timeout: { side: m[1] as Side, left: Number(m[2] ?? m[3]) } };
    }
  }
  return {};
}
