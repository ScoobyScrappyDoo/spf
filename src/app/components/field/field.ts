import { Component, computed, inject } from '@angular/core';
import { Side } from '../../engine';
import { GameStore } from '../../state/game.store';
import { Tooltip } from '../../shared/tooltip';
import { WeatherLayer } from '../weather-layer/weather-layer';

/** 10 units to the yard: 120 yards long including the end zones, 53 1/3 yards wide. */
const Y = 10;
const LENGTH = 120 * Y;
const WIDTH = 533;
const MID = WIDTH / 2;
/** NFL hash marks: 70 feet 9 inches from each sideline. */
const HASH = 23.58 * Y;

/** Where a yard line is on the drawing. The home team always attacks to the right. */
const xOf = (yardFromHomeGoal: number) => 10 * Y + yardFromHomeGoal * Y;
/**
 * Letter size for a name in an end zone, so that even "LOS ANGELES (N)" fits the 53-yard width with room to spare.
 * Bold capitals run about 0.72 of the font size wide, plus the letter spacing of an eighth.
 */
export function endZoneSize(name: string): number {
  const room = WIDTH - 60;
  return Math.min(46, Math.floor(room / (name.length * (0.72 + 1 / 8))));
}

/** A spot as the offense counts it (its own goal = 0) to yards from the home goal line. */
const absolute = (ballOn: number, offense: Side) => (offense === 'home' ? ballOn : 100 - ballOn);

/**
 * The playing field, to scale: stripes, yard lines and numbers, hash marks, the end zones with each team's name.
 * On it: the line of scrimmage (blue), the line to gain (yellow), the ball, and the last play as an arrow:
 * straight for a run, a raised curve for a pass; green for a gain, red for a loss, a bar for no gain.
 * Hovering over the arrow shows the play.
 */
