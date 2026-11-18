import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import dolphinsJson from './testdata/1984/dolphins.json';
import patriotsJson from './testdata/1984/patriots.json';
import {
  buildLineup, callToss, chooseAfterToss, chooseRunKey, createGame, Fac, FormationId, GameContext, GameState, getFormation, kickoff,
  Lineup, SeededRandom, Team,
} from './index';

const cards = deckJson as Fac[];
const patriots = patriotsJson as unknown as Team;
const dolphins = dolphinsJson as unknown as Team;
const ctx: GameContext = { cards, teams: { home: patriots, away: dolphins } };
function patriotsBall(rules = {}): GameState {
  let s = createGame({ homeTeamId: 'ne', awayTeamId: 'mia', seed: 1, rules }, cards);
  for (const c of ['HEADS', 'TAILS'] as const) { const t = callToss(s, c, ctx); if (t.toss.winner === 'home') { s = t; break; } }
  return { ...kickoff(chooseAfterToss(s, 'RECEIVE', ctx), ctx), targets: [] };
}
const formationId: FormationId = '2rb-2te-fl-left';
const lineup: Lineup = buildLineup(patriots, getFormation(formationId));
const seen = { formationId, lineup };
/** How often each key comes up over many plays (a new random stream each time, as plays do). */
function keys(state: GameState, n = 600) {
  const count: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const k = chooseRunKey(state, patriots, seen, new SeededRandom(1000 + i));
    count[k] = (count[k] ?? 0) + 1;
  }
  return count;
}

describe('the computer coach reads the field (weighted, never fixed)', () => {
  it('keys the backs on the field, the first back most, but never always', () => {
    const k = keys(patriotsBall());
    expect(k['RUN_KEY_BK1']).toBeGreaterThan(k['RUN_KEY_BK2'] ?? 0);
    expect(k['RUN_KEY_BK1']).toBeLessThan(600 * 0.8); // weighted: other keys, and no key, keep coming
    expect(k['RUN_NO_KEY']).toBeGreaterThan(30);
  });

  it("never keys a back who may not carry this play (he had the ball, and his rating makes him rest)", () => {
    const s = patriotsBall();
    const rb1 = lineup.RB1!;
    // RB1 had the ball on the last play of this possession.
    const tired: GameState = { ...s, targets: [{ playerId: rb1, side: 'home', possession: s.possessionIndex ?? 0, quarter: s.quarter } as never] };
    const back = patriots.players.find(p => p.id === rb1)!;
    const resting = back.position === 'RB' && (back as { playDirection?: number }).playDirection! >= 1;
    if (resting) expect(keys(tired)['RUN_KEY_BK1'] ?? 0).toBe(0);
    else expect(keys(tired)['RUN_KEY_BK1']).toBeGreaterThan(0); // a back who needn't rest is still fair game
  });

  it('a bold coach keys the biggest threat more often than a cautious one', () => {
    const bold = keys(patriotsBall({ coachTemperament: 'bold' }))['RUN_KEY_BK1'];
    const cautious = keys(patriotsBall({ coachTemperament: 'cautious' }))['RUN_KEY_BK1'];
    expect(bold).toBeGreaterThan(cautious);
  });
});
