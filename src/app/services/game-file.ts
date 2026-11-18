/**
 * Saved games (.spf): the game's start (teams and seed) and its journal, enough to rebuild it exactly (journal.ts).
 * Not meant to be read or edited by hand: gzip-compressed behind an "SPF1" header, with a SHA-256 checksum so a damaged
 * or altered file is refused. Only what browsers have built in: CompressionStream and Web Crypto.
 */
import { GameStart, GameState, JournalEntry, Team } from '../engine';

const MAGIC = 'SPF1';

export interface SavedGame {
  format: 'spf';
  /** 1: the journal only; 2: also both teams' cards and the finished game, so it always opens exactly as saved. */
  version: 1 | 2;
  savedAt: string;
  start: GameStart;
  journal: JournalEntry[];
  /** For a check after loading: the rebuilt game must end the same way. */
  result: { score: GameState['score']; phase: GameState['phase']; quarter: number; clock: number };
  /** Version 2: the cards the game was played with, and the game as saved. */
  teams?: { home: Team; away: Team };
  state?: GameState;
}

export function toSavedGame(state: GameState, teams?: { home: Team; away: Team }): SavedGame {
  if (state.seed === undefined || !state.journal) throw new Error('This game was started before games could be saved.');
  return {
    format: 'spf', version: teams ? 2 : 1, savedAt: new Date().toISOString(), ...(teams ? { teams, state } : {}),
    start: { homeTeamId: state.homeTeamId, awayTeamId: state.awayTeamId, seed: state.seed, ...(state.rules ? { rules: state.rules } : {}), ...(state.coaches ? { coaches: state.coaches } : {}) },
    journal: state.journal,
    result: { score: state.score, phase: state.phase, quarter: state.quarter, clock: state.clock },
  };
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const input = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
  const reader = input.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value);
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/** The bytes of a .spf file: "SPF1", the checksum of the packed game, then the packed game. */
export async function encodeGame(game: SavedGame): Promise<Uint8Array> {
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(game)), new CompressionStream('gzip'));
  const sum = await sha256(packed);
  const file = new Uint8Array(4 + sum.length + packed.length);
  file.set(new TextEncoder().encode(MAGIC), 0);
  file.set(sum, 4);
  file.set(packed, 4 + sum.length);
  return file;
}

export async function decodeGame(file: Uint8Array): Promise<SavedGame> {
  if (new TextDecoder().decode(file.slice(0, 4)) !== MAGIC) throw new Error("This isn't a Statistical Football game file.");
  const sum = file.slice(4, 36);
  const packed = file.slice(36);
  const check = await sha256(packed);
  if (check.length !== sum.length || check.some((b, i) => b !== sum[i])) throw new Error('This game file is damaged or has been changed.');
  const game = JSON.parse(new TextDecoder().decode(await pipe(packed, new DecompressionStream('gzip')))) as SavedGame;
  if (game.format !== 'spf' || (game.version !== 1 && game.version !== 2)) throw new Error('This game file comes from a newer version of the game.');
  return game;
}

/** A name for the file: "1984 Miami at San Francisco, 42-42.spf". */
export function gameFileName(state: GameState, label: (side: 'home' | 'away') => string, year: string): string {
  const name = `${year} ${label('away')} at ${label('home')}, ${state.score.away}-${state.score.home}`;
  return `${name.replace(/[\\/:*?"<>|]/g, '').replace(/\s*\((home|away)\)/g, '')}.spf`;
}
