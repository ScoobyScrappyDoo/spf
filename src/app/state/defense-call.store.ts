import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  buildDefenseLineup, DefenseCall, DefenseFormationId, defenseFormationForTeam, DefenseLineup, defenseReplacements,
  DefensiveBox, getDefenseFormation, PlayerCard, replaceDefender, Side, defenseBench, suggestDefense, Injury, blitzersOf, Coverage, coverageAllowed, ReceiverPosition, ROW_2, ROW_3 } from '../engine';
import { GameStore } from './game.store';

/** A player on the defensive display: his box and, for a box with two players (L), which of the two. */
export interface DefenderRef {
  box: DefensiveBox;
  index: number;
}

interface DefenseState {
  formationId: DefenseFormationId;
  lineup: DefenseLineup;
  call: DefenseCall;
  inspected: DefenderRef | null;
}

/**
 * State for the defense selection screen, always for the team without the ball.
 * Each side keeps its own setup, so a team finds its defense the way it left it after a change of possession.
 */
@Injectable({ providedIn: 'root' })
export class DefenseCallStore {
  private readonly game = inject(GameStore);

  readonly side = this.game.defenseSide;
  readonly team = computed(() => {
    const side = this.side();
    const teams = this.game.teams();
    return side && teams ? teams[side] : null;
  });
  readonly playersById = computed(() => new Map<string, PlayerCard>((this.team()?.players ?? []).map(p => [p.id, p])));

  private readonly _bySide = signal<Partial<Record<Side, DefenseState>>>({});
  private readonly current = computed(() => {
    const side = this.side();
    return side ? this._bySide()[side] : undefined;
  });

  readonly formation = computed(() => getDefenseFormation(this.current()?.formationId ?? 'dl3-lb4-db4-ace'));
  readonly lineup = computed(() => this.current()?.lineup ?? {});
  readonly call = computed<DefenseCall>(() => this.current()?.call ?? 'RUN_KEY_BK1');
  readonly inspectedRef = computed(() => this.current()?.inspected ?? null);
  readonly inspected = computed(() => {
    const ref = this.inspectedRef();
    const id = ref ? this.lineup()[ref.box]?.[ref.index] : undefined;
    return id ? this.playersById().get(id) : undefined;
  });
  readonly replacements = computed(() => {
    const team = this.team();
    const ref = this.inspectedRef();
    const state = this.game.state();
    return team && ref && state ? defenseBench(state, this.side()!, team, this.lineup(), ref.box) : [];
  });

  /** Injured players still on the display. The defense can't say All set until each is replaced. */
  readonly injuredOnField = computed(() => {
    const side = this.side();
    return Object.entries(this.lineup()).flatMap(([box, ids]) =>
      (ids ?? []).flatMap((id, index) => {
        const injury = this.game.injuryOf(side, id);
        return injury ? [{ box: box as DefensiveBox, index, injury }] : [];
      }),
    );
  });

  readonly suggestion = computed(() => {
    const [first] = this.injuredOnField();
    const team = this.team();
    const state = this.game.state();
    if (!first || !team || !state) return null;
    const role = this.formation().slots.find(s => s.box === first.box)?.role ?? 'DB';
    const player = suggestDefense(state, this.side()!, team, this.lineup(), first.box, role);
    return player ? { ref: { box: first.box, index: first.index }, player, injury: first.injury as Injury } : null;
  });

  acceptSuggestion() {
    const s = this.suggestion();
    if (!s || this.locked()) return;
    this.update({ inspected: s.ref });
    this.replace(s.player.id);
  }
  /** Once "All set!" is pressed the defense is locked until "Not yet". */
  readonly locked = this.game.defenseReady;
  /** Rule 8.7: against a no-huddle with the clock running, the players and formation stay; the call may change. */
  readonly noHuddle = this.game.noHuddleLock;

  constructor() {
    // Online, the offense sees how the defense sets up, whichever page its coach is on (only the defense's own coach
    // sends it; GameStore checks the seat).
    effect(() => {
      const formation = this.formation(), lineup = this.lineup();
      const s = this.game.state(); // and whenever the game moves on: sent only if out of date
      if (this.game.online() && s?.phase === 'PLAY' && Object.keys(lineup).length) untracked(() => this.game.showDefense(formation.id, lineup));
    });
    // The first time a team is on defense, line up its starters in the formation from its lineup card.
    effect(() => {
      const side = this.side();
      const team = this.team();
      if (!side || !team || untracked(this._bySide)[side]) return;
      const formation = getDefenseFormation(defenseFormationForTeam(team));
      const lineup = buildDefenseLineup(team, formation);
      untracked(() => this.update({ formationId: formation.id, lineup, call: 'RUN_KEY_BK1', inspected: { box: formation.slots[0].box, index: 0 } }));
    });
  }

