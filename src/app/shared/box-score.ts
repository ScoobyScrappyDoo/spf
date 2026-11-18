/**
 * The NFL-style individual statistics, shared by the Stats tab and the Game Book: one player per row, then a TEAM row
 * (under a line) with the team's totals. Names as box scores print them ("D. Marino").
 */
import { GameStats, passerRating, PlayerStats, Side } from '../engine';

export interface BoxColumn {
  label: string;
  tip?: string;
}

export interface BoxTable {
  title: string;
  columns: BoxColumn[];
  rows: (string | number)[][];
  /** The team's totals, or null when a total makes no sense. */
  team: (string | number)[] | null;
  /** Each row's position (QB, RB, ...), for screens that show it beside the name. */
  positions: string[];
}

/** How names are printed: "D. Marino" (the Game Book's box score) or "Dan Marino" (the Stats tab, like its other tables). */
export type NameStyle = 'short' | 'full';

/** "Dan Marino" -> "D. Marino" (as box scores print names). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name;
}

const fixed = (n: number, d: number) => n.toFixed(d);
const avg = (yards: number, n: number, d: number) => (n ? fixed(yards / n, d) : fixed(0, d));
const pct = (a: number, b: number) => (b ? fixed((100 * a) / b, 1) : '0.0');
const sum = <T>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);
const max = <T>(list: T[], f: (x: T) => number) => list.reduce((a, x) => Math.max(a, f(x)), 0);

export function boxScore(stats: GameStats, side: Side, names: NameStyle = 'short'): BoxTable[] {
  const players = stats.players[side];
  const nameOf = (p: PlayerStats) => (names === 'short' ? shortName(p.name) : p.name);
  const team = names === 'short' ? 'TEAM' : 'Team';
  const out: BoxTable[] = [];

  const passers = players.filter(p => p.passing).sort((a, b) => b.passing!.att - a.passing!.att);
  if (passers.length) {
    const row = (name: string, s: NonNullable<PlayerStats['passing']>) =>
      [name, s.comp, s.att, s.yards, pct(s.comp, s.att), avg(s.yards, s.att, 2), s.td, s.interceptions, s.sacks, fixed(passerRating(s), 1)];
    const total = {
      comp: sum(passers, p => p.passing!.comp), att: sum(passers, p => p.passing!.att), yards: sum(passers, p => p.passing!.yards),
      td: sum(passers, p => p.passing!.td), interceptions: sum(passers, p => p.passing!.interceptions), sacks: sum(passers, p => p.passing!.sacks),
      sackYards: sum(passers, p => p.passing!.sackYards), long: max(passers, p => p.passing!.long),
    };
    out.push({
      title: 'Passing',
      columns: [{ label: 'Player' }, { label: 'CMP', tip: 'Completions' }, { label: 'ATT', tip: 'Attempts' }, { label: 'YDS' }, { label: 'CMP%', tip: 'Completion percentage' },
        { label: 'AVG', tip: 'Yards per attempt' }, { label: 'TD' }, { label: 'INT' }, { label: 'SACKS' }, { label: 'RATING', tip: 'NFL passer rating' }],
      positions: passers.map(p => p.position),
      rows: passers.map(p => row(nameOf(p), p.passing!)),
      team: row(team, total),
    });
  }

  const rushers = players.filter(p => p.rushing).sort((a, b) => b.rushing!.att - a.rushing!.att || b.rushing!.yards - a.rushing!.yards);
  if (rushers.length) {
    const fum = (p: PlayerStats) => p.fumbles?.count ?? 0;
    const row = (name: string, att: number, yds: number, td: number, long: number, f: number, twenty: number) =>
      [name, att, yds, td, avg(yds, att, 1), long, f, twenty];
    out.push({
      title: 'Rushing',
      columns: [{ label: 'Player' }, { label: 'ATT', tip: 'Carries' }, { label: 'YDS' }, { label: 'TD' }, { label: 'AVG', tip: 'Yards per carry' },
        { label: 'LONG' }, { label: 'FUM', tip: 'Fumbles' }, { label: '20+', tip: 'Runs of 20 yards or more' }],
      positions: rushers.map(p => p.position),
      rows: rushers.map(p => row(nameOf(p), p.rushing!.att, p.rushing!.yards, p.rushing!.td, p.rushing!.long, fum(p), p.rushing!.twentyPlus ?? 0)),
      team: row(team, sum(rushers, p => p.rushing!.att), sum(rushers, p => p.rushing!.yards), sum(rushers, p => p.rushing!.td),
        max(rushers, p => p.rushing!.long), sum(rushers, fum), sum(rushers, p => p.rushing!.twentyPlus ?? 0)),
    });
  }

  const receivers = players.filter(p => p.receiving).sort((a, b) => b.receiving!.rec - a.receiving!.rec || b.receiving!.yards - a.receiving!.yards);
  if (receivers.length) {
    const row = (name: string, rec: number, yds: number, td: number, tgt: number, long: number, yac: number) => [name, rec, yds, td, tgt, long, fixed(yac, 1)];
    out.push({
      title: 'Receiving',
      columns: [{ label: 'Player' }, { label: 'REC', tip: 'Receptions' }, { label: 'YDS' }, { label: 'TD' }, { label: 'TGTS', tip: 'Targets' },
        { label: 'LONG' }, { label: 'YAC', tip: 'Yards after the catch' }],
      positions: receivers.map(p => p.position),
      rows: receivers.map(p => row(nameOf(p), p.receiving!.rec, p.receiving!.yards, p.receiving!.td, p.receiving!.targets, p.receiving!.long, p.receiving!.yac ?? 0)),
      team: row(team, sum(receivers, p => p.receiving!.rec), sum(receivers, p => p.receiving!.yards), sum(receivers, p => p.receiving!.td),
        sum(receivers, p => p.receiving!.targets), max(receivers, p => p.receiving!.long), sum(receivers, p => p.receiving!.yac ?? 0)),
    });
  }

  const defenders = players.filter(p => p.tackles).sort((a, b) => (b.tackles!.solo + b.tackles!.assists) - (a.tackles!.solo + a.tackles!.assists));
  if (defenders.length) {
    const t = (p: PlayerStats) => p.tackles!;
    const cols = (f: (x: NonNullable<PlayerStats['tackles']>) => number) => sum(defenders, p => f(t(p)));
    out.push({
      title: 'Defense',
      columns: [{ label: 'Player' }, { label: 'SOLO' }, { label: 'AST', tip: 'Assisted tackles' }, { label: 'TOT', tip: 'Total tackles' }, { label: 'SCK', tip: 'Sacks' },
        { label: 'PRES', tip: 'Pressures: pass rush plays (rule 8.3.6), whatever came of them' }, { label: 'INT', tip: 'Interceptions' },
        { label: 'YDS', tip: 'Interception return yards' }, { label: 'FR', tip: 'Fumble recoveries' }, { label: 'TD', tip: 'Defensive touchdowns' }],
      positions: defenders.map(p => p.position),
      rows: defenders.map(p => [nameOf(p), t(p).solo, t(p).assists, t(p).solo + t(p).assists, t(p).sacks ?? 0, t(p).pressures ?? 0,
        t(p).interceptions ?? 0, t(p).intYards ?? 0, t(p).fumbleRecoveries, t(p).td ?? 0]),
      team: [team, cols(x => x.solo), cols(x => x.assists), cols(x => x.solo + x.assists), cols(x => x.sacks ?? 0), cols(x => x.pressures ?? 0),
        cols(x => x.interceptions ?? 0), cols(x => x.intYards ?? 0), cols(x => x.fumbleRecoveries), cols(x => x.td ?? 0)],
    });
  }
  return out;
}
