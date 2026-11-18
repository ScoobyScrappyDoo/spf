/**
 * Who made the tackle on a run, for the stats. The run card sometimes names a box ("box C"); then the player there
 * made the stop at the line. Otherwise a defender is picked at random: from the side of the field the run went to,
 * from the line on short gains, the linebackers on medium ones and the secondary on long ones. Sometimes a second
 * player shares the tackle (an assist each, NFL style). Seeded; never changes the yardage. Tune the numbers below.
 */
import { DefenseLineup } from './defense-lineup';
import { DefensiveBox, rowOf } from './model/defense';
import { SeededRandom } from './random';

/** The boxes covering each run's side of the field. The offense's left faces boxes A, F and K. */
export const RUN_ZONES: Record<'IL' | 'IR' | 'SL' | 'SR' | 'ER', DefensiveBox[]> = {
  SL: ['A', 'B', 'F', 'G', 'K', 'L'],
  IL: ['B', 'C', 'G', 'H', 'L', 'M'],
  IR: ['C', 'D', 'H', 'I', 'M', 'N'],
  SR: ['D', 'E', 'I', 'J', 'N', 'O'],
  ER: ['A', 'E', 'F', 'J', 'K', 'O'],
};

/** Share of tackles per row (line, linebackers, secondary) by how far the run went. */
export const ROW_SHARES = {
  short: [50, 45, 5], //   3 yards or less
  medium: [15, 60, 25], // 4 to 9 yards
  long: [5, 30, 65], //    10 yards or more
};

/** Chance, in percent, that a second player shares the tackle. */
export const ASSIST_CHANCE = { short: 45, medium: 30, long: 15 };

/** A run stopped within this many yards was stopped by the player in the box the card named. */
export const NAMED_BOX_MAX_YARDS = 9;

const band = (yards: number) => (yards <= 3 ? 'short' : yards <= 9 ? 'medium' : 'long');

function weighted(boxes: DefensiveBox[], lineup: DefenseLineup, yards: number, exclude: string | null) {
  const shares = ROW_SHARES[band(yards)];
  const byRow = [1, 2, 3].map(row => boxes.filter(b => rowOf(b) === row).flatMap(b => lineup[b] ?? []).filter(id => id !== exclude));
  const total = byRow.reduce((a, ids, i) => a + (ids.length ? shares[i] : 0), 0);
  return byRow.flatMap((ids, i) => ids.map(id => ({ id, weight: total ? shares[i] / total / ids.length : 0 })));
}

function pick(choices: { id: string; weight: number }[], rng: SeededRandom): string | null {
  const sum = choices.reduce((a, c) => a + c.weight, 0);
  if (!choices.length || sum <= 0) return null;
  let roll = rng.next() * sum;
  for (const c of choices) {
    roll -= c.weight;
    if (roll <= 0) return c.id;
  }
  return choices[choices.length - 1].id;
}

export interface Tacklers {
  primary: string;
  /** A second player who shared the tackle; then both are credited with an assist instead of a solo tackle. */
  assist: string | null;
}

export function chooseTacklers(
  play: keyof typeof RUN_ZONES, yards: number, namedBoxes: DefensiveBox[], lineup: DefenseLineup, rng: SeededRandom,
): Tacklers | null {
  const everyone = Object.keys(lineup) as DefensiveBox[];
  const atTheSpot = namedBoxes.flatMap(b => lineup[b] ?? []);
  let primary: string | null = null;
  if (atTheSpot.length && yards <= NAMED_BOX_MAX_YARDS) {
    primary = atTheSpot[rng.int(atTheSpot.length)];
  } else {
    primary = pick(weighted(RUN_ZONES[play], lineup, yards, null), rng) ?? pick(weighted(everyone, lineup, yards, null), rng);
  }
  if (!primary) return null;
  let assist: string | null = null;
  if (rng.int(100) < ASSIST_CHANCE[band(yards)]) {
    assist = pick(weighted(RUN_ZONES[play], lineup, yards, primary), rng);
  }
  return { primary, assist };
}
