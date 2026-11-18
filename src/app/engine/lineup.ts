import { FORMATIONS, FormationId, OffenseFormation, OffenseSlot, SLOT_GROUP, slotsOnField } from './model/formations';
import { PlayerCard, Position } from './model/players';
import { Team } from './model/team';

/**
 * Who stands where: slot -> player id.
 * Keeping this separate from the roster fixes the old JSON, where a player's id *was* his slot ("QB", "RB1").
 */
export type Lineup = Partial<Record<OffenseSlot, string>>;

/** Which card positions may fill a slot (rule 3.1). Ends and flankers take any receiver or back. */
export const ELIGIBLE: Record<OffenseSlot, readonly Position[]> = {
  // Optional rule O1: linemen may play anywhere on the line (his own position first); out of position costs 1 (see below).
  LT: ['OT', 'OG', 'C'], RT: ['OT', 'OG', 'C'], LG: ['OG', 'OT', 'C'], RG: ['OG', 'OT', 'C'], C: ['C', 'OG', 'OT'],
  QB: ['QB'],
  TEL: ['TE', 'WR', 'RB'], TER: ['TE', 'WR', 'RB'],
  SEL: ['WR', 'TE', 'RB'], SER: ['WR', 'TE', 'RB'],
  FLL: ['WR', 'RB', 'TE'], FLR: ['WR', 'RB', 'TE'],
  RB1: ['RB'], RB2: ['RB'], RB3: ['RB'],
};

/** The line position each line slot is made for. */
const LINE_POSITION: Partial<Record<OffenseSlot, 'OT' | 'OG' | 'C'>> = { LT: 'OT', RT: 'OT', LG: 'OG', RG: 'OG', C: 'C' };
const LINE_NAMES = { OT: 'tackle', OG: 'guard', C: 'center' } as const;

/**
 * Optional rule O1, Playing Out of Position: a lineman in a line position that isn't on his card (a guard at tackle)
 * loses 1 from both his blocking values. Null when he's where he belongs or isn't a lineman.
 */
export function outOfPosition(player: PlayerCard | undefined, slot: OffenseSlot): { penalty: number; text: string } | null {
  const wanted = LINE_POSITION[slot];
  if (!player || !wanted || player.position === wanted || !(player.position in LINE_NAMES)) return null;
  const own = LINE_NAMES[player.position as 'OT' | 'OG' | 'C'];
  const at = LINE_NAMES[wanted];
  return { penalty: 1, text: `${own[0].toUpperCase()}${own.slice(1)} playing ${at}` };
}

export function isEligible(player: PlayerCard, slot: OffenseSlot): boolean {
  return ELIGIBLE[slot].includes(player.position);
}

/**
 * Order in which empty slots are filled: tight-end slots and the backfield before the receivers' slots, so tight ends
 * and backs land where they belong and an extra starter (the 1984 Browns' third tight end) takes a receiver's slot.
 */
const FILL_ORDER: readonly OffenseSlot[] = ['QB', 'LT', 'LG', 'C', 'RG', 'RT', 'TEL', 'TER', 'RB1', 'RB2', 'RB3', 'SEL', 'SER', 'FLL', 'FLR'];

/** The five linemen from the lineup card, in printed order OT, OG, OC, OG, OT. */
function startingLine(team: Team): Lineup {
  const line = team.startingLineup.offense.filter(e => ['OT', 'OG', 'OC'].includes(e.listed)).map(e => e.playerId);
  const [lt, lg, c, rg, rt] = line;
  return { LT: lt, LG: lg, C: c, RG: rg, RT: rt };
}

/**
 * Builds a legal lineup for a formation.
 * Players from `previous` keep their slot if it still exists; anyone displaced is first in line for a new slot,
 * then the team's listed starters, then the bench. Switching formations therefore keeps your players where it can.
 */
