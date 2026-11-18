import { Component, computed, input, output } from '@angular/core';
import { Crutches } from '../crutches/crutches';
import { DefenseFormation, DefenseLineup, DefensiveBox, PlayerCard, ROWS } from '../../engine';

export interface DefenderClick {
  box: DefensiveBox;
  index: number;
}

/** The defensive display (rule 3.2): line A-E, linebackers F-J, secondary K-O. */
import { Tooltip } from '../../shared/tooltip';
@Component({
  selector: 'spf-defense-board',
  imports: [Tooltip, Crutches],
  template: `
    <div class="board" role="group" aria-label="Defensive display">
      @for (b of boxes(); track b.box) {
        @if (b.players.length) {
          <div class="box" [class.two]="b.players.length > 1">
            @for (p of b.players; track p.id; let i = $index) {
              <button
                type="button"
                [class.inspected]="b.box === inspected()?.box && i === inspected()?.index"
                [class.hurt]="injured().has(p.id)"
                [attr.aria-label]="'Box ' + b.box + ': ' + p.firstName + ' ' + p.lastName + (injured().has(p.id) ? ', injured' : '')"
                [spfTip]="p.firstName + ' ' + p.lastName"
                (click)="defenderClick.emit({ box: b.box, index: i })"
              >
                @if (i === 0) { <span class="code">{{ b.box }}</span> }
                @if (injured().has(p.id)) { <spf-crutches class="crutches" [size]="18" /> }
                <span class="name">{{ p.lastName }}</span>
              </button>
            }
          </div>
        } @else {
          <div class="box empty" [attr.aria-label]="'Box ' + b.box + ': empty'"><span class="code">{{ b.box }}</span></div>
        }
      }
    </div>
  `,
  styles: `
    /* Boxes are the same size as the offensive tiles: 3.6rem wide, card-shaped. */
    .board { display: grid; grid-template-columns: repeat(5, 1fr); row-gap: .55rem; justify-items: center; padding: .2rem 0; }
    .box { width: 3.6rem; aspect-ratio: 5 / 8.4; display: grid; gap: 3px; }
    .box.two { grid-template-rows: 1fr 1fr; }
    .box.empty { border: 1.5px dashed rgba(255, 255, 255, .35); border-radius: 2px; place-items: start center; }
    .box.empty .code { color: rgba(255, 255, 255, .55); padding-top: 4px; }
    button {
      border: 0; border-radius: 2px; background: var(--spf-line); color: #1f2a1f; cursor: pointer; padding: 4px 2px; min-width: 0;
      display: flex; flex-direction: column; justify-content: space-between; align-items: center; min-height: 0;
      box-shadow: 0 2px 0 rgba(0, 0, 0, .25); transition: transform .08s;
    }
    button:hover { transform: translateY(-2px); }
    button.hurt { filter: saturate(.55); }
    .crutches { color: #7a2e0e; }
    button.inspected { outline: 3px solid white; outline-offset: 2px; }
    .two button { justify-content: center; gap: 2px; }
    .code { font-size: 11px; font-weight: 600; opacity: .7; }
    .name { font-size: 12px; line-height: 1.1; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `,
})
export class DefenseBoard {
  readonly formation = input.required<DefenseFormation>();
  readonly lineup = input.required<DefenseLineup>();
  readonly players = input.required<Map<string, PlayerCard>>();
  readonly inspected = input<DefenderClick | null>(null);
  readonly injured = input<ReadonlySet<string>>(new Set());
  readonly defenderClick = output<DefenderClick>();

  protected readonly boxes = computed(() =>
    ROWS.flat().map(box => ({
      box,
      players: (this.lineup()[box] ?? []).map(id => this.players().get(id)).filter((p): p is PlayerCard => !!p),
    })),
  );
}
