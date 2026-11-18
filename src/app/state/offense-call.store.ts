import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  bestQuarterback, qbEnduranceReason, buildLineup, CallContext, cardColumnForCall, defaultPlayFor, eligibleReplacements, extraBlockerOptions, FormationId, formationForStarters,
  getFormation, Lineup, normalizeCall, OffenseCall, OffensePlay, OffenseSlot, OffenseStrategy, PlayerCard, placePlayer,
  playOptions, selectableSlots, Side, strategyOptions, suggestOffense, Injury, offenseBench, slotsOnField, enduranceContext,
  isSkillPlayer, playDirectionCheck,
} from '../engine';
import { GameStore } from './game.store';

const DEFAULT_CALL: OffenseCall = { formationId: 'pass-2wr-2te', slot: 'RB1', play: 'IL', strategy: 'NONE', extraBlockers: [] };

/**
 * State for the offense selection screen, always for the team that has the ball.
 * Each side keeps its own lineup and call, so when possession changes you find your offense the way you left it.
 * Every change goes through the engine's normalizeCall().
 */
@Injectable({ providedIn: 'root' })
export class OffenseCallStore {
  private readonly game = inject(GameStore);

  readonly side = this.game.offenseSide;
  readonly team = computed(() => {
    const side = this.side();
    const teams = this.game.teams();
    return side && teams ? teams[side] : null;
  });
  readonly playersById = computed(() => new Map<string, PlayerCard>((this.team()?.players ?? []).map(p => [p.id, p])));

  private readonly _lineups = signal<Partial<Record<Side, Lineup>>>({});
  private readonly _calls = signal<Partial<Record<Side, OffenseCall>>>({});
  /** The slot whose card is open in the side panel. Can be any slot, including linemen. */
  private readonly _inspected = signal<Partial<Record<Side, OffenseSlot>>>({});

  readonly lineup = computed(() => this.forSide(this._lineups()) ?? {});
  readonly call = computed(() => this.forSide(this._calls()) ?? DEFAULT_CALL);
  readonly inspectedSlot = computed(() => this.forSide(this._inspected()) ?? null);

  /** The game situation that limits the call, e.g. no long pass inside the opponent's 20. */
  readonly context = computed<CallContext>(() => {
    const s = this.game.state();
    return s ? { ballOn: s.ballOn ?? undefined, ...enduranceContext(s) } : {};
  });

  /** Why a slot's player may not be the target right now (rule 4.6), or null if he may. */
  readonly restReason = computed(() => {
    const reasons = new Map<OffenseSlot, string>();
    for (const slot of this.selectableSlots()) {
      const p = this.playerIn(slot);
      const why = p && isSkillPlayer(p) ? playDirectionCheck(p, this.context()) : null;
      if (why) reasons.set(slot, why);
    }
    return reasons;
  });

  readonly formation = computed(() => getFormation(this.call().formationId));
  readonly selectableSlots = computed(() => selectableSlots(this.formation()));
  readonly target = computed(() => this.playerIn(this.call().slot));
  readonly inspected = computed(() => {
    const slot = this.inspectedSlot();
    return slot ? this.playerIn(slot) : undefined;
  });
  readonly playOptions = computed(() => playOptions(this.call().slot, this.target(), this.context()));
  readonly strategyOptions = computed(() => strategyOptions(this.call().slot, this.call().play));
  readonly blockerOptions = computed(() => extraBlockerOptions(this.formation(), this.call().slot, this.call().play));
  readonly targetColumn = computed(() => cardColumnForCall(this.target(), this.call().play));
  readonly replacements = computed(() => {
    const team = this.team();
    const slot = this.inspectedSlot();
    const state = this.game.state();
    return team && slot && state ? offenseBench(state, this.side()!, team, this.lineup(), slot) : [];
  });

  /** Injured players still on the field. The play can't be run until each is replaced. */
  readonly injuredOnField = computed(() => {
    const side = this.side();
    return slotsOnField(this.formation()).flatMap(slot => {
      const injury = this.game.injuryOf(side, this.lineup()[slot]);
      return injury ? [{ slot, injury }] : [];
    });
  });

  /** Rule 4.5: why the quarterback on the field may not play now (a B whose A is fit again), and who should. */
  readonly qbProblem = computed(() => {
    const team = this.team();
    const state = this.game.state();
    const side = this.side();
    if (!team || !state || !side) return null;
    const reason = qbEnduranceReason(state, side, team, this.playerIn('QB'));
    return reason ? { reason, instead: bestQuarterback(state, side, team) } : null;
  });

  /** Why a bench player can't come in at a slot (rule 4.5 for quarterbacks), or null. */
  benchReason(player: PlayerCard): string | null {
    const team = this.team();
    const state = this.game.state();
    const side = this.side();
    return team && state && side ? qbEnduranceReason(state, side, team, player) : null;
  }

  /** The best healthy bench player for the first injured slot, if there is one. */
  readonly suggestion = computed(() => {
    const [first] = this.injuredOnField();
    const team = this.team();
    const state = this.game.state();
    if (!first || !team || !state) return null;
    const player = suggestOffense(state, this.side()!, team, this.lineup(), first.slot);
    return player ? { slot: first.slot, player, injury: first.injury as Injury } : null;
  });

