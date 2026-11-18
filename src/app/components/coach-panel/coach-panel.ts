import { Component, computed, inject, signal } from '@angular/core';
import {
  FORMATIONS, GainCell, isPassPlay, isRunPlay, PLAY_LABELS, SLOT_LABELS, SLOT_POSITION, slotsOnField, STRATEGY_LABELS,
} from '../../engine';
import { OffenseCallStore } from '../../state/offense-call.store';
import { GameStore } from '../../state/game.store';
import { fieldGoalBlockedReason, fieldGoalDistance, goodRange, kickerOf, OffensePlay, punterOf, puntersOf } from '../../engine';

type Step = 'formation' | 'player' | 'play' | 'strategy';

import { Tooltip } from '../../shared/tooltip';
import { offenseFormationText } from '../../shared/formation-text';
@Component({
  imports: [Tooltip],
  selector: 'spf-coach-panel',
  template: `
    <h2>Coach, make your decisions!</h2>
    <div class="body">
      <div class="steps" role="tablist">
        @for (s of steps; track s.id) {
          <button type="button" role="tab" [attr.aria-selected]="step() === s.id" [class.on]="step() === s.id" (click)="step.set(s.id)">
            {{ s.label }}
          </button>
        }
      </div>

      <div class="content" role="tabpanel">
        @switch (step()) {
          @case ('formation') {
            <div class="formations">
              @for (f of formations; track f.id) {
                <button type="button" class="thumb" [class.on]="f.id === store.call().formationId" (click)="store.chooseFormation(f.id)" [attr.aria-label]="f.name" [spfTip]="describe(f)">
                  <span class="mini">
                    @for (s of f.cells; track s.slot) { <i [class]="s.kind" [style.grid-row]="s.row" [style.grid-column]="s.col"></i> }
                  </span>
                  <span class="cap">{{ f.name }}</span>
                </button>
              }
            </div>
          }
          @case ('player') {
            <ul class="options">
              @for (slot of store.selectableSlots(); track slot) {
                <li>
                  <button type="button" [class.on]="slot === store.call().slot" [disabled]="store.restReason().has(slot)"
                          [spfTip]="store.restReason().get(slot) ?? ''" (click)="store.chooseTarget(slot)">
                    <b>{{ slot }}</b> {{ nameIn(slot) }}
                  </button>
                  @if (store.restReason().get(slot); as why) { <small>{{ why }}</small> }
                </li>
              }
            </ul>
          }
          @case ('play') {
            <div class="two">
              <div>
                <h3>Running plays</h3>
                <ul class="options">
                  @for (o of runOptions(); track o.value) {
                    <li><button type="button" [disabled]="!o.enabled" [class.on]="o.value === store.call().play && !kicking()" (click)="pickPlay(o.value)" [spfTip]="o.reason ?? ''">
                      <b>{{ o.value }}</b> {{ playLabels[o.value] }}
                    </button>@if (!o.enabled) {<small>{{ o.reason }}</small>}</li>
                  }
                </ul>
              </div>
              <div>
                <h3>Passing plays</h3>
                <ul class="options">
                  @for (o of passOptions(); track o.value) {
                    <li><button type="button" [disabled]="!o.enabled" [class.on]="o.value === store.call().play && !kicking()" (click)="pickPlay(o.value)" [spfTip]="o.reason ?? ''">
                      <b>{{ o.value }}</b> {{ playLabels[o.value] }}
                    </button>@if (!o.enabled) {<small>{{ o.reason }}</small>}</li>
                  }
                </ul>
                <h3>Kicking</h3>
                <ul class="options">
                  <li><button type="button" [class.on]="!!game.puntCall()" (click)="togglePunt()" [disabled]="game.state()?.phase !== 'PLAY'">
                    <b>PT</b> Punt
                  </button></li>
                  <li><button type="button" [class.on]="game.fieldGoalCall()" (click)="toggleFieldGoal()" [disabled]="!!fieldGoalBlocked()"
                      [spfTip]="fieldGoalBlocked() ?? ''">
                    <b>FG</b> Field goal
                  </button>@if (fieldGoalBlocked(); as why) {<small>{{ why }}</small>}</li>
                </ul>
                @if (game.fieldGoalCall()) {
                  <p class="fg">{{ fieldGoal().distance }}-yard try, {{ fieldGoal().kicker }}: {{ fieldGoal().chance }}</p>
                }
                @if (game.puntCall(); as p) {
                  @if (punters().length > 1) {
                    <label class="coffin">Punter
                      <select (change)="choosePunter($any($event.target).value)" aria-label="Punter">
                        @for (pt of punters(); track pt.id) {
                          <option [value]="pt.id" [selected]="pt.id === (p.punterId ?? punters()[0].id)">{{ pt.firstName }} {{ pt.lastName }}</option>
                        }
                      </select>
                    </label>
                  }
                  <div class="coffin">
                    <span id="coffin-label">Coffin corner</span>
                    <div class="yn" role="group" aria-labelledby="coffin-label">
                      <button type="button" [class.on]="!p.coffinCorner" [attr.aria-pressed]="!p.coffinCorner" (click)="coffin(null)">No</button>
                      <button type="button" [class.on]="!!p.coffinCorner" [attr.aria-pressed]="!!p.coffinCorner" (click)="coffin(p.coffinCorner ?? 15)">Yes</button>
                    </div>
                    @if (p.coffinCorner) { <output class="yards">{{ p.coffinCorner }} yards off</output> }
                  </div>
                  @if (p.coffinCorner) {
                    <!-- Drag the marker: 10 to 25 yards off, in 5-yard steps (rule 8.5.6). -->
                    <div class="slider">
                      <input type="range" min="10" max="25" step="5" [value]="p.coffinCorner" aria-label="Yards off the punt"
                        [attr.aria-valuetext]="p.coffinCorner + ' yards off'" (input)="coffin(+$any($event.target).value)" />
                      <div class="ticks" aria-hidden="true">@for (y of coffinYards; track y) { <span>{{ y }}</span> }</div>
                    </div>
                  }
                }
                @if (store.blockerOptions().length && !game.puntCall()) {
                  <h3>Keep in to block</h3>
                  @for (b of store.blockerOptions(); track b) {
                    <label class="check"><input type="checkbox" [checked]="store.call().extraBlockers.includes(b)" (change)="store.toggleBlocker(b)" /> {{ b }} {{ nameIn(b) }}</label>
                  }
                }
              </div>
            </div>
          }
          @case ('strategy') {
            <ul class="options">
              @for (o of store.strategyOptions(); track o.value) {
                <li><button type="button" [disabled]="!o.enabled" [class.on]="o.value === store.call().strategy" (click)="store.chooseStrategy(o.value)" [spfTip]="o.reason ?? ''">
                  {{ strategyLabels[o.value] }}
                </button>@if (!o.enabled) {<small>{{ o.reason }}</small>}</li>
              }
            </ul>
          }
        }
      </div>
    </div>

    <dl class="summary">
      <dt>Player</dt><dd class="code">{{ store.call().slot }}</dd><dd>{{ nameIn(store.call().slot) }}</dd>
      <dt>Play</dt><dd class="code">{{ game.puntCall() ? 'Punt' : game.fieldGoalCall() ? 'Field goal' : store.call().play }}</dd>
      <dd class="column">@if (game.fieldGoalCall()) { {{ fieldGoal().distance }} yards, {{ fieldGoal().kicker }} } @else if (game.puntCall(); as p) { {{ p.coffinCorner ? 'Coffin corner, ' + p.coffinCorner + ' yards off' : 'Punter: ' + punterName() }} } @else { @for (v of column(); track $index) { <span>{{ v }}</span> } }</dd>
      <dt>Strategy</dt><dd class="code">{{ store.call().strategy === 'NONE' ? 'None' : strategyLabels[store.call().strategy] }}</dd>
      <dd>@if (store.call().extraBlockers.length) { Blocking: {{ store.call().extraBlockers.join(', ') }} }</dd>
    </dl>
  `,
  styleUrl: './coach-panel.scss',
})
export class CoachPanel {
  protected readonly store = inject(OffenseCallStore);
  protected readonly describe = offenseFormationText;
  protected readonly game = inject(GameStore);
  /** Rule 8.5.6: a coffin-corner punt takes 10 to 25 yards off; the slider moves in 5-yard steps. */
  protected readonly coffinYards = [10, 15, 20, 25];

