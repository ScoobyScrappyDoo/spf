/**
 * Team and individual stats, worked out from the play events (never kept as running totals).
 * Team stats follow an nfl.com box score; individual stats are grouped by what the player did.
 */
import { StatEvent } from './model/events';
import { GameState, Side } from './model/game';
import { PlayerCard, Position } from './model/players';
import { Team } from './model/team';

export interface TeamStats {
  points: number;
  firstDowns: number;
  firstDownsRushing: number;
  firstDownsPassing: number;
  firstDownsPenalty: number;
  thirdDowns: { made: number; att: number };
  fourthDowns: { made: number; att: number };
  plays: number;
  totalYards: number;
  rushing: { att: number; yards: number };
  /** Gross yards, sacks and the yards they lost, and net = gross - sack yards (as a box score counts it). */
  passing: { comp: number; att: number; yards: number; sacks: number; sackYards: number; net: number; interceptions: number };
  penalties: { count: number; yards: number };
  fumbles: { count: number; lost: number };
  turnovers: number;
  kickReturns: { count: number; yards: number };
  punts: { count: number; yards: number };
  puntReturns: { count: number; yards: number };
  /** Seconds the offense had the ball (scrimmage plays). */
  timeOfPossession: number;
  /** Pressures this team's defense put on the other quarterback (pass rush plays, rule 8.3.6). */
  pressures: number;
}

export interface PlayerStats {
  playerId: string;
  name: string;
  position: Position | '';
  /** twentyPlus: runs of 20 yards or more. */
  rushing?: { att: number; yards: number; long: number; td: number; twentyPlus: number };
  passing?: { comp: number; att: number; yards: number; td: number; interceptions: number; sacks: number; sackYards: number; long: number };
  /** yac: yards after the catch (see yardsAfterCatch). */
  receiving?: { rec: number; yards: number; long: number; td: number; targets: number; yac: number };
  /** intYards: interception return yards; td: defensive touchdowns (interception returns). */
  tackles?: { solo: number; assists: number; fumbleRecoveries: number; sacks?: number; interceptions?: number; intYards?: number; td?: number; pressures?: number };
  kickReturns?: { count: number; yards: number; long: number; td: number };
  punting?: { count: number; yards: number; long: number; inside20: number; touchbacks: number; blocked: number };
  puntReturns?: { count: number; yards: number; long: number; td: number };
  extraPoints?: { made: number; att: number };
  fieldGoals?: { made: number; att: number; long: number; blocked: number };
  fumbles?: { count: number; lost: number };
  penalties?: { count: number; yards: number };
}

export interface GameStats {
  teams: Record<Side, TeamStats>;
  players: Record<Side, PlayerStats[]>;
}

