import { quarterLabel } from '../../engine';
import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { GameStore } from '../../state/game.store';
import { PlayCardsService } from '../../state/play-cards.service';

/**
 * The latest play and how it ended, for both coaches to see straight away.
 * A penalty choice can be made right here; kickoffs happen on the Game tab.
 */
@Component({
  selector: 'spf-last-play',
  imports: [RouterLink, NgTemplateOutlet],
  template: `
    @if (game.state(); as s) {
      @if (decisions() && s.phase === 'PENALTY_CHOICE' && s.pendingPenalty; as p) {
        <section class="decision" aria-live="polite">
          <h2>Penalty: {{ game.label(p.chooser) }} decide</h2>
          <p>{{ p.description }}</p>
          <div class="actions">
            <button type="button" class="primary" (click)="game.choosePenalty(true)">Accept</button>
            <button type="button" (click)="game.choosePenalty(false)">Decline</button>
          </div>
        </section>
      }
      <!-- One item per entry, so a new play gets a fresh box (scrolled to the top when it has to scroll). -->
      @for (e of shownEntry(); track e) {
        <section class="last" aria-live="polite" aria-label="Last play">
          <p class="kicker">Last play · {{ q(e.quarter) }} {{ clock(e.clock) }}</p>
          <h2>{{ e.title }}</h2>
          @if (e.result) { <p class="result">{{ e.result }}</p> }
          <ol>
            @for (step of e.steps; track $index) {
              <li>{{ step }}@if (cardLinks()) { <ng-container *ngTemplateOutlet="links; context: { $implicit: plays.ofStep(e, $index) }" /> }</li>
            }
          </ol>
          @if (score(); as t) {
            <p class="score">{{ t.title }}! {{ t.steps.at(-1) }} {{ t.result }}@if (cardLinks()) { <ng-container *ngTemplateOutlet="links; context: { $implicit: plays.ofEntry(t) }" /> }</p>
          }
        </section>
      }
      <!-- "FAC 2/3" after a step: the card it read; a click shows that card in the carousel. -->
      <ng-template #links let-cards>
        @for (c of $any(cards); track c.index) {
          <button type="button" class="fac" [class.on]="c.index === plays.focused()" (click)="plays.focus(c.index)"
            [attr.aria-label]="'Show card ' + (c.index + 1) + ' of ' + plays.cards().length">FAC {{ c.index + 1 }}/{{ plays.cards().length }}</button>
        }
      </ng-template>
      @if (nextUp() && s.phase === 'KICKOFF') {
        <p class="next">Next up: the kickoff, on the <a routerLink="/game">Game tab</a>.</p>
      }
    }
  `,
  styles: `
    :host { display: grid; gap: .6rem; }
    section { background: var(--spf-paper); border-radius: var(--radius-panel); padding: .7rem .9rem; color: var(--spf-ink); }
    .decision { border: 3px solid var(--spf-frame); }
    h2 { margin: 0 0 .3rem; font-size: 1rem; }
    .kicker { margin: 0; font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--spf-ink-soft); }
    .result { margin: 0 0 .4rem; font-weight: 700; }
    p { margin: .2rem 0; font-size: .88rem; }
    ol { margin: 0; padding-left: 1.1rem; display: grid; gap: .15rem; font-size: .8rem; color: var(--spf-ink-soft); }
    .actions { display: flex; gap: .5rem; margin-top: .5rem; }
    button { font: inherit; padding: .35rem .9rem; border-radius: 5px; cursor: pointer; border: 1.5px solid var(--spf-ink-soft); background: white; }
    button.primary { background: var(--spf-ink); color: white; border-color: var(--spf-ink); }
    .score { margin: .5rem 0 0; padding: .4rem .6rem; border-radius: 5px; background: #fff3c4; font-weight: 700; }
    .next { color: white; margin: 0; font-size: .9rem; }
    .next a { color: white; }
    .fac {
      margin-left: .35rem; padding: 0 .4rem; border: 1px solid #cbd5e1; border-radius: 999px; background: #f1f5f9;
      color: var(--spf-ink-soft); font: inherit; font-size: .68rem; font-weight: 600; line-height: 1.35; white-space: nowrap;
      cursor: pointer; vertical-align: 1px;
    }
    .fac:hover { border-color: var(--spf-ink-soft); }
    .fac.on { background: var(--spf-ink); border-color: var(--spf-ink); color: white; }
    /*
     * Above the cards on the Offense and Defense pages (class "fit"): the steps in two columns, to use the width; if the
     * play still needs more room than there is, it scrolls inside its white box.
     */
    :host(.fit) { display: flex; flex-direction: column; min-height: 0; }
    :host(.fit) .decision { flex: none; }
    :host(.fit) .last { flex: 0 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
    :host(.fit) ol { display: block; columns: 2; column-gap: 2.2rem; }
    :host(.fit) li { break-inside: avoid; margin-bottom: .15rem; }
  `,
})
export class LastPlay {
  protected readonly q = quarterLabel;
  protected readonly game = inject(GameStore);
  /** Offer the penalty choice here (the Game tab has its own buttons for it). */
  readonly decisions = input(true);
  /** Point to the Game tab for kickoffs (not needed on the Game tab itself). */
  readonly nextUp = input(true);
  /** "FAC 2/3" after each step that read a card, linked to the carousel (on the pages that have one). */
  readonly cardLinks = input(false);
  protected readonly plays = inject(PlayCardsService);
  private readonly entries = computed(() => [...(this.game.state()?.log ?? [])].reverse().filter(e => e.steps.length > 0));
  /** A touchdown's own entry only holds the extra point; show it under the play that scored. */
  protected readonly score = computed(() => {
    const [last] = this.entries();
    return last?.title.startsWith('Touchdown') ? last : null;
  });
  /** The latest play (not "End of the quarter"), so the result stays in view. */
  protected readonly entry = computed(() => this.entries()[this.score() ? 1 : 0] ?? null);
  protected readonly shownEntry = computed(() => (this.entry() ? [this.entry()!] : []));

  protected clock(seconds: number) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
}
