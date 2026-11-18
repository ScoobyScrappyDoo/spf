/**
 * The defense's strategies beyond its call: who blitzes (rule 8.3.6.1), double and triple coverage (rule 7.2.2) and big
 * plays (rule 8.4). Shared by the engine, the Defense page and the computer coach.
 */
import { DefenseLineup } from './defense-lineup';
import { Coverage, DefenseSetup, GameState, ReceiverPosition, Side } from './model/game';
import { DefensiveBox } from './model/defense';
import { PlayerCard } from './model/players';
import { Team } from './model/team';

export const ROW_2: DefensiveBox[] = ['F', 'G', 'H', 'I', 'J'];
export const ROW_3: DefensiveBox[] = ['K', 'L', 'M', 'N', 'O'];
/** The box that guards each receiver position (rule 8.3.2.2). */
export const GUARDING_BOX: Record<ReceiverPosition, DefensiveBox> = { LE: 'K', RE: 'N', FL1: 'O', FL2: 'M', BK1: 'F', BK2: 'J', BK3: 'H' };
export const RECEIVER_NAMES: Record<ReceiverPosition, string> = { LE: 'LE', RE: 'RE', FL1: 'FL#1', FL2: 'FL#2', BK1: 'BK#1', BK2: 'BK#2', BK3: 'BK#3' };
export const DOUBLE_COVERAGE = -7;
export const TRIPLE_COVERAGE = -15;

const count = (lineup: DefenseLineup, boxes: DefensiveBox[]) => boxes.reduce((a, b) => a + (lineup[b]?.length ?? 0), 0);

/** Who blitzes: the coach's choice, or the outside linebackers in F and J when he named nobody. */
export function blitzersOf(setup: DefenseSetup): string[] {
  if (setup.call !== 'BLITZ') return [];
  if (setup.blitzers?.length) return setup.blitzers;
  return (['F', 'J'] as DefensiveBox[]).flatMap(b => setup.lineup[b] ?? []);
}

/** Players who may blitz: anyone in rows 2 and 3. */
export function canBlitz(lineup: DefenseLineup, playerId: string): boolean {
  return [...ROW_2, ...ROW_3].some(b => (lineup[b] ?? []).includes(playerId));
}

/**
 * Which coverages the formation allows (rule 7.2.2): double with four and four in rows 2 and 3, or three and five;
 * triple only in the 3-2-6 (two and six), where the triple card may also double two receivers instead.
 */
export function coverageAllowed(setup: Pick<DefenseSetup, 'call' | 'lineup'>): { double: boolean; triple: boolean; why: string | null } {
  if (setup.call !== 'PASS' && setup.call !== 'PREVENT') return { double: false, triple: false, why: 'Only with a pass or prevent defense' };
  const r2 = count(setup.lineup, ROW_2);
  const r3 = count(setup.lineup, ROW_3);
  const triple = r2 === 2 && r3 === 6;
  const double = triple || (r2 === 4 && r3 === 4) || (r2 === 3 && r3 === 5);
  return { double, triple, why: double ? null : 'Needs 4 and 4 in rows 2 and 3, 3 and 5, or the 3-2-6' };
}

/** Why a set of coverages can't be called, or null: one triple alone, or up to two doubles. */
export function coverageProblem(setup: DefenseSetup): string | null {
  const cov = setup.coverage ?? [];
  if (!cov.length) return null;
  const allowed = coverageAllowed(setup);
  if (!allowed.double) return allowed.why;
  const triples = cov.filter(c => c.level === 'TRIPLE');
  if (triples.length && !allowed.triple) return 'Triple coverage needs the 3-2-6';
  if (triples.length && cov.length > 1) return 'A triple coverage covers one receiver';
  if (cov.length > 2) return 'At most two receivers can be double covered';
  if (new Set(cov.map(c => c.receiver)).size !== cov.length) return 'Each receiver only once';
  return null;
}

/**
 * The extra defenders in a double (one) or triple (two) coverage: from rows 2 and 3, not blitzing, not the receiver's
 * own defender and not guarding another covered receiver, the best interceptors first (they may pick it off, 8.3.5.1).
 */
export function coverageHelpers(setup: DefenseSetup, team: Team, coverage: Coverage): PlayerCard[] {
  const taken = new Set([...(setup.coverage ?? []).map(c => GUARDING_BOX[c.receiver])]);
  const free = [...ROW_3, ...ROW_2].filter(b => !taken.has(b)).flatMap(b => setup.lineup[b] ?? []);
  const blitzing = new Set(blitzersOf(setup));
  const others = (setup.coverage ?? []).filter(c => c !== coverage);
  const helping = new Set(others.flatMap(c => coverageHelpersFor(setup, team, c, free, blitzing)).map(p => p.id));
  return coverageHelpersFor(setup, team, coverage, free, blitzing).filter(p => !helping.has(p.id));
}

function coverageHelpersFor(setup: DefenseSetup, team: Team, coverage: Coverage, free: string[], blitzing: Set<string>): PlayerCard[] {
  const reach = (p: PlayerCard) => ('intercept' in p && p.intercept ? 49 - p.intercept.from : 0);
  const players = free.filter(id => !blitzing.has(id)).map(id => team.players.find(p => p.id === id)).filter((p): p is PlayerCard => !!p);
  return players.sort((a, b) => reach(b) - reach(a)).slice(0, coverage.level === 'TRIPLE' ? 2 : 1);
}

/** Big plays (rule 8.4): the team card's number for home or road games, one per possession. */
export function bigPlaysLeft(state: GameState, side: Side, team: Team): number {
  const allowed = side === 'home' ? team.bigPlays?.home ?? 0 : team.bigPlays?.road ?? 0;
  return Math.max(0, allowed - (state.bigPlaysUsed?.[side] ?? 0));
}

export function bigPlayBlocked(state: GameState, side: Side, team: Team): string | null {
  if (!bigPlaysLeft(state, side, team)) return 'No big plays left';
  if (state.bigPlayPossession?.[side] === (state.possessionIndex ?? 0)) return 'One per possession';
  return null;
}

/** The Big Play Table (6.9): RN 1-7 a result against a run or a pass; 8-12 "card fails". */
export function bigPlayResult(rn: number, pass: boolean): { kind: 'loss'; yards: number } | { kind: 'sack'; yards: number } | { kind: 'incomplete' } | null {
  if (rn >= 8) return null;
  if (!pass) return { kind: 'loss', yards: [0, 4, 3, 2, 1][rn] ?? 0 };
  if (rn <= 3) return { kind: 'sack', yards: [0, 13, 10, 7][rn] };
  return { kind: 'incomplete' };
}

/**
 * Optional rule O1 for defensive backs: a cornerback in a safety box (M, N) or a safety in a cornerback box (K, O) covers
 * one worse. The rule says "subtract 1", but lower pass defense is better on these cards, so it counts as +1 here, the
 * penalty the rule means. Box L, and backs listed only as "defensive back", never lose anything.
 */
export function dbOutOfPosition(player: PlayerCard | undefined, box: DefensiveBox): { penalty: number; text: string } | null {
  if (!player || player.position !== 'DB' || !player.role) return null;
  const want = box === 'K' || box === 'O' ? 'CB' : box === 'M' || box === 'N' ? 'S' : null;
  if (!want || want === player.role) return null;
  return { penalty: 1, text: player.role === 'CB' ? 'Cornerback playing safety' : 'Safety playing cornerback' };
}
