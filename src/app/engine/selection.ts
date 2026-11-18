import { isInsideRun, isPassPlay, OffensePlay, OffenseStrategy, PASS_PLAYS, RUN_PLAYS } from './model/calls';
import { FormationId, getFormation, OffenseFormation, OffenseSlot, selectableSlots, SLOT_GROUP } from './model/formations';
import { hasPassColumn, hasRushColumn, isSkillPlayer, PlayerCard, SkillPlayer } from './model/players';

/** Everything the offensive coach picks secretly before a play (rule 2.3 / 7.1). */
export interface OffenseCall {
  formationId: FormationId;
  slot: OffenseSlot;
  play: OffensePlay;
  strategy: OffenseStrategy;
  /** Optional rule O4: backs kept in to pass block. */
  extraBlockers: OffenseSlot[];
}

/** One play the target was involved in. Needed for the play-direction ratings in rule 4.6. */
export interface TargetEvent {
  /** The player the play went to (the ball carrier, or the receiver the cards sent the pass to); null for kickoffs. */
  playerId: string | null;
  possession: number;
  quarter: number;
}

/** Game situation that limits the call. Everything is optional so the screen works before a game exists. */
export interface CallContext {
  /** Yards from the offense's own goal line (1-99). */
  ballOn?: number;
  /** Players who already ran an end-around this game (rule 8.2.6). */
  endAroundsUsed?: readonly string[];
  /** Most recent play last. */
  targetHistory?: readonly TargetEvent[];
  possession?: number;
  quarter?: number;
}

export interface Option<T> {
  value: T;
  enabled: boolean;
  /** Why it's disabled, in words the coach understands. */
  reason?: string;
}

const COLUMN = { QK: 'q', SH: 's', LG: 'l' } as const;

/** Rule 4.6: may another play be directed at this player right now? */
export function playDirectionCheck(player: SkillPlayer, ctx: CallContext): string | null {
  const history = ctx.targetHistory ?? [];
  const mine = (e: TargetEvent) => e.playerId === player.id;
  switch (player.playDirection) {
    case 0:
      return null;
    case 1:
      return history.slice(-1).some(mine) ? 'He was the target on the previous play' : null;
    case 2:
      return history.slice(-2).some(mine) ? 'He was the target on one of the previous two plays' : null;
    case 3:
      return history.some(e => mine(e) && e.possession === ctx.possession)
        ? 'He can only be the target once per possession'
        : null;
    case 4:
      return history.some(e => mine(e) && e.quarter === ctx.quarter) ? 'He can only be the target once per quarter' : null;
  }
}

/** Which of the nine plays can be called for the player in this slot. */
export function playOptions(slot: OffenseSlot, player: PlayerCard | undefined, ctx: CallContext = {}): Option<OffensePlay>[] {
  const group = SLOT_GROUP[slot];
  const skill = isSkillPlayer(player) ? player : undefined;
  const fatigue = skill ? playDirectionCheck(skill, ctx) : null;

  return [...RUN_PLAYS, ...PASS_PLAYS].map(play => {
    const no = (reason: string): Option<OffensePlay> => ({ value: play, enabled: false, reason });
    if (!player) return no('No player in this slot');

    // Who may be involved at all.
    if (play === 'ER') {
      if (group !== 'end' && group !== 'flanker') return no('End arounds go to an end or flanker');
      if (!skill || !hasRushColumn(skill)) return no('His card has no rushing column');
      if (ctx.endAroundsUsed?.includes(player.id)) return no('He already ran his one end around this game');
    } else if (play === 'SC') {
      if (group !== 'back') return no('Screen passes go to a back');
    } else if (play === 'IL' || play === 'IR' || play === 'SL' || play === 'SR') {
      if (group !== 'back' && group !== 'qb') return no('Runs go to the quarterback or a back');
    } else {
      if (group === 'qb') return no('The quarterback cannot throw to himself');
      if (!skill || !hasPassColumn(skill, COLUMN[play])) return no(`His card has no ${COLUMN[play].toUpperCase()} column`);
    }

    // Field position (rules 7.1.1, 8.3.9.1).
    if (play === 'SC' && ctx.ballOn !== undefined && ctx.ballOn <= 5) return no('No screen passes inside your own 5');
    if (play === 'LG' && ctx.ballOn !== undefined && ctx.ballOn >= 81) return no("No long passes inside the opponent's 20");

    if (fatigue) return no(fatigue);
    return { value: play, enabled: true };
  });
}

