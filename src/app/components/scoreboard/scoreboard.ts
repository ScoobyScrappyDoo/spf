import { Component, computed, inject } from '@angular/core';
import { clockText, Side, situationText } from '../../engine';
import { GameStore } from '../../state/game.store';

@Component({
  selector: 'spf-scoreboard',
  template: `
    @if (game.state(); as s) {
      <section aria-label="Scoreboard">
        @for (side of sides; track side) {
          <div class="row" [class.ball]="s.possession === side">
            <span class="team">
              @if (s.possession === side) {
                <svg class="football" viewBox="0 0 24 14" aria-label="has the ball"><ellipse cx="12" cy="7" rx="11" ry="6.2" /><path d="M7 7h10M10 5v4M12 5v4M14 5v4" /></svg>
              }
              {{ game.label(side) }}
            </span>
            <span class="timeouts" [attr.aria-label]="s.timeouts[side] + ' timeouts left'">
              @for (t of [1, 2, 3]; track t) { <i [class.used]="t > s.timeouts[side]"></i> }
            </span>
            <span class="score">{{ s.score[side] }}</span>
          </div>
        }
        <div class="clock">{{ clock() }}</div>
        @if (situation()) { <div class="situation">{{ situation() }}</div> }
      </section>
    }
  `,
  styles: `
    section { background: var(--spf-paper); border-radius: var(--radius-panel); padding: .8rem 1rem; color: var(--spf-ink); }
    .row { display: grid; grid-template-columns: 1fr auto 2.5rem; align-items: center; gap: .6rem; padding: .3rem 0; }
    .row + .row { border-top: 1px solid #e5e7eb; }
    .team { display: flex; align-items: center; gap: .4rem; font-weight: 600; }
    .football { width: 20px; fill: #8b4513; stroke: white; stroke-width: 1.2; }
    .score { font-size: 1.6rem; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
    .timeouts { display: flex; gap: 3px; }
    .timeouts i { width: 7px; height: 7px; border-radius: 50%; background: var(--spf-frame); }
    .timeouts i.used { background: #d1d5db; }
    .clock { margin-top: .5rem; text-align: center; font-size: 1.2rem; font-variant-numeric: tabular-nums; }
    .situation { text-align: center; color: var(--spf-ink-soft); font-size: .9rem; }
  `,
})
export class Scoreboard {
  protected readonly game = inject(GameStore);
  protected readonly sides: Side[] = ['away', 'home'];
  protected readonly clock = computed(() => (this.game.state() ? clockText(this.game.state()!) : ''));
  protected readonly situation = computed(() => (this.game.state() ? situationText(this.game.state()!) : ''));
}
