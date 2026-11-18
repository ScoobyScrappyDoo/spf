import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import t0 from '../../../public/cards/teams/1984/bills.json';
import t1 from '../../../public/cards/teams/1984/colts.json';
import t2 from '../../../public/cards/teams/1984/dolphins.json';
import t3 from '../../../public/cards/teams/1984/patriots.json';
import t4 from '../../../public/cards/teams/1984/jets.json';
import t5 from '../../../public/cards/teams/1984/bengals.json';
import t6 from '../../../public/cards/teams/1984/browns.json';
import t7 from '../../../public/cards/teams/1984/oilers.json';
import t8 from '../../../public/cards/teams/1984/steelers.json';
import t9 from '../../../public/cards/teams/1984/broncos.json';
import t10 from '../../../public/cards/teams/1984/chiefs.json';
import t11 from '../../../public/cards/teams/1984/raiders.json';
import t12 from '../../../public/cards/teams/1984/chargers.json';
import t13 from '../../../public/cards/teams/1984/seahawks.json';
import t14 from '../../../public/cards/teams/1984/cowboys.json';
import t15 from '../../../public/cards/teams/1984/giants.json';
import t16 from '../../../public/cards/teams/1984/eagles.json';
import t17 from '../../../public/cards/teams/1984/cardinals.json';
import t18 from '../../../public/cards/teams/1984/redskins.json';
import t19 from '../../../public/cards/teams/1984/bears.json';
import t20 from '../../../public/cards/teams/1984/lions.json';
import t21 from '../../../public/cards/teams/1984/packers.json';
import t22 from '../../../public/cards/teams/1984/vikings.json';
import t23 from '../../../public/cards/teams/1984/buccaneers.json';
import t24 from '../../../public/cards/teams/1984/falcons.json';
import t25 from '../../../public/cards/teams/1984/rams.json';
import t26 from '../../../public/cards/teams/1984/saints.json';
import t27 from '../../../public/cards/teams/1984/49ers.json';
import { applyEntry, computeStats, createGame, Fac, GameContext, GameState, JournalEntry, newCoachMemory, Team, withEntry } from './index';

/**
 * Every team in the catalog plays a whole simulated game, away and at home, so a bad card anywhere shows up here
 * rather than in the middle of someone's game. (When the catalog changes, regenerate the imports above.)
 */
const cards = deckJson as Fac[];
const teams = [t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13, t14, t15, t16, t17, t18, t19, t20, t21, t22, t23, t24, t25, t26, t27] as unknown as Team[];

describe('every team plays a whole game', () => {
  teams.forEach((away, i) => {
    const home = teams[(i + 1) % teams.length];
    it(`${away.id} at ${home.id}`, () => {
      const ctx: GameContext = { cards, teams: { home, away } };
      let s: GameState = createGame({ homeTeamId: home.id, awayTeamId: away.id, seed: 100 + i }, cards);
      const memory = newCoachMemory();
      const act = (e: JournalEntry) => { s = withEntry(s, applyEntry(s, e, ctx, memory), e); };
      act({ t: 'sim', fresh: true });
      for (let n = 0; n < 4000 && s.phase !== 'GAME_OVER'; n++) act({ t: 'sim' });
      expect(s.phase).toBe('GAME_OVER');
      const stats = computeStats(s, ctx.teams);
      expect(stats.teams.away.plays).toBeGreaterThan(30);
      expect(stats.teams.home.plays).toBeGreaterThan(30);
    }, 60_000);
  });
});