  /** Declares the punt out loud, or takes it back (rule 8.5). The defense then sets itself again. */
  togglePunt() {
    this.game.declarePunt(this.game.puntCall() ? null : { coffinCorner: null });
  }

  coffin(yards: number | null) {
    if ((this.game.puntCall()?.coffinCorner ?? null) === yards) return;
    this.game.declarePunt({ ...this.game.puntCall(), coffinCorner: yards });
  }

  choosePunter(punterId: string) {
    this.game.declarePunt({ coffinCorner: this.game.puntCall()?.coffinCorner ?? null, punterId });
  }

  /** The team's punters, when there is a choice to make. */
  protected readonly punters = computed(() => {
    const team = this.store.team();
    return team ? puntersOf(team) : [];
  });

  /** Picking a run or pass takes back a declared punt or field goal. */
  pickPlay(play: OffensePlay) {
    if (this.game.puntCall()) this.game.declarePunt(null);
    if (this.game.fieldGoalCall()) this.game.declareFieldGoal(false);
    this.store.choosePlay(play);
  }

  toggleFieldGoal() {
    this.game.declareFieldGoal(!this.game.fieldGoalCall());
  }

  protected readonly kicking = computed(() => !!this.game.puntCall() || this.game.fieldGoalCall());
  protected readonly fieldGoalBlocked = computed(() => {
    const s = this.game.state();
    return s ? fieldGoalBlockedReason(s) : 'Not now';
  });

