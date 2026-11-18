/**
 * The computer coach reads the field: only what a coach at the table sees (who's on the field and their cards, the
 * score, the clock, the game so far), never the other side's call. Everything here is a weight that tilts the odds
 * the situation logic in coach.ts already sets, by an amount the temperament decides; nothing is a fixed rule, so a
 * human can't learn to exploit it.
 */
import { enduranceContext } from './endurance';
import { DefenseLineup } from './defense-lineup';
import { Lineup } from './lineup';
import { isPassPlay, OffensePlay } from './model/calls';
import { DefenseCall, DefensiveBox } from './model/defense';
import { getFormation, OffenseSlot, SLOT_GROUP, FormationId } from './model/formations';
import { GameState, Side } from './model/game';
import { isSkillPlayer, PlayerCard } from './model/players';
import { Team } from './model/team';
import { receiverRoles } from './pass';
import { SeededRandom } from './random';
import { playOptions } from './selection';
import { COVERING_BOX } from './tables';

export type Temperament = 'cautious' | 'normal' | 'bold';

/** How far the field reading may tilt the odds: cautious a little, bold a lot. */
export function tilt(state: GameState): number {
  return { cautious: 0.5, normal: 1, bold: 1.6 }[state.rules?.coachTemperament ?? 'normal'];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown) => (typeof v === 'number' ? v : 0);

/** What a back offers carrying the ball: his average N on RN 2-7, plus a little for each short or long gain chance. */
function runThreat(p: PlayerCard | undefined): number {
  if (!p || !isSkillPlayer(p) || !p.rushing) return 0;
  const rows = p.rushing.slice(1, 7);
  const n = rows.reduce((a, r) => a + num(r.n), 0) / rows.length;
  const big = p.rushing.filter(r => r.n === 'SG' || r.n === 'LG').length;
  return Math.max(0.5, n + big);
}

/** What a receiver offers catching the ball: his average short gain on RN 2-6 (quick if he has no short column). */
function passThreat(p: PlayerCard | undefined): number {
  if (!p || !isSkillPlayer(p) || !p.passGain) return 0;
  const rows = p.passGain.slice(1, 6);
  return Math.max(0.5, rows.reduce((a, r) => a + (num(r.s) || num(r.q)), 0) / rows.length);
}

/** Times this player had the ball this game, more for the last few plays: who the offense has been leaning on. */
function usage(state: GameState, side: Side, id: string): number {
  const events = state.events ?? [];
  const recent = Math.max(0, (state.playIndex ?? 0) - 8);
  let u = 0;
  for (const e of events) {
    if (e.side !== side) continue;
    const mine = (e.type === 'RUSH' && e.playerId === id) || (e.type === 'PASS' && e.targetId === id);
    if (mine) u += e.play >= recent ? 2 : 1;
  }
  return u;
}

/** May this player be called to carry (a run) or to catch (a pass) now? The endurance rule, as the game applies it. */
function mayGet(state: GameState, slot: OffenseSlot, p: PlayerCard | undefined, kind: 'run' | 'pass'): boolean {
  const ctx = { ballOn: state.ballOn ?? 50, ...enduranceContext(state) };
  return playOptions(slot, p, ctx).some(o => o.enabled && (kind === 'pass' ? isPassPlay(o.value) : !isPassPlay(o.value)));
}

// ---------------------------------------------------------------------------------------------------------------
// The computer on defense, reading the offense it sees lining up
// ---------------------------------------------------------------------------------------------------------------

export interface SeenOffense {
  formationId: FormationId;
  lineup: Lineup;
}

/** The offense's personnel nudges the run/pass guess: more backs and tight ends, more runs; more receivers, more passes. */
export function personnelNudge(state: GameState, seen: SeenOffense): number {
  const slots = getFormation(seen.formationId).skillSlots.filter(s => seen.lineup[s]);
  const backs = slots.filter(s => SLOT_GROUP[s] === 'back').length;
  const ends = slots.filter(s => s === 'TEL' || s === 'TER').length;
  const wide = slots.length - backs - ends;
  return tilt(state) * (0.07 * (backs - 1) + 0.04 * (ends - 1) - 0.06 * (wide - 2));
}

/**
 * The run defense: a key on the back most likely to hurt, weighted, or no key. A back who may not carry this play
 * (the endurance rule: he had the ball and must rest) gets no key at all: a Z card may divert a pass to him, never a
 * carry, so keying him is wasted.
 */