  constructor() {
    // Online, the defense sees how the offense lines up, whichever page its coach is on: every change of formation or
    // players is shown at once (only the offense's own coach sends it; GameStore checks the seat).
    effect(() => {
      const formation = this.formation(), lineup = this.lineup();
      const s = this.game.state(); // and whenever the game moves on (a new play, the end of a kickoff): sent only if out of date
      if (this.game.sharesLook() && s?.phase === 'PLAY' && Object.keys(lineup).length) untracked(() => this.game.showOffense(formation.id, lineup));
    });
    // The first time a team has the ball, line up its starters in the formation that fits them and open RB1's card.
    effect(() => {
      const side = this.side();
      const team = this.team();
      if (!side || !team || untracked(this._lineups)[side]) return;
      untracked(() => {
        const formationId = formationForStarters(team);
        this.setForSide(this._lineups, buildLineup(team, getFormation(formationId)));
        this.setForSide(this._calls, { ...DEFAULT_CALL, formationId });
        this.apply({});
        this.setForSide(this._inspected, this.call().slot);
      });
    });
  }

  /** Why the call last moved by itself, for the coach to read. Cleared when the coach picks a player himself. */
  readonly notice = signal<string | null>(null);

  /**
   * Re-checks the call against the latest game state. After a snap the ball carrier may need a rest (rule 4.6):
   * the call then moves to the next player who can go, his card opens, and the coach is told why.
   */
  refresh() {
    if (!this.side() || !this.team()) return;
    const before = this.call().slot;
    const why = this.restReason().get(before);
    this.apply({});
    const after = this.call().slot;
    if (after === before || !why) return;
    this.setForSide(this._inspected, after);
    const resting = this.playerIn(before);
    const next = this.playerIn(after);
    const rating = resting && isSkillPlayer(resting) ? resting.playDirection : '';
    this.notice.set(
      `${resting?.firstName} ${resting?.lastName} was the ball carrier on the last play and needs a rest (rating ${rating}), ` +
        `so the call moved to ${next?.firstName} ${next?.lastName} (${after}).`,
    );
  }

  playerIn(slot: OffenseSlot) {
    const id = this.lineup()[slot];
    return id ? this.playersById().get(id) : undefined;
  }

  chooseFormation(id: FormationId) {
    const team = this.team();
    if (!team) return;
    this.setForSide(this._lineups, buildLineup(team, getFormation(id), this.lineup()));
    this.apply({ formationId: id });
    // If the open card's slot left the field, show the target's card instead of an empty panel.
    const inspected = this.inspectedSlot();
    if (!inspected || !this.lineup()[inspected]) this.setForSide(this._inspected, this.call().slot);
  }

  /**
   * Makes this slot the player the play goes to, and opens his card so both always match.
   * A new target starts a new call: the play resets to his position's default (IL for backs and QB, QK for receivers).
   */
  chooseTarget(slot: OffenseSlot) {
    if (this.restReason().has(slot)) return; // resting (rule 4.6): his card can be looked at, but he can't be the target
    this.notice.set(null);
    if (slot !== this.call().slot) this.apply({ slot, play: defaultPlayFor(slot) });
    this.setForSide(this._inspected, this.call().slot);
  }

  choosePlay(play: OffensePlay) {
    this.apply({ play });
  }

  chooseStrategy(strategy: OffenseStrategy) {
    this.apply({ strategy });
  }

  toggleBlocker(slot: OffenseSlot) {
    const current = this.call().extraBlockers;
    this.apply({ extraBlockers: current.includes(slot) ? current.filter(s => s !== slot) : [...current, slot] });
  }

  /** Puts the suggested player in, and opens his card. */
  acceptSuggestion() {
    const s = this.suggestion();
    if (!s) return;
    this.replace(s.slot, s.player.id);
    this.setForSide(this._inspected, s.slot);
  }

  /** The coach clicked a resting player: tell him why the call stays where it is. */
  explainRest(slot: OffenseSlot) {
    const p = this.playerIn(slot);
    const target = this.playerIn(this.call().slot);
    if (!p || !target) return;
    const rating = isSkillPlayer(p) ? p.playDirection : '';
    this.notice.set(
      `${p.firstName} ${p.lastName} is resting (rating ${rating}) and can't be called on this play. ` +
        `The call stays with ${target.firstName} ${target.lastName} (${this.call().slot}).`,
    );
  }

  inspect(slot: OffenseSlot) {
    this.setForSide(this._inspected, slot);
  }

  replace(slot: OffenseSlot, playerId: string) {
    const team = this.team();
    const player = this.playersById().get(playerId);
    if (!team || !player) return;
    this.setForSide(this._lineups, placePlayer(this.lineup(), slot, player, team));
    // A different man in the target slot is a new target, so he starts with the default play too.
    this.apply(slot === this.call().slot ? { play: defaultPlayFor(slot) } : {});
  }

  private apply(change: Partial<OffenseCall>) {
    this.setForSide(this._calls, normalizeCall({ ...this.call(), ...change }, s => this.playerIn(s), this.context()));
  }

  private forSide<T>(map: Partial<Record<Side, T>>): T | undefined {
    const side = this.side();
    return side ? map[side] : undefined;
  }

  private setForSide<T>(target: ReturnType<typeof signal<Partial<Record<Side, T>>>>, value: T) {
    const side = this.side();
    if (side) target.update(m => ({ ...m, [side]: value }));
  }
}
