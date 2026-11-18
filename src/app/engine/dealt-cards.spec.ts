import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import bills from './testdata/1984/bills.json';
import patriots from './testdata/1984/patriots.json';
import { createGame, Fac, FacDeck, GameContext, simulateGame, simulateStep, Team, viewFor } from './index';

const cards = deckJson as Fac[];
const home = patriots as unknown as Team;
const away = bills as unknown as Team;

/** The cards shown under "Last play" (the carousel) come from the log: it must hold every card, in deck order. */
describe('the cards turned over for each play', () => {
  for (const seed of [11, 2024, 90210]) {
    it(`are all in the log, in the order they came off the deck (seed ${seed})`, () => {
      const ctx: GameContext = { cards, teams: { home, away } };
      const start = createGame({ homeTeamId: home.id, awayTeamId: away.id, seed }, cards);
      const end = simulateGame(start, ctx);
      const logged = end.log.flatMap(e => e.cards ?? []);
      expect(logged.length).toBeGreaterThan(100);

      // The same deck, drawn again card by card, gives the same cards.
      const deck = new FacDeck(cards, start.deck);
      expect(logged.map(c => c.id)).toEqual(logged.map(() => deck.draw().id));
      expect(deck.snapshot().next).toBe(end.deck.next);

      for (const entry of end.log) {
        const dealt = entry.cards ?? [];
        // Z cards are marked as counting or not; nothing else is a Z card.
        for (const c of dealt) expect(c.id.startsWith('Z')).toBe(c.z === 'counts' || c.z === 'ignored');
        // At most one Z card counts on a play, and its result is read from a later card on the same play.
        const counts = dealt.findIndex(c => c.z === 'counts');
        const result = dealt.findIndex(c => c.z === 'result');
        expect(dealt.filter(c => c.z === 'counts').length).toBeLessThanOrEqual(1);
        expect(dealt.filter(c => c.z === 'result').length).toBeLessThanOrEqual(1);
        if (result >= 0) expect(counts).toBeGreaterThanOrEqual(0);
        if (result >= 0) expect(result).toBeGreaterThan(counts);
        // Rule 8.8.1: a Z card counts only among the first three cards.
        if (counts >= 0) expect(counts).toBeLessThan(3);
        // Each card points to the step that reads it, in order: the Z card to its "Z card!", a pass card to its line.
        for (const [i, c] of dealt.entries()) {
          expect(c.step).toBeGreaterThanOrEqual(i ? dealt[i - 1].step! : 0);
          expect(c.step).toBeLessThan(entry.steps.length);
          if (c.z === 'counts') expect(entry.steps[c.step!]).toMatch(/^Z card!/);
          if (c.z === 'result') expect(entry.steps[c.step!]).toMatch(/Z result/);
        }
        const passCard = entry.steps.findIndex(t => t.startsWith('Pass card:'));
        if (passCard >= 0) expect(dealt.some(c => c.step === passCard)).toBe(true);
      }
      // Over a whole game some Z cards turn up and get read.
      expect(logged.some(c => c.z === 'result')).toBe(true);
    });
  }

  it('reach both coaches online: the views the server sends keep the cards of every play', () => {
    const ctx: GameContext = { cards, teams: { home, away } };
    let state = createGame({ homeTeamId: home.id, awayTeamId: away.id, seed: 5 }, cards);
    for (let i = 0; i < 60 && state.phase !== 'GAME_OVER'; i++) state = simulateStep(state, ctx);
    expect(state.phase).not.toBe('GAME_OVER'); // still being played: the views are filtered
    const withCards = state.log.filter(e => e.cards?.length);
    expect(withCards.length).toBeGreaterThan(20);
    for (const seat of ['home', 'away'] as const) {
      expect(viewFor(state, seat).log.filter(e => e.cards?.length)).toEqual(withCards);
    }
  });
});