export function chooseRunKey(state: GameState, offense: Team, seen: SeenOffense, rng: SeededRandom): DefenseCall {
  const t = tilt(state);
  const options: [DefenseCall, number][] = [['RUN_NO_KEY', 1.2]];
  (['RB1', 'RB2', 'RB3'] as const).forEach((slot, i) => {
    const id = seen.lineup[slot];
    const p = offense.players.find(x => x.id === id);
    if (!id || !p || !mayGet(state, slot, p, 'run')) return;
    // The threat on his card and how much he has carried today, sharpened or softened by the temperament.
    const w = Math.pow(runThreat(p) * (1 + 0.15 * usage(state, state.possession!, id)), t) * (i === 0 ? 1.2 : 1);
    options.push([`RUN_KEY_BK${i + 1}` as DefenseCall, w]);
  });
  return weighted(rng, options);
}

/**
 * Double coverage: on the most dangerous receiver more often, weighted. A receiver who may not be thrown to this
 * play (endurance) can still get a pass diverted to him by a Z card, so he keeps a small weight.
 */
export function chooseCoverageTarget<R extends string>(state: GameState, offense: Team, seen: SeenOffense, rng: SeededRandom): R | null {
  const t = tilt(state);
  const options: [R, number][] = [];
  for (const [slot, role] of receiverRoles(getFormation(seen.formationId)).entries()) {
    const id = seen.lineup[slot];
    const p = offense.players.find(x => x.id === id);
    if (!id || !p) continue;
    const eligible = mayGet(state, slot, p, 'pass');
    const w = Math.pow(passThreat(p) * (1 + 0.1 * usage(state, state.possession!, id)), t) * (eligible ? 1 : 0.15);
    if (w > 0) options.push([role as unknown as R, w]);
  }
  return options.length ? weighted(rng, options) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The computer on offense, reading the defense it sees across the line (formation and players, not its call)
// ---------------------------------------------------------------------------------------------------------------

export interface SeenDefense {
  formationId: string;
  lineup: DefenseLineup;
}

const FRONT: DefensiveBox[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

/** A light box (few in the front two rows) makes a run more attractive; a heavy one, a pass. */
export function boxNudge(state: GameState, seen: SeenDefense): number {
  const front = FRONT.reduce((a, b) => a + (seen.lineup[b]?.length ?? 0), 0);
  return tilt(state) * 0.05 * (7 - front);
}

/** A pass to a receiver whose covering defender is weak in pass defense looks better (higher pass defense is worse). */
export function coverageFactor(state: GameState, defense: Team, seen: SeenDefense, formationId: FormationId, slot: OffenseSlot): number {
  const role = receiverRoles(getFormation(formationId)).get(slot);
  const box = role ? (COVERING_BOX as Record<string, DefensiveBox>)[role] : undefined;
  const id = box ? seen.lineup[box]?.[0] : undefined;
  const d = defense.players.find(p => p.id === id);
  const pd = d && 'passDefense' in d ? d.passDefense : 0;
  return clamp(1 + tilt(state) * 0.12 * pd, 0.4, 2.2);
}

/** A run towards the side with the weaker tacklers looks better (higher tackle values are worse). */
export function runSideFactor(state: GameState, defense: Team, seen: SeenDefense, play: OffensePlay): number {
  const side = play === 'IL' || play === 'SL' ? ['A', 'B', 'F', 'G'] : play === 'IR' || play === 'SR' || play === 'ER' ? ['D', 'E', 'I', 'J'] : [];
  if (!side.length) return 1;
  const tackles = side.flatMap(b => seen.lineup[b as DefensiveBox] ?? []).map(id => defense.players.find(p => p.id === id))
    .map(p => (p && 'tackle' in p ? p.tackle : 0));
  if (!tackles.length) return 1;
  const avg = tackles.reduce((a, b) => a + b, 0) / tackles.length;
  return clamp(1 + tilt(state) * 0.08 * avg, 0.5, 2);
}

function weighted<T>(rng: SeededRandom, options: [T, number][]): T {
  const total = options.reduce((a, [, w]) => a + w, 0);
  let roll = rng.next() * total;
  for (const [v, w] of options) {
    roll -= w;
    if (roll <= 0) return v;
  }
  return options[options.length - 1][0];
}
