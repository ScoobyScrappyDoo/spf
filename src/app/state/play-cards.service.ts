import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { DealtCard, Fac, LogEntry } from '../engine';
import { GameStore } from './game.store';

/** One card of the last play, with the log entry and step that read it. */
export interface ShownCard {
  card: Fac;
  dealt: DealtCard;
  entry: LogEntry;
  /** Its place in the carousel (0 = the first card dealt). */
  index: number;
  /** The extra point's card, after a touchdown. */
  extraPoint: boolean;
}

/**
 * The cards of the last play and the one in focus, shared by the carousel (PlayCards) and the Last play box: a click on
 * "Card 2/3" next to a step turns the carousel to that card, and the step whose card is in focus is highlighted.
 * A service holding signals is Angular's simple way for two components to share state: both inject the same instance.
 */
@Injectable({ providedIn: 'root' })
export class PlayCardsService {
  private readonly game = inject(GameStore);
  private readonly deck = computed(() => new Map((this.game.cards() ?? []).map(c => [c.id, c])));

  /**
   * The entries whose cards to show: the latest one with cards; after a touchdown that is the extra point, so the
   * scoring play's cards come first (the Last play box shows the two together too). A penalty choice has no cards of
   * its own: the play it came from has.
   */
  private readonly picked = computed<number[]>(() => {
    const log = this.game.state()?.log ?? [];
    const withCards = (from: number) => {
      for (let i = from; i >= 0; i--) if (log[i].cards?.length) return i;
      return -1;
    };
    const last = withCards(log.length - 1);
    if (last < 0) return [];
    if (!log[last].title.startsWith('Touchdown')) return [last];
    const play = withCards(last - 1);
    return play >= 0 ? [play, last] : [last];
  });

  private readonly entries = computed<LogEntry[]>(() => {
    const log = this.game.state()?.log ?? [];
    return this.picked().map(i => log[i]);
  });

  /**
   * Which play the carousel shows, as plain text: the log places of its entries and their cards. Online, every message
   * from the server is a fresh copy of the game (the other coach got ready, a draft changed…), so the cards are new
   * objects each time; this text only changes when a new play really brings new cards.
   */
  private readonly playKey = computed(() => {
    const log = this.game.state()?.log ?? [];
    return this.picked().map(i => `${i}:${(log[i].cards ?? []).map(c => `${c.id}.${c.step}`).join(',')}`).join('|');
  });

  readonly cards = computed<ShownCard[]>(() => {
    const deck = this.deck();
    const out: ShownCard[] = [];
    for (const entry of this.entries()) {
      for (const dealt of entry.cards ?? []) {
        const card = deck.get(dealt.id);
        if (card) out.push({ card, dealt, entry, index: out.length, extraPoint: entry.title.startsWith('Touchdown') });
      }
    }
    return out;
  });

  /** The play's title, for the carousel's label. */
  readonly title = computed(() => this.entries()[0]?.title ?? '');

  /** The card in focus: the first one when a new play comes in, so the play reads from its start. */
  readonly focused = signal(0);

  constructor() {
    // An effect runs again whenever a signal it reads changes: here, only when a new play brings new cards (the
    // play's key, not the cards themselves: those are new objects with every online update).
    effect(() => {
      this.playKey();
      untracked(() => this.focused.set(0));
    });
  }

  focus(index: number) {
    const n = this.cards().length;
    if (n) this.focused.set(Math.min(n - 1, Math.max(0, index)));
  }

  /** The cards a step read: for the "Card 2/3" links in Last play. */
  ofStep(entry: LogEntry, step: number): ShownCard[] {
    return this.cards().filter(c => c.entry === entry && c.dealt.step === step);
  }

  /** All the cards of an entry: the extra point's card under the touchdown line. */
  ofEntry(entry: LogEntry): ShownCard[] {
    return this.cards().filter(c => c.entry === entry);
  }
}
