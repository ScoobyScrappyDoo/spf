import { allowedInBox, DefenseFormation, DefenseRole, DefensiveBox, ROWS } from './model/defense';
import { PlayerCard } from './model/players';
import { Team } from './model/team';

/** Who stands in each box: up to two player ids per box. */
export type DefenseLineup = Partial<Record<DefensiveBox, string[]>>;

/** Candidates for a role, best first. A DT box falls back to an end and then a linebacker, and so on. */
export const PREFERENCE: Record<DefenseRole, ((p: PlayerCard) => boolean)[]> = {
  DE: [p => p.position === 'DE', p => p.position === 'DT', p => p.position === 'LB'],
  DT: [p => p.position === 'DT', p => p.position === 'DE', p => p.position === 'LB'],
  LB: [p => p.position === 'LB'],
  CB: [p => p.position === 'DB' && p.role === 'CB', p => p.position === 'DB' && !p.role, p => p.position === 'DB'],
  S: [p => p.position === 'DB' && p.role === 'S', p => p.position === 'DB' && !p.role, p => p.position === 'DB'],
  DB: [p => p.position === 'DB' && !p.role, p => p.position === 'DB'],
};

/** Starters by their lineup-card position, so a listed DE is preferred in an end's box. */
function starterOrder(team: Team): string[] {
  return team.startingLineup.defense.map(e => e.playerId);
}

/**
 * Fills a defensive formation. Players from `previous` stay in their box if it is still used;
 * then starters, then the bench, each slot taking the best candidate by its preference list.
 */
export function buildDefenseLineup(team: Team, formation: DefenseFormation, previous: DefenseLineup = {}): DefenseLineup {
  const byId = new Map(team.players.map(p => [p.id, p]));
  const lineup: DefenseLineup = {};
  const used = new Set<string>();
  const put = (box: DefensiveBox, id: string) => {
    lineup[box] = [...(lineup[box] ?? []), id];
    used.add(id);
  };

  // Keep whoever already stands in a box the new formation still uses, as long as he fits the box.
  const counts = new Map<DefensiveBox, number>();
  formation.slots.forEach(s => counts.set(s.box, (counts.get(s.box) ?? 0) + 1));
  for (const [box, n] of counts) {
    for (const id of (previous[box] ?? []).slice(0, n)) {
      const p = byId.get(id);
      if (p && allowedInBox(box).includes(p.position) && !used.has(id)) put(box, id);
    }
  }

  const displaced = Object.values(previous).flat().filter((id): id is string => !!id && !used.has(id));
  const order = [...new Set([...displaced, ...starterOrder(team), ...team.players.map(p => p.id)])]
    .map(id => byId.get(id))
    .filter((p): p is PlayerCard => !!p);

  // Fill the remaining slots, most particular roles first so a scarce tackle isn't used up in an end's box.
  const remaining = formation.slots.filter((s, i) => {
    const before = formation.slots.slice(0, i).filter(x => x.box === s.box).length;
    return (lineup[s.box]?.length ?? 0) <= before;
  });
  const rank: Record<DefenseRole, number> = { DT: 0, DE: 1, LB: 2, CB: 3, S: 4, DB: 5 };
  for (const slot of [...remaining].sort((a, b) => rank[a.role] - rank[b.role])) {
    for (const test of PREFERENCE[slot.role]) {
      const pick = order.find(p => !used.has(p.id) && test(p) && allowedInBox(slot.box).includes(p.position));
      if (pick) {
        put(slot.box, pick.id);
        break;
      }
    }
  }
  return lineup;
}

/** Bench players who could stand in this box. */
export function defenseReplacements(team: Team, lineup: DefenseLineup, box: DefensiveBox, unavailable: ReadonlySet<string> = new Set()): PlayerCard[] {
  const onField = new Set(Object.values(lineup).flat());
  return team.players.filter(p => allowedInBox(box).includes(p.position) && !onField.has(p.id) && !unavailable.has(p.id));
}

/** Swaps the player at `index` in `box` for a bench player. */
export function replaceDefender(lineup: DefenseLineup, box: DefensiveBox, index: number, player: PlayerCard): DefenseLineup {
  if (!allowedInBox(box).includes(player.position)) return lineup;
  const ids = [...(lineup[box] ?? [])];
  ids[index] = player.id;
  return { ...lineup, [box]: ids };
}

/** The opening formation that matches the team's lineup card: 3-4 or 4-3. */
export function defenseFormationForTeam(team: Team): 'dl3-lb4-db4-ace' | 'dl4-lb3-db4-ghi' {
  return team.startingLineup.defenseFormation.startsWith('4') ? 'dl4-lb3-db4-ghi' : 'dl3-lb4-db4-ace';
}

