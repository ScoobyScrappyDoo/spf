/**
 * Play direction (rule 4.6): the number after a back's or receiver's position says how often plays may go to him.
 * The game records who every play went to; this works out who is resting and until when.
 */
import { GameState, Side } from './model/game';
import { isSkillPlayer, SkillPlayer } from './model/players';
import { Team } from './model/team';
import { CallContext, playDirectionCheck, TargetEvent } from './selection';

/** What the play-direction check needs from the game. */
export function enduranceContext(state: GameState): Pick<CallContext, 'targetHistory' | 'possession' | 'quarter'> {
  return { targetHistory: state.targets ?? [], possession: state.possessionIndex ?? 0, quarter: state.quarter };
}

/** Records who a play went to. Kickoffs go to nobody, but still count as a play in between. */
export function recordTarget(state: GameState, playerId: string | null, side: Side | null): GameState {
  const event: TargetEvent & { side?: Side | null } = { playerId, side, possession: state.possessionIndex ?? 0, quarter: state.quarter };
  return { ...state, targets: [...(state.targets ?? []), event] };
}

export function nextPossession(state: GameState): GameState {
  return { ...state, possessionIndex: (state.possessionIndex ?? 0) + 1 };
}

export interface Resting {
  player: SkillPlayer;
  rating: number;
  reason: string;
  /** When he can be the target again. */
  back: string;
}

/** Backs and receivers who may not be the target of the next play. */
export function restingPlayers(state: GameState, team: Team): Resting[] {
  const ctx = enduranceContext(state);
  const history = ctx.targetHistory ?? [];
  return team.players.filter(isSkillPlayer).flatMap(player => {
    const reason = playDirectionCheck(player, ctx);
    if (!reason) return [];
    let back = '';
    switch (player.playDirection) {
      case 1: back = 'after the next play'; break;
      case 2: back = history.at(-1)?.playerId === player.id ? 'after the next 2 plays' : 'after the next play'; break;
      case 3: back = 'next possession'; break;
      case 4: back = 'next quarter'; break;
    }
    return [{ player, rating: player.playDirection, reason, back }];
  });
}
