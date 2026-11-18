/**
 * The scoring summary for a game book: every score in order, written the way game books do ("Craig James 2-yard run
 * (Tony Franklin kick)"), with the running score and the drive behind it. Found by replaying the game's journal, so
 * every kind of score is caught (blocked kicks returned for touchdowns too); older games without a journal fall back
 * to the score as it stands.
 */
import { computeDrives, Drive } from './drives';
import { GameContext } from './game';
import { GameStart, replayFrames } from './journal';
import { StatEvent } from './model/events';
import { Fac } from './model/fac';
import { GameState, Side } from './model/game';
import { Team } from './model/team';

export interface ScoringPlay {
  quarter: number;
  clock: number;
  side: Side;
  /** "TD", "FG", "Safety" */
  kind: 'TD' | 'FG' | 'Safety' | 'Score';
  text: string;
  home: number;
  away: number;
  drive: Pick<Drive, 'plays' | 'yards' | 'seconds'> | null;
}

export function scoringPlays(final: GameState, ctx: GameContext, cards: readonly Fac[]): ScoringPlay[] {
  if (final.seed === undefined || !final.journal) return [];
  const start: GameStart = { homeTeamId: final.homeTeamId, awayTeamId: final.awayTeamId, seed: final.seed, ...(final.rules ? { rules: final.rules } : {}) };
  const drives = computeDrives(final, ctx.teams);
  const name = (side: Side, id: string | null | undefined, fallback = 'Someone') => {
    const p = id ? ctx.teams[side].players.find(x => x.id === id) : undefined;
    return p ? `${p.firstName} ${p.lastName}` : fallback;
  };
  const out: ScoringPlay[] = [];
  let before: GameState | null = null;
  for (const now of replayFrames(start, final.journal, ctx, cards)) {
    if (before && (now.score.home !== before.score.home || now.score.away !== before.score.away)) {
      const fresh = (now.events ?? []).slice((before.events ?? []).length);
      const side: Side = now.score.home - before.score.home > now.score.away - before.score.away ? 'home' : 'away';
      const first = fresh[0];
      const quarter = first?.quarter ?? before.quarter;
      const clock = first?.clock ?? before.clock;
      const { kind, text } = describe(fresh, side, ctx.teams, name);
      const play = fresh.find(e => e.type === 'SNAP')?.play;
      const drive = kind !== 'Safety' && play !== undefined ? drives.find(d => d.side === side && d.plays.some(p => p.play === play)) : undefined;
      out.push({
        quarter, clock, side, kind, text, home: now.score.home, away: now.score.away,
        drive: drive ? { plays: drive.plays, yards: drive.yards, seconds: drive.seconds } : null,
      });
    }
    before = now;
  }
  return out;
}

function describe(events: StatEvent[], side: Side, teams: Record<Side, Team>, name: (side: Side, id: string | null | undefined, fallback?: string) => string): { kind: ScoringPlay['kind']; text: string } {
  const xp = events.find(e => e.type === 'EXTRA_POINT');
  // The point after, short and plain: "(PAT is good)".
  const after = xp && xp.type === 'EXTRA_POINT' ? ` (PAT ${xp.good ? 'is good' : 'no good'})` : '';
  for (const e of events) {
    if (e.type === 'RUSH' && e.touchdown) return { kind: 'TD', text: `${name(e.side, e.playerId)} ${e.yards}-yard run${after}` };
    if (e.type === 'PASS' && e.complete && e.touchdown) return { kind: 'TD', text: `${name(e.side, e.targetId)} ${e.yards}-yard pass from ${name(e.side, e.playerId)}${after}` };
    if (e.type === 'INTERCEPTION' && e.touchdown) return { kind: 'TD', text: `${name(e.side, e.playerId)} ${e.returnYards}-yard interception return${after}` };
    if (e.type === 'KICK_RETURN' && e.touchdown) return { kind: 'TD', text: `${e.name} ${e.yards}-yard kickoff return${after}` };
    if (e.type === 'PUNT_RETURN' && e.touchdown) return { kind: 'TD', text: `${e.name} ${e.yards}-yard punt return${after}` };
    if (e.type === 'FIELD_GOAL' && e.good) return { kind: 'FG', text: `${name(e.side, e.playerId, 'the kicker')} ${e.distance}-yard field goal` };
    if (e.type === 'FIELD_GOAL' && e.blocked) return { kind: 'TD', text: `Blocked field goal returned for a touchdown${after}` };
    if (e.type === 'PUNT' && e.blocked) return { kind: 'TD', text: `Blocked punt returned for a touchdown${after}` };
    if (e.type === 'SAFETY') return { kind: 'Safety', text: 'Safety' };
  }
  return { kind: 'Score', text: `${teams[side].name} score${after}` };
}
