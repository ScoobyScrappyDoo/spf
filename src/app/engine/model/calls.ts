/** The coaches' secret choices (rule 7.0). String unions instead of C# enums: they serialize to readable JSON for free. */

export type RunPlay = 'IL' | 'IR' | 'SL' | 'SR' | 'ER';
export type PassPlay = 'SC' | 'QK' | 'SH' | 'LG';
export type OffensePlay = RunPlay | PassPlay;

export const RUN_PLAYS: readonly RunPlay[] = ['IL', 'IR', 'SL', 'SR', 'ER'];
export const PASS_PLAYS: readonly PassPlay[] = ['SC', 'QK', 'SH', 'LG'];

export const isRunPlay = (p: OffensePlay): p is RunPlay => (RUN_PLAYS as readonly string[]).includes(p);
export const isPassPlay = (p: OffensePlay): p is PassPlay => !isRunPlay(p);
export const isInsideRun = (p: OffensePlay) => p === 'IL' || p === 'IR';

export const PLAY_LABELS: Record<OffensePlay, string> = {
  IL: 'Inside left',
  IR: 'Inside right',
  SL: 'Sweep left',
  SR: 'Sweep right',
  ER: 'End around',
  SC: 'Screen pass',
  QK: 'Quick pass',
  SH: 'Short pass',
  LG: 'Long pass',
};

export type OffenseStrategy = 'NONE' | 'QB_FLOP' | 'QB_SNEAK' | 'DRAW' | 'PLAY_ACTION';

export const STRATEGY_LABELS: Record<OffenseStrategy, string> = {
  NONE: 'No strategy',
  QB_FLOP: 'QB flop',
  QB_SNEAK: 'QB sneak',
  DRAW: 'Draw play',
  PLAY_ACTION: 'Play action',
};


