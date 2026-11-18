import { describe, expect, it } from 'vitest';
import deckJson from '../../../public/cards/fac-deck.json';
import teamJson from './testdata/1984/patriots.json';
import {
  buildLineup, cardColumnForCall, Fac, FacDeck, FORMATIONS, getFormation, isSkillPlayer, Lineup, normalizeCall,
  defaultPlayFor, OffenseCall, OffenseSlot, placePlayer, playOptions, RegularFac, rulesRole, SkillPlayer, slotsOnField, strategyOptions, Team,
} from './index';

const deck = deckJson as Fac[];
const team = teamJson as unknown as Team;
const player = (last: string) => team.players.find(p => p.lastName === last)!;
const enabled = <T>(opts: { value: T; enabled: boolean }[]) => opts.filter(o => o.enabled).map(o => o.value);

describe('data files', () => {
  it('FAC deck has 96 regular and 13 Z cards, each pass number exactly twice', () => {
    const regular = deck.filter((c): c is RegularFac => !c.isZ);
    expect(regular.length).toBe(96);
    expect(deck.length - regular.length).toBe(13);
    for (let pn = 1; pn <= 48; pn++) expect(regular.filter(c => c.passNumber === pn).length).toBe(2);
  });

  it('every QB passing and pass rush table covers 1-48 without gaps', () => {
    for (const qb of team.players.filter(p => p.position === 'QB')) {
      if (qb.position !== 'QB') continue;
      const tables = [qb.passing.quick, qb.passing.short, qb.passing.long].map(t => [t.com, t.inc, t.int])
        .concat([[qb.passRush.sack, qb.passRush.runs, qb.passRush.com, qb.passRush.inc]]);
      for (const t of tables) {
        const parts = t.filter(r => r !== null);
        expect(parts[0]!.from).toBe(1);
        expect(parts.at(-1)!.to).toBe(48);
        parts.slice(1).forEach((r, i) => expect(r!.from).toBe(parts[i]!.to + 1));
      }
    }
  });
});

describe('formations', () => {
  it('with two flankers FLL is FL#1, a lone flanker is always FL#1', () => {
    expect(rulesRole('FLL', getFormation('pass-4wr'))).toBe('FL1');
    expect(rulesRole('FLR', getFormation('pass-4wr'))).toBe('FL2');
    expect(rulesRole('FLR', getFormation('2rb-2wr-te-right'))).toBe('FL1');
  });

  it('always put 11 players on the field with one left end and one right end', () => {
    for (const f of FORMATIONS) {
      expect(new Set(slotsOnField(f)).size).toBe(11);
      expect(f.skillSlots.filter(s => s === 'SEL' || s === 'TEL').length).toBe(1);
      expect(f.skillSlots.filter(s => s === 'SER' || s === 'TER').length).toBe(1);
    }
  });
});

describe('lineup', () => {
  const twoTe = getFormation('pass-2wr-2te');

  it('fills the listed starters for a 2 WR / 2 TE set', () => {
    const l = buildLineup(team, twoTe);
    const name = (s: OffenseSlot) => team.players.find(p => p.id === l[s])?.lastName;
    expect(name('QB')).toBe('Eason');
    expect(name('RB1')).toBe('James');
    expect([name('TEL'), name('TER')].sort()).toEqual(['Dawson', 'Ramsey']);
    expect([name('FLL'), name('FLR')].sort()).toEqual(['Morgan', 'Starring']);
    expect([name('LT'), name('LG'), name('C'), name('RG'), name('RT')]).toEqual(['Holloway', 'Hannah', 'Brock', 'Wooten', 'Healey']);
  });

  it('keeps players in place when switching formation and fills new slots from the bench', () => {
    const before = buildLineup(team, twoTe);
    const after = buildLineup(team, getFormation('run-3rb-2te'), before);
    expect(after.RB1).toBe(before.RB1);
    expect(after.TEL).toBe(before.TEL);
    const backs = [after.RB2, after.RB3].map(id => team.players.find(p => p.id === id)!.lastName).sort();
    expect(backs).toEqual(['Collins', 'Tatupu']);
    expect(after.FLL).toBeUndefined();
  });

  it('swaps two players already on the field', () => {
    const l = buildLineup(team, twoTe);
    const swapped = placePlayer(l, 'TEL', player(team.players.find(p => p.id === l.TER)!.lastName), team);
    expect(swapped.TEL).toBe(l.TER);
    expect(swapped.TER).toBe(l.TEL);
  });
});

