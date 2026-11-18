/**
 * Who committed a penalty. The FAC only says which side (rule 8.8.3); like a referee's announcement, the game names
 * a player, picked at random among those on the field, weighted by how often each position commits that foul.
 * Only for the play-by-play and the stats: it never changes the yardage. Tune the numbers below to taste.
 */
import { PlayerCard } from './model/players';
import { SeededRandom } from './random';

export type PenaltyKind =
  | 'OFFENSIVE_HOLDING' | 'FALSE_START' | 'ILLEGAL_PROCEDURE' | 'MOTION' | 'OFFENSIVE_PERSONAL_FOUL'
  | 'DEFENSIVE_OFFSIDE' | 'DEFENSIVE_HOLDING' | 'DEFENSIVE_PERSONAL_FOUL'
  | 'INTENTIONAL_GROUNDING' | 'SPECIAL_TEAMS' | 'KICKER' | 'TEAM';

type Group = 'OL' | 'TE' | 'WR' | 'RB' | 'QB' | 'DL' | 'LB' | 'DB' | 'K' | 'P';

/** Share of the fouls per position group, in percent. Groups not on the field drop out and the rest scale up. */
export const PENALTY_SHARES: Record<PenaltyKind, Partial<Record<Group, number>>> = {
  OFFENSIVE_HOLDING: { OL: 80, TE: 10, WR: 6, RB: 4 },
  FALSE_START: { OL: 75, TE: 12, WR: 9, RB: 4 },
  ILLEGAL_PROCEDURE: { OL: 20, TE: 25, WR: 45, RB: 10 },
  MOTION: { WR: 60, TE: 20, RB: 20 },
  OFFENSIVE_PERSONAL_FOUL: { OL: 50, TE: 15, WR: 20, RB: 10, QB: 5 },
  DEFENSIVE_OFFSIDE: { DL: 80, LB: 18, DB: 2 },
  DEFENSIVE_HOLDING: { DL: 3, LB: 27, DB: 70 },
  DEFENSIVE_PERSONAL_FOUL: { DL: 35, LB: 35, DB: 30 },
  INTENTIONAL_GROUNDING: { QB: 100 },
  // Kick coverage and return units: mostly linebackers, backs and receivers.
  SPECIAL_TEAMS: { LB: 35, DB: 30, RB: 10, WR: 10, TE: 10, DL: 5 },
  KICKER: { K: 100 },
  TEAM: {},
};

/** Within a group, some positions draw more fouls: tackles more than guards, ends more than tackles, corners hold. */
const TILT: Partial<Record<PenaltyKind, Record<string, number>>> & { default: Record<string, number> } = {
  default: { OT: 1.4, OG: 1, C: 0.8, DE: 1.3, DT: 1 },
  DEFENSIVE_HOLDING: { CB: 1.6, S: 1 },
};

/** A personal foul is most likely by someone at the ball: the player in the box the run went to, or the tackler. */
export const NEAR_THE_PLAY = 3;

/** Penalty table number and side to the kind of foul it is in real football. */
export function penaltyKind(against: string, number: number): PenaltyKind {
  const offense = against === 'O';
  if (against === 'K' || against === 'R') return number === 15 ? 'KICKER' : number === 14 ? 'TEAM' : 'SPECIAL_TEAMS';
  switch (number) {
    case 1: case 2: return offense ? 'FALSE_START' : 'DEFENSIVE_OFFSIDE';
    case 3: return offense ? 'ILLEGAL_PROCEDURE' : 'DEFENSIVE_OFFSIDE';
    case 4: return offense ? 'MOTION' : 'DEFENSIVE_OFFSIDE';
    case 5: case 6: case 9: return offense ? 'OFFENSIVE_PERSONAL_FOUL' : 'DEFENSIVE_PERSONAL_FOUL';
    case 7: return offense ? 'OFFENSIVE_HOLDING' : 'DEFENSIVE_HOLDING';
    case 10: return 'INTENTIONAL_GROUNDING';
    case 12: case 13: return 'DEFENSIVE_OFFSIDE';
    default: return 'TEAM'; // delay of game and the like are called on the team
  }
}

function groupOf(p: PlayerCard): Group {
  switch (p.position) {
    case 'OT': case 'OG': case 'C': return 'OL';
    case 'DE': case 'DT': return 'DL';
    default: return p.position as Group; // K (kicks off) and P (punts) stay apart
  }
}

/** The players' weights for this foul, highest first. Exported for the tests and for tuning. */
export function penaltyWeights(kind: PenaltyKind, candidates: PlayerCard[], nearPlay: ReadonlySet<string> = new Set()) {
  const shares = PENALTY_SHARES[kind];
  const tilt = { ...TILT.default, ...(TILT[kind] ?? {}) };
  const tiltOf = (p: PlayerCard) => (p.position === 'DB' ? tilt[p.role ?? ''] ?? 1 : tilt[p.position] ?? 1);
  const present = candidates.filter(p => (shares[groupOf(p)] ?? 0) > 0);
  const groups = [...new Set(present.map(groupOf))];
  const total = groups.reduce((a, g) => a + (shares[g] ?? 0), 0);
  return present
    .map(p => {
      const inGroup = present.filter(x => groupOf(x) === groupOf(p));
      const tilts = inGroup.reduce((a, x) => a + tiltOf(x), 0);
      const near = kind.endsWith('PERSONAL_FOUL') && nearPlay.has(p.id) ? NEAR_THE_PLAY : 1;
      return { player: p, weight: ((shares[groupOf(p)] ?? 0) / total) * (tiltOf(p) / tilts) * near };
    })
    .sort((a, b) => b.weight - a.weight);
}

/** Picks the player, or null when the foul is on the team. Advances the seeded generator. */
export function choosePenalized(
  kind: PenaltyKind, candidates: PlayerCard[], rng: SeededRandom, nearPlay: ReadonlySet<string> = new Set(),
): PlayerCard | null {
  if (kind === 'TEAM') return null;
  const weights = penaltyWeights(kind, candidates, nearPlay);
  const sum = weights.reduce((a, w) => a + w.weight, 0);
  if (!weights.length || sum <= 0) return null;
  let roll = rng.next() * sum;
  for (const w of weights) {
    roll -= w.weight;
    if (roll <= 0) return w.player;
  }
  return weights[weights.length - 1].player;
}