export function buildLineup(team: Team, formation: OffenseFormation, previous: Lineup = {}): Lineup {
  const byId = new Map(team.players.map(p => [p.id, p]));
  const onField = slotsOnField(formation);
  const lineup: Lineup = {};
  const used = new Set<string>();
  const seed = Object.keys(previous).length ? previous : startingLine(team);

  for (const slot of onField) {
    const id = seed[slot];
    const p = id ? byId.get(id) : undefined;
    if (p && isEligible(p, slot) && !used.has(p.id)) {
      lineup[slot] = p.id;
      used.add(p.id);
    }
  }

  const displaced = Object.values(previous).filter((id): id is string => !!id && !used.has(id));
  const starters = team.startingLineup.offense.map(e => e.playerId);
  const others = team.players.map(p => p.id);
  const candidates = [...new Set([...displaced, ...starters, ...others])]
    .map(id => byId.get(id))
    .filter((p): p is PlayerCard => !!p);

  // In the team's own formation (the one its lineup card describes), the starters come before the bench, whatever their
  // position: the 1984 Browns' third starting tight end takes a receiver's slot. In other formations the slot's natural
  // position comes first, so a four-wide set uses receivers.
  const own = formation.id === formationForStarters(team);
  const first = new Set([...displaced, ...starters]);
  for (const slot of FILL_ORDER) {
    if (!onField.includes(slot) || lineup[slot]) continue;
    for (const pool of own ? [candidates.filter(p => first.has(p.id)), candidates] : [candidates]) {
      // Prefer the slot's natural position (TE for a tight-end slot), then fall back down the eligibility list.
      for (const position of ELIGIBLE[slot]) {
        const pick = pool.find(p => p.position === position && !used.has(p.id));
        if (pick) {
          lineup[slot] = pick.id;
          used.add(pick.id);
          break;
        }
      }
      if (lineup[slot]) break;
    }
  }
  return lineup;
}

/**
 * Puts a player into a slot. If he is already elsewhere on the display the two players swap,
 * provided the swap is legal for both slots; otherwise the lineup is returned unchanged.
 */
export function placePlayer(lineup: Lineup, slot: OffenseSlot, player: PlayerCard, team: Team): Lineup {
  if (!isEligible(player, slot)) return lineup;
  const next: Lineup = { ...lineup };
  const currentSlot = (Object.keys(lineup) as OffenseSlot[]).find(s => lineup[s] === player.id);
  const outgoingId = lineup[slot];
  if (currentSlot) {
    const outgoing = team.players.find(p => p.id === outgoingId);
    if (outgoing && !isEligible(outgoing, currentSlot)) return lineup;
    next[currentSlot] = outgoingId;
  }
  next[slot] = player.id;
  return next;
}

/**
 * The formation that fits the team's listed offensive starters: as many back slots as starting RBs,
 * tight-end slots for the starting TEs and split end/flanker slots for the starting WRs.
 * Falls back to 2 WR / 2 TE when nothing fits exactly.
 */
export function formationForStarters(team: Team): FormationId {
  const count = (pos: string) => team.startingLineup.offense.filter(e => e.listed === pos).length;
  const [rb, te, wr] = [count('RB'), count('TE'), count('WR')];
  const fits = FORMATIONS.find(f => {
    const backs = f.skillSlots.filter(s => SLOT_GROUP[s] === 'back').length;
    const tes = f.skillSlots.filter(s => s === 'TEL' || s === 'TER').length;
    return backs === rb && tes === te && f.skillSlots.length - backs - tes === wr;
  });
  return fits?.id ?? 'pass-2wr-2te';
}

/** Bench players who could take this slot. */
export function eligibleReplacements(team: Team, lineup: Lineup, slot: OffenseSlot, unavailable: ReadonlySet<string> = new Set()): PlayerCard[] {
  const onField = new Set(Object.values(lineup));
  return team.players.filter(p => isEligible(p, slot) && !onField.has(p.id) && !unavailable.has(p.id));
}

