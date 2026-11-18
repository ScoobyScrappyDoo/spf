import { Tooltip } from '../../shared/tooltip';
import { Component, computed, inject } from '@angular/core';
import { computeDrives, Drive, minutesText, spotShort, quarterLabel } from '../../engine';
import { GameStore } from '../../state/game.store';
import { PlayArrow } from './play-arrow';
import { PlayByPlayView } from './play-by-play-page';

const DOWNS = ['', '1st', '2nd', '3rd', '4th'];

/** Every drive of the game, in order; the current one open, the others folded to a summary line. */
@Component({
  selector: 'spf-drive-chart',
  imports: [PlayArrow, Tooltip],
  template: `
    @for (d of drives(); track d.number) {
      <details class="drive" [class.home]="d.side === 'home'" [open]="isOpen(d)" (toggle)="remember(d, $any($event.target).open)">
        <summary>
          <span class="who">
            <span class="num">Drive {{ d.number }}</span>
            <strong>{{ game.label(d.side) }}</strong>
          </span>
          <span class="result" [attr.data-kind]="kind(d)">{{ d.result }}</span>
          <span class="line">
            {{ d.plays.length }} play{{ d.plays.length === 1 ? '' : 's' }} · {{ d.yards }} yard{{ d.yards === 1 ? '' : 's' }} ·
            {{ time(d.seconds) }} · from {{ spot(d.startBallOn) }}, {{ q(d.startQuarter) }} {{ time(d.startClock) }}
          </span>
          <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
        </summary>
        <ol>
          @for (p of d.plays; track p.play) {
            <li>
              <span class="when" aria-label="Time">{{ q(p.quarter) }} {{ time(p.clock) }}</span>
              <span class="dd">{{ downs[p.down] }} & {{ p.ballOn + p.distance >= 100 ? 'goal' : p.distance }} · {{ spot(p.ballOn) }}</span>
              <spf-play-arrow [kind]="p.kind" [yards]="p.yards" />
              <span class="text">{{ p.text }}</span>
            </li>
            @if (p.timeout; as to) {
              <!-- A timeout after the play: its own row right under it, then a line before the next play. -->
              <li class="timeout-row">
                <span></span><span></span>
                <!-- A stopped clock: a dark grey face, hands at ten to twelve, a red line from bottom left to top right. -->
                <svg class="stopped-clock" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="face" cx="12" cy="12" r="9" /><path class="hands" d="M12 12V6.5M12 12L8 9.5" /><path class="slash" d="M5 19L19 5" />
                </svg>
                <span class="text">{{ teamName(to.side) }} take a timeout, they have {{ to.left }} remaining</span>
              </li>
            }
          }
        </ol>
      </details>
    } @empty {
      <p class="empty">No drives yet: they start with the first play from scrimmage.</p>
    }
  `,
  styles: `
    li.timeout-row { border-bottom: 1px solid rgba(255, 255, 255, .25); padding-bottom: .25rem; }
    .stopped-clock { width: 26px; height: 26px; justify-self: center; stroke-linecap: round; }
    .stopped-clock .face { fill: #d1d5db; stroke: #374151; stroke-width: 2; }
    .stopped-clock .hands { fill: none; stroke: #374151; stroke-width: 2; }
    .stopped-clock .slash { fill: none; stroke: #dc2626; stroke-width: 2.6; }
    :host { display: grid; gap: .5rem; }
    .drive { border-left: 5px solid #9ec5ff; border-radius: 6px; background: rgba(0, 0, 0, .18); padding: .45rem .8rem; color: white; }
    .drive.home { border-left-color: #ffd27a; }
    summary {
      list-style: none; cursor: pointer; display: grid; grid-template-columns: minmax(12rem, auto) auto 1fr auto;
      align-items: center; gap: .3rem .9rem;
    }
    summary::-webkit-details-marker { display: none; }
    summary:focus-visible { outline: 2px solid #ffd27a; outline-offset: 2px; border-radius: 3px; }
    .who { display: grid; }
    .num { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; opacity: .7; }
    .result { font-size: .8rem; font-weight: 700; padding: .12rem .5rem; border-radius: 999px; background: #6b7280; white-space: nowrap; }
    .result[data-kind='score'] { background: #2f9e44; }
    .result[data-kind='fg'] { background: #c49a18; color: #2b2410; }
    .result[data-kind='turnover'] { background: #c92a2a; }
    .result[data-kind='live'] { background: #1c7ed6; }
    .line { font-size: .88rem; opacity: .9; }
    .chevron { width: 1.1rem; height: 1.1rem; fill: none; stroke: currentColor; stroke-width: 2; opacity: .75; transition: transform .15s; }
    details[open] > summary .chevron { transform: rotate(90deg); }
    ol { list-style: none; margin: .5rem 0 .1rem; padding: 0; display: grid; gap: .15rem; }
    li { display: grid; grid-template-columns: 4.6rem 9.5rem 140px 1fr; align-items: center; gap: .6rem; font-size: .9rem; }
    .when { font-variant-numeric: tabular-nums; opacity: .7; font-size: .82rem; }
    .dd { font-variant-numeric: tabular-nums; opacity: .8; font-size: .82rem; }
    .empty { color: white; margin: 0; }
  `,
})
export class DriveChart {
  /** The team that called a timeout, by its shown name. */
  protected teamName(side: 'home' | 'away') {
    return this.game.teams()?.[side].name ?? side;
  }
  protected readonly q = quarterLabel;
  protected readonly game = inject(GameStore);
  private readonly view = inject(PlayByPlayView);
  protected readonly downs = DOWNS;
  protected readonly spot = spotShort;
  protected readonly time = minutesText;

  protected readonly drives = computed(() => {
    const s = this.game.state();
    const teams = this.game.teams();
    return s && teams ? computeDrives(s, teams) : [];
  });

  /** Green for points, gold for a field goal, red for a turnover, blue while it's going on, grey otherwise. */
  protected kind(d: Drive): string {
    if (d.result === 'Touchdown') return 'score';
    if (d.result === 'Field goal') return 'fg';
    if (['Fumble', 'Interception', 'Interception, returned for a TD', 'Downs', 'Safety', 'Blocked punt', 'Blocked field goal'].includes(d.result)) return 'turnover';
    if (d.result === 'In progress') return 'live';
    return 'other';
  }

  private key(d: Drive) {
    const s = this.game.state();
    return `drive|${s?.homeTeamId}|${s?.awayTeamId}|${d.possession}`;
  }

  /** The coach's own choice if he made one; otherwise only the drive under way is open. */
  protected isOpen(d: Drive): boolean {
    return this.view.choices().get(this.key(d)) ?? d.result === 'In progress';
  }

  protected remember(d: Drive, open: boolean) {
    if (open === this.isOpen(d)) return;
    this.view.set(this.key(d), open);
  }
}