@Component({
  selector: 'spf-field',
  imports: [Tooltip, WeatherLayer],
  template: `
    <svg [attr.viewBox]="'0 0 ' + length + ' ' + width" role="img" [attr.aria-label]="label()">
      <defs>
        <marker id="head-gain" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#6dff7a" stroke="#0b3d12" stroke-width="1" />
        </marker>
        <marker id="head-loss" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#ff5a5a" stroke="#4a0b0b" stroke-width="1" />
        </marker>
      </defs>

      <!-- Grass, mown in 5-yard stripes, and the two end zones -->
      @for (i of stripes; track i) {
        <rect [attr.x]="xOf(i * 5)" y="0" [attr.width]="5 * yard" [attr.height]="width" [attr.class]="i % 2 ? 'grass-b' : 'grass-a'" />
      }
      <rect x="0" y="0" [attr.width]="10 * yard" [attr.height]="width" class="endzone" />
      <rect [attr.x]="xOf(100)" y="0" [attr.width]="10 * yard" [attr.height]="width" class="endzone" />
      <text [attr.x]="5 * yard" [attr.y]="mid" class="ez-name" [attr.font-size]="names().homeSize" [attr.letter-spacing]="names().homeSize / 8"
        [attr.transform]="'rotate(-90 ' + 5 * yard + ' ' + mid + ')'">{{ names().home }}</text>
      <text [attr.x]="xOf(105)" [attr.y]="mid" class="ez-name" [attr.font-size]="names().awaySize" [attr.letter-spacing]="names().awaySize / 8"
        [attr.transform]="'rotate(90 ' + xOf(105) + ' ' + mid + ')'">{{ names().away }}</text>

      <!-- Lines: every 5 yards, goal lines heavier; hash marks every yard -->
      @for (i of fiveYardLines; track i) { <line [attr.x1]="xOf(i)" y1="0" [attr.x2]="xOf(i)" [attr.y2]="width" class="yardline" /> }
      <line [attr.x1]="xOf(0)" y1="0" [attr.x2]="xOf(0)" [attr.y2]="width" class="goalline" />
      <line [attr.x1]="xOf(100)" y1="0" [attr.x2]="xOf(100)" [attr.y2]="width" class="goalline" />
      @for (i of hashes; track i) {
        <line [attr.x1]="xOf(i)" y1="6" [attr.x2]="xOf(i)" y2="16" class="hash" />
        <line [attr.x1]="xOf(i)" [attr.y1]="hashTop - 5" [attr.x2]="xOf(i)" [attr.y2]="hashTop + 5" class="hash" />
        <line [attr.x1]="xOf(i)" [attr.y1]="hashBottom - 5" [attr.x2]="xOf(i)" [attr.y2]="hashBottom + 5" class="hash" />
        <line [attr.x1]="xOf(i)" [attr.y1]="width - 16" [attr.x2]="xOf(i)" [attr.y2]="width - 6" class="hash" />
      }
      @for (n of numbers; track n.at) {
        <text [attr.x]="xOf(n.at)" [attr.y]="width - 70" class="number">{{ n.label }}</text>
        <text [attr.x]="xOf(n.at)" y="70" class="number" [attr.transform]="'rotate(180 ' + xOf(n.at) + ' 70)'" dy="-30">{{ n.label }}</text>
      }
      <rect x="0" y="0" [attr.width]="length" [attr.height]="width" class="border" />

      <!-- Line of scrimmage and line to gain -->
      @if (spot(); as sp) {
        <line [attr.x1]="sp.los" y1="0" [attr.x2]="sp.los" [attr.y2]="width" class="los" />
        @if (sp.toGain !== null) { <line [attr.x1]="sp.toGain" y1="0" [attr.x2]="sp.toGain" [attr.y2]="width" class="to-gain" /> }
      }

      <!-- The last play -->
      @if (arrow(); as a) {
        <g class="arrow" tabindex="0" [attr.aria-label]="a.title" [spfTip]="a.title">
          @if (a.kind === 'none') {
            <line [attr.x1]="a.x1" [attr.y1]="mid - 40" [attr.x2]="a.x1" [attr.y2]="mid + 40" class="no-gain" />
          } @else {
            <path [attr.d]="a.d" class="shadow" />
            <path [attr.d]="a.d" [attr.class]="a.gain ? 'gain' : 'loss'" [attr.marker-end]="a.gain ? 'url(#head-gain)' : 'url(#head-loss)'" />
            <!-- a wide invisible copy, so the tooltip is easy to hit -->
            <path [attr.d]="a.d" class="hit" />
          }
        </g>
      }

      <!-- The ball, standing on its spot -->
      @if (spot(); as sp) {
        <g [attr.transform]="'translate(' + sp.los + ' ' + mid + ')'" aria-hidden="true">
          <ellipse rx="10" ry="17" class="football" />
          <path d="M0 -9V9M-3.5 -5H3.5M-3.5 -1.7H3.5M-3.5 1.7H3.5M-3.5 5H3.5" class="laces" />
        </g>
      }
    </svg>
    <spf-weather-layer />
  `,
  styles: `
    /* The weather is drawn over the field, the same size (WeatherLayer). */
    :host { display: block; position: relative; }
    svg { display: block; width: 100%; height: auto; border-radius: 6px; box-shadow: 0 2px 10px rgba(0, 0, 0, .35); }
    .grass-a { fill: #2f7a3a; }
    .grass-b { fill: #2b7235; }
    .endzone { fill: #245f2d; }
    .ez-name { fill: rgba(255, 255, 255, .85); font-weight: 700; font-family: system-ui, sans-serif; text-anchor: middle; dominant-baseline: middle; text-transform: uppercase; }
    .yardline { stroke: rgba(255, 255, 255, .85); stroke-width: 2.2; }
    .goalline { stroke: white; stroke-width: 5; }
    .hash { stroke: rgba(255, 255, 255, .8); stroke-width: 1.6; }
    .number { fill: rgba(255, 255, 255, .85); font: 700 38px system-ui, sans-serif; text-anchor: middle; }
    .border { fill: none; stroke: white; stroke-width: 6; }
    .los { stroke: #3b82f6; stroke-width: 4; opacity: .9; }
    .to-gain { stroke: #ffd400; stroke-width: 4; opacity: .95; }
    .football { fill: #8b4513; stroke: white; stroke-width: 2; }
    .laces { stroke: white; stroke-width: 1.8; fill: none; }
    .arrow { cursor: help; outline: none; }
    .arrow path { fill: none; stroke-linecap: round; }
    .shadow { stroke: rgba(0, 0, 0, .45); stroke-width: 12; }
    .gain { stroke: #6dff7a; stroke-width: 6; }
    .loss { stroke: #ff5a5a; stroke-width: 6; }
    .hit { stroke: transparent; stroke-width: 40; }
    .no-gain { stroke: #111; stroke-width: 8; stroke-linecap: round; }
    .arrow:focus-visible .shadow { stroke: rgba(255, 255, 255, .6); }
  `,
})
export class FieldView {
  private readonly game = inject(GameStore);
  protected readonly yard = Y;
  protected readonly length = LENGTH;
  protected readonly width = WIDTH;
  protected readonly mid = MID;
  protected readonly hashTop = HASH;
  protected readonly hashBottom = WIDTH - HASH;
  protected readonly xOf = xOf;
  protected readonly stripes = Array.from({ length: 20 }, (_, i) => i);
  protected readonly fiveYardLines = Array.from({ length: 19 }, (_, i) => (i + 1) * 5);
  protected readonly hashes = Array.from({ length: 99 }, (_, i) => i + 1).filter(i => i % 5 !== 0);
  protected readonly numbers = [10, 20, 30, 40, 50, 60, 70, 80, 90].map(at => ({ at, label: String(at <= 50 ? at : 100 - at) }));

