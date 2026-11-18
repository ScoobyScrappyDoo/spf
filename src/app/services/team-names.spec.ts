import { describe, expect, it } from 'vitest';
import { cityOf, displayDivision, displayName, NamedTeam } from './team-names';

const season: NamedTeam[] = [
  { id: '1984-patriots', year: 1984, name: 'New England Patriots', division: 'AFC East' },
  { id: '1984-jets', year: 1984, name: 'New York Jets', division: 'AFC East' },
  { id: '1984-giants', year: 1984, name: 'New York Giants', division: 'NFC East' },
  { id: '1984-raiders', year: 1984, name: 'Los Angeles Raiders', division: 'AFC West' },
  { id: '1984-rams', year: 1984, name: 'Los Angeles Rams', division: 'NFC West' },
  { id: '1984-49ers', year: 1984, name: 'San Francisco 49ers', division: 'NFC West' },
];
const named = (id: string, mode: 'city' | 'full' = 'city') => displayName(season.find(t => t.id === id)!, season, mode);

describe('team names on screen', () => {
  it('city only: no club nicknames', () => {
    expect(cityOf('New England Patriots')).toBe('New England');
    expect(named('1984-patriots')).toBe('New England');
    expect(named('1984-49ers')).toBe('San Francisco');
  });

  it('two teams from one city are told apart as (A) and (N)', () => {
    expect(named('1984-jets')).toBe('New York (A)');
    expect(named('1984-giants')).toBe('New York (N)');
    expect(named('1984-raiders')).toBe('Los Angeles (A)');
    expect(named('1984-rams')).toBe('Los Angeles (N)');
  });

  it('divisions without league names', () => {
    expect(displayDivision('AFC East')).toBe('Conference A – East');
    expect(displayDivision('NFC Central')).toBe('Conference N – Central');
  });

  it('full names, for private games, are as on the cards', () => {
    expect(named('1984-jets', 'full')).toBe('New York Jets');
    expect(displayDivision('AFC East', 'full')).toBe('AFC East');
  });

  it('a made card set can bring its own city name', () => {
    const ah: NamedTeam = { id: '1984-patriots-ah', year: 1984, name: 'New England Patriots AH', city: 'New England AH', division: 'AFC East' };
    const withAh = [...season, ah];
    expect(displayName(ah, withAh)).toBe('New England AH');
    expect(displayName(withAh[0], withAh)).toBe('New England');
    expect(displayName(ah, withAh, 'full')).toBe('New England Patriots AH');
  });
});

