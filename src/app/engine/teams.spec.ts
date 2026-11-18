import { describe, expect, it } from 'vitest';
import catalog from '../../../public/cards/teams/index.json';
import deckJson from '../../../public/cards/fac-deck.json';
// One import per team file. tools/build_catalog.py lists them in index.json; when you add a season, add its files here too
// (the 'covers every team in the catalog' test below fails until you do).
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
import {
  buildLineup, callToss, chooseAfterToss, createGame, Fac, formationForStarters, GameContext, getFormation, kickoff,
  slotsOnField, Team,
} from './index';

const teams = new Map<string, Team>([
  ['1984-bills', t0],
  ['1984-colts', t1],
  ['1984-dolphins', t2],
  ['1984-patriots', t3],
  ['1984-jets', t4],
  ['1984-bengals', t5],
  ['1984-browns', t6],
  ['1984-oilers', t7],
  ['1984-steelers', t8],
  ['1984-broncos', t9],
  ['1984-chiefs', t10],
  ['1984-raiders', t11],
  ['1984-chargers', t12],
  ['1984-seahawks', t13],
  ['1984-cowboys', t14],
  ['1984-giants', t15],
  ['1984-eagles', t16],
  ['1984-cardinals', t17],
  ['1984-redskins', t18],
  ['1984-bears', t19],
  ['1984-lions', t20],
  ['1984-packers', t21],
  ['1984-vikings', t22],
  ['1984-buccaneers', t23],
  ['1984-falcons', t24],
  ['1984-rams', t25],
  ['1984-saints', t26],
  ['1984-49ers', t27],
] as unknown as [string, Team][]);

it('covers every team in the catalog', () => {
  expect([...teams.keys()].sort()).toEqual(catalog.map(e => e.id).sort());
});

describe.each([...teams.entries()])('%s card set', (_, team) => {
  it('has unique player ids', () => {
    expect(new Set(team.players.map(p => p.id)).size).toBe(team.players.length);
  });

  it('every QB passing and pass rush table covers 1-48 exactly once', () => {
    for (const qb of team.players) {
      if (qb.position !== 'QB') continue;
      const tables = [qb.passing.quick, qb.passing.short, qb.passing.long].map(t => [t.com, t.inc, t.int])
        .concat([[qb.passRush.sack, qb.passRush.runs, qb.passRush.com, qb.passRush.inc]]);
      for (const t of tables) {
        const parts = t.filter(r => r !== null);
        expect(parts[0]!.from).toBe(1);
        expect(parts.at(-1)!.to).toBe(48);
        parts.slice(1).forEach((r, i) => expect(r!.from).toBe(parts[i]!.to + 1));
      }
    }
  });

  it('lists 11 offensive and 11 defensive starters that exist on the roster', () => {
    const ids = new Set(team.players.map(p => p.id));
    expect(team.startingLineup.offense.length).toBe(11);
    expect(team.startingLineup.defense.length).toBe(11);
    [...team.startingLineup.offense, ...team.startingLineup.defense].forEach(e => expect(ids.has(e.playerId)).toBe(true));
  });

  it('puts all eleven offensive starters on the field in its opening formation', () => {
    const formation = getFormation(formationForStarters(team));
    const lineup = buildLineup(team, formation);
    expect(slotsOnField(formation).every(s => lineup[s])).toBe(true);
    const starters = new Set(team.startingLineup.offense.map(e => e.playerId));
    expect(Object.values(lineup).filter(id => starters.has(id!)).length).toBe(11);
  });

  it('has a kicker, a punter with 11 punt rows, and both return units with 12 rows', () => {
    expect(team.players.some(p => p.position === 'K')).toBe(true);
    for (const p of team.players) if (p.position === 'P') expect(p.punts.length).toBe(11);
    expect(team.kickReturn?.table.length).toBe(12);
    expect(team.puntReturn?.table.length).toBe(12);
  });

  it('every kick returner column a kickoff can send the ball to has a returner', () => {
    for (const column of ['KR1', 'KR2', 'KR3', 'KR4']) expect(team.kickReturn!.returners[column]).toBeTruthy();
  });
});

describe('opening formations', () => {
  it('2 WR / 2 TE / 1 RB for the Patriots, 2 WR / 1 TE / 2 RB for the Dolphins', () => {
    expect(formationForStarters(teams.get('1984-patriots')!)).toBe('pass-2wr-2te');
    expect(formationForStarters(teams.get('1984-dolphins')!)).toBe('2rb-2wr-te-left');
  });
});

describe('a team without return cards', () => {
  it('stops the kickoff with a clear message instead of crashing', () => {
    const cards = deckJson as Fac[];
    const noReturns: Team = { ...teams.get('1984-raiders')!, kickReturn: null, puntReturn: null };
    const ctx: GameContext = { cards, teams: { home: noReturns, away: teams.get('1984-patriots')! } };
    let s = createGame({ homeTeamId: 'r', awayTeamId: 'p', seed: 3 }, cards);
    s = callToss(s, 'HEADS', ctx);
    s = chooseAfterToss(s, s.toss.winner === 'home' ? 'RECEIVE' : 'KICK', ctx);
    expect(() => {
      for (let i = 0; i < 20; i++) kickoff({ ...s, deck: { ...s.deck, next: i } }, ctx);
    }).toThrow('Los Angeles Raiders have no kick return card yet');
  });
});