  protected readonly names = computed(() => {
    const t = this.game.teams();
    const home = t?.home.shortName ?? 'Home';
    const away = t?.away.shortName ?? 'Away';
    return { home, away, homeSize: endZoneSize(home), awaySize: endZoneSize(away) };
  });

  /** Where the ball is and the line to gain, on the drawing. */
  protected readonly spot = computed(() => {
    const s = this.game.state();
    if (!s || s.ballOn === null || !s.possession) return null;
    const at = absolute(s.ballOn, s.possession);
    const goalToGo = s.ballOn + s.distance >= 100;
    const gain = s.possession === 'home' ? at + s.distance : at - s.distance;
    return { los: xOf(at), toGain: goalToGo || s.phase !== 'PLAY' ? null : xOf(gain) };
  });

  /** The last run or pass, from where it started to where it ended. */
  protected readonly arrow = computed(() => {
    const s = this.game.state();
    const events = s?.events ?? [];
    const snap = [...events].reverse().find(e => e.type === 'SNAP');
    if (!s || !snap || snap.type !== 'SNAP' || snap.ballOn === undefined) return null;
    const play = events.filter(e => e.play === snap.play);
    let yards: number | null = null;
    let pass = false;
    for (const e of play) {
      if (e.type === 'RUSH') yards = e.yards;
      if (e.type === 'PASS' && e.complete) { yards = e.yards; pass = true; }
      if (e.type === 'SACK') yards = -e.yards;
    }
    if (yards === null) return null;
    const dir = snap.side === 'home' ? 1 : -1;
    const x1 = xOf(absolute(snap.ballOn, snap.side));
    // Stop just short of the ball where the play ended, so the arrowhead isn't hidden under it.
    const end = x1 + dir * yards * Y;
    const x2 = Math.abs(end - x1) > 30 ? end - Math.sign(end - x1) * 16 : end;
    const lift = Math.min(170, 60 + Math.abs(x2 - x1) * 0.35);
    const d = pass ? `M${x1} ${MID} Q${(x1 + x2) / 2} ${MID - 2 * lift} ${x2} ${MID}` : `M${x1} ${MID} L${x2} ${MID}`;
    const title = this.lastPlayLine() ?? `${yards} yards`;
    return { kind: yards === 0 ? 'none' : pass ? 'pass' : 'run', gain: yards > 0, x1, d, title };
  });

  /** The play's own result line, for the tooltip. */
  private lastPlayLine(): string | null {
    const log = this.game.state()?.log ?? [];
    const entry = [...log].reverse().find(e => e.steps.length && e.result && e.title.includes(':'));
    return entry ? `${entry.title} — ${entry.result}` : null;
  }

  protected readonly label = computed(() => {
    const sp = this.spot();
    const s = this.game.state();
    if (!s || !sp || s.ballOn === null) return 'The field';
    const where = s.ballOn <= 50 ? `own ${s.ballOn}` : `opponents' ${100 - s.ballOn}`;
    return `The field. ${this.names()[s.possession!]} have the ball on their ${where}.`;
  });
}