/** Rules 7.1.2.2 - 7.1.2.5. */
export function strategyOptions(slot: OffenseSlot, play: OffensePlay): Option<OffenseStrategy>[] {
  const group = SLOT_GROUP[slot];
  const opt = (value: OffenseStrategy, ok: boolean, reason: string): Option<OffenseStrategy> =>
    ok ? { value, enabled: true } : { value, enabled: false, reason };

  return [
    { value: 'NONE', enabled: true },
    // The WPF screen offered flop and sneak on sweeps too; the rules only allow them on inside runs.
    opt('QB_FLOP', group === 'qb' && isInsideRun(play), 'Only with an inside run by the quarterback'),
    opt('QB_SNEAK', group === 'qb' && isInsideRun(play), 'Only with an inside run by the quarterback'),
    opt('DRAW', (group === 'qb' || group === 'back') && isInsideRun(play), 'Only with an inside run by a back or the quarterback'),
    opt('PLAY_ACTION', play === 'SH' || play === 'LG', 'Only with a short or long pass'),
  ];
}

/** Optional rule O4: backs not targeted may stay in to block on QK/SH/LG (the screen doesn't use the QB's card). */
export function extraBlockerOptions(formation: OffenseFormation, slot: OffenseSlot, play: OffensePlay): OffenseSlot[] {
  if (!isPassPlay(play) || play === 'SC') return [];
  return formation.skillSlots.filter(s => SLOT_GROUP[s] === 'back' && s !== slot);
}

/** The play a call starts with when this slot becomes the target: backs and the QB run inside, receivers throw quick. */
export function defaultPlayFor(slot: OffenseSlot): OffensePlay {
  return SLOT_GROUP[slot] === 'back' || SLOT_GROUP[slot] === 'qb' ? 'IL' : 'QK';
}

/**
 * Turns any combination of choices into a legal call.
 * The C# version did this with a dozen Show/Check property pairs and a reset bug
 * (it cleared ShowStrategyX instead of CheckStrategyX, so an invalid strategy stayed selected).
 * One pure function replaces all of it, and every rule is in one place.
 */
export function normalizeCall(
  call: OffenseCall,
  playerInSlot: (slot: OffenseSlot) => PlayerCard | undefined,
  ctx: CallContext = {},
): OffenseCall {
  const formation = getFormation(call.formationId);
  const slots = selectableSlots(formation);
  // A target who left the field, or who may not be targeted right now (rule 4.6), hands over to the next player who can:
  // the backs first, then the receivers, the quarterback last. A new target starts with his default play.
  const available = (s: OffenseSlot) => slots.includes(s) && playOptions(s, playerInSlot(s), ctx).some(o => o.enabled);
  const order: OffenseSlot[] = ['RB1', 'RB2', 'RB3', 'FLL', 'FLR', 'SEL', 'SER', 'TEL', 'TER', 'QB'];
  const slot = available(call.slot) ? call.slot : (order.find(available) ?? 'RB1');
  const wanted = slot === call.slot ? call.play : defaultPlayFor(slot);

  const plays = playOptions(slot, playerInSlot(slot), ctx).filter(o => o.enabled).map(o => o.value);
  const fallback = defaultPlayFor(slot);
  const play = plays.includes(wanted) ? wanted : plays.includes(fallback) ? fallback : (plays[0] ?? fallback);

  const strategies = strategyOptions(slot, play).filter(o => o.enabled).map(o => o.value);
  const strategy = strategies.includes(call.strategy) ? call.strategy : 'NONE';

  const blockers = extraBlockerOptions(formation, slot, play);
  const extraBlockers = call.extraBlockers.filter(s => blockers.includes(s));

  return { formationId: formation.id, slot, play, strategy, extraBlockers };
}

/** The 12 values the bottom panel shows for the current call (the old V01..V12 properties). */
export function cardColumnForCall(player: PlayerCard | undefined, play: OffensePlay) {
  if (!player) return [];
  if (player.position === 'QB') return player.rushing.map(r => r.n);
  if (!isSkillPlayer(player)) return [];
  if (play === 'QK' || play === 'SH' || play === 'LG') return (player.passGain ?? []).map(r => r[COLUMN[play]]);
  return (player.rushing ?? []).map(r => r.n);
}
