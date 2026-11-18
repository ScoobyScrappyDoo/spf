import { Fac } from './model/fac';
import { SeededRandom, shuffle } from './random';

/** Plain data, so it can be saved or sent to the other player as JSON. */
export interface DeckState {
  order: string[];
  next: number;
  reshuffles: number;
  rngState: number;
}

/**
 * The Fast Action Card deck (rule 5.1): shuffle, flip one card per reading, reshuffle when it runs out.
 */
export class FacDeck {
  private readonly byId: Map<string, Fac>;
  private readonly rng: SeededRandom;
  private state: DeckState;

  constructor(private readonly cards: readonly Fac[], seedOrState: number | DeckState) {
    this.byId = new Map(cards.map(c => [c.id, c]));
    if (typeof seedOrState === 'number') {
      this.rng = new SeededRandom(seedOrState);
      this.state = { order: shuffle(cards.map(c => c.id), this.rng), next: 0, reshuffles: 0, rngState: this.rng.state };
    } else {
      this.rng = new SeededRandom(seedOrState.rngState);
      this.state = { ...seedOrState, order: [...seedOrState.order] };
    }
  }

  get remaining(): number {
    return this.state.order.length - this.state.next;
  }

  /** Flips the top card. */
  draw(): Fac {
    if (this.remaining === 0) {
      this.state = {
        order: shuffle(this.cards.map(c => c.id), this.rng),
        next: 0,
        reshuffles: this.state.reshuffles + 1,
        rngState: this.rng.state,
      };
    }
    const card = this.byId.get(this.state.order[this.state.next])!;
    this.state = { ...this.state, next: this.state.next + 1 };
    return card;
  }

  snapshot(): DeckState {
    return { ...this.state, order: [...this.state.order], rngState: this.rng.state };
  }
}
