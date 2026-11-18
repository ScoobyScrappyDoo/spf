import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import bears from '../../../public/cards/teams/1984/bears.json';
import dolphins from '../../../public/cards/teams/1984/dolphins.json';
import fortyNiners from '../../../public/cards/teams/1984/49ers.json';
import patriots from '../../../public/cards/teams/1984/patriots.json';
import raiders from '../../../public/cards/teams/1984/raiders.json';
import redskins from '../../../public/cards/teams/1984/redskins.json';
import steelers from '../../../public/cards/teams/1984/steelers.json';
import bills from '../../../public/cards/teams/1984/bills.json';
import { computeStats, createGame, Fac, GameContext, simulateGame, simulateStep, Team } from './index';

const cards = deckJson as Fac[];
const teams = [bears, dolphins, fortyNiners, patriots, raiders, redskins, steelers, bills] as unknown as Team[];

function play(home: Team, away: Team, seed: number) {
  const ctx: GameContext = { cards, teams: { home, away } };
  const start = createGame({ homeTeamId: home.id, awayTeamId: away.id, seed }, cards);
  return { ctx, end: simulateGame(start, ctx) };
}

describe('simulated games', () => {
  it('40 games between eight teams all reach the final whistle, and the numbers look like football', () => {
    const totals = { games: 0, points: 0, plays: 0, passAtt: 0, comp: 0, rushAtt: 0, rushYds: 0, passYds: 0, sacks: 0, ints: 0, fumblesLost: 0, punts: 0, fgAtt: 0, fgMade: 0, penalties: 0, ties: 0 };
    for (let g = 0; g < 40; g++) {
      const home = teams[g % teams.length];
      const away = teams[(g * 3 + 1) % teams.length];
      if (home === away) continue;
      let result;
      try {
        result = play(home, away, 1000 + g);
      } catch (e) {
        throw new Error(`Game ${g} (${away.name} at ${home.name}, seed ${1000 + g}): ${(e as Error).message}`);
      }
      const { ctx, end } = result;
      expect(end.phase).toBe('GAME_OVER');
      const st = computeStats(end, ctx.teams);
      totals.games++;
      if (end.score.home === end.score.away) totals.ties++;
      for (const side of ['home', 'away'] as const) {
        const t = st.teams[side];
        totals.points += t.points; totals.plays += t.plays; totals.passAtt += t.passing.att; totals.comp += t.passing.comp;
        totals.rushAtt += t.rushing.att; totals.rushYds += t.rushing.yards; totals.passYds += t.passing.yards; totals.sacks += t.passing.sacks;
        totals.ints += t.passing.interceptions; totals.fumblesLost += t.fumbles.lost; totals.punts += t.punts.count; totals.penalties += t.penalties.count;
        for (const p of st.players[side]) { if (p.fieldGoals) { totals.fgAtt += p.fieldGoals.att; totals.fgMade += p.fieldGoals.made; } }
      }
    }
    const per = (n: number) => (n / (totals.games * 2)).toFixed(1);
    console.log(`SIM ${totals.games} games, per team and game: points ${per(totals.points)}, plays ${per(totals.plays)}, ` +
      `rushes ${per(totals.rushAtt)} for ${per(totals.rushYds)} (${(totals.rushYds / totals.rushAtt).toFixed(2)} a carry), ` +
      `passes ${per(totals.comp)}/${per(totals.passAtt)} (${(100 * totals.comp / totals.passAtt).toFixed(1)}%) for ${per(totals.passYds)}, ` +
      `sacks ${per(totals.sacks)}, interceptions ${per(totals.ints)}, fumbles lost ${per(totals.fumblesLost)}, punts ${per(totals.punts)}, ` +
      `field goals ${totals.fgMade}/${totals.fgAtt}, penalties ${per(totals.penalties)}, ties ${totals.ties}`);
    const avgPoints = totals.points / (totals.games * 2);
    expect(avgPoints).toBeGreaterThan(5);
    expect(avgPoints).toBeLessThan(45);
  }, 120_000);

  it('the same seed plays the same game', () => {
    const a = play(teams[0], teams[1], 77).end;
    const b = play(teams[0], teams[1], 77).end;
    expect(b.score).toEqual(a.score);
    expect(b.log.length).toBe(a.log.length);
  });

  it('a game can be stepped one action at a time', () => {
    const ctx: GameContext = { cards, teams: { home: teams[2], away: teams[3] } };
    let s = createGame({ homeTeamId: teams[2].id, awayTeamId: teams[3].id, seed: 5 }, cards);
    s = simulateStep(s, ctx);
    expect(s.phase).toBe('TOSS_CHOICE');
  });

  it('the coaches use their timeouts when the clock matters', () => {
    let used = 0;
    for (let g = 0; g < 12; g++) {
      const { end } = play(teams[g % teams.length], teams[(g + 3) % teams.length], 500 + g);
      used += end.log.flatMap(e => e.steps).filter(x => x.includes(' takes a timeout, ')).length;
    }
    expect(used).toBeGreaterThan(0);
  }, 60_000);

  it('a coach with the lead takes a knee to run out the clock', () => {
    let kneels = 0;
    for (let g = 0; g < 12; g++) {
      const { end } = play(teams[g % teams.length], teams[(g + 5) % teams.length], 900 + g);
      kneels += (end.events ?? []).filter(e => e.type === 'RUSH' && e.kneel).length;
    }
    expect(kneels).toBeGreaterThan(0);
  }, 60_000);
});

