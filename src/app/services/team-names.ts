/**
 * What teams are called on screen (see settings.ts). The card files keep the real names; this only changes what's shown.
 */
import { SETTINGS, TeamNameMode } from '../settings';

export interface NamedTeam {
  id: string;
  year: number;
  /** As on the cards, e.g. "New York Giants". */
  name: string;
  /** Overrides the city taken from the name, e.g. "New England AH" for a made card set. */
  city?: string;
  /** "AFC East"; the conference is its first word. */
  division: string;
}

/** "New York Giants" -> "New York": the nickname is the last word on every card set so far. */
export function cityOf(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? words.slice(0, -1).join(' ') : name;
}

const conferenceOf = (division: string) => division.split(/\s+/)[0] ?? '';

/** The name to show for a team, given the other teams of its season (to spot two teams from one city). */
export function displayName(team: NamedTeam, season: NamedTeam[], mode: TeamNameMode = SETTINGS.teamNames): string {
  const own = SETTINGS.teamOverrides[team.id];
  if (own) return own;
  if (mode === 'full') return team.name;
  const cityName = (t: NamedTeam) => t.city ?? cityOf(t.name);
  const city = cityName(team);
  const shared = season.some(t => t.id !== team.id && t.year === team.year && cityName(t) === city);
  if (!shared) return city;
  const conference = conferenceOf(team.division);
  return `${city} (${SETTINGS.conferenceTags[conference] ?? conference})`;
}

/** "AFC East" -> "Conference A – East" in city mode; unchanged in full mode. */
export function displayDivision(division: string, mode: TeamNameMode = SETTINGS.teamNames): string {
  if (mode === 'full') return division;
  const [conference, ...rest] = division.split(/\s+/);
  const name = SETTINGS.conferenceNames[conference];
  return name ? `${name} – ${rest.join(' ')}`.trim() : division;
}
