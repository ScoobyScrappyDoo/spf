import { describe, expect, it } from 'vitest';
import { decodeGame, encodeGame, SavedGame } from './game-file';

const game: SavedGame = {
  format: 'spf', version: 1, savedAt: '2026-11-02T10:00:00Z',
  start: { homeTeamId: '1984-bills', awayTeamId: '1984-patriots', seed: 4242 },
  journal: [{ t: 'toss', call: 'HEADS' }, { t: 'choice', choice: 'RECEIVE' }, { t: 'sim', fresh: true }],
  result: { score: { home: 0, away: 28 }, phase: 'GAME_OVER', quarter: 4, clock: 0 },
};

describe('.spf files', () => {
  it('round-trip: what goes in comes out', async () => {
    expect(await decodeGame(await encodeGame(game))).toEqual(game);
  });

  it("can't be read by eye: no team names or JSON in the bytes", async () => {
    const text = new TextDecoder().decode(await encodeGame(game));
    expect(text.startsWith('SPF1')).toBe(true);
    expect(text).not.toContain('patriots');
    expect(text).not.toContain('journal');
  });

  it('a changed byte is refused', async () => {
    const bytes = await encodeGame(game);
    bytes[bytes.length - 5] ^= 0xff;
    await expect(decodeGame(bytes)).rejects.toThrow('damaged or has been changed');
  });

  it('another file is refused', async () => {
    await expect(decodeGame(new TextEncoder().encode('hello there, not a game'))).rejects.toThrow("isn't a Statistical Football game file");
  });

  it('version 2 carries both teams and the game as saved', async () => {
    const v2 = { ...game, version: 2 as const, teams: { home: { id: 'h', name: 'Home' }, away: { id: 'a', name: 'Away' } } as never, state: { score: { home: 28, away: 17 } } as never };
    expect(await decodeGame(await encodeGame(v2))).toEqual(v2);
  });
});

