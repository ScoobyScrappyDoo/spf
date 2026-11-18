import { Component, computed, inject, input } from '@angular/core';
import { PlayerCard } from '../../engine';
import { GameStore } from '../../state/game.store';
import { PlayCardsService } from '../../state/play-cards.service';
import { FacCardView } from '../fac-card/fac-card';
import { PlayerCardView } from '../player-card/player-card';

/**
 * The cards of the last play, Z cards included, as a small deck: the card in focus in front, the one before it and
 * the one after it a little smaller behind it, just their edges showing, with the arrow buttons on them. It opens on
 * the first card dealt. Click an edge, use the arrows (buttons or keys) or the mouse wheel to move through the cards; the
 * "Card 2/3" links in Last play do the same. On the Offense and Defense pages, so both coaches see the same cards.
 */
@Component({
  selector: 'spf-play-cards',
  imports: [FacCardView, PlayerCardView],
  template: `
    @if (cards().length) {
      <div class="deck" tabindex="0" role="region" [attr.aria-label]="'Cards of the last play: ' + plays.title()"
        (keydown.arrowleft)="plays.focus(focused() - 1); $event.preventDefault()"
        (keydown.arrowright)="plays.focus(focused() + 1); $event.preventDefault()"
        (keydown.home)="plays.focus(0)" (keydown.end)="plays.focus(cards().length - 1)" (wheel)="wheel($event)">
        <!-- An invisible quarterback card in the middle column sets the height: every card is a player card's size. -->
        @if (sizerCard(); as qb) {
          <spf-player-card class="sizer" [player]="qb" [teamName]="sizerTeam()" aria-hidden="true" />
        }
        @for (c of cards(); track $index) {
          @let off = $index - focused();
          <spf-fac-card class="slide" [class.focused]="off === 0" [class.before]="off < 0" [class.after]="off > 0"
            [class.away]="off < -1 || off > 1" [style.z-index]="off === 0 ? 3 : off === -1 || off === 1 ? 2 : 1"
            [attr.aria-hidden]="off !== 0" [card]="c.card" [dealt]="c.dealt"
            [label]="(c.extraPoint ? 'Extra point · ' : 'Card ') + ($index + 1) + ' of ' + cards().length"
            (click)="plays.focus($index)" />
        }
        @if (focused() > 0) {
          <button type="button" class="arrow earlier" (click)="plays.focus(focused() - 1)" aria-label="Earlier card">‹</button>
        }
        @if (focused() < cards().length - 1) {
          <button type="button" class="arrow later" (click)="plays.focus(focused() + 1)" aria-label="Later card">›</button>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    /*
     * Three columns: the edge of the card before, the card in focus, the edge of the card after. Every card sits in
     * the middle column; the ones before and after are moved out by --peek and made a little smaller, so they look
     * a step behind. The space either side is kept even on the first and last card, so the card never moves.
     */
    .deck {
      --peek: 3.2rem;
      position: relative; display: grid; grid-template-columns: var(--peek) 18.5rem var(--peek); width: max-content;
      outline: none;
    }
    .deck:focus-visible { outline: 2px solid var(--spf-frame); outline-offset: 4px; border-radius: var(--radius-panel); }
    .sizer, .slide { grid-area: 1 / 2; }
    .sizer { visibility: hidden; }
    .slide { transition: transform .25s ease, opacity .25s ease; }
    /* A soft shadow: the card in focus lies on top of the others. */
    .slide.focused { filter: drop-shadow(0 3px 8px rgba(0, 0, 0, .35)); }
    .slide.before { transform: translateX(calc(-1 * var(--peek))) scale(.94); cursor: pointer; }
    .slide.after { transform: translateX(var(--peek)) scale(.94); cursor: pointer; }
    /* Further away: tucked behind the neighbours, out of sight, ready to slide in. */
    .slide.away { opacity: 0; pointer-events: none; }
    /* The card in focus has black text; the ones behind it are lighter. */
    .slide:not(.focused) { --fac-ink: #a3aab5; --fac-soft: #b9bec7; --fac-mark: #fffaf0; }
    .arrow {
      position: absolute; top: 50%; z-index: 4; transform: translate(-50%, -50%); width: 2.2rem; height: 2.2rem;
      padding: 0 0 .15rem; border: 2px solid white; border-radius: 50%; background: var(--spf-ink); color: white;
      font: inherit; font-size: 1.5rem; line-height: 1; cursor: pointer; box-shadow: 0 1px 4px rgba(0, 0, 0, .35); opacity: .9;
    }
    .arrow:hover { opacity: 1; }
    /* In the middle of the visible edge, which runs from 3 % of a card in (the smaller card) to the peek. */
    .earlier { left: calc((var(--peek) + 18.5rem * .03) / 2); }
    .later { left: calc(100% - (var(--peek) + 18.5rem * .03) / 2); }
  `,
})
export class PlayCards {
  private readonly game = inject(GameStore);
  protected readonly plays = inject(PlayCardsService);
  /** The card that sizes the player card next to the carousel, so both are the same height. */
  readonly sizer = input<PlayerCard | undefined>(undefined);
  readonly teamName = input('');

  protected readonly cards = this.plays.cards;
  protected readonly focused = this.plays.focused;
  private wheelDelta = 0;

  protected readonly sizerCard = computed(() => this.sizer() ?? this.game.teams()?.home.players.find(p => p.position === 'QB'));
  protected readonly sizerTeam = computed(() => {
    if (this.sizer()) return this.teamName();
    const t = this.game.teams()?.home;
    return t ? `${t.year} ${t.name}` : '';
  });

  /** The mouse wheel moves the focus one card at a time (a touchpad's small steps add up to one). */
  protected wheel(e: WheelEvent) {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    e.preventDefault();
    this.wheelDelta += delta;
    if (Math.abs(this.wheelDelta) < 50) return;
    this.plays.focus(this.focused() + Math.sign(this.wheelDelta));
    this.wheelDelta = 0;
  }
}
