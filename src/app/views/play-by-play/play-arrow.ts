import { Component, computed, input } from '@angular/core';
import { DrivePlayKind } from '../../engine';

/**
 * One play as a small picture, from the centre line: a straight arrow for a run, a raised curve for a pass;
 * green to the right for a gain, red to the left for a loss; a black bar for no gain. An incomplete pass is a grey
 * dashed arc, an interception a red one with a cross, a penalty a yellow flag. Kicks get no arrow.
 */
@Component({
  selector: 'spf-play-arrow',
  template: `
    <svg viewBox="0 0 140 28" width="140" height="28" aria-hidden="true">
      <line x1="70" y1="3" x2="70" y2="25" class="centre" />
      @switch (shape().type) {
        @case ('arrow') {
          <path [attr.d]="shape().d" [attr.class]="shape().gain ? 'gain' : 'loss'" />
          <path [attr.d]="shape().head" [attr.class]="shape().gain ? 'head-gain' : 'head-loss'" />
        }
        @case ('bar') { <line x1="70" y1="6" x2="70" y2="22" class="bar" /> }
        @case ('incomplete') { <path d="M70 22 Q84 6 98 22" class="incomplete" /> }
        @case ('interception') {
          <path d="M70 22 Q86 4 102 20" class="pick" />
          <path d="M99 15l7 7M106 15l-7 7" class="pick-x" />
        }
        @case ('flag') { <path d="M68 6v17M68 6h9l-2 3.5 2 3.5h-9" class="flag" /> }
      }
    </svg>
  `,
  styles: `
    :host { display: inline-flex; }
    path, line { fill: none; stroke-linecap: round; }
    .centre { stroke: rgba(255, 255, 255, .25); stroke-width: 1; }
    .gain { stroke: #3fbf52; stroke-width: 3; }
    .loss { stroke: #e5484d; stroke-width: 3; }
    .bar { stroke: #111; stroke-width: 4; }
    .incomplete { stroke: #a3a3a3; stroke-width: 2; stroke-dasharray: 3 3; }
    .pick { stroke: #e5484d; stroke-width: 2; stroke-dasharray: 3 3; }
    .pick-x { stroke: #e5484d; stroke-width: 2.2; }
    .flag { stroke: #ffd400; stroke-width: 2; fill: #ffd400; }
    .head-gain { fill: #3fbf52; stroke: none; }
    .head-loss { fill: #e5484d; stroke: none; }
  `,
})
export class PlayArrow {
  readonly kind = input.required<DrivePlayKind>();
  readonly yards = input(0);

  protected readonly shape = computed(() => {
    const kind = this.kind();
    const y = this.yards();
    if (kind === 'incomplete') return { type: 'incomplete' as const };
    if (kind === 'interception') return { type: 'interception' as const };
    if (kind === 'penalty') return { type: 'flag' as const };
    if (kind !== 'run' && kind !== 'pass' && kind !== 'sack') return { type: 'none' as const };
    if (y === 0) return { type: 'bar' as const };
    const len = Math.max(10, Math.min(60, Math.abs(y) * 2.2)) * Math.sign(y);
    const end = 70 + len;
    // The line stops short of the tip; the head is a small triangle pointing the way the line arrives.
    const tip = { x: end, y: kind === 'pass' ? 21 : 14 };
    let from: { x: number; y: number };
    let d: string;
    if (kind === 'pass') {
      const control = { x: 70 + len / 2, y: 21 - Math.min(18, 6 + Math.abs(len) / 3) };
      d = `M70 21 Q${control.x} ${control.y} ${end} 21`;
      from = control;
    } else {
      d = `M70 14 L${end - Math.sign(len) * 4} 14`;
      from = { x: 70, y: 14 };
    }
    const dx = tip.x - from.x;
    const dy = tip.y - from.y;
    const n = Math.hypot(dx, dy) || 1;
    const ux = dx / n;
    const uy = dy / n;
    const size = 7;
    const base = { x: tip.x - ux * size, y: tip.y - uy * size };
    const head = `M${tip.x} ${tip.y} L${base.x - uy * 4} ${base.y + ux * 4} L${base.x + uy * 4} ${base.y - ux * 4} Z`;
    return { type: 'arrow' as const, d, head, gain: y > 0 };
  });
}
