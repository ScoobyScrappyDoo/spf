/**
 * A Z-card injury on a play from scrimmage (rule 8.8.4): the card names the ball carrier ("BC"), an offensive position
 * or a defensive box. Shared by runs and passes. Returns the injury when it counts, and says why in the play-by-play.
 */
import { DefenseLineup } from './defense-lineup';
import { GameState, otherSide, Side } from './model/game';
import { DefensiveBox, OffensiveSpot } from './model/fac';
import { OffenseSlot } from './model/formations';
import { Injury } from './model/injury';
import { PlayerCard } from './model/players';
import { Team } from './model/team';
import { Lineup } from './lineup';
import { defenseBench, injuryFromPN, injuryIgnoredBecause, injuryText, offenseBench } from './injuries';

/** Ends: tight or split, whichever is in the lineup. */
export const END_SLOTS: Record<'LE' | 'RE', OffenseSlot[]> = { LE: ['TEL', 'SEL'], RE: ['TER', 'SER'] };

export interface InjuryInput {
  state: GameState;
  offense: Side;
  offenseTeam: Team;
  defenseTeam: Team;
  lineup: Lineup;
  defenseLineup: DefenseLineup;
  /** Whose injury "BC" means: the runner, or on a pass the quarterback or the receiver. */
  ballCarrierSlot: OffenseSlot;
  target: string;
  /** The PN of the injury card: how long (injury table), and the coin toss for a box with two players. */
  passNumber: number;
  steps: string[];
}

export function zInjury(i: InjuryInput): Injury | null {
  const defense = otherSide(i.offense);
  let who: PlayerCard | undefined;
  let side: Side = i.offense;
  let where = i.target;
  let bench: PlayerCard[] = [];
  const offensePlayer = (id: string | undefined) => (id ? i.offenseTeam.players.find(p => p.id === id) : undefined);
  if (/^[A-O]$/.test(i.target)) {
    // Two players in the box: a coin toss decides. The injury card's PN is the coin: even, the first.
    const box = i.target as DefensiveBox;
    const ids = i.defenseLineup[box] ?? [];
    const pickId = ids.length > 1 && i.passNumber % 2 === 1 ? ids[1] : ids[0];
    who = i.defenseTeam.players.find(p => p.id === pickId);
    side = defense;
    where = `box ${box}`;
    bench = defenseBench(i.state, defense, i.defenseTeam, i.defenseLineup, box);
  } else {
    let slot: OffenseSlot | undefined;
    if (i.target === 'BC') slot = i.ballCarrierSlot;
    else if (i.target === 'QB') slot = 'QB';
    else {
      const spot = i.target as OffensiveSpot;
      const slots: OffenseSlot[] = spot === 'LE' || spot === 'RE' ? END_SLOTS[spot] : [spot === 'CN' ? 'C' : (spot as OffenseSlot)];
      slot = slots.find(s => i.lineup[s]);
    }
    who = slot ? offensePlayer(i.lineup[slot]) : undefined;
    where = slot ?? i.target;
    if (slot) bench = offenseBench(i.state, i.offense, i.offenseTeam, i.lineup, slot);
  }
  if (!who) {
    i.steps.push(`Z result: injury at ${i.target}, but nobody is there.`);
    return null;
  }
  const name = `${who.firstName} ${who.lastName}`;
  const team = side === i.offense ? i.offenseTeam : i.defenseTeam;
  const ignored = injuryIgnoredBecause(i.state, side, team, who, bench);
  if (ignored) {
    i.steps.push(`Z result: injury to ${name}, but it doesn't count: ${ignored}.`);
    return null;
  }
  const length = injuryFromPN(i.passNumber, i.state.quarter);
  i.steps.push(`Z result: injury! ${name} (${where}) is out for ${injuryText(length)} (PN ${i.passNumber}).`);
  return { side, playerId: who.id, name, position: who.position, where, length, quarter: i.state.quarter, clock: i.state.clock };
}