describe('play selection', () => {
  it('QB can run inside and sweep, nothing else', () => {
    expect(enabled(playOptions('QB', player('Eason')))).toEqual(['IL', 'IR', 'SL', 'SR']);
  });

  it('a back gets passes only for the columns printed on his card', () => {
    // Craig James: Q and S columns, no L column.
    expect(enabled(playOptions('RB1', player('James')))).toEqual(['IL', 'IR', 'SL', 'SR', 'SC', 'QK', 'SH']);
    // Darryl Wilson, in a flanker slot: only a Q column and no rushing column, so no end around.
    expect(enabled(playOptions('FLL', player('Wilson')))).toEqual(['QK']);
  });

  it('enforces field position limits', () => {
    expect(enabled(playOptions('FLL', player('Morgan'), { ballOn: 85 }))).not.toContain('LG');
    expect(enabled(playOptions('RB1', player('James'), { ballOn: 3 }))).not.toContain('SC');
  });

  it('applies play direction ratings (rule 4.6)', () => {
    const starring = player('Starring') as SkillPlayer; // rating 1
    const morgan = player('Morgan') as SkillPlayer; //     rating 2
    const fryar = player('Fryar') as SkillPlayer; //       rating 4
    const ev = (p: SkillPlayer, quarter = 1) => ({ playerId: p.id, possession: 1, quarter });
    expect(enabled(playOptions('FLL', starring, { targetHistory: [ev(starring)] }))).toEqual([]);
    expect(enabled(playOptions('FLL', starring, { targetHistory: [ev(starring), ev(morgan)] }))).not.toEqual([]);
    expect(enabled(playOptions('FLL', morgan, { targetHistory: [ev(morgan), ev(starring)] }))).toEqual([]);
    expect(enabled(playOptions('FLR', fryar, { quarter: 2, targetHistory: [ev(fryar, 1)] }))).not.toEqual([]);
    expect(enabled(playOptions('FLR', fryar, { quarter: 2, targetHistory: [ev(fryar, 2)] }))).toEqual([]);
  });
});

describe('strategies', () => {
  it('QB flop and sneak only on inside runs (the WPF screen also allowed them on sweeps)', () => {
    expect(enabled(strategyOptions('QB', 'IL'))).toEqual(['NONE', 'QB_FLOP', 'QB_SNEAK', 'DRAW']);
    expect(enabled(strategyOptions('QB', 'SL'))).toEqual(['NONE']);
  });

  it('play action only on short and long passes', () => {
    expect(enabled(strategyOptions('RB1', 'SH'))).toContain('PLAY_ACTION');
    expect(enabled(strategyOptions('RB1', 'QK'))).not.toContain('PLAY_ACTION');
  });
});

describe('normalizeCall', () => {
  const runSet = getFormation('run-3rb-2te');
  const lineup: Lineup = buildLineup(team, runSet);
  const inSlot = (s: OffenseSlot) => team.players.find(p => p.id === lineup[s]);

  it('falls back to RB1 when the chosen slot leaves the formation', () => {
    const call: OffenseCall = { formationId: 'pass-4wr', slot: 'RB3', play: 'IL', strategy: 'NONE', extraBlockers: [] };
    expect(normalizeCall(call, inSlot).slot).toBe('RB1');
  });

  it('gives a new target his default play when the old target leaves the field', () => {
    const call: OffenseCall = { formationId: 'pass-4wr', slot: 'RB3', play: 'QK', strategy: 'NONE', extraBlockers: [] };
    expect(normalizeCall(call, inSlot)).toMatchObject({ slot: 'RB1', play: 'IL' });
  });

  it('keeps the play while the target stays the same', () => {
    const call: OffenseCall = { formationId: runSet.id, slot: 'RB1', play: 'SH', strategy: 'NONE', extraBlockers: [] };
    expect(normalizeCall(call, inSlot).play).toBe('SH');
  });

  it('defaults backs and the QB to IL, ends and flankers to QK', () => {
    expect(['QB', 'RB1', 'RB2', 'RB3'].map(s => defaultPlayFor(s as OffenseSlot))).toEqual(['IL', 'IL', 'IL', 'IL']);
    expect(['TEL', 'TER', 'SEL', 'SER', 'FLL', 'FLR'].map(s => defaultPlayFor(s as OffenseSlot))).toEqual(Array(6).fill('QK'));
  });

  it('resets a strategy that is no longer legal (the Show/Check bug in the WPF version)', () => {
    const call: OffenseCall = { formationId: runSet.id, slot: 'QB', play: 'SL', strategy: 'QB_SNEAK', extraBlockers: [] };
    expect(normalizeCall(call, inSlot).strategy).toBe('NONE');
  });

  it('drops extra blockers on running plays and never lets the target block', () => {
    const call: OffenseCall = { formationId: runSet.id, slot: 'RB1', play: 'SH', strategy: 'NONE', extraBlockers: ['RB1', 'RB2'] };
    expect(normalizeCall(call, inSlot).extraBlockers).toEqual(['RB2']);
    expect(normalizeCall({ ...call, play: 'IL' }, inSlot).extraBlockers).toEqual([]);
  });

  it('shows the right card column for the bottom panel', () => {
    expect(cardColumnForCall(player('James'), 'IL')[0]).toBe('SG');
    expect(cardColumnForCall(player('Morgan'), 'LG')[0]).toBe(76);
  });
});

describe('FacDeck', () => {
  it('is reproducible from a seed and from a snapshot', () => {
    const a = new FacDeck(deck, 42);
    const b = new FacDeck(deck, 42);
    const first = Array.from({ length: 5 }, () => a.draw().id);
    expect(Array.from({ length: 5 }, () => b.draw().id)).toEqual(first);
    const resumed = new FacDeck(deck, a.snapshot());
    expect(resumed.draw().id).toBe(a.draw().id);
  });

  it('flips every card once before reshuffling', () => {
    const d = new FacDeck(deck, 7);
    const seen = new Set(Array.from({ length: deck.length }, () => d.draw().id));
    expect(seen.size).toBe(deck.length);
    expect(d.remaining).toBe(0);
    d.draw();
    expect(d.snapshot().reshuffles).toBe(1);
  });
});

it('has skill players with typed cards', () => {
  expect(team.players.filter(isSkillPlayer).length).toBe(13);
});