  playersIn(box: DefensiveBox): PlayerCard[] {
    return (this.lineup()[box] ?? []).map(id => this.playersById().get(id)).filter((p): p is PlayerCard => !!p);
  }

  chooseFormation(id: DefenseFormationId) {
    if (this.noHuddle()) return;
    const team = this.team();
    if (!team || this.locked()) return;
    const formation = getDefenseFormation(id);
    const lineup = buildDefenseLineup(team, formation, this.lineup());
    const ref = this.inspectedRef();
    const stillThere = ref && lineup[ref.box]?.[ref.index];
    this.update({ formationId: id, lineup, inspected: stillThere ? ref : { box: formation.slots[0].box, index: 0 } });
  }

  chooseCall(call: DefenseCall) {
    if (!this.locked()) this.update({ call });
  }

  inspect(ref: DefenderRef) {
    this.update({ inspected: ref });
  }

  replace(playerId: string) {
    if (this.noHuddle()) return;
    const ref = this.inspectedRef();
    const player = this.playersById().get(playerId);
    if (!ref || !player || this.locked()) return;
    this.update({ lineup: replaceDefender(this.lineup(), ref.box, ref.index, player) });
  }

  /** Against an announced punt: rush all out (rule 8.5.7). Only counts while a punt is declared. */
  readonly allOutRush = signal(false);
  /** Against a punt or field goal: expect a fake (rule O6). */
  readonly expectFake = signal(false);

  // ---- Blitzers (rule 8.3.6.1): anyone in rows 2 and 3; F and J unless the coach picks ----
  private readonly chosenBlitzers = signal<string[] | null>(null);
  /** Who may blitz, with their boxes: the players in rows 2 and 3. */
  readonly blitzCandidates = computed(() =>
    [...ROW_2, ...ROW_3].flatMap(box => (this.lineup()[box] ?? []).map(id => ({ box, player: this.playersById().get(id)! }))).filter(c => !!c.player));
  /** The blitzers the play will use: the coach's pick if it still fits the lineup, otherwise F and J. */
  readonly blitzers = computed(() => {
    const ok = new Set(this.blitzCandidates().map(c => c.player.id));
    const chosen = (this.chosenBlitzers() ?? []).filter(id => ok.has(id));
    return chosen.length ? chosen : blitzersOf({ formationId: this.formation().id, lineup: this.lineup(), call: 'BLITZ' });
  });
  toggleBlitzer(id: string) {
    if (this.locked()) return;
    const now = this.blitzers();
    const next = now.includes(id) ? now.filter(x => x !== id) : [...now, id];
    this.chosenBlitzers.set(next.length ? next : now); // at least one blitzer
  }

  // ---- Double and triple coverage (rule 7.2.2) ----
  readonly coverageLevel = signal<'NONE' | 'DOUBLE' | 'TRIPLE'>('NONE');
  readonly coveredReceivers = signal<ReceiverPosition[]>([]);
  readonly coverageAllowed = computed(() => coverageAllowed({ call: this.call(), lineup: this.lineup() }));
  setCoverageLevel(level: 'NONE' | 'DOUBLE' | 'TRIPLE') {
    if (this.locked()) return;
    this.coverageLevel.set(level);
    if (level === 'TRIPLE') this.coveredReceivers.update(r => r.slice(0, 1));
  }
  toggleCovered(receiver: ReceiverPosition) {
    if (this.locked()) return;
    const max = this.coverageLevel() === 'TRIPLE' ? 1 : 2;
    this.coveredReceivers.update(r => (r.includes(receiver) ? r.filter(x => x !== receiver) : [...r, receiver].slice(-max)));
  }
  /** The coverage the play will use, if the call and formation still allow it. */
  readonly coverage = computed<Coverage[]>(() => {
    const allowed = this.coverageAllowed();
    const level = this.coverageLevel();
    if (level === 'NONE' || !allowed.double || (level === 'TRIPLE' && !allowed.triple)) return [];
    return this.coveredReceivers().map(receiver => ({ receiver, level }));
  });

  /** What "All set!" hands to the game. */
  setup() {
    const punting = !!this.game.puntCall();
    const call = this.call();
    return {
      formationId: this.formation().id, lineup: this.lineup(), call, allOutRush: punting && this.allOutRush() && !this.expectFake(),
      ...((punting || this.game.fieldGoalCall()) && this.expectFake() ? { expectFake: true } : {}),
      ...(call === 'BLITZ' ? { blitzers: this.blitzers() } : {}),
      ...(this.coverage().length ? { coverage: this.coverage() } : {}),
    };
  }

  private update(change: Partial<DefenseState>) {
    const side = this.side();
    if (!side) return;
    this._bySide.update(m => ({ ...m, [side]: { ...(m[side] as DefenseState), ...change } }));
  }
}
