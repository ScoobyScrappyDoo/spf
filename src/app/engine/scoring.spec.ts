import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import bills from './testdata/1984/bills.json';
import patriots from './testdata/1984/patriots.json';
import { applyEntry, createGame, Fac, GameContext, GameState, JournalEntry, newCoachMemory, scoringPlays, Team, withEntry } from './index';

const cards = deckJson as Fac[];
const ctx: GameContext = { cards, teams: { home: bills as unknown as Team, away: patriots as unknown as Team } };

describe('the scoring summary', () => {
  it('lists every score in order, and the last one matches the final score', () => {
    let s: GameState = createGame({ homeTeamId: 'buf', awayTeamId: 'ne', seed: 31 }, cards);
    const memory = newCoachMemory();
    const act = (e: JournalEntry) => { s = withEntry(s, applyEntry(s, e, ctx, memory), e); };
    act({ t: 'sim', fresh: true });
    for (let i = 0; i < 2000 && s.phase !== 'GAME_OVER'; i++) act({ t: 'sim' });
    const plays = scoringPlays(s, ctx, cards);
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.at(-1)).toMatchObject({ home: s.score.home, away: s.score.away });
    for (const p of plays) expect(p.text.length).toBeGreaterThan(5);
    const td = plays.find(p => p.kind === 'TD');
    if (td) expect(td.text).toMatch(/(run|pass from|return|touchdown)/);
  }, 60_000);
});
