/**
 * Injuries (rules 6.2, 4.5.1 and 8.8.4): how long a player is out, counting plays down, and when an injury is ignored.
 */
import { DefenseLineup, defenseReplacements, PREFERENCE } from './defense-lineup';
import { eligibleReplacements, ELIGIBLE, Lineup } from './lineup';
import { DefenseRole, DefensiveBox } from './model/defense';
import { OffenseSlot } from './model/formations';
import { GameState, Side } from './model/game';
import { Injury, InjuryLength } from './model/injury';
import { PlayerCard } from './model/players';
import { Team } from './model/team';

/** Injury table by pass number, capped at the rest of the game. */
export function injuryFromPN(pn: number, quarter: number): InjuryLength {
  if (pn <= 10) return { kind: 'PLAYS', remaining: 2 };
  if (pn <= 20) return { kind: 'PLAYS', remaining: 4 };
  if (pn <= 30) return { kind: 'PLAYS', remaining: 6 };
  if (pn <= 35) return { kind: 'QUARTER', quarter };
  return { kind: 'GAME' };
}

const QUARTER_NAMES = ['', '1st', '2nd', '3rd', '4th'];

/** "the next 4 plays", "the rest of the 2nd quarter", "the rest of the game" */
export function injuryText(length: InjuryLength): string {
  switch (length.kind) {
    case 'PLAYS': return length.remaining === 1 ? 'the next play' : `the next ${length.remaining} plays`;
    case 'QUARTER': return `the rest of the ${QUARTER_NAMES[length.quarter] ?? ''} quarter`.replace('  ', ' ');
    case 'GAME': return 'the rest of the game';
  }
}

export function activeInjuries(state: GameState, side?: Side): Injury[] {
  return (state.injuries ?? []).filter(i => !side || i.side === side);
}

export function injuredIds(state: GameState, side: Side): Set<string> {
  return new Set(activeInjuries(state, side).map(i => i.playerId));
}

/**
 * One more play has been played: "next N plays" injuries count down; players whose time is up are back.
 * A play is any play where cards are flipped (the definition rule 4.6 uses).
 */
export function tickInjuries(state: GameState): { state: GameState; healed: Injury[] } {
  const healed: Injury[] = [];
  const injuries = activeInjuries(state).flatMap(i => {
    if (i.length.kind !== 'PLAYS') return [i];
    const remaining = i.length.remaining - 1;
    if (remaining <= 0) {
      healed.push(i);
      return [];
    }
    return [{ ...i, length: { kind: 'PLAYS' as const, remaining } }];
  });
  return { state: { ...state, injuries }, healed };
}

/** "Rest of the quarter" injuries end when the quarter does. */
export function healAtQuarterEnd(state: GameState): { state: GameState; healed: Injury[] } {
  const healed = activeInjuries(state).filter(i => i.length.kind === 'QUARTER');
  return { state: { ...state, injuries: activeInjuries(state).filter(i => i.length.kind !== 'QUARTER') }, healed };
}

export const backText = (i: Injury) => `${i.name} is back from injury and can play again.`;

/**
 * Whether an injury counts. It doesn't when:
 *  - nobody on the bench could take his place (rule 4.5.1 says so for the last quarterback; the same goes for anyone),
 *  - his position already lost a starter to an injury that isn't over (injury table note: the replacement plays on).
 */
export function injuryIgnoredBecause(
  state: GameState, side: Side, team: Team, player: PlayerCard, replacements: PlayerCard[],
): string | null {
  if (!replacements.length) return `nobody on the bench can replace him`;
  const starters = new Set([...team.startingLineup.offense, ...team.startingLineup.defense].map(e => e.playerId));
  const starterOut = activeInjuries(state, side).some(i => i.position === player.position && starters.has(i.playerId) && i.playerId !== player.id);
  if (starterOut) return `his position already lost a starter to injury, so the replacement plays on`;
  return null;
}

/** Bench players who could take an offensive slot, the healthy ones only. */
export function offenseBench(state: GameState, side: Side, team: Team, lineup: Lineup, slot: OffenseSlot): PlayerCard[] {
  return eligibleReplacements(team, lineup, slot, injuredIds(state, side));
}

export function defenseBench(state: GameState, side: Side, team: Team, lineup: DefenseLineup, box: DefensiveBox): PlayerCard[] {
  return defenseReplacements(team, lineup, box, injuredIds(state, side));
}

/** The best healthy bench player for an offensive slot: his natural position first, starters before the rest. */
export function suggestOffense(state: GameState, side: Side, team: Team, lineup: Lineup, slot: OffenseSlot): PlayerCard | null {
  if (slot === 'QB') return bestQuarterback(state, side, team); // rule 4.5: A, then B, then C
  const bench = offenseBench(state, side, team, lineup, slot);
  for (const position of ELIGIBLE[slot]) {
    const pick = bench.find(p => p.position === position);
    if (pick) return pick;
  }
  return null;
}

export function suggestDefense(state: GameState, side: Side, team: Team, lineup: DefenseLineup, box: DefensiveBox, role: DefenseRole): PlayerCard | null {
  const bench = defenseBench(state, side, team, lineup, box);
  for (const test of PREFERENCE[role]) {
    const pick = bench.find(test);
    if (pick) return pick;
  }
  return bench[0] ?? null;
}

/**
 * Quarterback endurance (rule 4.5): why this quarterback may not play right now, or null if he may.
 * A plays the whole game unless hurt (two A's share it freely); B only while every A is injured; C only while every A
 * and B is. With a lead of more than 20 in the 4th quarter (or overtime) anyone may play.
 */
export function qbEnduranceReason(state: GameState, side: Side, team: Team, player: PlayerCard | undefined): string | null {
  if (!player || player.position !== 'QB') return null;
  const lead = state.score[side] - state.score[side === 'home' ? 'away' : 'home'];
  if (state.quarter >= 4 && lead > 20) return null;
  const hurt = injuredIds(state, side);
  const healthy = (letter: string) =>
    team.players.some(p => p.position === 'QB' && p.endurance === letter && p.id !== player.id && !hurt.has(p.id));
  const name = `${player.firstName} ${player.lastName}`;
  if (player.endurance === 'B' && healthy('A')) return `${name} (B) may only play while the A quarterback is injured (rule 4.5.2)`;
  if (player.endurance === 'C' && (healthy('A') || healthy('B'))) return `${name} (C) may only play in place of an injured B (rule 4.5.3)`;
  return null;
}

/** The quarterback who should be playing: the best healthy one the endurance rule allows (A, then B, then C). */
export function bestQuarterback(state: GameState, side: Side, team: Team): PlayerCard | null {
  const hurt = injuredIds(state, side);
  const order = (p: PlayerCard) => (p.position === 'QB' ? 'ABC'.indexOf(p.endurance) : 9);
  return team.players.filter(p => p.position === 'QB' && !hurt.has(p.id) && !qbEnduranceReason(state, side, team, p)).sort((a, b) => order(a) - order(b))[0] ?? null;
}
