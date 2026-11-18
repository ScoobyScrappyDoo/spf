import { Component, computed, inject, signal } from '@angular/core';
import { DEFENSE_CALL_LABELS, DEFENSE_FORMATIONS, PASS_DEFENSES, ROWS, RUN_DEFENSES, RECEIVER_NAMES, ReceiverPosition } from '../../engine';
import { DefenseCallStore } from '../../state/defense-call.store';

type Step = 'formation' | 'defense';

import { Tooltip } from '../../shared/tooltip';
import { defenseFormationText } from '../../shared/formation-text';
@Component({
  imports: [Tooltip],
  selector: 'spf-defense-panel',
  template: `
    <h2>Coach, make your decisions!</h2>
    <div class="body">
      <div class="steps" role="tablist">
        <button type="button" role="tab" [attr.aria-selected]="step() === 'formation'" [class.on]="step() === 'formation'" (click)="step.set('formation')">Choose a formation</button>
        <button type="button" role="tab" [attr.aria-selected]="step() === 'defense'" [class.on]="step() === 'defense'" (click)="step.set('defense')">Select a defense</button>
      </div>
      <div class="content" role="tabpanel">
        @if (store.locked()) {
          <p class="locked">You're all set. Press "Not yet" below to change anything.</p>
        }
        @switch (step()) {
          @case ('formation') {
            <div class="formations">
              @for (f of formations; track f.id) {
                <button type="button" class="thumb" [class.on]="f.id === store.formation().id" [disabled]="store.locked() || store.noHuddle()"
                        (click)="store.chooseFormation(f.id)" [attr.aria-label]="f.name" [spfTip]="describe(f)">
                  <span class="mini">
                    @for (b of f.cells; track b.box) { <i [class.used]="b.used" [class.two]="b.two"></i> }
                  </span>
                  <span class="cap">{{ f.name }}</span>
                </button>
              }
            </div>
          }
          @case ('defense') {
            <div class="two-col">
              <div>
                <h3>Run oriented</h3>
                <ul class="options">
                  @for (c of runDefenses; track c) {
                    <li><button type="button" [class.on]="c === store.call()" [disabled]="store.locked()" (click)="store.chooseCall(c)">{{ labels[c] }}</button></li>
                  }
                </ul>
              </div>
              <div>
                <h3>Pass oriented</h3>
                <ul class="options">
                  @for (c of passDefenses; track c) {
                    <li><button type="button" [class.on]="c === store.call()" [disabled]="store.locked()" (click)="store.chooseCall(c)">{{ labels[c] }}</button>
                      @if (c === 'BLITZ') { <small>Choose the blitzers below</small> }</li>
                  }
                </ul>
              </div>
            </div>
            @if (store.call() === 'BLITZ') {
              <h3>Blitzers <small>rows 2 and 3; they rush and leave their boxes</small></h3>
              <div class="chips">
                @for (c of store.blitzCandidates(); track c.player.id) {
                  <button type="button" [class.on]="store.blitzers().includes(c.player.id)" [disabled]="store.locked()" (click)="store.toggleBlitzer(c.player.id)">{{ c.box }} {{ c.player.lastName }}</button>
                }
              </div>
            }
            @if (store.call() === 'PASS' || store.call() === 'PREVENT') {
              <h3>Coverage <small>{{ store.coverageAllowed().why ?? 'double -7, triple -15 on the receiver' }}</small></h3>
              <div class="chips">
                <button type="button" [class.on]="store.coverageLevel() === 'NONE'" [disabled]="store.locked()" (click)="store.setCoverageLevel('NONE')">None</button>
                <button type="button" [class.on]="store.coverageLevel() === 'DOUBLE'" [disabled]="store.locked() || !store.coverageAllowed().double" (click)="store.setCoverageLevel('DOUBLE')">Double</button>
                <button type="button" [class.on]="store.coverageLevel() === 'TRIPLE'" [disabled]="store.locked() || !store.coverageAllowed().triple" (click)="store.setCoverageLevel('TRIPLE')" spfTip="Only in the 3-2-6">Triple</button>
                @if (store.coverageLevel() !== 'NONE' && store.coverageAllowed().double) {
                  <span class="sep"></span>
                  @for (r of receivers; track r) {
                    <button type="button" [class.on]="store.coveredReceivers().includes(r)" [disabled]="store.locked()" (click)="store.toggleCovered(r)">{{ receiverNames[r] }}</button>
                  }
                }
              </div>
            }
          }
        }
      </div>
    </div>
    <dl class="summary">
      <dt>Defense</dt><dd>{{ labels[store.call()] }}</dd>
    </dl>
  `,
  styles: `
    :host { display: block; color: white; }
    h2 { margin: 0 0 .45rem; text-align: center; font-weight: 400; font-size: 1.2rem; }
    h3 { margin: .2rem 0 .35rem; font-size: .85rem; font-weight: 600; color: #ffd27a; }
    h3 small { font-weight: 400; color: rgba(255, 255, 255, .7); margin-left: .4rem; }
    .chips { display: flex; flex-wrap: wrap; gap: .25rem; align-items: center; margin-bottom: .3rem; }
    .chips button { font: inherit; font-size: .74rem; padding: .12rem .42rem; border-radius: 999px; border: 1px solid rgba(255, 255, 255, .5); background: transparent; color: white; cursor: pointer; }
    .chips button.on { background: #ffd27a; color: #2b2410; border-color: #ffd27a; }
    .chips button:disabled { opacity: .4; cursor: not-allowed; }
    .chips .sep { width: .3rem; }
    .body { display: grid; grid-template-columns: 11rem 1fr; gap: 1rem; min-height: 11rem; }
    .steps { display: flex; flex-direction: column; gap: .35rem; }
    .steps button, .options button {
      text-align: left; background: transparent; border: 1.5px solid rgba(255,255,255,.8); border-radius: 5px;
      padding: .3rem .6rem; color: white; cursor: pointer; font-size: .9rem;
    }
    .steps button.on { background: rgba(0,0,0,.25); border-color: white; color: var(--spf-line); }
    .steps button:hover:not(.on), .options button:hover:not(:disabled):not(.on) { background: rgba(255,255,255,.12); }
    .options { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
    .options button { width: 100%; }
    .options button.on { background: white; color: var(--page-defense); border-color: white; font-weight: 600; }
    button:disabled { cursor: not-allowed; opacity: .55; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .locked { margin: 0 0 .5rem; font-size: .85rem; color: var(--spf-line); }
    .formations { display: grid; grid-template-columns: repeat(4, 1fr); gap: .4rem; }
    .thumb { background: var(--spf-line); border: 2px solid #134e4b; border-radius: 3px; padding: .3rem; cursor: pointer; display: grid; gap: .25rem; }
    .thumb.on { border-color: var(--spf-frame); box-shadow: 0 0 0 2px var(--spf-frame); }
    .mini { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2px; }
    .mini i { display: block; height: .55rem; border: 1px dashed rgba(0,0,0,.18); }
    .mini i.used { background: var(--spf-skill); border: 0; }
    .mini i.two { background: linear-gradient(var(--spf-skill) 45%, transparent 45% 55%, var(--spf-skill) 55%); }
    .cap { font-size: .68rem; color: #134e4b; text-align: left; font-weight: 600; white-space: nowrap; }
    .summary { display: grid; grid-template-columns: 5.5rem 1fr; gap: .3rem .5rem; margin: 1rem 0 0; font-size: .9rem; }
    .summary dt { font-weight: 700; }
    .summary dd { margin: 0; color: var(--spf-line); }
  `,
})
export class DefensePanel {
  protected readonly receivers: ReceiverPosition[] = ['LE', 'RE', 'FL1', 'FL2', 'BK1', 'BK2', 'BK3'];
  protected readonly receiverNames = RECEIVER_NAMES;
  protected readonly blitzNames = computed(() =>
    this.store.blitzCandidates().filter(c => this.store.blitzers().includes(c.player.id)).map(c => `${c.player.lastName} (${c.box})`).join(', '));
  protected readonly coverageText = computed(() =>
    this.store.coverage().map(c => `${c.level === 'TRIPLE' ? 'triple' : 'double'} on ${RECEIVER_NAMES[c.receiver]}`).join(', '));
  protected readonly store = inject(DefenseCallStore);
  protected readonly step = signal<Step>('formation');
  protected readonly labels = DEFENSE_CALL_LABELS;
  protected readonly describe = defenseFormationText;
  protected readonly runDefenses = RUN_DEFENSES;
  protected readonly passDefenses = PASS_DEFENSES;
  protected readonly formations = DEFENSE_FORMATIONS.map(f => ({
    ...f,
    cells: ROWS.flat().map(box => {
      const n = f.slots.filter(s => s.box === box).length;
      return { box, used: n > 0, two: n > 1 };
    }),
  }));
}
