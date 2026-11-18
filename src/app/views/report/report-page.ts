import { boxScore, shortName } from '../../shared/box-score';
import { Component, computed, inject, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { computeDrives, computeStats, Drive, minutesText, passerRating, PlayerStats, quarterLabel, scoringPlays, Side } from '../../engine';
import { SETTINGS } from '../../settings';
import { GameStore } from '../../state/game.store';

const QUARTER_NAMES = ['', '1st quarter', '2nd quarter', '3rd quarter', '4th quarter', 'Overtime'];
const RESULT_TAG: Record<string, string> = {
  Touchdown: 'TD', 'Field goal': 'FG', 'Missed field goal': 'FG✗', 'Blocked field goal': 'BLK', Punt: 'PUNT', 'Blocked punt': 'BLK',
  Fumble: 'FUM', Interception: 'INT', 'Interception, returned for a TD': 'INT', Safety: 'SAF', Downs: 'DOWNS', 'End of half': 'HALF',
  'End of game': 'END', 'In progress': '…',
};

/**
 * The Official Game Book: a print-designed report of a game (cover, scoring summary and drive chart, team statistics,
 * individual statistics, play-by-play) for the browser's "Save as PDF". A4 pages, numbered in the footer.
 */
@Component({
  selector: 'spf-report-page',
  imports: [],
  template: `
    <div class="toolbar no-print">
      <button type="button" (click)="back()">← Back to the game</button>
      <button type="button" class="primary" (click)="print()" [disabled]="!ready()">Save as PDF</button>
      <span>In the print dialog, choose <b>Save as PDF</b> as the destination. Background graphics are kept for you.</span>
    </div>

    @if (data(); as d) {
      <article class="book">
        <!-- ===================== Cover ===================== -->
        <section class="page cover">
          <header class="band">
            <span class="kicker">{{ gameName }}</span>
            <h1>Official Game Book</h1>
            <span class="kicker matchup-line">{{ d.names.away }} <i>at</i> {{ d.names.home }}</span>
          </header>

          <div class="matchup">
            <div class="team" [class.won]="d.score.away > d.score.home">
              <span class="tag">Visitor</span>
              <span class="city">{{ d.names.away }}</span>
              @if (d.playedBy.away) { <span class="by">played by {{ d.playedBy.away }}</span> }
              <span class="pts">{{ d.score.away }}</span>
            </div>
            <div class="middle">
              <div class="at">{{ d.final ? 'FINAL' : 'IN PROGRESS' }}{{ d.overtime ? ' / OT' : '' }}</div>
              @if (d.byNote) { <span class="by-note">{{ d.byNote }}</span> }
            </div>
            <div class="team home" [class.won]="d.score.home > d.score.away">
              <span class="tag">Home</span>
              <span class="city">{{ d.names.home }}</span>
              @if (d.playedBy.home) { <span class="by">played by {{ d.playedBy.home }}</span> }
              <span class="pts">{{ d.score.home }}</span>
            </div>
          </div>

          <table class="linescore">
            <thead><tr><th></th>@for (q of d.lineQuarters; track q) { <th>{{ q }}</th> }<th class="total">Final</th></tr></thead>
            <tbody>
              @for (side of sides; track side) {
                <tr><th>{{ d.names[side] }}</th>@for (v of d.line[side]; track $index) { <td>{{ v }}</td> }<td class="total">{{ d.score[side] }}</td></tr>
              }
            </tbody>
          </table>


          <h2 class="section">Game leaders</h2>
          <div class="leaders">
            @for (side of sides; track side) {
              <div class="leader-col" [class.home]="side === 'home'">
                <h3>{{ d.names[side] }}</h3>
                @for (l of d.leaders[side]; track l.label) {
                  <div class="leader"><span class="ll">{{ l.label }}</span><span class="ln">{{ l.name }}</span><span class="lv">{{ l.line }}</span></div>
                }
              </div>
            }
          </div>
        </section>

        <!-- ===================== Scoring and drives ===================== -->
        <section class="page">
          <h2 class="section">Scoring summary</h2>
          @if (d.scoring.length) {
            <table class="grid scoring">
              <thead><tr><th>Qtr</th><th>Time</th><th>Team</th><th></th><th>Play</th><th>Drive</th><th class="n">{{ d.abbr.away }}</th><th class="n">{{ d.abbr.home }}</th></tr></thead>
              <tbody>
                @for (s of d.scoring; track $index) {
                  <tr>
                    <td>{{ q(s.quarter) }}</td><td class="n">{{ time(s.clock) }}</td><td class="team-cell" [class.home]="s.side === 'home'">{{ d.abbr[s.side] }}</td>
                    <td><b class="kind">{{ s.kind }}</b></td><td>{{ s.text }}</td>
                    <td class="drive-cell">{{ s.drive ? s.drive.plays.length + (s.drive.plays.length === 1 ? ' play, ' : ' plays, ') + s.drive.yards + ' yds, ' + time(s.drive.seconds) : '' }}</td>
                    <td class="n">{{ s.away }}</td><td class="n">{{ s.home }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else { <p class="fine">No points were scored{{ d.journaled ? '' : ', or this game was played before scoring could be traced' }}.</p> }

          <h2 class="section">Drive chart</h2>
          <svg class="chart" [attr.viewBox]="'0 0 1000 ' + d.chartHeight" role="img" [attr.aria-label]="'Drive chart: ' + d.drives.length + ' drives'">
            <!-- the field: end zones, yard lines and numbers -->
            <rect [attr.x]="FX - EZ" y="20" [attr.width]="EZ" [attr.height]="d.chartHeight - 30" class="ez away" />
            <rect [attr.x]="FX + FW" y="20" [attr.width]="EZ" [attr.height]="d.chartHeight - 30" class="ez home" />
            <rect [attr.x]="FX" y="20" [attr.width]="FW" [attr.height]="d.chartHeight - 30" class="turf" />
            @for (y of yardLines; track y) {
              <line [attr.x1]="FX + y * FW / 100" [attr.x2]="FX + y * FW / 100" y1="20" [attr.y2]="d.chartHeight - 10" class="yl" [class.mid]="y === 50" />
              <text [attr.x]="FX + y * FW / 100" y="14" class="yn">{{ y <= 50 ? y : 100 - y }}</text>
            }
            <text [attr.x]="FX - EZ / 2" y="14" class="ezl">{{ d.abbr.home }}</text>
            <text [attr.x]="FX + FW + EZ / 2" y="14" class="ezl">{{ d.abbr.away }}</text>
            @for (r of d.rows; track $index) {
              @if ($index % 2 === 0) { <rect x="0" [attr.y]="r.y - 10" width="1000" height="20" class="stripe" /> }
              <text x="4" [attr.y]="r.y + 4" class="rl">{{ r.label }}</text>
              <text x="92" [attr.y]="r.y + 4" class="ra" [class.home]="r.side === 'home'">{{ r.team }}</text>
              <line [attr.x1]="r.x1" [attr.x2]="r.x2" [attr.y1]="r.y" [attr.y2]="r.y" class="bar" [class.home]="r.side === 'home'" [class.score]="r.score" />
              <circle [attr.cx]="r.x1" [attr.cy]="r.y" r="3" class="dot" [class.home]="r.side === 'home'" />
              <text [attr.x]="r.tagX" [attr.y]="r.y + 4" class="tag" [class.score]="r.score" [attr.text-anchor]="r.anchor">{{ r.tag }}</text>
              <text [attr.x]="FX + FW + EZ + 10" [attr.y]="r.y + 4" class="rr">{{ r.info }}</text>
            }
          </svg>
          <p class="legend"><span class="sw away"></span>{{ d.names.away }} (going left) &nbsp; <span class="sw home"></span>{{ d.names.home }} (going right) &nbsp; · bold: points</p>
        </section>

        <!-- ===================== Team statistics ===================== -->
        <section class="page">
          <h2 class="section">Team statistics</h2>
          <table class="grid teamstats">
            <thead><tr><th class="n">{{ d.names.away }}</th><th></th><th class="n">{{ d.names.home }}</th></tr></thead>
            <tbody>
              @for (r of d.teamRows; track r.label) {
                <tr [class.sub]="r.sub" [class.big]="r.big"><td class="n">{{ r.away }}</td><th>{{ r.label }}</th><td class="n">{{ r.home }}</td></tr>
              }
            </tbody>
          </table>
        </section>

        <!-- ===================== Individual statistics ===================== -->
        <section class="page">
          <h2 class="section">Individual statistics</h2>
          @for (cat of d.categories; track cat.title) {
            <h3 class="cat">{{ cat.title }}</h3>
            <div class="pair">
              @for (side of sides; track side) {
                <table class="grid ind">
                  <thead><tr><th>{{ d.names[side] }}</th>@for (h of cat.head; track h) { <th class="n">{{ h }}</th> }</tr></thead>
                  <tbody>
                    @for (row of cat.rows[side]; track $index) { <tr><td>{{ row[0] }}</td>@for (v of row.slice(1); track $index) { <td class="n">{{ v }}</td> }</tr> }
                    @empty { <tr><td class="none" [attr.colspan]="cat.head.length + 1">None</td></tr> }
                  </tbody>
                  @if (cat.team?.[side]; as t) { <tfoot><tr><td>{{ t[0] }}</td>@for (v of t.slice(1); track $index) { <td class="n">{{ v }}</td> }</tr></tfoot> }
                </table>
              }
            </div>
          }
        </section>

        <!-- ===================== Play-by-play ===================== -->
        <section class="page pbp">
          <h2 class="section">Play-by-play</h2>
          <div class="cols">
            @for (g of d.pbp; track g.quarter) {
              <h3 class="cat">{{ g.name }}</h3>
              @for (e of g.entries; track $index) {
                @if (e.update) {
                  <p class="update">Score update: {{ e.update }}</p>
                } @else {
                  <p class="p" [class.score]="e.score"><span class="t">{{ time(e.clock) }}</span> <b>{{ e.title }}</b> {{ e.result }}</p>
                }
              }
            }
          </div>
        </section>
      </article>
    } @else {
      <p class="nogame no-print">There's no game to report on yet: start or open one on the Game tab.</p>
    }
  `,
  styles: `
    :host {
      --ink: #111827; --muted: #4b5563; --line: #d1d5db; --band: #0b1220; --heading: #3f4651; --table: #24573a; --gold: #e0a526; --away: #1d4ed8; --home: #c2410c; --turf: #2f7d3b;
      display: block; background: #6b7280; min-height: 100vh; padding: 1rem 0 3rem; color: var(--ink);
      font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .toolbar { position: sticky; top: 0; z-index: 2; display: flex; gap: .7rem; align-items: center; justify-content: center; padding: .6rem; background: #1f2937; color: #e5e7eb; margin: -1rem 0 1rem; }
    .toolbar button { font: inherit; padding: .4rem .9rem; border-radius: 5px; border: 1px solid #9ca3af; background: transparent; color: white; cursor: pointer; }
    .toolbar button.primary { background: var(--gold); border-color: var(--gold); color: #1f1300; font-weight: 700; }
    .toolbar span { font-size: .85rem; opacity: .8; }
    .nogame { color: white; text-align: center; }

    /* A4 sheets on screen; real pages in print */
    .page { width: 210mm; min-height: 297mm; box-sizing: border-box; margin: 0 auto 1.2rem; padding: 14mm 12mm 16mm; background: white; box-shadow: 0 6px 24px rgba(0, 0, 0, .35); }
    h1, h2, h3, .kicker, .tag, .city, .at, .pts, th { font-family: 'Oswald', 'Bebas Neue', 'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif; }
    .section { margin: 0 0 3mm; padding-bottom: 1.5mm; color: var(--heading); border-bottom: 2.5px solid var(--heading); text-transform: uppercase; letter-spacing: .08em; font-size: 15pt; }
    .section + * { margin-bottom: 7mm; }
    .cat { break-after: avoid; margin: 4mm 0 1.5mm; font-size: 10pt; text-transform: uppercase; letter-spacing: .1em; color: var(--table); }
    .fine { font-size: 8.5pt; color: var(--muted); }

    /* Cover */
    .cover { display: flex; flex-direction: column; gap: 4.5mm; }
    .band { margin: -14mm -12mm 0; padding: 9mm 12mm 7mm; background: linear-gradient(135deg, #b9cde6 0%, #d6e3f3 55%, #b9cde6 100%); color: #12233d; text-align: center; border-bottom: 3mm solid var(--gold); }
    .band h1 { margin: 2mm 0; font-size: 27pt; text-transform: uppercase; letter-spacing: .1em; font-weight: 700; white-space: nowrap; }
    .kicker { display: block; font-size: 10pt; text-transform: uppercase; letter-spacing: .3em; color: #3b5578; }
    .kicker.matchup-line { font-size: 13pt; letter-spacing: .18em; color: #12233d; font-weight: 700; }
    .kicker.matchup-line i { font-style: normal; font-weight: 400; text-transform: lowercase; color: #3b5578; }
    .matchup { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 6mm; margin-top: 1mm; }
    .team { display: grid; justify-items: start; }
    .team.home { justify-items: end; text-align: right; }
    .team .tag { font-size: 9pt; letter-spacing: .25em; text-transform: uppercase; color: var(--muted); }
    .team .city { font-size: 18pt; white-space: nowrap; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; line-height: 1.05; }
    .team .pts { font-size: 46pt; font-weight: 700; line-height: 1; color: var(--muted); }
    .team.won .pts { color: var(--ink); }
    .team.won .city::after { content: ' ◀'; color: var(--gold); font-size: 14pt; vertical-align: middle; }
    .team.home.won .city::after { content: ''; }
    .team.home.won .city::before { content: '▶ '; color: var(--gold); font-size: 14pt; vertical-align: middle; }
    .team .by { font-size: 9pt; color: var(--muted); letter-spacing: .04em; margin-top: .4mm; }
    .middle { display: grid; justify-items: center; gap: 2mm; }
    .by-note { font: 600 8.5pt 'Oswald', 'Arial Narrow', Arial, sans-serif; letter-spacing: .2em; color: var(--muted); text-transform: uppercase; }
    .at { font-size: 12pt; letter-spacing: .2em; padding: 2mm 4mm; border: 2px solid var(--band); }
    .linescore { width: 70%; margin: 0 auto; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    .linescore th, .linescore td { padding: 1.6mm 3mm; text-align: center; border-bottom: 1px solid var(--line); }
    .linescore thead th { font-size: 9pt; color: var(--muted); letter-spacing: .1em; }
    .linescore tbody th { text-align: left; text-transform: uppercase; letter-spacing: .05em; }
    .linescore .total { font-weight: 800; background: #f3f4f6; }
    .scoreboard { width: 74%; margin: 0 auto; }
    .headline { margin: 0; text-align: center; font: 700 15pt 'Oswald', 'Arial Narrow', Arial, sans-serif; text-transform: uppercase; letter-spacing: .08em; }
    .leaders { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
    .leader-col h3 { margin: 0 0 2mm; font-size: 11pt; text-transform: uppercase; letter-spacing: .1em; color: var(--away); border-bottom: 2px solid var(--away); padding-bottom: 1mm; }
    .leader-col.home h3 { color: var(--home); border-color: var(--home); }
    .leader { display: grid; grid-template-columns: 17mm 1fr auto; gap: 2mm; align-items: baseline; padding: 1.3mm 0; border-bottom: 1px solid #e5e7eb; font-size: 9pt; }
    .leader .ll { font: 600 7.5pt 'Oswald', 'Arial Narrow', Arial, sans-serif; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }
    .leader .ln { font-weight: 700; }
    .leader .lv { font-variant-numeric: tabular-nums; color: var(--muted); }
    .keys { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2mm 10mm; margin: 0 6mm; }
    .key { display: grid; grid-template-columns: 1fr auto 1fr; align-items: baseline; gap: 4mm; border-bottom: 1px dashed var(--line); padding: 1mm 0; }
    .key .v { font-size: 13pt; font-weight: 700; font-variant-numeric: tabular-nums; }
    .key .v:last-child { text-align: right; }
    .key .l { font-size: 8pt; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }

    /* Tables */
    .grid { width: 100%; border-collapse: collapse; font-size: 8.6pt; font-variant-numeric: tabular-nums; }
    .grid th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: white; background: var(--table); padding: 1.2mm 1.8mm; }
    .grid td { padding: 1mm 1.8mm; border-bottom: 1px solid #e5e7eb; }
    .grid tbody tr:nth-child(even) td { background: #f8fafc; }
    .grid .n { text-align: right; }
    .scoring .kind { display: inline-block; min-width: 8mm; color: var(--gold); }
    .team-cell { font-weight: 700; color: var(--away); }
    .team-cell.home { color: var(--home); }
    .drive-cell { color: var(--muted); white-space: nowrap; font-size: 7.6pt; }
    .teamstats { width: 86%; margin: 0 auto; font-size: 11.5pt; table-layout: fixed; }
    .teamstats th, .teamstats td, .teamstats .n { text-align: center; }
    .teamstats thead th:nth-child(1), .teamstats thead th:nth-child(3) { width: 30%; }
    .teamstats td, .teamstats tbody th { padding-top: 2.1mm; padding-bottom: 2.1mm; }
    .teamstats thead th { font-size: 10pt; }
    .teamstats tbody th { text-align: center; background: none; color: var(--ink); font-weight: 500; text-transform: none; letter-spacing: 0; font-family: inherit; border-bottom: 1px solid #e5e7eb; }
    .teamstats tr.sub td, .teamstats tr.sub th { font-size: 8.5pt; color: var(--muted); }
    .teamstats tr.big td, .teamstats tr.big th { font-size: 12pt; font-weight: 800; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; break-inside: avoid; }
    .ind .none { color: var(--muted); font-style: italic; }
    .ind tfoot td { border-top: 1.5px solid var(--ink); font-weight: 700; }
    .ind tbody td:first-child, .ind tfoot td:first-child { text-transform: uppercase; white-space: nowrap; }
    .ind thead th:first-child { white-space: nowrap; }
    .ind td:first-child { white-space: nowrap; }
    .ind th:not(:first-child), .ind td:not(:first-child) { padding-left: 1.1mm; padding-right: 1.1mm; }

    /* Drive chart */
    .chart { width: 100%; height: auto; display: block; }
    .chart .turf { fill: #eaf5ec; }
    .chart .ez.away { fill: #dbe4fb; } .chart .ez.home { fill: #fbe3d6; }
    .chart .yl { stroke: #b7d7bd; stroke-width: 1; } .chart .yl.mid { stroke: #7fb28a; stroke-width: 1.5; }
    .chart .yn { font: 600 11px 'Oswald', 'Arial Narrow', Arial, sans-serif; fill: #6b7280; text-anchor: middle; }
    .chart .ezl { font: 700 11px 'Oswald', 'Arial Narrow', Arial, sans-serif; fill: #374151; text-anchor: middle; letter-spacing: .1em; }
    .chart .bar { stroke: var(--away); stroke-width: 7; stroke-linecap: round; opacity: .55; }
    .chart .bar.home { stroke: var(--home); }
    .chart .bar.score { opacity: 1; }
    .chart .dot { fill: white; stroke: var(--away); stroke-width: 2; } .chart .dot.home { stroke: var(--home); }
    .chart .tag { font: 700 10.5px 'Oswald', 'Arial Narrow', Arial, sans-serif; fill: #374151; }
    .chart .tag.score { fill: var(--ink); font-size: 12px; }
    .chart .stripe { fill: #f3f4f6; }
    .chart .rl, .chart .rr { font: 500 11px 'Inter', 'Segoe UI', Arial, sans-serif; fill: #374151; }
    .chart .ra { font: 700 11px 'Oswald', 'Arial Narrow', Arial, sans-serif; fill: var(--away); }
    .chart .ra.home { fill: var(--home); }
    .legend { font-size: 8pt; color: var(--muted); display: flex; align-items: center; gap: 1.5mm; flex-wrap: wrap; }
    .legend .sw { display: inline-block; width: 6mm; height: 2mm; border-radius: 1mm; background: var(--away); }
    .legend .sw.home { background: var(--home); }

    /* Play-by-play */
    .pbp .cols { column-count: 2; column-gap: 7mm; column-rule: 1px solid #e5e7eb; font-size: 7.4pt; line-height: 1.35; }
    .pbp .cat { break-after: avoid; }
    .pbp .p { margin: 0 0 1mm; break-inside: avoid; }
    .pbp .p.score { border-left: 2.5px solid var(--gold); padding-left: 1.4mm; font-weight: 700; }
    .pbp .update { margin: .3mm 0 2.2mm; padding: .7mm 1.6mm; background: #fdf1d2; border-left: 2.5px solid var(--gold); font-weight: 800; font-size: 8.2pt; break-inside: avoid; }
    .pbp .t { display: inline-block; min-width: 9mm; color: var(--muted); font-variant-numeric: tabular-nums; }

    @media print {
      :host { background: white; padding: 0; }
      .no-print { display: none !important; }
      .page { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; break-after: page; }
      .page:last-child { break-after: auto; }
      .band { margin: 0 0 0; }
    }
  `,
})
export class ReportPage implements OnInit, OnDestroy {
  private readonly game = inject(GameStore);
  private readonly router = inject(Router);
  protected readonly gameName = SETTINGS.gameName;
  protected readonly sides: Side[] = ['away', 'home'];
  protected readonly q = quarterLabel;
  protected readonly time = minutesText;
  protected readonly yardLines = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  /** The drive chart's field: left edge, width, end zone width (in chart units). */
  protected readonly FX = 160;
  protected readonly FW = 600;
  protected readonly EZ = 34;
  private style?: HTMLStyleElement;

  protected readonly ready = computed(() => !!this.data());

  protected readonly data = computed(() => {
    const state = this.game.state();
    const teams = this.game.teams();
    const ctx = this.game.ctx();
    const cards = this.game.cards();
    if (!state || !teams || !ctx || !cards) return null;
    const stats = computeStats(state, teams);
    const names = { home: teams.home.name, away: teams.away.name };
    const abbr = { home: teams.home.abbreviation ?? 'HOME', away: teams.away.abbreviation ?? 'AWAY' };
    const overtime = state.quarter >= 5 || (state.quarterScores?.length ?? 0) >= 5;

    // Line score: points in each quarter, from the score at the end of each.
    const ends = state.quarterScores ?? [];
    const played = Math.max(4, overtime ? 5 : 4);
    const lineQuarters = Array.from({ length: played }, (_, i) => (i < 4 ? String(i + 1) : 'OT'));
    const line = { home: [] as (number | string)[], away: [] as (number | string)[] };
    for (const side of ['home', 'away'] as const) {
      let prev = 0;
      for (let i = 0; i < played; i++) {
        const atEnd = ends[i]?.[side] ?? (i === state.quarter - 1 ? state.score[side] : undefined);
        if (atEnd === undefined) { line[side].push(i < state.quarter - 1 ? 0 : '–'); continue; }
        line[side].push(atEnd - prev);
        prev = atEnd;
      }
    }

    const t = stats.teams;
    const pct = (a: number, b: number) => (b ? `${a}-${b}` : '0-0');
    const avg = (y: number, n: number) => (n ? (y / n).toFixed(1) : '0.0');
    const keys = [
      { label: 'Total yards', away: t.away.totalYards, home: t.home.totalYards },
      { label: 'Turnovers', away: t.away.turnovers, home: t.home.turnovers },
      { label: 'First downs', away: t.away.firstDowns, home: t.home.firstDowns },
      { label: 'Possession', away: minutesText(t.away.timeOfPossession), home: minutesText(t.home.timeOfPossession) },
    ];
    const teamRows = [
      { label: 'Points', away: t.away.points, home: t.home.points, big: true },
      { label: 'First downs', away: t.away.firstDowns, home: t.home.firstDowns },
      { label: 'Rushing', away: t.away.firstDownsRushing, home: t.home.firstDownsRushing, sub: true },
      { label: 'Passing', away: t.away.firstDownsPassing, home: t.home.firstDownsPassing, sub: true },
      { label: 'Penalty', away: t.away.firstDownsPenalty, home: t.home.firstDownsPenalty, sub: true },
      { label: '3rd down efficiency', away: pct(t.away.thirdDowns.made, t.away.thirdDowns.att), home: pct(t.home.thirdDowns.made, t.home.thirdDowns.att) },
      { label: '4th down efficiency', away: pct(t.away.fourthDowns.made, t.away.fourthDowns.att), home: pct(t.home.fourthDowns.made, t.home.fourthDowns.att) },
      { label: 'Total plays', away: t.away.plays, home: t.home.plays },
      { label: 'Total net yards', away: t.away.totalYards, home: t.home.totalYards, big: true },
      { label: 'Net yards rushing', away: t.away.rushing.yards, home: t.home.rushing.yards },
      { label: 'Rushes', away: t.away.rushing.att, home: t.home.rushing.att, sub: true },
      { label: 'Average gain per rush', away: avg(t.away.rushing.yards, t.away.rushing.att), home: avg(t.home.rushing.yards, t.home.rushing.att), sub: true },
      { label: 'Net yards passing', away: t.away.passing.net, home: t.home.passing.net },
      { label: 'Completions-attempts', away: `${t.away.passing.comp}-${t.away.passing.att}`, home: `${t.home.passing.comp}-${t.home.passing.att}`, sub: true },
      { label: 'Sacked-yards lost', away: `${t.away.passing.sacks}-${t.away.passing.sackYards}`, home: `${t.home.passing.sacks}-${t.home.passing.sackYards}`, sub: true },
      { label: 'Had intercepted', away: t.away.passing.interceptions, home: t.home.passing.interceptions, sub: true },
      { label: 'Penalties-yards', away: `${t.away.penalties.count}-${t.away.penalties.yards}`, home: `${t.home.penalties.count}-${t.home.penalties.yards}` },
      { label: 'Fumbles-lost', away: `${t.away.fumbles.count}-${t.away.fumbles.lost}`, home: `${t.home.fumbles.count}-${t.home.fumbles.lost}` },
      { label: 'Turnovers', away: t.away.turnovers, home: t.home.turnovers },
      { label: 'Punts-average', away: `${t.away.punts.count}-${avg(t.away.punts.yards, t.away.punts.count)}`, home: `${t.home.punts.count}-${avg(t.home.punts.yards, t.home.punts.count)}` },
      { label: 'Kickoff returns-yards', away: `${t.away.kickReturns.count}-${t.away.kickReturns.yards}`, home: `${t.home.kickReturns.count}-${t.home.kickReturns.yards}` },
      { label: 'Punt returns-yards', away: `${t.away.puntReturns.count}-${t.away.puntReturns.yards}`, home: `${t.home.puntReturns.count}-${t.home.puntReturns.yards}` },
      { label: 'Time of possession', away: minutesText(t.away.timeOfPossession), home: minutesText(t.home.timeOfPossession) },
    ];

    // Individual statistics, the categories of a box score.
    const P = stats.players;
    const nm = (p: PlayerStats) => shortName(p.name); // as box scores print names: "U. von Schamann"
    const by = <K extends keyof PlayerStats>(k: K, sort: (p: PlayerStats) => number) => (side: Side) => P[side].filter(p => p[k]).sort((a, b) => sort(b) - sort(a));
    const cat = (title: string, head: string[], pick: (side: Side) => PlayerStats[], row: (p: PlayerStats) => (string | number)[]) =>
      ({ title, head, rows: { away: pick('away').map(p => [nm(p), ...row(p)]), home: pick('home').map(p => [nm(p), ...row(p)]) } });
    // Passing, rushing, receiving and defense: NFL style with the team's totals, the same as the Stats tab.
    const boxes = { home: boxScore(stats, 'home'), away: boxScore(stats, 'away') };
    const nfl = ['Passing', 'Rushing', 'Receiving', 'Defense'].map(title => {
      const of = (side: Side) => boxes[side].find(b => b.title === title);
      const any = of('away') ?? of('home');
      return {
        title, head: (any?.columns ?? []).slice(1).map(c => c.label),
        rows: { away: of('away')?.rows ?? [], home: of('home')?.rows ?? [] },
        team: { away: of('away')?.team ?? null, home: of('home')?.team ?? null } as Record<Side, (string | number)[] | null>,
      };
    }).filter(c => c.head.length);
    const categories: { title: string; head: string[]; rows: Record<Side, (string | number)[][]>; team?: Record<Side, (string | number)[] | null> }[] = [
      ...nfl,
      cat('Kicking', ['FG', 'Lg', 'XP', 'Pts'], by('fieldGoals', p => (p.fieldGoals?.made ?? 0) * 3 + (p.extraPoints?.made ?? 0)),
        p => [`${p.fieldGoals?.made ?? 0}-${p.fieldGoals?.att ?? 0}`, p.fieldGoals?.long ?? '–', `${p.extraPoints?.made ?? 0}-${p.extraPoints?.att ?? 0}`, (p.fieldGoals?.made ?? 0) * 3 + (p.extraPoints?.made ?? 0)]),
      cat('Punting', ['No', 'Avg', 'Lg', 'In20'], by('punting', p => p.punting!.count), p => [p.punting!.count, avg(p.punting!.yards, p.punting!.count), p.punting!.long, p.punting!.inside20]),
      cat('Kickoff returns', ['No', 'Yds', 'Lg', 'TD'], by('kickReturns', p => p.kickReturns!.yards), p => [p.kickReturns!.count, p.kickReturns!.yards, p.kickReturns!.long, p.kickReturns!.td]),
      cat('Punt returns', ['No', 'Yds', 'Lg', 'TD'], by('puntReturns', p => p.puntReturns!.yards), p => [p.puntReturns!.count, p.puntReturns!.yards, p.puntReturns!.long, p.puntReturns!.td]),
      cat('Fumbles', ['Fum', 'Lost'], by('fumbles', p => p.fumbles!.count), p => [p.fumbles!.count, p.fumbles!.lost]),
    ];
    // Kicking also needs players with only extra points.
    for (const side of this.sides) {
      const k = categories.find(c => c.title === 'Kicking')!;
      const extra = P[side].filter(p => !p.fieldGoals && p.extraPoints).map(p => [nm(p), `0-0`, '–', `${p.extraPoints!.made}-${p.extraPoints!.att}`, p.extraPoints!.made]);
      k.rows[side] = [...k.rows[side], ...extra];
    }

    // Game leaders: each team's top passer, rusher, receiver and tackler.
    const top = (side: Side, f: (p: PlayerStats) => number) => [...P[side]].filter(p => f(p) > 0).sort((a, b) => f(b) - f(a))[0];
    const leaders = { home: [] as { label: string; name: string; line: string }[], away: [] as { label: string; name: string; line: string }[] };
    for (const side of this.sides) {
      const ps = top(side, p => p.passing?.yards ?? 0), rs = top(side, p => p.rushing?.yards ?? 0);
      const rc = top(side, p => p.receiving?.yards ?? 0), tk = top(side, p => (p.tackles?.solo ?? 0) + (p.tackles?.assists ?? 0));
      if (ps) leaders[side].push({ label: 'Passing', name: ps.name, line: `${ps.passing!.comp}/${ps.passing!.att}, ${ps.passing!.yards} yds, ${ps.passing!.td} TD, ${ps.passing!.interceptions} INT` });
      if (rs) leaders[side].push({ label: 'Rushing', name: rs.name, line: `${rs.rushing!.att} car, ${rs.rushing!.yards} yds, ${rs.rushing!.td} TD` });
      if (rc) leaders[side].push({ label: 'Receiving', name: rc.name, line: `${rc.receiving!.rec} rec, ${rc.receiving!.yards} yds, ${rc.receiving!.td} TD` });
      if (tk) leaders[side].push({ label: 'Tackles', name: tk.name, line: `${tk.tackles!.solo + tk.tackles!.assists} (${tk.tackles!.solo} solo)${tk.tackles!.sacks ? `, ${tk.tackles!.sacks} sk` : ''}` });
    }

    // The drive chart: every drive as a bar on one field; the visitors go left, the home team right.
    const drives = computeDrives(state, teams);
    const x = (side: Side, ballOn: number) => this.FX + ((side === 'home' ? ballOn : 100 - ballOn) * this.FW) / 100;
    const rows = drives.map((dr: Drive, i: number) => {
      const y = 38 + i * 20;
      const x1 = x(dr.side, dr.startBallOn);
      const scored = dr.result === 'Touchdown' || dr.result === 'Field goal';
      const endBall = dr.result === 'Touchdown' ? 100 : dr.endBallOn;
      const x2 = x(dr.side, endBall);
      const right = x2 >= x1;
      return {
        y, x1, x2, side: dr.side, score: scored, tag: RESULT_TAG[dr.result] ?? dr.result,
        tagX: right ? x2 + 6 : x2 - 6, anchor: right ? 'start' : 'end',
        label: `${quarterLabel(dr.startQuarter)} ${minutesText(dr.startClock)}`, team: abbr[dr.side],
        info: `${dr.plays.length} pl · ${dr.yards} yds · ${minutesText(dr.seconds)}`,
      };
    });

    // Play-by-play, by quarter.
    type PbpLine = { clock: number; title: string; result: string; score: boolean; update?: string };
    const groups = new Map<number, PbpLine[]>();
    // Scoring plays stand out with a gold bar, followed by a "Score update" line with the score, scoring team first.
    const scored = (title: string, result: string) => /touchdown|safety|field goal is good|try is good/i.test(`${title} ${result}`) && !/no good|declined/i.test(result.slice(0, 40));
    const SCORE = /^(.+?) \((?:home|away)\) (\d+), (.+?) \((?:home|away)\) (\d+)\.?$/;
    const update = (text: string) => { const m = SCORE.exec(text.trim()); return m ? `${m[1]} ${m[2]} : ${m[3]} ${m[4]}` : null; };
    for (const e of state.log) {
      if (!e.result && !e.title) continue;
      const list = groups.get(e.quarter) ?? [];
      const result = e.result ?? '';
      // The touchdown's own entry ("Touchdown San Francisco (home)! ... 7, Miami 0") becomes the score update.
      if (/^Touchdown /.test(e.title) && update(result.split('. ').pop() ?? '')) {
        list.push({ clock: e.clock, title: '', result: '', score: false, update: update(result.split('. ').pop()!)! });
        groups.set(e.quarter, list);
        continue;
      }
      // A play that ends with the score ("... is good. Miami (away) 3, San Francisco (home) 7."): split the score off.
      const parts = result.split('. ');
      const tail = parts.length > 1 ? update(parts[parts.length - 1]) : null;
      if (scored(e.title, result) && tail) {
        list.push({ clock: e.clock, title: e.title, result: parts.slice(0, -1).join('. ') + '.', score: true });
        list.push({ clock: e.clock, title: '', result: '', score: false, update: tail });
        groups.set(e.quarter, list);
        continue;
      }
      list.push({ clock: e.clock, title: e.title, result, score: scored(e.title, result) });
      groups.set(e.quarter, list);
    }
    const pbp = [...groups.entries()].map(([quarter, entries]) => ({ quarter, name: QUARTER_NAMES[quarter] ?? 'Overtime', entries }));

    const { home, away } = state.score;
    const final = state.phase === 'GAME_OVER';
    const result = final
      ? home === away ? `Tied ${home}-${away}.` : `${names[home > away ? 'home' : 'away']} win ${Math.max(home, away)}-${Math.min(home, away)}${overtime ? ' in overtime' : ''}.`
      : `In progress: ${quarterLabel(state.quarter)} ${minutesText(state.clock)}.`;
    // Who played: names under the teams; "AI simulated" when the computer played both sides.
    const c = state.coaches ?? {};
    const bothAI = c.home === 'AI' && c.away === 'AI';
    const playedBy = { home: bothAI ? '' : c.home ?? '', away: bothAI ? '' : c.away ?? '' };
    const byNote = bothAI ? 'AI simulated' : state.aiFinished ? 'Finished by AI' : '';
    return {
      playedBy, byNote,
      season: teams.home.year, venue: `at ${names.home}`, names, abbr, score: state.score, final, overtime, lineQuarters, line, keys, teamRows,
      categories, leaders, scoring: scoringPlays(state, ctx, cards), journaled: !!state.journal, drives, rows, chartHeight: 48 + drives.length * 20, pbp, result,
    };
  });

  ngOnInit() {
    // Page size, margins and the footer on every page: the matchup on the left, the page number on the right.
    const d = this.data();
    const matchup = d ? `${d.names.away} at ${d.names.home}` : '';
    const esc = (s: string) => s.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
    this.style = document.createElement('style');
    this.style.textContent = `@page { size: A4; margin: 12mm 12mm 14mm;
      @bottom-left { content: "${esc(SETTINGS.gameName)} · Official Game Book · ${esc(matchup)}"; font: 7.5pt Arial, sans-serif; color: #6b7280; }
      @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt Arial, sans-serif; color: #6b7280; } }`;
    document.head.appendChild(this.style);
  }

  ngOnDestroy() {
    this.style?.remove();
  }

  protected print() {
    window.print();
  }

  protected back() {
    void this.router.navigateByUrl('/game');
  }
}
