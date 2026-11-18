import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Fac, Team } from '../engine';
import { displayDivision, displayName } from './team-names';

export interface TeamEntry {
  id: string;
  year: number;
  name: string;
  /** See Team.city. */
  city?: string;
  conference: string;
  division: string;
  path: string;
  /** Set when the card set is missing something the game needs; the team can't be picked until it's fixed. */
  incomplete?: string;
}

/** Loads card sets from public/cards. Each file is fetched once and then kept. */
@Injectable({ providedIn: 'root' })
export class TeamService {
  private readonly http = inject(HttpClient);
  private readonly teams = new Map<string, Promise<Team>>();
  private deck?: Promise<Fac[]>;
  private catalogRequest?: Promise<TeamEntry[]>;

  /** The teams listed in public/cards/teams/index.json, for the game setup screen. */
  readonly catalog = signal<TeamEntry[]>([]);

  loadCatalog(): Promise<TeamEntry[]> {
    this.catalogRequest ??= firstValueFrom(this.http.get<TeamEntry[]>('cards/teams/index.json')).then(list => {
      // What the teams are called on screen (settings.ts): city names unless full names are switched on.
      const shown = list.map(t => ({ ...t, name: displayName(t, list), division: displayDivision(t.division) }));
      this.cardNames = new Map(list.map(t => [t.id, t]));
      this.catalog.set(shown);
      return shown;
    });
    return this.catalogRequest;
  }

  async loadTeam(id: string): Promise<Team> {
    if (!this.teams.has(id)) {
      this.teams.set(
        id,
        this.loadCatalog().then(list => {
          const entry = list.find(t => t.id === id);
          if (!entry) throw new Error(`Team ${id} is not in cards/teams/index.json`);
          return firstValueFrom(this.http.get<Team>(entry.path)).then(team => this.withDisplayNames(team));
        }),
      );
    }
    return this.teams.get(id)!;
  }

  /** The catalog as on the cards, before display names: needed to spot two teams from one city. */
  private cardNames = new Map<string, TeamEntry>();

  /** A team as the screens show it: name, short name and division per settings.ts. Card data is otherwise untouched. */
  private withDisplayNames(team: Team): Team {
    const season = [...this.cardNames.values()];
    const shown = displayName({ id: team.id, year: team.year, name: team.name, city: team.city, division: team.division }, season);
    return { ...team, name: shown, shortName: shown, division: displayDivision(team.division) };
  }

  loadDeck(): Promise<Fac[]> {
    this.deck ??= firstValueFrom(this.http.get<Fac[]>('cards/fac-deck.json'));
    return this.deck;
  }
}
