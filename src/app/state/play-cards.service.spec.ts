import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Fac, GameState, LogEntry } from '../engine';
import { GameStore } from './game.store';
import { PlayCardsService } from './play-cards.service';

const play = (title: string, ids: string[]): LogEntry =>
  ({ quarter: 1, clock: 900, title, steps: [], cards: ids.map((id, step) => ({ id, step })) });
const game = (log: LogEntry[]) => ({ log }) as unknown as GameState;

function setUp(log: LogEntry[]) {
  const state = signal<GameState | null>(game(log));
  const cards = signal<Fac[]>(['a', 'b', 'c', 'd'].map(id => ({ id }) as unknown as Fac));
  TestBed.configureTestingModule({ providers: [{ provide: GameStore, useValue: { state, cards } }] });
  const plays = TestBed.inject(PlayCardsService);
  TestBed.tick();
  return { state, plays };
}

describe('PlayCardsService', () => {
  it('keeps the card in focus when an online update brings a fresh copy of the same game', () => {
    const { state, plays } = setUp([play('Run', ['a', 'b', 'c'])]);
    plays.focus(2);
    // The server sends the whole game again (the other coach got ready, a draft changed): same play, new objects.
    state.set(structuredClone(state()));
    TestBed.tick();
    expect(plays.cards().length).toBe(3);
    expect(plays.focused()).toBe(2);
  });

  it('keeps it too when an entry without cards is added (a penalty choice, a timeout)', () => {
    const { state, plays } = setUp([play('Run', ['a', 'b', 'c'])]);
    plays.focus(1);
    state.set(game([...state()!.log, { quarter: 1, clock: 880, title: 'Timeout', steps: [] }]));
    TestBed.tick();
    expect(plays.focused()).toBe(1);
  });

  it('turns back to the first card when a new play brings new cards', () => {
    const { state, plays } = setUp([play('Run', ['a', 'b', 'c'])]);
    plays.focus(2);
    state.set(game([...state()!.log, play('Pass', ['d', 'a'])]));
    TestBed.tick();
    expect(plays.title()).toBe('Pass');
    expect(plays.focused()).toBe(0);
  });

  it('turns back too when the next play happens to deal the very same cards', () => {
    const { state, plays } = setUp([play('Run', ['a', 'b'])]);
    plays.focus(1);
    state.set(game([...state()!.log, play('Run', ['a', 'b'])]));
    TestBed.tick();
    expect(plays.focused()).toBe(0);
  });
});
