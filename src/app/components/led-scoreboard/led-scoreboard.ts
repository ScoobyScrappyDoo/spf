import { Component, computed, inject } from '@angular/core';
import { GameState, Side } from '../../engine';
import { GameStore } from '../../state/game.store';
import { Dot, textDots, textWidth } from './dot-font';

/** One run of lit-and-unlit dots in one colour. */
interface Run {
  dots: Dot[];
  r: number;
  color: string;
}

const W = 240;
/** Room for a team name in its half, with a margin to the panel edge and the centre divider. */
const NAME_SPACE = 76;
const AMBER = '#ffb02e';
const WHITE = '#f3f3f3';
const RED = '#ff4d4d';

/**
 * A stadium scoreboard: every character drawn as a 5x7 grid of LED dots on a dark panel. The unlit dots stay faintly
 * visible, like the real thing. Away on the left, home on the right; it scales with the page width.
 */
@Component({
  selector: 'spf-led-scoreboard',
  template: `
    @if (board(); as b) {
      <svg [attr.viewBox]="'0 0 ' + width + ' 64'" role="img" [attr.aria-label]="b.label" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="led-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="0.6" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect x="0.5" y="0.5" [attr.width]="width - 1" height="63" rx="3" class="panel" />
        <line x1="90" y1="4" x2="90" y2="47" class="rule" />
        <line [attr.x1]="width - 90" y1="4" [attr.x2]="width - 90" y2="47" class="rule" />
        <line x1="4" y1="48" [attr.x2]="width - 4" y2="48" class="rule" />
        @for (run of b.runs; track $index) {
          <g>
            @for (d of run.dots; track $index) {
              @if (!d.on) { <circle [attr.cx]="d.x" [attr.cy]="d.y" [attr.r]="run.r" class="off" /> }
            }
          </g>
          <g filter="url(#led-glow)">
            @for (d of run.dots; track $index) {
              @if (d.on) { <circle [attr.cx]="d.x" [attr.cy]="d.y" [attr.r]="run.r" [attr.fill]="run.color" /> }
            }
          </g>
        }
        @for (l of b.lamps; track $index) {
          <circle [attr.cx]="l.x" [attr.cy]="l.y" r="1.5" [attr.fill]="l.on ? red : '#4a2626'" [attr.filter]="l.on ? 'url(#led-glow)' : null" />
        }
        @if (b.ball; as ball) {
          <g [attr.transform]="'translate(' + ball.x + ' ' + ball.y + ')'" aria-hidden="true">
            <ellipse rx="6" ry="3.4" class="football" />
            <path d="M-3.2 0h6.4M-1.6 -1.1v2.2M0 -1.1v2.2M1.6 -1.1v2.2" class="laces" />
          </g>
        }
      </svg>
    }
  `,
  styles: `
    :host { display: block; }
    svg { display: block; width: 100%; height: auto; }
    /* A black face in a gray frame, for more contrast with the lights. */
    .panel { fill: #050505; stroke: #262626; stroke-width: 2; }
    .rule { stroke: #3a3a3a; stroke-width: .4; }
    .off { fill: #353535; }
    .football { fill: #8b4513; stroke: #f3f3f3; stroke-width: .5; }
    .laces { stroke: #f3f3f3; stroke-width: .45; fill: none; }
  `,
})
export class LedScoreboard {
  private readonly game = inject(GameStore);
  protected readonly width = W;
  protected readonly red = RED;

  protected readonly board = computed(() => {
    const s = this.game.state();
    if (!s) return null;
    const runs: Run[] = [];
    const text = (t: string, x: number, y: number, pitch: number, color: string) =>
      runs.push({ dots: textDots(t, x, y, pitch), r: 0.38 * pitch, color });
    const fit = (t: string, room: number) => Math.min(1, room / textWidth(t, 1));

    // Team names along the top, each in its own half, shrunk to fit if long ("LOS ANGELES (N)").
    const away = this.name('away');
    const home = this.name('home');
    const pa = fit(away, NAME_SPACE);
    const ph = fit(home, NAME_SPACE);
    text(away, 46 - textWidth(away, pa) / 2, 5, pa, WHITE);
    text(home, W - 46 - textWidth(home, ph) / 2, 5, ph, WHITE);

    // Scores, big, under the names.
    const score = (n: number) => String(n).padStart(2, ' ');
    text(score(s.score.away), 46 - textWidth('00', 3) / 2, 16, 3, AMBER);
    text(score(s.score.home), W - 46 - textWidth('00', 3) / 2, 16, 3, AMBER);

    // Quarter and clock in the middle.
    const quarter = s.phase === 'GAME_OVER' ? 'FINAL' : s.quarter >= 5 ? 'OT' : `QTR ${s.quarter}`;
    text(quarter, W / 2 - textWidth(quarter, 1) / 2, 5, 1, WHITE);
    const clock = `${Math.floor(s.clock / 60)}:${String(s.clock % 60).padStart(2, '0')}`.padStart(5, ' ');
    text(clock, W / 2 - textWidth('00:00', 2) / 2, 18, 2, AMBER);

    // Timeouts left: three lamps under each score.
    const lamps: { x: number; y: number; on: boolean }[] = [];
    (['away', 'home'] as Side[]).forEach(side => {
      const cx = side === 'away' ? 46 : W - 46;
      text('TOL', cx - 20, 41, 0.8, WHITE);
      for (let i = 0; i < 3; i++) lamps.push({ x: cx - 1 + i * 6, y: 43.5, on: i < (s.timeouts?.[side] ?? 3) });
    });

    // Down, distance and where the ball is, along the bottom.
    const line = this.situation(s);
    const pl = Math.min(1, (W - 12) / textWidth(line, 1));
    text(line, W / 2 - textWidth(line, pl) / 2, 53, pl, AMBER);

    // The football by the team with the ball.
    const ball = s.possession ? { x: s.possession === 'away' ? 46 + 26 : W - 46 - 26, y: 26.5 } : null;
    const label = `${away} ${s.score.away}, ${home} ${s.score.home}. ${quarter}, ${clock.trim()}. ${line}.`;
    return { runs, lamps, ball, label };
  });

  private name(side: Side): string {
    return this.game.teams()?.[side].shortName ?? side;
  }

  private situation(s: GameState): string {
    switch (s.phase) {
      case 'COIN_TOSS':
      case 'TOSS_CHOICE':
        return 'COIN TOSS';
      case 'KICKOFF':
        return 'KICKOFF';
      case 'PENALTY_CHOICE':
        return 'FLAG ON THE PLAY';
      case 'GAME_OVER':
        return 'FINAL';
    }
    if (s.ballOn === null) return '';
    const down = ['', '1ST', '2ND', '3RD', '4TH'][s.down];
    const toGo = s.ballOn + s.distance >= 100 ? 'GOAL' : String(s.distance);
    const spot = s.ballOn === 50 ? '50' : s.ballOn < 50 ? `OWN ${s.ballOn}` : `OPP ${100 - s.ballOn}`;
    return `${down} & ${toGo}   BALL ON ${spot}`;
  }
}
