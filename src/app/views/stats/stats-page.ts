import { BoxTable, boxScore } from '../../shared/box-score';
import { Component, computed, inject, signal } from '@angular/core';
import { computeStats, minutesText, passerRating, PlayerStats, Side, TeamStats } from '../../engine';
import { PageHeader } from '../../shell/page-header';
import { GameStore } from '../../state/game.store';

interface Row {
  label: string;
  value: (t: TeamStats) => string;
  sub?: boolean;
}

const avg = (yards: number, n: number) => (n ? (yards / n).toFixed(1) : '0.0');

type View = 'players' | 'team';
const VIEW_KEY = 'spf.stats.view';

/** Team stats like an nfl.com box score, then each team's individual stats. Worked out from the play events. */
import { Tooltip } from '../../shared/tooltip';
@Component({
  selector: 'spf-stats-page',
  imports: [Tooltip, PageHeader],
  templateUrl: './stats-page.html',
  styleUrl: './stats-page.scss',
})
export class StatsPage {
  protected readonly game = inject(GameStore);

  /** Player stats first; after that the page remembers which tab you looked at last. */
  protected readonly view = signal<View>(StatsPage.savedView());

  protected show(view: View) {
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Storage switched off: the choice just isn't remembered.
    }
  }

  private static savedView(): View {
    try {
      return localStorage.getItem(VIEW_KEY) === 'team' ? 'team' : 'players';
    } catch {
      return 'players';
    }
  }
  protected readonly sides: Side[] = ['away', 'home'];
  protected readonly avg = avg;

  protected readonly stats = computed(() => {
    const s = this.game.state();
    const teams = this.game.teams();
    return s && teams ? computeStats(s, teams) : null;
  });

  protected readonly rows: Row[] = [
    { label: 'First downs', value: t => `${t.firstDowns}` },
    { label: 'Rushing', value: t => `${t.firstDownsRushing}`, sub: true },
    { label: 'Passing', value: t => `${t.firstDownsPassing}`, sub: true },
    { label: 'Penalty', value: t => `${t.firstDownsPenalty}`, sub: true },
    { label: '3rd down efficiency', value: t => `${t.thirdDowns.made}-${t.thirdDowns.att}` },
    { label: '4th down efficiency', value: t => `${t.fourthDowns.made}-${t.fourthDowns.att}` },
    { label: 'Total plays', value: t => `${t.plays}` },
    { label: 'Total yards', value: t => `${t.totalYards}` },
    { label: 'Rushing', value: t => `${t.rushing.yards}` },
    { label: 'Rushing attempts', value: t => `${t.rushing.att}`, sub: true },
    { label: 'Yards per rush', value: t => avg(t.rushing.yards, t.rushing.att), sub: true },
    { label: 'Passing', value: t => `${t.passing.net}` },
    { label: 'Comp-att', value: t => `${t.passing.comp}-${t.passing.att}`, sub: true },
    { label: 'Yards per pass', value: t => avg(t.passing.net, t.passing.att + t.passing.sacks), sub: true },
    { label: 'Sacks-yards lost', value: t => `${t.passing.sacks}-${t.passing.sackYards}`, sub: true },
    { label: 'Interceptions thrown', value: t => `${t.passing.interceptions}`, sub: true },
    { label: 'Penalties-yards', value: t => `${t.penalties.count}-${t.penalties.yards}` },
    { label: 'Fumbles-lost', value: t => `${t.fumbles.count}-${t.fumbles.lost}` },
    { label: 'Turnovers', value: t => `${t.turnovers}` },
    { label: 'Punts-average', value: t => `${t.punts.count}-${avg(t.punts.yards, t.punts.count)}` },
    { label: 'Kick returns-yards', value: t => `${t.kickReturns.count}-${t.kickReturns.yards}` },
    { label: 'Punt returns-yards', value: t => `${t.puntReturns.count}-${t.puntReturns.yards}` },
    { label: 'Time of possession', value: t => minutesText(t.timeOfPossession) },
  ];

  /** "New England Patriots", for the team stats headings. */
  protected fullName(side: Side): string {
    return this.game.teams()?.[side].name ?? this.game.label(side);
  }

  protected with(side: Side, key: keyof PlayerStats): PlayerStats[] {
    return (this.stats()?.players[side] ?? []).filter(p => p[key]);
  }

  /** Kickers: field goals and extra points together. */
  protected kickers(side: Side): PlayerStats[] {
    return (this.stats()?.players[side] ?? []).filter(p => p.fieldGoals || p.extraPoints);
  }

  /** Rushers by yards, as nfl.com lists them. */
  protected rushers(side: Side): PlayerStats[] {
    return this.with(side, 'rushing').sort((a, b) => b.rushing!.yards - a.rushing!.yards);
  }

  /** The NFL passer rating, two decimals: "94.21". */
  /** Passing, rushing, receiving and defense, NFL style, with the team's totals (shared with the Game Book). */
  protected box(side: Side): BoxTable[] {
    const stats = this.stats();
    return stats ? boxScore(stats, side, 'full') : [];
  }

  protected rating(p: PlayerStats): string {
    return p.passing ? passerRating(p.passing).toFixed(2) : '';
  }

  /** Passers by yards, receivers by yards. */
  protected passers(side: Side): PlayerStats[] {
    return this.with(side, 'passing').sort((a, b) => b.passing!.yards - a.passing!.yards);
  }

  protected receivers(side: Side): PlayerStats[] {
    return this.with(side, 'receiving').sort((a, b) => b.receiving!.yards - a.receiving!.yards || b.receiving!.rec - a.receiving!.rec);
  }

  /** Defenders by total tackles. */
  protected defenders(side: Side): PlayerStats[] {
    const total = (p: PlayerStats) => p.tackles!.solo + p.tackles!.assists;
    return this.with(side, 'tackles').sort((a, b) => total(b) - total(a) || b.tackles!.solo - a.tackles!.solo);
  }
}