const POSITION_ORDER: (Position | '')[] = ['QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'DB', 'K', 'P', ''];

function emptyTeam(points: number): TeamStats {
  return {
    points, pressures: 0, firstDowns: 0, firstDownsRushing: 0, firstDownsPassing: 0, firstDownsPenalty: 0, thirdDowns: { made: 0, att: 0 }, fourthDowns: { made: 0, att: 0 },
    plays: 0, totalYards: 0, rushing: { att: 0, yards: 0 },
    passing: { comp: 0, att: 0, yards: 0, sacks: 0, sackYards: 0, net: 0, interceptions: 0 }, penalties: { count: 0, yards: 0 }, fumbles: { count: 0, lost: 0 },
    turnovers: 0, kickReturns: { count: 0, yards: 0 }, punts: { count: 0, yards: 0 }, puntReturns: { count: 0, yards: 0 }, timeOfPossession: 0,
  };
}

export function computeStats(state: GameState, teams: Record<Side, Team>): GameStats {
  const events: StatEvent[] = state.events ?? [];
  const team: Record<Side, TeamStats> = { home: emptyTeam(state.score.home), away: emptyTeam(state.score.away) };
  const lines: Record<Side, Map<string, PlayerStats>> = { home: new Map(), away: new Map() };

  const line = (side: Side, playerId: string, fallbackName = ''): PlayerStats => {
    let l = lines[side].get(playerId);
    if (!l) {
      const p: PlayerCard | undefined = teams[side].players.find(x => x.id === playerId);
      l = { playerId, name: p ? `${p.firstName} ${p.lastName}` : fallbackName, position: p?.position ?? '' };
      lines[side].set(playerId, l);
    }
    return l;
  };

  // Which plays had a counted carry or catch, to tell rushing, passing and penalty first downs apart.
  const rushPlays = new Set(events.filter(e => e.type === 'RUSH').map(e => `${e.play}`));
  const passPlays = new Set(events.filter(e => e.type === 'PASS' && e.complete).map(e => `${e.play}`));
  const defense = (l: PlayerStats) => (l.tackles ??= { solo: 0, assists: 0, fumbleRecoveries: 0 });

  for (const e of events) {
    const t = team[e.side];
    switch (e.type) {
      case 'SNAP': {
        t.timeOfPossession += e.seconds;
        if (e.firstDown) {
          t.firstDowns++;
          if (rushPlays.has(`${e.play}`)) t.firstDownsRushing++;
          else if (passPlays.has(`${e.play}`)) t.firstDownsPassing++;
          else t.firstDownsPenalty++;
        }
        if (e.counted && e.down === 3) { t.thirdDowns.att++; if (e.firstDown) t.thirdDowns.made++; }
        if (e.counted && e.down === 4) { t.fourthDowns.att++; if (e.firstDown) t.fourthDowns.made++; }
        break;
      }
      case 'RUSH': {
        t.plays++;
        t.rushing.att++;
        t.rushing.yards += e.yards;
        t.totalYards += e.yards;
        const l = line(e.side, e.playerId);
        l.rushing ??= { att: 0, yards: 0, long: 0, td: 0, twentyPlus: 0 };
        l.rushing.att++;
        if (e.yards >= 20) l.rushing.twentyPlus++;
        l.rushing.yards += e.yards;
        l.rushing.long = l.rushing.att === 1 ? e.yards : Math.max(l.rushing.long, e.yards);
        if (e.touchdown) l.rushing.td++;
        break;
      }
      case 'PASS': {
        t.plays++;
        t.passing.att++;
        const qb = line(e.side, e.playerId);
        qb.passing ??= { comp: 0, att: 0, yards: 0, td: 0, interceptions: 0, sacks: 0, sackYards: 0, long: 0 };
        qb.passing.att++;
        if (e.targetId) {
          const r = line(e.side, e.targetId);
          r.receiving ??= { rec: 0, yards: 0, long: 0, td: 0, targets: 0, yac: 0 };
          r.receiving.targets++;
          if (e.complete) {
            r.receiving.rec++;
            r.receiving.yards += e.yards;
            r.receiving.yac += yardsAfterCatch(e);
            r.receiving.long = r.receiving.rec === 1 ? e.yards : Math.max(r.receiving.long, e.yards);
            if (e.touchdown) r.receiving.td++;
          }
        }
        if (e.complete) {
          t.passing.comp++;
          t.passing.yards += e.yards;
          t.passing.net += e.yards;
          t.totalYards += e.yards;
          qb.passing.comp++;
          qb.passing.yards += e.yards;
          qb.passing.long = Math.max(qb.passing.long, e.yards);
          if (e.touchdown) qb.passing.td++;
        }
        if (e.intercepted) {
          t.passing.interceptions++;
          t.turnovers++;
          qb.passing.interceptions++;
        }
        break;
      }
      case 'PRESSURE': {
        team[e.side].pressures++;
        const l = defense(line(e.side, e.playerId));
        l.pressures = (l.pressures ?? 0) + 1;
        break;
      }
      case 'SACK': {
        t.plays++;
        t.passing.sacks++;
        t.passing.sackYards += e.yards;
        t.passing.net -= e.yards;
        t.totalYards -= e.yards;
        const qb = line(e.side, e.playerId);
        qb.passing ??= { comp: 0, att: 0, yards: 0, td: 0, interceptions: 0, sacks: 0, sackYards: 0, long: 0 };
        qb.passing.sacks++;
        qb.passing.sackYards += e.yards;
        if (e.byId) {
          const d = defense(line(e.side === 'home' ? 'away' : 'home', e.byId));
          d.sacks = (d.sacks ?? 0) + 1;
        }
        break;
      }
      case 'INTERCEPTION': {
        const d = defense(line(e.side, e.playerId));
        d.interceptions = (d.interceptions ?? 0) + 1;
        d.intYards = (d.intYards ?? 0) + e.returnYards;
        if (e.touchdown) d.td = (d.td ?? 0) + 1;
        break;
      }
      case 'TACKLE': {
        const l = line(e.side, e.playerId);
        l.tackles ??= { solo: 0, assists: 0, fumbleRecoveries: 0 };
        if (e.assisted) l.tackles.assists++;
        else l.tackles.solo++;
        break;
      }
      case 'FUMBLE': {
        t.fumbles.count++;
        if (e.lost) { t.fumbles.lost++; t.turnovers++; }
        const l = line(e.side, e.playerId);
        l.fumbles ??= { count: 0, lost: 0 };
        l.fumbles.count++;
        if (e.lost) l.fumbles.lost++;
        break;
      }
      case 'FUMBLE_RECOVERY': {
        const l = line(e.side, e.playerId);
        l.tackles ??= { solo: 0, assists: 0, fumbleRecoveries: 0 };
        l.tackles.fumbleRecoveries++;
        break;
      }
      case 'PENALTY': {
        if (!e.accepted) break; // declined penalties don't count, as in a real box score
        t.penalties.count++;
        t.penalties.yards += e.yards;
        if (e.playerId) {
          const l = line(e.side, e.playerId);
          l.penalties ??= { count: 0, yards: 0 };
          l.penalties.count++;
          l.penalties.yards += e.yards;
        }
        break;
      }
      case 'KICK_RETURN': {
        t.kickReturns.count++;
        t.kickReturns.yards += e.yards;
        const l = line(e.side, e.playerId ?? `return:${e.name}`, e.name);
        l.kickReturns ??= { count: 0, yards: 0, long: 0, td: 0 };
        l.kickReturns.count++;
        l.kickReturns.yards += e.yards;
        l.kickReturns.long = l.kickReturns.count === 1 ? e.yards : Math.max(l.kickReturns.long, e.yards);
        if (e.touchdown) l.kickReturns.td++;
        break;
      }
      case 'PUNT': {
        t.punts.count++;
        t.punts.yards += e.yards;
        if (!e.playerId) break;
        const l = line(e.side, e.playerId);
        l.punting ??= { count: 0, yards: 0, long: 0, inside20: 0, touchbacks: 0, blocked: 0 };
        l.punting.count++;
        l.punting.yards += e.yards;
        l.punting.long = Math.max(l.punting.long, e.yards);
        if (e.inside20) l.punting.inside20++;
        if (e.touchback) l.punting.touchbacks++;
        if (e.blocked) l.punting.blocked++;
        break;
      }
      case 'PUNT_RETURN': {
        t.puntReturns.count++;
        t.puntReturns.yards += e.yards;
        const l = line(e.side, e.playerId ?? `return:${e.name}`, e.name);
        l.puntReturns ??= { count: 0, yards: 0, long: 0, td: 0 };
        l.puntReturns.count++;
        l.puntReturns.yards += e.yards;
        l.puntReturns.long = l.puntReturns.count === 1 ? e.yards : Math.max(l.puntReturns.long, e.yards);
        if (e.touchdown) l.puntReturns.td++;
        break;
      }
      case 'FIELD_GOAL': {
        if (!e.playerId) break;
        const l = line(e.side, e.playerId);
        l.fieldGoals ??= { made: 0, att: 0, long: 0, blocked: 0 };
        l.fieldGoals.att++;
        if (e.good) { l.fieldGoals.made++; l.fieldGoals.long = Math.max(l.fieldGoals.long, e.distance); }
        if (e.blocked) l.fieldGoals.blocked++;
        break;
      }
      case 'EXTRA_POINT': {
        if (!e.playerId) break;
        const l = line(e.side, e.playerId);
        l.extraPoints ??= { made: 0, att: 0 };
        l.extraPoints.att++;
        if (e.good) l.extraPoints.made++;
        break;
      }
    }
  }

  const sorted = (side: Side) =>
    [...lines[side].values()].sort((a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position) || a.name.localeCompare(b.name));
  return { teams: team, players: { home: sorted('home'), away: sorted('away') } };
}

/** "12:34" */
export const minutesText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * NFL passer rating: four parts (completion %, yards per attempt, TD %, interception %), each kept between 0 and
 * 2.375, averaged and scaled so a perfect game is 158.3. Shown with two decimals.
 */
export function passerRating(p: { comp: number; att: number; yards: number; td: number; interceptions: number }): number {
  if (!p.att) return 0;
  const part = (x: number) => Math.max(0, Math.min(2.375, x));
  const a = part((p.comp / p.att - 0.3) * 5);
  const b = part((p.yards / p.att - 3) * 0.25);
  const c = part((p.td / p.att) * 20);
  const d = part(2.375 - (p.interceptions / p.att) * 25);
  return ((a + b + c + d) / 6) * 100;
}

/**
 * Yards after the catch. The cards give only the gain, so the catch point is worked out from the pass called, as a
 * coach would picture it: a quick pass is caught 0-10 yards downfield, a short pass 10-20, a long pass with most of
 * the gain in the air (0-10 yards after the catch), a screen behind the line (up to 5 yards back). Never past the
 * gain. The point within that band comes from the play's number and the receiver, so a game always shows the same
 * figures. Older games (no pass kind recorded) take the kind from the gain.
 */
export function yardsAfterCatch(e: { yards: number; play: number; targetId: string | null; kind?: 'QK' | 'SH' | 'LG' | 'SC' }): number {
  const g = e.yards;
  const kind = e.kind ?? (g < 0 ? 'SC' : g <= 10 ? 'QK' : g <= 20 ? 'SH' : 'LG');
  const r = unit(`${e.play}|${e.targetId ?? ''}`);
  let air: number;
  switch (kind) {
    case 'SC': air = -Math.round(r * 5); break;
    case 'QK': air = Math.round(r * Math.min(10, Math.max(0, g))); break;
    case 'SH': air = g <= 10 ? Math.round(r * Math.max(0, g)) : Math.round(10 + r * (Math.min(20, g) - 10)); break;
    case 'LG': air = g <= 20 ? Math.round(r * Math.max(0, g)) : g - Math.round(r * Math.min(10, g - 20)); break;
  }
  return Math.max(0, g - air);
}

/** A number from 0 to 1 that depends only on the text (FNV-1a hash): the same play always gives the same value. */
function unit(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0) / 0x100000000;
}
