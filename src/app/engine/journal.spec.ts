import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import bills from './testdata/1984/bills.json';
import patriots from './testdata/1984/patriots.json';
import {
  applyEntry, coachTurn, createGame, Fac, GameContext, GameState, JournalEntry, newCoachMemory, rebuildGame, replayFrames, Team, withEntry,
} from './index';

const cards = deckJson as Fac[];
const home = bills as unknown as Team;
const away = patriots as unknown as Team;
const ctx: GameContext = { cards, teams: { home, away } };
const start = { homeTeamId: home.id, awayTeamId: away.id, seed: 4242 };

/** A game played the way the app plays it: some decisions by hand, then the computer to the end. */
function playJournaled(): GameState {
  let s = createGame(start, cards);
  let memory = newCoachMemory();
  const act = (e: JournalEntry) => { s = withEntry(s, applyEntry(s, e, ctx, memory), e); };
  act({ t: 'toss', call: 'HEADS' });
  act({ t: 'choice', choice: 'RECEIVE' });
  act({ t: 'kickoff', onside: false });
  memory = newCoachMemory();
  act({ t: 'sim', fresh: true });
  for (let i = 0; i < 2000 && s.phase !== 'GAME_OVER'; i++) act({ t: 'sim' });
  return s;
}

describe('the journal', () => {
  it('rebuilds a whole game exactly from its seed and decisions', () => {
    const played = playJournaled();
    expect(played.phase).toBe('GAME_OVER');
    const rebuilt = rebuildGame(start, played.journal!, ctx, cards);
    expect(rebuilt.score).toEqual(played.score);
    expect(rebuilt.log).toEqual(played.log);
    expect(rebuilt.events).toEqual(played.events);
    expect(rebuilt.journal).toEqual(played.journal);
  }, 60_000);

  it('plays back one frame per decision, for a replay', () => {
    const played = playJournaled();
    const frames = [...replayFrames(start, played.journal!, ctx, cards)];
    expect(frames.length).toBe(played.journal!.length + 1);
    expect(frames[0].phase).toBe('COIN_TOSS');
    expect(frames.at(-1)!.score).toEqual(played.score);
  }, 60_000);

  it('a new game keeps its seed and starts an empty journal', () => {
    const s = createGame(start, cards);
    expect(s.seed).toBe(4242);
    expect(s.journal).toEqual([]);
  });

  it("the computer's decisions are journaled as they are, so a replay doesn't depend on the computer coach", () => {
    let s = createGame({ ...start, seed: 777 }, cards);
    const memory = newCoachMemory();
    for (let i = 0; i < 3000 && s.phase !== 'GAME_OVER'; i++) {
      const turn = coachTurn(s, ctx, memory);
      s = { ...turn.state, journal: [...(s.journal ?? []), ...turn.entries] };
    }
    expect(s.phase).toBe('GAME_OVER');
    expect(s.journal!.some(e => e.t === 'sim')).toBe(false);
    expect(new Set(s.journal!.map(e => e.t))).toContain('snap');
    const rebuilt = rebuildGame({ ...start, seed: 777 }, s.journal!, ctx, cards);
    expect(rebuilt.log).toEqual(s.log);
    expect(rebuilt.score).toEqual(s.score);
  }, 60_000);
});

