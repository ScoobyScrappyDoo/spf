import { Component, computed, input, output } from '@angular/core';
import { Crutches } from '../crutches/crutches';
import { Hourglass } from '../hourglass/hourglass';
import { Lineup, OffenseFormation, OffenseSlot, PlayerCard, SLOT_GROUP, SLOT_LABELS, SLOT_POSITION, slotsOnField } from '../../engine';

/** The offensive display (rule 3.1): five linemen and ends on the first row, backfield and flankers behind. */
import { Tooltip } from '../../shared/tooltip';
@Component({
  selector: 'spf-offense-board',
  imports: [Tooltip, Crutches, Hourglass],
  template: `
    <div class="board" role="group" aria-label="Offensive display">
      @for (s of slots(); track s.slot) {
        <button
          type="button"
          [class]="s.group"
          [class.target]="s.slot === target()"
          [class.hurt]="s.injured"
          [class.inspected]="s.slot === inspected()"
          [style.grid-row]="s.row"
          [style.grid-column]="s.col"
          [attr.aria-label]="s.label + ': ' + (s.name || 'empty') + (s.injured ? ', injured' : s.resting ? ', resting' : '')"
          [spfTip]="s.resting ? s.name + ' is resting: ' + s.resting : s.name"
          [attr.aria-pressed]="s.slot === inspected()"
          (click)="slotClick.emit(s.slot)"
        >
          <span class="code">{{ s.slot }}</span>
          @if (s.injured) { <spf-crutches class="crutches" [size]="18" /> } @else if (s.resting) { <spf-hourglass class="hourglass" [size]="17" /> }
          <span class="name">{{ s.name }}</span>
          @if (s.slot === target()) {
            <svg class="ball" viewBox="0 0 24 14" aria-hidden="true"><ellipse cx="12" cy="7" rx="11" ry="6.2" /><path d="M7 7h10M10 5v4M12 5v4M14 5v4" /></svg>
          }
        </button>
      }
    </div>
  `,
  styles: `
    /* Tiles are a fixed size, the same as the defensive boxes: 3.6rem wide, card-shaped. */
    .board { display: grid; grid-template-columns: repeat(9, 3.6rem); grid-template-rows: repeat(2, auto); gap: .55rem; justify-content: center; }
    button {
      position: relative; aspect-ratio: 5 / 8.4; border: 0; border-radius: 2px; padding: 4px 2px; cursor: pointer;
      display: flex; flex-direction: column; justify-content: space-between; align-items: center;
      color: #1f2a1f; box-shadow: 0 2px 0 rgba(0,0,0,.25); transition: transform .08s;
    }
    button:hover { transform: translateY(-2px); }
    .line { background: var(--spf-line); }
    .end, .flanker, .back { background: var(--spf-skill); }
    .qb { background: var(--spf-qb); }
    .inspected { outline: 3px solid white; outline-offset: 2px; }
    .code { font-size: 11px; font-weight: 600; opacity: .7; }
    .name { font-size: 12px; line-height: 1.1; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hurt { filter: saturate(.55); }
    .crutches { color: #7a2e0e; }
    .hourglass { color: #3d4a1f; opacity: .8; }
    .ball { position: absolute; top: -9px; right: -7px; width: 22px; fill: #8b4513; stroke: white; stroke-width: 1.2; }
  `,
})
export class OffenseBoard {
  readonly formation = input.required<OffenseFormation>();
  readonly lineup = input.required<Lineup>();
  readonly players = input.required<Map<string, PlayerCard>>();
  readonly target = input<OffenseSlot | null>(null);
  readonly inspected = input<OffenseSlot | null>(null);
  readonly injured = input<ReadonlySet<string>>(new Set());
  /** Slots whose player may not be the target right now, with the reason (rule 4.6). */
  readonly resting = input<ReadonlyMap<OffenseSlot, string>>(new Map());
  readonly slotClick = output<OffenseSlot>();

  protected readonly slots = computed(() =>
    slotsOnField(this.formation()).map(slot => {
      const [row, col] = SLOT_POSITION[slot];
      const id = this.lineup()[slot];
      return {
        slot, row, col, group: SLOT_GROUP[slot], label: SLOT_LABELS[slot],
        name: id ? this.players().get(id)?.lastName ?? '' : '', injured: !!id && this.injured().has(id),
        resting: this.resting().get(slot)?.toLowerCase() ?? null,
      };
    }),
  );
}