  /** The try from here: its length, the kicker and his good range for it. */
  protected readonly fieldGoal = computed(() => {
    const s = this.game.state();
    const team = this.store.team();
    const distance = s?.ballOn != null ? fieldGoalDistance(s.ballOn) : 0;
    const kicker = team ? kickerOf(team) : undefined;
    const range = goodRange(kicker, distance);
    return {
      distance,
      kicker: kicker ? `${kicker.firstName} ${kicker.lastName}` : 'no kicker',
      chance: range ? `good on PN ${range.from}-${range.to} (of 48)` : 'out of his range',
    };
  });

  protected punterName() {
    const team = this.store.team();
    const p = team ? punterOf(team, this.game.puntCall()?.punterId) : undefined;
    return p ? `${p.firstName} ${p.lastName}` : '';
  }
  protected readonly step = signal<Step>('formation');
  protected readonly steps: { id: Step; label: string }[] = [
    { id: 'formation', label: 'Choose a formation' },
    { id: 'player', label: 'Select a player' },
    { id: 'play', label: 'Select a play' },
    { id: 'strategy', label: 'Select a strategy' },
  ];
  protected readonly playLabels = PLAY_LABELS;
  protected readonly strategyLabels = STRATEGY_LABELS;

  protected readonly formations = FORMATIONS.map(f => ({
    ...f,
    cells: slotsOnField(f).map(slot => ({
      slot,
      row: SLOT_POSITION[slot][0],
      col: SLOT_POSITION[slot][1],
      kind: slot === 'QB' ? 'qb' : ['LT', 'LG', 'C', 'RG', 'RT'].includes(slot) ? 'line' : 'skill',
    })),
  }));

  protected readonly runOptions = computed(() => this.store.playOptions().filter(o => isRunPlay(o.value)));
  protected readonly passOptions = computed(() => this.store.playOptions().filter(o => isPassPlay(o.value)));
  protected readonly column = computed(() => this.store.targetColumn().map(display));

  protected nameIn(slot: keyof typeof SLOT_LABELS) {
    const p = this.store.playerIn(slot);
    return p ? `${p.firstName} ${p.lastName}` : '';
  }
}

function display(c: GainCell): string {
  return c === 'SG' ? 'Sg' : c === 'LG' ? 'Lg' : c === 'INC' ? 'inc' : c === 'TD' ? 'TD' : c === null ? '–' : String(c);
}
